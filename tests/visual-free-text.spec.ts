import { test, expect } from '@playwright/test'

const TEST_CSV_PATH = '/Users/misakifunada/Downloads/All_data_-_Mens_S27_Aventrail_Colors_Test-1765760933538.csv'

test.describe('Visual Free Text Test', () => {
  test('visual check of free text questions', async ({ page }) => {
    // Enable console logging from the browser - capture everything
    page.on('console', msg => {
      const text = msg.text()
      if (text.includes('Rendering') || text.includes('[ERROR]') || text.includes('text') || text.includes('FreeText') || text.includes('entry.question.type') || text.includes('Render Debug') || text.includes('hasData')) {
        console.log(`BROWSER: ${text}`)
      }
    })

    await page.goto('/')
    await page.waitForSelector('text=Drop a CSV file', { timeout: 15000 })

    // Upload the CSV file
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(TEST_CSV_PATH)

    // Wait for charts to appear
    await page.waitForSelector('.rounded-2xl.bg-white', { timeout: 60000 })
    console.log('Charts loaded')

    // Wait longer for word clouds to render
    await page.waitForTimeout(10000)

    // Count all chart cards
    const chartCards = page.locator('.rounded-2xl.bg-white')
    const cardCount = await chartCards.count()
    console.log(`Total chart cards: ${cardCount}`)

    // Get text content of each card's header area
    for (let i = 0; i < Math.min(cardCount, 25); i++) {
      const card = chartCards.nth(i)
      // Try to get any header or title text
      const headerText = await card.locator('div').first().textContent().catch(() => 'N/A')
      console.log(`Card ${i}: ${headerText?.substring(0, 100)}...`)
    }

    // Find all badge texts - try different selectors
    const badges = page.locator('span').filter({ hasText: /Single Select|Multi Select|Ranking|Sentiment|Free Text|Likert/ })
    const badgeCount = await badges.count()
    console.log(`Badge count: ${badgeCount}`)

    // Check for any text containing "Free Text"
    const anyFreeText = page.locator(':text("Free Text")')
    const anyFreeTextCount = await anyFreeText.count()
    console.log(`Any "Free Text" elements: ${anyFreeTextCount}`)

    // Check for "Responses" text which is in FreeTextDisplay
    const responsesText = page.locator('text=/\\d+ Responses/')
    const responsesCount = await responsesText.count()
    console.log(`"X Responses" found: ${responsesCount}`)

    // Check for "What made you feel" which should be in the text question label
    const whatMadeYouFeel = page.locator('text=/What made you feel/')
    const whatMadeCount = await whatMadeYouFeel.count()
    console.log(`"What made you feel" text found: ${whatMadeCount}`)

    // Check for word cloud canvas elements
    const canvases = page.locator('canvas')
    const canvasCount = await canvases.count()
    console.log(`Canvas elements: ${canvasCount}`)

    // Check for "Free Text Analyzer" button
    const analyzerBtn = page.locator('text=Free Text Analyzer')
    const analyzerCount = await analyzerBtn.count()
    console.log(`Free Text Analyzer buttons: ${analyzerCount}`)

    // Check page content for debugging
    const pageContent = await page.content()
    const hasFreeTextInHTML = pageContent.includes('Free Text')
    console.log(`Page HTML contains "Free Text": ${hasFreeTextInHTML}`)

    const hasResponsesInHTML = pageContent.includes('Responses')
    console.log(`Page HTML contains "Responses": ${hasResponsesInHTML}`)

    // Take screenshot
    await page.screenshot({ path: 'test-results/free-text-visual.png', fullPage: false })

    // Look for FreeTextDisplay by checking for its container structure
    const freeTextBadge = page.locator('text=Free Text')
    const freeTextCount = await freeTextBadge.count()
    console.log(`Free Text badges: ${freeTextCount}`)

    // Scroll down to see more charts
    await page.evaluate(() => window.scrollBy(0, 2000))
    await page.waitForTimeout(2000)
    await page.screenshot({ path: 'test-results/free-text-visual-scrolled.png', fullPage: false })

    const freeTextCountAfterScroll = await freeTextBadge.count()
    console.log(`Free Text badges after scroll: ${freeTextCountAfterScroll}`)

    expect(freeTextCount + freeTextCountAfterScroll).toBeGreaterThan(0)
  })
})
