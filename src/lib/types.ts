export type PlaceKind = 'activity' | 'food';

export type PlaceCandidate = {
  id: string;
  label: string;
  query: string;
  sourceUrl?: string;
  kind: PlaceKind;
  order: number;
};

export type ResolvedPlace = PlaceCandidate & {
  lat: number;
  lng: number;
  source: 'google-link' | 'nominatim';
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
  activities: PlaceCandidate[];
  foods: PlaceCandidate[];
};
