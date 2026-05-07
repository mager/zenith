<script lang="ts">
  import { onMount } from 'svelte';
  import Papa from 'papaparse';
  import MapCanvas from '$lib/components/MapCanvas.svelte';
  import { normalizeItinerary } from '$lib/itinerary';
  import {
    buildDayNarrative,
    buildPlaceEnrichment,
    enrichmentKeyForPlace,
    mergePlaceEnrichment,
    placeHasHistory
  } from '$lib/place-enrichment';
  import { loadPlaceEnrichments, savePlaceEnrichment } from '$lib/place-enrichment-store';
  import {
    googlePlaceTypeLabel,
    isFoodPlaceType
  } from '$lib/place-taxonomy';
  import { sampleCsv } from '$lib/sample-itinerary';
  import { SAVED_PLACE_CATEGORIES, savedCategoryLabel } from '$lib/saved-places';
  import type {
    GooglePlaceType,
    ItineraryDay,
    MapPlace,
    NearbySavedPlace,
    PlaceCandidate,
    PlaceEnrichmentRecord,
    PlaceSource,
    ResolvedPlace,
    SavedMapList,
    SavedMapPlace,
    SavedPlaceCategory
  } from '$lib/types';

  type DetailPanel = 'csv' | 'maps' | null;
  type MapLens = 'smart' | 'stay' | 'food' | 'history';

  const EXAMPLE_SAVED_LIST_URL = 'https://maps.app.goo.gl/zZdZRFg5A3CamwaaA';
  const NEARBY_ROUTE_RADIUS_METERS = 1600;
  const NEARBY_STAY_RADIUS_METERS = 1800;
  const NEARBY_FALLBACK_RADIUS_METERS = 3200;
  const NEARBY_LIMIT = 32;
  const SAVED_LISTS_STORAGE_KEY = 'zen.saved-map-lists.v1';

  const placeColumns: PlaceSource[] = ['Ideas', 'Must Eats', 'Hotel'];
  const mapLensOptions: Array<{ id: MapLens; label: string }> = [
    { id: 'smart', label: 'Smart' },
    { id: 'stay', label: 'Near Stay' },
    { id: 'food', label: 'Food' },
    { id: 'history', label: 'History' }
  ];
  const initialDays = normalizeCsv(sampleCsv);

  let rawCsv = $state(sampleCsv);
  let days = $state<ItineraryDay[]>(initialDays);
  let activeDayId = $state(initialDays[0]?.id ?? '');
  let activePlaceId = $state(initialDays[0]?.places[0]?.id ?? '');
  let loadError = $state('');
  let uploadName = $state('Japan 2026 itinerary');
  let resolvedByDay = $state<Record<string, ResolvedPlace[]>>({});
  let resolutionErrors = $state<Record<string, string>>({});
  let loadingDayIds = $state<Record<string, boolean>>({});
  let activePanel = $state<DetailPanel>(null);
  let mapLens = $state<MapLens>('smart');
  let savedListUrl = $state(EXAMPLE_SAVED_LIST_URL);
  let savedLists = $state<SavedMapList[]>([]);
  let importingSavedList = $state(false);
  let savedImportError = $state('');
  let savedImportStatus = $state('');
  let savedStorageReady = $state(false);
  let placeEnrichments = $state<Record<string, PlaceEnrichmentRecord>>({});
  let enrichmentStorageLabel = $state('Local enrichment');
  let enrichmentDraft = $state('');
  let enrichmentDraftPlaceId = $state('');
  let enrichmentSaving = $state(false);
  let enrichmentStatus = $state('');
  let enrichmentError = $state('');

  function normalizeCsv(text: string): ItineraryDay[] {
    const parsed = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true
    });

    return normalizeItinerary(parsed.data);
  }

  let activeDay = $derived(days.find((day) => day.id === activeDayId) ?? days[0]);
  let activePlaces = $derived(activeDay?.places ?? []);
  let activeResolvedPlaces = $derived(resolvedByDay[activeDay?.id ?? ''] ?? []);
  let activeStayPlaces = $derived(activeResolvedPlaces.filter((place) => place.kind === 'hotel'));
  let savedPlaces = $derived(
    savedLists.flatMap((list) =>
      list.places.map((place) => ({
        ...place,
        listId: place.listId ?? list.id,
        listTitle: place.listTitle ?? list.title
      }))
    )
  );
  let activeNearbySavedPlaces = $derived(
    findNearbySavedPlaces(activeResolvedPlaces, activeStayPlaces, savedPlaces)
  );
  let activeLensSavedPlaces = $derived(activeNearbySavedPlaces.filter(matchesMapLens));
  let activeSavedPlace = $derived(
    activeNearbySavedPlaces.find((place) => place.id === activePlaceId)
  );
  let activePlace = $derived(
    activePlaces.find((place) => place.id === activePlaceId) ??
      (activeSavedPlace ? undefined : activePlaces[0])
  );
  let activeFocusPlace = $derived(activeSavedPlace ?? activePlace);
  let activePlaceEnrichment = $derived(
    activeFocusPlace ? enrichmentForPlace(activeFocusPlace) : undefined
  );
  let activeDayNarrative = $derived(
    buildDayNarrative(activeDay, activeResolvedPlaces, activeNearbySavedPlaces, placeEnrichments)
  );
  let visibleResolvedPlaces = $derived(activeResolvedPlaces.filter(matchesMapLens));
  let activeMapPlaces = $derived<MapPlace[]>([
    ...visibleResolvedPlaces.map(mapResolvedPlace),
    ...activeLensSavedPlaces.map(mapSavedPlace)
  ]);
  let easyNextPlaces = $derived(
    activeNearbySavedPlaces.filter((place) => place.distanceMeters <= 900).slice(0, 4)
  );
  let activeResolvedPlace = $derived(
    activePlace ? activeResolvedPlaces.find((place) => place.id === activePlace.id) : undefined
  );
  let isActiveDayLoading = $derived(Boolean(loadingDayIds[activeDay?.id ?? '']));
  let activeHotel = $derived(activeDay?.hotelPlaces[0]);
  let mapCaption = $derived(
    isActiveDayLoading
      ? 'Finding pins'
      : resolutionErrors[activeDay?.id ?? ''] ||
          `${activeResolvedPlaces.length}/${activePlaces.length} pinned${
            activeNearbySavedPlaces.length
              ? `, ${activeLensSavedPlaces.length}/${activeNearbySavedPlaces.length} saved in ${mapLensLabel(mapLens).toLowerCase()}`
              : ''
          }`
  );

  async function resolvePlaces(day: ItineraryDay) {
    if (resolvedByDay[day.id] || loadingDayIds[day.id]) return;

    loadingDayIds = { ...loadingDayIds, [day.id]: true };
    resolutionErrors = { ...resolutionErrors, [day.id]: '' };

    const candidates = day.places.slice(0, 24);

    try {
      const response = await fetch('/api/resolve-places', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify(
          candidates.map((candidate) => ({
            label: candidate.label,
            query: candidate.query,
            sourceUrl: candidate.sourceUrl,
            canonicalKey: candidate.canonicalKey
          }))
        )
      });

      if (!response.ok) {
        throw new Error('Place resolution failed.');
      }

      const resolved = (await response.json()) as Array<{
        lat: number;
        lng: number;
        source: ResolvedPlace['source'];
        resolvedLabel?: string;
      } | null>;

      const mapped = resolved.flatMap((result, index) =>
        result ? [{ ...candidates[index], ...result }] : []
      );

      resolvedByDay = { ...resolvedByDay, [day.id]: mapped };

      if (!mapped.length && candidates.length) {
        resolutionErrors = {
          ...resolutionErrors,
          [day.id]: 'Add a map link beside a place for exact placement.'
        };
      }
    } catch (error) {
      resolutionErrors = {
        ...resolutionErrors,
        [day.id]: error instanceof Error ? error.message : 'Map resolution failed.'
      };
    } finally {
      const { [day.id]: _done, ...remaining } = loadingDayIds;
      loadingDayIds = remaining;
    }
  }

  function selectDay(dayId: string) {
    activeDayId = dayId;
    activePanel = null;

    const nextDay = days.find((day) => day.id === dayId);
    activePlaceId = nextDay?.places[0]?.id ?? '';

    if (nextDay) {
      void resolvePlaces(nextDay);
    }
  }

  function resetItinerary(parsedDays: ItineraryDay[]) {
    days = parsedDays;
    activeDayId = parsedDays[0]?.id ?? '';
    activePlaceId = parsedDays[0]?.places[0]?.id ?? '';
    resolvedByDay = {};
    resolutionErrors = {};
    loadingDayIds = {};
    activePanel = null;
    loadError = parsedDays.length ? '' : 'No itinerary rows found in that CSV.';

    if (parsedDays[0]) {
      void resolvePlaces(parsedDays[0]);
    }
  }

  async function onUpload(event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    uploadName = file.name;
    rawCsv = await file.text();
    resetItinerary(normalizeCsv(rawCsv));
  }

  function pasteCsv() {
    resetItinerary(normalizeCsv(rawCsv));
  }

  function radians(value: number): number {
    return (value * Math.PI) / 180;
  }

  function distanceMeters(
    a: Pick<ResolvedPlace | SavedMapPlace, 'lat' | 'lng'>,
    b: Pick<ResolvedPlace | SavedMapPlace, 'lat' | 'lng'>
  ): number {
    const radius = 6371000;
    const dLat = radians(b.lat - a.lat);
    const dLng = radians(b.lng - a.lng);
    const latA = radians(a.lat);
    const latB = radians(b.lat);
    const h =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(latA) * Math.cos(latB) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

    return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function nearestResolvedPlace(
    savedPlace: SavedMapPlace,
    anchors: ResolvedPlace[]
  ): { place: ResolvedPlace; distance: number } | undefined {
    return anchors
      .map((dayPlace) => ({
        place: dayPlace,
        distance: distanceMeters(savedPlace, dayPlace)
      }))
      .sort((a, b) => a.distance - b.distance)[0];
  }

  function findNearbySavedPlaces(
    dayPlaces: ResolvedPlace[],
    stayPlaces: ResolvedPlace[],
    candidates: SavedMapPlace[]
  ): NearbySavedPlace[] {
    if (!dayPlaces.length || !candidates.length) return [];

    const routeAnchors = dayPlaces.filter((place) => place.kind !== 'hotel');
    const fallbackRouteAnchors = routeAnchors.length ? routeAnchors : dayPlaces;

    const ranked = candidates.flatMap((savedPlace) => {
      const routeNearest = nearestResolvedPlace(savedPlace, fallbackRouteAnchors);
      const stayNearest = nearestResolvedPlace(savedPlace, stayPlaces);
      const routeDistanceMeters = routeNearest?.distance;
      const stayDistanceMeters = stayNearest?.distance;
      const routeVisible =
        routeDistanceMeters !== undefined && routeDistanceMeters <= NEARBY_ROUTE_RADIUS_METERS;
      const stayVisible =
        stayDistanceMeters !== undefined && stayDistanceMeters <= NEARBY_STAY_RADIUS_METERS;
      const distanceMeters = Math.min(
        routeDistanceMeters ?? Number.POSITIVE_INFINITY,
        stayDistanceMeters ?? Number.POSITIVE_INFINITY
      );

      if (!Number.isFinite(distanceMeters)) return [];

      const nearest =
        stayDistanceMeters !== undefined && stayDistanceMeters === distanceMeters
          ? stayNearest
          : routeNearest;
      const proximity: NearbySavedPlace['proximity'] =
        stayVisible && routeVisible
          ? 'both'
          : stayVisible || stayDistanceMeters === distanceMeters
            ? 'stay'
            : 'route';

      return [
        {
          ...savedPlace,
          distanceMeters,
          nearestPlaceId: nearest?.place.id ?? '',
          nearestPlaceLabel: nearest?.place.label ?? '',
          routeDistanceMeters,
          stayDistanceMeters,
          stayPlaceId: stayNearest?.place.id,
          stayPlaceLabel: stayNearest?.place.label,
          proximity
        }
      ];
    });

    const targeted = ranked.filter(
      (place) =>
        (place.routeDistanceMeters ?? Number.POSITIVE_INFINITY) <= NEARBY_ROUTE_RADIUS_METERS ||
        (place.stayDistanceMeters ?? Number.POSITIVE_INFINITY) <= NEARBY_STAY_RADIUS_METERS
    );
    const visible =
      targeted.length >= 6
        ? targeted
        : ranked.filter((place) => place.distanceMeters <= NEARBY_FALLBACK_RADIUS_METERS);

    return visible.sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, NEARBY_LIMIT);
  }

  function enrichmentForPlace(
    place: PlaceCandidate | ResolvedPlace | NearbySavedPlace | SavedMapPlace
  ): PlaceEnrichmentRecord {
    const base = buildPlaceEnrichment(place);

    return mergePlaceEnrichment(base, placeEnrichments[enrichmentKeyForPlace(place)]) ?? base;
  }

  function mapResolvedPlace(place: ResolvedPlace): MapPlace {
    const enrichment = enrichmentForPlace(place);

    return {
      ...place,
      googlePlaceTypes: enrichment.googlePlaceTypes,
      primaryType: enrichment.primaryType,
      placeTypeLabel: googlePlaceTypeLabel(enrichment.primaryType),
      storyHeadline: enrichment.history?.headline
    };
  }

  function mapSavedPlace(place: NearbySavedPlace, index: number): MapPlace {
    const enrichment = enrichmentForPlace(place);
    const proximityLabel =
      place.proximity === 'both'
        ? 'Near route and stay'
        : place.proximity === 'stay'
          ? `Near stay${place.stayPlaceLabel ? `: ${place.stayPlaceLabel}` : ''}`
          : `Near route${place.nearestPlaceLabel ? `: ${place.nearestPlaceLabel}` : ''}`;

    return {
      id: place.id,
      label: place.label,
      lat: place.lat,
      lng: place.lng,
      kind: 'saved',
      order: index + 1,
      sourceColumns: [savedCategoryLabel(place.category), googlePlaceTypeLabel(enrichment.primaryType)],
      resolvedLabel: place.address ?? place.listTitle,
      savedCategory: place.category,
      googlePlaceTypes: enrichment.googlePlaceTypes,
      primaryType: enrichment.primaryType,
      placeTypeLabel: googlePlaceTypeLabel(enrichment.primaryType),
      distanceMeters: place.distanceMeters,
      routeDistanceMeters: place.routeDistanceMeters,
      stayDistanceMeters: place.stayDistanceMeters,
      nearestPlaceLabel: place.nearestPlaceLabel,
      proximityLabel,
      storyHeadline: enrichment.history?.headline
    };
  }

  function formatDistance(meters: number): string {
    if (meters < 1000) return `${Math.round(meters)} m`;

    return `${(meters / 1000).toFixed(1)} km`;
  }

  function effortLabel(meters: number): string {
    if (meters <= 700) return 'walk';
    if (meters <= NEARBY_ROUTE_RADIUS_METERS) return 'easy hop';

    return 'nearby';
  }

  function mapLensLabel(lens: MapLens): string {
    return mapLensOptions.find((option) => option.id === lens)?.label ?? 'Smart';
  }

  function matchesMapLens(place: ResolvedPlace | NearbySavedPlace): boolean {
    if (mapLens === 'smart') return true;

    if (mapLens === 'stay') {
      return isSavedPlace(place)
        ? place.proximity === 'stay' || place.proximity === 'both'
        : place.kind === 'hotel';
    }

    const enrichment = enrichmentForPlace(place);

    if (mapLens === 'history') {
      return isSavedPlace(place)
        ? Boolean(enrichment.history) || placeHasHistory(place)
        : place.kind === 'hotel' || Boolean(enrichment.history) || placeHasHistory(place);
    }

    return isSavedPlace(place)
      ? ['eat', 'coffee', 'night'].includes(place.category) ||
          isFoodPlaceType(enrichment.googlePlaceTypes)
      : place.kind === 'food' || isFoodPlaceType(enrichment.googlePlaceTypes);
  }

  function typeLabelForPlace(place: PlaceCandidate | NearbySavedPlace): string {
    const enrichment = enrichmentForPlace(place);

    return googlePlaceTypeLabel(enrichment.primaryType);
  }

  function shortPlaceTypes(types: GooglePlaceType[] | undefined): string {
    return (types ?? [])
      .slice(0, 3)
      .map((type) => googlePlaceTypeLabel(type))
      .join(', ');
  }

  function isSavedPlace(
    place: PlaceCandidate | NearbySavedPlace | SavedMapPlace | undefined
  ): place is NearbySavedPlace {
    return Boolean(place && 'category' in place && 'distanceMeters' in place);
  }

  async function importSavedList() {
    if (importingSavedList) return;

    importingSavedList = true;
    savedImportError = '';
    savedImportStatus = 'Importing Maps list...';

    try {
      const response = await fetch('/api/import-map-list', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({ url: savedListUrl })
      });
      const payload = (await response.json()) as { list?: SavedMapList; message?: string };

      if (!response.ok || !payload.list) {
        throw new Error(payload.message ?? 'Could not import that Maps list.');
      }

      const importedList = payload.list;
      savedLists = [importedList, ...savedLists.filter((list) => list.id !== importedList.id)];
      savedImportStatus = `Imported ${importedList.places.length} places from ${importedList.title}.`;
      savedListUrl = '';
    } catch (error) {
      savedImportError = error instanceof Error ? error.message : 'Maps list import failed.';
      savedImportStatus = '';
    } finally {
      importingSavedList = false;
    }
  }

  function useExampleMap() {
    savedListUrl = EXAMPLE_SAVED_LIST_URL;
    activePanel = 'maps';
    savedImportError = '';
    savedImportStatus = 'Ready to import your example Japan map.';
  }

  function removeSavedList(listId: string) {
    savedLists = savedLists.filter((list) => list.id !== listId);
    savedImportStatus = '';
    savedImportError = '';
  }

  async function saveActiveEnrichmentNote() {
    if (!activeFocusPlace || !activePlaceEnrichment || enrichmentSaving) return;

    enrichmentSaving = true;
    enrichmentStatus = '';
    enrichmentError = '';

    const record: PlaceEnrichmentRecord = {
      ...activePlaceEnrichment,
      personalNote: enrichmentDraft.trim() || undefined,
      source: 'manual',
      updatedAt: new Date().toISOString()
    };

    try {
      const storage = await savePlaceEnrichment(record);
      placeEnrichments = {
        ...placeEnrichments,
        [record.id]: record
      };
      enrichmentStorageLabel = storage === 'firestore' ? 'Firestore enrichment' : 'Local enrichment';
      enrichmentStatus = storage === 'firestore' ? 'Saved to Firestore.' : 'Saved locally.';
    } catch (error) {
      enrichmentError = error instanceof Error ? error.message : 'Could not save enrichment.';
    } finally {
      enrichmentSaving = false;
    }
  }

  function savedPlacesByCategory(category: SavedPlaceCategory): NearbySavedPlace[] {
    return activeLensSavedPlaces.filter((place) => place.category === category);
  }

  function selectPlace(placeId: string) {
    activePlaceId = placeId;
  }

  function placesBySource(source: PlaceSource): PlaceCandidate[] {
    return activePlaces.filter((place) => place.sourceColumns.includes(source));
  }

  function resolvedForPlace(place: PlaceCandidate): ResolvedPlace | undefined {
    return activeResolvedPlaces.find((resolved) => resolved.id === place.id);
  }

  function mapSearchUrl(place: PlaceCandidate | NearbySavedPlace): string {
    if (isSavedPlace(place)) return place.googleMapsUrl;

    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.query)}`;
  }

  function kindLabel(place: PlaceCandidate | NearbySavedPlace): string {
    if (isSavedPlace(place)) return savedCategoryLabel(place.category);
    if (place.kind === 'food') return 'Eat';
    if (place.kind === 'hotel') return 'Stay';

    return 'Explore';
  }

  function sourceLabel(source: PlaceSource | string): string {
    if (source === 'Must Eats') return 'Eats';
    if (source === 'Hotel') return 'Stay';

    return source;
  }

  function daySummary(day: ItineraryDay): string {
    const parts = [`${day.activities.length} ideas`, `${day.foods.length} eats`];

    if (day.hotelPlaces.length) {
      parts.push('stay pinned');
    }

    return parts.join(', ');
  }

  onMount(() => {
    const storedLists = localStorage.getItem(SAVED_LISTS_STORAGE_KEY);

    if (storedLists) {
      try {
        const parsed = JSON.parse(storedLists) as SavedMapList[];
        savedLists = Array.isArray(parsed) ? parsed : [];
      } catch {
        savedLists = [];
      }
    }

    savedStorageReady = true;

    void (async () => {
      const loaded = await loadPlaceEnrichments();
      placeEnrichments = loaded.records;
      enrichmentStorageLabel = loaded.storageLabel;
    })();
  });

  $effect(() => {
    if (activeDay) {
      void resolvePlaces(activeDay);
    }
  });

  $effect(() => {
    if (!savedStorageReady) return;

    localStorage.setItem(SAVED_LISTS_STORAGE_KEY, JSON.stringify(savedLists));
  });

  $effect(() => {
    const nextPlaceId = activeFocusPlace?.id ?? '';

    if (nextPlaceId === enrichmentDraftPlaceId) return;

    enrichmentDraftPlaceId = nextPlaceId;
    enrichmentDraft = activePlaceEnrichment?.personalNote ?? '';
    enrichmentStatus = '';
    enrichmentError = '';
  });

  $effect(() => {
    if (!activeMapPlaces.length || activeMapPlaces.some((place) => place.id === activePlaceId)) return;

    activePlaceId = activeMapPlaces[0].id;
  });
</script>

<svelte:head>
  <title>Zen | Travel Planner</title>
  <meta
    name="description"
    content="Zen turns a CSV itinerary into a map-first, high-clarity travel dashboard."
  />
</svelte:head>

<div class="zen-shell min-h-screen">
  <div class="zen-page-frame mx-auto grid min-h-screen gap-4 px-3 py-3 lg:grid-cols-[22rem_minmax(0,1fr)] lg:px-4 lg:py-4">
    <aside class="zen-sidebar min-h-0 lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)]">
      <section class="zen-panel flex h-full min-h-0 flex-col rounded-lg">
        <div class="border-b border-[var(--line)] p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-soft)]">
                Zen
              </p>
              <h1 class="mt-2 text-[1.28rem] font-semibold leading-tight">Japan map planner</h1>
              <p class="mt-2 text-[13px] leading-5 text-[var(--text-muted)]">
                Paste a trip. Get the day on a map.
              </p>
            </div>
            <div class="shrink-0 rounded-md border border-[var(--line)] bg-[var(--panel-strong)] px-2.5 py-2 text-right">
              <div class="text-[10px] uppercase tracking-[0.14em] text-[var(--text-soft)]">Days</div>
              <div class="mt-1 text-[1rem] font-semibold">{days.length}</div>
            </div>
          </div>

          <div class="mt-4 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
            <label
              class="inline-flex flex-1 cursor-pointer items-center justify-center rounded-md border border-[var(--line-strong)] bg-[var(--text-main)] px-3 py-2.5 text-[12px] font-semibold text-[var(--panel-strong)] transition hover:bg-[var(--ink-hover)]"
            >
              Upload CSV
              <input class="hidden" type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" onchange={onUpload} />
            </label>
            <button
              type="button"
              class="inline-flex items-center justify-center rounded-md border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2.5 text-[12px] font-semibold transition hover:border-[var(--line-strong)] hover:bg-[var(--bg-0)]"
              onclick={() => (activePanel = activePanel === 'csv' ? null : 'csv')}
            >
              CSV
            </button>
            <button
              type="button"
              class={`inline-flex items-center justify-center rounded-md border px-3 py-2.5 text-[12px] font-semibold transition ${
                activePanel === 'maps'
                  ? 'border-[var(--line-strong)] bg-[var(--text-main)] text-[var(--panel-strong)]'
                  : 'border-[var(--line)] bg-[var(--panel-strong)] hover:border-[var(--line-strong)] hover:bg-[var(--bg-0)]'
              }`}
              onclick={() => (activePanel = activePanel === 'maps' ? null : 'maps')}
            >
              Maps
            </button>
          </div>
          <div class="mt-3 flex items-center justify-between gap-3 text-[11px] text-[var(--text-muted)]">
            <span class="min-w-0 truncate">{uploadName}</span>
            <span class="shrink-0">{savedPlaces.length} saved</span>
          </div>

          {#if activePanel === 'csv'}
            <div class="mt-4">
              <textarea
                bind:value={rawCsv}
                class="zen-code h-[16rem] w-full rounded-md border border-[var(--line)] bg-[var(--bg-0)] px-3 py-3 text-[12px] leading-6 text-[var(--text-main)]"
              ></textarea>
              <button
                type="button"
                class="mt-3 rounded-md border border-[var(--line-strong)] bg-[var(--text-main)] px-3 py-2 text-[12px] font-semibold text-[var(--panel-strong)] transition hover:bg-[var(--ink-hover)]"
                onclick={pasteCsv}
              >
                Rebuild map
              </button>
              {#if loadError}
                <p class="mt-3 text-[12px] text-[var(--accent-coral)]">{loadError}</p>
              {/if}
            </div>
          {/if}

          {#if activePanel === 'maps'}
            <div class="mt-4">
              <div class="flex items-center justify-between gap-3">
                <label class="block text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-soft)]" for="saved-list-url">
                  Google Maps List
                </label>
                <button
                  type="button"
                  class="rounded-md border border-[var(--line)] bg-[var(--panel-strong)] px-2 py-1 text-[11px] font-semibold text-[var(--text-muted)] transition hover:border-[var(--line-strong)] hover:bg-[var(--bg-0)]"
                  onclick={useExampleMap}
                >
                  Use example
                </button>
              </div>
              <div class="mt-2 flex gap-2">
                <input
                  id="saved-list-url"
                  bind:value={savedListUrl}
                  class="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-[var(--bg-0)] px-3 py-2.5 text-[12px] text-[var(--text-main)] outline-none transition focus:border-[var(--line-strong)]"
                  placeholder="https://maps.app.goo.gl/..."
                  type="url"
                />
                <button
                  type="button"
                  class="rounded-md border border-[var(--line-strong)] bg-[var(--text-main)] px-3 py-2 text-[12px] font-semibold text-[var(--panel-strong)] transition hover:bg-[var(--ink-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={importingSavedList}
                  onclick={importSavedList}
                >
                  {importingSavedList ? 'Adding' : 'Add'}
                </button>
              </div>
              <p class="mt-2 text-[11px] leading-4 text-[var(--text-soft)]">
                The example link is prefilled, and imported lists stay on this machine.
              </p>

              {#if savedImportStatus}
                <p class="mt-2 text-[12px] leading-5 text-[var(--text-muted)]">{savedImportStatus}</p>
              {/if}
              {#if savedImportError}
                <p class="mt-2 text-[12px] leading-5 text-[var(--accent-coral)]">{savedImportError}</p>
              {/if}

              <div class="mt-3 grid gap-2">
                {#each savedLists as list}
                  <div class="zen-list-row rounded-md border border-[var(--line)] bg-[var(--bg-0)] px-3 py-2">
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0">
                        <div class="truncate text-[12px] font-semibold">{list.title}</div>
                        <div class="mt-0.5 text-[11px] text-[var(--text-muted)]">{list.places.length} saved places</div>
                      </div>
                      <button
                        type="button"
                        class="rounded-md border border-[var(--line)] px-2 py-1 text-[11px] font-semibold text-[var(--text-muted)] transition hover:border-[var(--line-strong)] hover:bg-[var(--panel-strong)]"
                        onclick={() => removeSavedList(list.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                {:else}
                  <p class="rounded-md border border-[var(--line)] bg-[var(--bg-0)] px-3 py-2 text-[12px] leading-5 text-[var(--text-muted)]">
                    Paste a shared Maps list to color-code saved places against each day.
                  </p>
                {/each}
              </div>
            </div>
          {/if}
        </div>

        <div class="flex min-h-0 flex-1 flex-col p-3">
          <div class="flex items-center justify-between px-1 pb-2">
            <h2 class="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-soft)]">
              Days
            </h2>
            <span class="text-[11px] text-[var(--text-muted)]">{activeDay?.city ?? 'No day'}</span>
          </div>

          <div class="grid min-h-0 flex-1 gap-1.5 overflow-auto pr-1">
            {#each days as day}
              <button
                type="button"
                class={`zen-day-row ${day.id === activeDay?.id ? 'zen-day-row--active' : ''}`}
                onclick={() => selectDay(day.id)}
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="flex min-w-0 items-center gap-2">
                      <span class="shrink-0 text-[12px] font-semibold">Day {day.dayNumber}</span>
                      <span class="truncate text-[11px] uppercase tracking-[0.12em] text-[var(--text-soft)]">
                        {day.weekday}, {day.date}
                      </span>
                    </div>
                    <div class="mt-1 truncate text-[14px] font-semibold">{day.city}</div>
                  </div>
                  <div class="shrink-0 rounded-full border border-[var(--line)] bg-[var(--bg-0)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]">
                    {day.places.length}
                  </div>
                </div>
                <div class="mt-2 line-clamp-2 text-[12px] leading-5 text-[var(--text-muted)]">
                  {day.theme}
                </div>
                <div class="mt-2 truncate text-[11px] text-[var(--text-soft)]">{daySummary(day)}</div>
              </button>
            {/each}
          </div>
        </div>
      </section>
    </aside>

    <main class="flex min-w-0 flex-col gap-4">
      {#if activeDay}
        <section class="zen-map-stage relative min-h-[78vh] overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--bg-2)] shadow-[var(--shadow-panel)] lg:min-h-[calc(100vh-2rem)]">
          <div class="absolute inset-0">
            <MapCanvas
              places={activeMapPlaces}
              activePlaceId={activeFocusPlace?.id ?? ''}
              onSelectPlace={selectPlace}
            />
          </div>

          <div class="zen-map-fade zen-map-fade--top pointer-events-none absolute inset-x-0 top-0 h-40"></div>
          <div class="zen-map-fade zen-map-fade--bottom pointer-events-none absolute inset-x-0 bottom-0 h-56"></div>

          <div class="pointer-events-none absolute left-3 right-3 top-3 z-10 sm:left-4 sm:right-4">
            <div class="zen-map-title pointer-events-auto max-w-full rounded-lg border border-[var(--line)] bg-[var(--panel-strong)]/94 px-4 py-3 shadow-[var(--shadow-panel)] backdrop-blur">
              <div class="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-soft)]">
                <span>Day {activeDay.dayNumber}</span>
                <span>{activeDay.date}</span>
                <span>{activeDay.weekday}</span>
                <span>{mapCaption}</span>
              </div>
              <div class="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
                <h2 class="text-[1.65rem] font-semibold leading-none">{activeDay.city}</h2>
                <p class="max-w-[48rem] text-[13px] leading-5 text-[var(--text-muted)]">{activeDay.theme}</p>
              </div>
              {#if activeHotel}
                <button
                  type="button"
                  class="zen-stay-link mt-3 inline-flex max-w-full items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--bg-0)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--text-muted)]"
                  onclick={() => selectPlace(activeHotel.id)}
                >
                  <span class="zen-source-dot zen-source-dot--hotel"></span>
                  <span class="truncate">Tonight: {activeHotel.label}</span>
                </button>
              {/if}
              <div class="mt-3 flex flex-wrap gap-2">
                {#each mapLensOptions as option}
                  <button
                    type="button"
                    class={`zen-map-chip ${mapLens === option.id ? 'zen-map-chip--active' : ''}`}
                    onclick={() => (mapLens = option.id)}
                  >
                    {option.label}
                  </button>
                {/each}
              </div>
              {#if activeDayNarrative.historyStops.length || activeDayNarrative.savedHistoryCount}
                <div class="zen-story-strip mt-3">
                  <div class="min-w-0">
                    <div class="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-soft)]">
                      Story Thread
                    </div>
                    <p class="mt-1 text-[13px] font-semibold leading-5">{activeDayNarrative.headline}</p>
                    <p class="mt-1 max-w-[54rem] text-[12px] leading-5 text-[var(--text-muted)]">
                      {activeDayNarrative.summary}
                    </p>
                  </div>
                  {#if activeDayNarrative.themes.length}
                    <div class="zen-story-themes">
                      {#each activeDayNarrative.themes as theme}
                        <span>{theme}</span>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          </div>

          {#if activeFocusPlace}
            <div class="pointer-events-none absolute bottom-3 left-3 right-3 z-10 grid gap-3 xl:grid-cols-[minmax(0,1fr)_23rem]">
              <div class="pointer-events-auto min-w-0 self-end rounded-lg border border-[var(--line)] bg-[var(--panel-strong)]/94 p-2 shadow-[var(--shadow-panel)] backdrop-blur">
                <div class="zen-place-rail flex gap-2 overflow-x-auto pb-1">
                  {#each activePlaces as place}
                    <button
                      type="button"
                      class={`zen-place-pill ${place.id === activeFocusPlace.id ? 'zen-place-pill--active' : ''}`}
                      onclick={() => selectPlace(place.id)}
                    >
                      <span class={`zen-source-dot zen-source-dot--${place.kind}`}></span>
                      <span class="zen-place-pill__order">{kindLabel(place)}</span>
                      <span class="zen-place-pill__text">{place.label}</span>
                      <span
                        class={`zen-resolve-dot ${resolvedForPlace(place) ? 'zen-resolve-dot--live' : ''}`}
                      ></span>
                    </button>
                  {/each}
                </div>
              </div>

              <article class="pointer-events-auto rounded-lg border border-[var(--line)] bg-[var(--panel-strong)]/96 p-4 shadow-[var(--shadow-panel)] backdrop-blur">
                {#if activeSavedPlace}
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <div class="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-soft)]">
                        {kindLabel(activeSavedPlace)}
                      </div>
                      <h3 class="mt-1 text-[1.12rem] font-semibold leading-tight">{activeSavedPlace.label}</h3>
                      <p class="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">
                        {typeLabelForPlace(activeSavedPlace)} /
                        {activeSavedPlace.proximity === 'stay' && activeSavedPlace.stayPlaceLabel
                          ? `${formatDistance(activeSavedPlace.distanceMeters)} from ${activeSavedPlace.stayPlaceLabel}`
                          : `${formatDistance(activeSavedPlace.distanceMeters)} from ${activeSavedPlace.nearestPlaceLabel}`}
                      </p>
                    </div>
                    <span class={`zen-source-dot zen-source-dot--saved-${activeSavedPlace.category} mt-1`}></span>
                  </div>

                  {#if activeSavedPlace.address}
                    <p class="mt-3 text-[12px] leading-5 text-[var(--text-muted)]">{activeSavedPlace.address}</p>
                  {/if}
                  {#if activeSavedPlace.note}
                    <p class="mt-2 text-[12px] leading-5 text-[var(--text-muted)]">{activeSavedPlace.note}</p>
                  {/if}

                  <div class="mt-3 flex flex-wrap gap-1.5">
                    <span class="rounded-full border border-[var(--line)] bg-[var(--bg-0)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-soft)]">
                      {activeSavedPlace.listTitle}
                    </span>
                    <span class="rounded-full border border-[var(--line)] bg-[var(--bg-0)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-soft)]">
                      {effortLabel(activeSavedPlace.distanceMeters)}
                    </span>
                  </div>

                  <div class="mt-3 flex flex-wrap gap-2">
                    <a
                      class="inline-flex items-center justify-center rounded-md border border-[var(--line-strong)] bg-[var(--text-main)] px-3 py-2 text-[12px] font-semibold text-[var(--panel-strong)] transition hover:bg-[var(--ink-hover)]"
                      href={mapSearchUrl(activeSavedPlace)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open map
                    </a>
                  </div>
                {:else if activePlace}
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <div class="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-soft)]">
                        {kindLabel(activePlace)}
                      </div>
                      <h3 class="mt-1 text-[1.12rem] font-semibold leading-tight">{activePlace.label}</h3>
                      <p class="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">
                        {typeLabelForPlace(activePlace)} / {activeResolvedPlace?.resolvedLabel ?? activePlace.query}
                      </p>
                    </div>
                    <span class={`zen-source-dot zen-source-dot--${activePlace.kind} mt-1`}></span>
                  </div>

                  {#if activePlace.detail}
                    <p class="mt-3 text-[12px] leading-5 text-[var(--text-muted)]">{activePlace.detail}</p>
                  {/if}

                  <div class="mt-3 flex flex-wrap gap-1.5">
                    {#each activePlace.sourceColumns as source}
                      <span class="rounded-full border border-[var(--line)] bg-[var(--bg-0)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-soft)]">
                        {sourceLabel(source)}
                      </span>
                    {/each}
                  </div>

                  <div class="mt-3 flex flex-wrap gap-2">
                    <a
                      class="inline-flex items-center justify-center rounded-md border border-[var(--line-strong)] bg-[var(--text-main)] px-3 py-2 text-[12px] font-semibold text-[var(--panel-strong)] transition hover:bg-[var(--ink-hover)]"
                      href={mapSearchUrl(activePlace)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open map
                    </a>
                    {#if activePlace.sourceUrl}
                      <a
                        class="inline-flex items-center justify-center rounded-md border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2 text-[12px] font-semibold text-[var(--text-main)] transition hover:border-[var(--line-strong)] hover:bg-[var(--bg-0)]"
                        href={activePlace.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Source link
                      </a>
                    {/if}
                  </div>
                {/if}

                {#if activePlaceEnrichment}
                  <div class="zen-enrichment-box mt-4">
                    <div class="flex flex-wrap items-center gap-1.5">
                      <span class="zen-type-token">{googlePlaceTypeLabel(activePlaceEnrichment.primaryType)}</span>
                      {#if shortPlaceTypes(activePlaceEnrichment.googlePlaceTypes)}
                        <span class="text-[11px] leading-4 text-[var(--text-soft)]">
                          {shortPlaceTypes(activePlaceEnrichment.googlePlaceTypes)}
                        </span>
                      {/if}
                    </div>

                    {#if activePlaceEnrichment.history}
                      <div class="mt-3 border-t border-[var(--line)] pt-3">
                        <div class="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-soft)]">
                          History
                        </div>
                        <h4 class="mt-1 text-[0.94rem] font-semibold leading-tight">
                          {activePlaceEnrichment.history.headline}
                        </h4>
                        <p class="mt-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-soft)]">
                          {activePlaceEnrichment.history.era}
                        </p>
                        <p class="mt-2 text-[12px] leading-5 text-[var(--text-muted)]">
                          {activePlaceEnrichment.history.context}
                        </p>
                        <p class="mt-2 text-[12px] leading-5 text-[var(--text-muted)]">
                          {activePlaceEnrichment.history.whyVisit}
                        </p>
                        {#if activePlaceEnrichment.history.visitCue}
                          <p class="mt-2 text-[12px] leading-5 text-[var(--text-main)]">
                            {activePlaceEnrichment.history.visitCue}
                          </p>
                        {/if}
                      </div>
                    {/if}

                    <div class="mt-3 border-t border-[var(--line)] pt-3">
                      <div class="flex items-center justify-between gap-3">
                        <label class="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-soft)]" for="enrichment-note">
                          My layer
                        </label>
                        <span class="text-[10px] text-[var(--text-soft)]">{enrichmentStorageLabel}</span>
                      </div>
                      <textarea
                        id="enrichment-note"
                        bind:value={enrichmentDraft}
                        class="mt-2 h-20 w-full resize-none rounded-md border border-[var(--line)] bg-[var(--bg-0)] px-3 py-2 text-[12px] leading-5 text-[var(--text-main)]"
                        placeholder="Add why this matters, booking notes, or a history angle to research later."
                      ></textarea>
                      <div class="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          class="rounded-md border border-[var(--line-strong)] bg-[var(--text-main)] px-3 py-2 text-[12px] font-semibold text-[var(--panel-strong)] transition hover:bg-[var(--ink-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={enrichmentSaving}
                          onclick={saveActiveEnrichmentNote}
                        >
                          {enrichmentSaving ? 'Saving' : 'Save note'}
                        </button>
                        {#if enrichmentStatus}
                          <span class="text-[11px] text-[var(--text-muted)]">{enrichmentStatus}</span>
                        {/if}
                        {#if enrichmentError}
                          <span class="text-[11px] text-[var(--accent-coral)]">{enrichmentError}</span>
                        {/if}
                      </div>
                    </div>
                  </div>
                {/if}
              </article>
            </div>
          {/if}
        </section>

        <section class="zen-panel rounded-lg p-4">
          <div class="flex items-center justify-between border-b border-[var(--line)] px-1 pb-3">
            <h3 class="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-soft)]">
              Day Places
            </h3>
            <span class="text-[11px] text-[var(--text-muted)]">{activePlaces.length} pins</span>
          </div>

          <section class="zen-history-thread mt-3">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <h4 class="text-[12px] font-semibold">{activeDayNarrative.headline}</h4>
                <p class="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">
                  {activeDayNarrative.summary}
                </p>
              </div>
              <button
                type="button"
                class={`shrink-0 rounded-md border px-2.5 py-1.5 text-[11px] font-semibold transition ${
                  mapLens === 'history'
                    ? 'border-[var(--line-strong)] bg-[var(--text-main)] text-[var(--panel-strong)]'
                    : 'border-[var(--line)] bg-[var(--bg-0)] text-[var(--text-muted)] hover:border-[var(--line-strong)] hover:bg-[var(--panel-strong)]'
                }`}
                onclick={() => (mapLens = 'history')}
              >
                History lens
              </button>
            </div>

            {#if activeDayNarrative.historyStops.length}
              <div class="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {#each activeDayNarrative.historyStops.slice(0, 6) as stop}
                  <button
                    type="button"
                    class="zen-history-stop"
                    onclick={() => selectPlace(activePlaces.find((place) => enrichmentKeyForPlace(place) === stop.id)?.id ?? '')}
                  >
                    <span class="text-[11px] font-semibold">{stop.label}</span>
                    <span class="mt-1 line-clamp-2 text-[11px] leading-4 text-[var(--text-muted)]">
                      {stop.history?.headline}
                    </span>
                  </button>
                {/each}
              </div>
            {/if}
          </section>

          <div class="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1fr)_27rem]">
            <div class="grid gap-3 xl:grid-cols-3">
              {#each placeColumns as source}
                <section class="zen-source-band rounded-lg border border-[var(--line)] bg-[var(--panel-strong)] p-3">
                  <div class="flex items-center justify-between gap-3">
                    <h4 class="text-[12px] font-semibold">{sourceLabel(source)}</h4>
                    <span class="text-[11px] text-[var(--text-muted)]">{placesBySource(source).length}</span>
                  </div>
                  <div class="mt-2 flex flex-wrap gap-2">
                    {#each placesBySource(source) as place}
                      <button
                        type="button"
                        class={`zen-source-place ${place.id === activePlace?.id ? 'zen-source-place--active' : ''}`}
                        onclick={() => selectPlace(place.id)}
                      >
                        <span class={`zen-source-dot zen-source-dot--${place.kind}`}></span>
                        <span>{place.label}</span>
                      </button>
                    {:else}
                      <span class="text-[12px] text-[var(--text-soft)]">Nothing in this column.</span>
                    {/each}
                  </div>
                </section>
              {/each}
            </div>

            <section class="zen-nearby-saved rounded-lg border border-[var(--line)] bg-[var(--panel-strong)] p-3">
              <div class="flex items-center justify-between gap-3">
                <div>
                  <h4 class="text-[12px] font-semibold">Nearby Saved</h4>
                  <p class="mt-1 text-[11px] text-[var(--text-muted)]">
                    {activeLensSavedPlaces.length
                      ? `${activeLensSavedPlaces.length} shown in ${mapLensLabel(mapLens).toLowerCase()} lens`
                      : savedLists.length
                        ? 'No saved pins match this lens yet'
                        : 'Add a Maps list to unlock this'}
                  </p>
                </div>
                <button
                  type="button"
                  class="rounded-md border border-[var(--line)] bg-[var(--bg-0)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] transition hover:border-[var(--line-strong)] hover:bg-[var(--panel-strong)]"
                  onclick={() => (activePanel = 'maps')}
                >
                  Lists
                </button>
              </div>

              {#if easyNextPlaces.length}
                <div class="mt-3 rounded-md border border-[var(--line)] bg-[var(--bg-0)] p-2.5">
                  <div class="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-soft)]">
                    Low Energy Next
                  </div>
                  <div class="mt-2 grid gap-1.5">
                    {#each easyNextPlaces as place}
                      <button
                        type="button"
                        class={`zen-saved-suggestion ${place.id === activeSavedPlace?.id ? 'zen-saved-suggestion--active' : ''}`}
                        onclick={() => selectPlace(place.id)}
                      >
                        <span class={`zen-source-dot zen-source-dot--saved-${place.category}`}></span>
                        <span class="min-w-0 flex-1 truncate">{place.label}</span>
                        <span>{place.proximity === 'stay' ? 'stay' : formatDistance(place.distanceMeters)}</span>
                      </button>
                    {/each}
                  </div>
                </div>
              {/if}

              <div class="mt-3 grid gap-3">
                {#each SAVED_PLACE_CATEGORIES as category}
                  {@const categoryPlaces = savedPlacesByCategory(category)}
                  {#if categoryPlaces.length}
                    <div>
                      <div class="mb-1.5 flex items-center justify-between gap-3">
                        <div class="flex items-center gap-2">
                          <span class={`zen-source-dot zen-source-dot--saved-${category}`}></span>
                          <span class="text-[11px] font-semibold">{savedCategoryLabel(category)}</span>
                        </div>
                        <span class="text-[11px] text-[var(--text-muted)]">{categoryPlaces.length}</span>
                      </div>
                      <div class="flex flex-wrap gap-2">
                        {#each categoryPlaces.slice(0, 8) as place}
                          <button
                            type="button"
                            class={`zen-source-place ${place.id === activeSavedPlace?.id ? 'zen-source-place--active' : ''}`}
                            onclick={() => selectPlace(place.id)}
                          >
                            <span>{place.label}</span>
                            <span class="text-[10px] text-[var(--text-soft)]">{formatDistance(place.distanceMeters)}</span>
                          </button>
                        {/each}
                      </div>
                    </div>
                  {/if}
                {/each}

                {#if !activeLensSavedPlaces.length}
                  <p class="rounded-md border border-[var(--line)] bg-[var(--bg-0)] px-3 py-2 text-[12px] leading-5 text-[var(--text-muted)]">
                    Saved places appear here when they match the active lens and are close to today's route or hotel.
                  </p>
                {/if}
              </div>
            </section>
          </div>
        </section>
      {:else}
        <div class="zen-panel flex flex-1 items-center justify-center rounded-lg px-6 text-center text-[var(--text-muted)]">
          Upload or paste a CSV to begin.
        </div>
      {/if}
    </main>
  </div>
</div>
