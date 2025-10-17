# ORA Statistical Calculations - Technical Documentation

## Purpose
This document details all mathematical and statistical calculations performed by the ORA application for technical review.

---

## 1. Percentage Calculations

### Basic Percentage Formula
```
percentage = (count / denominator) × 100
```

**Implementation:** `src/dataCalculations.ts:352`
```typescript
const percent = denom ? Math.round((count / denom) * 100 * 1e10) / 1e10 : 0
```

**Precision Handling:**
- Multiplies by 1e10 before rounding to handle floating-point precision issues
- Then divides by 1e10 to get final percentage
- Prevents issues like 0.1 + 0.2 ≠ 0.3 in JavaScript

**Edge Cases:**
- Returns 0 when denominator is 0 (avoids division by zero)

---

## 2. Chi-Square Test for Statistical Significance

### Purpose
Determines if the difference between two groups' responses is statistically significant.

### Formula (2x2 Contingency Table)
```
χ² = [N(ad - bc)²] / [(a+b)(c+d)(a+c)(b+d)]

Where:
- a = Group 1 count (selected option)
- b = Group 1 count (didn't select option)
- c = Group 2 count (selected option)
- d = Group 2 count (didn't select option)
- N = total observations = a + b + c + d
```

### Implementation
**Location:** `src/dataCalculations.ts:362-392`

```typescript
const a = g1.count
const b = Math.max(g1.denominator - g1.count, 0)
const c = g2.count
const d = Math.max(g2.denominator - g2.count, 0)
const total = a + b + c + d

const numerator = (a * d - b * c) ** 2 * total
const denom = (a + b) * (c + d) * (a + c) * (b + d)
const chiSquare = numerator / denom

const significant = chiSquare >= 3.841
```

### Critical Value
- **3.841** is the critical value at 95% confidence level (α = 0.05) with 1 degree of freedom
- Source: Standard chi-square distribution table

### Assumptions & Limitations

#### ⚠️ Current Assumptions:
1. **Independence:** Assumes responses are independent
2. **Sample Size:** No minimum sample size validation
3. **Expected Frequencies:** Does not check if expected cell counts ≥ 5 (recommended threshold)
4. **Degrees of Freedom:** Always uses df=1 (2x2 table)

#### ⚠️ Known Limitations:
1. **No Yates' Continuity Correction**
   - Small sample sizes may produce inflated chi-square values
   - Continuity correction formula: `χ² = [N(|ad - bc| - N/2)²] / [(a+b)(c+d)(a+c)(b+d)]`

2. **Multiple Comparison Problem**
   - When comparing multiple groups, performs n(n-1)/2 tests
   - Does NOT adjust p-values (e.g., Bonferroni correction)
   - This increases Type I error rate (false positives)

3. **Fixed Confidence Level**
   - Always uses 95% confidence (α = 0.05)
   - Not configurable by user

4. **Edge Case Handling**
   - Uses `Math.max(denominator - count, 0)` to prevent negative values
   - Returns 0 when denominator is 0

---

## 3. Respondent vs Row-Level Counting

### Respondent-Level Counting
**When:** Survey questions where each person answers once
**Logic:** Count unique respondent IDs

```typescript
const seen = new Set<string>()
for (const r of info.rows) {
  const respondent = normalizeValue(r[respIdCol])
  if (!respondent || seen.has(respondent)) continue
  // ... count logic
}
```

### Row-Level Counting
**When:** Product tests where same person evaluates multiple products
**Logic:** Count all rows (each product evaluation)

```typescript
for (const r of info.rows) {
  // Count every row, not unique respondents
  totalRowsAnswered += 1
}
```

**Determination:** `question.level === 'row' || dataset.summary.isProductTest`

---

## 4. Multi-Select Question Handling

### Denominator Calculation
- **Denominator = respondents who answered the question** (not total respondents)
- Excludes respondents who skipped the question entirely

### Implementation
```typescript
const answeredRespondents = new Set<string>()

// First, find all respondents who answered ANY option in this question
for (const r of info.rows) {
  for (const qCol of question.columns) {
    if (hasAnySelection) {
      answeredRespondents.add(respondent)
    }
  }
}

denom = answeredRespondents.size
```

