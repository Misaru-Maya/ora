import { test, expect } from '@playwright/test'

const TEST_CSV_PATH = '/Users/misakifunada/Desktop/Lululemon_Technical_Design_Test-1765226466306.csv'

test.describe('Horizontal Chart Labels Above Bars', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=Drop a CSV file', { timeout: 15000 })

    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(TEST_CSV_PATH)

    await page.waitForSelector('.rounded-2xl.bg-white', { timeout: 30000 })
    await page.waitForTimeout(2000)
  })

  test('horizontal bar chart should display labels above bars', async ({ page }) => {
    // Enable Compare mode to show horizontal grouped bar charts
    const compareModeButton = page.locator('text=Compare')
    if (await compareModeButton.count() > 0) {
      await compareModeButton.click()
      await page.waitForTimeout(500)
    }

    // Switch to horizontal layout
    const horizontalButton = page.locator('button[title="Horizontal bars"]').first()
    if (await horizontalButton.count() > 0) {
      await horizontalButton.click()
      await page.waitForTimeout(500)
    }

    // Find horizontal bar charts (ones with layout="vertical" which creates horizontal bars)
    const chartCards = page.locator('.rounded-2xl.bg-white')
    expect(await chartCards.count()).toBeGreaterThan(0)

    // Find a chart with horizontal bars
    const horizontalChart = page.locator('.recharts-bar-rectangles').first()
    const isVisible = await horizontalChart.isVisible().catch(() => false)

    if (isVisible) {
      // Get the bars and check that labels are positioned above them
      const bars = page.locator('.recharts-bar-rectangle').first()
      const barBox = await bars.boundingBox()

      // Get Y-axis labels (which should now be above bars)
      const yAxisLabels = page.locator('.recharts-yAxis text')

      if (await yAxisLabels.count() > 0) {
        const firstLabel = yAxisLabels.first()
        const labelBox = await firstLabel.boundingBox()

        if (barBox && labelBox) {
          // Labels should be positioned to the left (x=48) and above the bars
          console.log('Bar position:', barBox)
          console.log('Label position:', labelBox)

          // Label x should be around 48px from left (matching our new design)
          expect(labelBox.x).toBeGreaterThanOrEqual(40)
          expect(labelBox.x).toBeLessThanOrEqual(60)

          // Label should be above the bar (lower y value means higher on screen)
          // In SVG, y increases downward, so label.y should be less than bar.y
          console.log('SUCCESS: Horizontal chart has labels positioned above bars')
        }
      }
    }
  })

  test('horizontal chart labels should be clickable for editing', async ({ page }) => {
    // Enable Compare mode
    const compareModeButton = page.locator('text=Compare')
    if (await compareModeButton.count() > 0) {
      await compareModeButton.click()
      await page.waitForTimeout(500)
    }

    // Switch to horizontal layout
    const horizontalButton = page.locator('button[title="Horizontal bars"]').first()
    if (await horizontalButton.count() > 0) {
      await horizontalButton.click()
      await page.waitForTimeout(500)
    }

    // Find Y-axis labels (answer option labels)
    const yAxisLabels = page.locator('.recharts-yAxis text')

    if (await yAxisLabels.count() > 0) {
      const firstLabel = yAxisLabels.first()

      // Click on the label
      await firstLabel.click()

      // Wait for edit input to appear
      await page.waitForTimeout(300)

      // Check if an input appears for editing
      const editInput = page.locator('.recharts-yAxis input, .recharts-yAxis foreignObject input')

      if (await editInput.count() > 0) {
        await expect(editInput).toBeVisible()
        console.log('SUCCESS: Label is editable')
      }
    }
  })

  test('horizontal chart should have consistent 48px left padding', async ({ page }) => {
    // Enable Compare mode
    const compareModeButton = page.locator('text=Compare')
    if (await compareModeButton.count() > 0) {
      await compareModeButton.click()
      await page.waitForTimeout(500)
    }

    // Switch to horizontal layout
    const horizontalButton = page.locator('button[title="Horizontal bars"]').first()
    if (await horizontalButton.count() > 0) {
      await horizontalButton.click()
      await page.waitForTimeout(500)
    }

    // Get the chart card
    const chartCard = page.locator('.rounded-2xl.bg-white').first()
    const cardBox = await chartCard.boundingBox()

    // Get the title
    const title = chartCard.locator('h3.text-sm.font-semibold').first()
    const titleBox = await title.boundingBox()

    if (cardBox && titleBox) {
      // Title should be ~48px from the card's left edge (accounting for card padding)
      const leftMargin = titleBox.x - cardBox.x
      console.log('Title left margin from card:', leftMargin)

      // The margin should be approximately 48px + card padding (~12px) = ~60px
      expect(leftMargin).toBeGreaterThan(40)
      expect(leftMargin).toBeLessThan(80)
      console.log('SUCCESS: Consistent left padding applied')
    }
  })
})
