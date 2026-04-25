import { findGoogleMapsUrls, stripUrls } from '$lib/maps';
import type { ItineraryDay, PlaceCandidate, PlaceKind } from '$lib/types';

type CsvRow = Record<string, string | undefined>;

const ITEM_SPLIT = /\s*[,;]\s*/;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function splitList(value: string): string[] {
  return value
    .split(ITEM_SPLIT)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildPlaceCandidate(
  row: CsvRow,
  label: string,
  kind: PlaceKind,
  order: number,
  prefix: string
): PlaceCandidate {
  const sourceUrl = findGoogleMapsUrls(label)[0];
  const cleanedLabel = stripUrls(label) || label.trim();
  const city = row.City?.trim() ?? '';
  const query = [cleanedLabel, city, 'Japan'].filter(Boolean).join(', ');

  return {
    id: `${prefix}-${kind}-${order}-${slugify(cleanedLabel || 'item')}`,
    label: cleanedLabel,
    query,
    sourceUrl,
    kind,
    order
  };
}

function parseActivities(row: CsvRow, prefix: string): PlaceCandidate[] {
  const rawActivities = row.Activity?.trim() || row.Ideas?.trim() || '';

  return splitList(rawActivities)
    .slice(0, 6)
    .map((label, index) => buildPlaceCandidate(row, label, 'activity', index + 1, prefix));
}

function parseFoods(row: CsvRow, prefix: string): PlaceCandidate[] {
  return splitList(row['Must Eats']?.trim() || '')
    .slice(0, 4)
    .map((label, index) => buildPlaceCandidate(row, label, 'food', index + 1, prefix));
}

function parsePhrases(row: CsvRow): string[] {
  return splitList(row['Essential Japanese']?.trim() || '');
}

export function normalizeItinerary(rows: CsvRow[]): ItineraryDay[] {
  return rows
    .filter((row) => (row.D ?? row.Day ?? '').trim())
    .map((row, index) => {
      const dayNumber = Number(row.D ?? index + 1);
      const prefix = `day-${dayNumber}`;

      return {
        id: prefix,
        dayNumber,
        date: row.Date?.trim() || '',
        weekday: row.Day?.trim() || '',
        city: row.City?.trim() || '',
        theme: row.Theme?.trim() || '',
        transportation: row.Transportation?.trim() || '',
        comments: row.Comments?.trim() || '',
        notes: row['Notes/Bookings']?.trim() || '',
        phrases: parsePhrases(row),
        activities: parseActivities(row, prefix),
        foods: parseFoods(row, prefix)
      };
    });
}
