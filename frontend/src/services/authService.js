/**
 * authService.js
 * Unified Role-Based Authentication & Session Management Service
 * 
 * Supports:
 * - 2 Core Roles: ADMIN (with Super Admin protection) and REGULAR_USER (accessibility + general)
 * - Sign In & Sign Up (Registration)
 * - User Role Promotion & Demotion
 * - Persistent session storage with AsyncStorage
 * - Real Node.js + MongoDB backend integration with robust offline fallback
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiRequest, setUnauthorizedHandler } from './api';
import { validateEmail } from '../utils/validation';

export const USER_ROLES = {
  ADMIN: 'ADMIN',
  REGULAR_USER: 'REGULAR_USER',
};

const STORAGE_SESSION_KEY = '@unitymap_session';

/**
 * Seeded municipal demo accounts provisioned by the backend on first login.
 * These are reference credentials only — the client never authenticates against
 * them locally, it always exchanges them for a signed server token.
 */
export const DEMO_CREDENTIALS = {
  SUPER_ADMIN: {
    email: 'admin@unitymap.com',
    password: 'Admin@2026',
    name: 'Super Admin',
    role: USER_ROLES.ADMIN,
    isSuperAdmin: true,
  },
  NORMAL_ADMIN: {
    email: 'k.perera@cmc.gov.lk',
    password: 'CMC@2026',
    name: 'Eng. K. Perera',
    role: 'CHIEF_ENGINEER',
    isSuperAdmin: false,
  },
  REGULAR_USER: {
    email: 'user@unitymap.com',
    password: 'User@2026',
    name: 'Alex Morgan',
    role: USER_ROLES.REGULAR_USER,
    isSuperAdmin: false,
  },
};

class AuthService {
  constructor() {
    this.currentUser = null;
    this.listeners = [];
    this.isInitialized = false;

    // A rejected token means the session is dead — clear it so the navigator
    // drops the user back to the login screen instead of showing a broken portal.
    setUnauthorizedHandler(() => {
      if (this.currentUser) {
        if (__DEV__) console.warn('[AuthService] Session rejected by server — signing out.');
        this.logout();
      }
    });
  }

