/**
 * String utility functions shared across the application
 */

/**
 * Strip quotation marks from text (handles straight and curly quotes)
 * Used for normalizing CSV values and display text
 */
export function stripQuotes(value: string): string {
  if (!value) return value
  let result = value
  // Handle straight double quotes
  if ((result.startsWith('"') && result.endsWith('"'))) {
    result = result.slice(1, -1)
  }
  // Handle curly double quotes
  if ((result.startsWith('"') && result.endsWith('"'))) {
    result = result.slice(1, -1)
  }
  // Handle single quotes
  if ((result.startsWith("'") && result.endsWith("'"))) {
    result = result.slice(1, -1)
  }
  // Replace escaped double quotes and trim
  return result.replace(/""/g, '"').trim()
}

/**
 * Strip sentiment prefix from question labels (Advocates: or Detractors:)
 */
export function stripSentimentPrefix(text: string): string {
  if (!text) return text
  return text.replace(/^(advocates|detractors):\s*/i, '').trim()
}

/**
 * Normalize a product value for consistent comparison
 */
export function normalizeProductValue(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value).trim()
  const unquoted = str.replace(/^"|"$/g, '')
  return unquoted || 'Unspecified'
}
