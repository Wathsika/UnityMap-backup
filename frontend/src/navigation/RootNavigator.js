/**
 * RootNavigator.js
 * Root Application Controller with Dynamic Role-Based Access Control
 * 
 * Flows:
 * 1. Unauthenticated (user === null) -> LoginScreen (Sign In & Sign Up)
 * 2. Authenticated Admin / Super Admin -> AdminPortalScaffoldScreen
 * 3. Authenticated Regular User -> UnityMapScreen (Map, Reporting & Settings)
 */

import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, StatusBar } from 'react-native';
import { Feather } from '@expo/vector-icons';
import authService, { USER_ROLES } from '../services/authService';
import LoginScreen from '../screens/auth/LoginScreen';
import UnityMapScreen from '../screens/wheelchair/UnityMapScreen';
import AdminPortalScaffoldScreen from '../screens/admin/AdminPortalScaffoldScreen';
import { useTheme } from '../theme/ThemeContext';

export const RootNavigator = () => {
  const [currentUser, setCurrentUser] = useState(authService.getCurrentUser());
  const [isInitializing, setIsInitializing] = useState(true);
  const { isHighContrast, palette } = useTheme();

  useEffect(() => {
    // 1. Subscribe to auth changes
    const unsubscribe = authService.subscribe((user) => {
      setCurrentUser(user);
    });

    // 2. Restore saved session on launch
    authService
      .loadSession()
      .then((user) => {
        setCurrentUser(user);
      })
      .finally(() => {
        setIsInitializing(false);
      });

    return () => unsubscribe();
  }, []);

  // Splash / Loading Screen during initial session check
  if (isInitializing) {
    return (
      <View style={[styles.splashContainer, isHighContrast && { backgroundColor: '#000000' }]}>
        <StatusBar barStyle="light-content" backgroundColor={isHighContrast ? '#000000' : '#0B3D2E'} />
        <View style={[styles.splashLogoCircle, isHighContrast && { borderWidth: 2, borderColor: '#FFFFFF' }]}>
          <Feather name="map-pin" size={36} color="#FFFFFF" />
        </View>
        <Text style={styles.splashTitle}>UnityMap</Text>
        <Text style={[styles.splashSubtitle, isHighContrast && { color: '#FFFFFF' }]}>Accessible Urban Mobility Platform</Text>
        <ActivityIndicator color={isHighContrast ? palette.primary : '#FFFFFF'} size="large" style={{ marginTop: 24 }} />
      </View>
    );
  }

  // 1. Unauthenticated: Render Unified Login & Sign-Up Screen
  if (!currentUser) {
    return <LoginScreen />;
  }

  // 2. Role-Based Navigation Routing
  const role = String(currentUser.role ?? '').toUpperCase().trim();
  const isSuper = !!currentUser.isSuperAdmin || currentUser.email === 'admin@unitymap.com';

  // Explicitly ensure REGULAR_USER always routes to UnityMapScreen
  if (role === USER_ROLES.REGULAR_USER && !isSuper) {
    return <UnityMapScreen />;
  }

  const isAdmin =
    isSuper ||
    role === USER_ROLES.ADMIN ||
    role === 'SUPER_ADMIN' ||
    role === 'CHIEF_ENGINEER';

  if (isAdmin) {
    return <AdminPortalScaffoldScreen />;
  }

  // 3. Fallback: Default to Accessible Map & Reporting Dashboard
  return <UnityMapScreen />;
};

const styles = StyleSheet.create({
  splashContainer: {
    flex: 1,
    backgroundColor: '#0B3D2E',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  splashLogoCircle: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  splashTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  splashSubtitle: {
    fontSize: 14,
    color: '#A7F3D0',
    marginTop: 4,
    textAlign: 'center',
  },
});

export default RootNavigator;
