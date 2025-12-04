/**
 * Application constants - centralized magic numbers and configuration values
 */

// CSV Parsing
export const CSV = {
  MAX_OPTIONS_FOR_SINGLE: 50,
  MIN_RESPONDENTS_FOR_SEGMENT: 10,
}

// Sidebar
export const SIDEBAR = {
  MIN_WIDTH: 200,
  MAX_WIDTH: 600,
  DEFAULT_WIDTH: 288,
}

// Heatmap
export const HEATMAP = {
  MIN_COLUMN_WIDTH: 100,
  MAX_COLUMN_WIDTH: 400,
  DEFAULT_FIRST_COLUMN_WIDTH: 150,
  DRAG_OFFSET_X_MIN: -300,
  DRAG_OFFSET_X_MAX: 300,
  DRAG_OFFSET_Y_MIN: -200,
  DRAG_OFFSET_Y_MAX: 200,
  TITLE_DRAG_Y_MAX: 50,
}

// Chart
export const CHART = {
  MIN_WIDTH_PERCENT: 40,
  MAX_WIDTH_PERCENT: 100,
  HEIGHT_OFFSET_MIN: -100,
  HEIGHT_OFFSET_MAX: 300,
  DEFAULT_TOP_OPTIONS: 8,
}

// Default chart colors
export const DEFAULT_CHART_COLORS = [
  '#3A8518',
  '#CED6DE',
  '#E7CB38',
  '#A5CF8E',
  '#717F90',
  '#F1E088',
  '#DAEBD1',
  '#FAF5D7',
]

// Values to exclude from chart options
export const EXCLUDED_OPTION_VALUES = [
  'other',
  'not specified',
  'none of the above',
  'skip',
  'no preference',
  'prefer not to say',
]

/**
 * Check if a value should be excluded from chart display
 */
export function isExcludedValue(value: string): boolean {
  const normalized = value.trim().toLowerCase().replace(/["']/g, '')
  return EXCLUDED_OPTION_VALUES.some(ex => normalized === ex || normalized.includes(ex))
}
