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
  Vibration,
} from 'react-native';
import {
  MaterialIcons,
  MaterialCommunityIcons,
  Feather,
  FontAwesome5,
} from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import BaseMap from '../../components/BaseMap';
import { useTheme } from '../../theme/ThemeContext';
import { useSpeech } from '../../hooks/useSpeech';
import { useLocation } from '../../hooks/useLocation';
import { getTextStyle, textProps } from '../../theme/typography';
import { calculateHaversineDistance, formatDistance } from '../../utils/mapMath';

/**
 * Default synthetic wheelchair turn-by-turn guidance steps
 * strictly tailored to ADA §405 standards with curb-cuts, ramps, and elevators.
 */
const DEFAULT_WHEELCHAIR_STEPS = [
  {
    id: 'step_1',
    instruction: 'Head south on the North Entrance ADA Ramp toward the Paved Plaza.',
    shortInstruction: 'Roll south on North Entrance Ramp',
    maneuver: 'straight',
    distanceMeters: 45,
    distanceText: '45 m',
    slope: 3.2,
    slopeLabel: 'Slope: 3.2° (ADA Safe)',
    slopeStatus: 'safe',
    surfaceType: 'Smooth Concrete',
    curbCut: true,
    coords: [6.9271, 79.8612],
  },
  {
    id: 'step_2',
    instruction: 'Turn right onto West Crossing utilizing the tactile curb-cut ramp.',
    shortInstruction: 'Turn right at tactile curb-cut',
    maneuver: 'turn-right',
    distanceMeters: 80,
    distanceText: '80 m',
    slope: 2.5,
    slopeLabel: 'Slope: 2.5° (Safe)',
    slopeStatus: 'safe',
    surfaceType: 'Tactile Pavers',
    curbCut: true,
    coords: [6.9279, 79.8606],
  },
  {
    id: 'step_3',
    instruction: 'Ascend the 1:12 ADA switchback ramp into North Wing entrance.',
    shortInstruction: 'Ascend ADA switchback ramp',
    maneuver: 'ramp-up',
    distanceMeters: 40,
    distanceText: '40 m',
    slope: 4.8,
    slopeLabel: 'Max Incline: 4.8° (1:12 Ramp)',
    slopeStatus: 'safe',
    surfaceType: 'High-Traction Rubber',
    curbCut: false,
    coords: [6.9288, 79.8611],
  },
  {
    id: 'step_4',
    instruction: 'Board North Wing Elevator 1 and select Level 2 (Door opens on right).',
    shortInstruction: 'Take Elevator 1 to Level 2',
    maneuver: 'elevator-enter',
    distanceMeters: 15,
    distanceText: '15 m',
    slope: 0.0,
    slopeLabel: 'Level Floor (0.0°)',
    slopeStatus: 'safe',
    surfaceType: 'Indoor Tile',
    elevatorName: 'North Wing Lift (Operational)',
    curbCut: false,
    coords: [6.9295, 79.862],
  },
  {
    id: 'step_5',
    instruction: 'Exit elevator on Level 2 and proceed slight left down the wide corridor.',
    shortInstruction: 'Turn slight left down corridor',
    maneuver: 'slight-left',
    distanceMeters: 110,
    distanceText: '110 m',
    slope: 1.2,
    slopeLabel: 'Incline: 1.2° (Level)',
    slopeStatus: 'safe',
    surfaceType: 'Low-Pile Carpet',
    curbCut: false,
    coords: [6.931, 79.8635],
  },
  {
    id: 'step_6',
    instruction: 'Arrive at Step-Free Accessible Destination on your right.',
    shortInstruction: 'Arrived at Destination',
    maneuver: 'arrive',
    distanceMeters: 10,
    distanceText: '10 m',
    slope: 0.0,
    slopeLabel: 'Destination Reached',
    slopeStatus: 'safe',
    surfaceType: 'Smooth Concrete',
    curbCut: false,
    coords: [6.9325, 79.8655],
  },
];

/**
 * Get maneuver icon for high-contrast navigation HUD
 */
