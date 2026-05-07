import { json } from '@sveltejs/kit';
import { parseGoogleMapsCoordinates } from '$lib/maps';
import type { PlaceResolutionSource } from '$lib/types';
import type { RequestHandler } from './$types';

type ResolveRequest = {
  label: string;
  query: string;
  sourceUrl?: string;
  canonicalKey?: string;
};

type ResolveResponse = {
  lat: number;
  lng: number;
  source: PlaceResolutionSource;
  resolvedLabel?: string;
} | null;

const cache = new Map<string, ResolveResponse>();

const CURATED_PLACES: Record<string, Omit<NonNullable<ResolveResponse>, 'source'>> = {
  'narita-airport': {
    lat: 35.771987,
    lng: 140.39285,
    resolvedLabel: 'Narita International Airport'
  },
  'narita-express': {
    lat: 35.771987,
    lng: 140.39285,
    resolvedLabel: 'Narita Airport Terminal 1 Station'
  },
  'shinjuku-station': {
    lat: 35.690921,
    lng: 139.700258,
    resolvedLabel: 'Shinjuku Station'
  },
  'godzilla-head': {
    lat: 35.695098,
    lng: 139.701879,
    resolvedLabel: 'Godzilla Head, Hotel Gracery Shinjuku'
  },
  'golden-gai': {
    lat: 35.69384,
    lng: 139.704744,
    resolvedLabel: 'Shinjuku Golden Gai'
  },
  'omoide-yokocho': {
    lat: 35.69327,
    lng: 139.69957,
    resolvedLabel: 'Omoide Yokocho'
  },
  'selection-shinjuku': {
    lat: 35.696329,
    lng: 139.696117,
    resolvedLabel: 'Selection Shinjuku, Nishishinjuku'
  },
  'meiji-shrine': {
    lat: 35.674842,
    lng: 139.699627,
    resolvedLabel: 'Meiji Shrine'
  },
  'yoyogi-park': {
    lat: 35.671736,
    lng: 139.694944,
    resolvedLabel: 'Yoyogi Park'
  },
  'takeshita-street': {
    lat: 35.671707,
    lng: 139.704625,
    resolvedLabel: 'Takeshita Street, Harajuku'
  },
  harajuku: {
    lat: 35.670168,
    lng: 139.702687,
    resolvedLabel: 'Harajuku Station area'
  },
  'gotokuji-temple': {
    lat: 35.653389,
    lng: 139.647176,
    resolvedLabel: 'Gotokuji Temple'
  },
  'shibuya-sky': {
    lat: 35.65845,
    lng: 139.702164,
    resolvedLabel: 'SHIBUYA SKY'
  },
  setagaya: {
    lat: 35.646572,
    lng: 139.653247,
    resolvedLabel: 'Setagaya City'
  },
  'sensoji-temple': {
    lat: 35.714765,
    lng: 139.796655,
    resolvedLabel: 'Senso-ji Temple'
  },
  kaminarimon: {
    lat: 35.71109,
    lng: 139.796425,
    resolvedLabel: 'Kaminarimon Gate'
  },
  'ryogoku-kokugikan': {
    lat: 35.696983,
    lng: 139.793333,
    resolvedLabel: 'Ryogoku Kokugikan'
  },
  ryogoku: {
    lat: 35.696741,
    lng: 139.792091,
    resolvedLabel: 'Ryogoku Station area'
  },
  'nakamise-dori': {
    lat: 35.711922,
    lng: 139.796489,
    resolvedLabel: 'Nakamise-dori Street'
  },
  'chanko-ryogoku': {
    lat: 35.696741,
    lng: 139.792091,
    resolvedLabel: 'Ryogoku chanko-nabe area'
  },
  'hakone-shrine': {
    lat: 35.204902,
    lng: 139.026854,
    resolvedLabel: 'Hakone Shrine'
  },
  'fushimi-inari-taisha': {
    lat: 34.967146,
    lng: 135.772671,
    resolvedLabel: 'Fushimi Inari Taisha'
  },
  kinkakuji: {
    lat: 35.03937,
    lng: 135.729243,
    resolvedLabel: 'Kinkaku-ji'
  },
  ryoanji: {
    lat: 35.034494,
    lng: 135.718263,
    resolvedLabel: 'Ryoan-ji'
  },
  nanzenji: {
    lat: 35.011649,
    lng: 135.793881,
    resolvedLabel: 'Nanzen-ji'
  },
  tenryuji: {
    lat: 35.015901,
    lng: 135.673548,
    resolvedLabel: 'Tenryu-ji'
  },
  'sumiyoshi-taisha': {
    lat: 34.612872,
    lng: 135.493792,
    resolvedLabel: 'Sumiyoshi Taisha'
  },
  'todai-ji': {
    lat: 34.688985,
    lng: 135.839816,
    resolvedLabel: 'Todai-ji'
  },
  'kimpton-shinjuku': {
    lat: 35.68556,
    lng: 139.692286,
    resolvedLabel: 'Kimpton Shinjuku Tokyo'
  },
  'hotel-indigo-hakone-gora': {
    lat: 35.252675,
    lng: 139.050497,
    resolvedLabel: 'Hotel Indigo Hakone Gora'
  },
  'hilton-kyoto': {
    lat: 35.009989,
    lng: 135.769486,
    resolvedLabel: 'Hilton Kyoto'
  },
  'ryotei-rangetsu': {
    lat: 35.013035,
    lng: 135.676617,
    resolvedLabel: 'Ryotei Rangetsu, Arashiyama'
  },
  'intercontinental-osaka': {
    lat: 34.706525,
    lng: 135.494557,
    resolvedLabel: 'InterContinental Osaka'
  },
  'ana-intercontinental-ishigaki': {
    lat: 24.334208,
    lng: 124.185055,
    resolvedLabel: 'ANA InterContinental Ishigaki Resort'
  },
  'intercontinental-tokyo-bay': {
    lat: 35.653057,
    lng: 139.762218,
    resolvedLabel: 'InterContinental Tokyo Bay'
  }
};

