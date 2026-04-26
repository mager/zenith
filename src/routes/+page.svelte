<script lang="ts">
  import Papa from 'papaparse';
  import MapCanvas from '$lib/components/MapCanvas.svelte';
  import { normalizeItinerary } from '$lib/itinerary';
  import { sampleCsv } from '$lib/sample-itinerary';
  import type { ItineraryDay, ResolvedPlace } from '$lib/types';

  type DetailPanel = 'status' | 'transit' | 'day' | 'notes' | 'csv' | null;

  const initialDays = normalizeCsv(sampleCsv);

  let rawCsv = $state(sampleCsv);
  let days = $state<ItineraryDay[]>(initialDays);
  let activeDayId = $state(initialDays[0]?.id ?? '');
  let isLoadingMap = $state(false);
  let loadError = $state('');
  let uploadName = $state('Japan 2026 itinerary');
  let copiedDayId = $state('');
  let resolvedByDay = $state<Record<string, ResolvedPlace[]>>({});
  let resolutionErrors = $state<Record<string, string>>({});
  let activePanel = $state<DetailPanel>(null);
  let expandedTimeline = $state<Record<string, boolean>>({});

  function normalizeCsv(text: string): ItineraryDay[] {
    const parsed = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true
    });

    return normalizeItinerary(parsed.data);
  }

  let activeDay = $derived(days.find((day) => day.id === activeDayId) ?? days[0]);
  let activeResolvedPlaces = $derived(resolvedByDay[activeDay?.id ?? ''] ?? []);
  let allStops = $derived([...(activeDay?.activities ?? []), ...(activeDay?.foods ?? [])]);
  let noteItems = $derived(
    (activeDay?.notes ?? '')
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean)
  );
  let mapStatus = $derived(
    resolutionErrors[activeDay?.id ?? ''] ??
      (activeResolvedPlaces.length
        ? `${activeResolvedPlaces.length} pins live`
        : 'Pins resolve from Google Maps links first, then place-name search.')
  );

  async function resolvePlaces(day: ItineraryDay) {
    if (resolvedByDay[day.id] || isLoadingMap) return;

    isLoadingMap = true;
    resolutionErrors = { ...resolutionErrors, [day.id]: '' };

    const candidates = [...day.activities, ...day.foods].slice(0, 8);

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
            sourceUrl: candidate.sourceUrl
          }))
        )
      });

      if (!response.ok) {
        throw new Error('Place resolution failed.');
      }

      const resolved = (await response.json()) as Array<{
        lat: number;
        lng: number;
        source: 'google-link' | 'nominatim';
        resolvedLabel?: string;
      } | null>;

      const mapped = resolved.flatMap((result, index) =>
        result ? [{ ...candidates[index], ...result }] : []
      );

      resolvedByDay = { ...resolvedByDay, [day.id]: mapped };

      if (!mapped.length) {
        resolutionErrors = {
          ...resolutionErrors,
          [day.id]: 'No precise pins yet. Drop Google Maps links into the CSV for exact placement.'
        };
      }
    } catch (error) {
      resolutionErrors = {
        ...resolutionErrors,
        [day.id]: error instanceof Error ? error.message : 'Map resolution failed.'
      };
    } finally {
      isLoadingMap = false;
    }
  }

  function selectDay(dayId: string) {
    activeDayId = dayId;
    activePanel = null;
    expandedTimeline = {};

    const nextDay = days.find((day) => day.id === dayId);
    if (nextDay) {
      void resolvePlaces(nextDay);
    }
  }

  async function onUpload(event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    uploadName = file.name;
    rawCsv = await file.text();
    const parsedDays = normalizeCsv(rawCsv);
    days = parsedDays;
    activeDayId = parsedDays[0]?.id ?? '';
    resolvedByDay = {};
    resolutionErrors = {};
    expandedTimeline = {};
    activePanel = null;
    loadError = parsedDays.length ? '' : 'No itinerary rows found in that CSV.';

    if (parsedDays[0]) {
      void resolvePlaces(parsedDays[0]);
    }
  }

  async function pasteCsv() {
    const parsedDays = normalizeCsv(rawCsv);
    days = parsedDays;
    activeDayId = parsedDays[0]?.id ?? '';
    resolvedByDay = {};
    resolutionErrors = {};
    expandedTimeline = {};
    activePanel = null;
    loadError = parsedDays.length ? '' : 'No itinerary rows found in the pasted CSV.';

    if (parsedDays[0]) {
      void resolvePlaces(parsedDays[0]);
    }
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

  function togglePanel(panel: Exclude<DetailPanel, null>) {
    activePanel = activePanel === panel ? null : panel;
  }

  function toggleTimeline(itemId: string) {
    expandedTimeline = { ...expandedTimeline, [itemId]: !expandedTimeline[itemId] };
  }

  function transportIcon(transport: string) {
    const value = transport.toLowerCase();

    if (value.includes('flight')) return 'flight';
    if (value.includes('shinkansen')) return 'shinkansen';
    if (value.includes('express') || value.includes('train')) return 'rail';
    if (value.includes('ferry')) return 'ferry';
    if (value.includes('car')) return 'drive';
    if (value.includes('bus')) return 'bus';
    if (value.includes('walk')) return 'walk';

    return 'move';
  }

  function transportLabel(transport: string) {
    const icon = transportIcon(transport);

    if (icon === 'flight') return 'Takeoff';
    if (icon === 'shinkansen') return 'Bullet Train';
    if (icon === 'rail') return 'Rail';
    if (icon === 'ferry') return 'Ferry';
    if (icon === 'drive') return 'Drive';
    if (icon === 'bus') return 'Bus';
    if (icon === 'walk') return 'Walk';

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
  <div class="zen-page-frame mx-auto grid min-h-screen gap-4 px-3 py-3 lg:grid-cols-[22rem_minmax(0,1fr)] lg:px-4 lg:py-4">
    <aside class="zen-sidebar min-h-0 lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)]">
      <section class="zen-panel flex h-full min-h-0 flex-col rounded-lg">
        <div class="border-b border-[var(--line)] p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-soft)]">
                Zen
              </p>
              <h1 class="mt-2 text-[1.3rem] font-semibold leading-tight">Japan itinerary planner</h1>
              <p class="mt-2 text-[13px] leading-5 text-[var(--text-muted)]">
                Map-first day planning from a CSV itinerary.
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
                  <div class="shrink-0 text-[11px] text-[var(--text-muted)]">
                    {day.activities.length + day.foods.length}
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
        <section class="zen-map-stage relative min-h-[72vh] overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--bg-2)] shadow-[var(--shadow-panel)] lg:min-h-[calc(100vh-2rem)]">
          <div class="absolute inset-0">
            <MapCanvas places={activeResolvedPlaces} />
          </div>

          <div class="pointer-events-none absolute inset-x-0 top-0 h-36 bg-[linear-gradient(180deg,rgba(247,247,244,0.9),rgba(247,247,244,0))]"></div>

          <div class="pointer-events-none absolute left-3 right-3 top-3 z-10 flex flex-col gap-3 sm:left-4 sm:right-4">
            <div class="pointer-events-auto flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div class="zen-map-title max-w-full rounded-lg border border-[var(--line)] bg-[var(--panel-strong)]/90 px-4 py-3 shadow-[var(--shadow-panel)] backdrop-blur">
                <div class="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-soft)]">
                  <span>Day {activeDay.dayNumber}</span>
                  <span>{activeDay.date}</span>
                  <span>{activeDay.weekday}</span>
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
                <button type="button" class={panelButtonClass('transit')} onclick={() => togglePanel('transit')}>
                  Transit
                </button>
                <button type="button" class={panelButtonClass('day')} onclick={() => togglePanel('day')}>
                  Active Day
                </button>
                <button type="button" class={panelButtonClass('notes')} onclick={() => togglePanel('notes')}>
                  Notes
                </button>
              </div>
            </div>

            {#if activePanel}
              <div class="pointer-events-auto w-full max-w-[27rem] rounded-lg border border-[var(--line)] bg-[var(--panel-strong)]/95 p-4 shadow-[var(--shadow-panel)] backdrop-blur xl:ml-auto">
                <div class="flex items-start justify-between gap-4">
                  <div>
                    <div class="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-soft)]">
                      {activePanel}
                    </div>
                    {#if activePanel === 'status'}
                      <p class="mt-2 text-[14px] font-medium leading-6">{mapStatus}</p>
                      <p class="mt-2 text-[12px] leading-5 text-[var(--text-muted)]">
                        {isLoadingMap ? 'Resolving places now.' : `${activeResolvedPlaces.length} mapped of ${allStops.length} itinerary items.`}
                      </p>
                    {:else if activePanel === 'transit'}
                      <p class="mt-2 text-[14px] font-semibold">{transportLabel(activeDay.transportation)}</p>
                      <p class="mt-2 text-[12px] leading-5 text-[var(--text-muted)]">{activeDay.transportation}</p>
                    {:else if activePanel === 'day'}
                      <p class="mt-2 text-[14px] font-semibold">
                        {activeDay.activities.length} stops, {activeDay.foods.length} food anchors
                      </p>
                      <div class="mt-3 flex flex-wrap gap-2">
                        {#each activeDay.activities.slice(0, 5) as item}
                          <span class="rounded-md border border-[var(--line)] bg-[var(--bg-0)] px-2.5 py-1 text-[12px] text-[var(--text-muted)]">
                            {item.order}. {item.label}
                          </span>
                        {/each}
                      </div>
                    {:else if activePanel === 'notes'}
                      <div class="mt-3 grid gap-2">
                        {#each noteItems as note}
                          <div class="rounded-md border border-[var(--line)] bg-[var(--bg-0)] px-3 py-2 text-[12px] leading-5 text-[var(--text-muted)]">
                            {note}
                          </div>
                        {/each}
                      </div>
                    {:else if activePanel === 'csv'}
                      <textarea
                        bind:value={rawCsv}
                        class="zen-code mt-3 h-[18rem] w-full rounded-md border border-[var(--line)] bg-[var(--bg-0)] px-3 py-3 text-[12px] leading-6 text-[var(--text-main)]"
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
        </section>

        <section class="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
          <article class="zen-panel rounded-lg p-4">
            <div class="flex items-center justify-between border-b border-[var(--line)] px-1 pb-3">
              <h3 class="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-soft)]">
                Timeline
              </h3>
              <span class="text-[11px] text-[var(--text-muted)]">{activeDay.activities.length} stops</span>
            </div>

            <div class="mt-3 grid gap-1.5">
              {#each activeDay.activities as item}
                <div class="rounded-md border border-[var(--line)] bg-[var(--panel-strong)]">
                  <button
                    type="button"
                    class="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-[var(--bg-0)]"
                    onclick={() => toggleTimeline(item.id)}
                    aria-expanded={expandedTimeline[item.id] ? 'true' : 'false'}
                  >
                    <span class="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[var(--line)] bg-[var(--bg-0)] text-[12px] font-semibold text-[var(--text-muted)]">
                      {item.order}
                    </span>
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-[14px] font-semibold">{item.label}</span>
                      <span class="block truncate text-[12px] text-[var(--text-muted)]">{item.query}</span>
                    </span>
                    <span class="text-[13px] font-semibold text-[var(--text-soft)]">
                      {expandedTimeline[item.id] ? '-' : '+'}
                    </span>
                  </button>

                  {#if expandedTimeline[item.id]}
                    <div class="border-t border-[var(--line)] px-3 py-3">
                      <p class="text-[12px] leading-5 text-[var(--text-muted)]">{item.query}</p>
                      {#if item.sourceUrl}
                        <a
                          class="mt-3 inline-flex rounded-md border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-1.5 text-[11px] font-medium text-[var(--text-muted)] transition hover:border-[var(--line-strong)] hover:bg-[var(--bg-0)]"
                          href={item.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open source map link
                        </a>
                      {/if}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          </article>

          <article class="zen-panel rounded-lg p-4">
            <div class="flex items-center justify-between border-b border-[var(--line)] px-1 pb-3">
              <h3 class="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-soft)]">
                Food + Phrases
              </h3>
              <button
                type="button"
                class="rounded-md border border-[var(--line-strong)] bg-[var(--panel-strong)] px-3 py-1.5 text-[11px] font-semibold text-[var(--text-main)] transition hover:bg-[var(--bg-0)]"
                onclick={() => copyPhrases(activeDay.phrases)}
              >
                {copiedDayId === activeDay.id ? 'Copied' : 'Copy'}
              </button>
            </div>

            <div class="mt-3 grid gap-2">
              {#each activeDay.foods as item}
                <div class="rounded-md border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2.5">
                  <div class="flex items-center justify-between gap-3">
                    <div class="min-w-0">
                      <div class="truncate text-[14px] font-semibold">{item.label}</div>
                      <div class="mt-1 truncate text-[12px] text-[var(--text-muted)]">{item.query}</div>
                    </div>
                    <span class="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[var(--line)] bg-[var(--bg-0)] text-[13px] font-semibold text-[var(--text-muted)]">
                      +
                    </span>
                  </div>
                </div>
              {/each}
            </div>

            <div class="mt-4 grid gap-2">
              {#each activeDay.phrases as phrase}
                <div class="zen-code rounded-md border border-[var(--line)] bg-[var(--bg-0)] px-3 py-2.5 text-[12px]">
                  {phrase}
                </div>
              {/each}
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
