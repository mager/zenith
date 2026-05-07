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
  import { formatInches, formatPercent, formatTemp } from '$lib/weather';
  import type {
    CityWeather,
    DailyWeather,
    ItineraryDayWeather,
    TripWeatherResponse,
    WeatherTone
  } from '$lib/weather';
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
  let resolvedByDay = $state<Record<string, ResolvedPlace[]>>({});
  let resolutionErrors = $state<Record<string, string>>({});
  let loadingDayIds = $state<Record<string, boolean>>({});
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
  let weatherCities = $state<CityWeather[]>([]);
  let weatherByDayId = $state<Record<string, ItineraryDayWeather>>({});
  let weatherLoading = $state(false);
  let weatherError = $state('');
  let weatherFetchedAt = $state('');
  let weatherRequestRun = 0;
  let setupOpen = $state(false);
  let mapDetailsOpen = $state(false);

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
  let tripCities = $derived(
    Array.from(new Set(days.map((day) => day.city.trim()).filter(Boolean)))
  );
  let totalItineraryPlaces = $derived(days.reduce((total, day) => total + day.places.length, 0));
  let totalItineraryFoods = $derived(days.reduce((total, day) => total + day.foods.length, 0));
  let totalItineraryStays = $derived(days.reduce((total, day) => total + day.hotelPlaces.length, 0));
  let activeCityWeather = $derived(activeDay ? weatherForCity(activeDay.city) : undefined);
  let activeDayWeather = $derived(activeDay ? weatherByDayId[activeDay.id] : undefined);
  let activeDailyWeather = $derived(activeDayWeather?.forecast);
  let activeWeatherTone = $derived<WeatherTone>(
    activeDailyWeather?.tone ?? activeCityWeather?.current?.tone ?? 'cloud'
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
    mapDetailsOpen = false;

    const nextDay = days.find((day) => day.id === dayId);
    activePlaceId = nextDay?.places[0]?.id ?? '';

    if (nextDay) {
      void resolvePlaces(nextDay);
    }
  }

  function selectCity(city: string) {
    const nextDay = days.find((day) => normalizedCityKey(day.city) === normalizedCityKey(city));

    if (nextDay) {
      selectDay(nextDay.id);
    }
  }

  function resetItinerary(parsedDays: ItineraryDay[]) {
    days = parsedDays;
    activeDayId = parsedDays[0]?.id ?? '';
    activePlaceId = parsedDays[0]?.places[0]?.id ?? '';
    resolvedByDay = {};
    resolutionErrors = {};
    loadingDayIds = {};
    loadError = parsedDays.length ? '' : 'No itinerary rows found in that CSV.';
    setupOpen = !parsedDays.length;

    if (parsedDays[0]) {
      void resolvePlaces(parsedDays[0]);
    }
  }

  function pasteCsv() {
    resetItinerary(normalizeCsv(rawCsv));
  }

  function normalizedCityKey(city: string): string {
    return city.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function weatherForCity(city: string): CityWeather | undefined {
    const key = normalizedCityKey(city);

    return weatherCities.find((weatherCity) => normalizedCityKey(weatherCity.city) === key);
  }

  function weatherForDay(day: ItineraryDay): ItineraryDayWeather | undefined {
    return weatherByDayId[day.id];
  }

  function dailyWeatherForDay(day: ItineraryDay): DailyWeather | undefined {
    return weatherForDay(day)?.forecast;
  }

  function weatherToneClass(tone: WeatherTone | undefined): string {
    return `zen-weather-tone--${tone ?? 'cloud'}`;
  }

  function weatherTempRange(dayWeather: DailyWeather | undefined): string {
    if (!dayWeather) return 'Live current';

    return `${formatTemp(dayWeather.highF)} / ${formatTemp(dayWeather.lowF)}`;
  }

  function dayWeatherLine(day: ItineraryDay): string {
    const dayWeather = weatherForDay(day);
    const forecast = dayWeather?.forecast;
    const cityWeather = weatherForCity(day.city);

    if (forecast) {
      return `${forecast.summary}, ${weatherTempRange(forecast)}`;
    }

    if (cityWeather?.current) {
      return `${cityWeather.current.summary}, now ${formatTemp(cityWeather.current.temperatureF)}`;
    }

    return weatherLoading ? 'Weather loading' : 'Weather unavailable';
  }

  function weatherUpdatedLabel(): string {
    if (!weatherFetchedAt) return 'Live weather';

    return new Date(weatherFetchedAt).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  async function loadTripWeather(nextDays: ItineraryDay[]) {
    const run = (weatherRequestRun += 1);

    if (!nextDays.length) {
      weatherCities = [];
      weatherByDayId = {};
      weatherError = '';
      weatherFetchedAt = '';
      return;
    }

    weatherLoading = true;
    weatherError = '';

    try {
      const response = await fetch('/api/weather', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          days: nextDays.map((day) => ({
            id: day.id,
            city: day.city,
            date: day.date
          }))
        })
      });
      const payload = (await response.json()) as TripWeatherResponse | { message?: string };

      if (!response.ok || !('cities' in payload)) {
        const message = 'message' in payload ? payload.message : undefined;

        throw new Error(message ?? 'Weather lookup failed.');
      }

      if (run !== weatherRequestRun) return;

      weatherCities = payload.cities;
      weatherByDayId = Object.fromEntries(payload.days.map((day) => [day.dayId, day]));
      weatherFetchedAt = payload.fetchedAt;
    } catch (error) {
      if (run !== weatherRequestRun) return;

      weatherError = error instanceof Error ? error.message : 'Weather lookup failed.';
    } finally {
      if (run === weatherRequestRun) {
        weatherLoading = false;
      }
    }
  }

  function refreshWeather() {
    void loadTripWeather(days);
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
      setupOpen = false;
    } catch (error) {
      savedImportError = error instanceof Error ? error.message : 'Maps list import failed.';
      savedImportStatus = '';
      setupOpen = true;
    } finally {
      importingSavedList = false;
    }
  }

  function useExampleMap() {
    savedListUrl = EXAMPLE_SAVED_LIST_URL;
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
    mapDetailsOpen = false;
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

  function mapPlaceKindLabel(place: MapPlace): string {
    if (place.kind === 'saved') return savedCategoryLabel(place.savedCategory ?? 'other');
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
    const nextDays = days.map((day) => day);

    void loadTripWeather(nextDays);
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
    mapDetailsOpen = false;
  });
