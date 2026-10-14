import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Image, ActivityIndicator, TouchableOpacity, Platform } from 'react-native';
import Card from '../../components/Card';
import Button from '../../components/Button';
import { useTheme } from '../../theme/ThemeContext';
import { getTextStyle, textProps } from '../../theme/typography';
import { extractExifData } from '../../utils/exifHelper';
import { saveVolunteerDraft, clearVolunteerDraft, loadVolunteerDraft } from '../../theme/storage';

/**
 * EXIF Capture & Geotagging Screen — SPT-108
 * - Custom viewfinder UI (reuses Card/Button, ThemeContext, tokens)
 * - Supports Camera Capture + Pick from Gallery (Expo ImagePicker / web input)
 * - File directly passed to extractExifData — handles EXIF GPS & timestamp
 * - Automatic fallback to device geolocation + system timestamp when EXIF missing (soft warning, no block)
 * - Preview via URL.createObjectURL with revoke on replace/unmount
 */
export const EXIFCaptureScreen = ({ onBack, onCaptured, preserveDraftOnBack = false, initialUri = null, initialExifResult = null }) => {
  const { palette, borderWidth, isHighContrast } = useTheme();
  const [imageUri, setImageUri] = useState(initialUri);
  const [errorMsg, setErrorMsg] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [exifLoading, setExifLoading] = useState(false);
  const [exifResult, setExifResult] = useState(initialExifResult);
  const [fallbackMsg, setFallbackMsg] = useState(null);
  const isMountedRef = useRef(true);
  const previewUrlRef = useRef(null);
  const cancelFallbackRef = useRef(null);
  // True only for blob URLs created by THIS mount via URL.createObjectURL.
  // Parent-owned URIs (file://, content://, or a blob URL handed down as initialUri)
  // must never be revoked here — the parent still needs them after unmount (Step 2 → 3).
  const ownsPreviewRef = useRef(false);

  // Hydrate from parent unified state when navigating back — preserves photo across steps
  useEffect(() => {
    if (initialUri && initialUri !== imageUri) {
      setImageUri(initialUri);
      // Display-only: never take ownership of a parent URI, so unmount/replace
      // can never invalidate a blob URL the parent still references at submit time.
    }
    if (initialExifResult && initialExifResult !== exifResult) {
      let ex = initialExifResult;
      if (ex.capturedAt && typeof ex.capturedAt === 'string') {
        const d = new Date(ex.capturedAt);
        ex = { ...ex, capturedAt: Number.isNaN(d.getTime()) ? null : d };
      }
      setExifResult(ex);
    }
  }, [initialUri, initialExifResult]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (cancelFallbackRef.current) {
        clearTimeout(cancelFallbackRef.current);
        cancelFallbackRef.current = null;
      }
      // Intentionally NOT revoking previewUrlRef here: Step 2 → Step 3 unmounts this
      // screen while the parent still holds the URI for preview + submit. Revoking an
      // owned blob URL here used to break submit-time fetch(blob:) with
      // "Could not read selected image". Replacement revokes the old URL instead.
    };
  }, []);

  const revokePreview = useCallback(() => {
    if (previewUrlRef.current) {
      if (ownsPreviewRef.current) {
        try {
          URL.revokeObjectURL(previewUrlRef.current);
        } catch {}
        ownsPreviewRef.current = false;
      }
      previewUrlRef.current = null;
    }
  }, []);

  // Fallback: get device location when EXIF GPS missing — never blocks, soft warning only
  const getDeviceLocationFallback = useCallback(async () => {
    // Try expo-location first (native), fallback to navigator.geolocation (web)
    if (Platform.OS !== 'web') {
      try {
        const Location = await import('expo-location');
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return null;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (pos?.coords?.latitude && pos?.coords?.longitude) {
          return { latitude: pos.coords.latitude, longitude: pos.coords.longitude, altitude: pos.coords.altitude ?? null };
        }
      } catch {}
    }
    // Web: navigator.geolocation
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      try {
        const pos = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 8000, maximumAge: 10000 });
        });
        if (pos?.coords) {
          return { latitude: pos.coords.latitude, longitude: pos.coords.longitude, altitude: pos.coords.altitude ?? null };
        }
      } catch {}
    }
    return null;
  }, []);

  const persistDraft = useCallback(async (uri, exif, file) => {
    try {
      let existing = null;
      try { existing = await loadVolunteerDraft(); } catch {}
      const draft = {
        imageUri: uri,
        exifResult: exif
          ? {
              latitude: exif.latitude,
              longitude: exif.longitude,
              altitude: exif.altitude,
              hasGps: exif.hasGps,
              hasTimestamp: exif.hasTimestamp,
              capturedAt: exif.capturedAt ? exif.capturedAt.toISOString() : null,
            }
          : null,
        category: existing?.category ?? null,
        rating: existing?.rating ?? null,
        notes: existing?.notes ?? '',
        name: existing?.name ?? '',
        condition: existing?.condition ?? 'bad',
        locationName: existing?.locationName ?? '',
        capturedAt: existing?.capturedAt ?? null,
        manualCoords: existing?.manualCoords ?? null,
        updatedAt: new Date().toISOString(),
      };
      await saveVolunteerDraft(draft);
      if (typeof onCaptured === 'function') {
        onCaptured({ ...draft, file: file || null, exifRaw: exif || null });
      }
    } catch {}
  }, [onCaptured]);

  const enrichWithFallback = useCallback(async (exif) => {
    let enriched = { ...exif };
    let fallbackUsed = false;
    let fallbackMsgText = null;

    // GPS fallback
    if (!enriched.hasGps || typeof enriched.latitude !== 'number' || typeof enriched.longitude !== 'number') {
      const fallbackLoc = await getDeviceLocationFallback();
      if (fallbackLoc) {
        enriched.latitude = fallbackLoc.latitude;
        enriched.longitude = fallbackLoc.longitude;
        if (typeof fallbackLoc.altitude === 'number') enriched.altitude = fallbackLoc.altitude;
        enriched.hasGps = true;
        enriched.isFallbackGps = true;
        fallbackUsed = true;
        fallbackMsgText = 'Photo location unavailable — using device location';
      } else {
        // Still no GPS, but don't block — keep hasGps false, parent will use manualCoords fallback
        fallbackMsgText = 'Location unavailable — will use device location at submission';
      }
    }
    // Timestamp fallback — always provide current time if missing
    if (!enriched.hasTimestamp || !(enriched.capturedAt instanceof Date) || Number.isNaN(enriched.capturedAt.getTime())) {
      enriched.capturedAt = new Date();
      enriched.hasTimestamp = true;
      enriched.isFallbackTimestamp = true;
      if (!fallbackMsgText) fallbackMsgText = 'Timestamp unavailable — using current time';
      else fallbackMsgText += ' • Timestamp set to now';
      fallbackUsed = true;
    }
    return { enriched, fallbackUsed, fallbackMsgText };
  }, [getDeviceLocationFallback]);

  const processFile = useCallback(async (file) => {
    if (!file) {
      if (isMountedRef.current) setIsLoading(false);
      return;
    }
    if (!file.type || !file.type.startsWith('image/')) {
      if (isMountedRef.current) {
        setErrorMsg('Unsupported image format. Please select a valid image file (JPEG, PNG, HEIC).');
        setIsLoading(false);
      }
      return;
    }
    if (file.size === 0) {
      if (isMountedRef.current) {
        setErrorMsg('Invalid image file is empty. Please try another photo.');
        setIsLoading(false);
      }
      return;
    }

    revokePreview();
    let previewUrl;
    try {
      previewUrl = URL.createObjectURL(file);
    } catch (e) {
      if (isMountedRef.current) {
        setErrorMsg('Failed to create image preview. Please try again.');
        setIsLoading(false);
      }
      return;
    }

    if (!isMountedRef.current) {
      try { URL.revokeObjectURL(previewUrl); } catch {}
      return;
    }

    previewUrlRef.current = previewUrl;
    ownsPreviewRef.current = true;
    setImageUri(previewUrl);
    setErrorMsg(null);
    setFallbackMsg(null);
    setExifLoading(true);

    try {
      const exif = await extractExifData(file);
      if (!isMountedRef.current) return;
      // Apply automatic fallback for missing GPS/timestamp — soft warning, not blocking
      const { enriched, fallbackMsgText } = await enrichWithFallback(exif);
      if (!isMountedRef.current) return;
      setExifResult(enriched);
      if (fallbackMsgText) setFallbackMsg(fallbackMsgText);
      await persistDraft(previewUrl, enriched, file);
    } catch (exifErr) {
      if (!isMountedRef.current) return;
      const fallback = {
        latitude: null,
        longitude: null,
        capturedAt: null,
        altitude: null,
        hasGps: false,
        hasTimestamp: false,
      };
      const { enriched, fallbackMsgText } = await enrichWithFallback(fallback);
      if (!isMountedRef.current) return;
      setExifResult(enriched);
      if (fallbackMsgText) setFallbackMsg(fallbackMsgText);
      else setFallbackMsg('Photo details unavailable — using device location & current time');
      await persistDraft(previewUrl, enriched, file);
    } finally {
      if (isMountedRef.current) {
        setExifLoading(false);
        setIsLoading(false);
      }
    }
  }, [persistDraft, revokePreview, enrichWithFallback]);

  const handleCapture = useCallback(async () => {
    setErrorMsg(null);
    setFallbackMsg(null);
    setIsLoading(true);

    if (Platform.OS !== 'web') {
      try {
        let ImagePicker;
        try {
          ImagePicker = await import('expo-image-picker');
        } catch (impErr) {
          if (isMountedRef.current) {
            setErrorMsg('Camera module unavailable. Please install expo-image-picker or use web browser.');
            setIsLoading(false);
          }
          return;
        }
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (perm.status !== 'granted') {
          if (isMountedRef.current) {
            setErrorMsg('Camera permission denied. Please allow camera access in device settings and try again.');
            setIsLoading(false);
          }
          return;
        }
        const result = await ImagePicker.launchCameraAsync({
          // SDK 57: MediaTypeOptions deprecated in favour of the MediaType string union
          mediaTypes: 'images',
          allowsEditing: false,
          // 0.8 keeps captures under the backend 10MB cap and bounds base64 memory
          quality: 0.8,
          exif: true,
        });
        if (!isMountedRef.current) return;
        if (result.canceled) {
          setIsLoading(false);
          return;
        }
        const asset = result.assets && result.assets[0];
        if (!asset || !asset.uri) {
          setErrorMsg('Failed to capture image. Please try again.');
          setIsLoading(false);
          return;
        }
        revokePreview();
        if (!isMountedRef.current) return;
        previewUrlRef.current = null;
        setImageUri(asset.uri);
        setErrorMsg(null);
        setExifLoading(true);
        try {
          const exif = await extractExifData({ uri: asset.uri });
          if (!isMountedRef.current) return;
          const { enriched, fallbackMsgText } = await enrichWithFallback(exif);
          if (!isMountedRef.current) return;
          setExifResult(enriched);
          if (fallbackMsgText) setFallbackMsg(fallbackMsgText);
          // Proper FormData part for Expo native: { uri, name, type }
          const assetFile = {
            uri: asset.uri,
            name: asset.fileName || `photo_${Date.now()}.jpg`,
            type: asset.mimeType || asset.type || 'image/jpeg',
          };
          await persistDraft(asset.uri, enriched, assetFile);
        } catch (exifErr) {
          if (!isMountedRef.current) return;
          const fallback = { latitude: null, longitude: null, capturedAt: null, altitude: null, hasGps: false, hasTimestamp: false };
          const { enriched, fallbackMsgText } = await enrichWithFallback(fallback);
          if (!isMountedRef.current) return;
          setExifResult(enriched);
          if (fallbackMsgText) setFallbackMsg(fallbackMsgText);
          const assetFileFallback = { uri: asset.uri, name: asset.fileName || `photo_${Date.now()}.jpg`, type: asset.mimeType || asset.type || 'image/jpeg' };
          await persistDraft(asset.uri, enriched, assetFileFallback);
        } finally {
          if (isMountedRef.current) {
            setExifLoading(false);
            setIsLoading(false);
          }
        }
        return;
      } catch (e) {
        const raw = e?.message || '';
        if (isMountedRef.current) {
          if (/not available|no camera|unavailable|not supported/i.test(raw)) {
            setErrorMsg('Camera is unavailable on this device. Please try on a device with a camera or allow camera access.');
          } else {
            setErrorMsg('Failed to open camera. Please try again or check permissions.');
          }
          setIsLoading(false);
        }
        return;
      }
    }

    // Web: camera capture via <input capture>
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      setErrorMsg('Camera is unavailable on this device. Please try on a device with a camera or use a browser that supports file capture.');
      setIsLoading(false);
      return;
    }

    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.setAttribute('capture', 'environment');
      input.style.display = 'none';

      input.onchange = async (e) => {
        if (cancelFallbackRef.current) { clearTimeout(cancelFallbackRef.current); cancelFallbackRef.current = null; }
        const file = e.target.files && e.target.files[0];
        if (!file) {
          if (isMountedRef.current) setIsLoading(false);
          if (input.parentNode) input.parentNode.removeChild(input);
          return;
        }
        if (input.parentNode) input.parentNode.removeChild(input);
        await processFile(file);
      };

      input.oncancel = () => {
        if (cancelFallbackRef.current) { clearTimeout(cancelFallbackRef.current); cancelFallbackRef.current = null; }
        if (isMountedRef.current) setIsLoading(false);
        if (input.parentNode) input.parentNode.removeChild(input);
      };

      if (cancelFallbackRef.current) clearTimeout(cancelFallbackRef.current);
      cancelFallbackRef.current = setTimeout(() => {
        cancelFallbackRef.current = null;
        if (!isMountedRef.current) return;
        if (input.parentNode) input.parentNode.removeChild(input);
        setIsLoading(false);
      }, 30000);

      document.body.appendChild(input);
      input.click();
    } catch (e) {
      const raw = e?.message || '';
      if (/not available|no camera|unavailable|not supported/i.test(raw)) {
        setErrorMsg('Camera is unavailable on this device. Please try on a device with a camera or allow browser camera access.');
      } else {
        setErrorMsg('Failed to open camera. Please try again or check browser permissions.');
      }
      if (isMountedRef.current) setIsLoading(false);
    }
  }, [processFile, enrichWithFallback, persistDraft, revokePreview]);

  // Gallery picker — supports both native (ImagePicker) and web (file input without capture)
  const handlePickFromGallery = useCallback(async () => {
    setErrorMsg(null);
    setFallbackMsg(null);
    setIsLoading(true);

    if (Platform.OS !== 'web') {
      try {
        let ImagePicker;
        try {
          ImagePicker = await import('expo-image-picker');
        } catch {
          if (isMountedRef.current) { setErrorMsg('Gallery module unavailable.'); setIsLoading(false); }
          return;
        }
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (perm.status !== 'granted') {
          if (isMountedRef.current) { setErrorMsg('Gallery permission denied. Please allow photo access.'); setIsLoading(false); }
          return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
          // SDK 57: MediaTypeOptions deprecated in favour of the MediaType string union
          mediaTypes: 'images',
          allowsEditing: false,
          // 0.8 keeps uploads under the backend 10MB cap and bounds base64 memory
          quality: 0.8,
          exif: true,
        });
        if (!isMountedRef.current) return;
        if (result.canceled) { setIsLoading(false); return; }
        const asset = result.assets && result.assets[0];
        if (!asset || !asset.uri) { setErrorMsg('Failed to pick image.'); setIsLoading(false); return; }
        revokePreview();
        if (!isMountedRef.current) return;
        previewUrlRef.current = null;
        setImageUri(asset.uri);
        setErrorMsg(null);
        setExifLoading(true);
        try {
          const exif = await extractExifData({ uri: asset.uri });
          if (!isMountedRef.current) return;
          const { enriched, fallbackMsgText } = await enrichWithFallback(exif);
          if (!isMountedRef.current) return;
          setExifResult(enriched);
          if (fallbackMsgText) setFallbackMsg(fallbackMsgText);
          const assetFile = {
            uri: asset.uri,
            name: asset.fileName || `photo_${Date.now()}.jpg`,
            type: asset.mimeType || asset.type || 'image/jpeg',
          };
          await persistDraft(asset.uri, enriched, assetFile);
        } catch {
          if (!isMountedRef.current) return;
          const fallback = { latitude: null, longitude: null, capturedAt: null, altitude: null, hasGps: false, hasTimestamp: false };
          const { enriched, fallbackMsgText } = await enrichWithFallback(fallback);
          if (!isMountedRef.current) return;
          setExifResult(enriched);
          if (fallbackMsgText) setFallbackMsg(fallbackMsgText);
          const assetFileFallback = { uri: asset.uri, name: asset.fileName || `photo_${Date.now()}.jpg`, type: asset.mimeType || asset.type || 'image/jpeg' };
          await persistDraft(asset.uri, enriched, assetFileFallback);
        } finally {
          if (isMountedRef.current) { setExifLoading(false); setIsLoading(false); }
        }
        return;
      } catch (e) {
        if (isMountedRef.current) { setErrorMsg('Failed to open gallery.'); setIsLoading(false); }
        return;
      }
    }

    // Web: file input without capture attribute -> OS gallery/file picker
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      setErrorMsg('Gallery unavailable on this device.');
      setIsLoading(false);
      return;
    }
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.style.display = 'none';
      // No capture attribute → gallery/file picker

      input.onchange = async (e) => {
        if (cancelFallbackRef.current) { clearTimeout(cancelFallbackRef.current); cancelFallbackRef.current = null; }
        const file = e.target.files && e.target.files[0];
        if (!file) {
          if (isMountedRef.current) setIsLoading(false);
          if (input.parentNode) input.parentNode.removeChild(input);
          return;
        }
        if (input.parentNode) input.parentNode.removeChild(input);
        await processFile(file);
      };
      input.oncancel = () => {
        if (cancelFallbackRef.current) { clearTimeout(cancelFallbackRef.current); cancelFallbackRef.current = null; }
        if (isMountedRef.current) setIsLoading(false);
        if (input.parentNode) input.parentNode.removeChild(input);
      };
      if (cancelFallbackRef.current) clearTimeout(cancelFallbackRef.current);
      cancelFallbackRef.current = setTimeout(() => {
        cancelFallbackRef.current = null;
        if (!isMountedRef.current) return;
        if (input.parentNode) input.parentNode.removeChild(input);
        setIsLoading(false);
      }, 30000);
      document.body.appendChild(input);
      input.click();
    } catch (e) {
      setErrorMsg('Failed to open gallery picker.');
      if (isMountedRef.current) setIsLoading(false);
    }
  }, [processFile, enrichWithFallback, persistDraft, revokePreview]);

  const handleRetake = useCallback(() => {
    setExifResult(null);
    setErrorMsg(null);
    setFallbackMsg(null);
    handleCapture();
  }, [handleCapture]);

  const handleCancel = useCallback(async () => {
    revokePreview();
    setImageUri(null);
    setExifResult(null);
    setErrorMsg(null);
    setFallbackMsg(null);
    setIsLoading(false);
    setExifLoading(false);
    if (!preserveDraftOnBack) {
      try { await clearVolunteerDraft(); } catch {}
    }
    if (typeof onBack === 'function') onBack();
  }, [onBack, revokePreview, preserveDraftOnBack]);

  const hasImage = !!imageUri;

  // Derived validation — never claim GPS/timestamp when missing/invalid, but fallback ensures soft handling
  const hasGps = !!(exifResult && exifResult.hasGps && typeof exifResult.latitude === 'number' && typeof exifResult.longitude === 'number');
  const hasTimestamp = !!(exifResult && exifResult.hasTimestamp && exifResult.capturedAt instanceof Date && !Number.isNaN(exifResult.capturedAt.getTime()));
  const timestampIsFuture = hasTimestamp && exifResult.capturedAt > new Date();
  const timestampIsValid = hasTimestamp && !timestampIsFuture;

  const formatCoord = (v) => (typeof v === 'number' ? v.toFixed(5) : '—');
  const formatTimestamp = (d) => {
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '—';
    try { return d.toLocaleString(); } catch { return d.toISOString(); }
  };

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <Card
        style={[
          styles.card,
          { borderColor: palette.cardBorder, borderWidth },
          isHighContrast && { shadowOpacity: 0, elevation: 0 },
        ]}
      >
        <View style={styles.headerRow}>
          <Text {...textProps} style={[styles.title, getTextStyle('lg', { isHighContrast }), { color: palette.textPrimary }]} accessibilityRole="header">
            Take a Photo
          </Text>
          <TouchableOpacity
            onPress={handleCancel}
            disabled={isLoading || exifLoading}
            activeOpacity={0.7}
            accessible
            accessibilityRole="button"
            accessibilityLabel={hasImage ? 'Cancel and go back' : 'Go back to reporting'}
            accessibilityHint="Clears captured photo and returns to previous screen"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={[styles.cancelBtn, { borderColor: palette.secondaryBorder, borderWidth, backgroundColor: palette.secondaryBg, opacity: isLoading || exifLoading ? 0.5 : 1, minHeight: 48, minWidth: 48 }]}
          >
            <Text {...textProps} style={[styles.cancelText, getTextStyle('sm', { isHighContrast }), { color: palette.secondaryText }]}>
              {hasImage ? 'Cancel' : 'Back'}
            </Text>
          </TouchableOpacity>
        </View>
        <Text {...textProps} style={[styles.description, getTextStyle('sm', { isHighContrast }), { color: palette.textMuted }]}>
          A clear photo helps us verify and fix this barrier faster.
        </Text>

        {hasImage ? (
          <View style={[styles.previewWrapper, { borderColor: palette.cardBorder, borderWidth, backgroundColor: palette.surfaceAlt }]} accessible accessibilityLabel="Captured barrier photo preview">
            <Image source={{ uri: imageUri }} style={styles.previewImage} resizeMode="cover" accessible accessibilityLabel="Captured image" />
            <View pointerEvents="none" style={styles.viewfinderOverlay} accessible={false}>
              <View style={[styles.corner, styles.cornerTL, { borderColor: palette.focusRing, borderWidth: isHighContrast ? 3 : 2 }]} />
              <View style={[styles.corner, styles.cornerTR, { borderColor: palette.focusRing, borderWidth: isHighContrast ? 3 : 2 }]} />
              <View style={[styles.corner, styles.cornerBL, { borderColor: palette.focusRing, borderWidth: isHighContrast ? 3 : 2 }]} />
              <View style={[styles.corner, styles.cornerBR, { borderColor: palette.focusRing, borderWidth: isHighContrast ? 3 : 2 }]} />
              <View style={[styles.crosshairH, { backgroundColor: palette.focusRing, opacity: isHighContrast ? 1 : 0.9 }]} />
              <View style={[styles.crosshairV, { backgroundColor: palette.focusRing, opacity: isHighContrast ? 1 : 0.9 }]} />
            </View>
          </View>
        ) : (
          <View style={[styles.placeholder, { borderColor: palette.border, borderWidth: isHighContrast ? borderWidth : 1, backgroundColor: palette.surfaceAlt }, !isHighContrast && { borderStyle: 'dashed' }]} accessible accessibilityLabel="Camera — no photo yet">
            <View style={[styles.viewfinderFrame, { borderColor: palette.borderStrong, borderWidth: isHighContrast ? 2 : 1 }]}>
              <View style={[styles.corner, styles.cornerTL, { borderColor: palette.focusRing, borderWidth: isHighContrast ? 3 : 2 }]} />
              <View style={[styles.corner, styles.cornerTR, { borderColor: palette.focusRing, borderWidth: isHighContrast ? 3 : 2 }]} />
              <View style={[styles.corner, styles.cornerBL, { borderColor: palette.focusRing, borderWidth: isHighContrast ? 3 : 2 }]} />
              <View style={[styles.corner, styles.cornerBR, { borderColor: palette.focusRing, borderWidth: isHighContrast ? 3 : 2 }]} />
              <View style={[styles.crosshairH, { backgroundColor: palette.focusRing, opacity: isHighContrast ? 1 : 0.35 }]} />
              <View style={[styles.crosshairV, { backgroundColor: palette.focusRing, opacity: isHighContrast ? 1 : 0.35 }]} />
            </View>
            <Text {...textProps} style={[styles.placeholderText, getTextStyle('sm', { isHighContrast }), { color: palette.textMuted }]}>
              No photo yet. Tap Take Photo or Choose from Gallery.
            </Text>
            <Text {...textProps} style={[styles.viewfinderHint, getTextStyle('xs', { isHighContrast }), { color: palette.textMuted }]}>
              Keep the barrier in the center of the frame.
            </Text>
          </View>
        )}

        {exifLoading && hasImage && (
          <View style={styles.loadingRow} accessible accessibilityLabel="Reading photo details">
            <ActivityIndicator color={palette.primary} />
            <Text {...textProps} style={[styles.loadingText, getTextStyle('sm', { isHighContrast }), { color: palette.textSecondary }]}>Reading photo details...</Text>
          </View>
        )}

        {/* EXIF status badges hidden per UI cleanup — GPS/timestamp extraction still runs silently in background via extractExifData/enrichWithFallback */}

        {isLoading && !exifLoading && (
          <View style={styles.loadingRow} accessible accessibilityLabel="Opening camera">
            <ActivityIndicator color={palette.primary} />
            <Text {...textProps} style={[styles.loadingText, getTextStyle('sm', { isHighContrast }), { color: palette.textSecondary }]}>Opening camera/gallery...</Text>
          </View>
        )}

        {errorMsg && (
          <View style={[styles.errorBox, { backgroundColor: palette.errorBg, borderColor: palette.error, borderWidth }]} accessible accessibilityLiveRegion="polite">
            <Text {...textProps} style={[styles.errorText, getTextStyle('sm', { isHighContrast }), { color: palette.error }]}>{errorMsg}</Text>
          </View>
        )}

        <View style={styles.actions}>
          {!hasImage ? (
            <View style={styles.dualActions}>
              <View style={{ flex: 1 }}>
                <Button title={isLoading ? 'Opening Camera...' : 'Take Photo'} onPress={handleCapture} disabled={isLoading || exifLoading} accessibilityLabel="Take photo" />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Choose from Gallery" onPress={handlePickFromGallery} disabled={isLoading || exifLoading} variant="secondary" accessibilityLabel="Choose photo from gallery" accessibilityHint="Select an existing photo from your gallery" />
              </View>
            </View>
          ) : (
            <>
              <Button title={isLoading ? 'Opening...' : 'Retake Photo'} onPress={handleRetake} disabled={isLoading || exifLoading} accessibilityLabel="Retake photo" />
              <View style={styles.dualActions}>
                <View style={{ flex: 1 }}>
                  <Button title="Take New Photo" onPress={handleCapture} disabled={isLoading || exifLoading} variant="secondary" accessibilityLabel="Take new photo" />
                </View>
                <View style={{ flex: 1 }}>
                  <Button title="Choose from Gallery" onPress={handlePickFromGallery} disabled={isLoading || exifLoading} variant="secondary" accessibilityLabel="Choose photo from gallery" />
                </View>
              </View>
            </>
          )}
        </View>
      </Card>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#F8FAFC' },
  card: { borderColor: '#BBF7D0', borderWidth: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 12 },
  title: { fontSize: 20, fontWeight: '700', color: '#1E293B', flex: 1 },
  cancelBtn: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontWeight: '700', textAlign: 'center' },
  description: { fontSize: 14, color: '#475569', lineHeight: 20, marginBottom: 14 },
  previewWrapper: { borderRadius: 12, overflow: 'hidden', marginBottom: 12, minHeight: 220 },
  previewImage: { width: '100%', height: 240 },
  placeholder: { borderRadius: 12, minHeight: 180, alignItems: 'center', justifyContent: 'center', padding: 16, marginBottom: 12 },
  viewfinderFrame: { width: '78%', height: 110, borderRadius: 10, marginBottom: 10, alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' },
  viewfinderOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  corner: { position: 'absolute', width: 22, height: 22, backgroundColor: 'transparent' },
  cornerTL: { top: 10, left: 10, borderTopWidth: 3, borderLeftWidth: 3, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 6 },
  cornerTR: { top: 10, right: 10, borderTopWidth: 3, borderRightWidth: 3, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 6 },
  cornerBL: { bottom: 10, left: 10, borderBottomWidth: 3, borderLeftWidth: 3, borderTopWidth: 0, borderRightWidth: 0, borderBottomLeftRadius: 6 },
  cornerBR: { bottom: 10, right: 10, borderBottomWidth: 3, borderRightWidth: 3, borderTopWidth: 0, borderLeftWidth: 0, borderBottomRightRadius: 6 },
  crosshairH: { position: 'absolute', width: 28, height: 2, borderRadius: 1, top: '50%', marginTop: -1 },
  crosshairV: { position: 'absolute', height: 28, width: 2, borderRadius: 1, left: '50%', marginLeft: -1 },
  placeholderText: { textAlign: 'center', lineHeight: 20 },
  viewfinderHint: { textAlign: 'center', lineHeight: 16, marginTop: 2, fontStyle: 'italic' },
  badge: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 10 },
  badgeTitle: { fontWeight: '700', marginBottom: 2 },
  badgeDetail: { lineHeight: 18 },
  fallbackSoftBox: { borderRadius: 10, padding: 10, marginBottom: 12, backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FCD34D' },
  fallbackSoftText: { fontWeight: '600', textAlign: 'center' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12 },
  loadingText: { marginLeft: 8 },
  errorBox: { borderRadius: 10, padding: 10, marginBottom: 12 },
  errorText: { fontWeight: '600' },
  actions: { marginTop: 4 },
  dualActions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  secondaryAction: { marginTop: 8 },
});

export default EXIFCaptureScreen;
