// Heuristic CSV parser tailored for MakerSights OR product-matrix exports.
// Supports 'single' questions stored as a single text column and
// 'multi' questions stored as one-hot binary columns like:
//   [Q1] (multi): Option A, [Q1] (multi): Option B, ...
// Segment columns (Audience, Gender, Country, etc.) are all non-question columns
// except Respondent Id and obvious ids.
import type { ParsedCSV, QuestionDef, QuestionOptionColumn } from './types'
import { stripQuotes } from './utils'

// Performance: Disable console logs in production
const isDev = process.env.NODE_ENV === 'development'
const devLog = isDev ? console.log : () => {}
const devWarn = isDev ? console.warn : () => {}

// Format B: [Q1] [(type)] Question text  OR  [1] (type) Question text
const QUESTION_HEADER_RE = /^\[\s*(?:Q)?(\d+)\s*\]\s*(?:\[\(\s*([^)]+?)\s*\)\]|\(\s*([^)]+?)\s*\))\s*(.*)$/i

// Format A: "0 multi: Question text" OR "1: Question text" (Respondent_data format)
const FORMAT_A_HEADER_RE = /^(\d+)\s*(multi)?:\s*(.+)$/i

const POSSIBLE_ID_COLUMNS = new Set([
  'respondent id', 'respondent_id', 'participant id', 'participant_id',
  'product id', 'style id', 'item id'
])

function norm(s: string) {
  return (s || '').toString().trim().toLowerCase()
}

function stripQuestionPrefix(label: string): string {
  if (!label) return label
  return label.replace(/^\s*(?:question\s*)?q?\d+\s*[.\-:·–—]?\s*/i, '').trim()
}

function cleanHeader(header: string): string {
  let result = header.trim()
  // Remove multiple layers of quotes (some CSV exports have triple quotes)
  while ((result.startsWith('"') && result.endsWith('"')) ||
         (result.startsWith("'") && result.endsWith("'"))) {
    result = result.slice(1, -1).trim()
  }
  // Also handle escaped double quotes within the string
  result = result.replace(/""/g, '"')
  return result
}

