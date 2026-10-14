import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { MaterialIcons, MaterialCommunityIcons, Feather, FontAwesome5 } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { getTextStyle, textProps } from '../../theme/typography';

/**
 * Get the appropriate icon and color for a specific wheelchair maneuver.
 */
export const getManeuverIcon = (maneuver, isHighContrast = false) => {
  // HC: white glyphs on blue (#005A91) primary background — 7.3:1 contrast
  const defaultColor = '#FFFFFF';
  const highContrastBg = isHighContrast ? '#005A91' : '#0B3D2E';

  switch (maneuver) {
    case 'turn-left':
      return {
        component: <MaterialIcons name="turn-left" size={30} color={defaultColor} />,
        label: 'Turn Left',
        bg: highContrastBg,
      };
    case 'turn-right':
      return {
        component: <MaterialIcons name="turn-right" size={30} color={defaultColor} />,
        label: 'Turn Right',
        bg: highContrastBg,
      };
    case 'slight-left':
      return {
        component: <MaterialCommunityIcons name="arrow-top-left" size={30} color={defaultColor} />,
        label: 'Slight Left',
        bg: highContrastBg,
      };
    case 'slight-right':
      return {
        component: <MaterialCommunityIcons name="arrow-top-right" size={30} color={defaultColor} />,
        label: 'Slight Right',
        bg: highContrastBg,
      };
    case 'ramp-up':
      return {
        component: <MaterialCommunityIcons name="slope-uphill" size={28} color={defaultColor} />,
        label: 'Ramp Up',
        bg: isHighContrast ? '#FFFFFF' : '#1E6F50',
      };
    case 'ramp-down':
      return {
        component: <MaterialCommunityIcons name="slope-downhill" size={28} color={defaultColor} />,
        label: 'Ramp Down',
        bg: isHighContrast ? '#FFFFFF' : '#1E6F50',
      };
    case 'elevator-enter':
    case 'elevator-exit':
    case 'elevator':
      return {
        component: <MaterialIcons name="elevator" size={30} color={defaultColor} />,
        label: 'Elevator',
        bg: isHighContrast ? '#FFFFFF' : '#0B3D2E',
      };
    case 'arrive':
    case 'destination':
      return {
        component: <MaterialIcons name="place" size={30} color={defaultColor} />,
        label: 'Destination',
        bg: isHighContrast ? '#FFFFFF' : '#0B3D2E',
      };
    case 'straight':
    default:
      return {
        component: <MaterialIcons name="straight" size={30} color={defaultColor} />,
        label: 'Go Straight',
        bg: highContrastBg,
      };
  }
};

/**
 * TurnByTurnCard Component
 * Jira: SPT-201 — Live Turn-by-Turn Navigation Screen (Wheelchair Page 3)
 */