---

## 5. Rounding Behavior

### Standard Rounding Function
```typescript
export function customRound(value: number): number {
  return Math.round(value)
}
```

- Uses JavaScript's built-in `Math.round()`
- Rounds 0.5 up to 1 (banker's rounding not used)
- Applied to final percentage displays

---

## 6. Sorting Algorithms

### Average-Based Sorting
```typescript
const avg = (row) => {
  let total = 0
  let count = 0
  groupMeta.forEach(meta => {
    total += row[meta.key]
    count += 1
  })
  return count ? total / count : 0
}
```

**Descending:** `avg(a) - avg(b)` (reversed for pie charts)
**Ascending:** `avg(b) - avg(a)` (reversed for pie charts)

### Money Value Parsing
```typescript
// Extracts numeric values from currency strings
// Examples: "$25,000" → 25000, "Under $50,000" → 49999.5
const match = text.match(/[\$£€]?\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)/i)
const baseValue = parseInt(match[1].replace(/,/g, ''), 10)

// Adjusts for "Under" and "Over" prefixes
if (/^under\s+/i.test(text)) return baseValue - 0.5
if (/^over\s+/i.test(text)) return baseValue + 0.5
```

---

## Issues Requiring Review

### Critical - Statistical Validity
1. **Chi-square assumptions not validated**
   - No check for expected cell counts ≥ 5
   - No sample size requirements
   - May produce unreliable results for small samples

2. **Multiple comparison problem**
   - With 5 groups: performs 10 pairwise tests
   - Inflates false positive rate
   - Should consider Bonferroni correction: α' = α/n

3. **No continuity correction**
   - May overestimate significance for small samples
   - Standard practice: use Yates' correction when any expected count < 5

### Medium - Implementation
4. **Fixed confidence level (95%)**
   - Cannot adjust sensitivity
   - Some use cases may need 90% or 99%

5. **Percentage precision**
   - Rounds to 10 decimal places internally
   - Display shows rounded values
   - Potential for small cumulative rounding errors

### Low - Edge Cases
6. **Division by zero handling**
   - Returns 0 when denominator is 0
   - Could be flagged differently

---

## Recommendations

### Immediate Actions
1. **Validate chi-square assumptions in code:**
   ```typescript
   // Check expected frequencies
   const expected_a = (a+b)*(a+c)/total
   if (expected_a < 5) {
     // Use Fisher's exact test or apply continuity correction
   }
   ```

2. **Implement multiple comparison correction:**
   ```typescript
   const numTests = (groups.length * (groups.length - 1)) / 2
   const adjustedAlpha = 0.05 / numTests  // Bonferroni
   const adjustedCritical = getCriticalValue(adjustedAlpha, 1)
   ```

3. **Add Yates' continuity correction option:**
   ```typescript
   const numerator = (Math.abs(a * d - b * c) - total/2) ** 2 * total
   ```

### Long-term Improvements
- Make confidence level configurable
- Add warnings for small sample sizes
- Consider Fisher's exact test for small samples
- Add unit tests with known statistical outcomes
- Document all statistical assumptions in user-facing docs

---

## Testing Recommendations

### Unit Tests Needed
1. Chi-square calculation with known inputs/outputs
2. Edge cases: zero denominators, negative values, very small samples
3. Rounding precision tests
4. Multi-select denominator calculation

### Validation Datasets
- Compare against established statistical software (R, SPSS, Python scipy)
- Test with various sample sizes
- Include edge cases from real survey data

---

## References
- Chi-square test: https://en.wikipedia.org/wiki/Chi-squared_test
- Yates' continuity correction: https://en.wikipedia.org/wiki/Yates%27s_correction_for_continuity
- Multiple comparisons: https://en.wikipedia.org/wiki/Multiple_comparisons_problem
- Bonferroni correction: https://en.wikipedia.org/wiki/Bonferroni_correction

---

**Document Created:** 2025-10-17
**For Review By:** Frank (CTO) and Statistics Team
**Code Version:** As of commit 6675e88
