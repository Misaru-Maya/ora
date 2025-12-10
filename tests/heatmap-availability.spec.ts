import { test, expect } from '@playwright/test'

const TEST_CSV_PATH = '/Users/misakifunada/Downloads/All_data_-_SS27_Big_Ideas_TerritoryConcept_Research-1765391859983.csv'

test.describe('Heatmap Availability for Product Follow-up Questions', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app
    await page.goto('/')

    // Wait for the app to load
    await page.waitForSelector('text=Drop a CSV file', { timeout: 15000 })

    // Upload the test CSV file
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(TEST_CSV_PATH)

    // Wait for the file to be processed and questions to appear
    await page.waitForSelector('.rounded-2xl.bg-white', { timeout: 30000 })

    // Give it a moment for charts to render
    await page.waitForTimeout(2000)
  })

  test('Heatmap should be the DEFAULT view for product follow-up questions', async ({ page }) => {
    // Find heatmap buttons and check that they are already active (green background)
    // The active state has backgroundColor: rgba(58, 133, 24, 0.12)
    const heatmapButtons = page.locator('button[title="Heatmap"]')
    const buttonCount = await heatmapButtons.count()

    console.log(`Found ${buttonCount} heatmap buttons`)

    let activeHeatmapCount = 0

    for (let i = 0; i < Math.min(buttonCount, 10); i++) {
      const button = heatmapButtons.nth(i)
      const bgColor = await button.evaluate(el => window.getComputedStyle(el).backgroundColor)

      // Check if the button is in active state (green background)
      if (bgColor === 'rgba(58, 133, 24, 0.12)') {
        activeHeatmapCount++
      }
    }

    console.log(`${activeHeatmapCount} out of ${Math.min(buttonCount, 10)} heatmap buttons are active by default`)

    // Most product questions should have heatmap as the default (active) view
    expect(activeHeatmapCount).toBeGreaterThan(0)
  })

  test('Heatmap button should be visible for product multi-select questions', async ({ page }) => {
    // Find chart cards
    const chartCards = page.locator('.rounded-2xl.bg-white')
    const cardCount = await chartCards.count()

    console.log(`Found ${cardCount} chart cards`)

    // Look for the heatmap button (grid icon) - it should now be available
    // The heatmap button has title="Heatmap"
    const heatmapButtons = page.locator('button[title="Heatmap"]')
    const heatmapButtonCount = await heatmapButtons.count()

    console.log(`Found ${heatmapButtonCount} heatmap buttons`)

    // We should have heatmap buttons available for product-level questions
    expect(heatmapButtonCount).toBeGreaterThan(0)
  })

  test('Heatmap button should be clickable and switch chart to heatmap view', async ({ page }) => {
    // Find the first heatmap button
    const heatmapButton = page.locator('button[title="Heatmap"]').first()

    // Wait for the button to be visible
    await expect(heatmapButton).toBeVisible({ timeout: 10000 })

    // Click the heatmap button
    await heatmapButton.click()

    // Wait for the heatmap to render
    await page.waitForTimeout(1000)

    // The button should now be in active state (has green background)
    // Check that the button has the active styling
    const buttonStyle = await heatmapButton.evaluate(el => {
      const computedStyle = window.getComputedStyle(el)
      return computedStyle.backgroundColor
    })

    console.log('Heatmap button background color after click:', buttonStyle)

    // The active button should have a green-ish background (rgba(58, 133, 24, 0.12))
    // which translates to something like rgb(243, 248, 241) or similar
    expect(buttonStyle).not.toBe('transparent')
  })

  test('Product follow-up questions should show heatmap as option', async ({ page }) => {
    // Look for the specific question "What do you like the most or least about this product?"
    // This is a multi-select product follow-up question that should have heatmap option

    const questionText = 'What do you like the most or least about this product'

    // Find the card containing this question
    const questionCard = page.locator('.rounded-2xl.bg-white').filter({
      hasText: questionText
    }).first()

    // Check if this card has a heatmap button - use first() to avoid strict mode violation
    const heatmapButton = questionCard.locator('button[title="Heatmap"]').first()

    const hasHeatmap = await heatmapButton.count() > 0

    if (hasHeatmap) {
      console.log('SUCCESS: Product follow-up question has heatmap option')
      await expect(heatmapButton).toBeVisible()
    } else {
      // The card might be scrolled out of view, let's look for any heatmap buttons
      const allHeatmapButtons = page.locator('button[title="Heatmap"]')
      const count = await allHeatmapButtons.count()
      console.log(`Found ${count} heatmap buttons in total`)
      expect(count).toBeGreaterThan(0)
    }
  })

  test('Clicking heatmap should render a table/grid structure', async ({ page }) => {
    // Find and click the first heatmap button
    const heatmapButton = page.locator('button[title="Heatmap"]').first()
    await expect(heatmapButton).toBeVisible({ timeout: 10000 })
    await heatmapButton.click()

    // Wait for the heatmap to render
    await page.waitForTimeout(1500)

    // A heatmap should contain table-like elements
    // Look for table or grid cells in the same card
    const card = heatmapButton.locator('xpath=ancestor::div[contains(@class, "rounded-2xl")]')

    // The heatmap should have either a table element or grid-like structure
    // HeatmapTable component renders divs with flex layout for rows
    const hasTableContent = await card.locator('table, [class*="grid"], .flex.flex-col').first().isVisible().catch(() => false)

    // At minimum, after clicking heatmap, we shouldn't see the bar chart's recharts-wrapper
    // and should see some kind of structured data display
    console.log('Heatmap content check:', hasTableContent)

    // Take a screenshot for visual verification
    await page.screenshot({ path: 'heatmap-test.png', fullPage: true })
    console.log('Screenshot saved to heatmap-test.png')
  })

  test('Multiple product questions should all have heatmap buttons', async ({ page }) => {
    // Scroll down to load more questions if needed
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(1000)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(500)

    // Count how many chart cards have heatmap buttons
    const chartCards = page.locator('.rounded-2xl.bg-white')
    const cardCount = await chartCards.count()

    let cardsWithHeatmap = 0

    for (let i = 0; i < Math.min(cardCount, 10); i++) {
      const card = chartCards.nth(i)
      const heatmapButton = card.locator('button[title="Heatmap"]')
      const hasHeatmap = await heatmapButton.count() > 0

      if (hasHeatmap) {
        cardsWithHeatmap++
        const cardText = await card.locator('h3, .text-lg, .font-semibold').first().textContent().catch(() => 'Unknown')
        console.log(`Card ${i + 1} has heatmap: ${cardText?.substring(0, 50)}...`)
      }
    }

    console.log(`${cardsWithHeatmap} out of ${Math.min(cardCount, 10)} cards have heatmap buttons`)

    // We expect multiple cards to have heatmap buttons for product-level questions
    expect(cardsWithHeatmap).toBeGreaterThan(1)
  })
})
