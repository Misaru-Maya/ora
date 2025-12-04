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
 * Get background and text color for a heatmap cell based on value and sentiment
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

  // Map to palette buckets (larger values = darker colors, smaller values = lighter colors)
  let bgColor: string
  if (normalized >= 87.5) bgColor = palette.s40  // Largest values - darkest
  else if (normalized >= 75) bgColor = palette.s30
  else if (normalized >= 62.5) bgColor = palette.s20
  else if (normalized >= 50) bgColor = palette.s10
  else if (normalized >= 37.5) bgColor = palette.t10
  else if (normalized >= 25) bgColor = palette.t20
  else if (normalized >= 12.5) bgColor = palette.t40
  else if (normalized >= 0) bgColor = palette.t60
  else bgColor = palette.t80  // Smallest values - lightest

  // Calculate optimal text color based on background luminance
  const textColor = getContrastTextColor(bgColor)

  return { bg: bgColor, text: textColor }
}
