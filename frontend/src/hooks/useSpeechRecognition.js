import { useState, useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { mapLocaleToBCP47 } from '../utils/locale';

let ExpoSpeechRecognitionModule = null;
try {
  // eslint-disable-next-line global-require
  const mod = require('expo-speech-recognition');
  ExpoSpeechRecognitionModule = mod.ExpoSpeechRecognitionModule || mod.default?.ExpoSpeechRecognitionModule || null;
} catch (_) {}

const mapLocale = (locale) => mapLocaleToBCP47(locale) || locale || 'en-US';

/**
 * Native-first speech recognition hook for EAS Build.
 * Web: window.SpeechRecognition / webkitSpeechRecognition
 * Native: expo-speech-recognition (Android SpeechRecognizer, iOS SFSpeechRecognizer)
 */
export const useSpeechRecognition = () => {
  const [isSupported, setIsSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [confidence, setConfidence] = useState(0);
  // Alternative hypotheses from the STT engine — used by place matching to
  // recover when the top transcript mishears a place name.
  const [alternatives, setAlternatives] = useState([]);
  const [error, setError] = useState(null);

  const recognitionRef = useRef(null);
  const nativeListenersRef = useRef([]);

  // Detect support
  useEffect(() => {
    if (Platform.OS === 'web') {
      const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
      setIsSupported(!!SR);
    } else {
      // Native via expo-speech-recognition is supported when module exists
      setIsSupported(!!ExpoSpeechRecognitionModule);
    }
  }, []);

  // Cleanup listeners on unmount
  useEffect(() => {
    return () => {
      try {
        if (recognitionRef.current) {
          recognitionRef.current.onresult = null;
          recognitionRef.current.onerror = null;
          recognitionRef.current.onend = null;
          try { recognitionRef.current.stop(); } catch (_) {}
        }
      } catch (_) {}
      try {
        nativeListenersRef.current.forEach((sub) => {
          try { sub?.remove?.(); } catch (_) {}
        });
      } catch (_) {}
    };
  }, []);

  const reset = useCallback(() => {
    setTranscript('');
    setInterimTranscript('');
    setConfidence(0);
    setAlternatives([]);
    setError(null);
  }, []);

  const stop = useCallback(async () => {
    try {
      if (Platform.OS === 'web') {
        if (recognitionRef.current) {
          try { recognitionRef.current.stop(); } catch (_) {}
        }
      } else if (ExpoSpeechRecognitionModule) {
        try { await ExpoSpeechRecognitionModule.stop(); } catch (_) {}
        try { await ExpoSpeechRecognitionModule.abort(); } catch (_) {}
      }
    } catch (_) {}
    setIsListening(false);
  }, []);

  const start = useCallback(async (locale = 'en', options = {}) => {
    setError(null);
    setTranscript('');
    setInterimTranscript('');
    setConfidence(0);
    setAlternatives([]);

    const bcp47 = mapLocale(locale);
    // Place-name phrase hints (cities, landmarks, recents) — dramatically
    // improves recognition of proper nouns. Capped: huge lists hurt latency.
    const contextualStrings = (Array.isArray(options.contextualStrings) ? options.contextualStrings : [])
      .map((s) => String(s || '').trim())
      .filter(Boolean)
      .slice(0, 80);

    if (Platform.OS === 'web') {
      const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
      if (!SR) {
        setError('not-supported');
        setIsSupported(false);
        return;
      }
      try {
        const recog = new SR();
        recognitionRef.current = recog;
        recog.lang = bcp47;
        recog.continuous = false;
        recog.interimResults = true;
        recog.maxAlternatives = 3;

        recog.onstart = () => setIsListening(true);
        recog.onresult = (event) => {
          try {
            const results = event.results;
            let interim = '';
            let finalTranscript = '';
            let finalConfidence = 0;
            let finalAlts = [];
            for (let i = event.resultIndex; i < results.length; i++) {
              const res = results[i];
              const alt = res[0];
              if (res.isFinal) {
                finalTranscript += alt.transcript;
                if (typeof alt.confidence === 'number' && alt.confidence >= 0) {
                  finalConfidence = alt.confidence;
                }
                // Keep every hypothesis of the final result (engine order).
                finalAlts = [];
                for (let a = 0; a < res.length; a += 1) {
                  finalAlts.push({
                    transcript: res[a].transcript.trim(),
                    confidence: typeof res[a].confidence === 'number' && res[a].confidence >= 0 ? res[a].confidence : 0,
                  });
                }
              } else {
                interim += alt.transcript;
              }
            }
            if (interim) setInterimTranscript(interim);
            if (finalTranscript) {
              const cleaned = finalTranscript.trim();
              setTranscript(cleaned);
              setInterimTranscript('');
              // Real confidence only — 0 means "engine didn't report" (never faked).
              setConfidence(finalConfidence);
              setAlternatives(finalAlts.length ? finalAlts : [{ transcript: cleaned, confidence: finalConfidence }]);
            }
          } catch (e) {
            setError(e?.message || 'result-error');
          }
        };
        recog.onerror = (event) => {
          const code = event.error || 'unknown';
          setError(code);
          setIsListening(false);
        };
        recog.onend = () => {
          setIsListening(false);
        };
        recog.onspeechend = () => {
          // auto stop after short silence handled by continuous=false
        };
        recog.start();
        setIsListening(true);
      } catch (e) {
        setError(e?.message || 'start-failed');
        setIsListening(false);
      }
      return;
    }

    // Native path via expo-speech-recognition
    if (!ExpoSpeechRecognitionModule) {
      setError('not-supported');
      setIsSupported(false);
      return;
    }

    try {
      // Request permissions
      if (ExpoSpeechRecognitionModule.requestPermissionsAsync) {
        const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        const granted = perm?.granted ?? perm?.status === 'granted';
        if (!granted) {
          setError('not-allowed');
          return;
        }
      }

      // Clear previous listeners
      nativeListenersRef.current.forEach((s) => { try { s?.remove?.(); } catch (_) {} });
      nativeListenersRef.current = [];

      // Attach listeners via addListener if available, else use useSpeechRecognitionEvent pattern
      const addListener = ExpoSpeechRecognitionModule.addListener?.bind(ExpoSpeechRecognitionModule);
      if (addListener) {
        const resultSub = addListener('result', (event) => {
          try {
            const results = event.results || [];
            const first = results[0];
            if (first?.transcript) {
              const isFinal = event.isFinal;
              if (isFinal) {
                setTranscript(first.transcript.trim());
                // Real confidence only — 0 means "engine didn't report" (never faked).
                setConfidence(typeof first.confidence === 'number' && first.confidence >= 0 ? first.confidence : 0);
                const alts = results
                  .map((r) => ({
                    transcript: String(r?.transcript || '').trim(),
                    confidence: typeof r?.confidence === 'number' && r.confidence >= 0 ? r.confidence : 0,
                  }))
                  .filter((r) => r.transcript);
                setAlternatives(alts.length ? alts : [{ transcript: first.transcript.trim(), confidence: 0 }]);
                setInterimTranscript('');
              } else {
                setInterimTranscript(first.transcript);
              }
            }
          } catch (_) {}
        });
        const errorSub = addListener('error', (event) => {
          setError(event.error || event.message || 'unknown');
          setIsListening(false);
        });
        const endSub = addListener('end', () => setIsListening(false));
        const startSub = addListener('start', () => setIsListening(true));
        nativeListenersRef.current.push(resultSub, errorSub, endSub, startSub);
      }

      // Offline support: require on-device recognition when offline
      const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
      // Start recognition with high-accuracy options
      await ExpoSpeechRecognitionModule.start({
        lang: bcp47,
        interimResults: true,
        maxAlternatives: 3,
        continuous: false,
        requiresOnDeviceRecognition: isOffline,
        addsPunctuation: false,
        contextualStrings,
        volumeChangeEventOptions: { enabled: false },
      });
      setIsListening(true);
    } catch (e) {
      const msg = e?.message || String(e);
      if (msg.includes('not-allowed') || msg.includes('permission')) setError('not-allowed');
      else if (msg.includes('network')) setError('network');
      else if (msg.includes('no-speech')) setError('no-speech');
      else setError(msg || 'start-failed');
      setIsListening(false);
    }
  }, []);

  return {
    isSupported,
    isListening,
    transcript,
    interimTranscript,
    confidence,
    alternatives,
    error,
    start,
    stop,
    reset,
  };
};

export default useSpeechRecognition;
