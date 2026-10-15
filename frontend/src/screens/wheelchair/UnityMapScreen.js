import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  SafeAreaView,
  TouchableOpacity,
  StatusBar,
  ScrollView,
  Platform,
  Modal,
  ActivityIndicator,
} from 'react-native';
import tw from 'twrnc';
import { Feather, MaterialCommunityIcons, FontAwesome5, MaterialIcons } from '@expo/vector-icons';
import BaseMap from '../../components/BaseMap';
import Input from '../../components/Input';
import Button from '../../components/Button';
import SettingsScreen from '../settings/SettingsScreen';
import ThreeTapReportScreen from '../volunteer/ThreeTapReportScreen';
import AudioFirstLauncherScreen from '../audio/AudioFirstLauncherScreen';
import VoiceNavigationScreen from '../audio/VoiceNavigationScreen';
import SpokenGuidanceHazardWarningScreen from '../audio/SpokenGuidanceHazardWarningScreen';
import LiveTurnByTurnNavigationScreen from './LiveTurnByTurnNavigationScreen';
import { useTheme } from '../../theme/ThemeContext';
import { useSpeech } from '../../hooks/useSpeech';
import { getTextStyle, textProps } from '../../theme/typography';
import { useLocation } from '../../hooks/useLocation';
import {
  loadWheelchairAccessible,
  saveWheelchairAccessible,
  loadRecentSearches,
  saveRecentSearches,
  loadNodesCache,
  saveNodesCache,
} from '../../theme/storage';
import { warmCache } from '../../services/offlineVoiceCache';
import {
  getNodes,
  getObstacles,
  getPathways,
  getElevatorOverview,
  checkHealth,
  getNearestNode,
  getNearbyObstacles,
  getNearbyNodes,
  getRoute,
  getRoadRoute,
} from '../../services/api';
import {
  calculateWheelchairETA,
  calculateHaversineDistance,
  formatDistance,
  formatDuration,
  filterObstaclesNearRoute,
  computeRouteSafetyStatus,
  categorizeProximityFeatures,
} from '../../utils/mapMath';
import { searchExternalPlaces, searchLocalPlaces, getLocalPlaceById, wheelchairChip } from '../../services/placeSearchService';
import { rankPlaces, rankPlacesForTranscripts, chooseBestMatch } from '../../utils/placeMatcher';
import { SRI_LANKA_GAZETTEER, GAZETTEER_NAMES } from '../../data/sriLankaGazetteer';

/**
 * UnityMapScreen.js — Accessible Map & Real-time Live MongoDB Explorer
 * Features:
 * - 100% Real Live Node.js + MongoDB Data (Nodes, Obstacles, Pathways, Elevators)
 * - Bottom-left Floating Action Button (FAB) (>=48dp touch target)
 * - Interactive Drawer for Wheelchair Accessibility, Slope & Route Filters
 * - Clean top navbar with static banner removed
 * - Global High-Contrast WCAG 2.1 compliance
 */

/**
 * Category icon for universal place results (Google-Maps-style rows & card).
 * `icon` = { library: 'feather'|'material'|'fa5', name } from placeSearchService.
 */
