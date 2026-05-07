import { inferGooglePlaceTypes, isHistoricPlaceType, primaryPlaceType } from './place-taxonomy';
import type {
  GooglePlaceType,
  ItineraryDay,
  NearbySavedPlace,
  PlaceCandidate,
  PlaceEnrichmentRecord,
  PlaceStoryProfile,
  ResolvedPlace,
  SavedMapPlace
} from './types';

type EnrichablePlace = Pick<PlaceCandidate | SavedMapPlace, 'id' | 'label'> & {
  address?: string;
  canonicalKey?: string;
  category?: SavedMapPlace['category'];
  googlePlaceTypes?: GooglePlaceType[];
  kind?: PlaceCandidate['kind'];
  listTitle?: string;
  note?: string;
  primaryType?: GooglePlaceType;
  sourceTexts?: string[];
};

export type DayNarrative = {
  headline: string;
  summary: string;
  themes: string[];
  historyStops: PlaceEnrichmentRecord[];
  savedHistoryCount: number;
};

const UPDATED_AT = '2026-05-06T00:00:00.000Z';

const HISTORY_BY_KEY: Record<string, PlaceStoryProfile> = {
  'meiji-shrine': {
    headline: 'Imperial memory in a man-made forest',
    era: 'Meiji to modern Tokyo',
    context:
      'Meiji Shrine honors Emperor Meiji and Empress Shoken. The shrine was completed in 1920, rebuilt after World War II, and surrounded by a forest planted from donated trees across Japan.',
    whyVisit:
      "It connects the jump from shogunate Japan to modern Japan with one of Tokyo's calmest ceremonial spaces.",
    visitCue: 'Notice how the city falls away as the gravel path enters the forest.',
    ritualNote: 'Bow at the torii, rinse hands at the chozuya, then approach the main hall quietly.',
    themes: ['imperial modernity', 'ritual', 'urban nature']
  },
  'sensoji-temple': {
    headline: 'Asakusa faith, commerce, and postwar resilience',
    era: 'Asuka origins, Edo popularity, postwar rebuild',
    context:
      "Senso-ji is Tokyo's oldest major temple. Its origin story centers on a Kannon image found in 628, while the lively approach became part of Edo commoner culture. Much of the complex was rebuilt after 1945.",
    whyVisit:
      'The temple makes Tokyo feel layered: legend, shopping street, smoke, crowds, and reconstruction all in one walk.',
    visitCue: 'Move from Kaminarimon through Nakamise-dori, then pause at the incense before the main hall.',
    themes: ['Buddhism', 'Edo city life', 'reconstruction']
  },
  kaminarimon: {
    headline: 'The threshold into old Asakusa',
    era: 'Edo landmark, modern reconstruction',
    context:
      'Kaminarimon is the thunder gate entrance to Senso-ji. The current gate dates to the 1960s, but the gateway has long framed the transition from city bustle into the temple precinct.',
    whyVisit: "It is less a single object than a stage set for entering one of Tokyo's oldest public rituals.",
    visitCue: 'Look up at the lantern, then back toward the street to feel the compression of the approach.',
    themes: ['thresholds', 'Asakusa', 'ritual']
  },
  'gotokuji-temple': {
    headline: 'The beckoning cat legend with samurai roots',
    era: 'Edo period',
    context:
      'Gotokuji is associated with the maneki-neko beckoning cat legend and with the Ii clan, a major samurai family in the Tokugawa order.',
    whyVisit:
      'It turns a familiar lucky-cat symbol into a place-based story about patronage, legend, and neighborhood quiet.',
    visitCue: 'The cat figures are offerings, not souvenirs left behind by accident.',
    themes: ['folk belief', 'samurai patronage', 'luck']
  },
  'hakone-shrine': {
    headline: 'Mountain worship at the edge of Lake Ashi',
    era: 'Nara period traditions',
    context:
      'Hakone Shrine is traditionally dated to 757 and tied to mountain and lake worship around Hakone. Its lakeside torii makes the sacred geography visible.',
    whyVisit:
      'It links the Hakone landscape to pilgrimage, protection, and travel rather than just postcard scenery.',
    visitCue: 'Arrive late afternoon if you can, when the lake turns the torii into a silhouette.',
    themes: ['mountain worship', 'water', 'pilgrimage']
  },
  'fushimi-inari-taisha': {
    headline: 'A mountain of gates for rice, trade, and luck',
    era: 'Heian roots, living Shinto practice',
    context:
      'Fushimi Inari is the head shrine of Inari, associated with rice, prosperity, and business. The thousands of torii are donations, so the mountain path doubles as a record of devotion and patronage.',
    whyVisit:
      'The shrine turns history into movement: each gate is both a marker of faith and a sign of worldly ambition.',
    visitCue: 'Start early and keep walking past the first crowded gate tunnels.',
    ritualNote: 'Fox figures are messengers of Inari, not the deity itself.',
    themes: ['Shinto', 'commerce', 'pilgrimage']
  },
  'kinkakuji': {
    headline: 'Power, beauty, and a rebuilt golden icon',
    era: 'Muromachi period, modern reconstruction',
    context:
      "Kinkaku-ji began as Ashikaga Yoshimitsu's retirement villa and became a Zen temple after his death in 1408. The present pavilion was rebuilt in 1955 after a 1950 fire.",
    whyVisit:
      'It is a lesson in how Japanese heritage can be both old in meaning and modern in material reality.',
    visitCue: 'Use the pond reflection as part of the architecture, not just a photo angle.',
    themes: ['Zen', 'shogunal power', 'reconstruction']
  },
  'ryoanji': {
    headline: 'A garden designed to keep its answer withheld',
    era: 'Late Muromachi Zen culture',
    context:
      'Ryoan-ji is famous for a dry landscape garden whose stone arrangement resists a single explanation. That ambiguity is part of its force.',
    whyVisit:
      'It asks you to slow down and accept that the most important thing may be the act of looking.',
    visitCue: 'Sit longer than feels efficient. The garden changes as your attention settles.',
    themes: ['Zen', 'negative space', 'contemplation']
  },
  'nanzenji': {
    headline: 'An imperial villa turned major Zen monastery',
    era: 'Kamakura period onward',
    context:
      'Nanzen-ji began as an imperial villa and became a Zen temple in 1291. Its scale reflects Kyoto religious power, while the later aqueduct shows the city layering eras without apology.',
    whyVisit:
      'It makes Kyoto feel less frozen in time and more like a city that keeps reusing sacred space.',
    visitCue: 'The Sanmon gate is worth treating as architecture, not just an entry point.',
    themes: ['Zen', 'imperial Kyoto', 'layered city']
  },
  'tenryuji': {
    headline: 'A garden built around political repair',
    era: 'Muromachi period',
    context:
      'Tenryu-ji was founded in 1339 by Ashikaga Takauji, partly to honor Emperor Go-Daigo. Its garden is associated with the Zen monk and designer Muso Soseki.',
    whyVisit:
      'The place links beauty with reconciliation after conflict, which gives the garden more weight than scenery alone.',
    visitCue: 'Look for how the borrowed mountain scenery completes the garden composition.',
    themes: ['Zen', 'political memory', 'garden design']
  },
  'sumiyoshi-taisha': {
    headline: 'Osaka before the city was Osaka',
    era: 'Ancient shrine tradition',
    context:
      "Sumiyoshi Taisha is one of Japan's oldest shrine complexes and is associated with protection for seafarers. Its architecture preserves a distinctive pre-Buddhist shrine style.",
    whyVisit:
      'It gives Osaka a much older frame than food streets and neon, rooted in sea routes and ritual protection.',
    visitCue: 'The bridge and straight-roofed shrine buildings are the visual anchors.',
    themes: ['Shinto', 'maritime protection', 'ancient Osaka']
  },
  'todai-ji': {
    headline: 'Nara state Buddhism at monumental scale',
    era: 'Nara period',
    context:
      'Todai-ji was central to Nara-period state Buddhism, and the Great Buddha was consecrated in 752 under Emperor Shomu. The current Great Buddha Hall is a later rebuild, still immense.',
    whyVisit:
      'It shows religion as national project: art, politics, engineering, and awe working together.',
    visitCue: 'Let the scale register before getting close to the bronze Buddha.',
    themes: ['Buddhism', 'imperial statecraft', 'monumentality']
  }
};

