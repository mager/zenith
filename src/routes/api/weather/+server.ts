import { json } from '@sveltejs/kit';
import {
  describeWeatherCode,
  packingNotesForWeather,
  weatherToneForCode
} from '$lib/weather';
import type {
  CityWeather,
  CurrentWeather,
  DailyWeather,
  ItineraryDayWeather,
  TripWeatherResponse
} from '$lib/weather';
import type { RequestHandler } from './$types';

type WeatherRequest = {
  days?: Array<{
    id: string;
    city: string;
    date?: string;
  }>;
};

type Location = {
  name: string;
  label: string;
  lat: number;
  lng: number;
  timezone?: string;
};

type OpenMeteoForecast = {
  timezone?: string;
  current?: Record<string, unknown>;
  daily?: Record<string, unknown[]>;
};

type OpenMeteoGeocode = {
  results?: Array<{
    name?: string;
    country?: string;
    admin1?: string;
    latitude?: number;
    longitude?: number;
    timezone?: string;
  }>;
};

const USER_AGENT = 'Zen travel weather/0.1';
const CACHE_TTL_MS = 1000 * 60 * 20;

const cityCache = new Map<string, Location>();
const weatherCache = new Map<string, { expiresAt: number; weather: CityWeather }>();

const JAPAN_CITY_COORDINATES: Record<string, Location> = {
  arashiyama: {
    name: 'Arashiyama',
    label: 'Arashiyama, Kyoto',
    lat: 35.0094,
    lng: 135.6668,
    timezone: 'Asia/Tokyo'
  },
  hakone: {
    name: 'Hakone',
    label: 'Hakone, Kanagawa',
    lat: 35.2324,
    lng: 139.1069,
    timezone: 'Asia/Tokyo'
  },
  ishigaki: {
    name: 'Ishigaki',
    label: 'Ishigaki, Okinawa',
    lat: 24.3407,
    lng: 124.1556,
    timezone: 'Asia/Tokyo'
  },
  kyoto: {
    name: 'Kyoto',
    label: 'Kyoto',
    lat: 35.0116,
    lng: 135.7681,
    timezone: 'Asia/Tokyo'
  },
  nara: {
    name: 'Nara',
    label: 'Nara',
    lat: 34.6851,
    lng: 135.8048,
    timezone: 'Asia/Tokyo'
  },
  osaka: {
    name: 'Osaka',
    label: 'Osaka',
    lat: 34.6937,
    lng: 135.5023,
    timezone: 'Asia/Tokyo'
  },
  tokyo: {
    name: 'Tokyo',
    label: 'Tokyo',
    lat: 35.6762,
    lng: 139.6503,
    timezone: 'Asia/Tokyo'
  }
};

function cityKey(city: string): string {
  return city.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function numberAt(values: unknown[] | undefined, index: number): number | undefined {
  const value = values?.[index];

  return isFiniteNumber(value) ? value : undefined;
}

function stringAt(values: unknown[] | undefined, index: number): string | undefined {
  const value = values?.[index];

  return typeof value === 'string' ? value : undefined;
}

function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function parseTripDate(label: string | undefined, now = new Date()): string | undefined {
  const value = label?.trim();
  if (!value) return undefined;

  const isoMatch = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const slashMatch = value.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!slashMatch) return undefined;

  const month = Number(slashMatch[1]);
  const day = Number(slashMatch[2]);
  let year = slashMatch[3] ? Number(slashMatch[3]) : now.getFullYear();
  if (year < 100) year += 2000;

  const candidate = new Date(year, month - 1, day);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 30);

  if (!slashMatch[3] && candidate < thirtyDaysAgo) {
    candidate.setFullYear(candidate.getFullYear() + 1);
  }

  return isoDate(candidate);
}

async function resolveCity(city: string, fetcher: typeof fetch): Promise<Location | null> {
  const key = cityKey(city);
  if (!key) return null;

  const staticLocation = JAPAN_CITY_COORDINATES[key];
  if (staticLocation) return staticLocation;

  const cached = cityCache.get(key);
  if (cached) return cached;

  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', `${city} Japan`);
  url.searchParams.set('count', '1');
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');

  const response = await fetcher(url, {
    headers: {
      'user-agent': USER_AGENT
    }
  });

  if (!response.ok) return null;

  const payload = (await response.json()) as OpenMeteoGeocode;
  const match = payload.results?.find(
    (result) => isFiniteNumber(result.latitude) && isFiniteNumber(result.longitude)
  );

  if (!match || !isFiniteNumber(match.latitude) || !isFiniteNumber(match.longitude)) return null;

  const location: Location = {
    name: city,
    label: [match.name, match.admin1, match.country].filter(Boolean).join(', '),
    lat: match.latitude,
    lng: match.longitude,
    timezone: match.timezone
  };

  cityCache.set(key, location);
  return location;
}

function mapCurrentWeather(raw: Record<string, unknown> | undefined): CurrentWeather | undefined {
  if (!raw) return undefined;

  const code = isFiniteNumber(raw.weather_code) ? raw.weather_code : undefined;

  return {
    time: typeof raw.time === 'string' ? raw.time : new Date().toISOString(),
    temperatureF: isFiniteNumber(raw.temperature_2m) ? raw.temperature_2m : undefined,
    apparentTemperatureF: isFiniteNumber(raw.apparent_temperature) ? raw.apparent_temperature : undefined,
    relativeHumidity: isFiniteNumber(raw.relative_humidity_2m) ? raw.relative_humidity_2m : undefined,
    precipitationIn: isFiniteNumber(raw.precipitation) ? raw.precipitation : undefined,
    weatherCode: code,
    summary: describeWeatherCode(code),
    tone: weatherToneForCode(code),
    windMph: isFiniteNumber(raw.wind_speed_10m) ? raw.wind_speed_10m : undefined,
    windGustMph: isFiniteNumber(raw.wind_gusts_10m) ? raw.wind_gusts_10m : undefined,
    isDay: isFiniteNumber(raw.is_day) ? raw.is_day === 1 : undefined
  };
}

