<script lang="ts">
  import { onMount } from 'svelte';
  import type { GooglePlaceType, MapPlace, SavedPlaceCategory } from '$lib/types';
  import type {
    GeoJSONSource,
    LngLatBoundsLike,
    Map as MapLibreMap,
    MapGeoJSONFeature,
    Marker,
    Popup
  } from 'maplibre-gl';

  type MapLibreModule = typeof import('maplibre-gl');

  let {
    places = [],
    activePlaceId = '',
    onSelectPlace
  }: {
    places: MapPlace[];
    activePlaceId?: string;
    onSelectPlace?: (placeId: string) => void;
  } = $props();

  let container: HTMLDivElement;
  let map: MapLibreMap | null = null;
  let maplibre: MapLibreModule | null = null;
  let markers: Marker[] = [];
  let markerElements = new Map<string, HTMLElement>();

  function clearMarkers() {
    for (const marker of markers) {
      marker.remove();
    }

    markers = [];
    markerElements = new Map();
  }

  function escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  const SAVED_GLYPHS: Record<SavedPlaceCategory, string> = {
    eat: 'F',
    coffee: 'C',
    night: 'N',
    shop: 'S',
    culture: 'A',
    nature: 'O',
    logistics: 'L',
    other: '+'
  };

  const TYPE_GLYPHS: Partial<Record<GooglePlaceType, string>> = {
    bakery: 'B',
    bar: 'B',
    cafe: 'C',
    department_store: 'D',
    food: 'F',
    garden: 'G',
    historic_site: 'H',
    lodging: 'H',
    meal_takeaway: 'Q',
    museum: 'M',
    natural_feature: 'N',
    night_club: 'N',
    park: 'P',
    place_of_worship: 'W',
    restaurant: 'R',
    shopping_mall: 'S',
    spa: 'O',
    stadium: 'S',
    store: 'S',
    tourist_attraction: 'A',
    train_station: 'T',
    transit_station: 'T',
    zoo: 'Z'
  };

  function markerGlyph(place: MapPlace): string {
    if (place.kind === 'saved') {
      return TYPE_GLYPHS[place.primaryType ?? 'other'] ?? SAVED_GLYPHS[place.savedCategory ?? 'other'];
    }
    if (place.kind === 'food') return '+';
    if (place.kind === 'hotel') return 'H';

    return String(place.order);
  }

  function markerClass(place: MapPlace): string {
    if (place.kind === 'saved') {
      return `zen-marker zen-marker--saved zen-marker--saved-${place.savedCategory ?? 'other'} ${
        place.storyHeadline ? 'zen-marker--story' : ''
      }`;
    }

    return `zen-marker zen-marker--${place.kind} ${place.storyHeadline ? 'zen-marker--story' : ''}`;
  }

  function updateActiveMarker() {
    for (const [placeId, element] of markerElements) {
      element.classList.toggle('zen-marker--active', placeId === activePlaceId);
    }
  }

  function distanceLabel(meters: number): string {
    if (meters < 1000) return `${Math.round(meters)} m`;

    return `${(meters / 1000).toFixed(1)} km`;
  }

  function popupMarkup(place: MapPlace): string {
    const badge = place.sourceColumns[0] ?? 'Place';
    const metaParts = [
      place.placeTypeLabel,
      place.storyHeadline,
      place.resolvedLabel,
      place.proximityLabel,
      place.distanceMeters !== undefined && place.nearestPlaceLabel && !place.proximityLabel
        ? `${distanceLabel(place.distanceMeters)} from ${place.nearestPlaceLabel}`
        : ''
    ].filter(Boolean);
    const meta = metaParts.length
      ? `<p class="zen-popup-meta">${escapeHtml(metaParts.join(' / '))}</p>`
      : '';

    return `
      <div class="zen-popup">
        <div class="zen-popup-badge">${escapeHtml(badge)}</div>
        <div class="zen-popup-title">${escapeHtml(place.label)}</div>
        ${meta}
      </div>
    `;
  }

  function renderMarkers(nextPlaces: MapPlace[]) {
    if (!map || !maplibre) return;

    clearMarkers();

    for (const place of nextPlaces) {
      const markerElement = document.createElement('button');
      markerElement.type = 'button';
      markerElement.className = markerClass(place);
      markerElement.setAttribute('aria-label', place.label);
      markerElement.innerHTML = `<span class="zen-marker__glyph">${markerGlyph(place)}</span>`;

      const popup = new maplibre.Popup({
        closeButton: false,
        closeOnClick: true,
        offset: 18,
        className: 'zen-map-popup'
      }).setHTML(popupMarkup(place));

      const marker = new maplibre.Marker({
        element: markerElement,
        anchor: 'center'
      })
        .setLngLat([place.lng, place.lat])
        .setPopup(popup)
        .addTo(map);

      markerElement.addEventListener('mouseenter', () => {
        marker.togglePopup();
      });

      markerElement.addEventListener('mouseleave', () => {
        if (marker.getPopup().isOpen()) {
          marker.togglePopup();
        }
      });

      markerElement.addEventListener('click', () => {
        onSelectPlace?.(place.id);
      });

      markers.push(marker);
      markerElements.set(place.id, markerElement);
    }

    updateActiveMarker();
  }

  function renderRoute(nextPlaces: MapPlace[]) {
    if (!map || !map.getStyle()) return;

    const activityTrack = nextPlaces
      .filter((place) => place.kind !== 'food' && place.kind !== 'saved')
      .sort((a, b) => a.order - b.order)
      .map((place) => [place.lng, place.lat]);

    const source = map.getSource('zen-route') as GeoJSONSource | undefined;
    const data = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: activityTrack
      }
    } as const;

    if (source) {
      source.setData(data);
      return;
    }

    map.addSource('zen-route', {
      type: 'geojson',
      data
    });

    map.addLayer({
      id: 'zen-route-glow',
      type: 'line',
      source: 'zen-route',
      paint: {
        'line-color': '#111827',
        'line-width': 7,
        'line-opacity': 0.08,
        'line-blur': 6
      }
    });

    map.addLayer({
      id: 'zen-route',
      type: 'line',
      source: 'zen-route',
      paint: {
        'line-color': '#2563EB',
        'line-width': 3,
        'line-opacity': 0.82
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round'
      }
    });
  }

  function fitMap(nextPlaces: MapPlace[]) {
    if (!map) return;

    renderMarkers(nextPlaces);
    renderRoute(nextPlaces);

    if (!nextPlaces.length) {
      map.easeTo({
        center: [139.6503, 35.6762],
        zoom: 4.2,
        bearing: 0,
        pitch: 26,
        duration: 900
      });
      return;
    }

    if (nextPlaces.length === 1) {
      map.flyTo({
        center: [nextPlaces[0].lng, nextPlaces[0].lat],
        zoom: 13.5,
        bearing: 0,
        pitch: 26,
        speed: 0.7,
        curve: 1.3
      });
      return;
    }

    const bounds = nextPlaces.reduce(
      (accumulator, place) => {
        accumulator.extend([place.lng, place.lat]);
        return accumulator;
      },
      new maplibre!.LngLatBounds([nextPlaces[0].lng, nextPlaces[0].lat], [nextPlaces[0].lng, nextPlaces[0].lat])
    );

    map.fitBounds(bounds as LngLatBoundsLike, {
      padding: {
        top: 92,
        right: 64,
        bottom: 92,
        left: 64
      },
      maxZoom: 13.8,
      bearing: 0,
      pitch: 26,
      duration: 1100
    });
  }

  onMount(() => {
    let disposed = false;

    void (async () => {
      const imported = await import('maplibre-gl');
      if (disposed) return;

      maplibre = imported;

      map = new imported.Map({
        container,
        style: 'https://tiles.stadiamaps.com/styles/alidade_smooth.json',
        center: [139.6503, 35.6762],
        zoom: 4.2,
        pitch: 26,
        bearing: 0,
        attributionControl: false,
        cooperativeGestures: false,
        dragPan: true,
        scrollZoom: true,
        boxZoom: true,
        doubleClickZoom: true,
        keyboard: true,
        touchZoomRotate: true
      });

      map.addControl(
        new imported.AttributionControl({
          compact: true
        }),
        'bottom-right'
      );

      map.addControl(
        new imported.NavigationControl({
          visualizePitch: true,
          showCompass: true,
          showZoom: true
        }),
        'top-right'
      );

      map.addControl(new imported.FullscreenControl(), 'top-right');
      map.addControl(
        new imported.ScaleControl({
          maxWidth: 110,
          unit: 'metric'
        }),
        'bottom-left'
      );

      map.on('load', () => {
        if (!map) return;

        try {
          if (map.getLayer('Water')) {
            map.setPaintProperty('Water', 'fill-color', 'rgb(216 229 237)');
          }
        } catch {
          // The hosted base style can change layer availability during boot; the tint is decorative.
        }

        fitMap(places);
      });

      map.on('click', (event) => {
        const features = map?.queryRenderedFeatures(event.point) ?? [];
        const placeFeature = features.find((feature) => feature.layer.id === 'zen-route') as
          | MapGeoJSONFeature
          | undefined;

        if (placeFeature) {
          event.preventDefault();
        }
      });
    })();

    return () => {
      disposed = true;
      clearMarkers();
      map?.remove();
      map = null;
    };
  });

  $effect(() => {
    fitMap(places);
  });

  $effect(() => {
    updateActiveMarker();

    const activePlace = places.find((place) => place.id === activePlaceId);
    if (map && activePlace) {
      map.easeTo({
        center: [activePlace.lng, activePlace.lat],
        zoom: Math.max(map.getZoom(), 14),
        pitch: 36,
        bearing: 0,
        duration: 650
      });
    }
  });
</script>

<div bind:this={container} class="h-full w-full"></div>
