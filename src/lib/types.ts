export type PlaceKind = 'idea' | 'food' | 'hotel' | 'saved';
export type PlaceSource = 'Ideas' | 'Must Eats' | 'Hotel';
export type PlaceConfidence = 'named' | 'inferred' | 'area' | 'search';
export type PlaceResolutionSource = 'curated' | 'google-link' | 'photon' | 'nominatim';
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
  distanceMeters?: number;
  nearestPlaceLabel?: string;
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
