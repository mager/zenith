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
    return kind === 'food'
      ? 'border-white/10 bg-[linear-gradient(180deg,rgba(255,139,110,0.18),rgba(21,17,16,0.68))]'
      : 'border-white/10 bg-[linear-gradient(180deg,rgba(107,231,255,0.08),rgba(8,17,29,0.78))]';
  }

  $effect(() => {
    if (activeDay) {
      void resolvePlaces(activeDay);
    }
  });
</script>

<svelte:head>
  <title>Zen | Night Map Travel Planner</title>
  <meta
    name="description"
    content="Zen turns a CSV itinerary into a map-first, high-clarity travel dashboard."
  />
</svelte:head>

<div class="zen-shell min-h-screen">
  <div class="mx-auto flex min-h-screen max-w-[1680px] flex-col gap-5 px-4 py-4 lg:flex-row lg:px-5 lg:py-5">
    <aside class="order-2 flex w-full flex-col gap-4 lg:order-1 lg:w-[24rem] lg:shrink-0">
      <section class="zen-panel zen-glow rounded-[28px] p-5">
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="text-[11px] font-semibold uppercase tracking-[0.36em] text-[var(--accent-cyan)]">
              Zen
            </p>
            <h1 class="mt-3 text-[2rem] font-bold leading-[1.02] tracking-[-0.04em]">
              Tokyo lights, tighter planning.
            </h1>
            <p class="mt-3 max-w-[28ch] text-[14px] leading-6 text-[var(--text-muted)]">
              A map-first field guide for days that need to read in seconds, not tabs.
            </p>
          </div>
          <div class="rounded-[18px] border border-white/10 bg-white/5 px-3 py-2 text-right">
            <div class="text-[10px] uppercase tracking-[0.3em] text-[var(--text-soft)]">Dataset</div>
            <div class="mt-2 max-w-[9rem] truncate text-[12px] font-medium text-white/90">
              {uploadName}
            </div>
          </div>
        </div>

        <div class="mt-5 grid grid-cols-3 gap-3">
          <div class="rounded-[18px] border border-white/8 bg-white/5 px-3 py-3">
            <div class="text-[10px] uppercase tracking-[0.24em] text-[var(--text-soft)]">Days</div>
            <div class="mt-2 text-[1.1rem] font-semibold">{days.length}</div>
          </div>
          <div class="rounded-[18px] border border-white/8 bg-white/5 px-3 py-3">
            <div class="text-[10px] uppercase tracking-[0.24em] text-[var(--text-soft)]">Stops</div>
            <div class="mt-2 text-[1.1rem] font-semibold">{activeDay?.activities.length ?? 0}</div>
          </div>
          <div class="rounded-[18px] border border-white/8 bg-white/5 px-3 py-3">
            <div class="text-[10px] uppercase tracking-[0.24em] text-[var(--text-soft)]">Foods</div>
            <div class="mt-2 text-[1.1rem] font-semibold">{activeDay?.foods.length ?? 0}</div>
          </div>
        </div>

        <div class="mt-5 grid gap-2">
          <label
            class="flex cursor-pointer items-center justify-between rounded-[18px] border border-[var(--accent-cyan)]/40 bg-[linear-gradient(135deg,rgba(107,231,255,0.18),rgba(67,137,255,0.12))] px-4 py-3 text-[13px] font-semibold text-white transition hover:border-[var(--accent-cyan)] hover:bg-[linear-gradient(135deg,rgba(107,231,255,0.24),rgba(67,137,255,0.16))]"
          >
            <span>Upload fresh CSV</span>
            <span class="text-[11px] uppercase tracking-[0.2em] text-white/70">Local</span>
            <input class="hidden" type="file" accept=".csv,text/csv" onchange={onUpload} />
          </label>
          <button
            type="button"
            class="rounded-[18px] border border-white/10 bg-white/5 px-4 py-3 text-left text-[13px] font-medium text-white transition hover:bg-white/8"
            onclick={pasteCsv}
          >
            Rebuild from editor text
          </button>
        </div>
      </section>

      <section class="zen-panel rounded-[28px] p-4">
        <div class="flex items-center justify-between px-1 pb-3">
          <h2 class="text-[11px] font-semibold uppercase tracking-[0.3em] text-[var(--text-soft)]">
            Day Switcher
          </h2>
          <span class="text-[11px] text-[var(--text-muted)]">{days.length} loaded</span>
        </div>

        <div class="grid max-h-[34vh] gap-2 overflow-auto pr-1 lg:max-h-[40vh]">
          {#each days as day}
            <button
              type="button"
              class={`rounded-[22px] border px-4 py-4 text-left transition ${
                day.id === activeDay?.id
                  ? 'border-[var(--line-strong)] bg-[linear-gradient(135deg,rgba(107,231,255,0.12),rgba(67,137,255,0.12))] shadow-[0_14px_40px_rgba(0,0,0,0.22)]'
                  : 'border-white/8 bg-white/[0.03] hover:bg-white/[0.06]'
              }`}
              onclick={() => selectDay(day.id)}
            >
              <div class="flex items-start justify-between gap-3">
                <div>
                  <div class="flex items-center gap-2">
                    <span class="text-[13px] font-semibold text-white">{day.city}</span>
                    <span class="text-[10px] uppercase tracking-[0.22em] text-[var(--text-soft)]">
                      {day.weekday}
                    </span>
                  </div>
                  <div class="mt-2 text-[15px] font-medium leading-5 text-white/90">{day.theme}</div>
                </div>
                <div class="rounded-[14px] border border-white/10 bg-black/20 px-2.5 py-1.5 text-[11px] font-semibold text-[var(--accent-cyan)]">
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

      <section class="zen-panel rounded-[28px] p-4">
        <div class="flex items-center justify-between px-1">
          <h2 class="text-[11px] font-semibold uppercase tracking-[0.3em] text-[var(--text-soft)]">
            CSV Studio
          </h2>
          <span class="text-[11px] text-[var(--text-muted)]">Paste and tune</span>
        </div>

        <textarea
          bind:value={rawCsv}
          class="zen-code mt-4 h-[17rem] w-full rounded-[22px] border border-white/8 bg-black/20 px-4 py-4 text-[12px] leading-6 text-white/85 placeholder:text-[var(--text-soft)]"
        ></textarea>

        {#if loadError}
          <p class="mt-3 text-[12px] text-[var(--accent-coral)]">{loadError}</p>
        {/if}
      </section>
    </aside>

    <main class="order-1 flex min-h-screen flex-1 flex-col gap-4 lg:order-2">
      {#if activeDay}
        <section class="zen-panel zen-glow relative min-h-[60vh] overflow-hidden rounded-[32px]">
          <div class="absolute inset-0">
            <MapCanvas places={activeResolvedPlaces} />
          </div>

          <div class="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(4,10,18,0.72)_0%,rgba(4,10,18,0.18)_30%,rgba(4,10,18,0.18)_65%,rgba(4,10,18,0.84)_100%)]"></div>
          <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(107,231,255,0.12),transparent_22%),radial-gradient(circle_at_82%_78%,rgba(255,139,110,0.14),transparent_20%)]"></div>

          <div class="relative flex h-full min-h-[60vh] flex-col justify-between p-4 sm:p-6">
            <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div class="max-w-[46rem]">
                <div class="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/25 px-3 py-1 text-[11px] uppercase tracking-[0.28em] text-[var(--accent-cyan)]">
                  <span>Day {activeDay.dayNumber}</span>
                  <span class="text-white/30">/</span>
                  <span>{activeDay.date}</span>
                </div>
                <h2 class="mt-4 max-w-[12ch] text-[2.5rem] font-bold leading-[0.94] tracking-[-0.05em] text-white sm:text-[3.3rem]">
                  {activeDay.city}
                </h2>
                <p class="mt-3 max-w-[40rem] text-[1.05rem] leading-7 text-white/82">
                  {activeDay.theme}
                </p>
                <p class="mt-4 max-w-[42rem] text-[14px] leading-6 text-[var(--text-muted)]">
                  {activeDay.comments}
                </p>
              </div>

              <div class="grid gap-3 self-start lg:min-w-[18rem]">
                <div class="zen-panel-soft rounded-[22px] px-4 py-3">
                  <div class="text-[10px] uppercase tracking-[0.28em] text-[var(--text-soft)]">
                    Status
                  </div>
                  <div class="mt-2 text-[14px] font-medium text-white">{mapStatus}</div>
                </div>
                <div class="zen-panel-soft rounded-[22px] px-4 py-3">
                  <div class="text-[10px] uppercase tracking-[0.28em] text-[var(--text-soft)]">
                    Transit Mode
                  </div>
                  <div class="mt-2 text-[14px] font-medium text-white">
                    {transportLabel(activeDay.transportation)} · {activeDay.transportation}
                  </div>
                </div>
              </div>
            </div>

            <div class="grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
              <div class="zen-panel-soft rounded-[26px] p-4">
                <div class="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div class="text-[10px] uppercase tracking-[0.32em] text-[var(--text-soft)]">
                      Active Day View
                    </div>
                    <div class="mt-2 text-[1.15rem] font-semibold text-white">
                      {activeDay.activities.length} stops, {activeDay.foods.length} food anchors
                    </div>
                  </div>
                  <div class="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-white/70">
                    {isLoadingMap ? 'Resolving' : `${activeResolvedPlaces.length} mapped`}
                  </div>
                </div>
                <div class="mt-4 flex flex-wrap gap-2">
                  {#each activeDay.activities.slice(0, 4) as item}
                    <div class="rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-[12px] text-white/82">
                      {item.order}. {item.label}
                    </div>
                  {/each}
                </div>
              </div>

              <div class="zen-panel-soft rounded-[26px] p-4">
                <div class="text-[10px] uppercase tracking-[0.32em] text-[var(--text-soft)]">
                  Notes Radar
                </div>
                <div class="mt-3 grid gap-2">
                  {#each noteItems.slice(0, 3) as note}
                    <div class="rounded-[16px] border border-white/8 bg-black/20 px-3 py-2 text-[12px] leading-5 text-white/80">
                      {note}
                    </div>
                  {/each}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="grid gap-4 xl:grid-cols-[1.05fr_0.85fr_0.85fr]">
          <article class="zen-panel rounded-[28px] p-4">
            <div class="flex items-center justify-between border-b border-white/8 px-1 pb-3">
              <h3 class="text-[11px] font-semibold uppercase tracking-[0.3em] text-[var(--text-soft)]">
                Timeline
              </h3>
              <span class="text-[11px] text-[var(--text-muted)]">Map route + sequence</span>
            </div>

            <div class="mt-4 grid gap-3">
              {#each activeDay.activities as item}
                <div class={`rounded-[24px] border p-4 ${cardTone(item.kind)}`}>
                  <div class="flex items-start justify-between gap-4">
                    <div>
                      <div class="text-[10px] uppercase tracking-[0.28em] text-[var(--text-soft)]">
                        Stop {item.order}
                      </div>
                      <div class="mt-2 text-[1rem] font-semibold text-white">{item.label}</div>
                      <div class="mt-3 text-[12px] leading-5 text-[var(--text-muted)]">{item.query}</div>
                    </div>
                    <div class="grid h-10 w-10 place-items-center rounded-[16px] border border-[var(--accent-cyan)]/28 bg-[rgba(107,231,255,0.1)] text-[13px] font-semibold text-[var(--accent-cyan)]">
                      {item.order}
                    </div>
                  </div>

                  {#if item.sourceUrl}
                    <a
                      class="mt-4 inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-medium text-white/78 transition hover:bg-white/10"
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

          <article class="zen-panel rounded-[28px] p-4">
            <div class="flex items-center justify-between border-b border-white/8 px-1 pb-3">
              <h3 class="text-[11px] font-semibold uppercase tracking-[0.3em] text-[var(--text-soft)]">
                Must Eats
              </h3>
              <span class="text-[11px] text-[var(--accent-coral)]">Food markers</span>
            </div>

            <div class="mt-4 grid gap-3">
              {#each activeDay.foods as item}
                <div class="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,139,110,0.14),rgba(13,12,15,0.8))] p-4">
                  <div class="flex items-start justify-between gap-4">
                    <div>
                      <div class="text-[10px] uppercase tracking-[0.28em] text-[var(--text-soft)]">
                        Food Anchor
                      </div>
                      <div class="mt-2 text-[1rem] font-semibold text-white">{item.label}</div>
                      <div class="mt-3 text-[12px] leading-5 text-[var(--text-muted)]">{item.query}</div>
                    </div>
                    <div class="grid h-10 w-10 place-items-center rounded-[16px] border border-[var(--accent-coral)]/32 bg-[rgba(255,139,110,0.14)] text-[14px] font-semibold text-[var(--accent-gold)]">
                      +
                    </div>
                  </div>

                  {#if item.sourceUrl}
                    <a
                      class="mt-4 inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-medium text-white/78 transition hover:bg-white/10"
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

          <article class="zen-panel rounded-[28px] p-4">
            <div class="flex items-center justify-between border-b border-white/8 px-1 pb-3">
              <h3 class="text-[11px] font-semibold uppercase tracking-[0.3em] text-[var(--text-soft)]">
                Cheat Sheet
              </h3>
              <button
                type="button"
                class="rounded-full border border-[var(--accent-cyan)]/30 bg-[rgba(107,231,255,0.08)] px-3 py-1.5 text-[11px] font-semibold text-[var(--accent-cyan)] transition hover:bg-[rgba(107,231,255,0.14)]"
                onclick={() => copyPhrases(activeDay.phrases)}
              >
                {copiedDayId === activeDay.id ? 'Copied' : 'Copy'}
              </button>
            </div>

            <div class="mt-4 rounded-[26px] border border-white/10 bg-[linear-gradient(180deg,rgba(67,137,255,0.18),rgba(8,17,31,0.92))] p-4">
              <div class="text-[10px] uppercase tracking-[0.28em] text-[var(--text-soft)]">
                Essential Japanese
              </div>
              <div class="mt-4 grid gap-2">
                {#each activeDay.phrases as phrase}
                  <div class="zen-code rounded-[18px] border border-white/8 bg-black/20 px-3 py-3 text-[13px] text-white/92">
                    {phrase}
                  </div>
                {/each}
              </div>
            </div>

            <div class="mt-4 rounded-[26px] border border-white/10 bg-white/[0.04] p-4">
              <div class="text-[10px] uppercase tracking-[0.28em] text-[var(--text-soft)]">
                Booking / Ops
              </div>
              <div class="mt-4 grid gap-2">
                {#each noteItems as note}
                  <div class="rounded-[18px] border border-white/8 bg-black/20 px-3 py-2.5 text-[12px] leading-5 text-white/82">
                    {note}
                  </div>
                {/each}
              </div>
            </div>
          </article>
        </section>
      {:else}
        <div class="zen-panel flex flex-1 items-center justify-center rounded-[32px] px-6 text-center text-[var(--text-muted)]">
          Upload or paste a CSV to begin.
        </div>
      {/if}
    </main>
  </div>
</div>
