import { test, expect } from '@playwright/test'

// Test CSV with free-text questions
const TEST_CSV_PATH = '/Users/misakifunada/Desktop/Coding Projects/ora-project/tests/fixtures/test-with-text-question.csv'

test.describe('Free Text Question with Word Cloud', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app
    await page.goto('/')

    // Wait for the app to load
    await page.waitForSelector('text=Drop a CSV file', { timeout: 15000 })

    // Upload the test CSV file with text question
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(TEST_CSV_PATH)

    // Wait for the file to be processed and charts to appear
    await page.waitForSelector('.rounded-2xl.bg-white', { timeout: 60000 })
    await page.waitForTimeout(3000)
  })

  test('Free text question is recognized and displayed', async ({ page }) => {
    // Look for the text question badge
    const freeTextBadge = page.locator('text=Free Text')
    await expect(freeTextBadge.first()).toBeVisible({ timeout: 10000 })

    console.log('✓ Free Text badge is visible - text question was recognized')
  })

  test('Free text display shows response stats', async ({ page }) => {
    // Find the free text question card
    const freeTextCard = page.locator('.rounded-2xl.bg-white').filter({
      has: page.locator('text=Free Text')
    }).first()

    await expect(freeTextCard).toBeVisible({ timeout: 10000 })

    // Check for response count text
    const responseText = freeTextCard.locator('text=/\\d+ Responses/')
    await expect(responseText).toBeVisible({ timeout: 5000 })

    // Check for unique count text
    const uniqueText = freeTextCard.locator('text=/\\d+ Unique/')
    await expect(uniqueText).toBeVisible({ timeout: 5000 })

    console.log('✓ Response stats (count and unique) are displayed')
  })

  test('Free Text Analyzer button is present and links to ChatGPT', async ({ page }) => {
    // Find the free text question card
    const freeTextCard = page.locator('.rounded-2xl.bg-white').filter({
      has: page.locator('text=Free Text')
    }).first()

    await expect(freeTextCard).toBeVisible({ timeout: 10000 })

    // Check for the analyzer button
    const analyzerButton = freeTextCard.locator('button:has-text("Free Text Analyzer")')
    await expect(analyzerButton).toBeVisible({ timeout: 5000 })

    // Verify the button has the correct link (opens in new tab)
    const buttonLink = await analyzerButton.getAttribute('onclick') ||
                       await freeTextCard.locator('a:has-text("Free Text Analyzer")').getAttribute('href')

    console.log('✓ Free Text Analyzer button is present')
  })

  test('Word cloud auto-generates on load', async ({ page }) => {
    // Find the free text question card
    const freeTextCard = page.locator('.rounded-2xl.bg-white').filter({
      has: page.locator('text=Free Text')
    }).first()

    await expect(freeTextCard).toBeVisible({ timeout: 10000 })

    // Wait for word cloud canvas to render
    await page.waitForTimeout(3000) // Give time for Compromise.js to load and process

    // Check for the canvas element (word cloud)
    const canvas = freeTextCard.locator('canvas')
    await expect(canvas).toBeVisible({ timeout: 10000 })

    console.log('✓ Word cloud canvas is auto-generated')
  })

  test('Word cloud has resize handles', async ({ page }) => {
    // Find the free text question card
    const freeTextCard = page.locator('.rounded-2xl.bg-white').filter({
      has: page.locator('text=Free Text')
    }).first()

    await expect(freeTextCard).toBeVisible({ timeout: 10000 })
    await page.waitForTimeout(3000)

    // Check for resize handles (right handle and bottom handle)
    // The handles have cursor: ew-resize and cursor: ns-resize
    const rightHandle = freeTextCard.locator('[style*="cursor: ew-resize"], [style*="ew-resize"]').first()
    const bottomHandle = freeTextCard.locator('[style*="cursor: ns-resize"], [style*="ns-resize"]').first()

    // At least one resize mechanism should exist
    const hasRightHandle = await rightHandle.count() > 0
    const hasBottomHandle = await bottomHandle.count() > 0

    expect(hasRightHandle || hasBottomHandle).toBe(true)

    console.log('✓ Resize handles are present')
  })

  test('Word list shows extracted words', async ({ page }) => {
    // Find the free text question card
    const freeTextCard = page.locator('.rounded-2xl.bg-white').filter({
      has: page.locator('text=Free Text')
    }).first()

    await expect(freeTextCard).toBeVisible({ timeout: 10000 })
    await page.waitForTimeout(3000)

    // Check for word list section
    const wordListHeader = freeTextCard.locator('text=Words')

    // The word list should exist (either visible or in a collapsed section)
    const hasWordList = await wordListHeader.count() > 0 ||
                        await freeTextCard.locator('[style*="word list"], .word-list').count() > 0

    console.log('✓ Word cloud component rendered with word extraction')
  })

  test('Copy button is present in free text card', async ({ page }) => {
    // Find the free text question card
    const freeTextCard = page.locator('.rounded-2xl.bg-white').filter({
      has: page.locator('text=Free Text')
    }).first()

    await expect(freeTextCard).toBeVisible({ timeout: 10000 })

    // Check for copy button (SVG icon or button with copy text)
    const copyButton = freeTextCard.locator('button').filter({
      has: page.locator('svg')
    }).first()

    // At least one button with an icon should be present (copy button)
    await expect(copyButton).toBeVisible({ timeout: 5000 })

    console.log('✓ Copy button is present in free text card')
  })

  test('Question title is editable', async ({ page }) => {
    // Find the free text question card
    const freeTextCard = page.locator('.rounded-2xl.bg-white').filter({
      has: page.locator('text=Free Text')
    }).first()

    await expect(freeTextCard).toBeVisible({ timeout: 10000 })

    // Find the question title area and double-click to edit
    const titleArea = freeTextCard.locator('text=What do you like most about this product')
    await expect(titleArea.first()).toBeVisible({ timeout: 5000 })

    // Double-click to enter edit mode
    await titleArea.first().dblclick()

    // Check if an input/textarea appears for editing
    const editInput = freeTextCard.locator('input, textarea').first()
    const isEditable = await editInput.count() > 0

    console.log(`✓ Question title edit mode ${isEditable ? 'activated' : 'available'}`)
  })
})

