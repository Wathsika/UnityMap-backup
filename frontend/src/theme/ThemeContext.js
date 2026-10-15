import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { getPalette, getBorderWidth, palettes } from './tokens';
import {
  loadHighContrast,
  saveHighContrast,
  loadAudioLauncherEnabled,
  saveAudioLauncherEnabled,
  loadPreferredSTTLocale,
  savePreferredSTTLocale,
} from './storage';

const ThemeContext = createContext({
  isHighContrast: false,
  setHighContrast: () => {},
  toggleHighContrast: () => {},
  palette: palettes.light,
  borderWidth: 1,
  isScreenReaderEnabled: false,
  isReduceMotionEnabled: false,
  setIsReduceMotionEnabled: () => {},
  toggleReduceMotion: () => {},
  isAudioLauncherEnabled: false,
  setAudioLauncherEnabled: () => {},
  toggleAudioLauncher: () => {},
  preferredSTTLocale: 'en',
  setPreferredSTTLocale: () => {},
  screenReaderName: Platform.select({ android: 'TalkBack', ios: 'VoiceOver', default: 'Screen Reader' }),
  announce: () => {},
});

export const ThemeProvider = ({ children }) => {
  const [isHighContrast, setIsHighContrast] = useState(false);
  const [isScreenReaderEnabled, setIsScreenReaderEnabled] = useState(false);
  const [isReduceMotionEnabled, setIsReduceMotionEnabled] = useState(false);
  const [isAudioLauncherEnabled, setIsAudioLauncherEnabled] = useState(false);
  const [preferredSTTLocale, setPreferredSTTLocaleState] = useState('en');
  const themeHydratedRef = useRef(false);

  useEffect(() => {
    Promise.all([
      loadHighContrast(),
      loadAudioLauncherEnabled(),
      loadPreferredSTTLocale(),
    ])
      .then(([hc, al, locale]) => {
        setIsHighContrast(hc);
        setIsAudioLauncherEnabled(al);
        setPreferredSTTLocaleState(locale);
      })
      .catch(() => {})
      .finally(() => {
        themeHydratedRef.current = true;
      });
  }, []);

  // Detect TalkBack / VoiceOver on launch and subscribe to OS changes
  useEffect(() => {
    let srSubscription;
    let rmSubscription;

    AccessibilityInfo.isScreenReaderEnabled()
      .then(setIsScreenReaderEnabled)
      .catch(() => {});

    if (AccessibilityInfo.isReduceMotionEnabled) {
      AccessibilityInfo.isReduceMotionEnabled()
        .then(setIsReduceMotionEnabled)
        .catch(() => {});
    }

    try {
      srSubscription = AccessibilityInfo.addEventListener('change', setIsScreenReaderEnabled);
    } catch (e) {
      try {
        // Legacy fallback for older RN
        AccessibilityInfo.addEventListener('screenReaderChanged', setIsScreenReaderEnabled);
      } catch (_) {}
    }

    try {
      if (AccessibilityInfo.addEventListener) {
        rmSubscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setIsReduceMotionEnabled);
      }
    } catch (_) {}

    return () => {
      try {
        srSubscription?.remove?.();
      } catch (_) {
        try {
          AccessibilityInfo.removeEventListener('change', setIsScreenReaderEnabled);
        } catch (_) {}
      }
      try {
        rmSubscription?.remove?.();
      } catch (_) {
        try {
          AccessibilityInfo.removeEventListener('reduceMotionChanged', setIsReduceMotionEnabled);
        } catch (_) {}
      }
    };
  }, []);

  const setHighContrast = useCallback((value) => {
    setIsHighContrast(value);
    saveHighContrast(value);
  }, []);

  const toggleHighContrast = useCallback(() => {
    setIsHighContrast((prev) => !prev);
  }, []);

  // Auto-enable Audio Launcher when OS TalkBack/VoiceOver turns on — user can still turn it off manually afterwards, persists across restarts
  useEffect(() => {
    if (isScreenReaderEnabled) {
      setIsAudioLauncherEnabled(true);
      saveAudioLauncherEnabled(true);
    }
  }, [isScreenReaderEnabled]);

  const setIsReduceMotionEnabledCb = useCallback((value) => {
    setIsReduceMotionEnabled(value);
  }, []);

  const toggleReduceMotion = useCallback(() => {
    setIsReduceMotionEnabled((prev) => !prev);
  }, []);

  const setAudioLauncherEnabled = useCallback((value) => {
    setIsAudioLauncherEnabled(value);
    saveAudioLauncherEnabled(value);
  }, []);

  const toggleAudioLauncher = useCallback(() => {
    setIsAudioLauncherEnabled((prev) => !prev);
  }, []);

  // Persist toggles outside the state updaters (updaters must be pure).
  // Skip until hydrated so the mount-run doesn't clobber stored values with defaults.
  useEffect(() => {
    if (!themeHydratedRef.current) return;
    saveHighContrast(isHighContrast);
  }, [isHighContrast]);
  useEffect(() => {
    if (!themeHydratedRef.current) return;
    saveAudioLauncherEnabled(isAudioLauncherEnabled);
  }, [isAudioLauncherEnabled]);

  const setPreferredSTTLocale = useCallback((locale) => {
    setPreferredSTTLocaleState(locale);
    savePreferredSTTLocale(locale);
  }, []);

  const announce = useCallback((message) => {
    if (!message) return;
    try {
      AccessibilityInfo.announceForAccessibility(message);
    } catch (_) {}
  }, []);

  const screenReaderName = useMemo(
    () => Platform.select({ android: 'TalkBack', ios: 'VoiceOver', default: 'Screen Reader' }),
    []
  );

  const value = useMemo(
    () => ({
      isHighContrast,
      setHighContrast,
      toggleHighContrast,
      palette: getPalette(isHighContrast),
      borderWidth: getBorderWidth(isHighContrast),
      isScreenReaderEnabled,
      isReduceMotionEnabled,
      setIsReduceMotionEnabled: setIsReduceMotionEnabledCb,
      toggleReduceMotion,
      isAudioLauncherEnabled,
      setAudioLauncherEnabled,
      toggleAudioLauncher,
      preferredSTTLocale,
      setPreferredSTTLocale,
      screenReaderName,
      announce,
    }),
    [
      isHighContrast,
      setHighContrast,
      toggleHighContrast,
      isScreenReaderEnabled,
      isReduceMotionEnabled,
      setIsReduceMotionEnabledCb,
      toggleReduceMotion,
      isAudioLauncherEnabled,
      setAudioLauncherEnabled,
      toggleAudioLauncher,
      preferredSTTLocale,
      setPreferredSTTLocale,
      screenReaderName,
      announce,
    ]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => useContext(ThemeContext);
export default ThemeContext;
