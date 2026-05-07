export type PlaceKind = 'idea' | 'food' | 'hotel' | 'saved';
export type PlaceSource = 'Ideas' | 'Must Eats' | 'Hotel';
export type PlaceConfidence = 'named' | 'inferred' | 'area' | 'search';
export type PlaceResolutionSource = 'curated' | 'google-link' | 'photon' | 'nominatim';
export type GooglePlaceType =
  | 'bakery'
  | 'bar'
  | 'baseball_field'
  | 'book_store'
  | 'cafe'
  | 'clothing_store'
  | 'coffee_shop'
  | 'confectionery'
  | 'cultural_landmark'
  | 'department_store'
  | 'dessert_shop'
  | 'electronics_store'
  | 'establishment'
  | 'food'
  | 'garden'
  | 'gift_shop'
  | 'hiking_area'
  | 'historic_site'
  | 'historical_landmark'
  | 'ice_cream_shop'
  | 'japanese_restaurant'
  | 'lodging'
  | 'market'
  | 'meal_takeaway'
  | 'museum'
  | 'natural_feature'
  | 'night_club'
  | 'park'
  | 'place_of_worship'
  | 'point_of_interest'
  | 'ramen_restaurant'
  | 'restaurant'
  | 'scenic_point'
  | 'seafood_restaurant'
  | 'shopping_mall'
  | 'spa'
  | 'stadium'
  | 'steak_house'
  | 'store'
  | 'subway_station'
  | 'sushi_restaurant'
  | 'tourist_attraction'
  | 'train_station'
  | 'transit_station'
  | 'travel_agency'
  | 'zoo'
  | 'other';
export type SavedPlaceCategory =
  | 'eat'
  | 'coffee'
  | 'night'
  | 'shop'
  | 'culture'
  | 'nature'
  | 'logistics'
  | 'other';

export type PlaceCandidate = {
  id: string;
  label: string;
  query: string;
  sourceUrl?: string;
  canonicalKey?: string;
  kind: PlaceKind;
  order: number;
  sourceColumns: PlaceSource[];
  sourceTexts: string[];
  detail?: string;
  confidence: PlaceConfidence;
};

export type ResolvedPlace = PlaceCandidate & {
  lat: number;
  lng: number;
  source: PlaceResolutionSource;
  resolvedLabel?: string;
};

export type SavedMapPlace = {
  id: string;
  label: string;
  address?: string;
  note?: string;
  lat: number;
  lng: number;
  category: SavedPlaceCategory;
  googlePlaceTypes?: GooglePlaceType[];
  primaryType?: GooglePlaceType;
  googleRating?: number;
  googleUserRatingCount?: number;
  googlePriceLevel?: number;
  googleBusinessStatus?: string;
  googleMapsUrl: string;
  source: 'google-list' | 'map-link' | 'manual';
  listId?: string;
  listTitle?: string;
};

export type SavedMapList = {
  id: string;
  title: string;
  url: string;
  source: 'google-maps';
  importedAt: string;
  places: SavedMapPlace[];
};

export type NearbySavedPlace = SavedMapPlace & {
  distanceMeters: number;
  nearestPlaceId: string;
  nearestPlaceLabel: string;
  routeDistanceMeters?: number;
  stayDistanceMeters?: number;
  stayPlaceId?: string;
  stayPlaceLabel?: string;
  proximity: 'route' | 'stay' | 'both';
};

export type MapPlace = {
  id: string;
  label: string;
  lat: number;
  lng: number;
  kind: PlaceKind;
  order: number;
  sourceColumns: string[];
  resolvedLabel?: string;
  savedCategory?: SavedPlaceCategory;
  googlePlaceTypes?: GooglePlaceType[];
  primaryType?: GooglePlaceType;
  placeTypeLabel?: string;
  distanceMeters?: number;
  routeDistanceMeters?: number;
  stayDistanceMeters?: number;
  nearestPlaceLabel?: string;
  proximityLabel?: string;
  storyHeadline?: string;
};

export type PlaceStoryProfile = {
  headline: string;
  era: string;
  context: string;
  whyVisit: string;
  visitCue?: string;
  ritualNote?: string;
  themes: string[];
};

export type PlaceEnrichmentRecord = {
  id: string;
  label: string;
  canonicalKey?: string;
  googlePlaceTypes: GooglePlaceType[];
  primaryType: GooglePlaceType;
  history?: PlaceStoryProfile;
  personalNote?: string;
  source: 'curated' | 'inferred' | 'manual' | 'firestore';
  updatedAt: string;
};

export type ItineraryDay = {
  id: string;
  dayNumber: number;
  date: string;
  weekday: string;
  city: string;
  theme: string;
  transportation: string;
  comments: string;
  notes: string;
  phrases: string[];
  places: PlaceCandidate[];
  activities: PlaceCandidate[];
  foods: PlaceCandidate[];
  hotel: string;
  hotelPlaces: PlaceCandidate[];
};
