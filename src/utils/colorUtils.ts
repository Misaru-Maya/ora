/**
 * Color utility functions and palettes shared across the application
 */

/**
 * Determine optimal text color based on background luminance (WCAG compliant)
 * Returns white for dark backgrounds, dark gray for light backgrounds
 */
export function getContrastTextColor(hexColor: string): string {
  // Remove # if present
  const hex = hexColor.replace('#', '')

  // Convert hex to RGB
  const r = parseInt(hex.substring(0, 2), 16) / 255
  const g = parseInt(hex.substring(2, 4), 16) / 255
  const b = parseInt(hex.substring(4, 6), 16) / 255

  // Apply gamma correction
  const rLinear = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4)
  const gLinear = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4)
  const bLinear = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4)

  // Calculate relative luminance using WCAG formula
  const luminance = 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear

  // Return white for dark backgrounds, black for light backgrounds
  return luminance > 0.5 ? '#111111' : '#FFFFFF'
}

/**
 * Green color palette for positive sentiment / advocates (ordered darkest to lightest)
 */
export const GREEN_PALETTE = {
  s40: '#3A8518', // Darkest green for largest values
  s30: '#5A8C40',
  s20: '#6FA84D',
  s10: '#82BC62',
  t10: '#A5CF8E',
  t20: '#C8E2BA',
  t40: '#DAEBD1',
  t60: '#F5FFF5',
  t80: '#FFFFFF', // Lightest green/white for smallest values
}

/**
 * Yellow color palette for negative sentiment / detractors (ordered darkest to lightest)
 */
export const YELLOW_PALETTE = {
  s40: '#D4BA33', // Darkest yellow for largest values
  s30: '#C5B845',
  s20: '#D8C857',
  s10: '#ECD560',
  t10: '#F1E088',
  t20: '#F5EAAF',
  t40: '#FAF5D7',
  t60: '#FFFEF5',
  t80: '#FFFFFF', // Lightest yellow/white for smallest values
}

/**
 * Parse hex color to RGB components
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const cleanHex = hex.replace('#', '')
  return {
    r: parseInt(cleanHex.substring(0, 2), 16),
    g: parseInt(cleanHex.substring(2, 4), 16),
    b: parseInt(cleanHex.substring(4, 6), 16)
  }
}

/**
 * Convert RGB to hex color
 */
function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

/**
 * Interpolate between two colors based on a ratio (0-1)
 */
function interpolateColor(color1: string, color2: string, ratio: number): string {
  const rgb1 = hexToRgb(color1)
  const rgb2 = hexToRgb(color2)

  const r = rgb1.r + (rgb2.r - rgb1.r) * ratio
  const g = rgb1.g + (rgb2.g - rgb1.g) * ratio
  const b = rgb1.b + (rgb2.b - rgb1.b) * ratio

  return rgbToHex(r, g, b)
}

/**
 * Get continuous gradient color based on normalized value (0-100)
 * Interpolates smoothly between palette colors
 */
export function getContinuousGradientColor(
  normalized: number,
  palette: typeof GREEN_PALETTE
): string {
  // Define color stops from lightest (0) to darkest (100)
  const stops = [
    { pos: 0, color: palette.t60 },
    { pos: 14.3, color: palette.t40 },
    { pos: 28.6, color: palette.t20 },
    { pos: 42.9, color: palette.t10 },
    { pos: 57.1, color: palette.s10 },
    { pos: 71.4, color: palette.s20 },
    { pos: 85.7, color: palette.s30 },
    { pos: 100, color: palette.s40 }
  ]

  // Clamp normalized value
  const clampedValue = Math.max(0, Math.min(100, normalized))

  // Find the two stops to interpolate between
  let lowerStop = stops[0]
  let upperStop = stops[stops.length - 1]

  for (let i = 0; i < stops.length - 1; i++) {
    if (clampedValue >= stops[i].pos && clampedValue <= stops[i + 1].pos) {
      lowerStop = stops[i]
      upperStop = stops[i + 1]
      break
    }
  }

  // Calculate interpolation ratio between the two stops
  const range = upperStop.pos - lowerStop.pos
  const ratio = range > 0 ? (clampedValue - lowerStop.pos) / range : 0

  return interpolateColor(lowerStop.color, upperStop.color, ratio)
}

/**
 * Get background and text color for a heatmap cell based on value and sentiment
 * Uses continuous gradient for smooth color transitions
 */
export function getHeatmapColor(
  value: number,
  sentiment: 'positive' | 'negative' | 'advocate' | 'detractor',
  minVal: number,
  maxVal: number
): { bg: string; text: string } {
  const isPositive = sentiment === 'positive' || sentiment === 'advocate'
  const palette = isPositive ? GREEN_PALETTE : YELLOW_PALETTE

  // Normalize value to 0-100 range based on min/max
  const range = maxVal - minVal
  const normalized = range > 0 ? ((value - minVal) / range) * 100 : 50

  // Get continuous gradient color
  const bgColor = getContinuousGradientColor(normalized, palette)

  // Calculate optimal text color based on background luminance
  const textColor = getContrastTextColor(bgColor)

  return { bg: bgColor, text: textColor }
}
