// Heuristic CSV parser tailored for MakerSights OR product-matrix exports.
// Supports 'single' questions stored as a single text column and
// 'multi' questions stored as one-hot binary columns like:
//   [Q1] (multi): Option A, [Q1] (multi): Option B, ...
// Segment columns (Audience, Gender, Country, etc.) are all non-question columns
// except Respondent Id and obvious ids.
import { ParsedCSV, QuestionDef, QuestionOptionColumn } from './types'

const QUESTION_HEADER_RE = /^\[\s*(?:Q)?(\d+)\s*\]\s*(?:\[\(\s*([^)]+?)\s*\)\]|\(\s*([^)]+?)\s*\))\s*(.*)$/i
const LEADING_TRAILING_QUOTES = /^["'](.*)["']$/

const POSSIBLE_ID_COLUMNS = new Set([
  'respondent id', 'respondent_id', 'participant id', 'participant_id',
  'product id', 'style id', 'item id'
])

function norm(s: string) {
  return (s || '').toString().trim().toLowerCase()
}

function stripQuotes(value: string): string {
  if (!value) return value
  let result = value
  if ((result.startsWith('"') && result.endsWith('"')) || (result.startsWith('“') && result.endsWith('”'))) {
    result = result.slice(1, -1)
  }
  if ((result.startsWith("'") && result.endsWith("'"))) {
    result = result.slice(1, -1)
  }
  return result.replace(/""/g, '"').trim()
}

function stripQuestionPrefix(label: string): string {
  if (!label) return label
  return label.replace(/^\s*(?:question\s*)?q?\d+\s*[.\-:·–—]?\s*/i, '').trim()
}

function cleanHeader(header: string): string {
  const trimmed = header.trim()
  const match = trimmed.match(LEADING_TRAILING_QUOTES)
  return match ? match[1].trim() : trimmed
}

function extractBaseAndOption(header: string): { base: string, option?: string } {
  let base = header
  let option: string | undefined
  const lower = header.toLowerCase()
  const isLikelyMulti = lower.includes('(multi')

  if (isLikelyMulti) {
    const quotedOptionRegex = /":\s*"([^"]+)"\s*$/
    const quotedMatch = quotedOptionRegex.exec(header)
    if (quotedMatch && quotedMatch.index !== undefined) {
      option = quotedMatch[1].trim()
      base = header.slice(0, quotedMatch.index).replace(/["\s]+$/, '').trim()
      return { base, option }
    }

    const simpleOptionRegex = /:\s*(.+)$/
    const simpleMatch = simpleOptionRegex.exec(header)
    if (simpleMatch && simpleMatch.index !== undefined) {
      option = simpleMatch[1].replace(/^"|"$/g, '').trim()
      base = header.slice(0, simpleMatch.index).replace(/["\s]+$/, '').trim()
    }
	  }

  const remainder = header.slice(base.length).trim()
  if (!option && remainder) {
    option = stripQuotes(remainder.replace(/^[:\-]/, '').trim())
  }

  return { base: base.trim(), option: option ? stripQuotes(option) : option }
}

function normalizeQuestionType(rawType: string): 'single' | 'multi' {
  const normalized = rawType.trim().toLowerCase()
  if (normalized.includes('multi')) return 'multi'
  return 'single'
}

function parseQuestionHeader(header: string): {
  qid: string
  rawType: string
  questionText: string
  option?: string
} | null {
  const cleaned = cleanHeader(header)
  const { base, option } = extractBaseAndOption(cleaned)
  const match = base.match(QUESTION_HEADER_RE)
  if (!match) return null

  const qid = `Q${match[1]}`
  const rawType = (match[2] || match[3] || '').toLowerCase()
  const questionText = stripQuestionPrefix(stripQuotes((match[4] || '').trim()))

  return { qid, rawType, questionText, option }
}

export function parseCSVToDataset(rows: Record<string, any>[], fileName: string): ParsedCSV {
  if (!rows.length) throw new Error('No rows found in CSV file.')
  
  let columns = Object.keys(rows[0])
  if (!columns.length) throw new Error('No columns found in CSV file.')
  
  // Check for required respondent ID column
  const hasRespondentId = columns.some(c => 
    norm(c) === 'respondent id' || norm(c) === 'respondent_id'
  )
  if (!hasRespondentId) {
    throw new Error('CSV must contain a "Respondent Id" column. Expected header format: [Q#] (type) for questions, or standard column names like "Respondent Id".')
  }

  // Derive audience type from query parameters, if present
  const QUERY_PARAM_COLUMN = 'Query Parameters'
  const AUDIENCE_COLUMN = 'Audience Type'
  const GENDER_COLUMN = 'Gender'
  const AGE_COLUMN = 'Age'
  const hasDirectGenderColumn = columns.some(col => norm(col) === 'gender')
  const hasDirectAgeColumn = columns.some(col => norm(col) === 'age')
  const hasDirectCountryColumn = columns.some(col => norm(col) === 'country')

  // Look for gender as a standalone column or any question containing "gender"
  const genderSource = hasDirectGenderColumn ? null : columns.find(col =>
    /gender/i.test(col)
  )

  // Look for age as a standalone column or as a question
  const ageSource = hasDirectAgeColumn ? null : columns.find(col =>
    /\[\s*\(age\)\s*\]/i.test(col) ||
    /\[.*\]\s*\(single\).*age/i.test(col)
  )

  // Look for country as a standalone column
  const countrySource = hasDirectCountryColumn ? null : columns.find(col =>
    /\[\s*\(country\)\s*\]/i.test(col)
  )

  // Check for Typing Tool column
  const typingToolColumn = columns.find(col => /typing\s*tool/i.test(col))

  if (columns.includes(QUERY_PARAM_COLUMN)) {
    rows.forEach(row => {
      const raw = row[QUERY_PARAM_COLUMN]
      const text = raw ? String(raw).toLowerCase() : ''
      let derived: string | null = null
      if (/"audience"\s*:\s*"panel"/.test(text) || /audience\s*:\s*panel/.test(text)) {
        derived = 'Panel'
      } else if (/"audience"\s*:\s*"crm"/.test(text) || /audience\s*:\s*crm/.test(text)) {
        derived = 'CRM'
      } else {
        derived = ''
      }
      row[AUDIENCE_COLUMN] = derived ?? ''
    })
    if (!columns.includes(AUDIENCE_COLUMN)) {
      columns = [...columns, AUDIENCE_COLUMN]
    }
  }

  // Derive Gender column from gender source if found
  if (hasDirectGenderColumn) {
    // already present, nothing to derive
  } else if (genderSource) {
    rows.forEach(row => {
      const value = stripQuotes(String(row[genderSource] ?? '').trim())
      row[GENDER_COLUMN] = value
    })
    if (!columns.includes(GENDER_COLUMN)) {
      columns = [...columns, GENDER_COLUMN]
    }
  }

  // Derive Age column from age source if found
  const COUNTRY_COLUMN = 'Country'
  if (hasDirectAgeColumn) {
    // already present
  } else if (ageSource) {
    rows.forEach(row => {
      const value = stripQuotes(String(row[ageSource] ?? '').trim())
      row[AGE_COLUMN] = value
    })
    if (!columns.includes(AGE_COLUMN)) {
      columns = [...columns, AGE_COLUMN]
    }
  }

  // Derive Country column from country source if found
  if (hasDirectCountryColumn) {
    // already present
  } else if (countrySource) {
    rows.forEach(row => {
      const value = stripQuotes(String(row[countrySource] ?? '').trim())
      row[COUNTRY_COLUMN] = value
    })
    if (!columns.includes(COUNTRY_COLUMN)) {
      columns = [...columns, COUNTRY_COLUMN]
    }
  }

  // Collect questions
  const qMap = new Map<string, QuestionDef>()
  const segmentCandidateSet = new Set<string>(columns)

  // Track columns that are used for derived segment columns
  const derivedSegmentSources = new Set<string>()
  if (genderSource) derivedSegmentSources.add(genderSource)
  if (ageSource) derivedSegmentSources.add(ageSource)
  if (countrySource) derivedSegmentSources.add(countrySource)

  // For multi-select questions, track options case-insensitively
  // Map<questionKey, Map<normalizedOption, { displayLabel: string, headers: string[] }>>
  const multiOptionMap = new Map<string, Map<string, { displayLabel: string, headers: string[] }>>()

  for (const col of columns) {
    const parsed = parseQuestionHeader(col)
    if (!parsed) continue

    // Skip columns that are used for derived segment columns (e.g., gender/age questions)
    if (derivedSegmentSources.has(col)) {
      segmentCandidateSet.delete(col)
      continue
    }

    const { qid, rawType, questionText, option } = parsed
    const questionType = normalizeQuestionType(rawType)

    // Create a unique key based on QID + question text to handle cases where
    // the same QID is reused for different questions
    const questionKey = `${qid}::${questionText || qid}`

    if (!qMap.has(questionKey)) {
      qMap.set(questionKey, {
        qid,
        label: questionText || qid,
        type: questionType,
        columns: [] as QuestionOptionColumn[],
        level: 'respondent' as const,
      })
    }

    const q = qMap.get(questionKey)!

    if (questionType === 'multi') {
      // Skip if we don't have a valid option (prevents question text from appearing as option)
      if (!option || option === questionText) {
        console.warn(`Skipping multi-select column with no distinct option: ${col}`)
        continue
      }
      const optionLabel = stripQuotes(option)
      const normalizedOption = optionLabel.toLowerCase()

      q.type = 'multi'
      if (questionText) {
        q.label = questionText
      }

      // Track this option case-insensitively
      if (!multiOptionMap.has(questionKey)) {
        multiOptionMap.set(questionKey, new Map())
      }
      const optionsForQ = multiOptionMap.get(questionKey)!

      if (!optionsForQ.has(normalizedOption)) {
        // First occurrence - use this case
        optionsForQ.set(normalizedOption, {
          displayLabel: optionLabel,
          headers: [col]
        })
      } else {
        // Duplicate with different case - add this header to the existing option
        optionsForQ.get(normalizedOption)!.headers.push(col)
      }
    } else {
      q.type = 'single'
      q.label = questionText || q.label || qid
      q.singleSourceColumn = col
    }

    segmentCandidateSet.delete(col)
  }

  // Now build the columns array for multi-select questions from the deduplicated map
  for (const [questionKey, optionsMap] of multiOptionMap.entries()) {
    const q = qMap.get(questionKey)!
    q.columns = Array.from(optionsMap.entries()).map(([normalized, { displayLabel, headers }]) => ({
      header: headers[0], // Use first header as the primary
      optionLabel: displayLabel,
      alternateHeaders: headers.slice(1) // Store additional headers for data lookup
    }))
    console.log(`[DEBUG] Question ${questionKey} has ${q.columns.length} options:`, q.columns.map(c => c.optionLabel))
  }

  if (segmentCandidateSet.has(QUERY_PARAM_COLUMN)) {
    segmentCandidateSet.delete(QUERY_PARAM_COLUMN)
  }

  // If singles found, synthesize options from distinct values (case-insensitive)
  for (const q of qMap.values()) {
    if (q.type === 'single' && q.singleSourceColumn) {
      const valueMap = new Map<string, string>() // lowercase -> original case
      for (const r of rows) {
        const v = r[q.singleSourceColumn]
        if (v !== null && v !== undefined && v !== '') {
          const cleaned = stripQuotes(String(v).trim())
          const normalized = cleaned.toLowerCase()
          // Keep the first occurrence's case
          if (!valueMap.has(normalized)) {
            valueMap.set(normalized, cleaned)
          }
        }
      }
      const uniqueValues = Array.from(valueMap.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      q.columns = uniqueValues.map(v => ({
        header: `__SINGLE__${q.qid}__${v}`,
        optionLabel: String(v),
      }))

      // Validate that we found some options
      if (q.columns.length === 0) {
        console.warn(`No valid options found for single-select question ${q.qid}`)
      }
    }
  }

  // Heuristic: mark product-level questions if product id column exists (fallback row-level for calc if chosen)
  const lowerCols = columns.map(norm)
  const hasProductId = lowerCols.some(c => c.includes('product') && c.includes('id')) || lowerCols.includes('style')
  if (hasProductId) {
    for (const q of qMap.values()) {
      // leave respondent by default but hint at possible row-level
      q.level = 'respondent'
    }
  }

  // Identify segment columns: remove id-ish and question columns
  for (const col of columns) {
    const n = norm(col)
    if (POSSIBLE_ID_COLUMNS.has(n)) segmentCandidateSet.delete(col)
  }
  for (const q of qMap.values()) {
    if (q.type === 'multi') {
      for (const c of q.columns) {
        segmentCandidateSet.delete(c.header)
        // Also delete alternate headers from segment candidates
        if (c.alternateHeaders) {
          c.alternateHeaders.forEach(h => segmentCandidateSet.delete(h))
        }
      }
    } else if (q.type === 'single' && q.singleSourceColumn) {
      segmentCandidateSet.delete(q.singleSourceColumn)
    }
  }

  // Build segment columns in preferred order
  const segmentColumns = ['Overall']

  // Add Country if it was found or derived
  if (countrySource || hasDirectCountryColumn) {
    segmentColumns.push(COUNTRY_COLUMN)
  }

  // Add Gender if it was found or derived
  if (genderSource || hasDirectGenderColumn) {
    segmentColumns.push(GENDER_COLUMN)
  }

  // Add Age if it was found or derived
  if (ageSource || hasDirectAgeColumn) {
    segmentColumns.push(AGE_COLUMN)
  }

  // Add Audience Type if it was derived from Query Parameters
  if (columns.includes(AUDIENCE_COLUMN)) {
    segmentColumns.push(AUDIENCE_COLUMN)
  }

  // Add Typing Tool if it exists
  if (typingToolColumn) {
    segmentColumns.push(typingToolColumn)
  }

  console.log('[CSV Parser] Country source found:', countrySource || hasDirectCountryColumn || 'none')
  console.log('[CSV Parser] Gender source found:', genderSource || hasDirectGenderColumn || 'none')
  console.log('[CSV Parser] Age source found:', ageSource || hasDirectAgeColumn || 'none')
  console.log('[CSV Parser] Audience Type found:', columns.includes(AUDIENCE_COLUMN))
  console.log('[CSV Parser] Typing Tool column found:', typingToolColumn || 'none')
  console.log('[CSV Parser] Final segment columns:', segmentColumns)

  // Build summary
  const respIdCol = columns.find(c => norm(c) === 'respondent id' || norm(c) === 'respondent_id') || columns[0]
  const uniqueRespondents = new Set<string>()
  for (const r of rows) {
    uniqueRespondents.add(String(r[respIdCol]))
  }

  const questions = Array.from(qMap.values())

  // Validate that we found at least one question
  if (questions.length === 0) {
    throw new Error('No questions detected in CSV. Expected headers like "[Q1] (single) Question Text" or "[Q1] (multi): Option A".')
  }

  // Detect if this is a product test (has product/style ID columns)
  const isProductTest = lowerCols.some(c => 
    (c.includes('product') && c.includes('id')) || 
    c.includes('style') || 
    c.includes('item')
  )

  return {
    rows,
    questions,
    segmentColumns,
    summary: {
      fileName,
      rowCount: rows.length,
      uniqueRespondents: uniqueRespondents.size,
      columns,
      isProductTest,
      questionsDetected: questions.length
    }
  }
}
