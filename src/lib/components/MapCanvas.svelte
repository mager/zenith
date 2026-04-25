<script lang="ts">
  import { onMount } from 'svelte';
  import type { ResolvedPlace } from '$lib/types';
  import type {
    GeoJSONSource,
    LngLatBoundsLike,
    Map as MapLibreMap,
    MapGeoJSONFeature,
    Marker,
    Popup
  } from 'maplibre-gl';

  type MapLibreModule = typeof import('maplibre-gl');

  let { places = [] }: { places: ResolvedPlace[] } = $props();

  let container: HTMLDivElement;
  let map: MapLibreMap | null = null;
  let maplibre: MapLibreModule | null = null;
  let markers: Marker[] = [];

  function clearMarkers() {
    for (const marker of markers) {
      marker.remove();
    }

    markers = [];
  }

  function popupMarkup(place: ResolvedPlace): string {
    const badge = place.kind === 'food' ? 'Must Eat' : `Stop ${place.order}`;
    const meta = place.resolvedLabel ? `<p class="zen-popup-meta">${place.resolvedLabel}</p>` : '';

    return `
      <div class="zen-popup">
        <div class="zen-popup-badge">${badge}</div>
        <div class="zen-popup-title">${place.label}</div>
        ${meta}
      </div>
    `;
  }

  function renderMarkers(nextPlaces: ResolvedPlace[]) {
    if (!map || !maplibre) return;

    clearMarkers();

    for (const place of nextPlaces) {
      const markerElement = document.createElement('button');
      markerElement.type = 'button';
      markerElement.className = `zen-marker zen-marker--${place.kind}`;
      markerElement.setAttribute('aria-label', place.label);
      markerElement.innerHTML =
        place.kind === 'food'
          ? `<span class="zen-marker__glyph">+</span>`
          : `<span class="zen-marker__glyph">${place.order}</span>`;

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

      markers.push(marker);
    }
  }

  function renderRoute(nextPlaces: ResolvedPlace[]) {
    if (!map || !map.getStyle()) return;

    const activityTrack = nextPlaces
      .filter((place) => place.kind === 'activity')
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

  function fitMap(nextPlaces: ResolvedPlace[]) {
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
        cooperativeGestures: true
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
        'bottom-right'
      );

      map.on('load', () => {
        if (!map) return;

        map.setPaintProperty('Water', 'fill-color', '#d8e5ed');

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
</script>

<div bind:this={container} class="h-full w-full"></div>
