import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Animated, Easing, Vibration, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Card from '../../components/Card';
import Button from '../../components/Button';
import { useTheme } from '../../theme/ThemeContext';
import { getTextStyle, textProps } from '../../theme/typography';
import { useSpeech } from '../../hooks/useSpeech';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';

/**
 * Spoken Guidance & Hazard Warning UI (SPT-204 — Audio Page 3)
 * Modal over UnityMapScreen with visual waveform, Re-prompt Voice (both), full-screen color hazard alerts with manual Dismiss.
 */
export const SpokenGuidanceHazardWarningScreen = ({
  routeSummary = null,
  nearbyHazards = [],
  safetyStatus = null,
  onReprompt,
  onDismiss,
}) => {
  const { palette, borderWidth, isHighContrast, isReduceMotionEnabled, preferredSTTLocale } = useTheme();
  const { speak, stop: stopSpeak, isSpeaking } = useSpeech();
  const { isListening, transcript, interimTranscript, start, stop: stopListening } = useSpeechRecognition();

  const [lastGuidance, setLastGuidance] = useState('');
  const [showHazardOverlay, setShowHazardOverlay] = useState(false);

  // Visual waveform animated values (4 bars)
  const barAnims = useRef([...Array(4)].map(() => new Animated.Value(6))).current;

  // Track pending timeouts so unmount clears them (prevents setState/speak after unmount)
  const pendingTimeoutsRef = useRef([]);
  const scheduleTimeout = (fn, ms) => {
    const id = setTimeout(() => {
      pendingTimeoutsRef.current = pendingTimeoutsRef.current.filter((t) => t !== id);
      fn();
    }, ms);
    pendingTimeoutsRef.current.push(id);
    return id;
  };
  useEffect(() => {
    const timeouts = pendingTimeoutsRef;
    return () => {
      timeouts.current.forEach((id) => clearTimeout(id));
      timeouts.current = [];
    };
  }, []);

  useEffect(() => {
    const shouldAnimate = (isListening || isSpeaking) && !isReduceMotionEnabled;
    let loops = [];
    if (shouldAnimate) {
      barAnims.forEach((anim, i) => {
        const loop = Animated.loop(
          Animated.sequence([
            Animated.timing(anim, { toValue: 22 + i * 3, duration: 380 + i * 80, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
            Animated.timing(anim, { toValue: 6, duration: 380 + i * 80, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
          ])
        );
        loop.start();
        loops.push(loop);
      });
    } else {
      barAnims.forEach((anim) => anim.setValue(6));
    }
    return () => loops.forEach((l) => { try { l.stop(); } catch (_) {} });
  }, [isListening, isSpeaking, isReduceMotionEnabled, barAnims]);

  // Build spoken guidance from routeSummary
  const destName = routeSummary?.destName || routeSummary?.landmark || 'Selected destination';
  const distanceText = routeSummary?.distanceText || routeSummary?.distance || '--';
  const etaText = routeSummary?.etaText || routeSummary?.eta || '--';
  const crossings = routeSummary?.crossings ?? '--';
  const hazardCount = nearbyHazards?.length ?? routeSummary?.hazardCount ?? 0;
  const level = safetyStatus?.level || (hazardCount > 0 ? 'hazard' : 'safe');
  const spokenGuidance = routeSummary?.spokenSummary || `Route to ${destName}: ${distanceText}, ${crossings} crossings, ${etaText}, ${hazardCount} hazards.`;

  useEffect(() => {
    if (spokenGuidance) setLastGuidance(spokenGuidance);
  }, [spokenGuidance]);

  // Severity-scaled haptic pulse engine
  useEffect(() => {
    if (level === 'hazard' || level === 'caution') {
      setShowHazardOverlay(true);
      const maxSeverity = Math.max(0, ...nearbyHazards.map((h) => Number(h.severity) || 0), nearbyHazards.length ? 3 : 0);
      const isSevere = maxSeverity >= 5 || level === 'hazard';
      const isModerate = maxSeverity >= 3;
      try {
        if (Platform.OS !== 'web') {
          if (isSevere) {
            // 5m severe: Heavy x3 — matches "missing tactile paving in 5m"
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
            scheduleTimeout(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {}), 300);
            scheduleTimeout(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {}), 600);
            Vibration.vibrate([0, 500, 200, 500, 200, 500]);
          } else if (isModerate) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            Vibration.vibrate([0, 500, 200, 500]);
          } else {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            Vibration.vibrate([0, 200]);
          }
        }
      } catch (_) {}
    } else {
      if (level === 'safe') setShowHazardOverlay(false);
    }
  }, [level, nearbyHazards, isReduceMotionEnabled]);

  // Contextual spoken hazard cue with distance 5m example (English-only)
  useEffect(() => {
    if (showHazardOverlay && nearbyHazards.length > 0) {
      const tactile = nearbyHazards.find((h) => (h.title || h.desc || '').toLowerCase().includes('tactile')) || nearbyHazards[0];
      const distance = 5; // spec example
      const hazardName = tactile?.title?.toLowerCase().includes('tactile') ? 'missing tactile paving' : tactile?.title || 'hazard';
      const spokenText = `Caution: ${hazardName} in ${distance} meters`;
      const rate = tactile?.ttsOverrides?.rate || 0.95;
      const pitch = tactile?.ttsOverrides?.pitch || 1.05;
      const volume = tactile?.ttsOverrides?.volume ?? 1.0;
      try {
        // Slight delay to let haptic start before speech
        scheduleTimeout(() => speak(spokenText, { rate, pitch, volume }), 400);
      } catch (_) {}
    }
  }, [showHazardOverlay, nearbyHazards, speak]);

  const handleReprompt = async () => {
    // Both: replay last TTS and re-listen STT
    try { stopSpeak(); } catch (_) {}
    try { speak(lastGuidance, { rate: 1.0 }); } catch (_) {}
    try {
      // small delay then start listening again
      setTimeout(async () => {
        try { await start(preferredSTTLocale || 'en'); } catch (_) {}
        if (onReprompt) onReprompt();
      }, 900);
    } catch (_) {
      if (onReprompt) onReprompt();
    }
  };

  const handleDismissHazard = () => {
    setShowHazardOverlay(false);
    try { stopSpeak(); } catch (_) {}
  };

  const hazardBg = isHighContrast
    ? level === 'hazard'
      ? palette.errorBg
      : level === 'caution'
      ? palette.warningBg
      : palette.successBg
    : level === 'hazard'
    ? '#FEE2E2'
    : level === 'caution'
    ? '#FEF3C7'
    : '#DCFCE7';
  const hazardColor = isHighContrast
    ? level === 'hazard'
      ? palette.error
      : level === 'caution'
      ? palette.warning
      : palette.success
    : level === 'hazard'
    ? '#DC2626'
    : level === 'caution'
    ? '#B45309'
    : '#065F46';

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Header landmark */}
        <View accessible accessibilityRole="header" accessibilityLabel="Spoken guidance and hazard warning" style={styles.header}>
          <Text {...textProps} style={[getTextStyle('xl', { isHighContrast }), { color: palette.textPrimary, textAlign: 'center' }]}>
            Guidance & Hazard Alerts
          </Text>
          <Text {...textProps} style={[getTextStyle('xs', { isHighContrast }), { color: palette.textMuted, textAlign: 'center', marginTop: 4 }]}>
            Visual waveform • Re-prompt Voice • Full-screen warnings
          </Text>
        </View>

        {/* Visual Waveform */}
        <Card style={[styles.card, { borderColor: palette.cardBorder, borderWidth, backgroundColor: palette.surface }]}>
          <View accessible accessibilityLabel="Audio waveform" accessibilityRole="image" style={styles.waveformContainer}>
            <View style={styles.waveformRow}>
              {barAnims.map((anim, idx) => (
                <Animated.View
                  key={idx}
                  style={[
                    styles.bar,
                    {
                      backgroundColor: palette.primary,
                      height: anim,
                      opacity: isListening || isSpeaking ? 1 : 0.35,
                    },
                  ]}
                />
              ))}
            </View>
            <View style={styles.micRow}>
              <Feather name="mic" size={20} color={palette.primary} style={{ marginRight: 8 }} />
              <Text {...textProps} style={[getTextStyle('sm', { isHighContrast }), { color: palette.textPrimary, fontWeight: '700' }]}>
                {isListening ? 'Listening…' : isSpeaking ? 'Speaking…' : 'Waveform idle'}
              </Text>
              {interimTranscript ? (
                <Text {...textProps} style={[getTextStyle('xs', { isHighContrast }), { color: palette.textMuted, fontStyle: 'italic', marginLeft: 8 }]} numberOfLines={1}>
                  {interimTranscript}
                </Text>
              ) : null}
            </View>
            {transcript ? (
              <Text {...textProps} style={[getTextStyle('sm', { isHighContrast }), { color: palette.textPrimary, marginTop: 8 }]} numberOfLines={2}>
                Heard: {transcript}
              </Text>
            ) : null}
          </View>
        </Card>

        {/* Spoken Guidance Card */}
        <Card style={[styles.card, { borderColor: palette.cardBorder, borderWidth, backgroundColor: palette.surface }]}>
          <Text {...textProps} style={[styles.cardTitle, getTextStyle('sm', { isHighContrast }), { color: palette.textPrimary }]}>Spoken Guidance</Text>
          <View style={styles.summaryGrid}>
            <View style={[styles.summaryItem, { borderColor: palette.border, borderWidth: isHighContrast ? borderWidth : 0, backgroundColor: palette.background }]}>
              <Text {...textProps} style={[getTextStyle('xs', { isHighContrast }), { color: palette.textMuted }]}>Distance</Text>
              <Text {...textProps} style={[getTextStyle('base', { isHighContrast }), { color: palette.textPrimary, fontWeight: '700' }]}>{String(distanceText)}</Text>
            </View>
            <View style={[styles.summaryItem, { borderColor: palette.border, borderWidth: isHighContrast ? borderWidth : 0, backgroundColor: palette.background }]}>
              <Text {...textProps} style={[getTextStyle('xs', { isHighContrast }), { color: palette.textMuted }]}>ETA</Text>
              <Text {...textProps} style={[getTextStyle('base', { isHighContrast }), { color: palette.textPrimary, fontWeight: '700' }]}>{String(etaText)}</Text>
            </View>
            <View style={[styles.summaryItem, { borderColor: palette.border, borderWidth: isHighContrast ? borderWidth : 0, backgroundColor: palette.background }]}>
              <Text {...textProps} style={[getTextStyle('xs', { isHighContrast }), { color: palette.textMuted }]}>Crossings</Text>
              <Text {...textProps} style={[getTextStyle('base', { isHighContrast }), { color: palette.textPrimary, fontWeight: '700' }]}>{String(crossings)}</Text>
            </View>
            <View style={[styles.summaryItem, { borderColor: palette.border, borderWidth: isHighContrast ? borderWidth : 0, backgroundColor: palette.background }]}>
              <Text {...textProps} style={[getTextStyle('xs', { isHighContrast }), { color: palette.textMuted }]}>Hazards</Text>
              <Text {...textProps} style={[getTextStyle('base', { isHighContrast }), { color: palette.textPrimary, fontWeight: '700' }]}>{String(hazardCount)}</Text>
            </View>
          </View>
          <View style={[styles.spokenBox, { borderColor: palette.border, borderWidth, backgroundColor: palette.background }]}>
            <Text {...textProps} style={[getTextStyle('sm', { isHighContrast }), { color: palette.textPrimary }]}>{spokenGuidance}</Text>
          </View>
        </Card>

        {/* Large Re-prompt Voice Button — Both */}
        <Button
          title="Re-prompt Voice"
          onPress={handleReprompt}
          accessibilityLabel="Re-prompt Voice — re-listen and replay guidance"
          accessibilityHint="Single tap to re-listen and replay last spoken guidance"
          style={{ minHeight: 56, borderRadius: 14 }}
        />
        <Text {...textProps} style={[getTextStyle('xs', { isHighContrast }), { color: palette.textMuted, textAlign: 'center', marginTop: 6 }]}>
          Both: re-listen STT and replay last TTS
        </Text>
      </ScrollView>

      {/* Full-screen color hazard warning overlay with manual Dismiss */}
      {showHazardOverlay && (
        <View
          accessible
          accessibilityViewIsModal
          accessibilityRole="alert"
          accessibilityLabel={`${level} hazard warning`}
          style={[
            styles.hazardOverlay,
            { backgroundColor: hazardBg, borderColor: isHighContrast ? hazardColor : 'transparent', borderWidth: isHighContrast ? 3 : 0 },
          ]}
        >
          <View style={styles.hazardContent}>
            <Feather name={level === 'hazard' ? 'alert-triangle' : 'alert-circle'} size={48} color={hazardColor} />
            <Text {...textProps} style={[getTextStyle('2xl', { isHighContrast }), { color: hazardColor, fontWeight: '800', textAlign: 'center', marginTop: 16 }]}>
              {level === 'hazard' ? 'Hazard Ahead' : level === 'caution' ? 'Caution' : 'All Clear'}
            </Text>
            <Text {...textProps} style={[getTextStyle('base', { isHighContrast }), { color: hazardColor, textAlign: 'center', marginTop: 8 }]}>
              {level === 'hazard' ? `Caution ahead — ${hazardCount} hazard(s) detected` : level === 'caution' ? 'Proceed with caution' : 'Route is safe'}
            </Text>
            {nearbyHazards.slice(0, 3).map((h, idx) => (
              <Text key={idx} {...textProps} style={[getTextStyle('sm', { isHighContrast }), { color: hazardColor, textAlign: 'center', marginTop: 4 }]}>
                • {h.title || h.desc || 'Hazard'}
              </Text>
            ))}
            <Button
              title="Dismiss"
              onPress={handleDismissHazard}
              accessibilityLabel="Dismiss hazard warning"
              style={{ minHeight: 48, marginTop: 24, minWidth: 160, alignSelf: 'center' }}
            />
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 24 },
  header: { alignItems: 'center', marginBottom: 12 },
  card: { marginBottom: 12 },
  cardTitle: { marginBottom: 8, fontWeight: '700' },
  waveformContainer: { alignItems: 'center', paddingVertical: 12 },
  waveformRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 6, height: 28, marginBottom: 12 },
  bar: { width: 6, borderRadius: 3, minHeight: 6 },
  micRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  summaryItem: { flexBasis: '48%', flexGrow: 1, borderRadius: 12, padding: 10, alignItems: 'center' },
  spokenBox: { borderRadius: 12, padding: 12, minHeight: 48, justifyContent: 'center' },
  hazardOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    zIndex: 50,
  },
  hazardContent: { alignItems: 'center', maxWidth: 320 },
});

export default SpokenGuidanceHazardWarningScreen;
