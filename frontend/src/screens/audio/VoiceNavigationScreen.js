import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Animated, Easing } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Card from '../../components/Card';
import Button from '../../components/Button';
import { useTheme } from '../../theme/ThemeContext';
import { getTextStyle, textProps } from '../../theme/typography';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';

/**
 * Voice Input & Summary Readout Screen (SPT-106 — Audio Page 2)
 * Simplified: animated mic, live transcript, route summary (distance + ETA + spoken text), single-tap confirmation.
 */
export const VoiceNavigationScreen = ({
  initialTranscript = '',
  routeSummary: propRouteSummary = null,
  matches = null,
  selectedMatchId = null,
  onSelectMatch,
  onTranscriptChange,
  searchHints = [],
  onConfirm,
  onCancel,
}) => {
  const { palette, borderWidth, isHighContrast, isReduceMotionEnabled, preferredSTTLocale } = useTheme();
  const {
    isSupported,
    isListening,
    transcript,
    interimTranscript,
    confidence,
    alternatives,
    error,
    start,
    stop: stopListening,
  } = useSpeechRecognition();

  const [localTranscript, setLocalTranscript] = useState(initialTranscript);
  const [selectedId, setSelectedId] = useState(selectedMatchId);

  const displayTranscript = localTranscript || transcript;
  const effectiveRouteSummary = propRouteSummary || null;

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    if (isListening && !isReduceMotionEnabled) {
      const pulse = Animated.loop(
        Animated.parallel([
          Animated.timing(pulseAnim, {
            toValue: 1.18,
            duration: 900,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(opacityAnim, {
            toValue: 0.85,
            duration: 900,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
      opacityAnim.setValue(0.6);
    }
  }, [isListening, isReduceMotionEnabled, pulseAnim, opacityAnim]);

  useEffect(() => {
    if (initialTranscript) setLocalTranscript(initialTranscript);
  }, [initialTranscript]);

  useEffect(() => {
    if (transcript) {
      setLocalTranscript(transcript);
      // New final transcript from re-recording → parent re-resolves candidates.
      if (typeof onTranscriptChange === 'function') {
        onTranscriptChange(transcript, confidence, alternatives);
      }
    }
  }, [transcript]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedMatchId) setSelectedId(selectedMatchId);
  }, [selectedMatchId]);

  const handleMicPress = async () => {
    if (isListening) {
      try { await stopListening(); } catch (_) {}
      return;
    }
    try {
      await start(preferredSTTLocale || 'en', { contextualStrings: searchHints });
    } catch (_) {}
  };

  const handleMatchPress = (match) => {
    const matchKey = match?.id || match?.placeId || match?.title;
    setSelectedId(matchKey);
    if (typeof onSelectMatch === 'function') onSelectMatch(match);
  };

  const spokenSummaryText = effectiveRouteSummary
    ? effectiveRouteSummary.spokenSummary || effectiveRouteSummary.summary || JSON.stringify(effectiveRouteSummary)
    : `Route summary not yet available. Speak destination to generate summary.`;

  const distanceText = effectiveRouteSummary?.distanceText || effectiveRouteSummary?.distance || '--';
  const etaText = effectiveRouteSummary?.etaText || effectiveRouteSummary?.eta || '--';

  return (
    <ScrollView style={[styles.container, { backgroundColor: palette.background }]} contentContainerStyle={styles.content}>
      <View accessible accessibilityRole="header" accessibilityLabel="Voice input and summary readout" style={styles.landmarkHeader}>
        <Text {...textProps} style={[getTextStyle('xl', { isHighContrast }), { color: palette.textPrimary, textAlign: 'center' }]}>
          Voice Input & Summary
        </Text>
        <Text {...textProps} style={[getTextStyle('xs', { isHighContrast }), { color: palette.textMuted, textAlign: 'center', marginTop: 4 }]}>
          Speak destination, review summary, confirm with one tap
        </Text>
      </View>

      <Pressable
        accessible
        accessibilityRole="button"
        accessibilityLabel={isListening ? 'Listening, tap to stop' : 'Tap to speak destination'}
        accessibilityHint="Single tap to start or stop listening"
        accessibilityState={{ busy: isListening }}
        onPress={handleMicPress}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={({ pressed }) => [{ alignItems: 'center', justifyContent: 'center', marginVertical: 16, opacity: pressed ? 0.85 : 1 }]}
      >
        <Animated.View
          style={[
            styles.micPulse,
            {
              backgroundColor: isListening ? palette.primary : palette.surfaceAlt,
              borderColor: palette.cardBorder,
              borderWidth,
              transform: [{ scale: pulseAnim }],
              opacity: isReduceMotionEnabled ? 1 : opacityAnim,
            },
          ]}
        />
        <View style={[styles.micCore, { backgroundColor: isListening ? palette.primary : palette.surface, borderColor: palette.cardBorder, borderWidth }]}>
          <Feather name="mic" size={32} color={isListening ? palette.primaryText : palette.primary} />
          {isListening && <ActivityIndicator size="small" color={palette.primary} style={{ position: 'absolute', bottom: 6 }} />}
        </View>
        <Text {...textProps} style={[getTextStyle('xs', { isHighContrast }), { color: palette.textMuted, marginTop: 8 }]}>
          {isListening ? 'Listening…' : isSupported ? 'Tap to speak' : 'Voice not supported'}
        </Text>
      </Pressable>

      <Card style={[styles.card, { borderColor: palette.cardBorder, borderWidth, backgroundColor: palette.surface }]}>
        <Text {...textProps} style={[styles.cardTitle, getTextStyle('sm', { isHighContrast }), { color: palette.textPrimary }]}>Live Transcript</Text>
        <View accessible accessibilityLiveRegion="polite" style={[styles.transcriptBox, { borderColor: palette.border, borderWidth, backgroundColor: palette.background, minHeight: 48 }]}>
          {isListening && interimTranscript ? (
            <Text {...textProps} style={[getTextStyle('base', { isHighContrast }), { color: palette.textPrimary, fontStyle: 'italic' }]}>
              {interimTranscript}
            </Text>
          ) : displayTranscript ? (
            <>
              <Text {...textProps} style={[getTextStyle('base', { isHighContrast }), { color: palette.textPrimary }]}>
                {displayTranscript}
              </Text>
              {confidence > 0 && (
                <View
                  style={[
                    styles.confBadge,
                    {
                      backgroundColor: confidence >= 0.6 ? palette.successBg : palette.warningBg,
                      borderColor: confidence >= 0.6 ? palette.success : palette.warning,
                      borderWidth: isHighContrast ? borderWidth : 1,
                    },
                  ]}
                >
                  <Text style={[getTextStyle('xs', { isHighContrast }), { color: confidence >= 0.6 ? palette.success : palette.warning }]}>
                    {Math.round(confidence * 100)}% confidence
                  </Text>
                </View>
              )}
            </>
          ) : (
            <Text {...textProps} style={[getTextStyle('sm', { isHighContrast }), { color: palette.textMuted }]}>
              {isListening ? 'Listening for destination…' : 'Tap mic and speak destination'}
            </Text>
          )}
        </View>
        {error && (
          <Text {...textProps} style={[getTextStyle('xs', { isHighContrast }), { color: palette.error, marginTop: 8 }]}>
            Error: {error} — tap mic to retry
          </Text>
        )}
      </Card>

      {/* SPT: "Did you mean…" — only rendered when the spoken place was ambiguous */}
      {Array.isArray(matches) && matches.length > 0 && (
        <Card style={[styles.card, { borderColor: palette.cardBorder, borderWidth, backgroundColor: palette.surface }]}>
          <Text {...textProps} style={[styles.cardTitle, getTextStyle('sm', { isHighContrast }), { color: palette.textPrimary }]}>
            Did you mean?
          </Text>
          {matches.map((match) => {
            const matchKey = match.id || match.placeId || match.title;
            const isSelected = matchKey === selectedId;
            return (
              <Pressable
                key={String(matchKey)}
                accessible
                accessibilityRole="button"
                accessibilityLabel={`Navigate to ${match.title}${match.desc ? `, ${match.desc}` : ''}`}
                accessibilityState={{ selected: isSelected }}
                onPress={() => handleMatchPress(match)}
                style={({ pressed }) => [
                  styles.matchRow,
                  {
                    borderColor: isSelected ? palette.primary : palette.border,
                    backgroundColor: isSelected ? (isHighContrast ? palette.surfaceAlt : '#ECFDF5') : palette.background,
                    borderWidth: isSelected ? Math.max(2, borderWidth) : borderWidth,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <View style={styles.matchTextCol}>
                  <Text {...textProps} style={[getTextStyle('base', { isHighContrast }), { color: palette.textPrimary, fontWeight: '700' }]}>
                    {match.title}
                  </Text>
                  {!!match.desc && (
                    <Text {...textProps} style={[getTextStyle('xs', { isHighContrast }), { color: palette.textMuted, marginTop: 2 }]}>
                      {match.desc}
                    </Text>
                  )}
                </View>
                <View style={styles.matchChipCol}>
                  {!!match.distance && match.distance !== '--' && (
                    <View style={[styles.matchChip, { backgroundColor: palette.surfaceAlt, borderColor: palette.border, borderWidth }]}>
                      <Text {...textProps} style={[getTextStyle('xs', { isHighContrast }), { color: palette.textPrimary }]}>
                        {match.distance}
                      </Text>
                    </View>
                  )}
                  {isSelected && (
                    <Feather name="check-circle" size={18} color={palette.primary} style={{ marginLeft: 6 }} />
                  )}
                </View>
              </Pressable>
            );
          })}
        </Card>
      )}

      <Card style={[styles.card, { borderColor: palette.cardBorder, borderWidth, backgroundColor: palette.surface }]}>
        <Text {...textProps} style={[styles.cardTitle, getTextStyle('sm', { isHighContrast }), { color: palette.textPrimary }]}>Route Summary</Text>
        <View style={styles.summaryGrid}>
          <View style={[styles.summaryItem, { borderColor: palette.border, borderWidth: isHighContrast ? borderWidth : 0, backgroundColor: palette.background }]}>
            <Text {...textProps} style={[getTextStyle('xs', { isHighContrast }), { color: palette.textMuted }]}>Distance</Text>
            <Text {...textProps} style={[getTextStyle('base', { isHighContrast }), { color: palette.textPrimary, fontWeight: '700' }]}>{String(distanceText)}</Text>
          </View>
          <View style={[styles.summaryItem, { borderColor: palette.border, borderWidth: isHighContrast ? borderWidth : 0, backgroundColor: palette.background }]}>
            <Text {...textProps} style={[getTextStyle('xs', { isHighContrast }), { color: palette.textMuted }]}>ETA</Text>
            <Text {...textProps} style={[getTextStyle('base', { isHighContrast }), { color: palette.textPrimary, fontWeight: '700' }]}>{String(etaText)}</Text>
          </View>
        </View>
        <View style={[styles.spokenBox, { borderColor: palette.border, borderWidth, backgroundColor: palette.background, minHeight: 48 }]}>
          <Text {...textProps} style={[getTextStyle('sm', { isHighContrast }), { color: palette.textPrimary }]}>
            {spokenSummaryText}
          </Text>
        </View>
      </Card>

      <Button
        title="Confirm & Navigate"
        onPress={() => {
          if (onConfirm) {
            const selectedDestination =
              (Array.isArray(matches) && matches.find((m) => (m.id || m.placeId || m.title) === selectedId)) || null;
            onConfirm({
              transcript: displayTranscript,
              confidence,
              routeSummary: effectiveRouteSummary,
              destination: selectedDestination,
            });
          }
        }}
        accessibilityLabel="Confirm route and start navigation"
        accessibilityHint="Single tap to confirm and start navigation"
        style={{ minHeight: 48 }}
      />
      {onCancel && (
        <Button title="Cancel / Edit" variant="secondary" onPress={onCancel} style={{ minHeight: 48, marginTop: 8 }} />
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 24 },
  landmarkHeader: { alignItems: 'center', marginBottom: 8 },
  micPulse: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
  },
  micCore: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  cardTitle: { marginBottom: 8, fontWeight: '700' },
  card: { marginBottom: 12 },
  transcriptBox: {
    borderRadius: 12,
    padding: 12,
    justifyContent: 'center',
  },
  confBadge: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
    minHeight: 48,
  },
  matchTextCol: {
    flex: 1,
    paddingRight: 8,
  },
  matchChipCol: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  matchChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  summaryItem: {
    flexBasis: '48%',
    flexGrow: 1,
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
  },
  spokenBox: {
    borderRadius: 12,
    padding: 12,
    justifyContent: 'center',
  },
});

export default VoiceNavigationScreen;