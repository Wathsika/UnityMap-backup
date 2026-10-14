import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import tw from 'twrnc';
import { useTheme } from '../theme/ThemeContext';
import { calculateHaversineDistance, formatDistance } from '../utils/mapMath';

/**
 * RouteSelectionCard
 * Jira: SPT-103 — Route Selection & Gradient Summary View (Wheelchair - Page 2)
 *
 * Props:
 *   title          {string}  Route name (from DB/API)
 *   routeCode      {string}  Short code label (e.g. "Route A")
 *   distance       {string}  Fallback distance string when map tap unavailable
 *   eta            {string}  Estimated travel time
 *   maxSlope       {string}  Slope degrees string (e.g. "5°")
 *   slopeStatus    {string}  "Safe" | "Caution" | "Hazard"
 *   slopeLevel     {string}  "safe" | "caution" | "hazard"
 *   gradientTag    {string?} Custom gradient label override
 *   liftStatus     {string?} Single lift status string
 *   liftBadges     {Array?}  Array of {text, isOperational} lift badge objects
 *   isLiftOperational {boolean}
 *   verificationStatus {string}
 *   isSelected     {boolean}
 *   onSelectRoute  {function}
 *   onCardPress    {function}
 *   style          {object?} Extra container style
 *
 *   --- Map interaction props ---
 *   startLocation  {{ latitude, longitude }} User's GPS location
 *   tappedLocation {{ latitude, longitude }} Where user tapped on map
 *   obstacles      {Array}   [{ id, latitude, longitude, type, title }]
 *                            Only obstacles within 50 m of tappedLocation are shown.
 */
