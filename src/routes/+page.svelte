<script lang="ts">
  import Papa from 'papaparse';
  import MapCanvas from '$lib/components/MapCanvas.svelte';
  import { normalizeItinerary } from '$lib/itinerary';
  import { sampleCsv } from '$lib/sample-itinerary';
  import type { ItineraryDay, PlaceCandidate, PlaceSource, ResolvedPlace } from '$lib/types';

  type DetailPanel = 'status' | 'sources' | 'transit' | 'csv' | null;

  const placeColumns: PlaceSource[] = [
    'Ideas',
    'Must Eats',
    'Transportation',
    'Comments',
    'Notes/Bookings'
  ];

  const initialDays = normalizeCsv(sampleCsv);

  let rawCsv = $state(sampleCsv);
  let days = $state<ItineraryDay[]>(initialDays);
  let activeDayId = $state(initialDays[0]?.id ?? '');
  let activePlaceId = $state(initialDays[0]?.places[0]?.id ?? '');
  let loadError = $state('');
  let uploadName = $state('Japan 2026 itinerary');
  let copiedDayId = $state('');
  let resolvedByDay = $state<Record<string, ResolvedPlace[]>>({});
  let resolutionErrors = $state<Record<string, string>>({});
  let loadingDayIds = $state<Record<string, boolean>>({});
  let activePanel = $state<DetailPanel>(null);

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
  let activePlace = $derived(
    activePlaces.find((place) => place.id === activePlaceId) ?? activePlaces[0]
  );
  let activeResolvedPlace = $derived(
    activeResolvedPlaces.find((place) => place.id === activePlace?.id)
  );
  let isActiveDayLoading = $derived(Boolean(loadingDayIds[activeDay?.id ?? '']));
  let noteItems = $derived(
    (activeDay?.notes ?? '')
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean)
  );
  let mapStatus = $derived(
    resolutionErrors[activeDay?.id ?? ''] ||
      (isActiveDayLoading
        ? 'Resolving physical pins.'
        : activeResolvedPlaces.length
          ? `${activeResolvedPlaces.length} of ${activePlaces.length} places mapped`
          : 'No pins resolved yet.')
  );

  async function resolvePlaces(day: ItineraryDay) {
    if (resolvedByDay[day.id] || loadingDayIds[day.id]) return;

    loadingDayIds = { ...loadingDayIds, [day.id]: true };
    resolutionErrors = { ...resolutionErrors, [day.id]: '' };

    const candidates = day.places.slice(0, 20);

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
          [day.id]: 'No precise pins yet. Add a Google Maps link beside a place for exact placement.'
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

  async function copyPhrases(phrases: string[]) {
    await navigator.clipboard.writeText(phrases.join('\n'));
    copiedDayId = activeDay?.id ?? '';
    window.setTimeout(() => {
      if (copiedDayId === activeDay?.id) {
        copiedDayId = '';
      }
    }, 1600);
  }

  function selectPlace(placeId: string) {
    activePlaceId = placeId;
  }

  function togglePanel(panel: Exclude<DetailPanel, null>) {
    activePanel = activePanel === panel ? null : panel;
  }

  function placesBySource(source: PlaceSource): PlaceCandidate[] {
    return activePlaces.filter((place) => place.sourceColumns.includes(source));
  }

  function resolvedForPlace(place: PlaceCandidate): ResolvedPlace | undefined {
    return activeResolvedPlaces.find((resolved) => resolved.id === place.id);
  }

  function mapSearchUrl(place: PlaceCandidate): string {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.query)}`;
  }

  function kindLabel(place: PlaceCandidate): string {
    if (place.kind === 'food') return 'Food';
    if (place.kind === 'transit') return 'Transit';
    if (place.kind === 'comment') return 'Comment';
    if (place.kind === 'booking') return 'Booking';

    return 'Idea';
  }

  function confidenceLabel(place: PlaceCandidate): string {
    if (place.confidence === 'inferred') return 'Inferred';
    if (place.confidence === 'area') return 'Area';
    if (place.confidence === 'search') return 'Search';

    return 'Named';
  }

  function transportLabel(transport: string) {
    const value = transport.toLowerCase();

    if (value.includes('flight')) return 'Flight';
    if (value.includes('shinkansen')) return 'Bullet train';
    if (value.includes('express') || value.includes('train')) return 'Rail';
    if (value.includes('ferry')) return 'Ferry';
    if (value.includes('car')) return 'Drive';
    if (value.includes('bus')) return 'Bus';
    if (value.includes('walk')) return 'Walk';

    return 'Transit';
  }

  function panelButtonClass(panel: Exclude<DetailPanel, null>) {
    return `zen-map-chip ${activePanel === panel ? 'zen-map-chip--active' : ''}`;
  }

  $effect(() => {
    if (activeDay) {
      void resolvePlaces(activeDay);
    }
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
  <div class="zen-page-frame mx-auto grid min-h-screen gap-4 px-3 py-3 lg:grid-cols-[23rem_minmax(0,1fr)] lg:px-4 lg:py-4">
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
                CSV days become mapped place pages.
              </p>
            </div>
            <div class="shrink-0 rounded-md border border-[var(--line)] bg-[var(--panel-strong)] px-2.5 py-2 text-right">
              <div class="text-[10px] uppercase tracking-[0.14em] text-[var(--text-soft)]">Days</div>
              <div class="mt-1 text-[1rem] font-semibold">{days.length}</div>
            </div>
          </div>

          <div class="mt-4 flex gap-2">
            <label
              class="inline-flex flex-1 cursor-pointer items-center justify-center rounded-md border border-[var(--line-strong)] bg-[var(--text-main)] px-3 py-2.5 text-[12px] font-semibold text-[var(--panel-strong)] transition hover:bg-[var(--ink-hover)]"
            >
              Upload CSV
              <input class="hidden" type="file" accept=".csv,text/csv" onchange={onUpload} />
            </label>
            <button
              type="button"
              class="inline-flex items-center justify-center rounded-md border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2.5 text-[12px] font-semibold transition hover:border-[var(--line-strong)] hover:bg-[var(--bg-0)]"
              onclick={() => togglePanel('csv')}
            >
              CSV
            </button>
          </div>
          <div class="mt-3 max-w-full truncate text-[11px] text-[var(--text-muted)]">{uploadName}</div>
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
                class={`rounded-md border px-3 py-3 text-left transition ${
                  day.id === activeDay?.id
                    ? 'border-[var(--line-strong)] bg-[var(--panel-strong)] shadow-sm'
                    : 'border-transparent bg-transparent hover:border-[var(--line)] hover:bg-[var(--panel-strong)]'
                }`}
                onclick={() => selectDay(day.id)}
              >
                <div class="flex items-center justify-between gap-3">
                  <div class="min-w-0">
                    <div class="flex min-w-0 items-center gap-2">
                      <span class="shrink-0 text-[12px] font-semibold">Day {day.dayNumber}</span>
                      <span class="truncate text-[11px] uppercase tracking-[0.12em] text-[var(--text-soft)]">
                        {day.weekday}
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
              places={activeResolvedPlaces}
              activePlaceId={activePlace?.id ?? ''}
              onSelectPlace={selectPlace}
            />
          </div>

          <div class="zen-map-fade zen-map-fade--top pointer-events-none absolute inset-x-0 top-0 h-40"></div>
          <div class="zen-map-fade zen-map-fade--bottom pointer-events-none absolute inset-x-0 bottom-0 h-56"></div>

          <div class="pointer-events-none absolute left-3 right-3 top-3 z-10 flex flex-col gap-3 sm:left-4 sm:right-4">
            <div class="pointer-events-auto flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div class="zen-map-title max-w-full rounded-lg border border-[var(--line)] bg-[var(--panel-strong)]/92 px-4 py-3 shadow-[var(--shadow-panel)] backdrop-blur">
                <div class="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-soft)]">
                  <span>Day {activeDay.dayNumber}</span>
                  <span>{activeDay.date}</span>
                  <span>{activeDay.weekday}</span>
                  <span>{activeResolvedPlaces.length}/{activePlaces.length} mapped</span>
                </div>
                <div class="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
                  <h2 class="text-[1.65rem] font-semibold leading-none">{activeDay.city}</h2>
                  <p class="max-w-[48rem] text-[13px] leading-5 text-[var(--text-muted)]">{activeDay.theme}</p>
                </div>
              </div>

              <div class="flex flex-wrap gap-2">
                <button type="button" class={panelButtonClass('status')} onclick={() => togglePanel('status')}>
                  Status
                </button>
                <button type="button" class={panelButtonClass('sources')} onclick={() => togglePanel('sources')}>
                  Sources
                </button>
                <button type="button" class={panelButtonClass('transit')} onclick={() => togglePanel('transit')}>
                  Transit
                </button>
              </div>
            </div>

            {#if activePanel}
              <div class="pointer-events-auto w-full max-w-[30rem] rounded-lg border border-[var(--line)] bg-[var(--panel-strong)]/96 p-4 shadow-[var(--shadow-panel)] backdrop-blur xl:ml-auto">
                <div class="flex items-start justify-between gap-4">
                  <div class="min-w-0 flex-1">
                    <div class="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-soft)]">
                      {activePanel}
                    </div>
                    {#if activePanel === 'status'}
                      <p class="mt-2 text-[14px] font-medium leading-6">{mapStatus}</p>
                      <div class="mt-3 grid gap-1.5">
                        {#each activePlaces.filter((place) => !resolvedForPlace(place)).slice(0, 5) as place}
                          <div class="rounded-md border border-[var(--line)] bg-[var(--bg-0)] px-3 py-2 text-[12px] text-[var(--text-muted)]">
                            {place.label}
                          </div>
                        {/each}
                      </div>
                    {:else if activePanel === 'sources'}
                      <div class="mt-3 grid gap-2">
                        {#each placeColumns as source}
                          <div class="flex items-center justify-between rounded-md border border-[var(--line)] bg-[var(--bg-0)] px-3 py-2 text-[12px]">
                            <span class="font-medium">{source}</span>
                            <span class="text-[var(--text-muted)]">{placesBySource(source).length}</span>
                          </div>
                        {/each}
                      </div>
                    {:else if activePanel === 'transit'}
                      <p class="mt-2 text-[14px] font-semibold">{transportLabel(activeDay.transportation)}</p>
                      <p class="mt-2 text-[12px] leading-5 text-[var(--text-muted)]">{activeDay.transportation}</p>
                    {:else if activePanel === 'csv'}
                      <textarea
                        bind:value={rawCsv}
                        class="zen-code mt-3 h-[19rem] w-full rounded-md border border-[var(--line)] bg-[var(--bg-0)] px-3 py-3 text-[12px] leading-6 text-[var(--text-main)]"
                      ></textarea>
                      <button
                        type="button"
                        class="mt-3 rounded-md border border-[var(--line-strong)] bg-[var(--text-main)] px-3 py-2 text-[12px] font-semibold text-[var(--panel-strong)] transition hover:bg-[var(--ink-hover)]"
                        onclick={pasteCsv}
                      >
                        Rebuild itinerary
                      </button>
                      {#if loadError}
                        <p class="mt-3 text-[12px] text-[var(--accent-coral)]">{loadError}</p>
                      {/if}
                    {/if}
                  </div>
                  <button
                    type="button"
                    class="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-[var(--line)] bg-[var(--panel-strong)] text-[14px] font-semibold transition hover:bg-[var(--bg-0)]"
                    aria-label="Close panel"
                    onclick={() => (activePanel = null)}
                  >
                    x
                  </button>
                </div>
              </div>
            {/if}
          </div>

          {#if activePlace}
            <div class="pointer-events-none absolute bottom-3 left-3 right-3 z-10 grid gap-3 xl:grid-cols-[minmax(0,1fr)_24rem]">
              <div class="pointer-events-auto min-w-0 rounded-lg border border-[var(--line)] bg-[var(--panel-strong)]/94 p-2 shadow-[var(--shadow-panel)] backdrop-blur">
                <div class="zen-place-rail flex gap-2 overflow-x-auto pb-1">
                  {#each activePlaces as place}
                    <button
                      type="button"
                      class={`zen-place-pill ${place.id === activePlace.id ? 'zen-place-pill--active' : ''}`}
                      onclick={() => selectPlace(place.id)}
                    >
                      <span class={`zen-source-dot zen-source-dot--${place.kind}`}></span>
                      <span class="zen-place-pill__order">{place.order}</span>
                      <span class="zen-place-pill__text">{place.label}</span>
                      <span
                        class={`zen-resolve-dot ${resolvedForPlace(place) ? 'zen-resolve-dot--live' : ''}`}
                      ></span>
                    </button>
                  {/each}
                </div>
              </div>

              <article class="pointer-events-auto rounded-lg border border-[var(--line)] bg-[var(--panel-strong)]/96 p-4 shadow-[var(--shadow-panel)] backdrop-blur">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-1.5">
                      {#each activePlace.sourceColumns as source}
                        <span class="rounded-full border border-[var(--line)] bg-[var(--bg-0)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-soft)]">
                          {source}
                        </span>
                      {/each}
                    </div>
                    <h3 class="mt-2 text-[1.1rem] font-semibold leading-tight">{activePlace.label}</h3>
                    <p class="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">
                      {activeResolvedPlace?.resolvedLabel ?? activePlace.query}
                    </p>
                  </div>
                  <span class={`zen-source-dot zen-source-dot--${activePlace.kind} mt-1`}></span>
                </div>

                <div class="mt-3 flex flex-wrap gap-2 text-[11px]">
                  <span class="rounded-md border border-[var(--line)] bg-[var(--bg-0)] px-2 py-1 text-[var(--text-muted)]">
                    {kindLabel(activePlace)}
                  </span>
                  <span class="rounded-md border border-[var(--line)] bg-[var(--bg-0)] px-2 py-1 text-[var(--text-muted)]">
                    {confidenceLabel(activePlace)}
                  </span>
                  <span class="rounded-md border border-[var(--line)] bg-[var(--bg-0)] px-2 py-1 text-[var(--text-muted)]">
                    {activeResolvedPlace?.source ?? 'pending'}
                  </span>
                </div>

                {#if activePlace.detail}
                  <p class="mt-3 text-[12px] leading-5 text-[var(--text-muted)]">{activePlace.detail}</p>
                {/if}

                <div class="mt-3 grid gap-1.5">
                  {#each activePlace.sourceTexts.slice(0, 3) as sourceText}
                    <div class="rounded-md border border-[var(--line)] bg-[var(--bg-0)] px-3 py-2 text-[12px] leading-5 text-[var(--text-muted)]">
                      {sourceText}
                    </div>
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
              </article>
            </div>
          {/if}
        </section>

        <section class="grid gap-4 xl:grid-cols-[minmax(0,1.12fr)_minmax(18rem,0.88fr)]">
          <article class="zen-panel rounded-lg p-4">
            <div class="flex items-center justify-between border-b border-[var(--line)] px-1 pb-3">
              <h3 class="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-soft)]">
                Source Columns
              </h3>
              <span class="text-[11px] text-[var(--text-muted)]">{activePlaces.length} places</span>
            </div>

            <div class="mt-3 grid gap-3">
              {#each placeColumns as source}
                {#if placesBySource(source).length}
                  <section class="zen-source-band rounded-lg border border-[var(--line)] bg-[var(--panel-strong)] p-3">
                    <div class="flex items-center justify-between gap-3">
                      <h4 class="text-[12px] font-semibold">{source}</h4>
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
                      {/each}
                    </div>
                  </section>
                {/if}
              {/each}
            </div>
          </article>

          <article class="zen-panel rounded-lg p-4">
            <div class="flex items-center justify-between border-b border-[var(--line)] px-1 pb-3">
              <h3 class="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-soft)]">
                Day Brief
              </h3>
              <button
                type="button"
                class="rounded-md border border-[var(--line-strong)] bg-[var(--panel-strong)] px-3 py-1.5 text-[11px] font-semibold text-[var(--text-main)] transition hover:bg-[var(--bg-0)]"
                onclick={() => copyPhrases(activeDay.phrases)}
              >
                {copiedDayId === activeDay.id ? 'Copied' : 'Copy'}
              </button>
            </div>

            <div class="mt-3 grid gap-3">
              <div class="rounded-md border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2.5">
                <div class="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-soft)]">
                  {transportLabel(activeDay.transportation)}
                </div>
                <p class="mt-1 text-[13px] leading-5 text-[var(--text-muted)]">{activeDay.transportation}</p>
              </div>

              {#if activeDay.comments}
                <div class="rounded-md border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2.5">
                  <div class="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-soft)]">
                    Comments
                  </div>
                  <p class="mt-1 text-[13px] leading-5 text-[var(--text-muted)]">{activeDay.comments}</p>
                </div>
              {/if}

              {#if noteItems.length}
                <div class="grid gap-2">
                  {#each noteItems as note}
                    <div class="rounded-md border border-[var(--line)] bg-[var(--bg-0)] px-3 py-2 text-[12px] leading-5 text-[var(--text-muted)]">
                      {note}
                    </div>
                  {/each}
                </div>
              {/if}

              <div class="grid gap-2">
                {#each activeDay.phrases as phrase}
                  <div class="zen-code rounded-md border border-[var(--line)] bg-[var(--bg-0)] px-3 py-2.5 text-[12px]">
                    {phrase}
                  </div>
                {/each}
              </div>
            </div>
          </article>
        </section>
      {:else}
        <div class="zen-panel flex flex-1 items-center justify-center rounded-lg px-6 text-center text-[var(--text-muted)]">
          Upload or paste a CSV to begin.
        </div>
      {/if}
    </main>
  </div>
</div>
