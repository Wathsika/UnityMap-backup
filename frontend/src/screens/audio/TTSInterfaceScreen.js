import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Card from '../../components/Card';
import Button from '../../components/Button';
import { useTheme } from '../../theme/ThemeContext';
import { getTextStyle, textProps } from '../../theme/typography';

/**
 * Text-to-Speech Interface Screen
 */
export const TTSInterfaceScreen = () => {
  const { palette, borderWidth, isHighContrast } = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <Card style={[styles.card, { borderColor: isHighContrast ? palette.success : '#A7F3D0', borderWidth: isHighContrast ? borderWidth : 1 }]}>
        <Text {...textProps} style={[styles.title, getTextStyle('xl', { isHighContrast }), { color: palette.textPrimary }]}>
          🔊 TTS & Audio Feedback
        </Text>
        <Text {...textProps} style={[styles.description, getTextStyle('sm', { isHighContrast }), { color: palette.textSecondary }]}>
          Customizable text-to-speech settings, audio ducking, pitch adjustment, and screen-reader accessibility shortcuts.
        </Text>
        <Button title="Test Voice Output" variant="secondary" onPress={() => {}} />
      </Card>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#F8FAFC' },
  card: { borderColor: '#A7F3D0', borderWidth: 1 },
  title: { fontSize: 20, fontWeight: '700', color: '#1E293B', marginBottom: 8 },
  description: { fontSize: 14, color: '#475569', lineHeight: 20, marginBottom: 14 },
});

export default TTSInterfaceScreen;
