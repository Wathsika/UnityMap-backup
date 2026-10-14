/**
 * LoginScreen.js
 * Unified Authentication Screen (Sign In & Sign Up)
 *
 * Features:
 * - Premium mobile-first design with white & green theme
 * - Segmented tabs: [ Sign In ] & [ Create Account ]
 * - Professional validation for Email, Name, Phone, and Password
 * - Real-time inline field errors and visual success indicators
 * - Dynamic Password Strength Meter (Weak / Fair / Strong)
 * - Confirm Password field with real-time match verification
 * - Show / hide password visibility toggles
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Feather, AntDesign } from '@expo/vector-icons';
import authService from '../../services/authService';
import googleAuthService from '../../services/googleAuthService';
import GoogleLogo from '../../components/GoogleLogo';
import { useTheme } from '../../theme/ThemeContext';
import { getTextStyle, textProps } from '../../theme/typography';
import {
  validateEmail,
  validateName,
  validatePhone,
  validatePassword,
  calculatePasswordStrength,
  validateConfirmPassword,
} from '../../utils/validation';

// ─── Brand Colors ────────────────────────────────────────────────────────────
const BRAND_GREEN   = '#059669';  // emerald-600
const BRAND_DARK    = '#064E3B';  // emerald-900
const BRAND_MEDIUM  = '#065F46';  // emerald-800
const BRAND_LIGHT   = '#D1FAE5';  // emerald-100
const BRAND_XLIGHT  = '#ECFDF5';  // emerald-50
const ERROR_RED     = '#DC2626';

// ── Helper for border color ──────────────────────────────────────────────────
const getBorderColor = (hasError, isFocused, touched, isValid, isHighContrast) => {
  if (hasError) return isHighContrast ? '#A84800' : ERROR_RED;
  if (isFocused) return isHighContrast ? '#005A91' : BRAND_GREEN;
  if (touched && isValid) return isHighContrast ? '#00795C' : BRAND_GREEN;
  return isHighContrast ? '#000000' : '#E2E8F0';
};

// ── Standalone Field Component (Outside LoginScreen to preserve input focus across keystrokes) ──
const Field = React.memo(({
  label, icon, placeholder, value, onChangeText, onBlur,
  keyboardType, autoCapitalize, secureTextEntry, showToggle,
  onToggleSecure, showIcon, isValid, isTouched, hasValue, error, hint,
  multiline,
}) => {
  const { isHighContrast } = useTheme();
  const [isFocused, setIsFocused] = useState(false);

  const activeBorderColor = getBorderColor(!!error, isFocused, isTouched && hasValue, isValid, isHighContrast);

  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.fieldLabel, isHighContrast && { color: '#000000' }]}>{label}</Text>
      <View style={[
        styles.inputBox,
        { borderColor: activeBorderColor },
        error && styles.inputBoxError,
        error && isHighContrast && { backgroundColor: '#FFFFFF', borderWidth: 2 },
        isFocused && !error && styles.inputBoxFocused,
      ]}>
        {icon && (
          <Feather
            name={icon}
            size={17}
            color={error ? (isHighContrast ? '#A84800' : ERROR_RED) : isFocused ? BRAND_GREEN : '#64748B'}
            style={styles.inputIcon}
          />
        )}
        <TextInput
          style={[
            styles.textInput,
            multiline && { height: 80, textAlignVertical: 'top' },
            isHighContrast && { color: '#000000' },
            Platform.OS === 'web' && { outlineStyle: 'none', outlineWidth: 0, boxShadow: 'none' },
          ]}
          placeholder={placeholder}
          placeholderTextColor={isHighContrast ? '#000000' : '#94A3B8'}
          value={value}
          onChangeText={onChangeText}
          onFocus={() => setIsFocused(true)}
          onBlur={(e) => {
            setIsFocused(false);
            if (onBlur) onBlur(e);
          }}
          keyboardType={keyboardType || 'default'}
          autoCapitalize={autoCapitalize || 'none'}
          secureTextEntry={secureTextEntry}
          autoCorrect={false}
          multiline={multiline}
        />
        {showToggle && (
          <TouchableOpacity
            onPress={onToggleSecure}
            style={styles.eyeBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={secureTextEntry ? 'Show password' : 'Hide password'}
          >
            <Feather name={secureTextEntry ? 'eye' : 'eye-off'} size={17} color="#64748B" />
          </TouchableOpacity>
        )}
        {showIcon && isTouched && hasValue && !showToggle && (
          isValid
            ? <Feather name="check-circle" size={16} color={isHighContrast ? '#00795C' : BRAND_GREEN} />
            : <Feather name="x-circle" size={16} color={isHighContrast ? '#A84800' : ERROR_RED} />
        )}
      </View>
      {error ? (
        <View style={styles.inlineErr}>
          <Feather name="alert-circle" size={11} color={isHighContrast ? '#A84800' : ERROR_RED} style={{ marginRight: 4 }} />
          <Text style={[styles.inlineErrText, isHighContrast && { color: '#A84800' }]}>{error}</Text>
        </View>
      ) : hint ? (
        <Text style={[styles.fieldHint, isHighContrast && { color: '#000000' }]}>{hint}</Text>
      ) : null}
    </View>
  );
});

export const LoginScreen = () => {
  const [authMode, setAuthMode] = useState('login');
  const { palette, borderWidth, isHighContrast } = useTheme();

  // Login Form State
  const [loginEmail, setLoginEmail]       = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginTouched, setLoginTouched]   = useState({ email: false, password: false });

  // Register Form State
  const [firstName, setFirstName]               = useState('');
  const [lastName, setLastName]                 = useState('');
  const [registerEmail, setRegisterEmail]       = useState('');
  const [phone, setPhone]                       = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [confirmPassword, setConfirmPassword]   = useState('');
  const [registerTouched, setRegisterTouched]   = useState({
    firstName: false, lastName: false, email: false,
    phone: false, password: false, confirmPassword: false,
  });

  // UI State
  const [showPassword, setShowPassword]             = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading]                   = useState(false);
  const [isGoogleLoading, setIsGoogleLoading]       = useState(false);
  const [errorMessage, setErrorMessage]             = useState('');

  // ── Google Authentication Handler ─────────────────────────────────────────
  const handleGoogleAuth = async () => {
    setErrorMessage('');
    setIsGoogleLoading(true);
    try {
      const googleUser = await googleAuthService.signIn();
      if (googleUser) {
        await authService.loginWithGoogle(googleUser);
      }
    } catch (err) {
      if (!err.message?.includes('cancelled')) {
        setErrorMessage(err.message || 'Google authentication could not be completed.');
      }
    } finally {
      setIsGoogleLoading(false);
    }
  };

  // ── Validation calculations ──────────────────────────────────────────────
  const loginEmailValidation    = validateEmail(loginEmail, true);
  const loginPasswordValidation = validatePassword(loginPassword, true);
  const loginEmailError    = loginTouched.email    ? loginEmailValidation.error    : null;
  const loginPasswordError = loginTouched.password ? loginPasswordValidation.error : null;

  const fnValidation              = validateName(firstName, 'First name', true);
  const lnValidation              = validateName(lastName, 'Last name', false);
  const regEmailValidation        = validateEmail(registerEmail, true);
  const phoneValidation           = validatePhone(phone, false);
  const regPasswordValidation     = validatePassword(registerPassword, true);
  const confirmPasswordValidation = validateConfirmPassword(registerPassword, confirmPassword);
  const passwordStrength          = calculatePasswordStrength(registerPassword);

  const fnError              = registerTouched.firstName       ? fnValidation.error              : null;
  const lnError              = registerTouched.lastName        ? lnValidation.error              : null;
  const regEmailError        = registerTouched.email           ? regEmailValidation.error        : null;
  const phoneError           = registerTouched.phone           ? phoneValidation.error           : null;
  const regPasswordError     = registerTouched.password        ? regPasswordValidation.error     : null;
  const confirmPasswordError = registerTouched.confirmPassword ? confirmPasswordValidation.error : null;

  const handleSwitchMode = (mode) => {
    setAuthMode(mode);
    setErrorMessage('');
    setLoginTouched({ email: false, password: false });
    setRegisterTouched({
      firstName: false, lastName: false, email: false,
      phone: false, password: false, confirmPassword: false,
    });
  };

  // ── Submit Handlers ──────────────────────────────────────────────────────
  const handleLogin = async () => {
    setLoginTouched({ email: true, password: true });
    setErrorMessage('');
    if (!loginEmailValidation.isValid || !loginPasswordValidation.isValid) {
      setErrorMessage('Please correct the highlighted errors before signing in.');
      return;
    }
    setIsLoading(true);
    try {
      await authService.login({ email: loginEmail.trim(), password: loginPassword });
    } catch (err) {
      setErrorMessage(err.message || 'Authentication failed. Please check your credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async () => {
    setRegisterTouched({
      firstName: true, lastName: true, email: true,
      phone: true, password: true, confirmPassword: true,
    });
    setErrorMessage('');
    const isFormValid =
      fnValidation.isValid && lnValidation.isValid && regEmailValidation.isValid &&
      phoneValidation.isValid && regPasswordValidation.isValid && confirmPasswordValidation.isValid;
    if (!isFormValid) {
      setErrorMessage('Please correct the highlighted errors before creating your account.');
      return;
    }
    setIsLoading(true);
    try {
      await authService.register({
        firstName: firstName.trim(), lastName: lastName.trim(),
        email: registerEmail.trim(), phone: phone.trim(), password: registerPassword,
      });
    } catch (err) {
      setErrorMessage(err.message || 'Registration failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={BRAND_DARK} />

      {/* ── Top Green Header ──────────────────────────────────────────── */}
      <SafeAreaView style={styles.headerSafe}>
        <View style={styles.header}>
          {/* Decorative circles */}
          <View style={styles.decCircle1} />
          <View style={styles.decCircle2} />

          <View style={styles.headerContent}>
            {/* Logo */}
            <View style={styles.logoWrap}>
              <View style={styles.logoBg}>
                <Feather name="map-pin" size={28} color="#FFFFFF" />
              </View>
            </View>
            <Text style={styles.brandName}>UnityMap</Text>
            <Text style={styles.brandTagline}>Accessible Navigation & City Reporting</Text>

            {/* Tab Switcher inside header */}
            <View style={styles.tabBar}>
              <TouchableOpacity
                style={[styles.tabBtn, authMode === 'login' && styles.tabBtnActive, authMode === 'login' && isHighContrast && { borderWidth: 2, borderColor: '#000000' }]}
                onPress={() => handleSwitchMode('login')}
                activeOpacity={0.8}
                accessibilityRole="tab"
              >
                <Feather name="log-in" size={14} color={authMode === 'login' ? BRAND_DARK : isHighContrast ? '#FFFFFF' : 'rgba(255,255,255,0.7)'} style={{ marginRight: 5 }} />
                <Text style={[styles.tabBtnText, authMode === 'login' && styles.tabBtnTextActive]}>Sign In</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tabBtn, authMode === 'register' && styles.tabBtnActive, authMode === 'register' && isHighContrast && { borderWidth: 2, borderColor: '#000000' }]}
                onPress={() => handleSwitchMode('register')}
                activeOpacity={0.8}
                accessibilityRole="tab"
              >
                <Feather name="user-plus" size={14} color={authMode === 'register' ? BRAND_DARK : isHighContrast ? '#FFFFFF' : 'rgba(255,255,255,0.7)'} style={{ marginRight: 5 }} />
                <Text style={[styles.tabBtnText, authMode === 'register' && styles.tabBtnTextActive]}>Create Account</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </SafeAreaView>

      {/* ── White Form Area ───────────────────────────────────────────── */}
      <View style={styles.formSheet}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
          keyboardVerticalOffset={0}
        >
          {/* ── Sign In: centered non-scroll layout ── */}
          {authMode === 'login' && (
            <View style={styles.loginBody}>
              {!!errorMessage && (
                <View style={[styles.errBanner, isHighContrast && { backgroundColor: palette.errorBg, borderColor: palette.error, borderWidth: 2 }]}>
                  <Feather name="alert-triangle" size={15} color={isHighContrast ? palette.error : ERROR_RED} style={{ marginRight: 8 }} />
                  <Text style={[styles.errBannerText, isHighContrast && { color: palette.error }]}>{errorMessage}</Text>
                </View>
              )}
              <View>
                <Text style={[styles.formHeading, isHighContrast && { color: '#000000' }]}>Welcome back</Text>
                <Text style={[styles.formSubheading, isHighContrast && { color: '#000000' }]}>Sign in to your UnityMap account</Text>

                <Field
                  label="EMAIL ADDRESS *"
                  icon="mail"
                  placeholder="e.g. admin@unitymap.com"
                  value={loginEmail}
                  onChangeText={(v) => { setLoginEmail(v); if (errorMessage) setErrorMessage(''); }}
                  onBlur={() => setLoginTouched((p) => ({ ...p, email: true }))}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  showIcon
                  isValid={loginEmailValidation.isValid}
                  isTouched={loginTouched.email}
                  hasValue={!!loginEmail}
                  error={loginEmailError}
                />

                <Field
                  label="PASSWORD *"
                  icon="lock"
                  placeholder="Enter your password"
                  value={loginPassword}
                  onChangeText={(v) => { setLoginPassword(v); if (errorMessage) setErrorMessage(''); }}
                  onBlur={() => setLoginTouched((p) => ({ ...p, password: true }))}
                  secureTextEntry={!showPassword}
                  showToggle
                  onToggleSecure={() => setShowPassword((p) => !p)}
                  isValid={loginPasswordValidation.isValid}
                  isTouched={loginTouched.password}
                  hasValue={!!loginPassword}
                  error={loginPasswordError}
                />

                {/* Sign In Button */}
                <TouchableOpacity
                  style={[styles.cta, isLoading && styles.ctaDisabled, isHighContrast && { backgroundColor: palette.primary, borderWidth: 2, borderColor: '#000000', shadowOpacity: 0, elevation: 0 }]}
                  onPress={handleLogin}
                  disabled={isLoading}
                  activeOpacity={0.88}
                  accessibilityRole="button"
                >
                  {isLoading ? (
                    <ActivityIndicator color="#FFF" size="small" />
                  ) : (
                    <>
                      <Text style={styles.ctaText}>Sign In</Text>
                      <Feather name="arrow-right" size={18} color="#FFF" style={{ marginLeft: 8 }} />
                    </>
                  )}
                </TouchableOpacity>

                {/* OR Divider */}
                <View style={styles.dividerRow}>
                  <View style={[styles.dividerLine, isHighContrast && { backgroundColor: '#000000', height: 2 }]} />
                  <Text style={[styles.dividerText, isHighContrast && { color: '#000000' }]}>OR CONTINUE WITH</Text>
                  <View style={[styles.dividerLine, isHighContrast && { backgroundColor: '#000000', height: 2 }]} />
                </View>

                {/* Google Sign In Button */}
                <TouchableOpacity
                  style={[styles.googleBtn, (isLoading || isGoogleLoading) && styles.ctaDisabled, isHighContrast && { borderWidth: 2, borderColor: '#000000', shadowOpacity: 0, elevation: 0 }]}
                  onPress={handleGoogleAuth}
                  disabled={isLoading || isGoogleLoading}
                  activeOpacity={0.88}
                  accessibilityRole="button"
                >
                  {isGoogleLoading ? (
                    <ActivityIndicator color="#0F172A" size="small" />
                  ) : (
                    <>
                      <GoogleLogo size={20} style={{ marginRight: 10 }} />
                      <Text style={[styles.googleBtnText, isHighContrast && { color: '#000000' }]}>Sign in with Google</Text>
                    </>
                  )}
                </TouchableOpacity>

                {/* Switch to Register */}
                <View style={styles.switchRow}>
                  <Text style={[styles.switchText, isHighContrast && { color: '#000000' }]}>Don't have an account? </Text>
                  <TouchableOpacity onPress={() => handleSwitchMode('register')} activeOpacity={0.7}>
                    <Text style={[styles.switchLink, isHighContrast && { color: palette.primary }]}>Create one</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}

          {/* ── Sign Up: scrollable layout ── */}
          {authMode === 'register' && (
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={styles.scrollBody}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {!!errorMessage && (
                <View style={[styles.errBanner, isHighContrast && { backgroundColor: palette.errorBg, borderColor: palette.error, borderWidth: 2 }]}>
                  <Feather name="alert-triangle" size={15} color={isHighContrast ? palette.error : ERROR_RED} style={{ marginRight: 8 }} />
                  <Text style={[styles.errBannerText, isHighContrast && { color: palette.error }]}>{errorMessage}</Text>
                </View>
              )}
              <View>
                <Text style={[styles.formHeading, isHighContrast && { color: '#000000' }]}>Create your account</Text>
                <Text style={[styles.formSubheading, isHighContrast && { color: '#000000' }]}>Join UnityMap for accessible city navigation</Text>

                {/* First & Last Name row */}
                <View style={styles.nameRow}>
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Field
                      label="FIRST NAME *"
                      placeholder="e.g. Kasun"
                      value={firstName}
                      onChangeText={(v) => { setFirstName(v); if (errorMessage) setErrorMessage(''); }}
                      onBlur={() => setRegisterTouched((p) => ({ ...p, firstName: true }))}
                      autoCapitalize="words"
                      showIcon
                      isValid={fnValidation.isValid}
                      isTouched={registerTouched.firstName}
                      hasValue={!!firstName}
                      error={fnError}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field
                      label="LAST NAME"
                      placeholder="e.g. Silva"
                      value={lastName}
                      onChangeText={(v) => { setLastName(v); if (errorMessage) setErrorMessage(''); }}
                      onBlur={() => setRegisterTouched((p) => ({ ...p, lastName: true }))}
                      autoCapitalize="words"
                      showIcon
                      isValid={lnValidation.isValid}
                      isTouched={registerTouched.lastName}
                      hasValue={!!lastName}
                      error={lnError}
                    />
                  </View>
                </View>

                <Field
                  label="EMAIL ADDRESS *"
                  icon="mail"
                  placeholder="e.g. kasun@example.com"
                  value={registerEmail}
                  onChangeText={(v) => { setRegisterEmail(v); if (errorMessage) setErrorMessage(''); }}
                  onBlur={() => setRegisterTouched((p) => ({ ...p, email: true }))}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  showIcon
                  isValid={regEmailValidation.isValid}
                  isTouched={registerTouched.email}
                  hasValue={!!registerEmail}
                  error={regEmailError}
                  hint="Only letters, numbers, '@' and '.' are accepted."
                />

                <Field
                  label="PHONE NUMBER (OPTIONAL)"
                  icon="phone"
                  placeholder="e.g. 077 123 4567"
                  value={phone}
                  onChangeText={(v) => { setPhone(v); if (errorMessage) setErrorMessage(''); }}
                  onBlur={() => setRegisterTouched((p) => ({ ...p, phone: true }))}
                  keyboardType="phone-pad"
                  showIcon
                  isValid={phoneValidation.isValid}
                  isTouched={registerTouched.phone}
                  hasValue={!!phone}
                  error={phoneError}
                />

                {/* Password with Strength Meter */}
                <Field
                  label="CREATE PASSWORD (MIN 6 CHARACTERS) *"
                  icon="lock"
                  placeholder="Enter secure password"
                  value={registerPassword}
                  onChangeText={(v) => { setRegisterPassword(v); if (errorMessage) setErrorMessage(''); }}
                  onBlur={() => setRegisterTouched((p) => ({ ...p, password: true }))}
                  secureTextEntry={!showPassword}
                  showToggle
                  onToggleSecure={() => setShowPassword((p) => !p)}
                  isValid={regPasswordValidation.isValid}
                  isTouched={registerTouched.password}
                  hasValue={!!registerPassword}
                  error={regPasswordError}
                />

                {/* Password Strength Meter */}
                {!!registerPassword && (
                  <View style={styles.strengthWrap}>
                    <View style={styles.strengthBarRow}>
                      {[25, 65, 100].map((threshold, i) => (
                        <View
                          key={i}
                          style={[
                            styles.strengthSeg,
                            { backgroundColor: passwordStrength.percent >= threshold ? passwordStrength.color : '#E2E8F0' },
                          ]}
                        />
                      ))}
                    </View>
                    <View style={styles.strengthInfoRow}>
                      <Text style={[styles.strengthLabel, { color: passwordStrength.color }]}>
                        {passwordStrength.label}
                      </Text>
                      {passwordStrength.hints.length > 0 && (
                        <Text style={styles.strengthHint}>{passwordStrength.hints[0]}</Text>
                      )}
                    </View>
                  </View>
                )}

                <Field
                  label="CONFIRM PASSWORD *"
                  icon="check-square"
                  placeholder="Re-enter your password"
                  value={confirmPassword}
                  onChangeText={(v) => { setConfirmPassword(v); if (errorMessage) setErrorMessage(''); }}
                  onBlur={() => setRegisterTouched((p) => ({ ...p, confirmPassword: true }))}
                  secureTextEntry={!showConfirmPassword}
                  showToggle
                  onToggleSecure={() => setShowConfirmPassword((p) => !p)}
                  isValid={confirmPasswordValidation.isValid}
                  isTouched={registerTouched.confirmPassword}
                  hasValue={!!confirmPassword}
                  error={confirmPasswordError}
                />

                {/* Passwords match indicator */}
                {!confirmPasswordError && registerTouched.confirmPassword && confirmPassword && confirmPassword === registerPassword && (
                  <View style={styles.matchRow}>
                    <Feather name="check-circle" size={12} color={isHighContrast ? '#00795C' : BRAND_GREEN} style={{ marginRight: 4 }} />
                    <Text style={[styles.matchText, isHighContrast && { color: '#00795C' }]}>Passwords match</Text>
                  </View>
                )}

                {/* Create Account Button */}
                <TouchableOpacity
                  style={[styles.cta, isLoading && styles.ctaDisabled, isHighContrast && { backgroundColor: palette.primary, borderWidth: 2, borderColor: '#000000', shadowOpacity: 0, elevation: 0 }]}
                  onPress={handleRegister}
                  disabled={isLoading}
                  activeOpacity={0.88}
                  accessibilityRole="button"
                >
                  {isLoading ? (
                    <ActivityIndicator color="#FFF" size="small" />
                  ) : (
                    <>
                      <Text style={styles.ctaText}>Create Account</Text>
                      <Feather name="check" size={18} color="#FFF" style={{ marginLeft: 8 }} />
                    </>
                  )}
                </TouchableOpacity>

                {/* OR Divider */}
                <View style={styles.dividerRow}>
                  <View style={[styles.dividerLine, isHighContrast && { backgroundColor: '#000000', height: 2 }]} />
                  <Text style={[styles.dividerText, isHighContrast && { color: '#000000' }]}>OR CONTINUE WITH</Text>
                  <View style={[styles.dividerLine, isHighContrast && { backgroundColor: '#000000', height: 2 }]} />
                </View>

                {/* Google Sign Up Button */}
                <TouchableOpacity
                  style={[styles.googleBtn, (isLoading || isGoogleLoading) && styles.ctaDisabled, isHighContrast && { borderWidth: 2, borderColor: '#000000', shadowOpacity: 0, elevation: 0 }]}
                  onPress={handleGoogleAuth}
                  disabled={isLoading || isGoogleLoading}
                  activeOpacity={0.88}
                  accessibilityRole="button"
                >
                  {isGoogleLoading ? (
                    <ActivityIndicator color="#0F172A" size="small" />
                  ) : (
                    <>
                      <GoogleLogo size={20} style={{ marginRight: 10 }} />
                      <Text style={[styles.googleBtnText, isHighContrast && { color: '#000000' }]}>Sign up with Google</Text>
                    </>
                  )}
                </TouchableOpacity>

                {/* Switch to Login */}
                <View style={styles.switchRow}>
                  <Text style={[styles.switchText, isHighContrast && { color: '#000000' }]}>Already have an account? </Text>
                  <TouchableOpacity onPress={() => handleSwitchMode('login')} activeOpacity={0.7}>
                    <Text style={[styles.switchLink, isHighContrast && { color: palette.primary }]}>Sign In</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      </View>
    </View>
  );
};

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BRAND_DARK,
  },

  // ── Header ────────────────────────────────────────────────────────────────
  headerSafe: {
    backgroundColor: BRAND_DARK,
  },
  header: {
    backgroundColor: BRAND_DARK,
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: 28,
    overflow: 'hidden',
  },
  // decorative accent circles
  decCircle1: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: 'rgba(255,255,255,0.05)',
    top: -60,
    right: -40,
  },
  decCircle2: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255,255,255,0.04)',
    bottom: 10,
    left: -30,
  },
  headerContent: {
    alignItems: 'center',
  },
  logoWrap: {
    marginBottom: 10,
  },
  logoBg: {
    width: 60,
    height: 60,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  brandName: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  brandTagline: {
    fontSize: 12,
    color: '#A7F3D0',
    marginBottom: 20,
    textAlign: 'center',
  },

  // ── Tab Bar ───────────────────────────────────────────────────────────────
  tabBar: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 14,
    padding: 4,
    width: '100%',
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 11,
  },
  tabBtnActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 3,
  },
  tabBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.75)',
  },
  tabBtnTextActive: {
    color: BRAND_DARK,
  },

  // ── White Form Sheet ──────────────────────────────────────────────────────
  formSheet: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  loginBody: {
    flex: 1,
    paddingHorizontal: 22,
    paddingTop: 28,
    paddingBottom: 24,
  },
  scrollBody: {
    flexGrow: 1,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 32,
  },
  loginCenterWrapper: {
    flex: 1,
    justifyContent: 'center',
  },

  // ── Form Heading ──────────────────────────────────────────────────────────
  formHeading: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 4,
  },
  formSubheading: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 20,
  },

  // ── Error Banner ──────────────────────────────────────────────────────────
  errBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
  },
  errBannerText: {
    flex: 1,
    fontSize: 13,
    color: ERROR_RED,
    lineHeight: 18,
  },

  // ── Name Row ──────────────────────────────────────────────────────────────
  nameRow: {
    flexDirection: 'row',
  },

  // ── Field ─────────────────────────────────────────────────────────────────
  fieldGroup: {
    marginBottom: 14,
  },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    minHeight: 48,
    ...(Platform.OS === 'web'
      ? {
          outlineStyle: 'none',
          outlineWidth: 0,
          boxShadow: 'none',
        }
      : {}),
  },
  inputBoxFocused: {
    borderColor: BRAND_GREEN,
    backgroundColor: '#FFFFFF',
  },
  inputBoxError: {
    borderColor: ERROR_RED,
    backgroundColor: '#FFF5F5',
  },
  inputIcon: {
    marginRight: 10,
  },
  textInput: {
    flex: 1,
    fontSize: 14,
    color: '#0F172A',
    paddingVertical: 10,
    ...(Platform.OS === 'web'
      ? {
          outlineStyle: 'none',
          outlineWidth: 0,
          boxShadow: 'none',
        }
      : {}),
  },
  eyeBtn: {
    padding: 6,
  },
  inlineErr: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 5,
    marginLeft: 2,
  },
  inlineErrText: {
    fontSize: 11,
    color: ERROR_RED,
    fontWeight: '500',
    flex: 1,
  },
  fieldHint: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 4,
    marginLeft: 2,
  },

  // ── Password Strength ──────────────────────────────────────────────────────
  strengthWrap: {
    marginTop: -6,
    marginBottom: 14,
  },
  strengthBarRow: {
    flexDirection: 'row',
    gap: 4,
    height: 4,
  },
  strengthSeg: {
    flex: 1,
    borderRadius: 2,
  },
  strengthInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  strengthLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  strengthHint: {
    fontSize: 11,
    color: '#94A3B8',
  },

  // ── Passwords Match ────────────────────────────────────────────────────────
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: -8,
    marginBottom: 14,
    marginLeft: 2,
  },
  matchText: {
    fontSize: 11,
    color: BRAND_GREEN,
    fontWeight: '600',
  },

  // ── CTA Button ────────────────────────────────────────────────────────────
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BRAND_GREEN,
    borderRadius: 14,
    minHeight: 52,
    marginTop: 8,
    shadowColor: BRAND_GREEN,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  ctaDisabled: {
    opacity: 0.65,
  },
  ctaText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },

  // ── Divider ───────────────────────────────────────────────────────────────
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 14,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E2E8F0',
  },
  dividerText: {
    paddingHorizontal: 10,
    fontSize: 10,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.8,
  },

  // ── Google Button ─────────────────────────────────────────────────────────
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    minHeight: 50,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  googleBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E293B',
    letterSpacing: 0.2,
  },

  // ── Switch Mode ───────────────────────────────────────────────────────────
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },
  switchText: {
    fontSize: 13,
    color: '#94A3B8',
  },
  switchLink: {
    fontSize: 13,
    fontWeight: '700',
    color: BRAND_GREEN,
  },
});

export default LoginScreen;
