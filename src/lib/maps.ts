const GOOGLE_MAPS_PATTERN =
  /\b(?:https?:\/\/)?(?:www\.)?(?:maps\.app\.goo\.gl|google\.[^/\s]+\/maps|maps\.google\.[^/\s]+|goo\.gl\/maps)[^\s,;)]*/gi;

const TRAILING_PUNCTUATION = /[.,;!?]+$/;

export function findGoogleMapsUrls(input: string): string[] {
  return Array.from(input.matchAll(GOOGLE_MAPS_PATTERN), (match) =>
    match[0].replace(TRAILING_PUNCTUATION, '')
  );
}

export function stripUrls(input: string): string {
  return input.replace(GOOGLE_MAPS_PATTERN, '').replace(/\s+/g, ' ').trim();
}

export function hasGoogleMapsUrl(input: string): boolean {
  return findGoogleMapsUrls(input).length > 0;
}

export function isGoogleMapsUrl(input: string): boolean {
  return /^(https?:\/\/)?(?:www\.)?(?:maps\.app\.goo\.gl|google\.[^/\s]+\/maps|maps\.google\.[^/\s]+|goo\.gl\/maps)/i.test(
    input.trim()
  );
}

export function parseGoogleMapsCoordinates(urlString: string): { lat: number; lng: number } | null {
  try {
    const url = new URL(urlString);
    const raw = `${url.pathname}${url.search}${url.hash}`;

    const atMatch = raw.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if (atMatch) {
      return { lat: Number(atMatch[1]), lng: Number(atMatch[2]) };
    }

    const coordMatch = raw.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
    if (coordMatch) {
      return { lat: Number(coordMatch[1]), lng: Number(coordMatch[2]) };
    }

    const q = url.searchParams.get('q') ?? url.searchParams.get('query') ?? '';
    const queryCoordMatch = q.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    if (queryCoordMatch) {
      return { lat: Number(queryCoordMatch[1]), lng: Number(queryCoordMatch[2]) };
    }

    const center = url.searchParams.get('center') ?? '';
    const centerCoordMatch = center.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    if (centerCoordMatch) {
      return { lat: Number(centerCoordMatch[1]), lng: Number(centerCoordMatch[2]) };
    }

    return null;
  } catch {
    return null;
  }
}
