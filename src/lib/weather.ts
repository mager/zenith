export type WeatherTone = 'clear' | 'cloud' | 'fog' | 'rain' | 'storm' | 'snow';

export type CurrentWeather = {
  time: string;
  temperatureF?: number;
  apparentTemperatureF?: number;
  relativeHumidity?: number;
  precipitationIn?: number;
  weatherCode?: number;
  summary: string;
  tone: WeatherTone;
  windMph?: number;
  windGustMph?: number;
  isDay?: boolean;
};

export type DailyWeather = {
  date: string;
  highF?: number;
  lowF?: number;
  apparentHighF?: number;
  apparentLowF?: number;
  precipitationProbability?: number;
  precipitationIn?: number;
  weatherCode?: number;
  summary: string;
  tone: WeatherTone;
  windMph?: number;
  windGustMph?: number;
  uvIndex?: number;
};

export type CityWeather = {
  city: string;
  label: string;
  lat: number;
  lng: number;
  timezone?: string;
  current?: CurrentWeather;
  daily: DailyWeather[];
  forecastStart?: string;
  forecastEnd?: string;
  packingNotes: string[];
  updatedAt: string;
  source: 'open-meteo';
};

export type ItineraryDayWeather = {
  dayId: string;
  city: string;
  dateLabel: string;
  isoDate?: string;
  forecast?: DailyWeather;
  source: 'forecast' | 'outside-window' | 'unavailable';
  message?: string;
};

export type TripWeatherResponse = {
  cities: CityWeather[];
  days: ItineraryDayWeather[];
  fetchedAt: string;
  source: 'open-meteo';
};

export function weatherToneForCode(code: number | undefined): WeatherTone {
  if (code === undefined) return 'cloud';
  if (code === 0) return 'clear';
  if ([1, 2, 3].includes(code)) return 'cloud';
  if ([45, 48].includes(code)) return 'fog';
  if ([95, 96, 99].includes(code)) return 'storm';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
  if (
    [
      51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82
    ].includes(code)
  ) {
    return 'rain';
  }

  return 'cloud';
}

export function describeWeatherCode(code: number | undefined): string {
  if (code === undefined) return 'Forecast';
  if (code === 0) return 'Clear';
  if (code === 1) return 'Mainly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if ([45, 48].includes(code)) return 'Fog';
  if ([51, 53, 55].includes(code)) return 'Drizzle';
  if ([56, 57].includes(code)) return 'Freezing drizzle';
  if ([61, 63].includes(code)) return 'Rain';
  if ([65, 82].includes(code)) return 'Heavy rain';
  if ([66, 67].includes(code)) return 'Freezing rain';
  if ([71, 73, 75].includes(code)) return 'Snow';
  if (code === 77) return 'Snow grains';
  if ([80, 81].includes(code)) return 'Showers';
  if ([85, 86].includes(code)) return 'Snow showers';
  if (code === 95) return 'Thunderstorm';
  if ([96, 99].includes(code)) return 'Storm with hail';

  return 'Forecast';
}

export function formatTemp(value: number | undefined): string {
  return value === undefined ? 'n/a' : `${Math.round(value)}°`;
}

export function formatPercent(value: number | undefined): string {
  return value === undefined ? 'n/a' : `${Math.round(value)}%`;
}

export function formatInches(value: number | undefined): string {
  if (value === undefined) return 'n/a';
  if (value < 0.01) return 'trace';

  return `${value.toFixed(2)} in`;
}

export function packingNotesForWeather(current: CurrentWeather | undefined, daily: DailyWeather[]): string[] {
  const notes: string[] = [];
  const relevantDays = daily.slice(0, 16);
  const high = Math.max(...relevantDays.map((day) => day.highF ?? Number.NEGATIVE_INFINITY));
  const low = Math.min(...relevantDays.map((day) => day.lowF ?? Number.POSITIVE_INFINITY));
  const wet = relevantDays.some(
    (day) => (day.precipitationProbability ?? 0) >= 45 || (day.precipitationIn ?? 0) >= 0.12
  );
  const windy = relevantDays.some((day) => (day.windGustMph ?? day.windMph ?? 0) >= 24);
  const strongSun = relevantDays.some((day) => (day.uvIndex ?? 0) >= 7);
  const storm = relevantDays.some((day) => day.tone === 'storm');
  const liveTemp = current?.temperatureF;

  if (Number.isFinite(high) && high >= 84) notes.push('Breathable layers');
  if (Number.isFinite(low) && low <= 55) notes.push('Light jacket');
  if (wet) notes.push('Compact umbrella');
  if (windy) notes.push('Wind shell');
  if (strongSun) notes.push('Sunscreen');
  if (storm) notes.push('Indoor backup');
  if (liveTemp !== undefined && liveTemp >= 86 && !notes.includes('Breathable layers')) {
    notes.push('Breathable layers');
  }

  return notes.slice(0, 4);
}
