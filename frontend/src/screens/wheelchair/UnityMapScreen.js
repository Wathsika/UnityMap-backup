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

/**
 * UnityMapScreen.js — Accessible Map & Real-time Live MongoDB Explorer
 * Features:
 * - 100% Real Live Node.js + MongoDB Data (Nodes, Obstacles, Pathways, Elevators)
 * - Bottom-left Floating Action Button (FAB) (>=48dp touch target)
 * - Interactive Drawer for Wheelchair Accessibility, Slope & Route Filters
 * - Clean top navbar with static banner removed
 * - Global High-Contrast WCAG 2.1 compliance
 */
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

  const { palette, borderWidth, isHighContrast, isReduceMotionEnabled, isAudioLauncherEnabled } = useTheme();
  const { speak } = useSpeech();
  const { location, loading: locationLoading, recenter } = useLocation();

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
          console.warn('[UnityMapScreen] Health check failed:', e.message);
          if (isMounted) setIsBackendConnected(false);
        }

        // Fetch all 4 collections in parallel
        const [nodesRes, obstaclesRes, pathwaysRes, elevatorsRes] = await Promise.all([
          getNodes().catch((err) => {
            console.error('[UnityMapScreen] Nodes fetch error:', err.message);
            return { data: [] };
          }),
          getObstacles(true).catch((err) => {
            console.error('[UnityMapScreen] Obstacles fetch error:', err.message);
            return { data: [] };
          }),
          getPathways().catch((err) => {
            console.error('[UnityMapScreen] Pathways fetch error:', err.message);
            return { data: [] };
          }),
          getElevatorOverview().catch((err) => {
            console.error('[UnityMapScreen] Elevators fetch error:', err.message);
            return { data: [] };
          }),
        ]);

        if (!isMounted) return;

        console.log('[UnityMapScreen] Live Database Fetch Completed:', {
          nodes: nodesRes?.data?.length || 0,
          obstacles: obstaclesRes?.data?.length || 0,
          pathways: pathwaysRes?.data?.length || 0,
          elevators: elevatorsRes?.data?.length || 0,
        });

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
        console.error('[UnityMapScreen] Critical load error:', err);
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
    setIsWheelchairAccessible((prev) => {
      const next = !prev;
      saveWheelchairAccessible(next);
      return next;
    });
  }, []);

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
  const handleMapTap = useCallback(async (loc) => {
    if (!Number.isFinite(Number(loc?.latitude)) || !Number.isFinite(Number(loc?.longitude))) {
      return;
    }

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
        getNearestNode(destination.longitude, destination.latitude, 500).catch(() => null),
      ]);

      let polyCoords = [];
      let totalMeters = directMeters;
      let maxRouteSlope = 0;
      let routePathways = [];
      const destName = destNode?.name || 'Selected Location';

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
      console.warn('[UnityMapScreen] Tap route error:', err.message);
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
          destName: 'Selected Destination',
        });
      }

      const status = computeRouteSafetyStatus([], [], []);

      setTapRouteMeta({
        distanceText: formatDistance(directMeters),
        etaText: formatDuration(etaMins),
        destName: 'Selected Destination',
        safetyStatus: status,
      });
      setIsTapSummarySheetVisible(true);
    } finally {
      setTapRouteLoading(false);
    }
  }, [currentLocation, location, mapCenter, dbNodes, dbPathways, dbObstacles, dbElevators, isWheelchairAccessible]);

  const handleClearTap = useCallback(() => {
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
      maxSlope: '4.8° (Safe)',
    };

    setActiveNavRoute(navRoute);
    setIsTurnByTurnActive(true);
  }, [tapRouteMeta, tapRoute, tappedLocation, location]);

  // Select destination from real DB list / search history — also starts live navigation on current BaseMap
  const handleSelectDestination = useCallback(
    async (dest) => {
      setSearchQuery(dest.title);
      if (dest.lat && dest.lng) {
        setMapCenter([dest.lat, dest.lng]);
        // Reuse current map pipeline to draw route and show summary
        try {
          await handleMapTap({ latitude: dest.lat, longitude: dest.lng });
        } catch (_) {}
      }
      // Move selected to top of recent list and save
      setRecentDestinations((prev) => {
        const filtered = prev.filter((d) => d.id !== dest.id);
        const updated = [dest, ...filtered];
        saveRecentSearches(updated);
        return updated;
      });
    },
    [handleMapTap]
  );

  // Typed search fallback: Enter with no exact match → top-score fuzzy handleMapTap
  const handleSearchSubmit = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q) return;
    const all = [...dbNodes, ...recentDestinations];
    let best = null;
    let bestScore = -1;
    const lowerQ = q.toLowerCase();
    for (const dest of all) {
      const titleLower = dest.title.toLowerCase();
      let score = 0;
      if (titleLower === lowerQ) score = 3;
      else if (titleLower.includes(lowerQ) || lowerQ.includes(titleLower)) score = 2;
      else if (titleLower.split(' ').some((w) => lowerQ.includes(w) || w.includes(lowerQ))) score = 1;
      if (score > bestScore) {
        bestScore = score;
        best = dest;
      }
    }
    if (best && bestScore >= 1) {
      await handleSelectDestination(best);
    }
  }, [searchQuery, dbNodes, recentDestinations, handleSelectDestination]);

  // SPT-106: bridge spoken transcript to Voice Input & Summary Readout Screen — summary first via getRoute includeSpeech, draw on Confirm
  const handleLauncherNavigate = useCallback(
    async (transcript, confidence) => {
      setShowLauncher(false);
      const q = typeof transcript === 'string' ? transcript.trim() : '';
      if (!q) return;
      setVoiceTranscript(q);
      setVoiceConfidence(confidence || 0);
      setSearchQuery(q);
      setIsSearchExpanded(true);

      const all = [...dbNodes, ...recentDestinations];
      let best = null;
      let bestScore = -1;
      const lowerQ = q.toLowerCase();
      for (const dest of all) {
        const titleLower = dest.title.toLowerCase();
        let score = 0;
        if (titleLower === lowerQ) score = 3;
        else if (titleLower.includes(lowerQ) || lowerQ.includes(titleLower)) score = 2;
        else if (titleLower.split(' ').some((w) => lowerQ.includes(w) || w.includes(lowerQ))) score = 1;
        if (score > bestScore) {
          bestScore = score;
          best = dest;
        }
      }

      // Fetch real route preview for summary (reuse current BaseMap pipeline, no draw yet)
      let summary = {
        destName: best?.title || q,
        distanceText: '--',
        crossings: 0,
        etaText: '--',
        hazardCount: nearbyHazards?.length ?? 0,
        spokenSummary: `Route to ${best?.title || q}: calculating...`,
        confidence,
        pendingBest: best,
      };

      if (best?.lat && best?.lng) {
        try {
          const origin = currentLocation || (location?.latitude && location?.longitude ? location : null) || (dbNodes[0]?.lat ? { latitude: dbNodes[0].lat, longitude: dbNodes[0].lng } : { latitude: mapCenter[0], longitude: mapCenter[1] });
          const originNode = await getNearestNode(origin.longitude, origin.latitude, 500).catch(() => null);
          const destNode = await getNearestNode(best.lng, best.lat, 500).catch(() => null);
          if (originNode && destNode) {
            const routeRes = await getRoute(originNode._id || originNode.id, destNode._id || destNode.id, isWheelchairAccessible, { includeSpeech: true, locale: 'en' });
            if (routeRes?.success) {
              const d = routeRes.data;
              summary = {
                destName: d.destinationNode?.name || best.title,
                distanceText: d.totalDistanceMeters ? formatDistance(d.totalDistanceMeters) : '--',
                crossings: d.crossings ?? 0,
                etaText: d.estimatedDurationSec ? formatDuration(Math.ceil(d.estimatedDurationSec / 60)) : '--',
                hazardCount: d.hazardCount ?? nearbyHazards?.length ?? 0,
                spokenSummary: d.spokenSummary || `Route to ${d.destinationNode?.name || best.title}: ${d.totalDistanceMeters ? formatDistance(d.totalDistanceMeters) : '--'}, ${d.crossings ?? 0} crossings.`,
                confidence,
                pendingOrigin: origin,
                pendingDest: best,
                pendingRouteRes: d,
              };
            }
          }
        } catch (_) {}
      }

      // Fallback if no backend route yet
      if (!summary.spokenSummary || summary.spokenSummary.includes('calculating')) {
        const distanceText = tapRouteMeta?.distanceText || 'Calculating...';
        const etaText = tapRouteMeta?.etaText || '--';
        const crossings = tapRouteMeta ? 0 : bestScore >= 0 ? bestScore : 0;
        summary = {
          destName: best?.title || q,
          distanceText,
          crossings,
          etaText,
          hazardCount: nearbyHazards?.length ?? 0,
          spokenSummary: `Route to ${best?.title || q}: ${distanceText}, ${crossings} crossings, ${etaText}, ${nearbyHazards?.length ?? 0} hazards.`,
          confidence,
          pendingBest: best,
        };
      }

      setVoiceRouteSummary(summary);
      setShowVoiceSummary(true);
      try {
        speak(summary.spokenSummary);
      } catch (_) {}
    },
    [dbNodes, recentDestinations, tapRouteMeta, nearbyHazards, currentLocation, location, mapCenter, isWheelchairAccessible, speak]
  );

  const handleVoiceConfirm = useCallback(
    async ({ transcript, routeSummary, targetCoordinates }) => {
      const q = transcript || voiceTranscript;
      setShowVoiceSummary(false);
      if (!q) return;
      const all = [...dbNodes, ...recentDestinations];
      const lowerQ = q.toLowerCase();
      let best = null;
      let bestScore = -1;
      for (const dest of all) {
        const titleLower = dest.title.toLowerCase();
        let score = 0;
        if (titleLower === lowerQ) score = 3;
        else if (titleLower.includes(lowerQ) || lowerQ.includes(titleLower)) score = 2;
        else if (titleLower.split(' ').some((w) => lowerQ.includes(w) || w.includes(lowerQ))) score = 1;
        if (score > bestScore) {
          bestScore = score;
          best = dest;
        }
      }
      if (best?.lat && best?.lng) {
        try {
          speak(`Confirmed. Navigating to ${best.title}`);
        } catch (_) {}
        // Reuse current BaseMap pipeline — draws polyline via tapRoute (SPT-57)
        await handleMapTap({ latitude: best.lat, longitude: best.lng });
        handleSelectDestination(best);
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
            maxSlope: '4.8° (Safe)',
          });
          setIsTurnByTurnActive(true);
        }
      } else if (best) {
        handleSelectDestination(best);
        try {
          speak(`Confirmed. Navigating to ${best.title}`);
        } catch (_) {}
      } else if (targetCoordinates) {
        // Fallback to develop synthetic targetCoordinates when no fuzzy best
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
            maxSlope: '4.8° (Safe)',
          });
          setIsTurnByTurnActive(true);
        }
      }
    },
    [voiceTranscript, dbNodes, recentDestinations, handleSelectDestination, handleMapTap, speak, location, tapRoute]
  );

  const handleVoiceCancel = useCallback(() => {
    setShowVoiceSummary(false);
  }, []);

  // Combined and filtered destinations (DB nodes + real recent searches)
  const filteredDestinations = useMemo(() => {
    const all = [...dbNodes, ...recentDestinations.filter((r) => !dbNodes.some((d) => d.title === r.title))];
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

            {/* Tap Route: Distance, ETA & Safety Status Header Card */}
            {tapRouteMeta && !tapRouteLoading && (
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
                    checkHealth().then((h) => setIsBackendConnected(h?.status === 'ok'));
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
                          {searchQuery
                            ? `No destinations match "${searchQuery}"`
                            : 'Search above or select accessible locations'}
                        </Text>
                      </View>
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
        <AudioFirstLauncherScreen onNavigate={handleLauncherNavigate} />
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
