import React from 'react';
import UnityMapScreen from './UnityMapScreen';

/**
 * OSM Map Canvas Screen
 * Delegates to UnityMapScreen which renders the full
 * Leaflet (WebView) interactive map on keyless Esri/OSM raster tiles.
 */
export const OSMCanvasScreen = () => <UnityMapScreen />;

export default OSMCanvasScreen;
