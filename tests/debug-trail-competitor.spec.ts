import { test, expect } from '@playwright/test'

const TEST_CSV_PATH = '/Users/misakifunada/Downloads/All_data_-_Mens_Trail_Competitor_Test-1765824597356.csv'

test.describe('Debug Trail Competitor File', () => {
  test('debug - check for errors with specific file', async ({ page }) => {
    // Capture ALL console messages and errors
    const errors: string[] = []

    page.on('console', msg => {
      const text = msg.text()
      const type = msg.type()
      console.log('BROWSER [' + type + ']: ' + text)
    })

    page.on('pageerror', err => {
      errors.push(err.message)
      console.log('PAGE ERROR: ' + err.message)
    })

    await page.goto('/')
    await page.waitForSelector('text=Drop a CSV file', { timeout: 15000 })
    console.log('Page loaded, uploading file...')

    // Upload the CSV file
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(TEST_CSV_PATH)
    console.log('File uploaded, waiting...')

    // Wait for either charts or error
    await page.waitForTimeout(10000)

    // Check if charts appeared
    const chartCards = page.locator('.rounded-2xl.bg-white')
    const cardCount = await chartCards.count()
    console.log('Chart cards found: ' + cardCount)

    // Check if still showing upload screen
    const uploadText = page.locator('text=Drop a CSV file')
    const stillShowingUpload = await uploadText.isVisible()
    console.log('Still showing upload screen: ' + stillShowingUpload)

    // Print any errors
    if (errors.length > 0) {
      console.log('\n=== ERRORS FOUND ===')
      errors.forEach(e => console.log(e))
    }

    // Take screenshot
    await page.screenshot({ path: 'test-results/trail-competitor-debug.png', fullPage: true })

    expect(cardCount).toBeGreaterThan(0)
  })
})