const HISTORY_PATTERNS: Array<[RegExp, keyof typeof HISTORY_BY_KEY]> = [
  [/\bmeiji\b/i, 'meiji-shrine'],
  [/\bsenso\b|\basakusa temple\b/i, 'sensoji-temple'],
  [/\bkaminarimon\b/i, 'kaminarimon'],
  [/\bgotoku/i, 'gotokuji-temple'],
  [/\bhakone shrine\b/i, 'hakone-shrine'],
  [/\bfushimi\b|\binari\b/i, 'fushimi-inari-taisha'],
  [/\bkinkaku\b|golden pavilion/i, 'kinkakuji'],
  [/\bryoan\b/i, 'ryoanji'],
  [/\bnanzen\b/i, 'nanzenji'],
  [/\btenryu\b/i, 'tenryuji'],
  [/\bsumiyoshi\b/i, 'sumiyoshi-taisha'],
  [/\btodai\b|giant buddha/i, 'todai-ji']
];

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function textForPlace(place: EnrichablePlace): string {
  return [
    place.label,
    place.address,
    place.note,
    place.listTitle,
    place.kind,
    ...(place.sourceTexts ?? [])
  ]
    .filter(Boolean)
    .join(' ');
}

export function enrichmentKeyForPlace(place: EnrichablePlace): string {
  if (place.canonicalKey) return `place:${place.canonicalKey}`;
  if ('category' in place) return `saved:${place.id}`;

  return `place:${slugify(place.label) || place.id}`;
}

