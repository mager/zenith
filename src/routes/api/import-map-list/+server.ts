import { json } from '@sveltejs/kit';
import { parseGoogleMapsCoordinates } from '$lib/maps';
import {
  collectGooglePlaceTypesFromUnknown,
  inferGooglePlaceTypes,
  primaryPlaceType
} from '$lib/place-taxonomy';
import { inferSavedPlaceCategory } from '$lib/saved-places';
import type { SavedMapList, SavedMapPlace } from '$lib/types';
import type { RequestHandler } from './$types';

type ImportRequest = {
  url: string;
};

type FetchResult = {
  url: string;
  text: string;
};

const cache = new Map<string, SavedMapList>();

const USER_AGENT = 'Zen saved map list importer/0.1';

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripGoogleJsonPrefix(input: string): string {
  return input.replace(/^\)\]\}'\s*/, '').trim();
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function stableHash(input: string): string {
  let hash = 5381;

  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 33) ^ input.charCodeAt(index);
  }

  return (hash >>> 0).toString(36);
}

function isValidCoordinate(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function findCoordinateTuple(value: unknown): { lat: number; lng: number } | null {
  if (!Array.isArray(value)) return null;

  if (typeof value[2] === 'number' && typeof value[3] === 'number' && isValidCoordinate(value[2], value[3])) {
    return { lat: value[2], lng: value[3] };
  }

  for (const item of value) {
    const nested = findCoordinateTuple(item);
    if (nested) return nested;
  }

  return null;
}

function placeSearchUrl(place: Pick<SavedMapPlace, 'label' | 'address' | 'lat' | 'lng'>): string {
  const query = [place.label, place.address].filter(Boolean).join(', ') || `${place.lat},${place.lng}`;
  const url = new URL('https://www.google.com/maps/search/');
  url.searchParams.set('api', '1');
  url.searchParams.set('query', query);

  return url.toString();
}

function parseEntityEntry(entry: unknown, listId: string, listTitle: string): SavedMapPlace | null {
  if (!Array.isArray(entry) || !Array.isArray(entry[1]) || typeof entry[2] !== 'string') {
    return null;
  }

  const placeData = entry[1];
  const coords = findCoordinateTuple(placeData);
  const label = asString(entry[2]);

  if (!coords || !label) return null;

  const address = asString(placeData[4]) || asString(placeData[2]);
  const note = asString(entry[3]);
  const category = inferSavedPlaceCategory(`${label} ${address} ${note}`);
  const googlePlaceTypes = inferGooglePlaceTypes(
    `${label} ${address} ${note}`,
    category,
    collectGooglePlaceTypesFromUnknown(placeData)
  );
  const primaryType = primaryPlaceType(googlePlaceTypes, category);
  const key = `${label}-${coords.lat.toFixed(6)}-${coords.lng.toFixed(6)}`;
  const googleMapsUrl = placeSearchUrl({ label, address, lat: coords.lat, lng: coords.lng });

  return {
    id: `saved-${slugify(label) || 'place'}-${stableHash(key)}`,
    label,
    address: address || undefined,
    note: note || undefined,
    lat: coords.lat,
    lng: coords.lng,
    category,
    googlePlaceTypes,
    primaryType,
    googleMapsUrl,
    source: 'google-list',
    listId,
    listTitle
  };
}

function collectEntityEntries(value: unknown, listId: string, listTitle: string, places: Map<string, SavedMapPlace>) {
  const parsed = parseEntityEntry(value, listId, listTitle);

  if (parsed) {
    const key = `${parsed.label}-${parsed.lat.toFixed(6)}-${parsed.lng.toFixed(6)}`;
    places.set(key, parsed);
  }

  if (!Array.isArray(value)) return;

  for (const item of value) {
    collectEntityEntries(item, listId, listTitle, places);
  }
}

function extractListPreloadUrl(html: string, baseUrl: string): string {
  const hrefMatch = html.match(/href="([^"]*\/maps\/preview\/entitylist\/getlist[^"]*)"/i);
  if (!hrefMatch) return '';

  return new URL(decodeHtmlEntities(hrefMatch[1]), baseUrl).toString();
}

function extractTitle(html: string): string {
  const title = html.match(/<title>\s*([\s\S]*?)\s*<\/title>/i)?.[1] ?? '';

  return decodeHtmlEntities(title).replace(/\s+-\s+Google Maps\s*$/i, '').replace(/\s+/g, ' ').trim();
}

async function fetchText(fetcher: typeof fetch, url: string): Promise<FetchResult> {
  const response = await fetcher(url, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'user-agent': USER_AGENT
    }
  });

  if (!response.ok) {
    throw new Error('Google Maps did not return that list.');
  }

  return {
    url: response.url || url,
    text: await response.text()
  };
}