  /**
   * Subscribe to authentication state updates
   */
  subscribe(listener) {
    this.listeners.push(listener);
    // Immediately invoke with current state
    listener(this.currentUser);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  notify() {
    this.listeners.forEach((listener) => {
      try {
        listener(this.currentUser);
      } catch (err) {
        if (__DEV__) console.warn('[AuthService] Listener notification error:', err);
      }
    });
  }

  getCurrentUser() {
    return this.currentUser;
  }

  isAuthenticated() {
    return !!this.currentUser && !!this.currentUser.token;
  }

  isAdmin() {
    if (!this.currentUser) return false;
    const role = (this.currentUser.role || '').toUpperCase();
    return role === 'ADMIN' || role === 'CHIEF_ENGINEER' || role === 'SUPER_ADMIN' || !!this.currentUser.isSuperAdmin;
  }

  isSuperAdmin() {
    if (!this.currentUser) return false;
    return !!this.currentUser.isSuperAdmin || this.currentUser.email === 'admin@unitymap.com';
  }

  /**
   * Initialize and load saved session from AsyncStorage
   */
  async loadSession() {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_SESSION_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.token) {
          this.currentUser = parsed;
          this.isInitialized = true;
          this.notify();
          return this.currentUser;
        }
      }
    } catch (err) {
      if (__DEV__) console.warn('[AuthService] Error loading stored session:', err);
    }
    this.currentUser = null;
    this.isInitialized = true;
    this.notify();
    return null;
  }

  /**
   * Sign In with Email and Password
   *
   * Credentials are always verified by the backend, which returns a signed
   * session token. There is deliberately no local fallback: fabricating a
   * session when the API is unreachable would hand out admin clearance that
   * the server never granted.
   */
  async login({ email, password }) {
    if (!email || !password) {
      throw new Error('Please enter both your email address and password.');
    }

    const emailCheck = validateEmail(email, true);
    if (!emailCheck.isValid) {
      throw new Error(emailCheck.error);
    }

    const cleanEmail = email.trim().toLowerCase();

    let res;
    try {
      res = await apiRequest('/admin/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: cleanEmail, password }),
      });
    } catch (err) {
      if (err?.status === 401) throw new Error('Invalid email or password.');
      if (err?.status === 403) throw new Error(err.message || 'This account has been deactivated.');
      // Connectivity failures already carry an actionable message naming the host
      // that timed out (e.g. "Connection timeout (10s) — no response from http://…")
      // — pass it through instead of hiding it behind a generic string.
      if (err?.unreachable || err?.timedOut) {
        throw new Error(err.message);
      }
      throw new Error('Unable to reach the UnityMap server. Check your connection and try again.');
    }

    if (!res?.success || !res?.user || !res?.token) {
      throw new Error('Authentication failed. Please try again.');
    }

    const userObj = {
      ...res.user,
      token: res.token,
      sessionExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };

    this.currentUser = userObj;
    await AsyncStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify(userObj)).catch(() => {});
    this.notify();
    return this.currentUser;
  }

  /**
   * Sign Up (Register new user)
   */
  async register({ firstName, lastName, email, phone, password }) {
    if (!firstName || !email || !password) {
      throw new Error('First name, email address, and password are required.');
    }

    const emailCheck = validateEmail(email, true);
    if (!emailCheck.isValid) {
      throw new Error(emailCheck.error);
    }

    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters long.');
    }

    const cleanEmail = email.trim().toLowerCase();

    let res;
    try {
      res = await apiRequest('/admin/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: (lastName || '').trim(),
          email: cleanEmail,
          phone: (phone || '').trim(),
          password,
        }),
      });
    } catch (err) {
      if (err?.status === 409) throw new Error('An account with this email already exists. Please sign in.');
      if (err?.status === 400) throw new Error(err.message);
      if (err?.unreachable || err?.timedOut) {
        throw new Error(err.message);
      }
      throw new Error('Unable to reach the UnityMap server. Check your connection and try again.');
    }

    if (!res?.success || !res?.user || !res?.token) {
      throw new Error('Registration failed. Please try again.');
    }

    const userObj = {
      ...res.user,
      token: res.token,
      sessionExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };

    this.currentUser = userObj;
    await AsyncStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify(userObj)).catch(() => {});
    this.notify();
    return this.currentUser;
  }

  /**
   * Sign In / Sign Up with Google
   * Automatically creates a new account if the user does not exist in DB
   */
  async loginWithGoogle({ email, firstName, lastName, name, photoUrl, googleId, idToken }) {
    if (!email) {
      throw new Error('Google authentication did not provide a valid email address.');
    }

    const cleanEmail = email.trim().toLowerCase();

    let res;
    try {
      res = await apiRequest('/admin/auth/google', {
        method: 'POST',
        body: JSON.stringify({
          email: cleanEmail,
          firstName: (firstName || '').trim(),
          lastName: (lastName || '').trim(),
          name: (name || '').trim(),
          photoUrl: photoUrl || '',
          googleId: googleId || '',
          idToken: idToken || '',
        }),
      });
    } catch (err) {
      if (err?.status === 403) throw new Error(err.message || 'This account has been deactivated.');
      throw new Error('Unable to reach the UnityMap server. Check your connection and try again.');
    }

    if (!res?.success || !res?.user || !res?.token) {
      throw new Error('Google sign-in failed. Please try again.');
    }

    const userObj = {
      ...res.user,
      token: res.token,
      sessionExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };

    this.currentUser = userObj;
    await AsyncStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify(userObj)).catch(() => {});
    this.notify();
    return this.currentUser;
  }

  /**
   * Log Out: Clears session and notifies all navigators to redirect to Login
   */
  async logout() {
    this.currentUser = null;
    try {
      await AsyncStorage.removeItem(STORAGE_SESSION_KEY);
    } catch (err) {
      if (__DEV__) console.warn('[AuthService] Error clearing session from storage:', err);
    }
    this.notify();
  }

  /**
   * Admin: Get all users directory
   * Throws on failure so the UI can distinguish "empty directory" from "request denied".
   */
  async getUsers() {
    const res = await apiRequest('/admin/auth/users');
    if (res?.success && Array.isArray(res.users)) {
      return res.users;
    }
    throw new Error('Unexpected response loading the user directory.');
  }

  /**
   * Admin: Promote Regular User to Admin
   * Errors propagate — a failed promotion must never render as a success.
   */
  async promoteUser(userId) {
    const res = await apiRequest(`/admin/auth/users/${userId}/promote`, {
      method: 'PATCH',
    });
    if (res?.success) return res.user;
    throw new Error(res?.message || 'Failed to promote user.');
  }

  /**
   * Admin: Demote Admin to Regular User (Guarded)
   */
  async demoteUser(userId) {
    const res = await apiRequest(`/admin/auth/users/${userId}/demote`, {
      method: 'PATCH',
    });
    if (res?.success) return res.user;
    throw new Error(res?.message || 'Failed to demote user.');
  }
}

export const authService = new AuthService();
export default authService;
