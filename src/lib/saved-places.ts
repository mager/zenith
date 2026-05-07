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
  ['coffee', /\b(coffee|cafe|kissaten|tea|matcha|bakery|bagel|dessert|ice cream|crepe|patisserie|donut)\b|喫茶|珈琲|カフェ|抹茶|甘味|和菓子/i],
  [
    'eat',
    /\b(ramen|sushi|soba|udon|steak|wagyu|yakitori|izakaya|restaurant|curry|pizza|okonomiyaki|takoyaki|tonkatsu|tempura|yakiniku|katsu|mochi|diner|bistro|grill|food|breakfast|lunch|dinner|chanko|gyoza|unagi|kaiseki)\b|鮨|寿司|ラーメン|蕎麦|そば|うどん|焼鳥|焼肉|天ぷら|天麩羅|餃子|鰻|食堂|料理/i
  ],
  [
    'shop',
    /\b(camera|biccamera|yodobashi|isetan|selection|market|mall|store|shop|shopping|book|tsutaya|depachika|pottery|workshop)\b|市場|商店|百貨店|書店|本屋|店/i
  ],
  [
    'logistics',
    /\b(station|airport|terminal|hotel|ryokan|stadium|ferry|bus|train|rental|parking|office)\b|駅|空港|ホテル|旅館|港|フェリー|球場|駐車場/i
  ],
  [
    'culture',
    /\b(shrine|temple|jingu|museum|castle|palace|gate|gion|senso|fushimi|inari|bamboo|historic|cemetery|memorial|monkey park)\b|神社|寺|寺院|大社|宮|城|仏|大仏|史跡|博物館|美術館|資料館|竹林/i
  ],
  [
    'nature',
    /\b(park|garden|beach|island|bay|falls|ropeway|lake|forest|mount|trail|observatory|observation|cape|reef|snorkel|waterfall|river|gorge)\b|公園|庭園|山|湖|湾|浜|海岸|滝|川|森|島|岬|渓谷|展望/i
  ]
];

export function inferSavedPlaceCategory(input: string): SavedPlaceCategory {
  const normalized = input.replace(/[_-]+/g, ' ');
  const match = CATEGORY_PATTERNS.find(([, pattern]) => pattern.test(normalized));

  return match?.[0] ?? 'other';
}

export function savedCategoryLabel(category: SavedPlaceCategory): string {
  return SAVED_PLACE_CATEGORY_LABELS[category] ?? SAVED_PLACE_CATEGORY_LABELS.other;
}
