<script lang="ts">
  import Papa from 'papaparse';
  import MapCanvas from '$lib/components/MapCanvas.svelte';
  import { normalizeItinerary } from '$lib/itinerary';
  import { sampleCsv } from '$lib/sample-itinerary';
  import type { ItineraryDay, PlaceCandidate, ResolvedPlace } from '$lib/types';

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

  function normalizeCsv(text: string): ItineraryDay[] {
    const parsed = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true
    });

    return normalizeItinerary(parsed.data);
  }

  let activeDay = $derived(days.find((day) => day.id === activeDayId) ?? days[0]);
  let activeResolvedPlaces = $derived(resolvedByDay[activeDay?.id ?? ''] ?? []);
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

  function cardTone(kind: PlaceCandidate['kind']) {
    return kind === 'food' ? 'border-[var(--line)] bg-white' : 'border-[var(--line)] bg-white';
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
  <div class="zen-page-frame mx-auto flex min-h-screen flex-col gap-5 px-4 py-4 lg:flex-row lg:px-5 lg:py-5">
    <aside class="zen-column order-2 flex w-full flex-col gap-4 lg:order-1 lg:w-[24rem] lg:shrink-0">
      <section class="zen-panel rounded-lg p-5">
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-soft)]">
              Zen
            </p>
            <h1 class="mt-3 text-[1.65rem] font-semibold leading-tight">
              Japan itinerary planner
            </h1>
            <p class="mt-3 max-w-[28ch] text-[14px] leading-6 text-[var(--text-muted)]">
              Import a CSV, switch days, and keep route details in one clean map view.
            </p>
          </div>
          <div class="rounded-md border border-[var(--line)] bg-white px-3 py-2 text-right">
            <div class="text-[10px] uppercase tracking-[0.16em] text-[var(--text-soft)]">Dataset</div>
            <div class="mt-2 max-w-[9rem] truncate text-[12px] font-medium">
              {uploadName}
            </div>
          </div>
        </div>

        <div class="mt-5 grid grid-cols-3 gap-3">
          <div class="rounded-md border border-[var(--line)] bg-white px-3 py-3">
            <div class="text-[10px] uppercase tracking-[0.14em] text-[var(--text-soft)]">Days</div>
            <div class="mt-2 text-[1.1rem] font-semibold">{days.length}</div>
          </div>
          <div class="rounded-md border border-[var(--line)] bg-white px-3 py-3">
            <div class="text-[10px] uppercase tracking-[0.14em] text-[var(--text-soft)]">Stops</div>
            <div class="mt-2 text-[1.1rem] font-semibold">{activeDay?.activities.length ?? 0}</div>
          </div>
          <div class="rounded-md border border-[var(--line)] bg-white px-3 py-3">
            <div class="text-[10px] uppercase tracking-[0.14em] text-[var(--text-soft)]">Foods</div>
            <div class="mt-2 text-[1.1rem] font-semibold">{activeDay?.foods.length ?? 0}</div>
          </div>
        </div>

        <div class="mt-5 grid gap-2">
          <label
            class="flex cursor-pointer items-center justify-between rounded-md border border-[var(--line-strong)] bg-[var(--text-main)] px-4 py-3 text-[13px] font-semibold text-white transition hover:bg-black"
          >
            <span>Upload fresh CSV</span>
            <span class="text-[11px] uppercase tracking-[0.14em] text-white/70">Local</span>
            <input class="hidden" type="file" accept=".csv,text/csv" onchange={onUpload} />
          </label>
          <button
            type="button"
            class="rounded-md border border-[var(--line)] bg-white px-4 py-3 text-left text-[13px] font-medium transition hover:border-[var(--line-strong)]"
            onclick={pasteCsv}
          >
            Rebuild from editor text
          </button>
        </div>
      </section>

      <section class="zen-panel rounded-lg p-4">
        <div class="flex items-center justify-between px-1 pb-3">
          <h2 class="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-soft)]">
            Days
          </h2>
          <span class="text-[11px] text-[var(--text-muted)]">{days.length} loaded</span>
        </div>

        <div class="grid max-h-[34vh] gap-2 overflow-auto pr-1 lg:max-h-[40vh]">
          {#each days as day}
            <button
              type="button"
              class={`rounded-md border px-4 py-4 text-left transition ${
                day.id === activeDay?.id
                  ? 'border-[var(--line-strong)] bg-white shadow-sm'
                  : 'border-[var(--line)] bg-transparent hover:bg-white'
              }`}
              onclick={() => selectDay(day.id)}
            >
              <div class="flex items-start justify-between gap-3">
                <div>
                  <div class="flex items-center gap-2">
                    <span class="text-[13px] font-semibold">{day.city}</span>
                    <span class="text-[10px] uppercase tracking-[0.14em] text-[var(--text-soft)]">
                      {day.weekday}
                    </span>
                  </div>
                  <div class="mt-2 text-[15px] font-medium leading-5">{day.theme}</div>
                </div>
                <div class="rounded-md border border-[var(--line)] bg-[var(--bg-0)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--text-muted)]">
                  {day.dayNumber}
                </div>
              </div>
              <div class="mt-3 flex items-center justify-between gap-4 text-[12px] text-[var(--text-muted)]">
                <span>{day.date}</span>
                <span>{day.activities.length + day.foods.length} pins</span>
              </div>
            </button>
          {/each}
        </div>
      </section>

      <section class="zen-panel rounded-lg p-4">
        <div class="flex items-center justify-between px-1">
          <h2 class="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-soft)]">
            CSV
          </h2>
          <span class="text-[11px] text-[var(--text-muted)]">Paste and tune</span>
        </div>

        <textarea
          bind:value={rawCsv}
          class="zen-code mt-4 h-[17rem] w-full rounded-md border border-[var(--line)] bg-white px-4 py-4 text-[12px] leading-6 text-[var(--text-main)] placeholder:text-[var(--text-soft)]"
        ></textarea>

        {#if loadError}
          <p class="mt-3 text-[12px] text-[var(--accent-coral)]">{loadError}</p>
        {/if}
      </section>
    </aside>

    <main class="zen-column order-1 flex min-h-screen w-full flex-1 flex-col gap-4 overflow-hidden lg:order-2">
      {#if activeDay}
        <section class="zen-panel relative min-h-[60vh] overflow-hidden rounded-lg">
          <div class="absolute inset-0">
            <MapCanvas places={activeResolvedPlaces} />
          </div>

          <div class="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(247,247,244,0.82)_0%,rgba(247,247,244,0.16)_30%,rgba(247,247,244,0.12)_62%,rgba(247,247,244,0.88)_100%)]"></div>

          <div class="relative flex h-full min-h-[60vh] flex-col justify-between p-4 sm:p-6">
            <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div class="max-w-[46rem]">
                <div class="inline-flex items-center gap-2 rounded-md border border-[var(--line)] bg-white/80 px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                  <span>Day {activeDay.dayNumber}</span>
                  <span class="text-[var(--text-soft)]">/</span>
                  <span>{activeDay.date}</span>
                </div>
                <h2 class="mt-4 max-w-[12ch] text-[2.35rem] font-semibold leading-none sm:text-[3rem]">
                  {activeDay.city}
                </h2>
                <p class="mt-3 max-w-[40rem] text-[1.05rem] leading-7 text-[var(--text-main)]">
                  {activeDay.theme}
                </p>
                <p class="mt-4 max-w-[42rem] text-[14px] leading-6 text-[var(--text-muted)]">
                  {activeDay.comments}
                </p>
              </div>

              <div class="grid gap-3 self-start lg:min-w-[18rem]">
                <div class="zen-panel-soft rounded-md px-4 py-3">
                  <div class="text-[10px] uppercase tracking-[0.14em] text-[var(--text-soft)]">
                    Status
                  </div>
                  <div class="mt-2 text-[14px] font-medium">{mapStatus}</div>
                </div>
                <div class="zen-panel-soft rounded-md px-4 py-3">
                  <div class="text-[10px] uppercase tracking-[0.14em] text-[var(--text-soft)]">
                    Transit
                  </div>
                  <div class="mt-2 text-[14px] font-medium">
                    {transportLabel(activeDay.transportation)} · {activeDay.transportation}
                  </div>
                </div>
              </div>
            </div>

            <div class="grid min-w-0 gap-3 lg:grid-cols-[1.15fr_0.85fr]">
              <div class="zen-panel-soft rounded-md p-4">
                <div class="flex min-w-0 flex-wrap items-start justify-between gap-4">
                  <div>
                    <div class="text-[10px] uppercase tracking-[0.14em] text-[var(--text-soft)]">
                      Active day
                    </div>
                    <div class="mt-2 text-[1.15rem] font-semibold">
                      {activeDay.activities.length} stops, {activeDay.foods.length} food anchors
                    </div>
                  </div>
                  <div class="shrink-0 rounded-md border border-[var(--line)] bg-white px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    {isLoadingMap ? 'Resolving' : `${activeResolvedPlaces.length} mapped`}
                  </div>
                </div>
                <div class="mt-4 flex flex-wrap gap-2">
                  {#each activeDay.activities.slice(0, 4) as item}
                    <div class="max-w-full rounded-md border border-[var(--line)] bg-white px-3 py-1.5 text-[12px] text-[var(--text-muted)] break-words">
                      {item.order}. {item.label}
                    </div>
                  {/each}
                </div>
              </div>

              <div class="zen-panel-soft rounded-md p-4">
                <div class="text-[10px] uppercase tracking-[0.14em] text-[var(--text-soft)]">
                  Notes
                </div>
                <div class="mt-3 grid gap-2">
                  {#each noteItems.slice(0, 3) as note}
                    <div class="rounded-md border border-[var(--line)] bg-white px-3 py-2 text-[12px] leading-5 text-[var(--text-muted)]">
                      {note}
                    </div>
                  {/each}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="grid gap-4 xl:grid-cols-[1.05fr_0.85fr_0.85fr]">
          <article class="zen-panel rounded-lg p-4">
            <div class="flex items-center justify-between border-b border-[var(--line)] px-1 pb-3">
              <h3 class="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-soft)]">
                Timeline
              </h3>
              <span class="text-[11px] text-[var(--text-muted)]">Map route + sequence</span>
            </div>

            <div class="mt-4 grid gap-3">
              {#each activeDay.activities as item}
                <div class={`rounded-md border p-4 shadow-sm ${cardTone(item.kind)}`}>
                  <div class="flex items-start justify-between gap-4">
                    <div>
                      <div class="text-[10px] uppercase tracking-[0.14em] text-[var(--text-soft)]">
                        Stop {item.order}
                      </div>
                      <div class="mt-2 text-[1rem] font-semibold">{item.label}</div>
                      <div class="mt-3 text-[12px] leading-5 text-[var(--text-muted)]">{item.query}</div>
                    </div>
                    <div class="grid h-9 w-9 place-items-center rounded-full border border-[var(--line)] bg-[var(--bg-0)] text-[13px] font-semibold text-[var(--text-muted)]">
                      {item.order}
                    </div>
                  </div>

                  {#if item.sourceUrl}
                    <a
                      class="mt-4 inline-flex rounded-md border border-[var(--line)] bg-white px-3 py-1.5 text-[11px] font-medium text-[var(--text-muted)] transition hover:border-[var(--line-strong)]"
                      href={item.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open source map link
                    </a>
                  {/if}
                </div>
              {/each}
            </div>
          </article>

          <article class="zen-panel rounded-lg p-4">
            <div class="flex items-center justify-between border-b border-[var(--line)] px-1 pb-3">
              <h3 class="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-soft)]">
                Food
              </h3>
              <span class="text-[11px] text-[var(--text-muted)]">Food markers</span>
            </div>

            <div class="mt-4 grid gap-3">
              {#each activeDay.foods as item}
                <div class="rounded-md border border-[var(--line)] bg-white p-4 shadow-sm">
                  <div class="flex items-start justify-between gap-4">
                    <div>
                      <div class="text-[10px] uppercase tracking-[0.14em] text-[var(--text-soft)]">
                        Food
                      </div>
                      <div class="mt-2 text-[1rem] font-semibold">{item.label}</div>
                      <div class="mt-3 text-[12px] leading-5 text-[var(--text-muted)]">{item.query}</div>
                    </div>
                    <div class="grid h-9 w-9 place-items-center rounded-full border border-[var(--line)] bg-[var(--bg-0)] text-[14px] font-semibold text-[var(--text-muted)]">
                      +
                    </div>
                  </div>

                  {#if item.sourceUrl}
                    <a
                      class="mt-4 inline-flex rounded-md border border-[var(--line)] bg-white px-3 py-1.5 text-[11px] font-medium text-[var(--text-muted)] transition hover:border-[var(--line-strong)]"
                      href={item.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open source map link
                    </a>
                  {/if}
                </div>
              {/each}
            </div>
          </article>

          <article class="zen-panel rounded-lg p-4">
            <div class="flex items-center justify-between border-b border-[var(--line)] px-1 pb-3">
              <h3 class="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-soft)]">
                Cheat Sheet
              </h3>
              <button
                type="button"
                class="rounded-md border border-[var(--line-strong)] bg-white px-3 py-1.5 text-[11px] font-semibold text-[var(--text-main)] transition hover:bg-[var(--bg-0)]"
                onclick={() => copyPhrases(activeDay.phrases)}
              >
                {copiedDayId === activeDay.id ? 'Copied' : 'Copy'}
              </button>
            </div>

            <div class="mt-4 rounded-md border border-[var(--line)] bg-white p-4">
              <div class="text-[10px] uppercase tracking-[0.14em] text-[var(--text-soft)]">
                Essential Japanese
              </div>
              <div class="mt-4 grid gap-2">
                {#each activeDay.phrases as phrase}
                  <div class="zen-code rounded-md border border-[var(--line)] bg-[var(--bg-0)] px-3 py-3 text-[13px]">
                    {phrase}
                  </div>
                {/each}
              </div>
            </div>

            <div class="mt-4 rounded-md border border-[var(--line)] bg-white p-4">
              <div class="text-[10px] uppercase tracking-[0.14em] text-[var(--text-soft)]">
                Booking / Ops
              </div>
              <div class="mt-4 grid gap-2">
                {#each noteItems as note}
                  <div class="rounded-md border border-[var(--line)] bg-[var(--bg-0)] px-3 py-2.5 text-[12px] leading-5 text-[var(--text-muted)]">
                    {note}
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