function resolveCuratedPlace(entry: ResolveRequest): ResolveResponse {
  if (!entry.canonicalKey) return null;

  const curated = CURATED_PLACES[entry.canonicalKey];
  return curated ? { ...curated, source: 'curated' } : null;
}

async function resolveGoogleLink(sourceUrl: string, fetcher: typeof fetch): Promise<ResolveResponse> {
  try {
    const response = await fetcher(sourceUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'user-agent': 'Zen itinerary resolver/0.1'
      }
    });

    const resolvedUrl = response.url || sourceUrl;
    const coords = parseGoogleMapsCoordinates(resolvedUrl);
    if (coords) {
      return { ...coords, source: 'google-link' };
    }

    const body = await response.text();
    const bodyCoords = parseGoogleMapsCoordinates(body);
    if (bodyCoords) {
      return { ...bodyCoords, source: 'google-link' };
    }
  } catch {
    return null;
  }

  return null;
}

async function geocodePhoton(query: string, fetcher: typeof fetch): Promise<ResolveResponse> {
  const url = new URL('https://photon.komoot.io/api/');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '1');
  url.searchParams.set('lang', 'en');

  try {
    const response = await fetcher(url, {
      headers: {
        'user-agent': 'Zen itinerary resolver/0.1'
      }
    });

    if (!response.ok) {
      return null;
    }

    const results = (await response.json()) as {
      features?: Array<{
        geometry?: { coordinates?: [number, number] };
        properties?: {
          name?: string;
          city?: string;
          district?: string;
          state?: string;
          country?: string;
        };
      }>;
    };

    const match = results.features?.[0];
    const coords = match?.geometry?.coordinates;
    if (!coords) return null;

    const props = match.properties ?? {};
    const resolvedLabel = [props.name, props.district ?? props.city, props.state, props.country]
      .filter(Boolean)
      .join(', ');

    return {
      lat: coords[1],
      lng: coords[0],
      source: 'photon',
      resolvedLabel
    };
  } catch {
    return null;
  }
}

async function geocodeNominatim(query: string, fetcher: typeof fetch): Promise<ResolveResponse> {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');

  try {
    const response = await fetcher(url, {
      headers: {
        'user-agent': 'Zen itinerary resolver/0.1'
      }
    });

    if (!response.ok) {
      return null;
    }

    const results = (await response.json()) as Array<{
      lat: string;
      lon: string;
      display_name: string;
    }>;

    const match = results[0];
    if (!match) {
      return null;
    }

    return {
      lat: Number(match.lat),
      lng: Number(match.lon),
      source: 'nominatim',
      resolvedLabel: match.display_name
    };
  } catch {
    return null;
  }
}

export const POST: RequestHandler = async ({ request, fetch }) => {
  const payload = (await request.json()) as ResolveRequest[];

  const results = await Promise.all(
    payload.map(async (entry) => {
      const cacheKey = JSON.stringify(entry);
      const cached = cache.get(cacheKey);
      if (cached !== undefined) {
        return cached;
      }

      let resolved = resolveCuratedPlace(entry);

      if (!resolved && entry.sourceUrl) {
        resolved = await resolveGoogleLink(entry.sourceUrl, fetch);
      }

      if (!resolved) {
        resolved = await geocodePhoton(entry.query, fetch);
      }

      if (!resolved) {
        resolved = await geocodeNominatim(entry.query, fetch);
      }

      cache.set(cacheKey, resolved);
      return resolved;
    })
  );

  return json(results);
};