export const RouteSelectionCard = ({
  title,
  routeCode,
  distance,        // string fallback (e.g. from route data)
  eta,
  maxSlope,
  slopeStatus,
  gradientTag,
  slopeLevel = 'safe',   // 'safe' | 'caution' | 'hazard'
  liftStatus,
  liftBadges,
  isLiftOperational = true,
  verificationStatus,
  isSelected = false,
  onSelectRoute,
  onCardPress,
  style,
  // Map interaction
  startLocation,         // { latitude, longitude } user's GPS (from expo-location)
  tappedLocation,        // { latitude, longitude } — set only when user taps map
  routeOrigin,           // { latitude, longitude } fallback if GPS unavailable
  obstacles = [],        // Full obstacle list; filtered to nearby ones in here
}) => {
  const { isHighContrast, palette } = useTheme();

  // Real distance computed from user location → tapped point (like Google Maps)
  const [computedDistance, setComputedDistance] = useState(null);

  // Only show obstacles that are ≤ 50 m from the tapped location.
  // When no tap has occurred, nearbyObstacles stays empty → nothing is rendered.
  const [nearbyObstacles, setNearbyObstacles] = useState([]);

  // Recompute distance whenever the user taps a new location on the map.
  // Uses expo-location GPS (startLocation) as origin if available,
  // otherwise falls back to routeOrigin (first coord of the route).
  useEffect(() => {
    if (!tappedLocation) {
      setComputedDistance(null);
      return;
    }
    const origin = startLocation ?? routeOrigin;
    if (origin) {
      const meters = calculateHaversineDistance(
        origin.latitude,
        origin.longitude,
        tappedLocation.latitude,
        tappedLocation.longitude
      );
      setComputedDistance(formatDistance(meters));
    }
  }, [startLocation, tappedLocation, routeOrigin]);

  // Filter obstacles to only those within 50 m of the tapped location.
  // Resets to [] when tappedLocation is cleared.
  useEffect(() => {
    if (tappedLocation && obstacles.length > 0) {
      const nearby = obstacles.filter((o) => {
        if (o.latitude == null || o.longitude == null) return false;
        return (
          calculateHaversineDistance(
            tappedLocation.latitude,
            tappedLocation.longitude,
            o.latitude,
            o.longitude
          ) <= 50
        );
      });
      setNearbyObstacles(nearby);
    } else {
      // No tap → show nothing
      setNearbyObstacles([]);
    }
  }, [tappedLocation, obstacles]);

  // Distance to display: prefer the live-calculated value, fall back to the prop
  const displayDistance = computedDistance ?? distance ?? null;

  // ── Slope colour theme ───────────────────────────────────────────────────
  const getSlopeColors = () => {
    const s = (slopeStatus || '').toLowerCase();
    if (isHighContrast) {
      // CVD-safe semantic accents on white (vermillion / amber / bluish-green)
      if (slopeLevel === 'hazard' || s.includes('hazard')) {
        return { bg: palette.errorBg, border: palette.error, text: palette.error, icon: palette.error, bw: 2 };
      }
      if (slopeLevel === 'caution' || s.includes('caution')) {
        return { bg: palette.warningBg, border: palette.warning, text: palette.warning, icon: palette.warning, bw: 2 };
      }
      return { bg: palette.successBg, border: palette.success, text: palette.success, icon: palette.success, bw: 2 };
    }
    if (slopeLevel === 'caution' || s.includes('caution')) {
      return { bg: '#36240E', border: '#B45309', text: '#FDE68A', icon: '#F59E0B', bw: 1 };
    }
    if (slopeLevel === 'hazard' || s.includes('hazard')) {
      return { bg: '#3F1717', border: '#DC2626', text: '#FECACA', icon: '#EF4444', bw: 1 };
    }
    // safe (default)
    return { bg: '#143823', border: '#2E8B57', text: '#E8F5E9', icon: '#4ADE80', bw: 1 };
  };
  const slope = getSlopeColors();

  // ── Lift badge colour theme ──────────────────────────────────────────────
  const getLiftColors = (operational) => {
    if (isHighContrast) {
      return operational
        ? { bg: palette.successBg, border: palette.success, text: palette.success, icon: palette.success }
        : { bg: palette.errorBg, border: palette.error, text: palette.error, icon: palette.error };
    }
    if (!operational) {
      return { bg: '#361E1E', border: '#991B1B', text: '#FCA5A5', icon: '#EF4444' };
    }
    return { bg: '#172E20', border: '#1E5631', text: '#86EFAC', icon: '#22C55E' };
  };

  // ── Card container shadow (platform-specific) ───────────────────────────
  const shadowStyle = Platform.select({
    ios:  { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
    android: { elevation: 5 },
    default: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
  });

  return (
    <TouchableOpacity
      activeOpacity={onCardPress ? 0.9 : 1}
      onPress={onCardPress}
      accessible
      accessibilityRole="button"
      accessibilityLabel={[
        routeCode, title,
        displayDistance ? `Distance ${displayDistance}` : null,
        eta ? `ETA ${eta}` : null,
        maxSlope ? `Max slope ${maxSlope}` : null,
        slopeStatus,
        liftStatus,
        verificationStatus,
        isSelected ? 'Selected route' : null,
      ].filter(Boolean).join('. ')}
      accessibilityState={{ selected: isSelected }}
      style={[
        tw`rounded-2xl p-4 my-2 border`,
        {
          backgroundColor: isHighContrast ? '#000000' : isSelected ? '#1F2420' : '#1E1E1E',
          borderColor: isHighContrast ? '#FFFFFF' : isSelected ? '#2E8B57' : '#2D2D2D',
          borderWidth: isHighContrast ? 2 : isSelected ? 2 : 1.5,
          ...shadowStyle,
        },
        style,
      ]}
    >
      {/* ── 1. Route Header ─────────────────────────────────────────── */}
      <View style={tw`mb-3`}>
        {/* Route code badge + active indicator */}
        <View style={tw`flex-row justify-between items-center mb-1`}>
          {routeCode ? (
            <View
              style={[
                tw`self-start px-2 py-0.5 rounded`,
                {
                  backgroundColor: isHighContrast ? palette.surface : isSelected ? '#143823' : '#2A2A2A',
                  borderColor: isHighContrast ? palette.success : isSelected ? '#2E8B57' : 'transparent',
                  borderWidth: isHighContrast ? 2 : isSelected ? 1 : 0,
                },
              ]}
            >
              <Text style={[tw`text-gray-400 text-xs font-bold tracking-wide uppercase`, isHighContrast && { color: palette.success }]}>
                {routeCode}
              </Text>
            </View>
          ) : null}

          {isSelected && (
            <View style={[tw`flex-row items-center gap-1 bg-green-950 px-2 py-0.5 rounded`, isHighContrast && { backgroundColor: palette.successBg, borderWidth: 2, borderColor: palette.success }]}>
              <MaterialIcons name="check-circle" size={16} color={isHighContrast ? palette.success : '#2E8B57'} />
              <Text style={[tw`text-green-400 text-xs font-bold`, isHighContrast && { color: palette.success }]}>Active</Text>
            </View>
          )}
        </View>

        {/* Route title */}
        {title ? (
          <Text
            style={[tw`text-lg font-bold`, { color: isHighContrast ? '#FFFFFF' : '#FFFFFF', letterSpacing: -0.3 }]}
          >
            {title}
          </Text>
        ) : null}

        {/* Distance • ETA */}
        <View style={tw`flex-row items-center mt-1 gap-1 flex-wrap`}>
          {/* Distance: show computed, fallback route value, or tap-hint */}
          <View style={tw`flex-row items-center gap-1`}>
            <MaterialIcons name="straighten" size={14} color={isHighContrast ? '#FFF' : '#9E9E9E'} />
            {computedDistance ? (
              <Text style={[tw`text-sm font-semibold`, { color: isHighContrast ? '#FFF' : '#4ADE80' }]}>
                {computedDistance}
              </Text>
            ) : tappedLocation ? (
              // Tapped but no origin yet
              <Text style={[tw`text-xs`, { color: '#9E9E9E' }]}>Calculating…</Text>
            ) : (
              // No tap yet: show fallback distance or hint
              distance ? (
                <Text style={[tw`text-sm font-semibold`, { color: isHighContrast ? '#FFF' : '#E0E0E0' }]}>
                  {distance}
                </Text>
              ) : (
                <Text style={[tw`text-xs italic`, { color: '#6B7280' }]}>Tap map to measure</Text>
              )
            )}
          </View>

          {eta ? <Text style={tw`text-gray-500 mx-1 text-sm`}>•</Text> : null}

          {eta ? (
            <View style={tw`flex-row items-center gap-1`}>
              <MaterialIcons name="schedule" size={14} color={isHighContrast ? '#FFF' : '#9E9E9E'} />
              <Text style={[tw`text-sm font-semibold`, { color: isHighContrast ? '#FFF' : '#E0E0E0' }]}>
                {eta}
              </Text>
            </View>
          ) : null}
        </View>
      </View>


      {/* ── 2. Gradient Safety Badge ─────────────────────────────────── */}
      {(maxSlope || slopeStatus || gradientTag) ? (
        <View
          style={[
            tw`flex-row items-center rounded-full px-3 py-2 mb-3`,
            { backgroundColor: slope.bg, borderColor: slope.border, borderWidth: slope.bw },
          ]}
        >
          <MaterialCommunityIcons name="wheelchair-accessibility" size={17} color={slope.icon} style={tw`mr-2`} />
          <Text style={[tw`text-xs font-semibold flex-1`, { color: slope.text }]}>
            {gradientTag
              ? gradientTag
              : `Max Slope: ${maxSlope ?? '—'} – ${slopeStatus ?? ''}`}
          </Text>
          <MaterialIcons name="verified" size={15} color={slope.icon} style={tw`ml-1`} />
        </View>
      ) : null}

      {/* ── 3. Lift / Elevator Badges ────────────────────────────────── */}
      <View style={tw`gap-2 mb-3`}>
        {/* Array of lift badges */}
        {Array.isArray(liftBadges) && liftBadges.length > 0
          ? liftBadges.map((badge, idx) => {
              const text = typeof badge === 'string' ? badge : badge.text ?? badge.label ?? '';
              const isOp =
                typeof badge === 'object' && badge.isOperational !== undefined
                  ? badge.isOperational
                  : !text.toLowerCase().includes('out of service');
              const lc = getLiftColors(isOp);
              return (
                <View
                  key={idx}
                  style={[
                    tw`flex-row items-center rounded-xl px-3 py-2 gap-2`,
                    { backgroundColor: lc.bg, borderColor: lc.border, borderWidth: isHighContrast ? 2 : 1 },
                  ]}
                >
                  <MaterialIcons name="elevator" size={16} color={lc.icon} />
                  <Text style={[tw`text-xs font-semibold`, { color: lc.text }]}>{text}</Text>
                </View>
              );
            })
          : liftStatus
          ? (() => {
              const lc = getLiftColors(isLiftOperational);
              return (
                <View
                  style={[
                    tw`flex-row items-center rounded-xl px-3 py-2 gap-2`,
                    { backgroundColor: lc.bg, borderColor: lc.border, borderWidth: isHighContrast ? 2 : 1 },
                  ]}
                >
                  <MaterialIcons name="elevator" size={16} color={lc.icon} />
                  <Text style={[tw`text-xs font-semibold`, { color: lc.text }]}>{liftStatus}</Text>
                </View>
              );
            })()
          : null}

        {/* ── Nearby Obstacle Badges (ONLY when tappedLocation is set AND obstacles found) */}
        {nearbyObstacles.length > 0 && (
          <View style={tw`mt-1`}>
            <Text style={[tw`text-red-400 text-xs font-bold mb-1 uppercase tracking-wide`, isHighContrast && { color: palette.error }]}>
              ⚠ Obstacles near tapped location
            </Text>
            {nearbyObstacles.map((obs) => (
              <View
                key={obs.id ?? obs._id}
                style={[
                  tw`flex-row items-center rounded-xl px-3 py-2 gap-2 mb-1`,
                  isHighContrast
                    ? { backgroundColor: palette.errorBg, borderColor: palette.error, borderWidth: 2 }
                    : { backgroundColor: '#3B0918', borderColor: '#B91C1C', borderWidth: 1 },
                ]}
              >
                <MaterialCommunityIcons name="alert-circle" size={16} color={isHighContrast ? palette.error : '#EF4444'} />
                <Text style={[tw`text-red-300 text-xs font-semibold flex-1`, isHighContrast && { color: palette.error }]}>
                  {obs.title ?? obs.type ?? 'Obstacle nearby'}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Step-Free Verification Badge */}
        {verificationStatus ? (
          <View
            style={[
              tw`flex-row items-center rounded-xl px-3 py-2 gap-2`,
              {
                backgroundColor: isHighContrast ? '#000000' : '#262626',
                borderColor: isHighContrast ? '#FFFFFF' : '#383838',
                borderWidth: isHighContrast ? 2 : 1,
              },
            ]}
          >
            <MaterialCommunityIcons
              name="ramp"
              size={16}
              color={isHighContrast ? '#FFFFFF' : '#D1D5DB'}
            />
            <Text style={[tw`text-xs font-medium`, { color: isHighContrast ? '#FFF' : '#E5E7EB' }]}>
              {verificationStatus}
            </Text>
          </View>
        ) : null}
      </View>

      {/* ── 4. Select Route Button ───────────────────────────────────── */}
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={onSelectRoute}
        accessible
        accessibilityRole="button"
        accessibilityLabel={`Select ${title ?? 'route'}`}
        accessibilityHint="Selects this accessible route and launches navigation"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={[
          tw`flex-row items-center justify-center rounded-xl py-3 px-5 gap-2`,
          isHighContrast
            ? { backgroundColor: palette.primary, borderColor: '#000000', borderWidth: 2, minHeight: 48 }
            : {
                backgroundColor: '#2E8B57',
                minHeight: 48,
                shadowColor: '#2E8B57',
                shadowOffset: { width: 0, height: 3 },
                shadowOpacity: 0.35,
                shadowRadius: 6,
                elevation: 3,
              },
        ]}
      >
        <Text
          style={[
            tw`text-sm font-bold tracking-wide`,
            { color: '#FFFFFF' },
          ]}
        >
          Select Route
        </Text>
        <MaterialIcons name="arrow-forward" size={19} color="#FFFFFF" />
      </TouchableOpacity>
    </TouchableOpacity>
  );
};

export default RouteSelectionCard;
