import { findGoogleMapsUrls, stripUrls } from '$lib/maps';
import type {
  ItineraryDay,
  PlaceCandidate,
  PlaceConfidence,
  PlaceKind,
  PlaceSource
} from '$lib/types';

type CsvRow = Record<string, string | undefined>;

type KnownPlace = {
  canonicalKey: string;
  label: string;
  query: string;
  aliases: string[];
  detail?: string;
  confidence?: PlaceConfidence;
};

type PlaceDraft = Omit<PlaceCandidate, 'id' | 'order'> & {
  key: string;
};

const LIST_SPLIT = /\s*[,;]\s*/;
const SOURCE_ORDER: PlaceSource[] = ['Ideas', 'Must Eats', 'Hotel'];

const SOURCE_KIND: Record<PlaceSource, PlaceKind> = {
  Ideas: 'idea',
  'Must Eats': 'food',
  Hotel: 'hotel'
};

const KNOWN_PLACES: KnownPlace[] = [
  {
    canonicalKey: 'narita-airport',
    label: 'Narita Airport',
    query: 'Narita International Airport, Chiba, Japan',
    aliases: ['narita airport', 'nrt', 'jl 55', 'jl55'],
    detail: 'Arrival airport inferred from the flight and Narita Express context.',
    confidence: 'inferred'
  },
  {
    canonicalKey: 'narita-express',
    label: 'Narita Express',
    query: 'Narita Airport Terminal 1 Station, Chiba, Japan',
    aliases: ['narita express', "n'ex", 'nex'],
    detail: 'Rail link pinned at Narita for the arrival leg.',
    confidence: 'inferred'
  },
  {
    canonicalKey: 'shinjuku-station',
    label: 'Shinjuku Station',
    query: 'Shinjuku Station, Tokyo, Japan',
    aliases: ['shinjuku station']
  },
  {
    canonicalKey: 'godzilla-head',
    label: 'Godzilla Head',
    query: 'Godzilla Head, Shinjuku, Tokyo, Japan',
    aliases: ['godzilla head', 'shinjuku godzilla', 'shinjuku (godzilla head)']
  },
  {
    canonicalKey: 'golden-gai',
    label: 'Golden Gai',
    query: 'Golden Gai, Shinjuku, Tokyo, Japan',
    aliases: ['golden gai', 'golden-gai']
  },
  {
    canonicalKey: 'omoide-yokocho',
    label: 'Omoide Yokocho',
    query: 'Omoide Yokocho, Shinjuku, Tokyo, Japan',
    aliases: ['omoide yokocho', 'memory lane']
  },
  {
    canonicalKey: 'selection-shinjuku',
    label: 'Selection Shinjuku',
    query: 'Selection Shinjuku, Nishishinjuku, Tokyo, Japan',
    aliases: ['selection store', 'selection shinjuku', 'selection-store', 'hanshin tigers hat'],
    detail: 'Sports shop inferred from the Hanshin Tigers hat note.'
  },
  {
    canonicalKey: 'meiji-shrine',
    label: 'Meiji Shrine',
    query: 'Meiji Shrine, Tokyo, Japan',
    aliases: ['meiji shrine', 'meiji jingu', 'meiji-jingu']
  },
  {
    canonicalKey: 'yoyogi-park',
    label: 'Yoyogi Park',
    query: 'Yoyogi Park, Tokyo, Japan',
    aliases: ['yoyogi park']
  },
  {
    canonicalKey: 'takeshita-street',
    label: 'Takeshita Street',
    query: 'Takeshita Street, Harajuku, Tokyo, Japan',
    aliases: ['takeshita st', 'takeshita street', 'harajuku (takeshita st)', 'harajuku crepes'],
    detail: 'Harajuku food and pop-culture spine.',
    confidence: 'area'
  },
  {
    canonicalKey: 'harajuku',
    label: 'Harajuku',
    query: 'Harajuku Station, Tokyo, Japan',
    aliases: ['harajuku']
  },
  {
    canonicalKey: 'gotokuji-temple',
    label: 'Gotokuji Temple',
    query: 'Gotokuji Temple, Tokyo, Japan',
    aliases: ['gotokuji temple', 'gotoku-ji', 'gotokuji']
  },
  {
    canonicalKey: 'shibuya-sky',
    label: 'SHIBUYA SKY',
    query: 'SHIBUYA SKY, Tokyo, Japan',
    aliases: ['shibuya sky', 'shibuya-sky']
  },
  {
    canonicalKey: 'setagaya',
    label: 'Setagaya',
    query: 'Setagaya, Tokyo, Japan',
    aliases: ['setagaya'],
    confidence: 'area'
  },
  {
    canonicalKey: 'sensoji-temple',
    label: 'Senso-ji Temple',
    query: 'Senso-ji Temple, Asakusa, Tokyo, Japan',
    aliases: ['senso-ji temple', 'senso ji temple', 'senso-ji', 'sensoji']
  },
  {
    canonicalKey: 'kaminarimon',
    label: 'Kaminarimon Gate',
    query: 'Kaminarimon Gate, Asakusa, Tokyo, Japan',
    aliases: ['asakusa rickshaw', 'rickshaw', 'kaminarimon'],
    detail: 'Common Asakusa rickshaw meet-up area.',
    confidence: 'inferred'
  },
  {
    canonicalKey: 'ryogoku-kokugikan',
    label: 'Ryogoku Kokugikan',
    query: 'Ryogoku Kokugikan, Tokyo, Japan',
    aliases: ['sumo tournament', 'sumo tickets', 'book sumo tickets', 'sumo from', 'sumo'],
    detail: 'Tournament venue inferred from the sumo plan.',
    confidence: 'inferred'
  },
  {
    canonicalKey: 'ryogoku',
    label: 'Ryogoku',
    query: 'Ryogoku, Tokyo, Japan',
    aliases: ['ryogoku'],
    confidence: 'area'
  },
  {
    canonicalKey: 'nakamise-dori',
    label: 'Nakamise-dori Street',
    query: 'Nakamise-dori Street, Asakusa, Tokyo, Japan',
    aliases: ['asakusa street food', 'nakamise', 'nakamise dori', 'nakamise-dori'],
    detail: 'Street-food corridor inferred from the Asakusa food note.',
    confidence: 'inferred'
  },
  {
    canonicalKey: 'chanko-ryogoku',
    label: 'Chanko Nabe in Ryogoku',
    query: 'Chanko Nabe, Ryogoku, Tokyo, Japan',
    aliases: ['chanko nabe'],
    detail: 'Food search anchored to the sumo district.',
    confidence: 'area'
  },
  {
    canonicalKey: 'kimpton-shinjuku',
    label: 'Kimpton Shinjuku Tokyo',
    query: 'Kimpton Shinjuku Tokyo, Tokyo, Japan',
    aliases: ['kimpton shinjuku tokyo']
  },
  {
    canonicalKey: 'hotel-indigo-hakone-gora',
    label: 'Hotel Indigo Hakone Gora',
    query: 'Hotel Indigo Hakone Gora, Hakone, Japan',
    aliases: ['hotel indigo hakone gora']
  },
  {
    canonicalKey: 'hilton-kyoto',
    label: 'Hilton Kyoto',
    query: 'Hilton Kyoto, Kyoto, Japan',
    aliases: ['hilton kyoto']
  },
  {
    canonicalKey: 'ryotei-rangetsu',
    label: 'Ryotei Rangetsu',
    query: 'Ryotei Rangetsu, Arashiyama, Kyoto, Japan',
    aliases: ['ryotei rangetsu', 'rangetsu']
  },
  {
    canonicalKey: 'intercontinental-osaka',
    label: 'InterContinental Osaka',
    query: 'InterContinental Osaka, Osaka, Japan',
    aliases: ['intercontinental osaka']
  },
  {
    canonicalKey: 'ana-intercontinental-ishigaki',
    label: 'ANA InterContinental Ishigaki',
    query: 'ANA InterContinental Ishigaki Resort, Ishigaki, Japan',
    aliases: ['ana intercontinental ishigaki', 'ana intercontinental ishigaki resort']
  },
  {
    canonicalKey: 'intercontinental-tokyo-bay',
    label: 'InterContinental Tokyo Bay',
    query: 'InterContinental Tokyo Bay, Tokyo, Japan',
    aliases: ['intercontinental tokyo bay']
  }
];

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeText(input: string): string {
  return ` ${input.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ')} `;
}

