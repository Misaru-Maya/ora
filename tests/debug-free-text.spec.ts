import { test, expect } from '@playwright/test'

// Test with actual CSV file that has text questions
const TEST_CSV_PATH = '/Users/misakifunada/Downloads/All_data_-_Mens_S27_Aventrail_Colors_Test-1765760933538.csv'

test.describe('Debug Free Text Questions', () => {
  test('debug - inspect what questions are parsed', async ({ page }) => {
    // Enable console logging from the browser
    page.on('console', msg => {
      if (msg.text().includes('[CSV Parser]') || msg.text().includes('[FILTER]') || msg.text().includes('text')) {
        console.log(`BROWSER: ${msg.text()}`)
      }
    })

    await page.goto('/')
    await page.waitForSelector('text=Drop a CSV file', { timeout: 15000 })

    // Upload the CSV file
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(TEST_CSV_PATH)

    // Wait for charts to appear
    await page.waitForSelector('.rounded-2xl.bg-white', { timeout: 60000 })
    await page.waitForTimeout(5000)

    // Count all chart cards
    const chartCards = page.locator('.rounded-2xl.bg-white')
    const cardCount = await chartCards.count()
    console.log(`Found ${cardCount} chart cards`)

    // Look for all question type badges
    const allBadges = page.locator('span').filter({ hasText: /Single Select|Multi Select|Ranking|Sentiment|Free Text/ })
    const badgeCount = await allBadges.count()
    console.log(`Found ${badgeCount} question type badges`)

    for (let i = 0; i < Math.min(badgeCount, 20); i++) {
      const badgeText = await allBadges.nth(i).textContent()
      console.log(`Badge ${i}: ${badgeText}`)
    }

    // Specifically look for Free Text
    const freeTextBadge = page.locator('text=Free Text')
    const freeTextCount = await freeTextBadge.count()
    console.log(`Free Text badges found: ${freeTextCount}`)

    // Check if any card contains "What made you feel"
    const textQuestionCard = page.locator('.rounded-2xl.bg-white').filter({
      hasText: 'What made you feel'
    })
    const textCardCount = await textQuestionCard.count()
    console.log(`Cards with "What made you feel" text: ${textCardCount}`)

    // Check if any card contains "How would you improve"
    const improveCard = page.locator('.rounded-2xl.bg-white').filter({
      hasText: 'How would you improve'
    })
    const improveCardCount = await improveCard.count()
    console.log(`Cards with "How would you improve" text: ${improveCardCount}`)

    // Check results
    expect(cardCount).toBeGreaterThan(0)
  })
})