export function historyForPlace(place: EnrichablePlace): PlaceStoryProfile | undefined {
  if (place.canonicalKey && HISTORY_BY_KEY[place.canonicalKey]) {
    return HISTORY_BY_KEY[place.canonicalKey];
  }

  const text = textForPlace(place);
  const matchedKey = HISTORY_PATTERNS.find(([pattern]) => pattern.test(text))?.[1];

  return matchedKey ? HISTORY_BY_KEY[matchedKey] : undefined;
}

export function buildPlaceEnrichment(place: EnrichablePlace): PlaceEnrichmentRecord {
  const explicitTypes = place.googlePlaceTypes ?? [];
  const googlePlaceTypes = inferGooglePlaceTypes(textForPlace(place), place.category, explicitTypes);
  const primaryType = place.primaryType ?? primaryPlaceType(googlePlaceTypes, place.category);
  const history = historyForPlace(place);

  return {
    id: enrichmentKeyForPlace(place),
    label: place.label,
    canonicalKey: place.canonicalKey,
    googlePlaceTypes,
    primaryType,
    history,
    source: history ? 'curated' : 'inferred',
    updatedAt: UPDATED_AT
  };
}

export function mergePlaceEnrichment(
  base: PlaceEnrichmentRecord | undefined,
  override: PlaceEnrichmentRecord | undefined
): PlaceEnrichmentRecord | undefined {
  if (!base) return override;
  if (!override) return base;

  return {
    ...base,
    ...override,
    googlePlaceTypes: override.googlePlaceTypes?.length ? override.googlePlaceTypes : base.googlePlaceTypes,
    primaryType: override.primaryType ?? base.primaryType,
    history: override.history ?? base.history,
    personalNote: override.personalNote ?? base.personalNote,
    source: override.source,
    updatedAt: override.updatedAt
  };
}

export function placeHasHistory(place: EnrichablePlace): boolean {
  const enrichment = buildPlaceEnrichment(place);

  return Boolean(enrichment.history) || isHistoricPlaceType(enrichment.googlePlaceTypes);
}

export function buildDayNarrative(
  day: ItineraryDay | undefined,
  resolvedPlaces: ResolvedPlace[],
  nearbySavedPlaces: NearbySavedPlace[],
  customEnrichments: Record<string, PlaceEnrichmentRecord>
): DayNarrative {
  const empty: DayNarrative = {
    headline: 'No day selected',
    summary: 'Choose a day to build the story thread.',
    themes: [],
    historyStops: [],
    savedHistoryCount: 0
  };

  if (!day) return empty;

  const historyStops = resolvedPlaces
    .map((place) =>
      mergePlaceEnrichment(buildPlaceEnrichment(place), customEnrichments[enrichmentKeyForPlace(place)])
    )
    .filter((record): record is PlaceEnrichmentRecord => Boolean(record?.history));

  const uniqueStops = Array.from(new Map(historyStops.map((record) => [record.id, record])).values());
  const savedHistoryCount = nearbySavedPlaces.filter((place) => placeHasHistory(place)).length;
  const themeCounts = new Map<string, number>();

  for (const stop of uniqueStops) {
    for (const theme of stop.history?.themes ?? []) {
      themeCounts.set(theme, (themeCounts.get(theme) ?? 0) + 1);
    }
  }

  const themes = Array.from(themeCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([theme]) => theme);

  if (!uniqueStops.length) {
    return {
      headline: `${day.city}: a practical map day`,
      summary:
        savedHistoryCount > 0
          ? `There are ${savedHistoryCount} saved cultural places nearby. Switch to the history lens to see what is close to the stay or route.`
          : 'This day is mostly food, transit, or open exploration. Saved cultural pins will become the story layer once they are near the stay or route.',
      themes,
      historyStops: [],
      savedHistoryCount
    };
  }

  const lead = uniqueStops[0];
  const extraCount = uniqueStops.length - 1;
  const extraText = extraCount > 0 ? ` plus ${extraCount} more history stop${extraCount > 1 ? 's' : ''}` : '';

  return {
    headline: `${day.city}: ${lead.history?.headline ?? 'history in motion'}`,
    summary: `${lead.label} sets the story for the day${extraText}. The thread is ${themes.length ? themes.join(', ') : 'place memory'}, with nearby saved pins acting as optional side quests.`,
    themes,
    historyStops: uniqueStops,
    savedHistoryCount
  };
}