function splitList(value: string): string[] {
  return value
    .split(LIST_SPLIT)
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanLabel(value: string): string {
  return stripUrls(value)
    .replace(/\s*\((?:if adding|if interested|local specialty|sumo stew|fills up on weekends)\)\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function searchableText(value: string): string {
  return value.replace(/\s*\((?:if adding|if interested|local specialty|sumo stew|fills up on weekends)\)\s*/gi, ' ');
}

function isGenericTask(value: string): boolean {
  const normalized = normalizeText(value);

  return [
    /^land$/i,
    /^n\/?a$/i,
    /^local trains?$/i,
    /^travel from\b/i,
    /^favorite beach repeat$/i,
    /konbini/i,
    /suica card/i,
    /offline google maps/i,
    /confirm hotel/i,
    /hotel check-in/i,
    /bring cash/i,
    /visibility forecast/i,
    /etiquette rules/i,
    /opening times/i,
    /^book\b/i
  ].some((pattern) => pattern.test(value)) || normalized.trim().length < 3;
}

function inferFoodArea(row: CsvRow): string {
  const text = `${row.Ideas ?? ''} ${row.Comments ?? ''}`;
  const normalized = normalizeText(text);

  if (normalized.includes(' harajuku ')) return 'Harajuku';
  if (normalized.includes(' asakusa ')) return 'Asakusa';
  if (normalized.includes(' ryogoku ')) return 'Ryogoku';
  if (normalized.includes(' shinjuku ')) return 'Shinjuku';
  if (normalized.includes(' setagaya ')) return 'Setagaya';

  return row.City?.trim() ?? '';
}

function findKnownPlaces(text: string): KnownPlace[] {
  const normalized = normalizeText(searchableText(text));
  const hits = KNOWN_PLACES.flatMap((place) => {
    const matches = place.aliases
      .map((alias) => {
        const normalizedAlias = normalizeText(alias).trim();
        const index = normalized.indexOf(` ${normalizedAlias} `);
        return index >= 0 ? { index, length: normalizedAlias.length, place } : null;
      })
      .filter(Boolean) as Array<{ index: number; length: number; place: KnownPlace }>;

    if (!matches.length) return [];

    const best = matches.sort((a, b) => a.index - b.index || b.length - a.length)[0];
    return [best];
  });

  const unique = new Map<string, { index: number; place: KnownPlace }>();
  for (const hit of hits.sort((a, b) => a.index - b.index || b.length - a.length)) {
    if (!unique.has(hit.place.canonicalKey)) {
      unique.set(hit.place.canonicalKey, { index: hit.index, place: hit.place });
    }
  }

  const places = Array.from(unique.values())
    .sort((a, b) => a.index - b.index)
    .map((hit) => hit.place);

  if (places.some((place) => place.canonicalKey === 'takeshita-street')) {
    return places.filter((place) => place.canonicalKey !== 'harajuku');
  }

  return places;
}

function knownDraft(place: KnownPlace, source: PlaceSource, sourceText: string): PlaceDraft {
  const sourceUrl = findGoogleMapsUrls(sourceText)[0];

  return {
    key: place.canonicalKey,
    label: place.label,
    query: place.query,
    sourceUrl,
    canonicalKey: place.canonicalKey,
    kind: SOURCE_KIND[source],
    sourceColumns: [source],
    sourceTexts: [cleanLabel(sourceText)],
    detail: place.detail,
    confidence: place.confidence ?? 'named'
  };
}

function directDraft(row: CsvRow, label: string, source: PlaceSource, sourceText: string): PlaceDraft | null {
  const cleanedLabel = cleanLabel(label);
  if (!cleanedLabel || isGenericTask(cleanedLabel)) return null;

  const city = row.City?.trim() ?? '';
  const area = source === 'Must Eats' ? inferFoodArea(row) : '';
  const query = [cleanedLabel, area || city, 'Japan'].filter(Boolean).join(', ');
  const sourceUrl = findGoogleMapsUrls(sourceText)[0];

  return {
    key: `${SOURCE_KIND[source]}-${slugify(cleanedLabel)}`,
    label: cleanedLabel,
    query,
    sourceUrl,
    kind: SOURCE_KIND[source],
    sourceColumns: [source],
    sourceTexts: [cleanedLabel],
    confidence: source === 'Must Eats' ? 'search' : 'named'
  };
}

function mergeDrafts(drafts: PlaceDraft[]): PlaceCandidate[] {
  const merged = new Map<string, PlaceDraft>();

  for (const draft of drafts) {
    const existing = merged.get(draft.key);
    if (!existing) {
      merged.set(draft.key, draft);
      continue;
    }

    existing.sourceColumns = Array.from(new Set([...existing.sourceColumns, ...draft.sourceColumns]));
    existing.sourceTexts = Array.from(new Set([...existing.sourceTexts, ...draft.sourceTexts]));
    existing.sourceUrl ||= draft.sourceUrl;
    existing.detail ||= draft.detail;

    if (existing.kind !== 'idea' && draft.kind === 'idea') {
      existing.kind = 'idea';
    }
  }

  return Array.from(merged.values()).map((draft, index) => ({
    id: `place-${index + 1}-${draft.key}`,
    label: draft.label,
    query: draft.query,
    sourceUrl: draft.sourceUrl,
    canonicalKey: draft.canonicalKey,
    kind: draft.kind,
    order: index + 1,
    sourceColumns: draft.sourceColumns.sort(
      (a, b) => SOURCE_ORDER.indexOf(a) - SOURCE_ORDER.indexOf(b)
    ),
    sourceTexts: draft.sourceTexts,
    detail: draft.detail,
    confidence: draft.confidence
  }));
}

function parseColumn(row: CsvRow, source: PlaceSource): PlaceDraft[] {
  const rawValue = row[source]?.trim() ?? '';
  if (!rawValue) return [];

  const chunks = splitList(rawValue);

  return chunks.flatMap((chunk) => {
    const known = findKnownPlaces(chunk).map((place) => knownDraft(place, source, chunk));
    if (known.length) return known;

    const draft = directDraft(row, chunk, source, chunk);
    return draft ? [draft] : [];
  });
}

function parsePlaces(row: CsvRow): PlaceCandidate[] {
  const drafts = SOURCE_ORDER.flatMap((source) => parseColumn(row, source));
  const rowText = `${row.Ideas ?? ''} ${row.Comments ?? ''}`;

  if (/landing|land/i.test(rowText) && /narita/i.test(rowText)) {
    drafts.unshift(knownDraft(KNOWN_PLACES[0], 'Ideas', 'Landing via Narita context'));
  }

  return mergeDrafts(drafts);
}

function parsePhrases(row: CsvRow): string[] {
  return splitList(row['Essential Japanese']?.trim() || '');
}

export function normalizeItinerary(rows: CsvRow[]): ItineraryDay[] {
  return rows
    .filter((row) => (row.D ?? row.Date ?? row.Day ?? '').trim())
    .map((row, index) => {
      const parsedDayNumber = Number(row.D);
      const dayNumber = Number.isFinite(parsedDayNumber) && parsedDayNumber > 0 ? parsedDayNumber : index + 1;
      const places = parsePlaces(row);

      return {
        id: `day-${dayNumber}`,
        dayNumber,
        date: row.Date?.trim() || '',
        weekday: row.Day?.trim() || '',
        city: row.City?.trim() || '',
        theme: row.Theme?.trim() || '',
        transportation: row.Transportation?.trim() || '',
        comments: row.Comments?.trim() || '',
        notes: row['Notes/Bookings']?.trim() || '',
        phrases: parsePhrases(row),
        places,
        activities: places.filter((place) => place.kind === 'idea'),
        foods: places.filter((place) => place.kind === 'food'),
        hotel: row.Hotel?.trim() || '',
        hotelPlaces: places.filter((place) => place.kind === 'hotel')
      };
    });
}
