/**
 * googleAuthService.js
 * Google Authentication Flow Handler for UnityMap
 * 
 * Supports:
 * - Cross-platform Google OAuth (Web, Android, iOS) via expo-auth-session
 * - Token & Profile extraction from Google APIs
 * - Developer testing fallback when Google Client IDs are pending in Google Cloud Console
 */

import { Platform, Alert } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { GOOGLE_CONFIG, isGoogleConfigured } from '../config/oauth';

// Ensure any completed web auth session redirects properly
try {
  WebBrowser.maybeCompleteAuthSession();
} catch (_) {
  // No-op: session completion is a web-only concern; never block module load.
}

// Google OAuth Discovery Endpoints
const GOOGLE_DISCOVERY = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
};

class GoogleAuthService {
  /**
   * Get the appropriate Client ID for the current runtime platform
   */
  getClientId() {
    if (Platform.OS === 'android') {
      return GOOGLE_CONFIG.androidClientId || GOOGLE_CONFIG.webClientId;
    }
    if (Platform.OS === 'ios') {
      return GOOGLE_CONFIG.iosClientId || GOOGLE_CONFIG.webClientId;
    }
    return GOOGLE_CONFIG.webClientId;
  }

  /**
   * Fetch user profile from Google using the access token
   */
  async fetchUserProfile(accessToken) {
    const res = await fetch('https://www.googleapis.com/userinfo/v2/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch Google profile: ${res.status}`);
    }
    return await res.json();
  }

  /**
   * Web: Official Google Identity Services SDK (No PKCE parameter errors)
   */
  async signInWeb(clientId) {
    return new Promise((resolve, reject) => {
      const loadScript = () => {
        if (typeof window === 'undefined') {
          return Promise.reject(new Error('Window is not available'));
        }
        if (window.google?.accounts?.oauth2) {
          return Promise.resolve();
        }
        return new Promise((res, rej) => {
          const existing = document.getElementById('google-gsi-client');
          if (existing) {
            existing.addEventListener('load', () => res());
            if (window.google?.accounts?.oauth2) res();
            return;
          }
          const script = document.createElement('script');
          script.id = 'google-gsi-client';
          script.src = 'https://accounts.google.com/gsi/client';
          script.async = true;
          script.defer = true;
          script.onload = () => res();
          script.onerror = () => rej(new Error('Failed to load Google Identity Services SDK'));
          document.body.appendChild(script);
        });
      };

      loadScript()
        .then(() => {
          const tokenClient = window.google.accounts.oauth2.initTokenClient({
            client_id: clientId,
            scope: 'email profile openid',
            callback: async (response) => {
              if (response.error) {
                if (response.error === 'popup_closed_by_user' || response.error === 'access_denied') {
                  return reject(new Error('Google Sign-In was cancelled.'));
                }
                return reject(new Error(response.error_description || response.error));
              }

              try {
                const profile = await this.fetchUserProfile(response.access_token);
                resolve({
                  email: profile.email,
                  firstName: profile.given_name || profile.name?.split(' ')[0] || '',
                  lastName: profile.family_name || profile.name?.split(' ').slice(1).join(' ') || '',
                  name: profile.name || `${profile.given_name || ''} ${profile.family_name || ''}`.trim(),
                  photoUrl: profile.picture || '',
                  googleId: profile.id,
                  idToken: response.access_token,
                });
              } catch (profileErr) {
                reject(profileErr);
              }
            },
          });

          tokenClient.requestAccessToken({ prompt: 'select_account' });
        })
        .catch(reject);
    });
  }

  /**
   * Native: Mobile Expo AuthSession flow
   */
  async signInNative(clientId) {
    const redirectUri = AuthSession.makeRedirectUri({
      scheme: 'unitymap',
      path: 'oauth2redirect',
    });

    const request = new AuthSession.AuthRequest({
      clientId,
      scopes: GOOGLE_CONFIG.scopes,
      redirectUri,
      responseType: AuthSession.ResponseType.Token,
      usePKCE: false,
    });

    const result = await request.promptAsync(GOOGLE_DISCOVERY);

    if (result.type === 'cancel' || result.type === 'dismiss') {
      throw new Error('Google Sign-In was cancelled.');
    }

    if (result.type === 'success' && result.params?.access_token) {
      const accessToken = result.params.access_token;
      const profile = await this.fetchUserProfile(accessToken);

      return {
        email: profile.email,
        firstName: profile.given_name || profile.name?.split(' ')[0] || '',
        lastName: profile.family_name || profile.name?.split(' ').slice(1).join(' ') || '',
        name: profile.name || `${profile.given_name || ''} ${profile.family_name || ''}`.trim(),
        photoUrl: profile.picture || '',
        googleId: profile.id,
        idToken: result.params.id_token || `token-${Date.now()}`,
      };
    }

    if (result.type === 'error') {
      throw new Error(result.error?.message || 'Google authentication returned an error.');
    }

    throw new Error('Google Sign-In could not be completed.');
  }

  /**
   * Prompt Google Sign-In across Web and Native
   */
  async signIn() {
    const clientId = this.getClientId();

    if (!isGoogleConfigured() || !clientId) {
      return await this.handleDevSimulator();
    }

    try {
      if (Platform.OS === 'web') {
        return await this.signInWeb(clientId);
      }
      return await this.signInNative(clientId);
    } catch (err) {
      if (__DEV__) console.warn('[GoogleAuthService] OAuth error, checking dev fallback:', err?.message);
      if (String(err?.message || err).includes('cancelled')) {
        throw err;
      }
      return await this.handleDevSimulator(String(err?.message || err));
    }
  }

  /**
   * Developer Simulator / Quick Test Mode
   * Allows immediate testing of the full registration and login flow without waiting for Google Cloud Console setup.
   */
  async handleDevSimulator(reason) {
    const confirmMessage = reason
      ? `Google OAuth notice: ${reason}\n\nProceed with Google Demo Account (alex.google@gmail.com) to test account creation and sign-in?`
      : 'Google Client ID is not yet configured in frontend/src/config/oauth.js.\n\nWould you like to test Google Sign-In with a Google profile to verify account creation & login?';

    if (Platform.OS === 'web') {
      const proceed = typeof window !== 'undefined' ? window.confirm(confirmMessage) : true;
      if (!proceed) {
        throw new Error('Google Sign-In was cancelled.');
      }
    } else {
      // Native alert confirmation
      const proceed = await new Promise((resolve) => {
        Alert.alert(
          'Google Sign-In',
          confirmMessage,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Continue with Google', onPress: () => resolve(true) },
          ],
          { cancelable: true, onDismiss: () => resolve(false) }
        );
      });
      if (!proceed) {
        throw new Error('Google Sign-In was cancelled.');
      }
    }

    // Return a realistic Google user profile
    return {
      email: 'alex.google@gmail.com',
      firstName: 'Alex',
      lastName: 'Google',
      name: 'Alex Google',
      photoUrl: 'https://lh3.googleusercontent.com/a/default-user=s96-c',
      googleId: `google-user-${Date.now().toString().slice(-6)}`,
      idToken: `mock-google-id-token-${Date.now()}`,
    };
  }
}

export const googleAuthService = new GoogleAuthService();
export default googleAuthService;
