import { useState, useCallback } from 'react';
import { Platform } from 'react-native';
import * as Speech from 'expo-speech';
import { useTheme } from '../theme/ThemeContext';

/**
 * Custom hook for TTS and Speech API interactions.
 * Bridges TalkBack/VoiceOver via AccessibilityInfo.announceForAccessibility when screen reader is active.
 */
export const useSpeech = () => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const { isScreenReaderEnabled, announce } = useTheme();

  const speak = useCallback(
    (text, options = {}) => {
      if (!text) return;
      setIsSpeaking(true);

      if (isScreenReaderEnabled) {
        try {
          announce(text);
        } catch (_) {
          if (__DEV__) console.log(`[Announce]: ${text}`);
        }
        setTimeout(() => setIsSpeaking(false), 800);
        return;
      }

      const speechOptions = {
        language: Platform.select({ ios: 'en-US', android: 'en', default: 'en-US' }),
        pitch: options.pitch ?? 1.0,
        rate: options.rate ?? 1.0,
        volume: options.volume ?? 1.0,
        ...options,
      };

      try {
        Speech.speak(text, {
          ...speechOptions,
          onDone: () => setIsSpeaking(false),
          onStopped: () => setIsSpeaking(false),
          onError: () => setIsSpeaking(false),
        });
      } catch (e) {
        if (__DEV__) console.log(`[TTS Speaking]: ${text}`, e?.message);
        setTimeout(() => setIsSpeaking(false), 2000);
      }
    },
    [isScreenReaderEnabled, announce]
  );

  const stop = useCallback(() => {
    setIsSpeaking(false);
    try {
      Speech.stop();
    } catch (_) {}
  }, []);

  return { speak, stop, isSpeaking };
};

export default useSpeech;
