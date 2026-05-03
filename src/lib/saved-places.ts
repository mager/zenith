import type { SavedPlaceCategory } from './types';

export const SAVED_PLACE_CATEGORIES: SavedPlaceCategory[] = [
  'eat',
  'coffee',
  'night',
  'shop',
  'culture',
  'nature',
  'logistics',
  'other'
];

export const SAVED_PLACE_CATEGORY_LABELS: Record<SavedPlaceCategory, string> = {
  eat: 'Food',
  coffee: 'Coffee',
  night: 'Night',
  shop: 'Shops',
  culture: 'Culture',
  nature: 'Outdoors',
  logistics: 'Practical',
  other: 'Saved'
};

const CATEGORY_PATTERNS: Array<[SavedPlaceCategory, RegExp]> = [
  ['night', /\b(bar|cocktail|club|speakeasy|whisky|beer|sake|night|yokocho|golden gai)\b/i],
  ['coffee', /\b(coffee|cafe|kissaten|tea|matcha|bakery|bagel|dessert|ice cream|crepe|patisserie|donut)\b/i],
  [
    'eat',
    /\b(ramen|sushi|soba|udon|steak|wagyu|yakitori|izakaya|restaurant|curry|pizza|okonomiyaki|takoyaki|tonkatsu|tempura|yakiniku|katsu|mochi|diner|bistro|grill|food|breakfast|lunch|dinner|chanko|gyoza|unagi|kaiseki)\b/i
  ],
  [
    'shop',
    /\b(camera|biccamera|yodobashi|isetan|selection|market|mall|store|shop|shopping|book|tsutaya|depachika|pottery|workshop)\b/i
  ],
  [
    'culture',
    /\b(shrine|temple|jingu|museum|castle|palace|gate|gion|senso|fushimi|inari|bamboo|historic|cemetery|memorial|monkey park)\b/i
  ],
  [
    'nature',
    /\b(park|garden|beach|island|bay|falls|ropeway|lake|forest|mount|trail|observatory|observation|cape|reef|snorkel|waterfall|river|gorge)\b/i
  ],
  ['logistics', /\b(station|airport|terminal|hotel|ryokan|stadium|ferry|bus|train|rental|parking|office)\b/i]
];

export function inferSavedPlaceCategory(input: string): SavedPlaceCategory {
  const normalized = input.replace(/[_-]+/g, ' ');
  const match = CATEGORY_PATTERNS.find(([, pattern]) => pattern.test(normalized));

  return match?.[0] ?? 'other';
}

export function savedCategoryLabel(category: SavedPlaceCategory): string {
  return SAVED_PLACE_CATEGORY_LABELS[category] ?? SAVED_PLACE_CATEGORY_LABELS.other;
}