const PlaceCategoryIcon = ({ icon, size = 16, color = '#1E6F50' }) => {
  const name = icon?.name || 'map-pin';
  if (icon?.library === 'material') return <MaterialIcons name={name} size={size} color={color} />;
  if (icon?.library === 'fa5') return <FontAwesome5 name={name} size={size - 2} color={color} />;
  return <Feather name={name} size={size} color={color} />;
};
const UnityMapScreen = () => {
  const [activeTab, setActiveTab] = useState('Map');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchExpanded, setIsSearchExpanded] = useState(true);
  const [isWheelchairAccessible, setIsWheelchairAccessible] = useState(true);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [maxSlope, setMaxSlope] = useState(8); // 5, 8, or null
  const [avoidConstruction, setAvoidConstruction] = useState(true);
  const [requireElevator, setRequireElevator] = useState(false);
  const [recentDestinations, setRecentDestinations] = useState([]);
  const [dbNodes, setDbNodes] = useState([]);
  const [dbObstacles, setDbObstacles] = useState([]);
  const [dbPathways, setDbPathways] = useState([]);
  const [dbElevators, setDbElevators] = useState([]);
  const [isBackendConnected, setIsBackendConnected] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [dataError, setDataError] = useState(null);
  const [mapCenter, setMapCenter] = useState([6.9271, 79.8612]);
  const [showLauncher, setShowLauncher] = useState(false);
  const [showVoiceSummary, setShowVoiceSummary] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [voiceConfidence, setVoiceConfidence] = useState(0);
  const [voiceRouteSummary, setVoiceRouteSummary] = useState(null);
  // "Did you mean…" candidates — only set when the spoken place is ambiguous
  const [voiceMatches, setVoiceMatches] = useState(null);
  const [voiceSelectedMatchId, setVoiceSelectedMatchId] = useState(null);
  const [showGuidance, setShowGuidance] = useState(false);
  const [tappedLocation, setTappedLocation] = useState(null);
  const [tapRoute, setTapRoute] = useState(null);
  const [tapRouteLoading, setTapRouteLoading] = useState(false);
  const [tapRouteMeta, setTapRouteMeta] = useState(null);
  const [tapRouteError, setTapRouteError] = useState(null);
  const [nearbyHazards, setNearbyHazards] = useState([]);
  const [nearbyAccessible, setNearbyAccessible] = useState([]);
  const [safetyStatus, setSafetyStatus] = useState(null);
  const [isTapSummarySheetVisible, setIsTapSummarySheetVisible] = useState(false);
  const [activeSheetCategory, setActiveSheetCategory] = useState('hazards');
  const [currentLocation, setCurrentLocation] = useState(null);
  const [isTurnByTurnActive, setIsTurnByTurnActive] = useState(false);
  const [activeNavRoute, setActiveNavRoute] = useState(null);
  // Universal place search (Nominatim via backend proxy, road distances only)
  const [externalResults, setExternalResults] = useState([]);
  const [isExternalSearching, setIsExternalSearching] = useState(false);
  const [externalError, setExternalError] = useState(null);
  // Local DB places table (~5k rows): search bar hits this FIRST, click → lat/lon from DB → map
  const [localResults, setLocalResults] = useState([]);
  const [isLocalSearching, setIsLocalSearching] = useState(false);
  const localRequestIdRef = React.useRef(0);
  // Google-Maps-style place detail card (set when an external result is tapped)
  const [selectedPlace, setSelectedPlace] = useState(null);
  const externalCacheRef = React.useRef(new Map());
  const externalRequestIdRef = React.useRef(0);

  const { palette, borderWidth, isHighContrast, isReduceMotionEnabled, isAudioLauncherEnabled, preferredSTTLocale } = useTheme();
  const { speak } = useSpeech();
  const { location, loading: locationLoading, recenter } = useLocation();

  // Best/selected voice destination — survives modal re-renders (not state, so
  // confirm never races an async setState).
  const voiceDestinationRef = React.useRef(null);

  // Only show launcher if enabled in Settings (not for every user)
  useEffect(() => {
    if (isAudioLauncherEnabled) {
      setShowLauncher(true);
    } else {
      setShowLauncher(false);
    }
  }, [isAudioLauncherEnabled]);

  // SPT-303: Warm offline cache (key subset prompts/cues earcons via FileSystem + nodes)
  useEffect(() => {
    warmCache().catch(() => {});
  }, []);

  // Load persistent Wheelchair Accessible state & real search history
  useEffect(() => {
    loadWheelchairAccessible().then((val) => {
      if (typeof val === 'boolean') {
        setIsWheelchairAccessible(val);
      }
      wheelchairHydratedRef.current = true;
    });

    loadRecentSearches().then((saved) => {
      if (saved && Array.isArray(saved)) {
        setRecentDestinations(saved);
      }
    });
  }, []);

  // Connect to live backend and fetch all MongoDB collections
  useEffect(() => {
    let isMounted = true;

    const fetchAllData = async () => {
      try {
        setIsLoadingData(true);
        setDataError(null);

        // Health check
        try {
          const health = await checkHealth();
          if (isMounted && health?.status === 'ok') {
            setIsBackendConnected(true);
          }
        } catch (e) {
          if (__DEV__) console.warn('[UnityMapScreen] Health check failed:', e.message);
          if (isMounted) setIsBackendConnected(false);
        }

        // Fetch all 4 collections in parallel
        const [nodesRes, obstaclesRes, pathwaysRes, elevatorsRes] = await Promise.all([
          getNodes().catch((err) => {
            if (__DEV__) console.error('[UnityMapScreen] Nodes fetch error:', err.message);
            return { data: [] };
          }),
          getObstacles(true).catch((err) => {
            if (__DEV__) console.error('[UnityMapScreen] Obstacles fetch error:', err.message);
            return { data: [] };
          }),
          getPathways().catch((err) => {
            if (__DEV__) console.error('[UnityMapScreen] Pathways fetch error:', err.message);
            return { data: [] };
          }),
          getElevatorOverview().catch((err) => {
            if (__DEV__) console.error('[UnityMapScreen] Elevators fetch error:', err.message);
            return { data: [] };
          }),
        ]);

        if (!isMounted) return;

        if (__DEV__) console.log('[UnityMapScreen] Live Database Fetch Completed:', { nodes: nodesRes?.data?.length || 0, obstacles: obstaclesRes?.data?.length || 0, pathways: pathwaysRes?.data?.length || 0, elevators: elevatorsRes?.data?.length || 0, });

        // All 4 fetches failed (backend unreachable) → show the offline banner
        // instead of a silent empty map. Individual .catch() above swallow the
        // errors, so detect it here via the missing `success` flags.
        if (
          !nodesRes?.success &&
          !obstaclesRes?.success &&
          !pathwaysRes?.success &&
          !elevatorsRes?.success
        ) {
          setDataError('Backend unreachable — phone & PC must share WiFi; check EXPO_PUBLIC_API_URL');
        }

        // 1. Process Nodes — save to offline cache for voice search fallback
        if (nodesRes?.success && Array.isArray(nodesRes.data) && nodesRes.data.length > 0) {
          const liveNodes = nodesRes.data.map((node) => ({
            id: node._id || node.id,
            title: node.name,
            desc: `Floor ${node.floorLevel} • Step-Free Node`,
            lat: node.location?.coordinates?.[1] || 6.9271,
            lng: node.location?.coordinates?.[0] || 79.8612,
            type: 'node',
            distance: 'Campus',
            isAccessible: true,
          }));
          setDbNodes(liveNodes);
          saveNodesCache(liveNodes).catch(() => {});

          if (!location && liveNodes[0]?.lat && liveNodes[0]?.lng) {
            setMapCenter([liveNodes[0].lat, liveNodes[0].lng]);
          }
        } else {
          // Offline fallback: load cached nodes for voice search
          try {
            const cached = await loadNodesCache();
            if (cached && Array.isArray(cached) && cached.length > 0) {
              setDbNodes(cached);
              if (!location && cached[0]?.lat && cached[0]?.lng) {
                setMapCenter([cached[0].lat, cached[0].lng]);
              }
            }
          } catch (_) {}
        }

        // 2. Process Obstacles
        if (obstaclesRes?.success && Array.isArray(obstaclesRes.data) && obstaclesRes.data.length > 0) {
          const liveObstacles = obstaclesRes.data.map((obs) => ({
            id: obs._id || obs.id,
            title: obs.title,
            desc: `${obs.obstacleType || 'Hazard'} • Live MongoDB Report`,
            priority: 'High',
            obstacleType: obs.obstacleType,
            type: 'obstacle',
            lat: obs.location?.coordinates?.[1],
            lng: obs.location?.coordinates?.[0],
            location: obs.location,
            icon: 'wheelchair',
          }));
          setDbObstacles(liveObstacles);
        }

        // 3. Process Pathways
        if (pathwaysRes?.success && Array.isArray(pathwaysRes.data)) {
          setDbPathways(pathwaysRes.data);
        }

        // 4. Process Elevators
        if (elevatorsRes?.success && Array.isArray(elevatorsRes.data)) {
          const liveElevators = elevatorsRes.data.map((elv) => {
            const isOp = elv.status === 'operational' || elv.latestStatus === 'OPERATIONAL';
            const nodeCoords =
              elv.associatedNode?.location?.coordinates ||
              elv.nodeDetails?.location?.coordinates;
            return {
              id: elv.elevatorId,
              title: elv.elevatorId,
              desc: `${elv.elevatorId} • ${isOp ? 'Operational' : 'Out of Service'}`,
              type: 'elevator',
              isOperational: isOp,
              lat: Array.isArray(nodeCoords) ? nodeCoords[1] : undefined,
              lng: Array.isArray(nodeCoords) ? nodeCoords[0] : undefined,
            };
          });
          setDbElevators(liveElevators);
        }
      } catch (err) {
        if (__DEV__) console.error('[UnityMapScreen] Critical load error:', err);
        if (isMounted) setDataError(err.message || 'Failed to load database features');
      } finally {
        if (isMounted) setIsLoadingData(false);
      }
    };

    fetchAllData();

    return () => {
      isMounted = false;
    };
  }, [location]);

  // Auto-position map when GPS location is received
  useEffect(() => {
    if (location && typeof location.latitude === 'number' && typeof location.longitude === 'number') {
      setMapCenter([location.latitude, location.longitude]);
    }
  }, [location]);

  // Handle Wheelchair Accessible Toggle
  const handleToggleWheelchair = useCallback(() => {
    setIsWheelchairAccessible((prev) => !prev);
  }, []);

  // Persist outside the state updater (updaters must be pure — no side effects).
  // Skip until the stored value has been hydrated to avoid overwriting it with the default.
  const wheelchairHydratedRef = React.useRef(false);
  useEffect(() => {
    if (!wheelchairHydratedRef.current) return;
    saveWheelchairAccessible(isWheelchairAccessible);
  }, [isWheelchairAccessible]);

  // Recenter map on user location
  const handleRecenter = useCallback(async () => {
    const coords = await recenter();
    if (coords && coords.latitude && coords.longitude) {
      setMapCenter([coords.latitude, coords.longitude]);
    } else if (location && location.latitude && location.longitude) {
      setMapCenter([location.latitude, location.longitude]);
    }
  }, [recenter, location]);

  const handleLocationFound = useCallback((gps) => {
    if (Number.isFinite(Number(gps?.latitude)) && Number.isFinite(Number(gps?.longitude))) {
      setCurrentLocation({
        latitude: Number(gps.latitude),
        longitude: Number(gps.longitude),
      });
      setMapCenter([Number(gps.latitude), Number(gps.longitude)]);
    }
  }, []);

  // ── Tap-to-Route & Proximity Safety Analysis handler ───────────────────────
  // options.exact: destination came from a resolved place (search / voice /
  // gazetteer) with authoritative coordinates + name — the pin must land on
  // the actual place, never snap to a nearby campus node ("main entrance" bug).
  const handleMapTap = useCallback(async (loc, options = {}) => {
    if (!Number.isFinite(Number(loc?.latitude)) || !Number.isFinite(Number(loc?.longitude))) {
      return;
    }
    const exact = options.exact === true;
    const requestedDestName = typeof options.destinationName === 'string' && options.destinationName.trim()
      ? options.destinationName.trim()
      : null;

    const destination = {
      latitude: Number(loc.latitude),
      longitude: Number(loc.longitude),
    };

    const origin = currentLocation
      || (location?.latitude && location?.longitude ? location : null)
      || (dbNodes[0]?.lat ? { latitude: dbNodes[0].lat, longitude: dbNodes[0].lng } : { latitude: mapCenter[0], longitude: mapCenter[1] });

    setTappedLocation(destination);
    setTapRoute(null);
    setTapRouteMeta(null);
    setTapRouteError(null);
    setNearbyHazards([]);
    setNearbyAccessible([]);
    setSafetyStatus(null);
    setIsTapSummarySheetVisible(false);
    setTapRouteLoading(true);
    setIsSearchExpanded(false);

    try {
      const directMeters = origin
        ? calculateHaversineDistance(origin.latitude, origin.longitude, destination.latitude, destination.longitude)
        : 0;

      const [roadRouteRes, originNode, destNode] = await Promise.all([
        getRoadRoute(origin.longitude, origin.latitude, destination.longitude, destination.latitude).catch(() => null),
        getNearestNode(origin.longitude, origin.latitude, 500).catch(() => null),
        // Exact places: only accept a campus node essentially AT the place
        // (100 m); raw map taps keep the loose 500 m campus snap.
        getNearestNode(destination.longitude, destination.latitude, exact ? 100 : 500).catch(() => null),
      ]);

      let polyCoords = [];
      let totalMeters = directMeters;
      let maxRouteSlope = 0;
      let routePathways = [];
      const destName = requestedDestName || destNode?.name || 'Selected Location';

      let foundDbRoute = false;
      if (originNode && destNode && (originNode._id ?? originNode.id) !== (destNode._id ?? destNode.id)) {
        try {
          const originId = originNode._id ?? originNode.id;
          const destId   = destNode._id  ?? destNode.id;
          const routeRes = await getRoute(originId, destId, isWheelchairAccessible);
          const path = routeRes?.data?.path;

          if (routeRes?.success && Array.isArray(path) && path.length >= 2) {
            const dbCoords = path
              .map((node) => node.location?.coordinates)
              .filter((coordinates) => Array.isArray(coordinates) && coordinates.length >= 2)
              .map(([lng, lat]) => [Number(lat), Number(lng)]);

            if (dbCoords.length >= 2) {
              polyCoords = dbCoords;
              foundDbRoute = true;
              const routeNodeIds = path.map((node) => String(node._id || node.id));
              routePathways = dbPathways.filter((pathway) => {
                const startId = String(pathway.startNode?._id || pathway.startNode);
                const endId = String(pathway.endNode?._id || pathway.endNode);
                return routeNodeIds.some((fromId, index) => {
                  const toId = routeNodeIds[index + 1];
                  return (
                    toId &&
                    ((startId === fromId && endId === toId) ||
                      (startId === toId && endId === fromId))
                  );
                });
              });

              maxRouteSlope = routePathways.reduce(
                (max, pathway) => Math.max(max, Math.abs(Number(pathway.inclineDegrees) || 0)),
                0
              );

              totalMeters = Number(routeRes.data?.totalDistanceMeters) > 0
                ? Number(routeRes.data.totalDistanceMeters)
                : polyCoords.slice(1).reduce(
                    (total, point, index) =>
                      total + calculateHaversineDistance(
                        polyCoords[index][0],
                        polyCoords[index][1],
                        point[0],
                        point[1]
                      ),
                    0
                  );
            }
          }
        } catch (_) {}
      }

      if (!foundDbRoute && roadRouteRes && Array.isArray(roadRouteRes.coordinates) && roadRouteRes.coordinates.length >= 2) {
        polyCoords = roadRouteRes.coordinates;
        totalMeters = roadRouteRes.distanceMeters;
      } else if (!foundDbRoute && polyCoords.length < 2 && origin) {
        polyCoords = [
          [origin.latitude, origin.longitude],
          [destination.latitude, destination.longitude],
        ];
        totalMeters = directMeters;
      }

      // Exact place: the destination pin is drawn at the route's LAST point
      // (BaseMap), so snap that point onto the resolved place's true coords —
      // a campus node 100 m away must not shift the pin/label.
      if (exact && polyCoords.length >= 2) {
        const last = polyCoords[polyCoords.length - 1];
        if (last[0] !== destination.latitude || last[1] !== destination.longitude) {
          polyCoords = [...polyCoords];
          polyCoords[polyCoords.length - 1] = [destination.latitude, destination.longitude];
        }
      }

      const etaMins = calculateWheelchairETA(totalMeters, maxRouteSlope);

      if (polyCoords.length >= 2) {
        setTapRoute({
          id: `tap_route_${Date.now()}`,
          coordinates: polyCoords,
          color: '#10B981',
          isSelected: true,
          destName,
        });
      }

      const [nearbyObsRes, nearbyNodesRes] = await Promise.all([
        getNearbyObstacles(destination.longitude, destination.latitude, 400).catch(() => ({ data: [] })),
        getNearbyNodes(destination.longitude, destination.latitude, 400).catch(() => ({ data: [] })),
      ]);

      const apiObs = Array.isArray(nearbyObsRes?.data) ? nearbyObsRes.data : [];
      const apiNodes = Array.isArray(nearbyNodesRes?.data) ? nearbyNodesRes.data : [];

      const combinedObs = [...apiObs];
      dbObstacles.forEach((dbo) => {
        if (!combinedObs.some((o) => (o._id || o.id) === (dbo._id || dbo.id))) {
          combinedObs.push(dbo);
        }
      });

      const combinedNodes = [...apiNodes];
      dbNodes.forEach((dbn) => {
        if (!combinedNodes.some((n) => (n._id || n.id) === (dbn._id || dbn.id))) {
          combinedNodes.push(dbn);
        }
      });

      const { hazards, accessible } = categorizeProximityFeatures({
        nearbyObstacles: combinedObs,
        nearbyNodes: combinedNodes,
        elevators: dbElevators,
        pathways: dbPathways,
        centerCoords: [destination.latitude, destination.longitude],
        routeCoords: polyCoords,
        radiusMeters: 400,
      });

      const status = computeRouteSafetyStatus(routePathways, hazards, accessible);

      setNearbyHazards(hazards);
      setNearbyAccessible(accessible);
      setSafetyStatus(status);
      setActiveSheetCategory(hazards.length > 0 ? 'hazards' : 'accessible');
      setIsTapSummarySheetVisible(true);

      setTapRouteMeta({
        distanceText: formatDistance(totalMeters),
        etaText: formatDuration(etaMins),
        destName,
        safetyStatus: status,
      });
    } catch (err) {
      if (__DEV__) console.warn('[UnityMapScreen] Tap route error:', err.message);
      const directMeters = origin
        ? calculateHaversineDistance(origin.latitude, origin.longitude, destination.latitude, destination.longitude)
        : 0;
      const etaMins = calculateWheelchairETA(directMeters, 0);

      const polyCoords = origin ? [
        [origin.latitude, origin.longitude],
        [destination.latitude, destination.longitude],
      ] : [];

      if (polyCoords.length >= 2) {
        setTapRoute({
          id: `tap_route_${Date.now()}`,
          coordinates: polyCoords,
          color: '#10B981',
          isSelected: true,
          destName: requestedDestName || 'Selected Destination',
        });
      }

      const status = computeRouteSafetyStatus([], [], []);

      setTapRouteMeta({
        distanceText: formatDistance(directMeters),
        etaText: formatDuration(etaMins),
        destName: requestedDestName || 'Selected Destination',
        safetyStatus: status,
      });
      setIsTapSummarySheetVisible(true);
    } finally {
      setTapRouteLoading(false);
    }
  }, [currentLocation, location, mapCenter, dbNodes, dbPathways, dbObstacles, dbElevators, isWheelchairAccessible]);

  // Google-Maps-style place card actions: Directions → route preview sheet
  // (Start Navigation lives there); Close → dismiss card + route.
  const handlePlaceDirections = useCallback(() => {
    setSelectedPlace(null);
    setIsTapSummarySheetVisible(true);
  }, []);

  const handleClearTap = useCallback(() => {
    setSelectedPlace(null);
    setTappedLocation(null);
    setTapRoute(null);
    setTapRouteMeta(null);
    setTapRouteError(null);
    setNearbyHazards([]);
    setNearbyAccessible([]);
    setSafetyStatus(null);
    setIsTapSummarySheetVisible(false);
    setTapRouteLoading(false);
  }, []);

  // SPT-201: Seamless Tap-to-Navigate flow launching Google Maps style turn-by-turn guidance
  const handleStartTapNavigation = useCallback(() => {
    setIsTapSummarySheetVisible(false);
    setShowGuidance(false);
    setShowVoiceSummary(false);

    const destTitle = tapRouteMeta?.destName || 'Selected Destination';
    const dist = tapRouteMeta?.distanceText || '1.2 km';
    const eta = tapRouteMeta?.etaText || '15 mins';

    const originLat = location?.latitude ?? 6.9271;
    const originLng = location?.longitude ?? 79.8612;
    const destLat = tappedLocation?.latitude ?? tappedLocation?.[0] ?? 6.9325;
    const destLng = tappedLocation?.longitude ?? tappedLocation?.[1] ?? 79.8655;

    const coords =
      tapRoute?.coordinates && Array.isArray(tapRoute.coordinates) && tapRoute.coordinates.length >= 2
        ? tapRoute.coordinates
        : [
            [originLat, originLng],
            [(originLat + destLat) / 2 + 0.0006, (originLng + destLng) / 2 - 0.0004],
            [destLat, destLng],
          ];

    const navRoute = {
      id: tapRoute?.id || `nav_route_${Date.now()}`,
      title: destTitle,
      destName: destTitle,
      originName: 'Your Location',
      distanceText: dist,
      etaText: eta,
      coordinates: coords,
      color: '#10B981',
      // External/OSM roads carry no surveyed slope data — never claim ADA-safe.
      maxSlope: 'Slope n/a (street estimate)',
      slopeUnknown: true,
    };

    setActiveNavRoute(navRoute);
    setIsTurnByTurnActive(true);
  }, [tapRouteMeta, tapRoute, tappedLocation, location]);

  // Select destination from real DB list / search history / universal places.
  // External (OSM) + LOCAL DB places open a Google-Maps-style detail card; the
  // route is drawn underneath (lat/lng always come from the DB row on click)
  // and the safety sheet appears after tapping Directions.
  const handleSelectDestination = useCallback(
    async (dest) => {
      // Local DB row: re-fetch fresh lat/lon from DB by id (source of truth for map pin).
      let target = dest;
      if (dest?.source === 'local' && dest?.placeId) {
        try {
          const fresh = await getLocalPlaceById(dest.placeId);
          if (fresh && Number.isFinite(Number(fresh.lat)) && Number.isFinite(Number(fresh.lng))) {
            target = { ...dest, ...fresh };
          }
        } catch (_) {}
      }
      setSearchQuery(target.title);
      if (target.lat && target.lng) {
        const bb = target.boundingbox;
        const center =
          bb && [bb.south, bb.north, bb.west, bb.east].every((n) => Number.isFinite(Number(n)))
            ? [(Number(bb.south) + Number(bb.north)) / 2, (Number(bb.west) + Number(bb.east)) / 2]
            : [target.lat, target.lng];
        setMapCenter(center);
        // Reuse current map pipeline to draw route and show summary.
        // Resolved places (external/local/gazetteer) pin to their TRUE coords;
        // campus nodes keep the loose tap-to-route snapping.
        const isResolvedPlace = ['external', 'local', 'gazetteer'].includes(target.source);
        try {
          await handleMapTap(
            { latitude: target.lat, longitude: target.lng },
            { exact: isResolvedPlace, destinationName: target.title }
          );
        } catch (_) {}
        if (target.source === 'external' || target.source === 'local') {
          // Route preview (safety sheet) waits for Directions — detail card first.
          setIsTapSummarySheetVisible(false);
          setSelectedPlace(target);
        }
      }
      // Move selected to top of recent list and save
      setRecentDestinations((prev) => {
        const filtered = prev.filter((d) => d.id !== target.id);
        const updated = [target, ...filtered];
        saveRecentSearches(updated);
        return updated;
      });
    },
    [handleMapTap]
  );

  // Typed search fallback: Enter → local DB top hit first, then fuzzy rank.
  const handleSearchSubmit = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q) return;
    // Local ~5k table top hit wins (lat/lon from DB → map).
    if (localResults.length > 0) {
      await handleSelectDestination(localResults[0]);
      return;
    }
    const ranked = rankPlaces(q, [...dbNodes, ...recentDestinations]);
    if (ranked.length > 0) {
      await handleSelectDestination(ranked[0]);
    }
  }, [searchQuery, dbNodes, recentDestinations, localResults, handleSelectDestination]);

  // Build the voice route summary for a resolved destination.
  // Campus destinations use the DB route (backend spokenSummary); far places
  // fall back to the OSRM road route with a locally composed spoken summary.
  const buildVoiceSummary = useCallback(
    async (dest, confidence, spokenFallbackName) => {
      const origin =
        currentLocation ||
        (location?.latitude && location?.longitude ? location : null) ||
        (dbNodes[0]?.lat ? { latitude: dbNodes[0].lat, longitude: dbNodes[0].lng } : { latitude: mapCenter[0], longitude: mapCenter[1] });
      const heardName = spokenFallbackName || voiceTranscript || 'that destination';
      const fallbackName = dest?.title || heardName;

      if (!dest || !Number.isFinite(Number(dest.lat)) || !Number.isFinite(Number(dest.lng))) {
        return {
          destName: fallbackName,
          distanceText: '--',
          crossings: 0,
          etaText: '--',
          hazardCount: nearbyHazards?.length ?? 0,
          spokenSummary: `No matching place found for ${heardName}. Tap the mic to say it again.`,
          confidence,
        };
      }

      const isResolvedPlace = ['external', 'local', 'gazetteer'].includes(dest.source);
      let summary = {
        destName: fallbackName,
        distanceText: '--',
        crossings: 0,
        etaText: '--',
        hazardCount: nearbyHazards?.length ?? 0,
        spokenSummary: `Route to ${fallbackName}: calculating...`,
        confidence,
      };

      try {
        const [originNode, destNode] = await Promise.all([
          getNearestNode(origin.longitude, origin.latitude, 500).catch(() => null),
          // Exact places only accept a node essentially at the place (100 m).
          getNearestNode(dest.lng, dest.lat, isResolvedPlace ? 100 : 500).catch(() => null),
        ]);
        if (originNode && destNode && (originNode._id ?? originNode.id) !== (destNode._id ?? destNode.id)) {
          const routeRes = await getRoute(originNode._id || originNode.id, destNode._id || destNode.id, isWheelchairAccessible, {
            includeSpeech: true,
            locale: preferredSTTLocale || 'en',
          });
          if (routeRes?.success) {
            const d = routeRes.data;
            summary = {
              destName: d.destinationNode?.name || dest.title,
              distanceText: d.totalDistanceMeters ? formatDistance(d.totalDistanceMeters) : '--',
              crossings: d.crossings ?? 0,
              etaText: d.estimatedDurationSec ? formatDuration(Math.ceil(d.estimatedDurationSec / 60)) : '--',
              hazardCount: d.hazardCount ?? nearbyHazards?.length ?? 0,
              spokenSummary:
                d.spokenSummary ||
                `Route to ${d.destinationNode?.name || dest.title}: ${d.totalDistanceMeters ? formatDistance(d.totalDistanceMeters) : '--'}, ${d.crossings ?? 0} crossings.`,
              confidence,
            };
          }
        }

        // No campus route (far place / nodes unreachable) → road-route summary.
        if (summary.spokenSummary.includes('calculating')) {
          const road = await getRoadRoute(origin.longitude, origin.latitude, dest.lng, dest.lat).catch(() => null);
          if (road && Number(road.distanceMeters) > 0) {
            const distanceText = formatDistance(road.distanceMeters);
            const etaText = formatDuration(calculateWheelchairETA(road.distanceMeters, 0));
            summary = {
              destName: dest.title,
              distanceText,
              crossings: 0,
              etaText,
              hazardCount: nearbyHazards?.length ?? 0,
              spokenSummary: `Route to ${dest.title}: ${distanceText}, ${etaText}.`,
              confidence,
            };
          }
        }
      } catch (_) {}

      return summary;
    },
    [currentLocation, location, dbNodes, mapCenter, voiceTranscript, isWheelchairAccessible, nearbyHazards, preferredSTTLocale]
  );

  // Resolve a spoken transcript to a destination: merge live search (local 5k +
  // Nominatim), gazetteer, campus nodes and recents; rank the transcript AND
  // its STT alternatives; confident → straight to summary, ambiguous →
  // "Did you mean…" list (per SPT UX: auto-pick, list only when unsure).
  const resolveVoiceDestination = useCallback(
    async (q, confidence, sttAlternatives) => {
      const texts = [
        q,
        ...(Array.isArray(sttAlternatives) ? sttAlternatives : [])
          .map((a) => (typeof a === 'string' ? a : a?.transcript))
          .map((t) => String(t || '').trim())
          .filter((t) => t && t.toLowerCase() !== q.toLowerCase()),
      ];

      let liveResults = [];
      try {
        const origin =
          currentLocation ||
          (location?.latitude && location?.longitude ? location : null) ||
          (dbNodes[0]?.lat ? { latitude: dbNodes[0].lat, longitude: dbNodes[0].lng } : { latitude: mapCenter[0], longitude: mapCenter[1] });
        const [localRes, extRes] = await Promise.all([
          searchLocalPlaces(q, origin, { limit: 10 }).catch(() => []),
          searchExternalPlaces(q, origin, { limit: 8 }).catch(() => []),
        ]);
        liveResults = [...localRes, ...extRes];
      } catch (_) {}

      const gazetteerResults = SRI_LANKA_GAZETTEER.map((p) => ({
        id: `gz_${p.name}`,
        title: p.name,
        desc: p.city ? `${p.city}, Sri Lanka` : 'Sri Lanka',
        addressShort: p.city ? `${p.city}, Sri Lanka` : 'Sri Lanka',
        aliases: p.aliases,
        city: p.city,
        lat: p.lat,
        lng: p.lng,
        source: 'gazetteer',
        categoryLabel: p.category,
        distance: '--',
      }));

      const candidates = [...liveResults, ...gazetteerResults, ...dbNodes, ...recentDestinations];
      const ranked = rankPlacesForTranscripts(texts, candidates);
      const pick = chooseBestMatch(ranked);

      let matches = pick.needsConfirmation ? pick.alternatives.slice(0, 5) : null;
      let best = pick.best;
      // Nothing confident but live results exist → offer them as candidates.
      if (!best && !matches && liveResults.length > 0) {
        best = null;
        matches = liveResults.slice(0, 5);
      }

      voiceDestinationRef.current = best || (matches && matches[0]) || null;

      const summary = await buildVoiceSummary(voiceDestinationRef.current, confidence, q);
      return { summary, matches, selectedMatchId: matches ? (best ? best.id || best.placeId : matches[0]?.id || matches[0]?.placeId) : null };
    },
    [currentLocation, location, dbNodes, mapCenter, recentDestinations, buildVoiceSummary]
  );

  // SPT-106: bridge spoken transcript to Voice Input & Summary Readout Screen — summary first via getRoute includeSpeech, draw on Confirm
  const handleLauncherNavigate = useCallback(
    async (transcript, confidence, sttAlternatives) => {
      setShowLauncher(false);
      const q = typeof transcript === 'string' ? transcript.trim() : '';
      if (!q) return;
      setVoiceTranscript(q);
      setVoiceConfidence(confidence || 0);
      setSearchQuery(q);
      setIsSearchExpanded(true);
      setVoiceMatches(null);
      setVoiceSelectedMatchId(null);

      const { summary, matches, selectedMatchId } = await resolveVoiceDestination(q, confidence, sttAlternatives);
      if (matches) {
        setVoiceMatches(matches);
        setVoiceSelectedMatchId(selectedMatchId);
      }
      setVoiceRouteSummary(summary);
      setShowVoiceSummary(true);
      try {
        speak(summary.spokenSummary);
      } catch (_) {}
    },
    [resolveVoiceDestination, speak]
  );

  // User tapped a "Did you mean…" candidate → re-select + rebuild the summary.
  const handleVoiceMatchSelect = useCallback(
    async (dest) => {
      if (!dest) return;
      voiceDestinationRef.current = dest;
      setVoiceSelectedMatchId(dest.id || dest.placeId || dest.title);
      const summary = await buildVoiceSummary(dest, voiceConfidence);
      setVoiceRouteSummary(summary);
      try {
        speak(summary.spokenSummary);
      } catch (_) {}
    },
    [buildVoiceSummary, voiceConfidence, speak]
  );

  // Re-recording inside the voice screen → re-resolve with the new phrase.
  const handleVoiceTranscriptChange = useCallback(
    async (text, confidence, sttAlternatives) => {
      const q = typeof text === 'string' ? text.trim() : '';
      if (!q || q === voiceTranscript) return;
      setVoiceTranscript(q);
      setVoiceConfidence(confidence || 0);
      setSearchQuery(q);
      const { summary, matches, selectedMatchId } = await resolveVoiceDestination(q, confidence, sttAlternatives);
      setVoiceMatches(matches);
      setVoiceSelectedMatchId(selectedMatchId);
      setVoiceRouteSummary(summary);
      try {
        speak(summary.spokenSummary);
      } catch (_) {}
    },
    [resolveVoiceDestination, voiceTranscript, speak]
  );

  const handleVoiceConfirm = useCallback(
    async ({ transcript, routeSummary, destination, targetCoordinates }) => {
      const q = transcript || voiceTranscript;
      setShowVoiceSummary(false);
      if (!q) return;

      // Prefer the destination resolved/selected in the voice screen; fall
      // back to re-ranking the confirmed transcript (covers re-records).
      let best = destination || voiceDestinationRef.current || null;
      if (!best) {
        const gazetteerResults = SRI_LANKA_GAZETTEER.map((p) => ({
          id: `gz_${p.name}`,
          title: p.name,
          aliases: p.aliases,
          city: p.city,
          lat: p.lat,
          lng: p.lng,
          source: 'gazetteer',
        }));
        best = rankPlaces(q, [...dbNodes, ...recentDestinations, ...gazetteerResults])[0] || null;
      }

      if (best?.lat && best?.lng) {
        try {
          speak(`Confirmed. Navigating to ${best.title}`);
        } catch (_) {}
        // Single route path: handleSelectDestination → handleMapTap (exact
        // coords for resolved places) + saves recents + detail card.
        await handleSelectDestination(best);
        // Also set turn-by-turn active route for develop SPT-103 if state exists
        if (typeof setActiveNavRoute === 'function' && typeof setIsTurnByTurnActive === 'function') {
          const destTitle = routeSummary?.destName || best.title;
          const originLat = location?.latitude ?? 6.9271;
          const originLng = location?.longitude ?? 79.8612;
          const destLat = best.lat;
          const destLng = best.lng;
          const coords =
            tapRoute?.coordinates && Array.isArray(tapRoute.coordinates) && tapRoute.coordinates.length >= 2
              ? tapRoute.coordinates
              : [
                  [originLat, originLng],
                  [(originLat + destLat) / 2 + 0.0006, (originLng + destLng) / 2 - 0.0004],
                  [destLat, destLng],
                ];
          setActiveNavRoute({
            id: 'voice_nav_route',
            title: destTitle,
            destName: destTitle,
            originName: 'Your Location',
            distanceText: routeSummary?.distanceText || '1.2 km',
            etaText: routeSummary?.etaText || '15 mins',
            coordinates: coords,
            color: '#10B981',
            maxSlope: 'Slope n/a (street estimate)',
            slopeUnknown: true,
          });
          setIsTurnByTurnActive(true);
        }
      } else if (best) {
        handleSelectDestination(best);
        try {
          speak(`Confirmed. Navigating to ${best.title}`);
        } catch (_) {}
      } else if (targetCoordinates) {
        // Fallback to develop synthetic targetCoordinates when nothing resolved
        const destTitle = routeSummary?.destName || transcript || 'Selected Destination';
        const originLat = location?.latitude ?? 6.9271;
        const originLng = location?.longitude ?? 79.8612;
        const destLat = targetCoordinates?.[0] ?? targetCoordinates?.latitude ?? 6.9325;
        const destLng = targetCoordinates?.[1] ?? targetCoordinates?.longitude ?? 79.8655;
        const coords =
          tapRoute?.coordinates && Array.isArray(tapRoute.coordinates) && tapRoute.coordinates.length >= 2
            ? tapRoute.coordinates
            : [
                [originLat, originLng],
                [(originLat + destLat) / 2 + 0.0006, (originLng + destLng) / 2 - 0.0004],
                [destLat, destLng],
              ];
        if (typeof setActiveNavRoute === 'function') {
          setActiveNavRoute({
            id: 'voice_nav_route',
            title: destTitle,
            destName: destTitle,
            originName: 'Your Location',
            distanceText: routeSummary?.distanceText || '1.2 km',
            etaText: routeSummary?.etaText || '15 mins',
            coordinates: coords,
            color: '#10B981',
            maxSlope: 'Slope n/a (street estimate)',
            slopeUnknown: true,
          });
          setIsTurnByTurnActive(true);
        }
      }
    },
    [voiceTranscript, dbNodes, recentDestinations, handleSelectDestination, speak, location, tapRoute]
  );

  const handleVoiceCancel = useCallback(() => {
    setShowVoiceSummary(false);
  }, []);

  // Origin for external road-distance search: live GPS first, map fallback last.
  const searchOrigin = useMemo(() => {
    if (currentLocation?.latitude && currentLocation?.longitude) return currentLocation;
    if (location?.latitude && location?.longitude) return location;
    if (dbNodes[0]?.lat && dbNodes[0]?.lng) {
      return { latitude: dbNodes[0].lat, longitude: dbNodes[0].lng };
    }
    return { latitude: mapCenter[0], longitude: mapCenter[1] };
  }, [currentLocation, location, dbNodes, mapCenter]);

  // LOCAL DB places table (~5k rows): fast debounced search, hits on 2+ chars.
  // Click result → lat/lon from DB → map pin + route (see handleSelectDestination).
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      localRequestIdRef.current += 1;
      setLocalResults([]);
      setIsLocalSearching(false);
      return undefined;
    }
    const requestId = (localRequestIdRef.current += 1);
    setIsLocalSearching(true);
    const timer = setTimeout(async () => {
      try {
        const results = await searchLocalPlaces(q, searchOrigin, { limit: 10 });
        if (localRequestIdRef.current !== requestId) return; // stale keystrokes
        setLocalResults(results);
      } catch (_) {
        if (localRequestIdRef.current !== requestId) return;
        setLocalResults([]);
      } finally {
        if (localRequestIdRef.current === requestId) setIsLocalSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, searchOrigin]);

  // Universal search: debounced backend proxy (Nominatim + OSRM road distance).
  // Local DB results render instantly; external rows stream in with road chips.
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 3) {
      externalRequestIdRef.current += 1;
      setExternalResults([]);
      setIsExternalSearching(false);
      setExternalError(null);
      return undefined;
    }
    const cacheKey = `${q.toLowerCase()}|${Number(searchOrigin.latitude).toFixed(3)},${Number(searchOrigin.longitude).toFixed(3)}`;
    if (externalCacheRef.current.has(cacheKey)) {
      setExternalResults(externalCacheRef.current.get(cacheKey));
      setIsExternalSearching(false);
      setExternalError(null);
      return undefined;
    }
    const requestId = (externalRequestIdRef.current += 1);
    setIsExternalSearching(true);
    setExternalError(null);
    const timer = setTimeout(async () => {
      try {
        const results = await searchExternalPlaces(q, searchOrigin, { limit: 8 });
        if (externalRequestIdRef.current !== requestId) return; // stale keystrokes
        externalCacheRef.current.set(cacheKey, results);
        if (externalCacheRef.current.size > 30) {
          const oldest = externalCacheRef.current.keys().next().value;
          externalCacheRef.current.delete(oldest);
        }
        setExternalResults(results);
      } catch (err) {
        if (externalRequestIdRef.current !== requestId) return;
        setExternalError('Place search unavailable — showing saved places.');
        setExternalResults([]);
      } finally {
        if (externalRequestIdRef.current === requestId) setIsExternalSearching(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery, searchOrigin]);

  // STT phrase hints: recents + campus nodes first (most relevant), filled out
  // with the static gazetteer. Capped at 80 — huge hint lists hurt latency.
  const searchHints = useMemo(() => {
    const recents = recentDestinations.map((d) => d.title).filter(Boolean);
    const nodes = dbNodes.map((d) => d.title).filter(Boolean);
    return [...recents.slice(0, 15), ...nodes.slice(0, 15), ...GAZETTEER_NAMES].slice(0, 80);
  }, [recentDestinations, dbNodes]);

  // Combined and filtered destinations (DB nodes + real recent searches)
  const filteredDestinations = useMemo(() => {
    const seenIds = new Set(dbNodes.map((d) => d.id).filter(Boolean));
    const all = [
      ...dbNodes,
      ...recentDestinations.filter(
        (r) => !dbNodes.some((d) => d.title === r.title) && !seenIds.has(r.id)
      ),
    ];
    if (!searchQuery.trim()) {
      return all;
    }
    const q = searchQuery.toLowerCase();
    return all.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        d.desc.toLowerCase().includes(q) ||
        (d.distance && d.distance.toLowerCase().includes(q))
    );
  }, [searchQuery, recentDestinations, dbNodes]);

  // Live map markers from real DB nodes, obstacles, and elevators
  const mapMarkers = useMemo(() => {
    return [...dbNodes, ...dbObstacles, ...dbElevators];
  }, [dbNodes, dbObstacles, dbElevators]);

  // Filtered pathways respecting wheelchair mode and gradient preferences
  const filteredPathways = useMemo(() => {
    if (!isWheelchairAccessible) {
      return dbPathways;
    }
    return dbPathways.filter((p) => {
      if (p.isWheelchairAccessible === false) return false;
      if (p.pathType === 'stairs') return false;
      if (maxSlope != null && p.inclineDegrees != null && Math.abs(p.inclineDegrees) > maxSlope) {
        return false;
      }
      return true;
    });
  }, [dbPathways, isWheelchairAccessible, maxSlope]);

  // Combined routes for BaseMap: static DB pathways rendered via `pathways` prop;
  // the tap route is rendered as a highlighted route via the `routes` prop
  const tapRouteList = useMemo(() => (tapRoute ? [tapRoute] : []), [tapRoute]);

  return (
    <View style={[tw`flex-1`, { backgroundColor: palette.background }]}>
      <StatusBar barStyle="light-content" backgroundColor={palette.primary} />

      {/* ── Top Curved Green Header ── Global High-Contrast ── */}
      <SafeAreaView
        style={[
          tw`rounded-b-[28px] ${Platform.OS === 'android' ? 'pt-8' : ''} shadow-lg z-10`,
          {
            backgroundColor: palette.primary,
            borderBottomWidth: isHighContrast ? borderWidth : 0,
            borderBottomColor: palette.border,
          },
          isHighContrast && { shadowOpacity: 0, elevation: 0 },
        ]}
      >
        <View style={tw`flex-row items-center justify-between px-5 py-3`}>
          {/* Logo & Brand Name */}
          <View style={tw`flex-row items-center`}>
            <View style={tw`w-9 h-9 rounded-xl bg-white/20 items-center justify-center mr-2.5`}>
              <Feather name="map" size={18} color="#FFFFFF" />
            </View>
            <Text style={tw`text-white text-2xl font-extrabold tracking-wide`}>
              UnityMap
            </Text>
          </View>

          {/* Action Buttons: Search Toggle & Notifications — 48dp + High-Contrast */}
          <View style={tw`flex-row items-center gap-2.5`}>
            <TouchableOpacity
              style={[
                tw`w-12 h-12 rounded-full items-center justify-center`,
                {
                  backgroundColor: isSearchExpanded
                    ? '#FFFFFF'
                    : isHighContrast
                    ? palette.surface
                    : 'rgba(255,255,255,0.2)',
                  borderWidth: isHighContrast ? borderWidth : 0,
                  borderColor: palette.cardBorder,
                },
              ]}
              activeOpacity={0.8}
              onPress={() => setIsSearchExpanded((prev) => !prev)}
              accessibilityRole="button"
              accessibilityLabel={`${isSearchExpanded ? 'Collapse' : 'Expand'} search bar`}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather
                name="search"
                size={19}
                color={
                  isSearchExpanded
                    ? palette.primary
                    : isHighContrast
                    ? palette.textPrimary
                    : '#FFFFFF'
                }
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                tw`w-12 h-12 rounded-full items-center justify-center relative`,
                {
                  backgroundColor: isHighContrast ? palette.surface : 'rgba(255,255,255,0.2)',
                  borderWidth: isHighContrast ? borderWidth : 0,
                  borderColor: palette.cardBorder,
                },
              ]}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Notifications"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather
                name="bell"
                size={19}
                color={isHighContrast ? palette.textPrimary : '#FFFFFF'}
              />
              <View
                style={[
                  tw`absolute top-2 right-2.5 w-2 h-2 rounded-full border`,
                  { backgroundColor: palette.error, borderColor: palette.primary },
                ]}
              />
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>

      {/* ── Main Content Area ─────────────────────────────────────────────── */}
      {activeTab === 'Settings' ? (
        <View style={tw`flex-1`}>
          <SettingsScreen />
        </View>
      ) : activeTab === 'Report' ? (
        <View style={tw`flex-1`}>
          <ThreeTapReportScreen onNavigateToMap={() => setActiveTab('Map')} onSuccess={() => setActiveTab('Map')} />
        </View>
      ) : activeTab === 'Profile' ? (
        <ScrollView style={tw`flex-1 p-5`}>
          <View
            style={[
              tw`rounded-2xl p-5 mb-4 shadow-sm`,
              {
                backgroundColor: palette.surface,
                borderColor: palette.cardBorder,
                borderWidth,
              },
            ]}
          >
            <View style={tw`flex-row items-center mb-4`}>
              <View
                style={[
                  tw`w-14 h-14 rounded-full items-center justify-center mr-4`,
                  { backgroundColor: palette.secondaryBg },
                ]}
              >
                <Feather name="user" size={26} color={palette.primary} />
              </View>
              <View>
                <Text {...textProps} style={[tw`font-bold text-lg`, { color: palette.textPrimary }]}>
                  Accessibility Profile
                </Text>
                <Text {...textProps} style={[tw`text-xs`, { color: palette.textMuted }]}>
                  Custom mobility & navigation preferences
                </Text>
              </View>
            </View>

            <View style={tw`gap-3`}>
              <View style={tw`flex-row justify-between items-center py-2 border-b border-gray-100`}>
                <Text {...textProps} style={{ color: palette.textPrimary }}>Wheelchair Routing</Text>
                <Text {...textProps} style={{ color: palette.primary, fontWeight: '700' }}>
                  {isWheelchairAccessible ? 'Active' : 'Inactive'}
                </Text>
              </View>
              <View style={tw`flex-row justify-between items-center py-2 border-b border-gray-100`}>
                <Text {...textProps} style={{ color: palette.textPrimary }}>High Contrast Theme</Text>
                <Text {...textProps} style={{ color: palette.primary, fontWeight: '700' }}>
                  {isHighContrast ? 'Enabled (7:1)' : 'Standard'}
                </Text>
              </View>
              <View style={tw`flex-row justify-between items-center py-2`}>
                <Text {...textProps} style={{ color: palette.textPrimary }}>GPS Accuracy</Text>
                <Text {...textProps} style={{ color: isHighContrast ? palette.success : '#10B981', fontWeight: '700' }}>High (5.0m)</Text>
              </View>
            </View>
          </View>
        </ScrollView>
      ) : (
        <>
          <View style={tw`flex-1 relative`}>
            {/* BaseMap: routes prop renders the tap-to-route polyline, pathways renders DB paths */}
            <BaseMap
              center={mapCenter}
              zoom={15}
              markers={mapMarkers}
              pathways={filteredPathways}
              routes={tapRouteList}
              userLocation={location}
              userHeading={location?.heading}
              autoCenter={false}
              onMapClick={handleMapTap}
              onLocationFound={handleLocationFound}
              isHighContrast={isHighContrast}
              isReduceMotionEnabled={isReduceMotionEnabled}
              palette={palette}
            />

            {/* Tap Route: Loading Spinner */}
            {tapRouteLoading && (
              <View
                style={[
                  tw`absolute top-3 left-4 right-4 z-30 flex-row items-center justify-center p-3 rounded-2xl shadow-md`,
                  {
                    backgroundColor: palette.surface,
                    borderColor: isHighContrast ? palette.success : '#10B981',
                    borderWidth: isHighContrast ? 2 : 1.5,
                  },
                ]}
              >
                <ActivityIndicator size="small" color={isHighContrast ? palette.success : '#10B981'} style={tw`mr-2`} />
                <Text
                  {...textProps}
                  style={[
                    tw`font-semibold`,
                    getTextStyle('xs', { isHighContrast }),
                    { color: palette.textPrimary },
                  ]}
                >
                  Calculating accessible pathway route…
                </Text>
              </View>
            )}

            {/* Google-Maps-style Place Detail Card (universal search selection) */}
            {selectedPlace && tapRouteMeta && !tapRouteLoading && (
              <View
                style={[
                  tw`absolute ${isSearchExpanded ? 'top-18' : 'top-3'} left-4 right-4 z-30 rounded-2xl p-4 shadow-xl`,
                  {
                    backgroundColor: palette.surface,
                    borderColor: palette.cardBorder,
                    borderWidth: isHighContrast ? 2 : 1,
                  },
                  isHighContrast && { shadowOpacity: 0, elevation: 0, borderColor: '#000000' },
                ]}
              >
                {/* Category banner row */}
                <View style={tw`flex-row items-center justify-between mb-2`}>
                  <View style={tw`flex-row items-center flex-1 mr-2`}>
                    <View
                      style={[
                        tw`w-10 h-10 rounded-xl items-center justify-center mr-2.5`,
                        {
                          backgroundColor: isHighContrast ? palette.surfaceAlt : '#EBF7F0',
                          borderWidth: isHighContrast ? borderWidth : 0,
                          borderColor: palette.border,
                        },
                      ]}
                    >
                      <PlaceCategoryIcon icon={selectedPlace.icon} size={18} color={palette.primary} />
                    </View>
                    <View style={tw`flex-1`}>
                      <Text
                        {...textProps}
                        style={[
                          tw`font-bold`,
                          getTextStyle('sm', { isHighContrast }),
                          { color: palette.textPrimary },
                        ]}
                        numberOfLines={2}
                      >
                        {selectedPlace.title}
                      </Text>
                      <Text
                        {...textProps}
                        style={[
                          getTextStyle('xs', { isHighContrast }),
                          { color: palette.primary, fontWeight: '700' },
                        ]}
                        numberOfLines={1}
                      >
                        {selectedPlace.categoryLabel || 'Place'}
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    onPress={handleClearTap}
                    style={[tw`w-10 h-10 rounded-full items-center justify-center`]}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    accessible
                    accessibilityRole="button"
                    accessibilityLabel="Close place details"
                  >
                    <MaterialIcons name="close" size={20} color={palette.textMuted} />
                  </TouchableOpacity>
                </View>

                {/* Address */}
                <Text
                  {...textProps}
                  style={[
                    tw`mb-2`,
                    getTextStyle('xs', { isHighContrast }),
                    { color: palette.textMuted },
                  ]}
                  numberOfLines={2}
                >
                  {selectedPlace.fullAddress || selectedPlace.addressShort}
                </Text>

                {/* Distance · ETA · wheelchair chips */}
                <View style={tw`flex-row items-center flex-wrap gap-2 mb-2`}>
                  <View
                    style={[
                      tw`px-2.5 py-1 rounded-lg`,
                      {
                        backgroundColor: isHighContrast ? palette.surfaceAlt : '#F1F5F9',
                        borderWidth: isHighContrast ? borderWidth : 0,
                        borderColor: palette.border,
                      },
                    ]}
                  >
                    <Text
                      {...textProps}
                      style={[
                        tw`font-bold`,
                        getTextStyle('xs', { isHighContrast }),
                        { color: palette.textPrimary },
                      ]}
                    >
                      {tapRouteMeta.distanceText}
                    </Text>
                  </View>
                  <View
                    style={[
                      tw`flex-row items-center px-2.5 py-1 rounded-lg`,
                      {
                        backgroundColor: isHighContrast ? palette.surfaceAlt : '#F1F5F9',
                        borderWidth: isHighContrast ? borderWidth : 0,
                        borderColor: palette.border,
                      },
                    ]}
                  >
                    <FontAwesome5 name="wheelchair" size={10} color={palette.primary} style={tw`mr-1.5`} />
                    <Text
                      {...textProps}
                      style={[
                        tw`font-bold`,
                        getTextStyle('xs', { isHighContrast }),
                        { color: palette.textPrimary },
                      ]}
                    >
                      {tapRouteMeta.etaText}
                    </Text>
                  </View>
                  {(() => {
                    const chip = wheelchairChip(selectedPlace.wheelchair);
                    if (!chip) return null;
                    return (
                      <View
                        style={[
                          tw`flex-row items-center px-2.5 py-1 rounded-full`,
                          {
                            backgroundColor: isHighContrast ? palette.surface : chip.bg,
                            borderColor: isHighContrast ? '#000000' : chip.border,
                            borderWidth: isHighContrast ? 2 : 1,
                          },
                        ]}
                        accessible
                        accessibilityLabel={chip.text}
                      >
                        <FontAwesome5
                          name="wheelchair"
                          size={10}
                          color={isHighContrast ? palette.textPrimary : chip.color}
                          style={tw`mr-1`}
                        />
                        <Text
                          {...textProps}
                          style={[
                            tw`font-bold`,
                            getTextStyle('xs', { isHighContrast }),
                            { color: isHighContrast ? palette.textPrimary : chip.color },
                          ]}
                        >
                          {chip.text}
                        </Text>
                      </View>
                    );
                  })()}
                </View>

                {/* Opening hours / phone (OSM extratags, when mapped) */}
                {(selectedPlace.openingHours || selectedPlace.phone) && (
                  <View style={tw`mb-3 gap-1`}>
                    {selectedPlace.openingHours ? (
                      <View style={tw`flex-row items-center`}>
                        <Feather name="clock" size={12} color={palette.textMuted} style={tw`mr-1.5`} />
                        <Text
                          {...textProps}
                          style={[
                            getTextStyle('xs', { isHighContrast }),
                            { color: palette.textMuted },
                          ]}
                          numberOfLines={1}
                        >
                          {selectedPlace.openingHours}
                        </Text>
                      </View>
                    ) : null}
                    {selectedPlace.phone ? (
                      <View style={tw`flex-row items-center`}>
                        <Feather name="phone" size={12} color={palette.textMuted} style={tw`mr-1.5`} />
                        <Text
                          {...textProps}
                          style={[
                            getTextStyle('xs', { isHighContrast }),
                            { color: palette.textMuted },
                          ]}
                          numberOfLines={1}
                        >
                          {selectedPlace.phone}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                )}

                {/* Directions action (≥48dp) */}
                <TouchableOpacity
                  onPress={handlePlaceDirections}
                  activeOpacity={0.85}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={`Get directions to ${selectedPlace.title}`}
                  accessibilityHint="Shows the route preview with safety analysis, then live navigation"
                  style={[
                    tw`flex-row items-center justify-center rounded-2xl py-3.5`,
                    isHighContrast
                      ? { backgroundColor: '#FFFFFF', borderColor: '#000000', borderWidth: 2, minHeight: 52 }
                      : { backgroundColor: palette.primary, minHeight: 52, elevation: 4 },
                  ]}
                >
                  <MaterialIcons
                    name="directions"
                    size={20}
                    color={isHighContrast ? '#000000' : '#FFFFFF'}
                    style={tw`mr-2`}
                  />
                  <Text
                    {...textProps}
                    style={[
                      tw`font-bold`,
                      getTextStyle('sm', { isHighContrast }),
                      { color: isHighContrast ? '#000000' : '#FFFFFF' },
                    ]}
                  >
                    Directions
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Tap Route: Distance, ETA & Safety Status Header Card */}
            {tapRouteMeta && !tapRouteLoading && !selectedPlace && (
              <View
                style={[
                  tw`absolute ${isSearchExpanded ? 'top-18' : 'top-3'} left-4 right-4 z-30 rounded-2xl p-3.5 shadow-xl`,
                  {
                    backgroundColor: palette.surface,
                    borderColor: palette.cardBorder,
                    borderWidth: isHighContrast ? 2 : 1,
                  },
                  isHighContrast && { shadowOpacity: 0, elevation: 0, borderColor: '#000000' },
                ]}
              >
                {/* Header Row: Destination Name & Close Button */}
                <View style={tw`flex-row items-center justify-between mb-2`}>
                  <View style={tw`flex-row items-center flex-1 mr-2`}>
                    <View
                      style={[
                        tw`w-8 h-8 rounded-xl items-center justify-center mr-2.5`,
                        {
                          backgroundColor: isHighContrast ? palette.surfaceAlt : '#EBF7F0',
                          borderWidth: isHighContrast ? borderWidth : 0,
                          borderColor: palette.border,
                        },
                      ]}
                    >
                      <MaterialIcons name="directions" size={18} color={palette.primary} />
                    </View>
                    <Text
                      {...textProps}
                      style={[
                        tw`font-bold flex-1`,
                        getTextStyle('sm', { isHighContrast }),
                        { color: palette.textPrimary },
                      ]}
                      numberOfLines={1}
                    >
                      {tapRouteMeta.destName}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={handleClearTap}
                    style={[tw`w-8 h-8 rounded-full items-center justify-center`]}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    accessible
                    accessibilityRole="button"
                    accessibilityLabel="Clear route and destination"
                  >
                    <MaterialIcons name="close" size={20} color={palette.textMuted} />
                  </TouchableOpacity>
                </View>

                {/* Metrics & Quick Status Badge Row */}
                <View style={tw`flex-row items-center justify-between flex-wrap gap-2 pt-2 border-t border-gray-100`}>
                  <View style={tw`flex-row items-center gap-2`}>
                    {/* Exact Distance */}
                    <View
                      style={[
                        tw`px-2.5 py-1 rounded-lg`,
                        {
                          backgroundColor: isHighContrast ? palette.surfaceAlt : '#F1F5F9',
                          borderWidth: isHighContrast ? borderWidth : 0,
                          borderColor: palette.border,
                        },
                      ]}
                    >
                      <Text
                        {...textProps}
                        style={[
                          tw`font-bold`,
                          getTextStyle('xs', { isHighContrast }),
                          { color: palette.textPrimary },
                        ]}
                      >
                        {tapRouteMeta.distanceText}
                      </Text>
                    </View>

                    {/* Estimated Wheelchair ETA */}
                    <View
                      style={[
                        tw`flex-row items-center px-2.5 py-1 rounded-lg`,
                        {
                          backgroundColor: isHighContrast ? palette.surfaceAlt : '#F1F5F9',
                          borderWidth: isHighContrast ? borderWidth : 0,
                          borderColor: palette.border,
                        },
                      ]}
                    >
                      <FontAwesome5 name="wheelchair" size={10} color={palette.primary} style={tw`mr-1.5`} />
                      <Text
                        {...textProps}
                        style={[
                          tw`font-bold`,
                          getTextStyle('xs', { isHighContrast }),
                          { color: palette.textPrimary },
                        ]}
                      >
                        {tapRouteMeta.etaText}
                      </Text>
                    </View>
                  </View>

                  {/* Quick Status Badge */}
                  {safetyStatus && (
                    <View
                      style={[
                        tw`flex-row items-center px-2.5 py-1 rounded-full`,
                        {
                          backgroundColor: isHighContrast ? palette.surface : safetyStatus.bg,
                          borderColor: isHighContrast ? '#000000' : safetyStatus.border,
                          borderWidth: isHighContrast ? 2 : 1,
                        },
                      ]}
                    >
                      <Feather
                        name={safetyStatus.iconName || 'check-circle'}
                        size={12}
                        color={isHighContrast ? palette.textPrimary : safetyStatus.color}
                        style={tw`mr-1`}
                      />
                      <Text
                        {...textProps}
                        style={[
                          tw`font-bold`,
                          getTextStyle('xs', { isHighContrast }),
                          { color: isHighContrast ? palette.textPrimary : safetyStatus.color },
                        ]}
                      >
                        {safetyStatus.badgeText}
                      </Text>
                    </View>
                  )}
                </View>

              </View>
            )}

            {/* Tap Route: Error badge */}
            {tapRouteError && !tapRouteLoading && !tapRouteMeta && (
              <View
                style={[
                  tw`absolute top-3 left-4 right-4 z-30 flex-row items-center p-3 rounded-2xl shadow-md`,
                  isHighContrast
                    ? { backgroundColor: palette.errorBg, borderColor: palette.error, borderWidth: 2 }
                    : { backgroundColor: 'rgba(239,68,68,0.95)', borderColor: '#DC2626', borderWidth: 1 },
                ]}
              >
                <Feather name="alert-circle" size={16} color={isHighContrast ? palette.error : '#FFFFFF'} style={tw`mr-2`} />
                <Text style={[tw`text-xs font-medium flex-1`, isHighContrast ? { color: palette.error } : tw`text-white`]} numberOfLines={2}>
                  {tapRouteError}
                </Text>
                <TouchableOpacity
                  onPress={handleClearTap}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss error"
                >
                  <MaterialIcons name="close" size={18} color={isHighContrast ? palette.error : '#FFFFFF'} />
                </TouchableOpacity>
              </View>
            )}

            {/* Data Loading Banner — shown while initial DB sync is in progress */}
            {isLoadingData && (
              <View
                style={[
                  tw`absolute top-2 left-4 right-4 z-40 flex-row items-center justify-center p-2 rounded-xl`,
                  { backgroundColor: isHighContrast ? '#000000' : 'rgba(0,0,0,0.75)', borderWidth: isHighContrast ? 2 : 0, borderColor: '#FFFFFF' },
                ]}
              >
                <ActivityIndicator size="small" color={isHighContrast ? '#FFFFFF' : '#10B981'} style={tw`mr-2`} />
                <Text style={[tw`text-xs font-semibold`, isHighContrast ? { color: '#FFFFFF' } : tw`text-white`]}>
                  Syncing live MongoDB nodes & pathways...
                </Text>
              </View>
            )}

            {dataError && !isLoadingData && (
              <View
                style={[
                  tw`absolute top-2 left-4 right-4 z-40 flex-row items-center justify-between p-2.5 rounded-xl bg-amber-900/90 border border-amber-500`,
                  isHighContrast && { backgroundColor: palette.warningBg, borderColor: palette.warning, borderWidth: 2 },
                ]}
              >
                <View style={tw`flex-row items-center flex-1 mr-2`}>
                  <Feather name="alert-circle" size={16} color={isHighContrast ? palette.warning : '#FCD34D'} style={tw`mr-1.5`} />
                  <Text style={[tw`text-xs font-medium`, isHighContrast ? { color: palette.warning } : tw`text-amber-100`]}>
                    Offline: Using local cache ({dataError})
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => {
                    // Retry load
                    checkHealth()
                      .then((h) => setIsBackendConnected(h?.status === 'ok'))
                      .catch(() => setIsBackendConnected(false));
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel="Retry loading data"
                >
                  <Text style={[tw`text-xs font-bold underline`, isHighContrast ? { color: palette.primary } : tw`text-white`]}>Retry</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Accessible Search Bar & Real Destination Search List Overlay */}
            {isSearchExpanded && (
              <View
                style={[
                  tw`absolute top-3 left-4 right-4 z-30 rounded-2xl shadow-xl`,
                  {
                    backgroundColor: palette.surface,
                    borderColor: palette.cardBorder,
                    borderWidth,
                  },
                  isHighContrast && { shadowOpacity: 0, elevation: 0 },
                ]}
              >
                <View style={tw`p-3 pb-2`}>
                  <Input
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder="Search accessible destinations..."
                    accessibilityLabel="Search accessible destination bar"
                    containerStyle={{ marginVertical: 0 }}
                    showClear
                    onClear={() => setSearchQuery('')}
                    leftIcon={<Feather name="search" size={18} color={palette.primary} />}
                    onSubmitEditing={handleSearchSubmit}
                    returnKeyType="search"
                    blurOnSubmit={false}
                  />
                </View>

                {/* Real Destination Search List */}
                <View style={[tw`border-t px-3 pt-2 pb-3`, { borderColor: palette.border }]}>
                  <View style={tw`flex-row items-center justify-between mb-2 px-1`}>
                    <Text
                      {...textProps}
                      style={[
                        tw`font-bold tracking-wider uppercase`,
                        getTextStyle('xs', { isHighContrast }),
                        { color: palette.textMuted },
                      ]}
                    >
                      Destinations ({filteredDestinations.length})
                    </Text>
                    {recentDestinations.length > 0 && (
                      <TouchableOpacity
                        onPress={() => {
                          setRecentDestinations([]);
                          saveRecentSearches([]);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel="Clear recent destinations"
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Text {...textProps} style={[tw`text-xs`, { color: palette.primary }]}>
                          Clear all
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  <ScrollView
                    style={tw`max-h-52`}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                  >
                    {filteredDestinations.length === 0 ? (
                      searchQuery.trim() ? null : (
                        <View style={tw`py-4 items-center justify-center`}>
                          <Feather name="search" size={20} color={palette.textMuted} />
                          <Text
                            {...textProps}
                            style={[
                              tw`mt-1 text-center`,
                              getTextStyle('xs', { isHighContrast }),
                              { color: palette.textMuted },
                            ]}
                          >
                            Search above or select accessible locations
                          </Text>
                        </View>
                      )
                    ) : (
                      filteredDestinations.map((item) => (
                        <TouchableOpacity
                          key={item.id}
                          style={[
                            tw`flex-row items-center py-2.5 px-2 rounded-xl mb-1`,
                            {
                              minHeight: 48,
                              backgroundColor:
                                searchQuery === item.title
                                  ? isHighContrast
                                    ? palette.surfaceAlt
                                    : palette.secondaryBg
                                  : 'transparent',
                            },
                          ]}
                          onPress={() => handleSelectDestination(item)}
                          activeOpacity={0.7}
                          accessible
                          accessibilityRole="button"
                          accessibilityLabel={`${item.title}, ${item.distance || ''} away, ${item.desc || ''}`}
                          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                        >
                          <View
                            style={[
                              tw`w-9 h-9 rounded-xl items-center justify-center mr-3`,
                              {
                                backgroundColor: isHighContrast
                                  ? palette.surfaceAlt
                                  : palette.secondaryBg,
                                borderWidth: isHighContrast ? borderWidth : 0,
                                borderColor: palette.border,
                              },
                            ]}
                          >
                            {item.type === 'elevator' ? (
                              <MaterialCommunityIcons
                                name="elevator-passenger"
                                size={18}
                                color={palette.primary}
                              />
                            ) : item.type === 'transit' ? (
                              <Feather name="navigation" size={16} color={palette.primary} />
                            ) : (
                              <FontAwesome5 name="wheelchair" size={14} color={palette.primary} />
                            )}
                          </View>

                          <View style={tw`flex-1 mr-2`}>
                            <Text
                              {...textProps}
                              style={[
                                tw`font-semibold`,
                                getTextStyle('sm', { isHighContrast }),
                                { color: palette.textPrimary },
                              ]}
                              numberOfLines={1}
                            >
                              {item.title}
                            </Text>
                            <Text
                              {...textProps}
                              style={[
                                getTextStyle('xs', { isHighContrast }),
                                { color: palette.textMuted },
                              ]}
                              numberOfLines={1}
                            >
                              {item.desc}
                            </Text>
                          </View>

                          <View
                            style={[
                              tw`px-2 py-0.5 rounded-lg`,
                              {
                                backgroundColor: isHighContrast
                                  ? palette.surface
                                  : '#EBF7F0',
                                borderWidth: isHighContrast ? borderWidth : 0,
                                borderColor: palette.border,
                              },
                            ]}
                          >
                            <Text
                              {...textProps}
                              style={[
                                tw`text-xs font-bold`,
                                { color: isHighContrast ? palette.textPrimary : palette.primary },
                              ]}
                            >
                              {item.distance || 'Live'}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      ))
                    )}

                    {/* ── Local DB results: ~5k places table — tap → lat/lon from DB → map ── */}
                    {searchQuery.trim().length >= 2 && (
                      <View style={tw`mt-2`}>
                        {isLocalSearching && localResults.length === 0 && (
                          <View style={tw`items-center py-1.5`}>
                            <ActivityIndicator size="small" color={palette.primary} />
                          </View>
                        )}

                        {localResults.map((item) => {
                          const wcChip = wheelchairChip(item.wheelchair);
                          const wcLabel = wcChip ? `, ${wcChip.text}` : '';
                          return (
                            <TouchableOpacity
                              key={item.id}
                              style={[
                                tw`flex-row items-center py-2.5 px-2 rounded-xl mb-1`,
                                { minHeight: 56 },
                              ]}
                              onPress={() => handleSelectDestination(item)}
                              activeOpacity={0.7}
                              accessible
                              accessibilityRole="button"
                              accessibilityLabel={`${item.title}, ${item.categoryLabel || 'Place'}, ${item.addressShort}${wcLabel}. Tap to show on map.`}
                              accessibilityHint="Shows this saved place on the map with directions"
                              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                            >
                              <View
                                style={[
                                  tw`w-10 h-10 rounded-xl items-center justify-center mr-3`,
                                  {
                                    backgroundColor: isHighContrast
                                      ? palette.surfaceAlt
                                      : palette.secondaryBg,
                                    borderWidth: isHighContrast ? borderWidth : 0,
                                    borderColor: palette.border,
                                  },
                                ]}
                              >
                                <PlaceCategoryIcon icon={item.icon} size={17} color={palette.primary} />
                              </View>

                              <View style={tw`flex-1 mr-2`}>
                                <Text
                                  {...textProps}
                                  style={[
                                    tw`font-semibold`,
                                    getTextStyle('sm', { isHighContrast }),
                                    { color: palette.textPrimary },
                                  ]}
                                  numberOfLines={1}
                                >
                                  {item.title}
                                </Text>
                                <Text
                                  {...textProps}
                                  style={[
                                    getTextStyle('xs', { isHighContrast }),
                                    { color: palette.textMuted },
                                  ]}
                                  numberOfLines={1}
                                >
                                  {item.addressShort}
                                </Text>
                                <View style={tw`flex-row items-center mt-0.5`}>
                                  <Text
                                    {...textProps}
                                    style={[
                                      tw`font-bold`,
                                      getTextStyle('xs', { isHighContrast }),
                                      { color: isHighContrast ? palette.textPrimary : palette.primary },
                                    ]}
                                  >
                                    {item.categoryLabel || 'Saved'}
                                  </Text>
                                  {wcChip && (
                                    <View
                                      style={[
                                        tw`ml-1.5 px-1.5 py-0.5 rounded-full`,
                                        {
                                          backgroundColor: isHighContrast ? palette.surface : wcChip.bg,
                                          borderColor: isHighContrast ? palette.textPrimary : wcChip.border,
                                          borderWidth: 1,
                                        },
                                      ]}
                                    >
                                      <Text
                                        {...textProps}
                                        style={[
                                          tw`font-bold`,
                                          {
                                            fontSize: 10,
                                            color: isHighContrast ? palette.textPrimary : wcChip.color,
                                          },
                                        ]}
                                      >
                                        {wcChip.text}
                                      </Text>
                                    </View>
                                  )}
                                </View>
                              </View>

                              <Feather name="chevron-right" size={18} color={palette.textMuted} />
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}

                    {/* ── Universal results: any place via OSM (road distance chips) ── */}
                    {searchQuery.trim().length >= 3 && (
                      <View style={tw`mt-2`}>
                        <View style={tw`flex-row items-center justify-between mb-1 px-1`}>
                          <Text
                            {...textProps}
                            style={[
                              tw`font-bold tracking-wider uppercase`,
                              getTextStyle('xs', { isHighContrast }),
                              { color: palette.textMuted },
                            ]}
                          >
                            {isExternalSearching
                              ? 'Searching nearby places…'
                              : `Nearby places (${externalResults.length})`}
                          </Text>
                          {isExternalSearching && (
                            <ActivityIndicator size="small" color={palette.primary} />
                          )}
                        </View>

                        {externalError && !isExternalSearching && (
                          <Text
                            {...textProps}
                            style={[
                              tw`px-1 mb-1`,
                              getTextStyle('xs', { isHighContrast }),
                              { color: palette.textMuted },
                            ]}
                          >
                            {externalError}
                          </Text>
                        )}

                        {!isExternalSearching &&
                          !externalError &&
                          externalResults.length === 0 && (
                            <Text
                              {...textProps}
                              style={[
                                tw`px-1 mb-1`,
                                getTextStyle('xs', { isHighContrast }),
                                { color: palette.textMuted },
                              ]}
                            >
                              No street-map matches — try a landmark (e.g. Fort, Galle Face).
                            </Text>
                          )}

                        {externalResults.map((item) => {
                          const wcChip = wheelchairChip(item.wheelchair);
                          const wcLabel = wcChip ? `, ${wcChip.text}` : '';
                          return (
                            <TouchableOpacity
                              key={item.id}
                              style={[
                                tw`flex-row items-center py-2.5 px-2 rounded-xl mb-1`,
                                { minHeight: 56 },
                              ]}
                              onPress={() => handleSelectDestination(item)}
                              activeOpacity={0.7}
                              accessible
                              accessibilityRole="button"
                              accessibilityLabel={`${item.title}, ${item.categoryLabel || 'Place'}, ${item.addressShort}, road distance ${item.roadDistanceText}, wheelchair estimate ${item.etaText}${wcLabel}`}
                              accessibilityHint="Opens place details with a Directions button"
                              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                            >
                              <View
                                style={[
                                  tw`w-10 h-10 rounded-xl items-center justify-center mr-3`,
                                  {
                                    backgroundColor: isHighContrast
                                      ? palette.surfaceAlt
                                      : palette.secondaryBg,
                                    borderWidth: isHighContrast ? borderWidth : 0,
                                    borderColor: palette.border,
                                  },
                                ]}
                              >
                                <PlaceCategoryIcon icon={item.icon} size={17} color={palette.primary} />
                              </View>

                              <View style={tw`flex-1 mr-2`}>
                                <Text
                                  {...textProps}
                                  style={[
                                    tw`font-semibold`,
                                    getTextStyle('sm', { isHighContrast }),
                                    { color: palette.textPrimary },
                                  ]}
                                  numberOfLines={1}
                                >
                                  {item.title}
                                </Text>
                                <Text
                                  {...textProps}
                                  style={[
                                    getTextStyle('xs', { isHighContrast }),
                                    { color: palette.textMuted },
                                  ]}
                                  numberOfLines={1}
                                >
                                  {item.addressShort}
                                </Text>
                                <View style={tw`flex-row items-center mt-0.5`}>
                                  <Text
                                    {...textProps}
                                    style={[
                                      tw`font-bold`,
                                      getTextStyle('xs', { isHighContrast }),
                                      { color: isHighContrast ? palette.textPrimary : palette.primary },
                                    ]}
                                  >
                                    {item.roadDistanceText}
                                  </Text>
                                  <Text
                                    {...textProps}
                                    style={[
                                      getTextStyle('xs', { isHighContrast }),
                                      { color: palette.textMuted },
                                    ]}
                                  >
                                    {` · ♿ ${item.etaText}`}
                                  </Text>
                                  {wcChip && (
                                    <View
                                      style={[
                                        tw`ml-1.5 px-1.5 py-0.5 rounded-full`,
                                        {
                                          backgroundColor: isHighContrast ? palette.surface : wcChip.bg,
                                          borderColor: isHighContrast ? palette.textPrimary : wcChip.border,
                                          borderWidth: 1,
                                        },
                                      ]}
                                    >
                                      <Text
                                        {...textProps}
                                        style={[
                                          tw`font-bold`,
                                          {
                                            fontSize: 10,
                                            color: isHighContrast ? palette.textPrimary : wcChip.color,
                                          },
                                        ]}
                                      >
                                        {wcChip.text}
                                      </Text>
                                    </View>
                                  )}
                                </View>
                              </View>

                              <Feather name="chevron-right" size={18} color={palette.textMuted} />
                            </TouchableOpacity>
                          );
                        })}

                        <Text
                          {...textProps}
                          style={[
                            tw`px-1 pt-1`,
                            getTextStyle('xs', { isHighContrast }),
                            { color: palette.textMuted },
                          ]}
                        >
                          © OpenStreetMap contributors
                        </Text>
                      </View>
                    )}
                  </ScrollView>
                </View>
              </View>
            )}

            {/* Floating Wheelchair Mobility & Filter FAB — Bottom-Left (>=48dp) */}
            <TouchableOpacity
              style={[
                tw`absolute left-5 bottom-5 w-13 h-13 rounded-full items-center justify-center shadow-lg z-20`,
                {
                  backgroundColor: isWheelchairAccessible
                    ? isHighContrast
                      ? palette.primary
                      : '#0B3D2E'
                    : palette.surface,
                  borderWidth: isHighContrast ? 2 : 1.5,
                  borderColor: isWheelchairAccessible
                    ? isHighContrast
                      ? '#000000'
                      : '#10B981'
                    : palette.cardBorder,
                },
                isHighContrast && { shadowOpacity: 0, elevation: 0 },
              ]}
              onPress={() => setIsDrawerOpen(true)}
              activeOpacity={0.85}
              accessible
              accessibilityRole="button"
              accessibilityLabel={`Wheelchair accessibility routing mode is ${
                isWheelchairAccessible ? 'enabled' : 'disabled'
              }. Tap to open mobility settings and route filters drawer.`}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <FontAwesome5
                name="wheelchair"
                size={20}
                color={
                  isWheelchairAccessible
                    ? '#FFFFFF'
                    : isHighContrast
                    ? palette.textPrimary
                    : palette.primary
                }
              />
              {isWheelchairAccessible && (
                <View
                  style={[
                    tw`absolute -top-1 -right-1 w-4.5 h-4.5 rounded-full items-center justify-center border-2 border-white`,
                    { backgroundColor: isHighContrast ? palette.success : '#10B981' },
                  ]}
                >
                  <Feather name="check" size={10} color="#FFFFFF" />
                </View>
              )}
            </TouchableOpacity>

            {/* Floating Navigation FAB — Recenter map on user location */}
            <TouchableOpacity
              style={[
                tw`absolute right-5 bottom-5 w-13 h-13 rounded-full items-center justify-center shadow-lg z-20`,
                {
                  backgroundColor: palette.surface,
                  borderWidth: isHighContrast ? borderWidth : 0,
                  borderColor: palette.cardBorder,
                },
                isHighContrast && { shadowOpacity: 0, elevation: 0 },
              ]}
              onPress={handleRecenter}
              activeOpacity={0.85}
              accessible
              accessibilityRole="button"
              accessibilityLabel="Recenter map to your current location"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather name="navigation" size={22} color={palette.primary} />
            </TouchableOpacity>

            {/* Floating Audio-First FAB — Reopen launcher modal (only when enabled) */}
            {isAudioLauncherEnabled && (
              <TouchableOpacity
                style={[
                  tw`absolute right-5 bottom-20 w-13 h-13 rounded-full items-center justify-center shadow-lg z-20`,
                  {
                    backgroundColor: palette.surface,
                    borderWidth: isHighContrast ? borderWidth : 1.5,
                    borderColor: isHighContrast ? '#000000' : palette.primary,
                  },
                  isHighContrast && { shadowOpacity: 0, elevation: 0 },
                ]}
                onPress={() => setShowLauncher(true)}
                activeOpacity={0.85}
                accessible
                accessibilityRole="button"
                accessibilityLabel="Open Audio-First voice launcher"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Feather name="mic" size={22} color={palette.primary} />
              </TouchableOpacity>
            )}
          </View>

          {/* ── Contextual Location Safety & Accessibility Bottom Sheet ── */}
          {isTapSummarySheetVisible && (
            <View
              style={[
                tw`rounded-t-[28px] px-5 pt-3 pb-2 shadow-2xl`,
                {
                  backgroundColor: palette.surface,
                  borderTopWidth: borderWidth,
                  borderColor: palette.cardBorder,
                },
                isHighContrast && { shadowOpacity: 0, elevation: 0, borderTopWidth: 2, borderColor: '#000000' },
              ]}
            >
              {/* Top Handle Drag Pill */}
              <View
                style={[
                  tw`w-10 h-1 rounded-full self-center mb-2.5`,
                  { backgroundColor: palette.borderStrong },
                ]}
              />

              {/* Sheet Title & Close Row */}
              <View style={tw`flex-row items-center justify-between mb-2.5`}>
                <View>
                  <View style={tw`flex-row items-center`}>
                    <Text
                      {...textProps}
                      style={[
                        tw`mr-2`,
                        getTextStyle('lg', { isHighContrast }),
                        { color: palette.textPrimary, fontWeight: '800' },
                      ]}
                    >
                      Proximity Safety Analysis
                    </Text>
                    {isBackendConnected && (
                      <View style={[tw`px-2 py-0.5 rounded-full bg-emerald-100 flex-row items-center`, isHighContrast && { backgroundColor: palette.successBg, borderWidth: 2, borderColor: palette.success }]}>
                        <View style={[tw`w-2 h-2 rounded-full bg-emerald-600 mr-1`, isHighContrast && { backgroundColor: palette.success }]} />
                        <Text style={[tw`text-[10px] font-bold text-emerald-700`, isHighContrast && { color: palette.success }]}>Live Data</Text>
                      </View>
                    )}
                  </View>
                  <Text
                    {...textProps}
                    style={[
                      getTextStyle('xs', { isHighContrast }),
                      { color: palette.textMuted },
                    ]}
                  >
                    Contextual analysis within 400m radius & along route
                  </Text>
                </View>

                <TouchableOpacity
                  onPress={() => setIsTapSummarySheetVisible(false)}
                  style={[tw`w-10 h-10 rounded-full items-center justify-center`]}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss proximity safety analysis sheet"
                >
                  <MaterialIcons name="close" size={22} color={palette.textMuted} />
                </TouchableOpacity>
              </View>

              {/* Quick Start Navigation Action Bar (≥48dp WCAG Target) */}
              <TouchableOpacity
                onPress={handleStartTapNavigation}
                activeOpacity={0.85}
                accessible
                accessibilityRole="button"
                accessibilityLabel={`Start live navigation to ${tapRouteMeta?.destName || 'tapped location'}`}
                accessibilityHint="Starts live turn-by-turn GPS navigation along this route"
                style={[
                  tw`flex-row items-center justify-between rounded-2xl p-3.5 mb-3 shadow-md`,
                  isHighContrast
                    ? { backgroundColor: '#FFFFFF', borderColor: '#000000', borderWidth: 2, minHeight: 52 }
                    : { backgroundColor: palette.primary, minHeight: 52, elevation: 4 },
                ]}
              >
                <View style={tw`flex-row items-center flex-1 mr-2`}>
                  <View
                    style={[
                      tw`w-10 h-10 rounded-xl items-center justify-center mr-3`,
                      { backgroundColor: isHighContrast ? '#000000' : 'rgba(255,255,255,0.2)' },
                    ]}
                  >
                    <MaterialCommunityIcons
                      name="navigation"
                      size={22}
                      color={isHighContrast ? '#FFFFFF' : '#FFFFFF'}
                    />
                  </View>
                  <View style={tw`flex-1`}>
                    <Text
                      style={[
                        tw`font-bold text-sm`,
                        { color: isHighContrast ? '#000000' : '#FFFFFF' },
                      ]}
                    >
                      Start Live Navigation
                    </Text>
                    <Text
                      style={[
                        tw`text-xs`,
                        { color: isHighContrast ? '#333333' : '#A7F3D0' },
                      ]}
                    >
                      {tapRouteMeta?.distanceText || 'Direct Route'} • {tapRouteMeta?.etaText || 'Step-free'}
                    </Text>
                  </View>
                </View>
                <MaterialIcons name="arrow-forward" size={22} color={isHighContrast ? '#000000' : '#FFFFFF'} />
              </TouchableOpacity>

              {/* Two Category Selector Tabs (Touch targets >= 48dp) */}
              <View style={tw`flex-row items-center gap-2 mb-3`}>
                {/* Category A: Issues / Hazards */}
                <TouchableOpacity
                  style={[
                    tw`flex-1 flex-row items-center justify-center rounded-xl px-3`,
                    {
                      minHeight: 48,
                      backgroundColor: activeSheetCategory === 'hazards'
                        ? isHighContrast ? palette.surfaceAlt : '#FEF2F2'
                        : isHighContrast ? palette.surface : '#F8FAFC',
                      borderWidth: activeSheetCategory === 'hazards' ? (isHighContrast ? 2 : 1.5) : 1,
                      borderColor: activeSheetCategory === 'hazards'
                        ? isHighContrast ? '#000000' : '#FCA5A5'
                        : palette.cardBorder,
                    },
                  ]}
                  onPress={() => setActiveSheetCategory('hazards')}
                  activeOpacity={0.7}
                  accessible
                  accessibilityRole="tab"
                  accessibilityState={{ selected: activeSheetCategory === 'hazards' }}
                  accessibilityLabel={`Issues and Hazards category tab, ${nearbyHazards.length} items found`}
                  hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                >
                  <Feather
                    name="alert-triangle"
                    size={16}
                    color={activeSheetCategory === 'hazards' ? (isHighContrast ? palette.textPrimary : '#DC2626') : palette.textMuted}
                    style={tw`mr-1.5`}
                  />
                  <Text
                    {...textProps}
                    style={[
                      getTextStyle('xs', { isHighContrast }),
                      {
                        fontWeight: '700',
                        color: activeSheetCategory === 'hazards'
                          ? (isHighContrast ? palette.textPrimary : '#DC2626')
                          : palette.textMuted,
                      },
                    ]}
                  >
                    Hazards ({nearbyHazards.length})
                  </Text>
                </TouchableOpacity>

                {/* Category B: Accessible / Helpful Features */}
                <TouchableOpacity
                  style={[
                    tw`flex-1 flex-row items-center justify-center rounded-xl px-3`,
                    {
                      minHeight: 48,
                      backgroundColor: activeSheetCategory === 'accessible'
                        ? isHighContrast ? palette.surfaceAlt : '#ECFDF5'
                        : isHighContrast ? palette.surface : '#F8FAFC',
                      borderWidth: activeSheetCategory === 'accessible' ? (isHighContrast ? 2 : 1.5) : 1,
                      borderColor: activeSheetCategory === 'accessible'
                        ? isHighContrast ? '#000000' : '#86EFAC'
                        : palette.cardBorder,
                    },
                  ]}
                  onPress={() => setActiveSheetCategory('accessible')}
                  activeOpacity={0.7}
                  accessible
                  accessibilityRole="tab"
                  accessibilityState={{ selected: activeSheetCategory === 'accessible' }}
                  accessibilityLabel={`Accessible Features category tab, ${nearbyAccessible.length} features found`}
                  hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                >
                  <Feather
                    name="check-circle"
                    size={16}
                    color={activeSheetCategory === 'accessible' ? (isHighContrast ? palette.success : '#16A34A') : palette.textMuted}
                    style={tw`mr-1.5`}
                  />
                  <Text
                    {...textProps}
                    style={[
                      getTextStyle('xs', { isHighContrast }),
                      {
                        fontWeight: '700',
                        color: activeSheetCategory === 'accessible'
                          ? (isHighContrast ? palette.success : '#16A34A')
                          : palette.textMuted,
                      },
                    ]}
                  >
                    Accessible ({nearbyAccessible.length})
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Category Content Cards */}
              <ScrollView style={tw`max-h-48`} showsVerticalScrollIndicator={false}>
                {activeSheetCategory === 'hazards' ? (
                  nearbyHazards.length === 0 ? (
                    <View style={tw`py-6 items-center justify-center`}>
                      <Feather name="check-circle" size={24} color={isHighContrast ? palette.success : '#16A34A'} />
                      <Text
                        {...textProps}
                        style={[
                          tw`mt-2 font-bold text-center`,
                          getTextStyle('sm', { isHighContrast }),
                          { color: palette.textPrimary },
                        ]}
                      >
                        No Hazards Detected
                      </Text>
                      <Text
                        {...textProps}
                        style={[
                          tw`text-center mt-1`,
                          getTextStyle('xs', { isHighContrast }),
                          { color: palette.textMuted },
                        ]}
                      >
                        No steep ramps (&gt;8°), stairs without ramps, broken elevators, or construction obstacles detected in this zone.
                      </Text>
                    </View>
                  ) : (
                    nearbyHazards.map((item) => (
                      <TouchableOpacity
                        key={item.id}
                        style={[
                          tw`flex-row items-center rounded-2xl p-3 mb-2 shadow-sm`,
                          {
                            backgroundColor: palette.surface,
                            borderColor: palette.cardBorder,
                            borderWidth,
                            minHeight: 48,
                          },
                          isHighContrast && { shadowOpacity: 0, elevation: 0 },
                        ]}
                        activeOpacity={0.7}
                        accessible
                        accessibilityRole="button"
                        accessibilityLabel={`${item.title}, ${item.desc}, Priority: ${item.priority || 'High'}`}
                        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                      >
                        <View
                          style={[
                            tw`w-11 h-11 rounded-xl items-center justify-center mr-3`,
                            {
                              backgroundColor: isHighContrast ? palette.errorBg : '#FEE2E2',
                              borderWidth: isHighContrast ? borderWidth : 0,
                              borderColor: isHighContrast ? palette.error : palette.cardBorder,
                            },
                          ]}
                        >
                          {item.iconType === 'construction' ? (
                            <MaterialCommunityIcons name="wall" size={20} color={isHighContrast ? palette.error : '#DC2626'} />
                          ) : item.iconType === 'stairs' ? (
                            <MaterialIcons name="stairs" size={20} color={isHighContrast ? palette.error : '#DC2626'} />
                          ) : item.iconType === 'broken_elevator' ? (
                            <MaterialCommunityIcons name="elevator-passenger-outline" size={20} color={isHighContrast ? palette.error : '#DC2626'} />
                          ) : item.iconType === 'slope' ? (
                            <MaterialCommunityIcons name="slope-uphill" size={20} color={isHighContrast ? palette.warning : '#D97706'} />
                          ) : (
                            <Feather name="alert-triangle" size={18} color={isHighContrast ? palette.error : '#DC2626'} />
                          )}
                        </View>

                        <View style={tw`flex-1 mr-2`}>
                          <Text
                            {...textProps}
                            style={[
                              tw`font-bold`,
                              getTextStyle('sm', { isHighContrast }),
                              { color: palette.textPrimary },
                            ]}
                            numberOfLines={1}
                          >
                            {item.title}
                          </Text>
                          <Text
                            {...textProps}
                            style={[
                              getTextStyle('xs', { isHighContrast }),
                              { color: palette.textMuted },
                            ]}
                            numberOfLines={2}
                          >
                            {item.desc}
                          </Text>
                        </View>

                        <View
                          style={[
                            tw`px-2.5 py-1 rounded-lg`,
                            {
                              backgroundColor: isHighContrast
                                ? item.priority === 'High'
                                  ? palette.errorBg
                                  : palette.warningBg
                                : item.priority === 'High'
                                ? '#FEE2E2'
                                : '#FEF3C7',
                              borderWidth: isHighContrast ? borderWidth : 0,
                              borderColor: isHighContrast
                                ? item.priority === 'High'
                                  ? palette.error
                                  : palette.warning
                                : palette.border,
                            },
                          ]}
                        >
                          <Text
                            {...textProps}
                            style={[
                              getTextStyle('xs', { isHighContrast }),
                              {
                                color: isHighContrast
                                  ? item.priority === 'High'
                                    ? palette.error
                                    : palette.warning
                                  : item.priority === 'High'
                                  ? '#DC2626'
                                  : '#B45309',
                                fontWeight: '700',
                              },
                            ]}
                          >
                            {item.priority || 'Hazard'}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    ))
                  )
                ) : (
                  nearbyAccessible.length === 0 ? (
                    <View style={tw`py-6 items-center justify-center`}>
                      <Feather name="info" size={24} color={palette.textMuted} />
                      <Text
                        {...textProps}
                        style={[
                          tw`mt-2 font-bold text-center`,
                          getTextStyle('sm', { isHighContrast }),
                          { color: palette.textPrimary },
                        ]}
                      >
                        No Registered Features
                      </Text>
                      <Text
                        {...textProps}
                        style={[
                          tw`text-center mt-1`,
                          getTextStyle('xs', { isHighContrast }),
                          { color: palette.textMuted },
                        ]}
                      >
                        Standard step-free ground pathways available.
                      </Text>
                    </View>
                  ) : (
                    nearbyAccessible.map((item) => (
                      <TouchableOpacity
                        key={item.id}
                        style={[
                          tw`flex-row items-center rounded-2xl p-3 mb-2 shadow-sm`,
                          {
                            backgroundColor: palette.surface,
                            borderColor: palette.cardBorder,
                            borderWidth,
                            minHeight: 48,
                          },
                          isHighContrast && { shadowOpacity: 0, elevation: 0 },
                        ]}
                        activeOpacity={0.7}
                        accessible
                        accessibilityRole="button"
                        accessibilityLabel={`${item.title}, ${item.desc}, Status: ${item.badge || 'Accessible'}`}
                        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                      >
                        <View
                          style={[
                            tw`w-11 h-11 rounded-xl items-center justify-center mr-3`,
                            {
                              backgroundColor: isHighContrast ? palette.successBg : '#DCFCE7',
                              borderWidth: isHighContrast ? borderWidth : 0,
                              borderColor: isHighContrast ? palette.success : palette.cardBorder,
                            },
                          ]}
                        >
                          {item.iconType === 'elevator' ? (
                            <MaterialCommunityIcons name="elevator-passenger" size={20} color={isHighContrast ? palette.success : '#16A34A'} />
                          ) : item.iconType === 'rest_area' ? (
                            <MaterialIcons name="chair" size={20} color={isHighContrast ? palette.success : '#16A34A'} />
                          ) : item.iconType === 'walkway' ? (
                            <MaterialCommunityIcons name="road-variant" size={20} color={isHighContrast ? palette.success : '#16A34A'} />
                          ) : (
                            <FontAwesome5 name="wheelchair" size={16} color={isHighContrast ? palette.success : '#16A34A'} />
                          )}
                        </View>

                        <View style={tw`flex-1 mr-2`}>
                          <Text
                            {...textProps}
                            style={[
                              tw`font-bold`,
                              getTextStyle('sm', { isHighContrast }),
                              { color: palette.textPrimary },
                            ]}
                            numberOfLines={1}
                          >
                            {item.title}
                          </Text>
                          <Text
                            {...textProps}
                            style={[
                              getTextStyle('xs', { isHighContrast }),
                              { color: palette.textMuted },
                            ]}
                            numberOfLines={2}
                          >
                            {item.desc}
                          </Text>
                        </View>

                        <View
                          style={[
                            tw`px-2.5 py-1 rounded-lg`,
                            {
                              backgroundColor: isHighContrast ? palette.surfaceAlt : '#DCFCE7',
                              borderWidth: isHighContrast ? borderWidth : 0,
                              borderColor: palette.border,
                            },
                          ]}
                        >
                          <Text
                            {...textProps}
                            style={[
                              getTextStyle('xs', { isHighContrast }),
                              {
                                color: isHighContrast ? palette.textPrimary : '#16A34A',
                                fontWeight: '700',
                              },
                            ]}
                          >
                            {item.badge || 'Accessible'}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    ))
                  )
                )}
              </ScrollView>
            </View>
          )}
        </>
      )}

      {/* ── Bottom Navigation Bar — Global High-Contrast, 48dp ── */}
      <View
        style={[
          tw`flex-row items-center justify-around py-2.5 ${Platform.OS === 'ios' ? 'pb-6' : 'pb-2.5'}`,
          {
            backgroundColor: palette.surface,
            borderTopWidth: borderWidth,
            borderTopColor: palette.cardBorder,
          },
          isHighContrast && { shadowOpacity: 0, elevation: 0 },
        ]}
      >
        <TouchableOpacity
          style={[
            tw`items-center justify-center px-3 rounded-2xl mx-1`,
            {
              minHeight: 48,
              minWidth: 64,
              backgroundColor: activeTab === 'Map' ? palette.primary : 'transparent',
              borderWidth: activeTab === 'Map' && isHighContrast ? borderWidth : 0,
              borderColor: palette.cardBorder,
              paddingVertical: 6,
              ...(activeTab === 'Map' && !isHighContrast
                ? { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 4, elevation: 3 }
                : {}),
            },
          ]}
          onPress={() => setActiveTab('Map')}
          activeOpacity={0.7}
          accessible
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'Map' }}
          accessibilityLabel="Map tab"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather
            name="map"
            size={22}
            color={activeTab === 'Map' ? palette.primaryText : palette.textMuted}
          />
          <Text
            {...textProps}
            style={[
              tw`mt-1 text-center`,
              getTextStyle('xs', { isHighContrast }),
              { color: activeTab === 'Map' ? palette.primaryText : palette.textMuted },
            ]}
          >
            Map
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            tw`items-center justify-center px-3 rounded-2xl mx-1`,
            {
              minHeight: activeTab === 'Report' ? 56 : 48,
              minWidth: activeTab === 'Report' ? 92 : 70,
              backgroundColor: activeTab === 'Report' ? palette.primary : 'transparent',
              borderWidth: activeTab === 'Report' && isHighContrast ? borderWidth : 0,
              borderColor: palette.cardBorder,
              paddingVertical: 6,
              ...(activeTab === 'Report' && !isHighContrast
                ? { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.18, shadowRadius: 4, elevation: 4 }
                : {}),
            },
          ]}
          onPress={() => setActiveTab('Report')}
          activeOpacity={0.85}
          accessible
          accessibilityRole="button"
          accessibilityLabel="Report Barrier"
          accessibilityHint="Opens barrier reporting"
          accessibilityState={{ selected: activeTab === 'Report' }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather
            name="alert-triangle"
            size={activeTab === 'Report' ? 20 : 22}
            color={activeTab === 'Report' ? palette.primaryText : palette.textMuted}
          />
          <Text
            {...textProps}
            style={[
              tw`mt-0.5 font-bold text-center`,
              getTextStyle('xs', { isHighContrast }),
              { color: activeTab === 'Report' ? palette.primaryText : palette.textMuted },
            ]}
          >
            Report Barrier
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            tw`items-center justify-center px-3 rounded-2xl mx-1`,
            {
              minHeight: 48,
              minWidth: 64,
              backgroundColor: activeTab === 'Profile' ? palette.primary : 'transparent',
              borderWidth: activeTab === 'Profile' && isHighContrast ? borderWidth : 0,
              borderColor: palette.cardBorder,
              paddingVertical: 6,
              ...(activeTab === 'Profile' && !isHighContrast
                ? { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 4, elevation: 3 }
                : {}),
            },
          ]}
          onPress={() => setActiveTab('Profile')}
          activeOpacity={0.7}
          accessible
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'Profile' }}
          accessibilityLabel="Profile tab"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather
            name="user"
            size={22}
            color={activeTab === 'Profile' ? palette.primaryText : palette.textMuted}
          />
          <Text
            {...textProps}
            style={[
              tw`mt-1 text-center`,
              getTextStyle('xs', { isHighContrast }),
              { color: activeTab === 'Profile' ? palette.primaryText : palette.textMuted },
            ]}
          >
            Profile
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            tw`items-center justify-center px-3 rounded-2xl mx-1`,
            {
              minHeight: 48,
              minWidth: 64,
              backgroundColor: activeTab === 'Settings' ? palette.primary : 'transparent',
              borderWidth: activeTab === 'Settings' && isHighContrast ? borderWidth : 0,
              borderColor: palette.cardBorder,
              paddingVertical: 6,
              ...(activeTab === 'Settings' && !isHighContrast
                ? { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 4, elevation: 3 }
                : {}),
            },
          ]}
          onPress={() => setActiveTab('Settings')}
          activeOpacity={0.7}
          accessible
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'Settings' }}
          accessibilityLabel="Settings tab"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather
            name="settings"
            size={22}
            color={activeTab === 'Settings' ? palette.primaryText : palette.textMuted}
          />
          <Text
            {...textProps}
            style={[
              tw`mt-1 text-center`,
              getTextStyle('xs', { isHighContrast }),
              { color: activeTab === 'Settings' ? palette.primaryText : palette.textMuted },
            ]}
          >
            Settings
          </Text>
        </TouchableOpacity>
      </View>

      {/* SPT-104 single page: Audio-First Launcher as Initial Modal over UnityMapScreen */}
      <Modal
        visible={showLauncher}
        animationType="fade"
        transparent={false}
        onRequestClose={() => setShowLauncher(false)}
        accessibilityViewIsModal
      >
        <AudioFirstLauncherScreen onNavigate={handleLauncherNavigate} searchHints={searchHints} />
        <TouchableOpacity
          onPress={() => setShowLauncher(false)}
          style={[tw`absolute top-12 right-4 px-3 py-2 rounded-full bg-black/60`, isHighContrast && { borderWidth: 2, borderColor: '#FFFFFF', backgroundColor: '#000000' }]}
          accessibilityRole="button"
          accessibilityLabel="Dismiss launcher, show map"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={tw`text-white text-xs font-bold`}>Skip to Map</Text>
        </TouchableOpacity>
      </Modal>

      {/* SPT-106: Voice Input & Summary Readout Screen — single-tap confirmation modal */}
      <Modal
        visible={showVoiceSummary}
        animationType="slide"
        transparent={false}
        onRequestClose={handleVoiceCancel}
        accessibilityViewIsModal
      >
        <VoiceNavigationScreen
          initialTranscript={voiceTranscript}
          routeSummary={voiceRouteSummary}
          matches={voiceMatches}
          selectedMatchId={voiceSelectedMatchId}
          onSelectMatch={handleVoiceMatchSelect}
          onTranscriptChange={handleVoiceTranscriptChange}
          searchHints={searchHints}
          onConfirm={handleVoiceConfirm}
          onCancel={handleVoiceCancel}
        />
      </Modal>

      {/* SPT-204: Spoken Guidance & Hazard Warning UI — modal over UnityMapScreen */}
      <Modal
        visible={showGuidance}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setShowGuidance(false)}
        accessibilityViewIsModal
      >
        <SpokenGuidanceHazardWarningScreen
          routeSummary={voiceRouteSummary || tapRouteMeta}
          nearbyHazards={nearbyHazards}
          safetyStatus={safetyStatus}
          onReprompt={() => speak(voiceRouteSummary?.spokenSummary || tapRouteMeta?.spokenSummary || 'Reprompting guidance')}
          onDismiss={() => setShowGuidance(false)}
        />
      </Modal>

      {/* SPT-201: Google Maps Style Live Turn-by-Turn Navigation Screen Modal */}
      <Modal
        visible={isTurnByTurnActive}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setIsTurnByTurnActive(false)}
        accessibilityViewIsModal
      >
        <LiveTurnByTurnNavigationScreen
          route={activeNavRoute}
          originName={activeNavRoute?.originName || 'Your Location'}
          destinationName={activeNavRoute?.destName || tapRouteMeta?.destName || 'Selected Destination'}
          elevators={dbElevators}
          onExitNavigation={() => setIsTurnByTurnActive(false)}
        />
      </Modal>
    </View>
  );
};

export default UnityMapScreen;
