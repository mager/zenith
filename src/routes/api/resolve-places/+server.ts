import { json } from '@sveltejs/kit';
import { parseGoogleMapsCoordinates } from '$lib/maps';
import type { RequestHandler } from './$types';

type ResolveRequest = {
  label: string;
  query: string;
  sourceUrl?: string;
};

type ResolveResponse = {
  lat: number;
  lng: number;
  source: 'google-link' | 'nominatim';
  resolvedLabel?: string;
} | null;

const cache = new Map<string, ResolveResponse>();

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

async function geocodeQuery(query: string, fetcher: typeof fetch): Promise<ResolveResponse> {
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

      let resolved: ResolveResponse = null;
      if (entry.sourceUrl) {
        resolved = await resolveGoogleLink(entry.sourceUrl, fetch);
      }

      if (!resolved) {
        resolved = await geocodeQuery(entry.query, fetch);
      }

      cache.set(cacheKey, resolved);
      return resolved;
    })
  );

  return json(results);
};