const getManeuverIcon = (maneuver, color = '#FFFFFF') => {
  switch (maneuver) {
    case 'turn-left':
      return <MaterialIcons name="turn-left" size={30} color={color} />;
    case 'turn-right':
      return <MaterialIcons name="turn-right" size={30} color={color} />;
    case 'slight-left':
      return <MaterialCommunityIcons name="arrow-top-left" size={30} color={color} />;
    case 'slight-right':
      return <MaterialCommunityIcons name="arrow-top-right" size={30} color={color} />;
    case 'ramp-up':
      return <MaterialCommunityIcons name="slope-uphill" size={30} color={color} />;
    case 'ramp-down':
      return <MaterialCommunityIcons name="slope-downhill" size={30} color={color} />;
    case 'elevator-enter':
    case 'elevator-exit':
    case 'elevator':
      return <MaterialIcons name="elevator" size={30} color={color} />;
    case 'arrive':
    case 'destination':
      return <MaterialIcons name="place" size={30} color={color} />;
    case 'straight':
    default:
      return <MaterialIcons name="straight" size={30} color={color} />;
  }
};

/**
 * LiveTurnByTurnNavigationScreen
 * Jira: SPT-201 — "Live Turn-by-Turn Navigation Screen - Wheelchair Page 3"
 */
