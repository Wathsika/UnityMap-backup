/**
 * Typography scale — SPT-005
 * Accessible type: xs→2xl with allowFontScaling support.
 * Use maxFontSizeMultiplier to cap layout breakage.
 */
export const scale = {
  xs: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  sm: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
  base: { fontSize: 16, lineHeight: 24, fontWeight: '600' },
  lg: { fontSize: 18, lineHeight: 28, fontWeight: '600' },
  xl: { fontSize: 20, lineHeight: 28, fontWeight: '700' },
  '2xl': { fontSize: 24, lineHeight: 32, fontWeight: '700' },
};

export const getTextStyle = (variant = 'base', { isHighContrast = false } = {}) => {
  const base = scale[variant] || scale.base;
  return {
    fontSize: base.fontSize,
    lineHeight: base.lineHeight,
    fontWeight: base.fontWeight,
    // High-contrast enforces bolder weight for readability
    ...(isHighContrast ? { fontWeight: '700' } : null),
  };
};

export const textProps = {
  allowFontScaling: true,
  maxFontSizeMultiplier: 1.4,
};

export default { scale, getTextStyle, textProps };
