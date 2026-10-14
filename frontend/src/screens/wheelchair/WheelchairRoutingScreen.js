import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  Alert,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { MaterialIcons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import * as Location from 'expo-location';
import tw from 'twrnc';
import BaseMap from '../../components/BaseMap';
import RouteSelectionCard from '../../components/RouteSelectionCard';
import LiveTurnByTurnNavigationScreen from './LiveTurnByTurnNavigationScreen';
import { useTheme } from '../../theme/ThemeContext';
import { radius, spacing } from '../../theme/tokens';
import { accessibilityService } from '../../services/accessibilityService';

/**
 * WheelchairRoutingScreen.js
 * Jira: SPT-103 — "Route Selection & Gradient Summary View (Wheelchair - Page 2)"
 *
 * Features:
 * - Dynamic split-view: Interactive BaseMap on top with route polylines
 * - Alternative calculated routes (Option A, Option B, Option C)
 * - Wheelchair-paced ETA calculation (~1.1 m/s with slope penalty)
 * - Gradient safety tags ("Max Slope: 5° - Safe", "Max Slope: 8° - Caution")
 * - Real-time Elevator / Lift operational status badges
 * - Tapping alternative route cards highlights and fits the route on BaseMap
 * - WCAG 2.1 AAA high-contrast support and >=48dp touch targets
 */
export const WheelchairRoutingScreen = () => {
  const { palette, isHighContrast, borderWidth } = useTheme();

  const [routes, setRoutes] = useState([]);
  const [selectedRouteId, setSelectedRouteId] = useState('route_option_a');
  const [elevators, setElevators] = useState([]);
  const [loading, setLoading] = useState(true);
  const [originName, setOriginName] = useState('');
  const [destinationName, setDestinationName] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isNavigating, setIsNavigating] = useState(false);
  // Map interaction state
  const [userLocation, setUserLocation] = useState(null);   // user's real GPS
  const [tappedLocation, setTappedLocation] = useState(null); // where user tapped on map

  // ── Get real device GPS via expo-location ─────────────────────────────
  useEffect(() => {
    let locationSubscription = null;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        // Get a quick one-shot position first
        const initial = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        setUserLocation({
          latitude: initial.coords.latitude,
          longitude: initial.coords.longitude,
        });
        // Then watch for updates
        locationSubscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, distanceInterval: 5 },
          (pos) => {
            setUserLocation({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
            });
          }
        );
      } catch (e) {
        // Location unavailable — distance will show route fallback value
      }
    })();
    return () => {
      if (locationSubscription) locationSubscription.remove();
    };
  }, []);

  // Fetch routes and elevator statuses
  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      try {
        setLoading(true);
        setErrorMessage('');
        const nodesResponse = await accessibilityService.getNodes();
        const nodes = Array.isArray(nodesResponse?.data) ? nodesResponse.data : [];
        if (nodes.length < 2) {
          throw new Error('At least two map nodes are required to calculate a route.');
        }

        const originNode = nodes[0];
        const destinationNode = nodes[nodes.length - 1];
        const [routeList, elevatorList] = await Promise.all([
          accessibilityService.getWheelchairRouteOptions(originNode._id, destinationNode._id),
          accessibilityService.fetchElevatorStatuses(),
        ]);

        if (isMounted) {
          setRoutes(routeList);
          setElevators(elevatorList);
          setOriginName(originNode.name);
          setDestinationName(destinationNode.name);
          if (routeList.length > 0) {
            setSelectedRouteId(routeList[0].id);
          }
        }
      } catch (err) {
        if (isMounted) setErrorMessage(err.message || 'Unable to load map route data.');
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadData();
    return () => {
      isMounted = false;
    };
  }, []);

  // Currently active selected route
  const activeRoute = useMemo(() => {
    return routes.find((r) => r.id === selectedRouteId) || routes[0];
  }, [routes, selectedRouteId]);

  // Map markers: Start point, Destination point, and Elevators
  const mapMarkers = useMemo(() => {
    const activeCoordinates = activeRoute?.coordinates || [];
    const originCoordinates = activeCoordinates[0];
    const destinationCoordinates = activeCoordinates[activeCoordinates.length - 1];
    const markers = [
      {
        id: 'origin_pin',
        title: originName,
        desc: 'Wheelchair accessible entrance',
        tag: 'START',
        type: 'green',
        lat: originCoordinates?.[0],
        lng: originCoordinates?.[1],
      },
      {
        id: 'destination_pin',
        title: destinationName,
        desc: 'Step-free accessible destination',
        tag: 'DEST',
        type: 'destination',
        lat: destinationCoordinates?.[0],
        lng: destinationCoordinates?.[1],
      },
    ];

    // Add elevator markers if available
    elevators.forEach((elev) => {
      markers.push({
        id: `elev_${elev.id}`,
        title: elev.name,
        desc: elev.label,
        tag: elev.isOperational ? 'LIFT OK' : 'LIFT OUT',
        type: elev.isOperational ? 'green' : 'red',
        lat: elev.lat,
        lng: elev.lng,
      });
    });

    return markers;
  }, [activeRoute, originName, destinationName, elevators]);

  // Handle route card / map polyline click
  const handleSelectRouteOption = useCallback((routeId) => {
    setSelectedRouteId(routeId);
  }, []);

  // Handle primary "Select Route" button press
  const handleStartNavigation = useCallback(
    (route) => {
      if (route?.id) {
        setSelectedRouteId(route.id);
      }
      setIsNavigating(true);
    },
    []
  );

  // If user launched Live Navigation, render Page 3
  if (isNavigating && activeRoute) {
    return (
      <LiveTurnByTurnNavigationScreen
        route={activeRoute}
        originName={originName || 'Main Entrance North'}
        destinationName={destinationName || 'Science Block Level 2'}
        elevators={elevators}
        onExitNavigation={() => setIsNavigating(false)}
      />
    );
  }

  return (
    <SafeAreaView
      style={[
        styles.safeArea,
        { backgroundColor: isHighContrast ? '#000000' : '#121212' },
      ]}
    >
      {/* ── Top Header Bar ────────────────────────────────────────────── */}
      <View
        style={[
          styles.headerBar,
          {
            backgroundColor: isHighContrast ? '#000000' : '#1E1E1E',
            borderBottomColor: isHighContrast ? '#FFFFFF' : '#2A2A2A',
            borderBottomWidth: isHighContrast ? 2 : 1,
          },
        ]}
      >
        <View style={styles.headerTitleRow}>
          <View style={styles.iconCircle}>
            <MaterialCommunityIcons
              name="wheelchair-accessibility"
              size={22}
              color={isHighContrast ? '#FFFFFF' : '#4ADE80'}
            />
          </View>
          <View style={styles.headerTextGroup}>
            <Text style={[styles.headerSubTitle, isHighContrast && { color: '#FFFFFF' }]}>
              WHEELCHAIR ROUTING • PAGE 2
            </Text>
            <Text style={[styles.headerTitle, isHighContrast && { color: '#FFFFFF' }]}>
              Route Selection & Gradient Summary
            </Text>
          </View>
        </View>

        {/* Origin / Destination Chip */}
        <View
          style={[
            styles.routeEndpointsChip,
            {
              backgroundColor: isHighContrast ? '#000000' : '#262626',
              borderColor: isHighContrast ? '#FFFFFF' : '#333333',
            },
          ]}
        >
          <View style={styles.endpointItem}>
            <View style={[styles.dotStart, isHighContrast && { backgroundColor: '#FFFFFF' }]} />
            <Text
              style={[styles.endpointText, isHighContrast && { color: '#FFFFFF' }]}
              numberOfLines={1}
            >
              {originName}
            </Text>
          </View>
          <MaterialIcons name="arrow-forward" size={14} color={isHighContrast ? '#FFFFFF' : '#9E9E9E'} />
          <View style={styles.endpointItem}>
            <View style={[styles.dotEnd, isHighContrast && { backgroundColor: '#FFFFFF' }]} />
            <Text
              style={[styles.endpointText, isHighContrast && { color: '#FFFFFF' }]}
              numberOfLines={1}
            >
              {destinationName}
            </Text>
          </View>
        </View>
      </View>

      {/* ── Top Half: Interactive BaseMap with Route Polylines ─────────── */}
      <View style={styles.mapContainer}>
        <BaseMap
          center={activeRoute?.coordinates?.[0]}
          zoom={16}
          markers={mapMarkers}
          routes={routes}
          activeRouteId={selectedRouteId}
          onRouteClick={handleSelectRouteOption}
          onMapClick={loc => setTappedLocation(loc)}
          onLocationFound={loc => setUserLocation(loc)}
          isHighContrast={isHighContrast}
          style={styles.map}
        />

        {/* Floating Map Overlay Badge: Active Incline & Step-Free summary */}
        {activeRoute && (
          <View
            style={[
              styles.mapFloatingBadge,
              isHighContrast && styles.mapFloatingBadgeHighContrast,
            ]}
          >
            <MaterialIcons
              name="check-circle"
              size={15}
              color={isHighContrast ? '#000000' : '#4ADE80'}
            />
            <Text
              style={[
                styles.mapFloatingBadgeText,
                isHighContrast && { color: '#000000' },
              ]}
            >
              Active: {activeRoute.code} • {activeRoute.distanceText} • {activeRoute.maxSlope} slope
            </Text>
          </View>
        )}
      </View>

      {/* ── Bottom Half: Calculated Route Selection Cards ──────────────── */}
      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Section Heading with Elevator Status Summary */}
        <View style={styles.sectionHeader}>
          <View>
            <Text style={[styles.sectionTitle, isHighContrast && { color: '#FFFFFF' }]}>
              Available Routes ({routes.length})
            </Text>
            <Text style={[styles.sectionSub, isHighContrast && { color: '#FFFFFF' }]}>
              Paced at wheelchair speed (1.1 m/s) • Tap a card to preview on map
            </Text>
          </View>

          <View style={[styles.liveBadge, isHighContrast && { backgroundColor: '#000000', borderColor: '#FFFFFF', borderWidth: 2 }]}>
            <View style={[styles.livePulse, isHighContrast && { backgroundColor: '#FFFFFF' }]} />
            <Text style={[styles.liveText, isHighContrast && { color: '#FFFFFF' }]}>Real-Time Lifts</Text>
          </View>
        </View>

        {/* Loading Indicator */}
        {loading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={isHighContrast ? '#FFFFFF' : '#2E8B57'} />
            <Text style={[styles.loadingText, isHighContrast && { color: '#FFFFFF' }]}>Calculating step-free routes & slopes...</Text>
          </View>
        )}

        {!loading && errorMessage ? (
          <View style={[tw`mt-2 rounded-xl border border-red-700 bg-red-950 p-4`, isHighContrast && { backgroundColor: '#FFFFFF', borderColor: '#A84800', borderWidth: 2 }]}>
            <Text style={[tw`mb-1 text-sm font-bold text-red-300`, isHighContrast && { color: '#A84800' }]}>
              Route data unavailable
            </Text>
            <Text style={[tw`text-xs leading-5 text-red-200`, isHighContrast && { color: '#A84800' }]}>{errorMessage}</Text>
          </View>
        ) : null}

        {/* Route Cards */}
        {!loading &&
          !errorMessage &&
          routes.map((route) => {
            const isSelected = route.id === selectedRouteId;
            // Derive route start coordinate as fallback origin for distance calc
            const firstCoord = route.coordinates?.[0];
            const routeOrigin = firstCoord
              ? { latitude: firstCoord[0], longitude: firstCoord[1] }
              : null;
            // Only obstacle-type markers (for nearby filtering)
            const obstacleMarkers = mapMarkers
              .filter(m => m.type === 'obstacle' || m.type === 'construction' || m.type === 'stairs_only')
              .map(m => ({ id: m.id, latitude: m.lat, longitude: m.lng, type: m.type, title: m.title }));
            return (
              <RouteSelectionCard
                key={route.id}
                title={route.title}
                routeCode={route.code}
                distance={route.distanceText}
                eta={route.etaText}
                maxSlope={route.maxSlope}
                slopeStatus={route.slopeStatus}
                slopeLevel={route.slopeCategory?.level || 'safe'}
                liftStatus={route.liftStatus}
                isLiftOperational={
                  !String(route.liftStatus || '').toLowerCase().includes('out of service')
                }
                verificationStatus={route.verificationStatus}
                isSelected={isSelected}
                onCardPress={() => handleSelectRouteOption(route.id)}
                onSelectRoute={() => handleStartNavigation(route)}
                style={styles.routeCardItem}
                startLocation={userLocation}
                routeOrigin={routeOrigin}
                tappedLocation={tappedLocation}
                obstacles={obstacleMarkers}
              />
            );
          })}

        {/* Accessibility Note Footer */}
        <View
          style={[
            styles.footerNoteBox,
            isHighContrast && {
              backgroundColor: '#000000',
              borderColor: '#FFFFFF',
              borderWidth: 1,
            },
          ]}
        >
          <Feather
            name="info"
            size={16}
            color={isHighContrast ? '#FFFFFF' : '#9CA3AF'}
            style={{ marginRight: 8, marginTop: 2 }}
          />
          <Text style={[styles.footerNoteText, isHighContrast && { color: '#FFFFFF' }]}>
            Max slope calculations strictly follow ADA §405 standards. Incline warnings trigger
            for ramps exceeding 5.0° (1:12 standard). Out-of-service elevators are automatically
            diverted.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#121212',
  },
  headerBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    backgroundColor: '#1E1E1E',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#143823',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#2E8B57',
  },
  headerTextGroup: {
    flex: 1,
  },
  headerSubTitle: {
    fontSize: 10,
    fontWeight: '700',
    color: '#9CA3AF',
    letterSpacing: 0.8,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  routeEndpointsChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#262626',
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#333333',
  },
  endpointItem: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    maxWidth: '45%',
  },
  dotStart: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22C55E',
    marginRight: 6,
  },
  dotEnd: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
    marginRight: 6,
  },
  endpointText: {
    color: '#E0E0E0',
    fontSize: 12,
    fontWeight: '500',
  },
  /* Map Container */
  mapContainer: {
    height: 250,
    width: '100%',
    position: 'relative',
    backgroundColor: '#1E1E1E',
  },
  map: {
    width: '100%',
    height: '100%',
  },
  mapFloatingBadge: {
    position: 'absolute',
    top: 12,
    left: 14,
    right: 14,
    backgroundColor: 'rgba(20, 32, 24, 0.92)',
    borderColor: '#2E8B57',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  mapFloatingBadgeHighContrast: {
    backgroundColor: '#FFFFFF',
    borderColor: '#000000',
    borderWidth: 2,
  },
  mapFloatingBadgeText: {
    color: '#E8F5E9',
    fontSize: 12,
    fontWeight: '600',
  },
  /* Scroll Area */
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  sectionSub: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 2,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#172E20',
    borderColor: '#22C55E',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 8,
    gap: 5,
  },
  livePulse: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#22C55E',
  },
  liveText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#86EFAC',
  },
  loadingContainer: {
    paddingVertical: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#9CA3AF',
    fontSize: 13,
    marginTop: 10,
  },
  routeCardItem: {
    marginBottom: 14,
  },
  footerNoteBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#1A1A1A',
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  footerNoteText: {
    flex: 1,
    color: '#9CA3AF',
    fontSize: 11,
    lineHeight: 16,
  },
});

export default WheelchairRoutingScreen;