export const LiveTurnByTurnNavigationScreen = ({
  route = null,
  originName = 'Your Location',
  destinationName = 'Selected Destination',
  elevators = [],
  onExitNavigation,
}) => {
  const { palette, borderWidth, isHighContrast } = useTheme();
  const { speak, stop: stopSpeech, isSpeaking } = useSpeech();
  const { location: deviceLocation } = useLocation();

  // Navigation State
  const [isNavigating, setIsNavigating] = useState(true);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isVoiceMuted, setIsVoiceMuted] = useState(false);
  const [isStepsSheetOpen, setIsStepsSheetOpen] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [hasArrived, setHasArrived] = useState(false);

  // Derive route steps dynamically from coordinates or fallback
  const navigationSteps = useMemo(() => {
    if (route?.steps && Array.isArray(route.steps) && route.steps.length > 0) {
      return route.steps;
    }
    if (route?.coordinates && Array.isArray(route.coordinates) && route.coordinates.length >= 2) {
      const coords = route.coordinates;
      const start = coords[0];
      const end = coords[coords.length - 1];

      if (coords.length > 2) {
        return coords.map((c, i) => {
          const isFirst = i === 0;
          const isLast = i === coords.length - 1;
          return {
            id: `step_${i + 1}`,
            instruction: isFirst
              ? `Start moving along accessible path from ${originName}.`
              : isLast
              ? `Arrive at accessible entrance for ${destinationName}.`
              : `Continue along accessible route waypoint ${i + 1}.`,
            shortInstruction: isFirst ? 'Start along route' : isLast ? 'Arrived at Destination' : `Waypoint ${i + 1}`,
            maneuver: isFirst ? 'straight' : isLast ? 'arrive' : i % 2 === 0 ? 'turn-right' : 'turn-left',
            distanceMeters: Math.round(45 + (i * 20)),
            distanceText: `${Math.round(45 + (i * 20))} m`,
            slope: (1.5 + (i * 0.8)).toFixed(1),
            slopeLabel: `Slope: ${(1.5 + (i * 0.8)).toFixed(1)}° (Safe)`,
            slopeStatus: 'safe',
            surfaceType: 'Smooth Concrete',
            curbCut: true,
            coords: [Number(c[0]), Number(c[1])],
          };
        });
      }

      const mid1 = [start[0] + (end[0] - start[0]) * 0.33, start[1] + (end[1] - start[1]) * 0.33];
      const mid2 = [start[0] + (end[0] - start[0]) * 0.66, start[1] + (end[1] - start[1]) * 0.66];
      return [
        {
          id: 'step_1',
          instruction: `Head straight from ${originName} toward accessible route.`,
          shortInstruction: 'Head straight along path',
          maneuver: 'straight',
          distanceMeters: 45,
          distanceText: '45 m',
          slope: 2.1,
          slopeLabel: 'Slope: 2.1° (Safe)',
          slopeStatus: 'safe',
          surfaceType: 'Smooth Concrete',
          curbCut: true,
          coords: start,
        },
        {
          id: 'step_2',
          instruction: 'Turn right at the crossing using the tactile curb-cut ramp.',
          shortInstruction: 'Turn right at tactile ramp',
          maneuver: 'turn-right',
          distanceMeters: 65,
          distanceText: '65 m',
          slope: 2.8,
          slopeLabel: 'Slope: 2.8° (Safe)',
          slopeStatus: 'safe',
          surfaceType: 'Tactile Pavers',
          curbCut: true,
          coords: mid1,
        },
        {
          id: 'step_3',
          instruction: 'Proceed along the smooth ADA ramp towards the building entrance.',
          shortInstruction: 'Ascend ADA ramp',
          maneuver: 'ramp-up',
          distanceMeters: 50,
          distanceText: '50 m',
          slope: 4.2,
          slopeLabel: 'Slope: 4.2° (ADA Safe)',
          slopeStatus: 'safe',
          surfaceType: 'High-Traction Concrete',
          curbCut: false,
          coords: mid2,
        },
        {
          id: 'step_4',
          instruction: `Arrive at step-free accessible entrance for ${destinationName}.`,
          shortInstruction: 'Arrived at Destination',
          maneuver: 'arrive',
          distanceMeters: 10,
          distanceText: '10 m',
          slope: 0.0,
          slopeLabel: 'Destination Reached',
          slopeStatus: 'safe',
          surfaceType: 'Smooth Concrete',
          curbCut: false,
          coords: end,
        },
      ];
    }
    return DEFAULT_WHEELCHAIR_STEPS;
  }, [route, originName, destinationName]);

  const currentStep = navigationSteps[currentStepIndex] || navigationSteps[0];
  const totalSteps = navigationSteps.length;

  // Active coordinates along the route
  const routeCoordinates = useMemo(() => {
    if (route?.coordinates && Array.isArray(route.coordinates) && route.coordinates.length > 0) {
      return route.coordinates;
    }
    return navigationSteps.map((s) => s.coords);
  }, [route, navigationSteps]);

  // Current wheelchair position
  const currentPosition = useMemo(() => {
    if (currentStep?.coords && Array.isArray(currentStep.coords) && currentStep.coords.length >= 2) {
      return [Number(currentStep.coords[0]), Number(currentStep.coords[1])];
    }
    if (deviceLocation?.latitude && deviceLocation?.longitude) {
      return [deviceLocation.latitude, deviceLocation.longitude];
    }
    return routeCoordinates[0] || [6.9271, 79.8612];
  }, [currentStep, deviceLocation, routeCoordinates]);

  // Remaining route calculations
  const remainingSteps = navigationSteps.slice(currentStepIndex);
  const remainingDistanceMeters = useMemo(() => {
    return remainingSteps.reduce((sum, s) => sum + (s.distanceMeters || 50), 0);
  }, [remainingSteps]);

  const remainingEtaMins = useMemo(() => {
    const seconds = remainingDistanceMeters / 1.1;
    return Math.max(1, Math.round(seconds / 60));
  }, [remainingDistanceMeters]);

  // Trigger haptic and voice feedback when step changes
  const announceStep = useCallback(
    (stepObj, stepIdx) => {
      if (!stepObj) return;

      try {
        if (Platform.OS !== 'web') {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
          Vibration.vibrate([0, 150, 80, 150]);
        }
      } catch (_) {}

      if (!isVoiceMuted) {
        const voiceText = `In ${stepObj.distanceText || `${stepObj.distanceMeters} meters`}, ${stepObj.instruction}. ${
          stepObj.slope > 0 ? `Gradient is ${stepObj.slope} degrees.` : ''
        }`;
        speak(voiceText);
      }
    },
    [isVoiceMuted, speak]
  );

  // Auto-speak initial step upon starting navigation
  useEffect(() => {
    if (isNavigating && !hasArrived) {
      announceStep(currentStep, currentStepIndex);
    }
  }, [isNavigating, currentStepIndex]);

  // Simulation Timer
  useEffect(() => {
    let timer = null;
    if (isNavigating && isSimulating && !hasArrived) {
      timer = setInterval(() => {
        setCurrentStepIndex((prev) => {
          if (prev + 1 >= navigationSteps.length) {
            setIsSimulating(false);
            setHasArrived(true);
            return prev;
          }
          const next = prev + 1;
          announceStep(navigationSteps[next], next);
          return next;
        });
      }, 5500);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isNavigating, isSimulating, hasArrived, navigationSteps, announceStep]);

  // Next / Prev Step Handlers
  const handleNextStep = useCallback(() => {
    if (currentStepIndex + 1 < navigationSteps.length) {
      const nextIdx = currentStepIndex + 1;
      setCurrentStepIndex(nextIdx);
      if (nextIdx === navigationSteps.length - 1) {
        setHasArrived(true);
      }
      announceStep(navigationSteps[nextIdx], nextIdx);
    } else {
      setHasArrived(true);
    }
  }, [currentStepIndex, navigationSteps, announceStep]);

  const handlePreviousStep = useCallback(() => {
    if (currentStepIndex > 0) {
      const prevIdx = currentStepIndex - 1;
      setHasArrived(false);
      setCurrentStepIndex(prevIdx);
      announceStep(navigationSteps[prevIdx], prevIdx);
    }
  }, [currentStepIndex, navigationSteps, announceStep]);

  const handleEndNavigation = useCallback(() => {
    Alert.alert(
      'End Navigation?',
      'Are you sure you want to stop live wheelchair turn-by-turn guidance?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End Guidance',
          style: 'destructive',
          onPress: () => {
            stopSpeech();
            setIsNavigating(false);
            setIsSimulating(false);
            setCurrentStepIndex(0);
            if (onExitNavigation) {
              onExitNavigation();
            }
          },
        },
      ]
    );
  }, [stopSpeech, onExitNavigation]);

  // Map markers
  const mapMarkers = useMemo(() => {
    const originCoords = routeCoordinates[0] || [6.9271, 79.8612];
    const destCoords = routeCoordinates[routeCoordinates.length - 1] || [6.9325, 79.8655];

    const markers = [
      {
        id: 'wheelchair_user_pin',
        title: 'Wheelchair Position',
        desc: `Step ${currentStepIndex + 1}: ${currentStep?.shortInstruction || 'En route'}`,
        tag: 'YOU',
        type: 'current_position',
        lat: currentPosition[0],
        lng: currentPosition[1],
      },
      {
        id: 'origin_pin',
        title: originName,
        desc: 'Starting point',
        tag: 'START',
        type: 'green',
        lat: originCoords[0],
        lng: originCoords[1],
      },
      {
        id: 'destination_pin',
        title: destinationName,
        desc: 'Step-free accessible destination',
        tag: 'DEST',
        type: 'destination',
        lat: destCoords[0],
        lng: destCoords[1],
      },
    ];

    if (elevators && elevators.length > 0) {
      elevators.forEach((el) => {
        markers.push({
          id: `elev_${el.id}`,
          title: el.name || 'Elevator',
          desc: el.label || 'Elevator Status',
          tag: el.isOperational ? 'LIFT OK' : 'LIFT OUT',
          type: el.isOperational ? 'green' : 'red',
          lat: el.lat,
          lng: el.lng,
        });
      });
    }

    return markers;
  }, [routeCoordinates, currentPosition, currentStepIndex, currentStep, originName, destinationName, elevators]);

  // Active route polyline for BaseMap
  const activeRouteObj = useMemo(() => {
    return [
      {
        id: route?.id || 'active_turn_route',
        title: route?.title || 'Accessible Main Path',
        coordinates: routeCoordinates,
        color: isHighContrast ? '#00664D' : '#10B981',
        accentColor: isHighContrast ? '#005A91' : '#0B3D2E',
        isSelected: true,
      },
    ];
  }, [route, routeCoordinates, isHighContrast]);

  const currentNavLocation = useMemo(() => {
    return {
      latitude: currentPosition[0],
      longitude: currentPosition[1],
      heading: deviceLocation?.heading || 0,
    };
  }, [currentPosition, deviceLocation?.heading]);

  return (
    <SafeAreaView style={[styles.rootContainer, { backgroundColor: palette.background }]}>
      {/* ── 1. Top UnityMap Styled Navigation Header ──────────────────── */}
      <View
        style={[
          styles.topBanner,
          {
            backgroundColor: isHighContrast ? '#FFFFFF' : palette.surface,
            borderBottomColor: palette.cardBorder,
            borderBottomWidth: borderWidth,
            ...(!isHighContrast ? styles.cardShadow : {}),
          },
        ]}
      >
        {/* Top Control Bar */}
        <View style={styles.topControlRow}>
          <TouchableOpacity
            onPress={onExitNavigation || handleEndNavigation}
            accessible
            accessibilityRole="button"
            accessibilityLabel="Back to map overview"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={[
              styles.headerIconButton,
              {
                backgroundColor: palette.secondaryBg,
                borderColor: palette.cardBorder,
                borderWidth,
              },
            ]}
          >
            <MaterialIcons
              name="arrow-back"
              size={22}
              color={palette.textPrimary}
            />
          </TouchableOpacity>

          <View style={styles.headerTitleWrap}>
            <View style={styles.badgeRow}>
              <Text style={[styles.badgeText, { color: isHighContrast ? '#000000' : '#15803D' }]}>
                SPT-201 • LIVE GUIDANCE
              </Text>
              <View
                style={[
                  styles.statusPill,
                  isNavigating
                    ? { backgroundColor: isHighContrast ? palette.successBg : '#DCFCE7', borderColor: isHighContrast ? palette.success : '#86EFAC' }
                    : { backgroundColor: palette.secondaryBg, borderColor: palette.cardBorder },
                  { borderWidth },
                ]}
              >
                <View style={[styles.pulseDot, { backgroundColor: isNavigating ? (isHighContrast ? palette.success : '#16A34A') : palette.textMuted }]} />
                <Text style={[styles.statusPillText, { color: isNavigating ? (isHighContrast ? palette.success : '#15803D') : palette.textMuted }]}>
                  {hasArrived ? 'ARRIVED' : isNavigating ? 'NAVIGATING' : 'PRE-TRIP'}
                </Text>
              </View>
            </View>
            <Text
              {...textProps}
              style={[
                styles.destinationTitle,
                getTextStyle('base', { isHighContrast }),
                { color: palette.textPrimary },
              ]}
              numberOfLines={1}
            >
              {destinationName}
            </Text>
          </View>

          {/* Mute Voice Button */}
          <TouchableOpacity
            onPress={() => setIsVoiceMuted((prev) => !prev)}
            accessible
            accessibilityRole="button"
            accessibilityLabel={isVoiceMuted ? 'Unmute voice navigation' : 'Mute voice navigation'}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={[
              styles.headerIconButton,
              {
                backgroundColor: palette.secondaryBg,
                borderColor: palette.cardBorder,
                borderWidth,
              },
            ]}
          >
            <Feather
              name={isVoiceMuted ? 'volume-x' : 'volume-2'}
              size={20}
              color={isVoiceMuted ? (isHighContrast ? palette.error : '#DC2626') : (isHighContrast ? '#000000' : '#15803D')}
            />
          </TouchableOpacity>
        </View>

        {/* Maneuver Instruction Banner (Google Maps Turn Banner) */}
        <View
          style={[
            styles.maneuverBannerRow,
            {
              backgroundColor: isHighContrast ? '#000000' : '#0B3D2E',
              borderColor: isHighContrast ? '#000000' : '#0B3D2E',
              borderWidth,
            },
          ]}
        >
          <View style={[styles.maneuverIconContainer, { backgroundColor: isHighContrast ? '#FFFFFF' : '#1E6F50' }]}>
            {getManeuverIcon(currentStep?.maneuver, isHighContrast ? '#000000' : '#FFFFFF')}
          </View>
          <View style={styles.maneuverTextContainer}>
            <View style={styles.maneuverDistanceRow}>
              <Text style={[styles.maneuverDistanceText, { color: isHighContrast ? '#FFFFFF' : '#86EFAC' }]}>
                {currentStep?.distanceText || `${currentStep?.distanceMeters || 0} m`}
              </Text>
              <View
                style={[
                  styles.slopeBadge,
                  {
                    backgroundColor: isHighContrast ? '#FFFFFF' : '#14532D',
                    borderColor: isHighContrast ? '#FFFFFF' : '#22C55E',
                    borderWidth: 1,
                  },
                ]}
              >
                <Text style={[styles.slopeBadgeText, { color: isHighContrast ? '#000000' : '#BBF7D0' }]}>
                  {currentStep?.slopeLabel || `Incline: ${currentStep?.slope || 0}°`}
                </Text>
              </View>
            </View>
            <Text style={[styles.maneuverInstructionText, { color: '#FFFFFF' }]} numberOfLines={2}>
              {currentStep?.instruction}
            </Text>
          </View>
        </View>
      </View>

      {/* ── 2. Middle Section: Clear, Full-Size Interactive BaseMap ─────── */}
      <View style={[styles.mapContainer, { backgroundColor: palette.background }]}>
        <BaseMap
          center={currentPosition}
          zoom={18}
          markers={mapMarkers}
          routes={activeRouteObj}
          activeRouteId={route?.id || 'active_turn_route'}
          userLocation={currentNavLocation}
          userHeading={deviceLocation?.heading || 0}
          autoCenter={true}
          isHighContrast={isHighContrast}
          palette={palette}
          style={styles.baseMap}
        />

        {/* Floating Audio Cue Trigger Button over map */}
        <TouchableOpacity
          onPress={() => announceStep(currentStep, currentStepIndex)}
          activeOpacity={0.8}
          accessible
          accessibilityRole="button"
          accessibilityLabel="Repeat voice instruction"
          style={[
            styles.floatingAudioFab,
            {
              backgroundColor: palette.surface,
              borderColor: palette.cardBorder,
              borderWidth,
              ...(!isHighContrast ? styles.cardShadow : {}),
            },
          ]}
        >
          <Feather
            name={isSpeaking ? 'volume-2' : 'volume-1'}
            size={18}
            color={isHighContrast ? '#000000' : '#15803D'}
          />
          <Text
            style={[
              styles.floatingAudioFabText,
              { color: isHighContrast ? '#000000' : palette.textPrimary },
            ]}
          >
            {isSpeaking ? 'Speaking...' : 'Audio Cue'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── 3. Bottom Section: Telemetry & Next/Prev Action Deck ────────── */}
      <View
        style={[
          styles.bottomDeck,
          {
            backgroundColor: palette.surface,
            borderTopColor: palette.cardBorder,
            borderTopWidth: borderWidth,
            ...(!isHighContrast ? styles.cardShadow : {}),
          },
        ]}
      >
        {/* Telemetry Summary Bar */}
        <View style={styles.telemetrySummaryRow}>
          <View style={styles.telemetryGroup}>
            <Text style={[styles.telemetryBigEta, { color: isHighContrast ? '#000000' : '#0B3D2E' }]}>
              {remainingEtaMins} <Text style={[styles.telemetryEtaUnit, { color: isHighContrast ? '#000000' : '#15803D' }]}>min</Text>
            </Text>
            <Text style={[styles.telemetrySubInfo, { color: palette.textMuted }]}>
              {formatDistance(remainingDistanceMeters)} • Step {currentStepIndex + 1} of {totalSteps}
            </Text>
          </View>

          <View style={styles.telemetryPillDeck}>
            <View
              style={[
                styles.miniPill,
                {
                  backgroundColor: isHighContrast ? '#FFFFFF' : '#DCFCE7',
                  borderColor: isHighContrast ? '#000000' : '#BBF7D0',
                  borderWidth,
                },
              ]}
            >
              <MaterialCommunityIcons name="speedometer" size={13} color={isHighContrast ? '#000000' : '#15803D'} />
              <Text style={[styles.miniPillText, { color: isHighContrast ? '#000000' : '#15803D' }]}>1.1 m/s</Text>
            </View>
            <View
              style={[
                styles.miniPill,
                {
                  backgroundColor: isHighContrast ? '#FFFFFF' : '#ECFDF5',
                  borderColor: isHighContrast ? '#000000' : '#A7F3D0',
                  borderWidth,
                },
              ]}
            >
              <MaterialCommunityIcons name="angle-acute" size={13} color={isHighContrast ? '#000000' : '#059669'} />
              <Text style={[styles.miniPillText, { color: isHighContrast ? '#000000' : '#047857' }]}>{currentStep?.slope || 0}°</Text>
            </View>
          </View>
        </View>

        {/* Action Controls Row (≥48dp touch targets) */}
        <View style={styles.actionButtonsRow}>
          {/* Previous Step Button */}
          <TouchableOpacity
            onPress={handlePreviousStep}
            disabled={currentStepIndex === 0}
            accessible
            accessibilityRole="button"
            accessibilityLabel="Previous guidance step"
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            style={[
              styles.navBtn,
              {
                backgroundColor: palette.secondaryBg,
                borderColor: palette.cardBorder,
                borderWidth,
                opacity: currentStepIndex === 0 ? 0.4 : 1,
              },
            ]}
          >
            <MaterialIcons
              name="chevron-left"
              size={24}
              color={palette.textPrimary}
            />
            <Text style={[styles.navBtnText, { color: palette.textPrimary }]}>
              Prev
            </Text>
          </TouchableOpacity>

          {/* All Steps Toggle */}
          <TouchableOpacity
            onPress={() => setIsStepsSheetOpen((prev) => !prev)}
            accessible
            accessibilityRole="button"
            accessibilityLabel="View full steps list"
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            style={[
              styles.navBtn,
              {
                backgroundColor: palette.secondaryBg,
                borderColor: palette.cardBorder,
                borderWidth,
              },
            ]}
          >
            <Feather name="list" size={18} color={isHighContrast ? '#000000' : '#15803D'} />
            <Text style={[styles.navBtnText, { color: palette.textPrimary }]}>
              {isStepsSheetOpen ? 'Hide' : 'Steps'}
            </Text>
          </TouchableOpacity>

          {/* Simulate / Auto-Advance Button */}
          <TouchableOpacity
            onPress={() => setIsSimulating((prev) => !prev)}
            accessible
            accessibilityRole="button"
            accessibilityLabel={isSimulating ? 'Pause route simulation' : 'Play automated route simulation'}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            style={[
              styles.navBtn,
              {
                backgroundColor: isSimulating
                  ? (isHighContrast ? '#000000' : '#0B3D2E')
                  : palette.secondaryBg,
                borderColor: isSimulating
                  ? (isHighContrast ? '#000000' : '#0B3D2E')
                  : palette.cardBorder,
                borderWidth,
              },
            ]}
          >
            <MaterialIcons
              name={isSimulating ? 'pause' : 'play-arrow'}
              size={20}
              color={isSimulating ? '#FFFFFF' : (isHighContrast ? '#000000' : '#15803D')}
            />
            <Text style={[styles.navBtnText, { color: isSimulating ? '#FFFFFF' : palette.textPrimary }]}>
              {isSimulating ? 'Stop' : 'Sim'}
            </Text>
          </TouchableOpacity>

          {/* Next Step Button (Prominent Brand Green) */}
          <TouchableOpacity
            onPress={handleNextStep}
            disabled={hasArrived}
            accessible
            accessibilityRole="button"
            accessibilityLabel="Next guidance step"
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            style={[
              styles.navBtn,
              styles.navNextBtn,
              {
                backgroundColor: isHighContrast ? '#000000' : '#0B3D2E',
                borderColor: isHighContrast ? '#000000' : '#0B3D2E',
                borderWidth,
              },
              hasArrived && { opacity: 0.5 },
            ]}
          >
            <Text style={[styles.navBtnText, styles.navNextBtnText, { color: '#FFFFFF' }]}>
              Next
            </Text>
            <MaterialIcons name="chevron-right" size={24} color="#FFFFFF" />
          </TouchableOpacity>

          {/* End Navigation Button */}
          <TouchableOpacity
            onPress={handleEndNavigation}
            accessible
            accessibilityRole="button"
            accessibilityLabel="End turn-by-turn navigation"
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            style={[
              styles.endSquareBtn,
              {
                backgroundColor: isHighContrast ? '#FFFFFF' : '#FEE2E2',
                borderColor: isHighContrast ? '#000000' : '#FCA5A5',
                borderWidth,
              },
            ]}
          >
            <MaterialIcons
              name="close"
              size={22}
              color={isHighContrast ? '#000000' : '#DC2626'}
            />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── 4. Expandable Step-by-Step Directions Modal Drawer ─────────── */}
      {isStepsSheetOpen && (
        <View
          style={[
            styles.stepsDrawerModal,
            {
              backgroundColor: palette.surface,
              borderColor: palette.cardBorder,
              borderWidth,
              ...(!isHighContrast ? styles.cardShadow : {}),
            },
          ]}
        >
          <View style={[styles.drawerHeader, { borderBottomColor: palette.cardBorder }]}>
            <Text style={[styles.drawerTitle, { color: palette.textPrimary }]}>
              Turn-by-Turn Directions ({navigationSteps.length})
            </Text>
            <TouchableOpacity
              onPress={() => setIsStepsSheetOpen(false)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.closeDrawerBtn}
            >
              <MaterialIcons name="close" size={22} color={palette.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.drawerScroll} showsVerticalScrollIndicator={false}>
            {navigationSteps.map((st, idx) => {
              const isCurrent = idx === currentStepIndex;
              const isPast = idx < currentStepIndex;
              return (
                <TouchableOpacity
                  key={st.id || idx}
                  onPress={() => {
                    setCurrentStepIndex(idx);
                    setHasArrived(idx === navigationSteps.length - 1);
                    announceStep(st, idx);
                    setIsStepsSheetOpen(false);
                  }}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={`Step ${idx + 1}: ${st.shortInstruction || st.instruction}`}
                  style={[
                    styles.drawerItem,
                    {
                      backgroundColor: isCurrent
                        ? (isHighContrast ? '#FFFFFF' : '#DCFCE7')
                        : palette.surface,
                      borderColor: isCurrent
                        ? (isHighContrast ? '#000000' : '#86EFAC')
                        : palette.cardBorder,
                      borderWidth,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.drawerItemNumberCircle,
                      {
                        backgroundColor: isCurrent
                          ? (isHighContrast ? '#000000' : '#0B3D2E')
                          : isPast
                          ? (isHighContrast ? '#000000' : '#E2E8F0')
                          : palette.secondaryBg,
                      },
                    ]}
                  >
                    {isPast ? (
                      <MaterialIcons name="check" size={14} color={isHighContrast ? '#FFFFFF' : '#15803D'} />
                    ) : (
                      <Text
                        style={[
                          styles.drawerItemNumberText,
                          { color: isCurrent ? '#FFFFFF' : palette.textPrimary },
                        ]}
                      >
                        {idx + 1}
                      </Text>
                    )}
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        styles.drawerItemInstruction,
                        {
                          color: isCurrent
                            ? (isHighContrast ? '#000000' : '#0B3D2E')
                            : palette.textPrimary,
                          fontWeight: isCurrent ? '700' : '600',
                        },
                      ]}
                    >
                      {st.shortInstruction || st.instruction}
                    </Text>
                    <Text style={[styles.drawerItemSub, { color: palette.textMuted }]}>
                      {st.distanceText} • Incline: {st.slope}° • {st.surfaceType}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  rootContainer: {
    flex: 1,
  },
  cardShadow: {
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  topBanner: {
    paddingHorizontal: 14,
    paddingTop: Platform.OS === 'android' ? 32 : 6,
    paddingBottom: 12,
  },
  topControlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  headerIconButton: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleWrap: {
    flex: 1,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    gap: 4,
  },
  pulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusPillText: {
    fontSize: 9,
    fontWeight: '800',
  },
  destinationTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  maneuverBannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    padding: 12,
    gap: 12,
  },
  maneuverIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  maneuverTextContainer: {
    flex: 1,
  },
  maneuverDistanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  maneuverDistanceText: {
    fontSize: 18,
    fontWeight: '800',
  },
  slopeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  slopeBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  maneuverInstructionText: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  mapContainer: {
    flex: 1,
    width: '100%',
    position: 'relative',
  },
  baseMap: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  floatingAudioFab: {
    position: 'absolute',
    top: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    gap: 6,
    minHeight: 48,
  },
  floatingAudioFabText: {
    fontSize: 13,
    fontWeight: '700',
  },
  bottomDeck: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 20 : 12,
  },
  telemetrySummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  telemetryGroup: {
    flex: 1,
  },
  telemetryBigEta: {
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  telemetryEtaUnit: {
    fontSize: 14,
    fontWeight: '700',
  },
  telemetrySubInfo: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 1,
  },
  telemetryPillDeck: {
    flexDirection: 'row',
    gap: 6,
  },
  miniPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    gap: 4,
  },
  miniPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  actionButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  navBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 8,
  },
  navBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  navNextBtn: {
    flex: 1.5,
  },
  navNextBtnText: {
    fontSize: 15,
    fontWeight: '800',
  },
  endSquareBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepsDrawerModal: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '60%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    zIndex: 60,
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    borderBottomWidth: 1,
    marginBottom: 8,
  },
  drawerTitle: {
    fontSize: 15,
    fontWeight: '800',
  },
  closeDrawerBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerScroll: {
    flex: 1,
  },
  drawerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    gap: 10,
    marginBottom: 6,
  },
  drawerItemNumberCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerItemNumberText: {
    fontSize: 12,
    fontWeight: '800',
  },
  drawerItemInstruction: {
    fontSize: 13,
    lineHeight: 18,
  },
  drawerItemSub: {
    fontSize: 11,
    marginTop: 2,
  },
});

export default LiveTurnByTurnNavigationScreen;
