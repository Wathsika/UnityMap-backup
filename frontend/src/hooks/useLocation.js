import { useState, useEffect, useCallback, useRef } from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';

const DEFAULT_COORDINATES = {
  latitude: 6.9271,
  longitude: 79.8612,
  accuracy: 5.0,
};

/**
 * Custom hook for managing real GPS location from the mobile device.
 * Uses expo-location to request foreground GPS permissions and retrieve
 * live coordinates, accuracy, and continuous position updates.
 */
export const useLocation = () => {
  const [location, setLocation] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [permissionStatus, setPermissionStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const subscriptionRef = useRef(null);

  /**
   * Fetches the device's current GPS position with high accuracy.
   */
  const getCurrentLocation = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);

    try {
      // 1. Request foreground location permission from the device
      const { status } = await Location.requestForegroundPermissionsAsync();
      setPermissionStatus(status);

      if (status !== 'granted') {
        const msg = 'Location permission was denied. Please enable GPS in device settings.';
        if (__DEV__) console.warn('[useLocation]', msg);
        setErrorMsg(msg);
        setLocation(DEFAULT_COORDINATES);
        setLoading(false);
        return DEFAULT_COORDINATES;
      }

      // 2. Fetch current GPS position
      if (__DEV__) console.log('[useLocation] Requesting live device GPS coordinates...');
      const position = await Location.getCurrentPositionAsync({
        accuracy:
          Platform.OS === 'android'
            ? Location.Accuracy.High
            : Location.Accuracy.Balanced,
      });

      if (position && position.coords) {
        const coords = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          heading: position.coords.heading,
          speed: position.coords.speed,
        };
        if (__DEV__) console.log('[useLocation] Live mobile GPS coordinates received:', coords);
        setLocation(coords);
        setLoading(false);
        return coords;
      }

      // Fallback
      setLocation(DEFAULT_COORDINATES);
      setLoading(false);
      return DEFAULT_COORDINATES;
    } catch (err) {
      if (__DEV__) console.warn('[useLocation] GPS retrieval error:', err.message);
      setErrorMsg(err.message || 'Unable to retrieve device GPS location');

      // Attempt last known location as fallback
      try {
        const lastKnown = await Location.getLastKnownPositionAsync();
        if (lastKnown && lastKnown.coords) {
          const coords = {
            latitude: lastKnown.coords.latitude,
            longitude: lastKnown.coords.longitude,
            accuracy: lastKnown.coords.accuracy,
          };
          if (__DEV__) console.log('[useLocation] Using last known GPS position:', coords);
          setLocation(coords);
          setLoading(false);
          return coords;
        }
      } catch (_) {}

      setLocation(DEFAULT_COORDINATES);
      setLoading(false);
      return DEFAULT_COORDINATES;
    }
  }, []);

  /**
   * Recenter callback for the GPS FAB button.
   */
  const recenter = useCallback(async () => {
    return await getCurrentLocation();
  }, [getCurrentLocation]);

  // Initial GPS fetch on mount + subscribe to live position updates
  useEffect(() => {
    let isMounted = true;

    const startTracking = async () => {
      const coords = await getCurrentLocation();
      if (!isMounted) return;

      // Start live GPS watcher for real-time movement updates
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status === 'granted') {
          subscriptionRef.current = await Location.watchPositionAsync(
            {
              accuracy: Location.Accuracy.Balanced,
              timeInterval: 4000,
              distanceInterval: 5, // update every 5 meters
            },
            (newPosition) => {
              if (isMounted && newPosition?.coords) {
                setLocation({
                  latitude: newPosition.coords.latitude,
                  longitude: newPosition.coords.longitude,
                  accuracy: newPosition.coords.accuracy,
                  heading: newPosition.coords.heading,
                  speed: newPosition.coords.speed,
                });
              }
            }
          );
        }
      } catch (e) {
        if (__DEV__) console.warn('[useLocation] watchPositionAsync not active:', e.message);
      }
    };

    startTracking();

    return () => {
      isMounted = false;
      if (subscriptionRef.current) {
        try {
          subscriptionRef.current.remove();
        } catch (_) {}
      }
    };
  }, [getCurrentLocation]);

  return {
    location,
    errorMsg,
    permissionStatus,
    loading,
    getCurrentLocation,
    recenter,
    setLocation,
  };
};

export default useLocation;