function extractBaseAndOption(header: string): { base: string, option?: string } {
  let base = header
  let option: string | undefined
  const lower = header.toLowerCase()
  const isLikelyMulti = lower.includes('(multi') || lower.includes('(ranking')

  if (isLikelyMulti) {
    // Pattern 1: "Question? ": "Option" or Question? ": "Option"
    // Handles: [3] [(multi)] Which brands...? ": "Lululemon"
    const quotedOptionRegex = /[?!.]\s*"?:\s*"([^"]+)"?\s*$/
    const quotedMatch = quotedOptionRegex.exec(header)
    if (quotedMatch && quotedMatch.index !== undefined) {
      option = quotedMatch[1].trim()
      // Keep the question mark but remove the ": "Option" part
      base = header.slice(0, quotedMatch.index + 1).replace(/["\s]+$/, '').trim()
      return { base, option }
    }

    // Pattern 2: Question ": "Option" (no question mark)
    const colonQuoteRegex = /\s*"?:\s*"([^"]+)"?\s*$/
    const colonQuoteMatch = colonQuoteRegex.exec(header)
    if (colonQuoteMatch && colonQuoteMatch.index !== undefined) {
      option = colonQuoteMatch[1].trim()
      base = header.slice(0, colonQuoteMatch.index).replace(/["\s]+$/, '').trim()
      return { base, option }
    }

    // Pattern 3: For ranking/multi questions with format: "...Example: text... : Option"
    // Find the LAST colon that precedes the option value
    // But exclude colons that are part of "Example:" explanatory text
    const lastColonIndex = header.lastIndexOf(' : ')
    if (lastColonIndex > 0) {
      const afterColon = header.slice(lastColonIndex + 3).trim()
      // Check if there's actual content after the colon (the option)
      // Skip if it starts with numbers (like "1 = most preferred") which indicates it's part of the example text
      if (afterColon && !afterColon.match(/^\d+\s*=/)) {
        option = afterColon
          .replace(/^["'""']+/, '')  // Remove leading quotes
          .replace(/["'""']+$/, '')  // Remove trailing quotes
          .trim()
        base = header.slice(0, lastColonIndex).replace(/["\s]+$/, '').trim()
        return { base, option }
      }
    }
  }

  const remainder = header.slice(base.length).trim()
  if (!option && remainder) {
    option = stripQuotes(remainder.replace(/^[:\-]/, '').trim())
  }

  return { base: base.trim(), option: option ? stripQuotes(option) : option }
}

function normalizeQuestionType(rawType: string): 'single' | 'multi' | 'ranking' | 'text' {
  const normalized = rawType.trim().toLowerCase()
  if (normalized.includes('multi')) return 'multi'
  if (normalized.includes('ranking')) return 'ranking'
  if (normalized.includes('text')) return 'text'  // Open-ended text questions
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

  // Try Format B first: [Q1] [(type)] Question text
  const matchB = base.match(QUESTION_HEADER_RE)
  if (matchB) {
    const qid = `Q${matchB[1]}`
    const rawType = (matchB[2] || matchB[3] || '').toLowerCase()
    const questionText = stripQuestionPrefix(stripQuotes((matchB[4] || '').trim()))
    return { qid, rawType, questionText, option }
  }

  // Try Format A: "0 multi: Question text" OR "1: Question text"
  const matchA = base.match(FORMAT_A_HEADER_RE)
  if (matchA) {
    const qNum = parseInt(matchA[1], 10)
    const qid = `Q${matchA[1]}`
    const rawType = (matchA[2] || 'single').toLowerCase() // Default to 'single' if no 'multi' keyword
    let questionText = stripQuestionPrefix(stripQuotes((matchA[3] || '').trim()))

    // For multi-select questions in Format A, even indices = Positive, odd indices = Negative
    // This matches the Format B pattern where (Positive) and (Negative) are explicit
    if (rawType === 'multi') {
      const sentiment = qNum % 2 === 0 ? '(Positive)' : '(Negative)'
      questionText = `${sentiment} ${questionText}`
    }

    return { qid, rawType, questionText, option }
  }

  return null
}

export function parseCSVToDataset(rows: Record<string, any>[], fileName: string): ParsedCSV {
  devLog('[CSV Parser] Starting CSV parse...')
  if (!rows.length) throw new Error('No rows found in CSV file.')

  let columns = Object.keys(rows[0])
  if (!columns.length) throw new Error('No columns found in CSV file.')
  devLog(`[CSV Parser] Found ${columns.length} columns, ${rows.length} rows`)
  
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
  // Format B: [(gender)] or question containing "gender"
  // Format A: "1: What's your gender?" or similar
  const genderSource = hasDirectGenderColumn ? null : columns.find(col =>
    /\[\s*\(gender\)\s*\]/i.test(col) ||
    /what['']?s your gender/i.test(col) ||
    /your gender/i.test(col)
  )

  // Look for age as a standalone column or as a question
  // Format B: [(age)] or question containing "born"/"age"
  // Format A: "2: When were you born?" or similar
  const ageSource = hasDirectAgeColumn ? null : columns.find(col =>
    /\[\s*\(age\)\s*\]/i.test(col) ||
    /when were you born/i.test(col) ||
    /what year were you born/i.test(col) ||
    /how old are you/i.test(col)
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

  // Format A: Handle Answer + Question Title pattern for sentiment
  // In Format A, sentiment is stored as Question Title = "Would you consider buying..." and Answer = "5"
  const ANSWER_COLUMN = 'Answer'
  const QUESTION_TITLE_COLUMN = 'Question Title'
  const SYNTHETIC_SENTIMENT_COLUMN = '[1] [(sentiment)] Would you consider buying this item?'
  const hasFormatAPattern = columns.includes(ANSWER_COLUMN) && columns.includes(QUESTION_TITLE_COLUMN)

  if (hasFormatAPattern) {
    // Check if Question Title contains sentiment-related text
    const hasSentimentQuestion = rows.some(row => {
      const title = String(row[QUESTION_TITLE_COLUMN] || '').toLowerCase()
      return title.includes('would you consider buying') || title.includes('purchase')
    })

    if (hasSentimentQuestion) {
      devLog('[CSV Parser] Format A detected: synthesizing sentiment column from Answer')
      // Create synthetic sentiment column from Answer values
      let valueCount = 0
      rows.forEach(row => {
        const answer = row[ANSWER_COLUMN]
        if (answer !== null && answer !== undefined && answer !== '') {
          // Strip quotes and extract the numeric value
          const cleanAnswer = stripQuotes(String(answer).trim())
          row[SYNTHETIC_SENTIMENT_COLUMN] = cleanAnswer
          valueCount++
        }
      })
      devLog(`[CSV Parser] Synthetic sentiment column: ${valueCount} values added`)

      if (!columns.includes(SYNTHETIC_SENTIMENT_COLUMN)) {
        columns = [...columns, SYNTHETIC_SENTIMENT_COLUMN]
        devLog('[CSV Parser] Added synthetic sentiment column to columns list')
      }
    }
  }

  // Collect questions
  const qMap = new Map<string, QuestionDef>()
  const segmentCandidateSet = new Set<string>(columns)

  // Track columns that are used for derived segment columns OR should be excluded as demographic questions
  const derivedSegmentSources = new Set<string>()
  if (genderSource) derivedSegmentSources.add(genderSource)
  if (ageSource) derivedSegmentSources.add(ageSource)
  if (countrySource) derivedSegmentSources.add(countrySource)

  // Also find and exclude demographic question columns even if direct segment columns exist
  // This handles Format A where both "Gender" column and "1: What's your gender?" question exist
  const demographicQuestionPatterns = [
    /what['']?s your gender/i,
    /your gender/i,
    /when were you born/i,
    /what year were you born/i,
    /how old are you/i
  ]
  columns.forEach(col => {
    if (demographicQuestionPatterns.some(pattern => pattern.test(col))) {
      derivedSegmentSources.add(col)
      devLog(`[CSV Parser] Excluding demographic question column: ${col}`)
    }
  })

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
    const isLikert = rawType.toLowerCase().includes('scale')

    // Skip open-ended text questions - they can't be visualized as charts
    if (questionType === 'text') {
      devLog(`[CSV Parser] Skipping text/open-ended question: ${qid} - "${questionText?.substring(0, 50)}..."`)
      segmentCandidateSet.delete(col)
      continue
    }

    // Use QID + question text as key to differentiate questions with same number but different text
    // This handles cases where the same Q# is reused for different questions (e.g., Positive/Negative variants)
    const questionKey = `${qid}::${questionText || qid}`

    // For the actual qid stored in the object, use a unique suffix if this is a variant question
    // This ensures React keys are unique when rendering
    const uniqueQid = questionText && questionText !== qid
      ? `${qid}_${questionText.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20)}`
      : qid

    if (!qMap.has(questionKey)) {
      qMap.set(questionKey, {
        qid: uniqueQid,
        label: questionText || qid,
        type: questionType,
        columns: [] as QuestionOptionColumn[],
        level: 'respondent' as const,
        isLikert,
      })
    }

    const q = qMap.get(questionKey)!

    if (questionType === 'multi' || questionType === 'ranking') {
      // Check if this is a text summary column (no option suffix, just the question)
      if (!option || option === questionText) {
        // For RANKING questions, skip the text summary column completely
        // We need the individual numeric columns, not the pipe-separated ordered text
        if (questionType === 'ranking') {
          devLog(`[RANKING DEBUG] Skipping BASE column for ${qid}: "${col.substring(0, 80)}..."`)
          segmentCandidateSet.delete(col)
          continue
        }

        // For MULTI questions, check if this is a text summary column
        // Check if this column contains text data (pipe-separated or single values, not binary data)
        // Sample a few rows to determine if it's a text summary column
        let hasTextData = false
        let hasBinaryData = false
        let respondentCount = 0

        for (let i = 0; i < Math.min(100, rows.length); i++) {
          const value = rows[i][col]
          if (value !== null && value !== undefined && value !== '') {
            const strValue = String(value).trim()
            // Check for binary values
            if (strValue === '0' || strValue === '1') {
              hasBinaryData = true
            } else if (strValue.length > 2) {
              // Has text data (either pipe-separated or single option text)
              hasTextData = true
              respondentCount++
            }
          }
        }

        // Only treat as text summary if it has text data (not binary)
        if (hasTextData && !hasBinaryData) {
          q.type = questionType
          q.label = questionText || q.label || qid

          // If there's already a text summary column, keep the one with more data
          if (q.textSummaryColumn) {
            devLog(`[DEBUG] Found another text summary column for ${qid}: ${col} (will evaluate which has more data)`)
          } else {
            q.textSummaryColumn = col
            devLog(`[DEBUG] Found text summary column for ${qid}: ${col}`)
          }

          segmentCandidateSet.delete(col)
          continue
        }

        // If it's not a text summary, skip this column (it's likely a duplicate header without options)
        devWarn(`[DEBUG] Skipping multi-select column with no distinct option and no pipe-separated data: ${col}`)
        segmentCandidateSet.delete(col)
        continue
      }

      const optionLabel = stripQuotes(option)
      const normalizedOption = optionLabel.toLowerCase()

      q.type = questionType
      if (questionText) {
        q.label = questionText
      }

      // Log ranking option processing
      if (questionType === 'ranking') {
        devLog(`[RANKING DEBUG] Processing option for ${qid}: "${optionLabel}"`)
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

  // Now build the columns array for multi-select and ranking questions from the deduplicated map
  for (const [questionKey, optionsMap] of multiOptionMap.entries()) {
    const q = qMap.get(questionKey)!
    q.columns = Array.from(optionsMap.entries()).map(([_normalized, { displayLabel, headers }]) => ({
      header: headers[0], // Use first header as the primary
      optionLabel: displayLabel,
      alternateHeaders: headers.slice(1) // Store additional headers for data lookup
    }))
    const logType = q.type === 'ranking' ? '[RANKING DEBUG]' : '[DEBUG]'
    devLog(`${logType} Question ${questionKey} has ${q.columns.length} options:`, q.columns.map(c => c.optionLabel))
  }

  // For multi-select questions with text summary columns, extract options from the pipe-separated values
  // Note: Ranking questions should NOT use text summary columns
  for (const q of qMap.values()) {
    if (q.type === 'multi' && q.textSummaryColumn) {
      devLog(`[DEBUG] Processing text summary column for ${q.qid}: ${q.textSummaryColumn}`)
      const optionSet = new Map<string, string>() // normalized -> display label

      // Extract all unique options from the text summary column
      for (const row of rows) {
        const textValue = row[q.textSummaryColumn]
        if (!textValue || textValue === '') continue

        const cleanedValue = stripQuotes(String(textValue).trim())

        // Split by pipe if present, otherwise treat as single option
        const options = cleanedValue.includes('|')
          ? cleanedValue.split('|').map(opt => stripQuotes(opt.trim())).filter(Boolean)
          : [cleanedValue]

        for (const opt of options) {
          const normalized = opt.toLowerCase()
          if (!optionSet.has(normalized)) {
            optionSet.set(normalized, opt)
          }
        }
      }

      // Build columns from the text summary options
      // Use the options from text summary only if there are no binary columns, or if text has more respondents
      const textOptions = Array.from(optionSet.entries()).map(([_normalized, displayLabel]) => ({
        header: `__TEXT_MULTI__${q.qid}__${displayLabel}`,
        optionLabel: displayLabel
      }))

      // Only use text summary options when binary columns don't exist
      // Binary columns (0/1 values) are more reliable for filtering
      if (textOptions.length > 0 && q.columns.length === 0) {
        q.columns = textOptions
        devLog(`[DEBUG] Using ${textOptions.length} options from text summary for ${q.qid}:`, textOptions.map(c => c.optionLabel))
      } else if (q.columns.length > 0) {
        devLog(`[DEBUG] Keeping ${q.columns.length} binary columns for ${q.qid}, ignoring text summary`)
      }
    }
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

      // Heuristic: If a "single" question has too many unique values, it's likely an open-ended text question
      // Text questions typically have unique responses per respondent, making them unsuitable for visualization
      const MAX_OPTIONS_FOR_SINGLE = 50  // Threshold for detecting text questions
      if (uniqueValues.length > MAX_OPTIONS_FOR_SINGLE) {
        devLog(`[CSV Parser] Skipping likely text question (${uniqueValues.length} unique values): ${q.qid} - "${q.label?.substring(0, 50)}..."`)
        // Mark for removal by setting columns to empty
        q.columns = []
        continue
      }

      q.columns = uniqueValues.map(v => ({
        header: `__SINGLE__${q.qid}__${v}`,
        optionLabel: String(v),
      }))

      // Validate that we found some options
      if (q.columns.length === 0) {
        devWarn(`No valid options found for single-select question ${q.qid}`)
      }
    }
  }

  // Heuristic: mark product-level questions if product id column exists
  const lowerCols = columns.map(norm)
  const hasProductId = lowerCols.some(c => c.includes('product') && c.includes('id')) || lowerCols.includes('style')
  if (hasProductId) {
    for (const q of qMap.values()) {
      // Mark as row-level for product tests
      q.level = 'row'
    }
  }

  // Identify segment columns: remove id-ish and question columns
  for (const col of columns) {
    const n = norm(col)
    if (POSSIBLE_ID_COLUMNS.has(n)) segmentCandidateSet.delete(col)
  }
  for (const q of qMap.values()) {
    if (q.type === 'multi' || q.type === 'ranking') {
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

  // Add Product Preference segment based on sentiment question (before Gender)
  const PRODUCT_PREFERENCE_COLUMN = 'Product Preference'
  const sentimentColumn = columns.find(col =>
    col.toLowerCase().includes('(sentiment)')
  )

  if (sentimentColumn) {
    // Add synthetic Product Preference column to each row
    rows.forEach(row => {
      const rating = row[sentimentColumn]
      let numericRating: number

      if (typeof rating === 'number') {
        numericRating = rating
      } else {
        // Extract numeric value from strings like "4 - Probably" or "5"
        const stringRating = String(rating).trim()
        const match = stringRating.match(/^(\d+)/)
        numericRating = match ? Number(match[1]) : Number(stringRating)
      }

      if (Number.isFinite(numericRating)) {
        if (numericRating >= 4) {
          row[PRODUCT_PREFERENCE_COLUMN] = 'Advocates'
        } else if (numericRating <= 3) {
          row[PRODUCT_PREFERENCE_COLUMN] = 'Detractors'
        } else {
          row[PRODUCT_PREFERENCE_COLUMN] = ''
        }
      } else {
        row[PRODUCT_PREFERENCE_COLUMN] = ''
      }
    })

    // Add Product Preference to segment columns
    segmentColumns.push(PRODUCT_PREFERENCE_COLUMN)

    // Add to columns list
    if (!columns.includes(PRODUCT_PREFERENCE_COLUMN)) {
      columns = [...columns, PRODUCT_PREFERENCE_COLUMN]
    }

    devLog('[CSV Parser] Product Preference segment created from:', sentimentColumn)
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

  devLog('[CSV Parser] Country source found:', countrySource || hasDirectCountryColumn || 'none')
  devLog('[CSV Parser] Gender source found:', genderSource || hasDirectGenderColumn || 'none')
  devLog('[CSV Parser] Age source found:', ageSource || hasDirectAgeColumn || 'none')
  devLog('[CSV Parser] Audience Type found:', columns.includes(AUDIENCE_COLUMN))
  devLog('[CSV Parser] Typing Tool column found:', typingToolColumn || 'none')
  devLog('[CSV Parser] Final segment columns:', segmentColumns)

  // Build summary
  const respIdCol = columns.find(c => norm(c) === 'respondent id' || norm(c) === 'respondent_id') || columns[0]
  const uniqueRespondents = new Set<string>()
  for (const r of rows) {
    uniqueRespondents.add(String(r[respIdCol]))
  }

  // Filter out questions that have no valid options (e.g., text questions that were marked for removal)
  const filteredQuestions = Array.from(qMap.values()).filter(q => q.columns && q.columns.length > 0)

  // Sort questions: sentiment questions first, then by original order
  // Sentiment questions contain "would you consider buying" or similar in their label
  const questions = filteredQuestions.sort((a, b) => {
    const aIsSentiment = /would you consider buying|purchase intent/i.test(a.label)
    const bIsSentiment = /would you consider buying|purchase intent/i.test(b.label)
    if (aIsSentiment && !bIsSentiment) return -1
    if (!aIsSentiment && bIsSentiment) return 1
    return 0  // Keep original order for non-sentiment questions
  })

  // Validate that we found at least one question
  if (questions.length === 0) {
    throw new Error('No questions detected in CSV. Expected headers like "[Q1] (single) Question Text" or "[Q1] (multi): Option A".')
  }

  // Log summary of all questions
  devLog(`[CSV Parser] Parsed ${questions.length} questions:`)
  questions.forEach(q => {
    const optionCount = q.columns?.length || 0
    devLog(`  ${q.qid} (${q.type}): "${q.label.substring(0, 60)}..." - ${optionCount} options`)
  })
  const rankingCount = questions.filter(q => q.type === 'ranking').length
  devLog(`[CSV Parser] Found ${rankingCount} ranking questions`)

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
