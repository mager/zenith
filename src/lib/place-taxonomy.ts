import type { GooglePlaceType, SavedPlaceCategory } from './types';

export const GOOGLE_PLACE_TYPES: GooglePlaceType[] = [
  'japanese_restaurant',
  'sushi_restaurant',
  'ramen_restaurant',
  'restaurant',
  'seafood_restaurant',
  'steak_house',
  'cafe',
  'coffee_shop',
  'bar',
  'bakery',
  'dessert_shop',
  'ice_cream_shop',
  'confectionery',
  'meal_takeaway',
  'food',
  'place_of_worship',
  'historical_landmark',
  'cultural_landmark',
  'historic_site',
  'tourist_attraction',
  'museum',
  'garden',
  'park',
  'hiking_area',
  'scenic_point',
  'natural_feature',
  'store',
  'book_store',
  'gift_shop',
  'clothing_store',
  'electronics_store',
  'department_store',
  'shopping_mall',
  'market',
  'lodging',
  'spa',
  'stadium',
  'baseball_field',
  'zoo',
  'train_station',
  'subway_station',
  'transit_station',
  'travel_agency',
  'night_club',
  'point_of_interest',
  'establishment',
  'other'
];

const GOOGLE_PLACE_TYPE_SET = new Set<GooglePlaceType>(GOOGLE_PLACE_TYPES);

const PLACE_TYPE_LABELS: Record<GooglePlaceType, string> = {
  bakery: 'Bakery',
  bar: 'Bar',
  baseball_field: 'Baseball',
  book_store: 'Bookstore',
  cafe: 'Cafe',
  clothing_store: 'Clothing',
  coffee_shop: 'Coffee',
  confectionery: 'Sweets',
  cultural_landmark: 'Cultural landmark',
  department_store: 'Department store',
  dessert_shop: 'Dessert',
  electronics_store: 'Electronics',
  establishment: 'Place',
  food: 'Food',
  garden: 'Garden',
  gift_shop: 'Gift shop',
  hiking_area: 'Hike',
  historic_site: 'Historic site',
  historical_landmark: 'Historic landmark',
  ice_cream_shop: 'Ice cream',
  japanese_restaurant: 'Japanese food',
  lodging: 'Stay',
  market: 'Market',
  meal_takeaway: 'Quick bite',
  museum: 'Museum',
  natural_feature: 'Nature',
  night_club: 'Nightlife',
  park: 'Park',
  place_of_worship: 'Shrine or temple',
  point_of_interest: 'Point of interest',
  ramen_restaurant: 'Ramen',
  restaurant: 'Restaurant',
  scenic_point: 'Scenic view',
  seafood_restaurant: 'Seafood',
  shopping_mall: 'Shopping',
  spa: 'Onsen or spa',
  stadium: 'Stadium',
  steak_house: 'Steakhouse',
  store: 'Shop',
  subway_station: 'Subway',
  sushi_restaurant: 'Sushi',
  tourist_attraction: 'Attraction',
  train_station: 'Train station',
  transit_station: 'Transit',
  travel_agency: 'Travel',
  zoo: 'Wildlife',
  other: 'Other'
};

const CATEGORY_TYPES: Record<SavedPlaceCategory, GooglePlaceType[]> = {
  eat: ['restaurant', 'japanese_restaurant', 'food'],
  coffee: ['cafe', 'coffee_shop', 'food'],
  night: ['bar', 'night_club'],
  shop: ['store', 'shopping_mall'],
  culture: ['tourist_attraction', 'historical_landmark', 'historic_site'],
  nature: ['park', 'scenic_point', 'natural_feature'],
  logistics: ['transit_station', 'point_of_interest'],
  other: ['point_of_interest']
};

