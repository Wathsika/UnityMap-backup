import React, { useRef, useCallback, useMemo, useEffect } from 'react';
import { View, Platform } from 'react-native';
import tw from 'twrnc';

let WebView = null;
if (Platform.OS !== 'web') {
  try {
    WebView = require('react-native-webview').WebView;
  } catch (e) {}
}

/**
 * Basemap provider selection (keyless by default).
 * - `esri` (default): Esri World Street Map + World Imagery satellite toggle +
 *   Dark Gray canvas for high-contrast mode. No key, no signup.
 * - `carto`: CARTO Voyager raster. Requires EXPO_PUBLIC_CARTO_KEY (free at
 *   carto.com/basemaps/apikey) since CARTO blocked keyless tiles on 25 Sep 2026.
 * - `osm`: OpenStreetMap standard tiles. Keyless, but strict tile-usage policy
 *   (may 403 inside WebViews without a Referer) — kept as fallback only.
 */
const TILE_MODE = (() => {
  try {
    const m = String(process.env?.EXPO_PUBLIC_MAP_TILES || 'esri').toLowerCase().trim();
    return ['esri', 'carto', 'osm'].includes(m) ? m : 'esri';
  } catch (e) {
    return 'esri';
  }
})();

const CARTO_KEY = (() => {
  try {
    return String(process.env?.EXPO_PUBLIC_CARTO_KEY || '').trim();
  } catch (e) {
    return '';
  }
})();

/**
 * BaseMap.js - Free Styled OpenStreetMap Component
 * Powered by Leaflet & Tailwind CSS styling. Supports Web & Native platforms.
 * Features:
 * - Real-time mobile phone GPS positioning with animated panning
 * - Preserves user location without hijacking center to distant database nodes
 * - Live MongoDB Markers & Pathways rendering
 * - Active Route polyline highlighting via injectJavaScript (no WebView reload)
 * - Tap-to-Route: dynamically draws / clears polyline + destination marker
 */