</script>

<svelte:head>
  <title>Zen | Travel Planner</title>
  <meta
    name="description"
    content="Zen turns a pasted itinerary and Google Maps link into a live weather, place, and map planner."
  />
</svelte:head>

<div class="zen-shell min-h-screen">
  <div class="zen-page-frame zen-workbench mx-auto min-h-screen px-3 py-3 lg:px-4 lg:py-4">
    <main class="zen-planner-scroll">
      <header class="zen-trip-header">
        <div class="min-w-0">
          <div class="zen-kicker">Zen day planner</div>
          <h1>Japan, at a glance</h1>
          <p>{days.length} days, {tripCities.length} cities, {totalItineraryPlaces} extracted places.</p>
        </div>

        <div class="zen-trip-metrics" aria-label="Trip totals">
          <div>
            <span>Days</span>
            <strong>{days.length}</strong>
          </div>
          <div>
            <span>Eats</span>
            <strong>{totalItineraryFoods}</strong>
          </div>
          <div>
            <span>Stays</span>
            <strong>{totalItineraryStays}</strong>
          </div>
          <div>
            <span>Saved</span>
            <strong>{savedPlaces.length}</strong>
          </div>
        </div>
      </header>

      <section class={`zen-setup-console ${setupOpen ? 'zen-setup-console--open' : ''}`} aria-label="Planner setup">
        <div class="zen-setup-bar">
          <div class="min-w-0">
            <span class="zen-kicker">Setup</span>
            <h2>CSV and Maps are loaded</h2>
          </div>
          <div class="zen-setup-pills" aria-label="Input status">
            <span>{days.length} days</span>
            <span>{totalItineraryPlaces} places</span>
            <span>{savedPlaces.length} saved</span>
          </div>
          <button type="button" class="zen-quiet-button" onclick={() => (setupOpen = !setupOpen)}>
            {setupOpen ? 'Hide inputs' : 'Edit inputs'}
          </button>
        </div>

        {#if setupOpen}
          <div class="zen-setup-drawer">
            <div class="zen-input-deck" aria-label="Planner inputs">
              <div class="zen-input-block zen-input-block--csv">
                <div class="zen-section-head">
                  <div>
                    <span class="zen-kicker">Input 1</span>
                    <h2>CSV itinerary</h2>
                  </div>
                  <button type="button" class="zen-primary-button" onclick={pasteCsv}>Rebuild planner</button>
                </div>
                <textarea
                  bind:value={rawCsv}
                  class="zen-code zen-csv-box"
                  spellcheck="false"
                  aria-label="CSV itinerary paste area"
                ></textarea>
                {#if loadError}
                  <p class="zen-error-line">{loadError}</p>
                {/if}
              </div>

              <div class="zen-input-block zen-input-block--maps">
                <div class="zen-section-head">
                  <div>
                    <span class="zen-kicker">Input 2</span>
                    <h2>Google Maps link</h2>
                  </div>
                  <button type="button" class="zen-quiet-button" onclick={useExampleMap}>Example</button>
                </div>
                <div class="zen-map-import-row">
                  <input
                    id="saved-list-url"
                    bind:value={savedListUrl}
                    class="zen-url-input"
                    placeholder="https://maps.app.goo.gl/..."
                    type="url"
                  />
                  <button
                    type="button"
                    class="zen-primary-button"
                    disabled={importingSavedList}
                    onclick={importSavedList}
                  >
                    {importingSavedList ? 'Importing' : 'Import'}
                  </button>
                </div>

                {#if savedImportStatus}
                  <p class="zen-status-line">{savedImportStatus}</p>
                {/if}
                {#if savedImportError}
                  <p class="zen-error-line">{savedImportError}</p>
                {/if}

                <div class="zen-imported-lists">
                  {#each savedLists as list}
                    <div class="zen-list-row">
                      <div class="min-w-0">
                        <strong>{list.title}</strong>
                        <span>{list.places.length} places</span>
                      </div>
                      <button type="button" class="zen-quiet-button" onclick={() => removeSavedList(list.id)}>
                        Remove
                      </button>
                    </div>
                  {:else}
                    <div class="zen-empty-inline">No Maps list imported yet.</div>
                  {/each}
                </div>
              </div>
            </div>
          </div>
        {/if}
      </section>

      <section class="zen-weather-board">
        <div class="zen-section-head">
          <div>
            <span class="zen-kicker">Live packing layer</span>
            <h2>Weather in every city</h2>
          </div>
          <button type="button" class="zen-quiet-button" disabled={weatherLoading} onclick={refreshWeather}>
            {weatherLoading ? 'Refreshing' : weatherUpdatedLabel()}
          </button>
        </div>

        {#if weatherError}
          <p class="zen-error-line">{weatherError}</p>
        {/if}

        <div class="zen-city-weather-grid">
          {#each tripCities as city}
            {@const cityWeather = weatherForCity(city)}
            {@const cityCurrent = cityWeather?.current}
            <button
              type="button"
              class={`zen-city-weather ${activeDay?.city === city ? 'zen-city-weather--active' : ''} ${weatherToneClass(cityCurrent?.tone)}`}
              onclick={() => selectCity(city)}
            >
              <span class="zen-weather-dot"></span>
              <span class="zen-city-weather__name">{city}</span>
              <strong>{formatTemp(cityCurrent?.temperatureF)}</strong>
              <span>{cityCurrent?.summary ?? (weatherLoading ? 'Loading' : 'No live data')}</span>
              {#if cityWeather?.packingNotes.length}
                <small>{cityWeather.packingNotes.join(', ')}</small>
              {/if}
            </button>
          {/each}
        </div>
      </section>

      <section class="zen-day-strip" aria-label="Itinerary days">
        {#each days as day}
          {@const dayWeather = dailyWeatherForDay(day)}
          <button
            type="button"
            class={`zen-day-ticket ${day.id === activeDay?.id ? 'zen-day-ticket--active' : ''} ${weatherToneClass(dayWeather?.tone ?? weatherForCity(day.city)?.current?.tone)}`}
            onclick={() => selectDay(day.id)}
          >
            <span class="zen-day-ticket__number">Day {day.dayNumber}</span>
            <strong>{day.city}</strong>
            <span>{day.weekday} {day.date}</span>
            <small>{dayWeatherLine(day)}</small>
          </button>
        {/each}
      </section>

      {#if activeDay}
        <section class="zen-glance-grid">
          <article class={`zen-day-glance ${weatherToneClass(activeWeatherTone)}`}>
            <div class="zen-day-glance__copy">
              <span class="zen-kicker">Day {activeDay.dayNumber} / {activeDay.weekday} {activeDay.date}</span>
              <h2>{activeDay.city}</h2>
              <p>{activeDay.theme}</p>
              {#if activeDay.transportation}
                <div class="zen-transit-pill">{activeDay.transportation}</div>
              {/if}
            </div>

            <div class="zen-weather-now">
              <span>{activeDailyWeather?.summary ?? activeCityWeather?.current?.summary ?? 'Weather'}</span>
              <strong>
                {activeDailyWeather
                  ? weatherTempRange(activeDailyWeather)
                  : formatTemp(activeCityWeather?.current?.temperatureF)}
              </strong>
              <div>
                <span>Rain {formatPercent(activeDailyWeather?.precipitationProbability)}</span>
                <span>Wind {activeDailyWeather?.windMph ? `${Math.round(activeDailyWeather.windMph)} mph` : 'n/a'}</span>
                <span>UV {activeDailyWeather?.uvIndex ? Math.round(activeDailyWeather.uvIndex) : 'n/a'}</span>
              </div>
              {#if activeDayWeather?.message}
                <small>{activeDayWeather.message}</small>
              {/if}
            </div>
          </article>

          <aside class="zen-pack-panel">
            <div class="zen-section-head">
              <div>
                <span class="zen-kicker">Pack for {activeDay.city}</span>
                <h2>Bring this</h2>
              </div>
            </div>
            <div class="zen-pack-list">
              {#each activeCityWeather?.packingNotes ?? [] as note}
                <span>{note}</span>
              {:else}
                <span>Check layers</span>
                <span>Comfortable shoes</span>
              {/each}
            </div>
            <dl class="zen-weather-dl">
              <div>
                <dt>Current</dt>
                <dd>{formatTemp(activeCityWeather?.current?.temperatureF)} feels {formatTemp(activeCityWeather?.current?.apparentTemperatureF)}</dd>
              </div>
              <div>
                <dt>Humidity</dt>
                <dd>{formatPercent(activeCityWeather?.current?.relativeHumidity)}</dd>
              </div>
              <div>
                <dt>Precip</dt>
                <dd>{formatInches(activeDailyWeather?.precipitationIn ?? activeCityWeather?.current?.precipitationIn)}</dd>
              </div>
            </dl>
          </aside>
        </section>

        <section class="zen-planning-grid">
          <article class="zen-route-board">
            <div class="zen-section-head">
              <div>
                <span class="zen-kicker">Day at a glance</span>
                <h2>Route rhythm</h2>
              </div>
              <span class="zen-mini-stat">{mapCaption}</span>
            </div>

            <div class="zen-route-list">
              {#each activePlaces as place}
                <button
                  type="button"
                  class={`zen-route-stop ${place.id === activePlace?.id ? 'zen-route-stop--active' : ''}`}
                  onclick={() => selectPlace(place.id)}
                >
                  <span class={`zen-source-dot zen-source-dot--${place.kind}`}></span>
                  <span class="zen-route-stop__order">{place.order}</span>
                  <span class="zen-route-stop__label">{place.label}</span>
                  <span class="zen-route-stop__meta">{kindLabel(place)} / {typeLabelForPlace(place)}</span>
                  <span class={`zen-resolve-dot ${resolvedForPlace(place) ? 'zen-resolve-dot--live' : ''}`}></span>
                </button>
              {:else}
                <div class="zen-empty-inline">No places found for this day.</div>
              {/each}
            </div>
          </article>

          <article class="zen-category-board">
            <div class="zen-section-head">
              <div>
                <span class="zen-kicker">Extracted from CSV</span>
                <h2>Place buckets</h2>
              </div>
            </div>

            <div class="zen-bucket-list">
              {#each placeColumns as source}
                <section class="zen-bucket-group">
                  <div class="zen-bucket-group__head">
                    <strong>{sourceLabel(source)}</strong>
                    <span>{placesBySource(source).length}</span>
                  </div>
                  <div class="zen-bucket-rows">
                    {#each placesBySource(source) as place}
                      <button
                        type="button"
                        class={`zen-bucket-row ${place.id === activePlace?.id ? 'zen-bucket-row--active' : ''}`}
                        onclick={() => selectPlace(place.id)}
                      >
                        <span class={`zen-source-dot zen-source-dot--${place.kind}`}></span>
                        <span>{place.label}</span>
                        <small>{typeLabelForPlace(place)}</small>
                        <span class={`zen-resolve-dot ${resolvedForPlace(place) ? 'zen-resolve-dot--live' : ''}`}></span>
                      </button>
                    {:else}
                      <span class="zen-muted-small">Nothing here.</span>
                    {/each}
                  </div>
                </section>
              {/each}
            </div>
          </article>

          <article class="zen-saved-board">
            <div class="zen-section-head">
              <div>
                <span class="zen-kicker">Near route and stay</span>
                <h2>Saved places</h2>
              </div>
              <span class="zen-mini-stat">{activeLensSavedPlaces.length} shown</span>
            </div>

            {#if easyNextPlaces.length}
              <div class="zen-easy-next">
                <strong>Easy next</strong>
                <div>
                  {#each easyNextPlaces as place}
                    <button
                      type="button"
                      class={`zen-saved-suggestion ${place.id === activeSavedPlace?.id ? 'zen-saved-suggestion--active' : ''}`}
                      onclick={() => selectPlace(place.id)}
                    >
                      <span class={`zen-source-dot zen-source-dot--saved-${place.category}`}></span>
                      <span>{place.label}</span>
                      <small>{formatDistance(place.distanceMeters)}</small>
                    </button>
                  {/each}
                </div>
              </div>
            {/if}

            <div class="zen-saved-categories">
              {#each SAVED_PLACE_CATEGORIES as category}
                {@const categoryPlaces = savedPlacesByCategory(category)}
                {#if categoryPlaces.length}
                  <section>
                    <div>
                      <span class={`zen-source-dot zen-source-dot--saved-${category}`}></span>
                      <strong>{savedCategoryLabel(category)}</strong>
                      <span>{categoryPlaces.length}</span>
                    </div>
                    <div>
                      {#each categoryPlaces.slice(0, 10) as place}
                        <button
                          type="button"
                          class={`zen-source-place ${place.id === activeSavedPlace?.id ? 'zen-source-place--active' : ''}`}
                          onclick={() => selectPlace(place.id)}
                        >
                          <span>{place.label}</span>
                          <small>{formatDistance(place.distanceMeters)}</small>
                        </button>
                      {/each}
                    </div>
                  </section>
                {/if}
              {/each}
              {#if !activeLensSavedPlaces.length}
                <div class="zen-empty-inline">
                  {savedLists.length ? 'No saved pins match this day and lens.' : 'Import the Maps link to unlock saved pins.'}
                </div>
              {/if}
            </div>
          </article>

          <article class="zen-story-board">
            <div class="zen-section-head">
              <div>
                <span class="zen-kicker">Context</span>
                <h2>{activeDayNarrative.headline}</h2>
              </div>
              <button
                type="button"
                class={`zen-quiet-button ${mapLens === 'history' ? 'zen-quiet-button--active' : ''}`}
                onclick={() => (mapLens = 'history')}
              >
                History lens
              </button>
            </div>
            <p>{activeDayNarrative.summary}</p>

            {#if activeDayNarrative.themes.length}
              <div class="zen-story-themes">
                {#each activeDayNarrative.themes as theme}
                  <span>{theme}</span>
                {/each}
              </div>
            {/if}

            {#if activeDayNarrative.historyStops.length}
              <div class="zen-history-mini-grid">
                {#each activeDayNarrative.historyStops.slice(0, 6) as stop}
                  <button
                    type="button"
                    class="zen-history-stop"
                    onclick={() => selectPlace(activePlaces.find((place) => enrichmentKeyForPlace(place) === stop.id)?.id ?? '')}
                  >
                    <span>{stop.label}</span>
                    <small>{stop.history?.headline}</small>
                  </button>
                {/each}
              </div>
            {/if}
          </article>
        </section>
      {:else}
        <section class="zen-panel zen-empty-state">
          Paste itinerary rows to begin.
        </section>
      {/if}
    </main>

    <aside class="zen-map-dock">
      <section class="zen-map-frame">
        <div class="zen-map-stage absolute inset-0">
          <MapCanvas
            places={activeMapPlaces}
            activePlaceId={activeFocusPlace?.id ?? ''}
            onSelectPlace={selectPlace}
          />
        </div>

        <div class="zen-map-fade zen-map-fade--top pointer-events-none absolute inset-x-0 top-0 h-40"></div>
        <div class="zen-map-fade zen-map-fade--bottom pointer-events-none absolute inset-x-0 bottom-0 h-56"></div>

        {#if activeDay}
          <div class="zen-map-toolbar">
            <div class="min-w-0">
              <span>Day {activeDay.dayNumber} / {activeDay.city}</span>
              <strong>{activeDay.theme}</strong>
              <small>{mapCaption}</small>
            </div>
            <div class="zen-map-lenses">
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
          </div>
        {/if}

        {#if activeFocusPlace}
          <div class="zen-map-bottom">
            <div class="zen-place-rail">
              {#each activeMapPlaces as place}
                <button
                  type="button"
                  class={`zen-place-pill ${place.id === activeFocusPlace.id ? 'zen-place-pill--active' : ''}`}
                  onclick={() => selectPlace(place.id)}
                >
                  <span class={`zen-source-dot zen-source-dot--${place.kind === 'saved' ? `saved-${place.savedCategory ?? 'other'}` : place.kind}`}></span>
                  <span class="zen-place-pill__order">{mapPlaceKindLabel(place)}</span>
                  <span class="zen-place-pill__text">{place.label}</span>
                </button>
              {/each}
            </div>

            <article class="zen-selected-dock">
              {#if activeSavedPlace}
                <div class="zen-selected-dock__copy">
                  <span>{kindLabel(activeSavedPlace)}</span>
                  <strong>{activeSavedPlace.label}</strong>
                  <small>
                    {typeLabelForPlace(activeSavedPlace)} /
                    {activeSavedPlace.proximity === 'stay' && activeSavedPlace.stayPlaceLabel
                      ? `${formatDistance(activeSavedPlace.distanceMeters)} from ${activeSavedPlace.stayPlaceLabel}`
                      : `${formatDistance(activeSavedPlace.distanceMeters)} from ${activeSavedPlace.nearestPlaceLabel}`}
                  </small>
                </div>
                <div class="zen-selected-dock__actions">
                  <a class="zen-primary-button" href={mapSearchUrl(activeSavedPlace)} target="_blank" rel="noreferrer">
                    Maps
                  </a>
                  <button type="button" class="zen-quiet-button" onclick={() => (mapDetailsOpen = true)}>
                    Details
                  </button>
                </div>
              {:else if activePlace}
                <div class="zen-selected-dock__copy">
                  <span>{kindLabel(activePlace)}</span>
                  <strong>{activePlace.label}</strong>
                  <small>{typeLabelForPlace(activePlace)} / {activeResolvedPlace?.resolvedLabel ?? activePlace.query}</small>
                </div>
                <div class="zen-selected-dock__actions">
                  <a class="zen-primary-button" href={mapSearchUrl(activePlace)} target="_blank" rel="noreferrer">
                    Maps
                  </a>
                  <button type="button" class="zen-quiet-button" onclick={() => (mapDetailsOpen = true)}>
                    Details
                  </button>
                </div>
              {/if}
            </article>

            {#if mapDetailsOpen}
              <article class="zen-map-inspector">
                <div class="zen-drawer-top">
                  <span class="zen-kicker">Details</span>
                  <button type="button" class="zen-quiet-button" onclick={() => (mapDetailsOpen = false)}>
                    Hide
                  </button>
                </div>

                {#if activeSavedPlace}
                  <div class="zen-inspector-head">
                    <div>
                      <span>{kindLabel(activeSavedPlace)}</span>
                      <h3>{activeSavedPlace.label}</h3>
                      <p>
                        {typeLabelForPlace(activeSavedPlace)} /
                        {activeSavedPlace.proximity === 'stay' && activeSavedPlace.stayPlaceLabel
                          ? `${formatDistance(activeSavedPlace.distanceMeters)} from ${activeSavedPlace.stayPlaceLabel}`
                          : `${formatDistance(activeSavedPlace.distanceMeters)} from ${activeSavedPlace.nearestPlaceLabel}`}
                      </p>
                    </div>
                    <span class={`zen-source-dot zen-source-dot--saved-${activeSavedPlace.category}`}></span>
                  </div>

                  {#if activeSavedPlace.address}
                    <p class="zen-inspector-copy">{activeSavedPlace.address}</p>
                  {/if}
                  {#if activeSavedPlace.note}
                    <p class="zen-inspector-copy">{activeSavedPlace.note}</p>
                  {/if}

                  <div class="zen-token-row">
                    <span>{activeSavedPlace.listTitle}</span>
                    <span>{effortLabel(activeSavedPlace.distanceMeters)}</span>
                  </div>

                  <a class="zen-primary-button" href={mapSearchUrl(activeSavedPlace)} target="_blank" rel="noreferrer">
                    Open in Maps
                  </a>
                {:else if activePlace}
                  <div class="zen-inspector-head">
                    <div>
                      <span>{kindLabel(activePlace)}</span>
                      <h3>{activePlace.label}</h3>
                      <p>{typeLabelForPlace(activePlace)} / {activeResolvedPlace?.resolvedLabel ?? activePlace.query}</p>
                    </div>
                    <span class={`zen-source-dot zen-source-dot--${activePlace.kind}`}></span>
                  </div>

                  {#if activePlace.detail}
                    <p class="zen-inspector-copy">{activePlace.detail}</p>
                  {/if}

                  <div class="zen-token-row">
                    {#each activePlace.sourceColumns as source}
                      <span>{sourceLabel(source)}</span>
                    {/each}
                  </div>

                  <div class="zen-action-row">
                    <a class="zen-primary-button" href={mapSearchUrl(activePlace)} target="_blank" rel="noreferrer">
                      Open in Maps
                    </a>
                    {#if activePlace.sourceUrl}
                      <a class="zen-quiet-button" href={activePlace.sourceUrl} target="_blank" rel="noreferrer">
                        Source
                      </a>
                    {/if}
                  </div>
                {/if}

                {#if activePlaceEnrichment}
                  <div class="zen-enrichment-box">
                    <div class="zen-token-row">
                      <span>{googlePlaceTypeLabel(activePlaceEnrichment.primaryType)}</span>
                      {#if shortPlaceTypes(activePlaceEnrichment.googlePlaceTypes)}
                        <span>{shortPlaceTypes(activePlaceEnrichment.googlePlaceTypes)}</span>
                      {/if}
                    </div>

                    {#if activePlaceEnrichment.history}
                      <div class="zen-history-note">
                        <span>{activePlaceEnrichment.history.era}</span>
                        <strong>{activePlaceEnrichment.history.headline}</strong>
                        <p>{activePlaceEnrichment.history.context}</p>
                      </div>
                    {/if}

                    <label class="zen-note-label" for="enrichment-note">
                      <span>My layer</span>
                      <small>{enrichmentStorageLabel}</small>
                    </label>
                    <textarea
                      id="enrichment-note"
                      bind:value={enrichmentDraft}
                      class="zen-note-box"
                      placeholder="Add booking notes, food targets, or packing reminders."
                    ></textarea>
                    <div class="zen-action-row">
                      <button
                        type="button"
                        class="zen-primary-button"
                        disabled={enrichmentSaving}
                        onclick={saveActiveEnrichmentNote}
                      >
                        {enrichmentSaving ? 'Saving' : 'Save note'}
                      </button>
                      {#if enrichmentStatus}
                        <span class="zen-status-line">{enrichmentStatus}</span>
                      {/if}
                      {#if enrichmentError}
                        <span class="zen-error-line">{enrichmentError}</span>
                      {/if}
                    </div>
                  </div>
                {/if}
              </article>
            {/if}

          </div>
        {/if}
      </section>
    </aside>
  </div>
</div>