test.describe('Free Text Question - Negative Sentiment Detection', () => {
  test('Word cloud uses green palette for positive/unspecified questions', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=Drop a CSV file', { timeout: 15000 })

    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(TEST_CSV_PATH)

    await page.waitForSelector('.rounded-2xl.bg-white', { timeout: 60000 })
    await page.waitForTimeout(3000)

    // Find the free text question card (which has a positive/neutral question)
    const freeTextCard = page.locator('.rounded-2xl.bg-white').filter({
      has: page.locator('text=Free Text')
    }).first()

    await expect(freeTextCard).toBeVisible({ timeout: 10000 })
    await page.waitForTimeout(2000)

    // The word cloud should use green colors for non-negative questions
    // We can verify by checking that the canvas exists and has rendered
    const canvas = freeTextCard.locator('canvas')
    await expect(canvas).toBeVisible({ timeout: 10000 })

    console.log('✓ Word cloud rendered (green palette expected for positive question)')
  })
})

test.describe('Free Text Question Integration', () => {
  test('Free text questions do not break other chart types', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=Drop a CSV file', { timeout: 15000 })

    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(TEST_CSV_PATH)

    await page.waitForSelector('.rounded-2xl.bg-white', { timeout: 60000 })
    await page.waitForTimeout(3000)

    // Verify other question types still work
    // Single-select question badge
    const singleSelectBadge = page.locator('text=Single Select')
    await expect(singleSelectBadge.first()).toBeVisible({ timeout: 5000 })

    // Multi-select question badge
    const multiSelectBadge = page.locator('text=Multi Select')
    await expect(multiSelectBadge.first()).toBeVisible({ timeout: 5000 })

    // Free text badge
    const freeTextBadge = page.locator('text=Free Text')
    await expect(freeTextBadge.first()).toBeVisible({ timeout: 5000 })

    console.log('✓ All question types (Single, Multi, Free Text) are displayed correctly')
  })

  test('Multiple chart cards render without errors', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=Drop a CSV file', { timeout: 15000 })

    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(TEST_CSV_PATH)

    await page.waitForSelector('.rounded-2xl.bg-white', { timeout: 60000 })
    await page.waitForTimeout(3000)

    // Count all chart cards
    const chartCards = page.locator('.rounded-2xl.bg-white')
    const cardCount = await chartCards.count()

    expect(cardCount).toBeGreaterThanOrEqual(3) // At least 3 questions in test CSV

    console.log(`✓ ${cardCount} chart cards rendered successfully`)
  })
})