const BaseMap = ({
  center = [6.9271, 79.8612],
  zoom = 16,
  markers = [],
  routes = [],
  pathways = [],
  activeRouteId = null,
  autoFitBounds = false,
  userLocation = null,
  userHeading = 0,
  autoCenter = false,
  onMapClick,
  onRouteClick,
  onMarkerClick,
  onLocationFound,
  onReady,
  style,
  isHighContrast = false,
  isReduceMotionEnabled = false,
  palette = null,
}) => {
  const webViewRef = useRef(null);
  // Track last injected route id so we only re-inject when it truly changes.
  const lastInjectedRouteRef = useRef(null);
  // Store the latest route script so we can replay it after WebView loads.
  const pendingRouteScriptRef = useRef(null);
  const isWebViewReadyRef = useRef(false);

  // Normalize center: [lat, lng] or { latitude, longitude }
  const normalizedCenter = useMemo(() => {
    if (Array.isArray(center) && center.length >= 2 && !isNaN(center[0]) && !isNaN(center[1])) {
      return [Number(center[0]), Number(center[1])];
    }
    if (center && typeof center.latitude === 'number' && typeof center.longitude === 'number') {
      return [Number(center.latitude), Number(center.longitude)];
    }
    return [6.9271, 79.8612];
  }, [center]);

  const themeBg = palette?.background || (isHighContrast ? '#FFFFFF' : '#E9F1EE');
  const surface = palette?.surface || '#FFFFFF';
  const primary = palette?.primary || (isHighContrast ? '#005A91' : '#1E6F50');
  const cardBorder = palette?.cardBorder || (isHighContrast ? '#000000' : '#F1F5F9');
  const textPrimary = palette?.textPrimary || (isHighContrast ? '#000000' : '#1E293B');
  // CVD-safe semantic accents (HC) — fall back to standard map colors
  const pinError = palette?.error || '#DC2626';
  const pinWarning = palette?.warning || '#D97706';
  const pinSuccess = palette?.success || '#10B981';

  // Initial basemap: high-contrast users start on the dark canvas (readable),
  // everyone else on streets. In-map layer control allows switching anytime.
  const defaultBasemap = TILE_MODE === 'esri' && isHighContrast ? 'dark' : 'streets';

  // Leaflet basemap bootstrap script (injected into mapHtml, no backticks or
  // ${} inside — outer template would interpolate them).
  const basemapScript = useMemo(() => {
    const L = [];
    L.push("var ATTRIB_OSM = '© <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors';");
    L.push("var ATTRIB_ESRI = ATTRIB_OSM + ', Esri, TomTom, Garmin, FAO, NOAA, USGS';");
    L.push('var _baseLayers = {};');
    L.push('var _defaultBase = ' + JSON.stringify(defaultBasemap) + ';');
    if (TILE_MODE === 'carto' && CARTO_KEY) {
      L.push("var _carto = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=" + CARTO_KEY + "', { maxZoom: 20, subdomains: 'abcd', attribution: ATTRIB_OSM + ', © <a href=\"https://carto.com/attribution/\">CARTO</a>' });");
      L.push("_baseLayers = { 'Streets': _carto };");
      L.push("_carto.addTo(map);");
    } else if (TILE_MODE === 'osm' || (TILE_MODE === 'carto' && !CARTO_KEY)) {
      // OSM fallback (also used when CARTO mode lacks a key): keyless standard
      // tiles. Note OSM tile policy may 403 WebView requests without a Referer.
      L.push("var _osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: ATTRIB_OSM });");
      L.push("_baseLayers = { 'Streets': _osm };");
      L.push("_osm.addTo(map);");
    } else {
      // Esri default: streets + satellite (imagery + place labels) + dark canvas.
      // Esri order is {z}/{y}/{x} — NOT {z}/{x}/{y}.
      L.push("var _esriStreets = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: ATTRIB_ESRI });");
      L.push("var _esriSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: ATTRIB_ESRI });");
      L.push("var _esriSatRef = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 });");
      L.push("var _esriSatellite = L.layerGroup([_esriSat, _esriSatRef]);");
      L.push("var _esriDark = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: ATTRIB_ESRI });");
      L.push("var _esriDarkRef = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 });");
      L.push("var _esriDarkCanvas = L.layerGroup([_esriDark, _esriDarkRef]);");
      L.push("_baseLayers = { 'Streets': _esriStreets, 'Satellite': _esriSatellite, 'Dark canvas': _esriDarkCanvas };");
      L.push("var _initial = _defaultBase === 'dark' ? _esriDarkCanvas : _esriStreets;");
      L.push("_initial.addTo(map);");
      L.push("L.control.layers(_baseLayers, null, { position: 'topright', collapsed: true }).addTo(map);");
    }
    // RN-side switcher (no WebView reload): window.switchBasemap('satellite')
    L.push("window.switchBasemap = function(name) { try { var l = _baseLayers[name]; if (!l) return false; Object.keys(_baseLayers).forEach(function(k) { if (map.hasLayer(_baseLayers[k])) map.removeLayer(_baseLayers[k]); }); l.addTo(map); return true; } catch (e) { return false; } };");
    L.push("window.availableBasemaps = function() { try { return Object.keys(_baseLayers); } catch (e) { return []; } };");
    return L.join('\n    ');
  }, [defaultBasemap]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Static HTML: tile layer, CSS, user-dot, markers, pathways.
  // IMPORTANT: `routes` and `activeRouteId` are intentionally EXCLUDED from this
  // memo so the WebView is never reloaded when the tap-route changes.
  // Dynamic route drawing is done via injectJavaScript below.
  // ─────────────────────────────────────────────────────────────────────────────
  const mapHtml = useMemo(() => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>UnityMap Leaflet</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #map { height: 100%; width: 100%; background: ${themeBg}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; ${isHighContrast ? 'filter: contrast(1.25);' : ''} }
    
    .leaflet-control-attribution { font-size: 8px; opacity: 0.5; }
    .leaflet-bar { border: ${isHighContrast ? '2px solid #000000' : 'none'} !important; box-shadow: ${isHighContrast ? 'none' : '0 4px 12px rgba(0,0,0,0.1)'} !important; }
    .leaflet-bar a { background: ${surface} !important; color: ${primary} !important; border-bottom: 1px solid ${cardBorder} !important; }

    /* Custom Pin Marker Wrapper */
    .custom-pin {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      ${isReduceMotionEnabled ? '' : 'transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);'}
    }
    .custom-pin:active { transform: ${isReduceMotionEnabled ? 'none' : 'scale(1.15)'}; }

    /* Pin bubble */
    .pin-bubble {
      width: 38px;
      height: 38px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #FFFFFF;
      box-shadow: 0 4px 12px rgba(0,0,0,0.22);
      position: relative;
    }
    
    /* Pin pointer arrow */
    .pin-bubble::after {
      content: '';
      position: absolute;
      bottom: -5px;
      left: 50%;
      transform: translateX(-50%);
      width: 0;
      height: 0;
      border-left: 6px solid transparent;
      border-right: 6px solid transparent;
      border-top: 6px solid currentColor;
    }

    .pin-bubble.orange { background: ${isHighContrast ? pinWarning : '#F59E0B'}; color: ${isHighContrast ? pinWarning : '#F59E0B'}; ${isHighContrast ? 'border: 2px solid #000000;' : ''} }
    .pin-bubble.orange svg { stroke: #FFFFFF; fill: none; }

    .pin-bubble.red { background: ${isHighContrast ? pinError : '#EF4444'}; color: ${isHighContrast ? pinError : '#EF4444'}; ${isHighContrast ? 'border: 2px solid #000000;' : ''} }
    .pin-bubble.red svg { stroke: #FFFFFF; fill: #FFFFFF; }

    .pin-bubble.green { background: ${isHighContrast ? pinSuccess : '#10B981'}; color: ${isHighContrast ? pinSuccess : '#10B981'}; ${isHighContrast ? 'border: 2px solid #000000;' : ''} }
    .pin-bubble.green svg { stroke: #FFFFFF; fill: none; }

    .pin-bubble.amber { background: ${isHighContrast ? pinWarning : '#D97706'}; color: ${isHighContrast ? pinWarning : '#D97706'}; ${isHighContrast ? 'border: 2px solid #000000;' : ''} }
    .pin-bubble.amber svg { stroke: #FFFFFF; fill: none; }

    .pin-bubble.node { background: ${isHighContrast ? pinSuccess : '#059669'}; color: ${isHighContrast ? pinSuccess : '#059669'}; ${isHighContrast ? 'border: 2px solid #000000;' : ''} }
    .pin-bubble.node svg { stroke: #FFFFFF; fill: none; }

    .pin-bubble.elevator { background: ${isHighContrast ? pinSuccess : '#065F46'}; color: ${isHighContrast ? pinSuccess : '#065F46'}; ${isHighContrast ? 'border: 2px solid #000000;' : ''} }
    .pin-bubble.elevator svg { stroke: #FFFFFF; fill: none; }

    .pin-bubble.obstacle { background: ${isHighContrast ? pinError : '#DC2626'}; color: ${isHighContrast ? pinError : '#DC2626'}; ${isHighContrast ? 'border: 2px solid #000000;' : ''} }
    .pin-bubble.obstacle svg { stroke: #FFFFFF; fill: none; }

    .pin-bubble.destination { background: ${isHighContrast ? primary : '#0B3D2E'}; color: ${isHighContrast ? primary : '#0B3D2E'}; ${isHighContrast ? 'border: 2px solid #000000;' : ''} }
    .pin-bubble.destination svg { stroke: #FFFFFF; fill: none; }

    /* Floating label tags above pins */
    .pin-label-tag {
      position: absolute;
      top: -24px;
      background: ${isHighContrast ? '#000000' : '#334155'};
      color: #FFFFFF;
      font-size: 10px;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 6px;
      white-space: nowrap;
      box-shadow: ${isHighContrast ? 'none' : '0 2px 6px rgba(0,0,0,0.25)'};
      letter-spacing: 0.5px;
      display: flex;
      align-items: center;
      gap: 3px;
      ${isHighContrast ? 'border: 1px solid #FFFFFF;' : ''}
    }

    /* User GPS Pulsing Dot with Direction Cone */
    .user-marker-container {
      position: relative;
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .user-heading-cone {
      position: absolute;
      width: 0;
      height: 0;
      border-left: 7px solid transparent;
      border-right: 7px solid transparent;
      border-bottom: 16px solid ${isHighContrast ? pinSuccess : '#059669'};
      top: -4px;
      left: 11px;
      transform-origin: center 18px;
      opacity: 0.9;
      display: none;
      transition: transform 0.2s linear;
    }
    .user-dot {
      width: 22px;
      height: 22px;
      background: #FFFFFF;
      border: 4px solid ${isHighContrast ? pinSuccess : '#059669'};
      border-radius: 50%;
      box-shadow: ${isHighContrast ? `0 0 0 2px #000000, 0 0 0 6px rgba(0,0,0,0.6)` : '0 0 0 5px rgba(5, 150, 105, 0.3), 0 3px 8px rgba(0,0,0,0.3)'};
      animation: ${isReduceMotionEnabled ? 'none' : isHighContrast ? 'none' : 'pulse 2.2s infinite'};
    }
    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 rgba(5, 150, 105, 0.5); }
      70% { box-shadow: 0 0 0 16px rgba(5, 150, 105, 0); }
      100% { box-shadow: 0 0 0 0 rgba(5, 150, 105, 0); }
    }

    /* Popup Styling */
    .unity-popup .leaflet-popup-content-wrapper {
      background: ${surface};
      color: ${textPrimary};
      border-radius: 14px;
      box-shadow: ${isHighContrast ? 'none' : '0 10px 25px -5px rgba(0, 0, 0, 0.15)'};
      padding: 6px 10px;
      ${isHighContrast ? 'border: 2px solid #000000;' : ''}
    }
    .unity-popup .leaflet-popup-tip { background: ${surface}; }
    .popup-title { font-size: 13px; font-weight: 700; color: ${textPrimary}; margin-bottom: 2px; }
    .popup-sub { font-size: 11px; color: ${isHighContrast ? '#000000' : '#64748B'}; line-height: 1.4; }

    /* Tap-route animated dash */
    .tap-route-line {
      ${isReduceMotionEnabled ? '' : 'animation: dashOffset 20s linear infinite;'}
    }
    @keyframes dashOffset {
      to { stroke-dashoffset: -100; }
    }

    /* Basemap layer switcher: >=44px touch target, theme-aware */
    .leaflet-control-layers { background: ${surface}; color: ${textPrimary}; border-radius: 10px; ${isHighContrast ? 'border: 2px solid #000000;' : 'box-shadow: 0 4px 12px rgba(0,0,0,0.15); border: 1px solid ' + cardBorder + ';'} font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .leaflet-control-layers-toggle { width: 44px !important; height: 44px !important; }
    .leaflet-control-layers-expanded { padding: 10px 12px; font-size: 13px; font-weight: 600; }
    .leaflet-control-layers-expanded label { display: flex; align-items: center; gap: 8px; padding: 6px 2px; min-height: 44px; }
    .leaflet-control-layers-expanded input { width: 18px; height: 18px; }
    .leaflet-control-attribution { background: rgba(255,255,255,0.85) !important; color: #334155; padding: 2px 6px; }
    .leaflet-control-attribution a { color: #1E6F50; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    function sendMessageToApp(type, payload) {
      const dataStr = JSON.stringify({ type: type, payload: payload });
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(dataStr);
      } else if (window.parent) {
        window.parent.postMessage(dataStr, '*');
      }
    }

    const initialCenter = ${JSON.stringify(normalizedCenter)};
    const map = L.map('map', {
      center: initialCenter,
      zoom: ${zoom},
      zoomControl: false,
      attributionControl: true
    });

    window.mapInstance = map;

    // ── Basemap layers (keyless Esri default; see TILE_MODE above) ──────
    ${basemapScript}

    // ── User Location Marker ───────────────────────────────────────────
    const userIcon = L.divIcon({
      html: '<div class="user-marker-container"><div class="user-heading-cone"></div><div class="user-dot"></div></div>',
      className: '',
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });
    const userMarker = L.marker(initialCenter, { icon: userIcon, zIndexOffset: 1000 }).addTo(map);
    window.userMarker = userMarker;

    window.updateUserLocation = function(lat, lng, shouldPan, heading) {
      if (window.userMarker) {
        window.userMarker.setLatLng([lat, lng]);
        const el = window.userMarker.getElement();
        if (el) {
          const cone = el.querySelector('.user-heading-cone');
          if (cone) {
            if (typeof heading === 'number' && !isNaN(heading) && heading >= 0) {
              cone.style.display = 'block';
              cone.style.transform = 'rotate(' + heading + 'deg)';
            } else {
              cone.style.display = 'none';
            }
          }
        }
      }
      if (shouldPan && window.mapInstance) {
        window.mapInstance.panTo([lat, lng], { animate: true, duration: 0.6 });
      }
    };

    // Try webview-level geolocation as well
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(function(pos) {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        if (lat && lng) {
          window.updateUserLocation(lat, lng, false);
          sendMessageToApp('DEVICE_GPS', { latitude: lat, longitude: lng });
        }
      }, function(e) {}, { enableHighAccuracy: true, timeout: 6000 });
    }

    // ── 1. Markers from Database or Props ──────────────────────────────
    const activeMarkers = ${JSON.stringify(markers || [])};

    activeMarkers.forEach(pin => {
      let pinLat = pin.lat;
      let pinLng = pin.lng;

      if ((pinLat == null || pinLng == null) && pin.location && Array.isArray(pin.location.coordinates)) {
        pinLng = pin.location.coordinates[0];
        pinLat = pin.location.coordinates[1];
      }

      if (pinLat != null && pinLng != null && !isNaN(pinLat) && !isNaN(pinLng)) {
        const isObstacle = pin.type === 'obstacle' || !!pin.obstacleType;
        const isNode = pin.type === 'node';
        const isElevator = pin.type === 'elevator';

        let pinType = pin.type || 'green';
        if (isObstacle) {
          pinType = pin.obstacleType === 'construction' ? 'orange' : pin.obstacleType === 'stairs_only' ? 'red' : 'obstacle';
        } else if (isNode) {
          pinType = 'node';
        } else if (isElevator) {
          pinType = pin.isOperational === false ? 'red' : 'elevator';
        }

        let pinSvg = pin.iconSvg;
        if (!pinSvg) {
          if (isObstacle) {
            pinSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
          } else if (isElevator) {
            pinSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><rect x="4" y="2" width="16" height="20" rx="2"/><polyline points="8 10 12 6 16 10"/><polyline points="8 14 12 18 16 14"/></svg>';
          } else if (isNode) {
            pinSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>';
          } else {
            pinSvg = '<svg width="18" height="18" viewBox="0 0 24 24" stroke="white" fill="none" stroke-width="2"><circle cx="12" cy="12" r="8"/></svg>';
          }
        }

        const iconHtml = \`
          <div class="custom-pin">
            \${pin.tag ? '<div class="pin-label-tag">' + pin.tag + '</div>' : ''}
            <div class="pin-bubble \${pinType}">
              \${pinSvg}
            </div>
          </div>
        \`;

        const customIcon = L.divIcon({
          html: iconHtml,
          className: '',
          iconSize: [40, 48],
          iconAnchor: [20, 48]
        });

        const titleText = pin.title || pin.name || 'Location';
        const descText = pin.desc || (pin.obstacleType ? 'Hazard: ' + pin.obstacleType : '') || '';

        const marker = L.marker([pinLat, pinLng], { icon: customIcon })
          .bindPopup('<div class="popup-title">' + titleText + '</div><div class="popup-sub">' + descText + '</div>', { className: 'unity-popup' })
          .addTo(map);

        marker.on('click', function() {
          sendMessageToApp('MARKER_CLICK', { id: pin.id || pin._id, title: titleText });
        });
      }
    });

    // ── 2. Live Database Pathways ──────────────────────────────────────
    const dbPathways = ${JSON.stringify(pathways || [])};

    dbPathways.forEach(function(p) {
      let coords = null;
      if (p.geometry && Array.isArray(p.geometry.coordinates) && p.geometry.coordinates.length >= 2) {
        coords = p.geometry.coordinates.map(function(c) { return [c[1], c[0]]; });
      } else if (p.startNode && p.endNode && p.startNode.location && p.endNode.location) {
        const sCoord = p.startNode.location.coordinates;
        const eCoord = p.endNode.location.coordinates;
        if (Array.isArray(sCoord) && Array.isArray(eCoord)) {
          coords = [[sCoord[1], sCoord[0]], [eCoord[1], eCoord[0]]];
        }
      }

      if (coords && coords.length >= 2) {
        const isAccessible = p.isWheelchairAccessible !== false;
        let strokeColor = '#10B981';
        if (!isAccessible) {
          strokeColor = '#EF4444';
        } else if (p.pathType === 'walkway') {
          strokeColor = '#0B3D2E';
        } else if (p.pathType === 'elevator') {
          strokeColor = '#065F46';
        }

        const pathLine = L.polyline(coords, {
          color: strokeColor,
          weight: isAccessible ? 5 : 4,
          opacity: isAccessible ? 0.85 : 0.6,
          dashArray: isAccessible ? null : '6, 6',
          lineCap: 'round',
        }).addTo(map);

        const popupContent = \`
          <div class="popup-title">\${(p.pathType || 'Pathway').toUpperCase()}</div>
          <div class="popup-sub">
            \${p.distanceMeters ? p.distanceMeters + 'm • ' : ''}
            Incline: \${p.inclineDegrees != null ? p.inclineDegrees + '°' : '0°'}<br/>
            \${isAccessible ? '♿ Step-Free Accessible' : '⚠️ Not Wheelchair Accessible'}
          </div>
        \`;
        pathLine.bindPopup(popupContent, { className: 'unity-popup' });
      }
    });

    // Auto-fit all markers if requested (no active route yet)
    if (${autoFitBounds ? 'true' : 'false'}) {
      const allPoints = [];
      activeMarkers.forEach(function(m) {
        if (m.lat && m.lng) allPoints.push([m.lat, m.lng]);
      });
      if (allPoints.length >= 2) {
        try {
          map.fitBounds(L.latLngBounds(allPoints), { padding: [35, 35], maxZoom: 16 });
        } catch (e) {}
      }
    }

    // ── 3. Dynamic Route Layer (injected via injectJavaScript) ─────────
    // These window functions are called from React Native without reloading
    // the WebView. They draw/clear the tap-to-route polyline and destination pin.

    var _tapRouteLayer = null;
    var _destMarker = null;

    /**
     * Draw (or replace) the tap-route polyline.
     * @param {Array<[lat,lng]>} coords
     * @param {string} color  hex colour string, e.g. '#0B3D2E'
     * @param {boolean} fitBounds  whether to pan/zoom to fit the route
     */
    window.updateRoute = function(coords, color, fitBounds) {
      try {
        if (_tapRouteLayer) {
          map.removeLayer(_tapRouteLayer);
          _tapRouteLayer = null;
        }
        if (!Array.isArray(coords) || coords.length < 2) return;
        _tapRouteLayer = L.polyline(coords, {
          color: color || '#0B3D2E',
          weight: 6,
          opacity: 0.95,
          lineCap: 'round',
          lineJoin: 'round',
          bubblingMouseEvents: false,
          className: 'tap-route-line',
        }).addTo(map);

        _tapRouteLayer.on('click', function(e) {
          L.DomEvent.stopPropagation(e);
          sendMessageToApp('ROUTE_CLICK', { routeId: 'tap_route' });
        });

        if (fitBounds !== false) {
          try {
            map.fitBounds(_tapRouteLayer.getBounds(), { padding: [48, 48], maxZoom: 17, animate: true });
          } catch (_) {}
        }
      } catch(err) {}
    };

    /** Remove the active tap-route polyline from the map. */
    window.clearRoute = function() {
      try {
        if (_tapRouteLayer) {
          map.removeLayer(_tapRouteLayer);
          _tapRouteLayer = null;
        }
      } catch(err) {}
    };

    /**
     * Place (or move) the destination pin on the map.
     * @param {number} lat
     * @param {number} lng
     * @param {string} label  popup label text
     */
    window.setDestinationMarker = function(lat, lng, label) {
      try {
        if (_destMarker) {
          map.removeLayer(_destMarker);
          _destMarker = null;
        }
        const destSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><circle cx="12" cy="12" r="4" fill="white"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="10"/></svg>';
        const destHtml = \`<div class="custom-pin"><div class="pin-bubble destination">\${destSvg}</div></div>\`;
        const destIcon = L.divIcon({ html: destHtml, className: '', iconSize: [40, 48], iconAnchor: [20, 48] });
        _destMarker = L.marker([lat, lng], { icon: destIcon, zIndexOffset: 900 })
          .addTo(map);
        if (label) {
          _destMarker.bindPopup('<div class="popup-title">' + label + '</div><div class="popup-sub">Tapped destination</div>', { className: 'unity-popup' });
        }
      } catch(err) {}
    };

    /** Remove the destination pin from the map. */
    window.clearDestinationMarker = function() {
      try {
        if (_destMarker) {
          map.removeLayer(_destMarker);
          _destMarker = null;
        }
      } catch(err) {}
    };

    // ── 4. Map click → send to React Native ───────────────────────────
    map.on('click', function(e) {
      const payload = { lat: e.latlng.lat, lng: e.latlng.lng, latitude: e.latlng.lat, longitude: e.latlng.lng };
      sendMessageToApp('MAP_CLICK', payload);
    });
  </script>
</body>
</html>
  `, [
    normalizedCenter,
    zoom,
    themeBg,
    surface,
    primary,
    cardBorder,
    textPrimary,
    pinError,
    pinWarning,
    pinSuccess,
    isHighContrast,
    markers,
    pathways,
    autoFitBounds,
    isReduceMotionEnabled,
    basemapScript,
    // NOTE: `routes` and `activeRouteId` are intentionally omitted — route
    // changes are handled via injectJavaScript in the useEffect below.
  ]);

  // ── Inject user location pan without reloading ─────────────────────────────
  // ── Inject user location pan & heading without reloading ─────────────────────────────
  useEffect(() => {
    const lat = userLocation?.latitude ?? normalizedCenter?.[0];
    const lng = userLocation?.longitude ?? normalizedCenter?.[1];
    const heading =
      typeof userLocation?.heading === 'number' && userLocation.heading >= 0
        ? userLocation.heading
        : typeof userHeading === 'number' && userHeading >= 0
        ? userHeading
        : -1;

    if (webViewRef.current && typeof lat === 'number' && typeof lng === 'number') {
      const script = `if (typeof window.updateUserLocation === 'function') { window.updateUserLocation(${lat}, ${lng}, ${autoCenter ? 'true' : 'false'}, ${heading}); } true;`;
      if (Platform.OS !== 'web') {
        webViewRef.current.injectJavaScript(script);
      } else {
        const win = webViewRef.current?.contentWindow;
        if (win) {
          try {
            if (typeof win.updateUserLocation === 'function') {
              win.updateUserLocation(lat, lng, autoCenter, heading);
            } else {
              win.eval?.(script);
            }
          } catch (_) {}
        }
      }
    }
  }, [userLocation, normalizedCenter, autoCenter, userHeading]);

  // ── Inject route changes without reloading WebView ─────────────────────────
  const injectRouteScript = useCallback((script, activeRoute) => {
    if (Platform.OS !== 'web') {
      if (webViewRef.current && isWebViewReadyRef.current) {
        webViewRef.current.injectJavaScript(script);
      }
    } else {
      const win = webViewRef.current?.contentWindow;
      if (win) {
        try {
          if (activeRoute && Array.isArray(activeRoute.coordinates) && activeRoute.coordinates.length >= 2) {
            if (typeof win.updateRoute === 'function') {
              win.updateRoute(activeRoute.coordinates, activeRoute.color || '#0B3D2E', true);
            } else {
              win.eval?.(script);
            }
          } else {
            if (typeof win.clearRoute === 'function') win.clearRoute();
            if (typeof win.clearDestinationMarker === 'function') win.clearDestinationMarker();
            win.eval?.(script);
          }
        } catch (_) {}
      }
    }
  }, []);

  useEffect(() => {
    // Find the first selected route (tap route)
    const activeRoute = routes.find((r) => r.isSelected) || routes[0] || null;
    const routeKey = activeRoute && Array.isArray(activeRoute.coordinates) && activeRoute.coordinates.length >= 2
      ? `${activeRoute.id}_${activeRoute.coordinates.map((c) => `${Number(c[0]).toFixed(5)},${Number(c[1]).toFixed(5)}`).join(';')}`
      : 'none';

    if (routeKey === lastInjectedRouteRef.current) return; // already injected
    lastInjectedRouteRef.current = routeKey;

    let script;
    if (activeRoute && Array.isArray(activeRoute.coordinates) && activeRoute.coordinates.length >= 2) {
      const coordsJson = JSON.stringify(activeRoute.coordinates);
      const color = activeRoute.color || '#0B3D2E';
      script = `
        if (typeof window.updateRoute === 'function') {
          window.updateRoute(${coordsJson}, '${color}', true);
        }
        true;
      `;
    } else {
      script = `
        if (typeof window.clearRoute === 'function') { window.clearRoute(); }
        if (typeof window.clearDestinationMarker === 'function') { window.clearDestinationMarker(); }
        true;
      `;
    }

    // Always store as pending so onLoadEnd can replay it if WebView wasn't ready yet
    pendingRouteScriptRef.current = { script, activeRoute };
    injectRouteScript(script, activeRoute);
  }, [routes, injectRouteScript]);

  // ── Inject destination marker when routes are present ─────────────────────
  useEffect(() => {
    const activeRoute = routes.find((r) => r.isSelected) || routes[0] || null;
    if (!activeRoute || !Array.isArray(activeRoute.coordinates) || activeRoute.coordinates.length < 2) {
      return;
    }
    // The last coordinate in the route is the destination
    const last = activeRoute.coordinates[activeRoute.coordinates.length - 1];
    if (!Array.isArray(last) || last.length < 2) return;
    const [lat, lng] = last;
    const label = activeRoute.destName || 'Destination';
    const script = `
      if (typeof window.setDestinationMarker === 'function') {
        window.setDestinationMarker(${lat}, ${lng}, ${JSON.stringify(label)});
      }
      true;
    `;
    if (Platform.OS !== 'web') {
      if (webViewRef.current) {
        webViewRef.current.injectJavaScript(script);
      }
    } else {
      const win = webViewRef.current?.contentWindow;
      if (win) {
        try {
          if (typeof win.setDestinationMarker === 'function') {
            win.setDestinationMarker(lat, lng, label);
          } else {
            win.eval?.(script);
          }
        } catch (_) {}
      }
    }
  }, [routes]);

  const handleMessage = useCallback((event) => {
    try {
      const msg = typeof event.nativeEvent.data === 'string'
        ? JSON.parse(event.nativeEvent.data)
        : event.nativeEvent.data;

      if (msg.type === 'MAP_CLICK' && typeof onMapClick === 'function') {
        onMapClick(msg.payload);
      } else if (msg.type === 'ROUTE_CLICK' && typeof onRouteClick === 'function') {
        onRouteClick(msg.payload.routeId);
      } else if (msg.type === 'MARKER_CLICK' && typeof onMarkerClick === 'function') {
        onMarkerClick(msg.payload);
      } else if (msg.type === 'DEVICE_GPS' && typeof onLocationFound === 'function') {
        onLocationFound(msg.payload);
      }
    } catch (e) {}
  }, [onMapClick, onRouteClick, onMarkerClick, onLocationFound]);

  // Web window message listener
  useEffect(() => {
    if (Platform.OS === 'web') {
      const handleWebMsg = (event) => {
        try {
          const msg = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
          if (msg?.type === 'MAP_CLICK' && typeof onMapClick === 'function') {
            onMapClick(msg.payload);
          } else if (msg?.type === 'ROUTE_CLICK' && typeof onRouteClick === 'function') {
            onRouteClick(msg.payload.routeId);
          } else if (msg?.type === 'MARKER_CLICK' && typeof onMarkerClick === 'function') {
            onMarkerClick(msg.payload);
          } else if (msg?.type === 'DEVICE_GPS' && typeof onLocationFound === 'function') {
            onLocationFound(msg.payload);
          }
        } catch (e) {}
      };

      window.addEventListener('message', handleWebMsg);
      return () => window.removeEventListener('message', handleWebMsg);
    }
  }, [onMapClick, onRouteClick, onMarkerClick, onLocationFound]);

  if (Platform.OS === 'web') {
    return (
      <View style={[tw`flex-1 w-full h-full`, { backgroundColor: themeBg }, style]}>
        <iframe
          ref={webViewRef}
          title="UnityMap Leaflet OSM"
          srcDoc={mapHtml}
          style={{ width: '100%', height: '100%', border: 'none', backgroundColor: themeBg }}
          onLoad={() => {
            if (typeof onReady === 'function') onReady();
          }}
        />
      </View>
    );
  }

  if (!WebView) {
    return <View style={[tw`flex-1 w-full h-full`, { backgroundColor: themeBg }, style]} />;
  }

  return (
    <View style={[tw`flex-1 w-full h-full`, { backgroundColor: themeBg }, style]}>
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html: mapHtml }}
        style={[tw`flex-1`, { backgroundColor: themeBg }]}
        onMessage={handleMessage}
        onLoadEnd={() => {
          isWebViewReadyRef.current = true;
          if (typeof onReady === 'function') onReady();
          // Re-inject any route that was queued before the WebView was ready
          if (pendingRouteScriptRef.current) {
            const { script, activeRoute } = pendingRouteScriptRef.current;
            setTimeout(() => {
              if (webViewRef.current) {
                webViewRef.current.injectJavaScript(script);
              }
            }, 400);
          }
        }}
        mixedContentMode="always"
        geolocationEnabled
        scrollEnabled={false}
        bounces={false}
      />
    </View>
  );
};

export default BaseMap;