export const TurnByTurnCard = ({
  step,
  stepIndex = 0,
  totalSteps = 1,
  onSpeakInstruction,
  isSpeaking = false,
  style,
}) => {
  const { palette, borderWidth, isHighContrast } = useTheme();

  if (!step) return null;

  const maneuverData = getManeuverIcon(step.maneuver, isHighContrast);
  const slopeVal = Number(step.slope || 0);
  const isSafeSlope = slopeVal <= 5.0;
  const isCautionSlope = slopeVal > 5.0 && slopeVal <= 8.0;

  // Slope Tag Color Palette aligned with app tokens (CVD-safe HC accents)
  const slopeColor = isHighContrast
    ? isSafeSlope
      ? { bg: palette.successBg, text: palette.success, border: palette.success }
      : isCautionSlope
      ? { bg: palette.warningBg, text: palette.warning, border: palette.warning }
      : { bg: palette.errorBg, text: palette.error, border: palette.error }
    : isSafeSlope
    ? { bg: '#DCFCE7', text: '#15803D', border: '#86EFAC' }
    : isCautionSlope
    ? { bg: '#FEF3C7', text: '#B45309', border: '#FDE68A' }
    : { bg: '#FEE2E2', text: '#DC2626', border: '#FCA5A5' };

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: isHighContrast ? '#FFFFFF' : palette.surface,
          borderColor: isHighContrast ? '#000000' : palette.cardBorder,
          borderWidth: isHighContrast ? 2 : borderWidth,
        },
        style,
      ]}
      accessible
      accessibilityLabel={`Step ${stepIndex + 1} of ${totalSteps}: In ${step.distanceText || `${step.distanceMeters} meters`}, ${step.instruction}. Slope: ${step.slope || 0} degrees.`}
    >
      {/* ── Top Header Row: Step Counter & Audio Prompt Button ── */}
      <View style={styles.topHeaderRow}>
        <View
          style={[
            styles.stepBadge,
            {
              backgroundColor: isHighContrast ? palette.successBg : '#DCFCE7',
              borderColor: isHighContrast ? palette.success : '#86EFAC',
              borderWidth: isHighContrast ? 2 : 1,
            },
          ]}
        >
          <Text
            {...textProps}
            style={[
              styles.stepBadgeText,
              { color: isHighContrast ? palette.success : '#15803D' },
            ]}
          >
            STEP {stepIndex + 1} OF {totalSteps}
          </Text>
        </View>

        {/* TTS Voice Guidance Button (≥48dp touch target) */}
        {onSpeakInstruction && (
          <TouchableOpacity
            onPress={onSpeakInstruction}
            activeOpacity={0.7}
            accessible
            accessibilityRole="button"
            accessibilityLabel={isSpeaking ? 'Repeating voice guidance' : 'Read aloud current direction'}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={[
              styles.audioButton,
              {
                backgroundColor: isSpeaking
                  ? (isHighContrast ? palette.primary : '#0B3D2E')
                  : palette.secondaryBg,
                borderColor: isSpeaking && isHighContrast ? '#000000' : palette.cardBorder,
                borderWidth: isHighContrast && isSpeaking ? 2 : borderWidth,
              },
            ]}
          >
            <Feather
              name={isSpeaking ? 'volume-2' : 'volume-1'}
              size={18}
              color={isSpeaking ? '#FFFFFF' : (isHighContrast ? '#000000' : '#15803D')}
            />
            <Text
              style={[
                styles.audioButtonText,
                { color: isSpeaking ? '#FFFFFF' : palette.textPrimary },
              ]}
            >
              {isSpeaking ? 'Speaking...' : 'Audio Cue'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Main Maneuver & Distance Row ── */}
      <View style={styles.mainManeuverRow}>
        {/* Large Directional / Accessibility Icon */}
        <View
          style={[
            styles.maneuverIconBox,
            {
              backgroundColor: isHighContrast ? palette.primary : maneuverData.bg,
              borderColor: isHighContrast ? '#000000' : '#0B3D2E',
              borderWidth: isHighContrast ? 2 : 1,
            },
          ]}
        >
          {maneuverData.component}
        </View>

        {/* Instruction & Distance Text */}
        <View style={styles.instructionContainer}>
          <View style={styles.distanceBadgeRow}>
            <Text
              style={[
                styles.distanceLargeText,
                getTextStyle('xl', { isHighContrast }),
                { color: isHighContrast ? palette.primary : '#0B3D2E' },
              ]}
            >
              {step.distanceText || `${step.distanceMeters || 0} m`}
            </Text>
            <Text
              style={[
                styles.distanceSubText,
                { color: palette.textMuted },
              ]}
            >
              remaining to maneuver
            </Text>
          </View>

          <Text
            {...textProps}
            style={[
              styles.instructionText,
              getTextStyle('base', { isHighContrast }),
              { color: palette.textPrimary },
            ]}
          >
            {step.instruction}
          </Text>
        </View>
      </View>

      {/* ── Wheelchair Incline & Surface Badges ── */}
      <View style={styles.badgesRow}>
        {/* Incline / Slope Badge */}
        <View
          style={[
            styles.tagBadge,
            {
              backgroundColor: slopeColor.bg,
              borderColor: slopeColor.border,
              borderWidth: isHighContrast ? 2 : 1,
            },
          ]}
        >
          <MaterialCommunityIcons
            name={isSafeSlope ? 'check-decagram' : 'alert'}
            size={14}
            color={slopeColor.text}
          />
          <Text style={[styles.tagBadgeText, { color: slopeColor.text }]}>
            {step.slopeLabel || `Incline: ${slopeVal}° (${isSafeSlope ? 'Safe' : 'Caution'})`}
          </Text>
        </View>

        {/* Surface Type Badge */}
        {step.surfaceType && (
          <View
            style={[
              styles.tagBadge,
              {
                backgroundColor: palette.secondaryBg,
                borderColor: palette.cardBorder,
                borderWidth,
              },
            ]}
          >
            <FontAwesome5
              name="road"
              size={11}
              color={palette.textSecondary}
            />
            <Text
              style={[
                styles.tagBadgeText,
                { color: palette.textSecondary },
              ]}
            >
              {step.surfaceType}
            </Text>
          </View>
        )}

        {/* Elevator Badge if applicable */}
        {step.elevatorName && (
          <View
            style={[
              styles.tagBadge,
              {
                backgroundColor: isHighContrast ? palette.successBg : '#ECFDF5',
                borderColor: isHighContrast ? palette.success : '#A7F3D0',
                borderWidth: isHighContrast ? 2 : 1,
              },
            ]}
          >
            <MaterialIcons
              name="elevator"
              size={14}
              color={isHighContrast ? palette.success : '#059669'}
            />
            <Text
              style={[
                styles.tagBadgeText,
                { color: isHighContrast ? palette.success : '#047857' },
              ]}
            >
              {step.elevatorName}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    padding: 16,
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
  topHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  stepBadge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  stepBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  audioButton: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    gap: 6,
  },
  audioButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  mainManeuverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 12,
  },
  maneuverIconBox: {
    width: 54,
    height: 54,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  instructionContainer: {
    flex: 1,
  },
  distanceBadgeRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    marginBottom: 2,
  },
  distanceLargeText: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  distanceSubText: {
    fontSize: 11,
    fontWeight: '500',
  },
  instructionText: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 19,
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tagBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  tagBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
});

export default TurnByTurnCard;
