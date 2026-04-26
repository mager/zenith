export type PlaceKind = 'idea' | 'food' | 'transit' | 'comment' | 'booking';
export type PlaceSource = 'Ideas' | 'Must Eats' | 'Transportation' | 'Comments' | 'Notes/Bookings';
export type PlaceConfidence = 'named' | 'inferred' | 'area' | 'search';
export type PlaceResolutionSource = 'curated' | 'google-link' | 'photon' | 'nominatim';

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
  transitPlaces: PlaceCandidate[];
  commentPlaces: PlaceCandidate[];
  bookingPlaces: PlaceCandidate[];
};
