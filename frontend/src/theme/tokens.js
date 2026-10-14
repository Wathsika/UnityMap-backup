/**
 * UnityMap Design Tokens — SPT-005
 * Light + High-Contrast palettes, spacing, radius, borders, focus.
 * WCAG: light 4.5:1, high-contrast 7:1 with 2px borders + focus ring.
 * High-contrast semantic accents use darkened Okabe-Ito hues (CVD-safe):
 * vermillion (error), bluish-green (success), amber (warning), blue (info/primary).
 */

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
};

export const radius = {
  sm: 8,
  md: 10,
  lg: 12,
  xl: 16,
  pill: 999,
};

export const palettes = {
  light: {
    background: '#F8FAFC',
    surface: '#FFFFFF',
    surfaceAlt: '#F3F4F6',
    textPrimary: '#0F172A',
    textSecondary: '#334155',
    textMuted: '#6B7280',
    primary: '#0B3D2E',
    primaryText: '#FFFFFF',
    secondaryBg: '#F3F4F6',
    secondaryText: '#0F172A',
    secondaryBorder: '#D1D5DB',
    border: '#E5E7EB',
    borderStrong: '#CBD5E1',
    placeholder: '#6B7280',
    error: '#B91C1C',
    errorBg: '#FEF2F2',
    success: '#047857',
    successBg: '#ECFDF5',
    warning: '#B45309',
    warningBg: '#FFFBEB',
    info: '#0369A1',
    infoBg: '#F0F9FF',
    focusRing: '#FFD400',
    cardBorder: '#E5E7EB',
  },
  highContrast: {
    background: '#FFFFFF',
    surface: '#FFFFFF',
    surfaceAlt: '#000000',
    textPrimary: '#000000',
    textSecondary: '#000000',
    textMuted: '#000000',
    primary: '#005A91',
    primaryText: '#FFFFFF',
    secondaryBg: '#FFFFFF',
    secondaryText: '#000000',
    secondaryBorder: '#000000',
    border: '#000000',
    borderStrong: '#000000',
    placeholder: '#000000',
    error: '#A84800',
    errorBg: '#FFFFFF',
    success: '#00795C',
    successBg: '#FFFFFF',
    warning: '#8A6100',
    warningBg: '#FFFFFF',
    info: '#0069A8',
    infoBg: '#FFFFFF',
    focusRing: '#FFD400',
    cardBorder: '#000000',
  },
};

export const borders = {
  light: 1,
  highContrast: 2,
};

export const elevation = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  cardHighContrast: {
    shadowOpacity: 0,
    elevation: 0,
  },
};

export const getPalette = (isHighContrast) => (isHighContrast ? palettes.highContrast : palettes.light);
export const getBorderWidth = (isHighContrast) => (isHighContrast ? borders.highContrast : borders.light);

export default { spacing, radius, palettes, borders, elevation, getPalette, getBorderWidth };
