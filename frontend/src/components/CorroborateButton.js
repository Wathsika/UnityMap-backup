import React, { useState, useEffect, useCallback } from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, AccessibilityInfo, Alert, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { radius } from '../theme/tokens';
import { corroborateReport, uncorroborateReport } from '../services/api';

/**
 * CorroborateButton — SPT-301
 * Reusable pill-shaped corroboration toggle for barrier reports.
 * Props: reportId, initialCount, isCorroboratedInitial, onSuccess
 */
export const CorroborateButton = ({
  reportId,
  initialCount = 0,
  isCorroboratedInitial = false,
  onSuccess,
  style,
  disabled = false,
}) => {
  const { isHighContrast, palette, borderWidth } = useTheme();
  const [corroborated, setCorroborated] = useState(!!isCorroboratedInitial);
  const [count, setCount] = useState(Number(initialCount) || 0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setCorroborated(!!isCorroboratedInitial);
  }, [isCorroboratedInitial]);

  useEffect(() => {
    setCount(Number(initialCount) || 0);
  }, [initialCount]);

  const handlePress = useCallback(async () => {
    if (loading || disabled) return;
    const wasCorroborated = corroborated;
    const nextCorroborated = !wasCorroborated;
    const nextCount = wasCorroborated ? Math.max(0, count - 1) : count + 1;

    // Optimistic update
    setCorroborated(nextCorroborated);
    setCount(nextCount);
    setLoading(true);

    try {
      let response;
      if (nextCorroborated) {
        response = await corroborateReport(reportId);
      } else {
        response = await uncorroborateReport(reportId);
      }
      const updated = response?.data || response;
      // If backend returns updated corroborationCount, sync to that value to stay consistent
      if (updated && typeof updated.corroborationCount === 'number') {
        setCount(updated.corroborationCount);
        if (Array.isArray(updated.upvotedBy)) {
          // keep corroborated in sync if backend indicates
          // no-op, optimistic already set
        }
      }
      try {
        AccessibilityInfo.announceForAccessibility(
          nextCorroborated
            ? `Confirmed. Total confirmations ${updated?.corroborationCount ?? nextCount}`
            : `Removed confirmation. Total ${updated?.corroborationCount ?? nextCount}`
        );
      } catch (_) {}
      if (onSuccess) {
        onSuccess(updated || { _id: reportId, corroborationCount: updated?.corroborationCount ?? nextCount, upvotedBy: [] });
      }
    } catch (err) {
      // Rollback optimistic state
      setCorroborated(wasCorroborated);
      setCount(count);
      const msg = err?.message || 'Unable to update corroboration. Please try again.';
      // Handle 409 already corroborated -> sync to true
      if (msg.includes('already corroborated') || msg.includes('409')) {
        setCorroborated(true);
      }
      try {
        Alert.alert('Corroboration failed', msg);
      } catch (_) {}
    } finally {
      setLoading(false);
    }
  }, [loading, disabled, corroborated, count, reportId, onSuccess]);

  const isActive = corroborated;
  const backgroundColor = isActive ? (isHighContrast ? palette.primary : '#0B3D2E') : palette.surface;
  const textColor = isActive ? '#FFFFFF' : palette.textPrimary;
  const borderColor = isActive ? (isHighContrast ? '#000000' : '#0B3D2E') : palette.secondaryBorder;

  const label = isActive ? `Confirmed (${count})` : `I see this too (${count})`;
  const icon = isActive ? '✓' : '👥';

  return (
    <TouchableOpacity
      onPress={handlePress}
      disabled={loading || disabled}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel="Confirm or corroborate barrier report"
      accessibilityState={{ selected: isActive, busy: loading, disabled: loading || disabled }}
      accessibilityHint={isActive ? 'Removes your confirmation' : 'Confirms you see this barrier too'}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={[
        styles.button,
        {
          backgroundColor,
          borderColor,
          borderWidth: isActive ? (isHighContrast ? borderWidth : 0) : borderWidth,
          opacity: loading || disabled ? 0.6 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={textColor} />
      ) : (
        <View style={styles.content}>
          <Text
            style={[styles.icon, { color: textColor }]}
            accessibilityElementsHidden
            importantForAccessibility="no"
          >
            {icon}
          </Text>
          <Text style={[styles.label, { color: textColor }]} numberOfLines={1}>
            {label}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    minWidth: 48,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    alignSelf: 'flex-start',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  icon: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
});

export default CorroborateButton;