function parseListPayload(rawPayload: string, sourceUrl: string): SavedMapList {
  const payload = JSON.parse(stripGoogleJsonPrefix(rawPayload)) as unknown;
  const listEnvelope = Array.isArray(payload) && Array.isArray(payload[0]) ? payload[0] : [];
  const listId = asString((listEnvelope[0] as unknown[])?.[0]) || `list-${stableHash(sourceUrl)}`;
  const listTitle = asString(listEnvelope[4]) || 'Google Maps saved list';
  const canonicalUrl = asString((listEnvelope[2] as unknown[])?.[2]) || sourceUrl;
  const places = new Map<string, SavedMapPlace>();

  collectEntityEntries(payload, listId, listTitle, places);

  return {
    id: listId,
    title: listTitle,
    url: canonicalUrl,
    source: 'google-maps',
    importedAt: new Date().toISOString(),
    places: Array.from(places.values())
  };
}

function parseSingleMapPlace(page: FetchResult, originalUrl: string): SavedMapList | null {
  const coords = parseGoogleMapsCoordinates(page.url) ?? parseGoogleMapsCoordinates(page.text);
  if (!coords) return null;

  const title = extractTitle(page.text) || 'Saved map place';
  const category = inferSavedPlaceCategory(title);
  const googlePlaceTypes = inferGooglePlaceTypes(title, category);
  const place: SavedMapPlace = {
    id: `saved-${slugify(title) || 'place'}-${stableHash(`${title}-${coords.lat}-${coords.lng}`)}`,
    label: title,
    lat: coords.lat,
    lng: coords.lng,
    category,
    googlePlaceTypes,
    primaryType: primaryPlaceType(googlePlaceTypes, category),
    googleMapsUrl: placeSearchUrl({ label: title, lat: coords.lat, lng: coords.lng }),
    source: 'map-link',
    listTitle: 'Imported map link'
  };

  return {
    id: `map-link-${stableHash(originalUrl)}`,
    title: 'Imported map link',
    url: originalUrl,
    source: 'google-maps',
    importedAt: new Date().toISOString(),
    places: [place]
  };
}

export const POST: RequestHandler = async ({ request, fetch }) => {
  const { url } = (await request.json()) as ImportRequest;
  const trimmedUrl = url?.trim();

  if (!trimmedUrl) {
    return json({ message: 'Paste a Google Maps list link first.' }, { status: 400 });
  }

  const normalizedUrl = /^https?:\/\//i.test(trimmedUrl) ? trimmedUrl : `https://${trimmedUrl}`;
  const cached = cache.get(normalizedUrl);
  if (cached) {
    return json({ list: cached });
  }

  const page = await fetchText(fetch, normalizedUrl);
  const preloadUrl = extractListPreloadUrl(page.text, page.url);

  if (preloadUrl) {
    const listPayload = await fetchText(fetch, preloadUrl);
    const list = parseListPayload(listPayload.text, normalizedUrl);

    if (!list.places.length) {
      return json(
        { message: 'That Maps list opened, but no shared places were visible.' },
        { status: 422 }
      );
    }

    cache.set(normalizedUrl, list);
    return json({ list });
  }

  const singlePlace = parseSingleMapPlace(page, normalizedUrl);
  if (singlePlace) {
    cache.set(normalizedUrl, singlePlace);
    return json({ list: singlePlace });
  }

  return json(
    {
      message:
        'I could open that Maps link, but Google did not expose a shared list payload. Make sure the list is shared by link.'
    },
    { status: 422 }
  );
};