const TYPE_PATTERNS: Array<[GooglePlaceType, RegExp]> = [
  ['place_of_worship', /\b(shrine|jingu|jinja|taisha|temple|dera|ji\b|buddha|torii|inari)\b|神社|寺|寺院|大社|大仏|鳥居/i],
  ['historical_landmark', /\b(castle|palace|historic|old town|heritage|edo|meiji|samurai|cemetery|memorial|tokaido)\b|城|史跡|旧|墓地|霊園/i],
  ['museum', /\b(museum|gallery|teamlab|exhibition)\b|博物館|美術館|資料館/i],
  ['garden', /\b(garden|gyoen|teahouse|tea house|bamboo grove|philosopher'?s path)\b|庭園|御苑|茶屋|竹林/i],
  ['park', /\b(park|koen|monkey park)\b|公園/i],
  ['natural_feature', /\b(mount|mt\.?|fuji|lake|bay|beach|reef|falls|waterfall|river|gorge|forest|cape|island|mangrove|snorkel)\b|山|湖|湾|浜|海岸|滝|川|森|島|岬|渓谷/i],
  ['scenic_point', /\b(view|observatory|observation|lookout|panoramic|sunset)\b|展望|絶景|夕日/i],
  ['spa', /\b(onsen|spa|bath|ryokan)\b|温泉|銭湯|湯/i],
  ['lodging', /\b(hotel|resort|inn|ryotei|ryokan|intercontinental|hilton|kimpton|indigo)\b|ホテル|旅館|宿/i],
  ['bakery', /\b(bakery|bagel|patisserie|pastry|donut)\b|パン|ベーカリー/i],
  ['dessert_shop', /\b(dessert|crepe|mochi|sweets?)\b|甘味|和菓子|餅|団子|クレープ/i],
  ['cafe', /\b(cafe|coffee|kissaten|tea|matcha)\b|喫茶|珈琲|カフェ|抹茶/i],
  ['bar', /\b(bar|cocktail|speakeasy|whisky|beer|sake|izakaya|yokocho|golden gai)\b/i],
  ['sushi_restaurant', /\b(sushi|鮨|寿司)\b/i],
  ['ramen_restaurant', /\b(ramen|ラーメン)\b/i],
  ['japanese_restaurant', /\b(soba|udon|wagyu|yakitori|curry|okonomiyaki|takoyaki|tonkatsu|tempura|yakiniku|katsu|kaiseki|chanko|gyoza|unagi)\b|蕎麦|そば|うどん|焼鳥|焼肉|天ぷら|天麩羅|餃子|鰻|食堂|料理/i],
  ['restaurant', /\b(restaurant|bistro|grill|noodle|lunch|dinner|breakfast)\b|食堂|料理|レストラン/i],
  ['meal_takeaway', /\b(street food|market snacks|snacks|takeaway|outer market|depachika|konbini)\b/i],
  ['department_store', /\b(department store|depachika|isetan|yodobashi|biccamera)\b/i],
  ['market', /\b(market|ichiba|outer market)\b|市場|商店街/i],
  ['shopping_mall', /\b(mall|shopping arcade)\b/i],
  ['book_store', /\b(book|books|tsutaya)\b|書店|本屋/i],
  ['electronics_store', /\b(camera|biccamera|yodobashi|electronics)\b|カメラ|電器/i],
  ['store', /\b(shop|store|selection|pottery|workshop)\b|店|商店/i],
  ['baseball_field', /\b(koshien|baseball)\b/i],
  ['stadium', /\b(stadium|kokugikan|sumo tournament)\b|スタジアム|球場|国技館/i],
  ['zoo', /\b(zoo|wildlife|deer|monkey)\b/i],
  ['train_station', /\b(station|shinkansen|rail|train)\b/i],
  ['subway_station', /\b(subway|metro)\b/i],
  ['transit_station', /\b(airport|terminal|ferry|bus|line|express|rental car|parking)\b/i],
  ['travel_agency', /\b(rickshaw|tour|guided)\b/i],
  ['night_club', /\b(club|nightlife|neon)\b/i],
  ['tourist_attraction', /\b(sky|tower|crossing|bridge|ropeway|observatory|observation|canal|dori|street|village)\b/i]
];

function uniqueTypes(types: GooglePlaceType[]): GooglePlaceType[] {
  return Array.from(new Set(types));
}

export function isGooglePlaceType(value: string): value is GooglePlaceType {
  return GOOGLE_PLACE_TYPE_SET.has(value as GooglePlaceType);
}

export function googlePlaceTypeLabel(type: GooglePlaceType | undefined): string {
  return type ? PLACE_TYPE_LABELS[type] : PLACE_TYPE_LABELS.other;
}

export function categoryPlaceTypes(category: SavedPlaceCategory | undefined): GooglePlaceType[] {
  return category ? CATEGORY_TYPES[category] : ['point_of_interest'];
}

export function inferGooglePlaceTypes(
  input: string,
  category?: SavedPlaceCategory,
  explicitTypes: GooglePlaceType[] = []
): GooglePlaceType[] {
  const inferred = TYPE_PATTERNS.flatMap(([type, pattern]) => (pattern.test(input) ? [type] : []));
  const categoryTypes = categoryPlaceTypes(category);
  const types = uniqueTypes([...explicitTypes, ...inferred, ...categoryTypes]);

  return types.length ? types : ['point_of_interest'];
}

export function primaryPlaceType(
  types: GooglePlaceType[] | undefined,
  category?: SavedPlaceCategory
): GooglePlaceType {
  const nextTypes = types?.length ? types : categoryPlaceTypes(category);

  return nextTypes[0] ?? 'point_of_interest';
}

export function collectGooglePlaceTypesFromUnknown(value: unknown, output = new Set<GooglePlaceType>()): GooglePlaceType[] {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (isGooglePlaceType(normalized)) {
      output.add(normalized);
    }
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectGooglePlaceTypesFromUnknown(item, output);
    }
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      collectGooglePlaceTypesFromUnknown(item, output);
    }
  }

  return Array.from(output);
}

export function isHistoricPlaceType(types: GooglePlaceType[] | undefined): boolean {
  return Boolean(
    types?.some((type) =>
      [
        'place_of_worship',
        'historic_site',
        'historical_landmark',
        'cultural_landmark',
        'museum',
        'garden',
        'tourist_attraction'
      ].includes(type)
    )
  );
}

export function isFoodPlaceType(types: GooglePlaceType[] | undefined): boolean {
  return Boolean(
    types?.some((type) =>
      [
        'restaurant',
        'japanese_restaurant',
        'sushi_restaurant',
        'ramen_restaurant',
        'seafood_restaurant',
        'steak_house',
        'cafe',
        'coffee_shop',
        'bar',
        'bakery',
        'dessert_shop',
        'ice_cream_shop',
        'confectionery',
        'meal_takeaway',
        'food'
      ].includes(type)
    )
  );
}