function mapDailyWeather(raw: Record<string, unknown[]> | undefined): DailyWeather[] {
  if (!raw) return [];

  const times = raw.time;
  if (!Array.isArray(times)) return [];

  return times.flatMap((time, index) => {
    if (typeof time !== 'string') return [];

    const code = numberAt(raw.weather_code, index);

    return [
      {
        date: time,
        highF: numberAt(raw.temperature_2m_max, index),
        lowF: numberAt(raw.temperature_2m_min, index),
        apparentHighF: numberAt(raw.apparent_temperature_max, index),
        apparentLowF: numberAt(raw.apparent_temperature_min, index),
        precipitationProbability: numberAt(raw.precipitation_probability_max, index),
        precipitationIn: numberAt(raw.precipitation_sum, index),
        weatherCode: code,
        summary: describeWeatherCode(code),
        tone: weatherToneForCode(code),
        windMph: numberAt(raw.wind_speed_10m_max, index),
        windGustMph: numberAt(raw.wind_gusts_10m_max, index),
        uvIndex: numberAt(raw.uv_index_max, index)
      }
    ];
  });
}

async function fetchCityWeather(location: Location, fetcher: typeof fetch): Promise<CityWeather> {
  const cacheKey = `${location.lat.toFixed(4)},${location.lng.toFixed(4)}`;
  const cached = weatherCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.weather;

  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(location.lat));
  url.searchParams.set('longitude', String(location.lng));
  url.searchParams.set(
    'current',
    [
      'temperature_2m',
      'apparent_temperature',
      'relative_humidity_2m',
      'precipitation',
      'weather_code',
      'wind_speed_10m',
      'wind_gusts_10m',
      'is_day'
    ].join(',')
  );
  url.searchParams.set(
    'daily',
    [
      'weather_code',
      'temperature_2m_max',
      'temperature_2m_min',
      'apparent_temperature_max',
      'apparent_temperature_min',
      'precipitation_probability_max',
      'precipitation_sum',
      'wind_speed_10m_max',
      'wind_gusts_10m_max',
      'uv_index_max'
    ].join(',')
  );
  url.searchParams.set('temperature_unit', 'fahrenheit');
  url.searchParams.set('wind_speed_unit', 'mph');
  url.searchParams.set('precipitation_unit', 'inch');
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('forecast_days', '16');

  const response = await fetcher(url, {
    headers: {
      'user-agent': USER_AGENT
    }
  });

  if (!response.ok) {
    throw new Error(`Weather failed for ${location.name}.`);
  }

  const payload = (await response.json()) as OpenMeteoForecast;
  const current = mapCurrentWeather(payload.current);
  const daily = mapDailyWeather(payload.daily);
  const weather: CityWeather = {
    city: location.name,
    label: location.label,
    lat: location.lat,
    lng: location.lng,
    timezone: payload.timezone ?? location.timezone,
    current,
    daily,
    forecastStart: stringAt(payload.daily?.time, 0),
    forecastEnd: stringAt(payload.daily?.time, daily.length - 1),
    packingNotes: packingNotesForWeather(current, daily),
    updatedAt: new Date().toISOString(),
    source: 'open-meteo'
  };

  weatherCache.set(cacheKey, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    weather
  });

  return weather;
}

export const POST: RequestHandler = async ({ request, fetch }) => {
  const payload = (await request.json()) as WeatherRequest;
  const requestedDays = (payload.days ?? [])
    .map((day) => ({
      id: day.id,
      city: day.city.trim(),
      dateLabel: day.date?.trim() ?? '',
      isoDate: parseTripDate(day.date)
    }))
    .filter((day) => day.id && day.city);

  const uniqueCities = Array.from(new Map(requestedDays.map((day) => [cityKey(day.city), day.city])).values());

  try {
    const locations = (
      await Promise.all(uniqueCities.map((city) => resolveCity(city, fetch)))
    ).filter(Boolean) as Location[];

    const cities = await Promise.all(locations.map((location) => fetchCityWeather(location, fetch)));
    const cityWeatherByKey = new Map(cities.map((city) => [cityKey(city.city), city]));
    const days: ItineraryDayWeather[] = requestedDays.map((day) => {
      const city = cityWeatherByKey.get(cityKey(day.city));
      const forecast = city?.daily.find((entry) => entry.date === day.isoDate);

      if (!city) {
        return {
          dayId: day.id,
          city: day.city,
          dateLabel: day.dateLabel,
          isoDate: day.isoDate,
          source: 'unavailable',
          message: 'Weather location not found.'
        };
      }

      if (forecast) {
        return {
          dayId: day.id,
          city: day.city,
          dateLabel: day.dateLabel,
          isoDate: day.isoDate,
          forecast,
          source: 'forecast'
        };
      }

      return {
        dayId: day.id,
        city: day.city,
        dateLabel: day.dateLabel,
        isoDate: day.isoDate,
        source: 'outside-window',
        message: city.forecastEnd
          ? `Live current conditions shown. Daily forecast currently runs through ${city.forecastEnd}.`
          : 'Live current conditions shown.'
      };
    });

    const response: TripWeatherResponse = {
      cities,
      days,
      fetchedAt: new Date().toISOString(),
      source: 'open-meteo'
    };

    return json(response);
  } catch (error) {
    return json(
      {
        message: error instanceof Error ? error.message : 'Weather lookup failed.'
      },
      { status: 502 }
    );
  }
};
