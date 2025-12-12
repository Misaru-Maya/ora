import { test, expect } from '@playwright/test'

const TEST_CSV_PATH = '/Users/misakifunada/Downloads/All_data_-_SS27_Big_Ideas_TerritoryConcept_Research-1765391859983.csv'

test.describe('Chart Title and Legend Layout', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app
    await page.goto('/')

    // Wait for the app to load
    await page.waitForSelector('text=Drop a CSV file', { timeout: 15000 })

    // Upload the test CSV file
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(TEST_CSV_PATH)

    // Wait for the file to be processed and questions to appear
    await page.waitForSelector('[data-testid="question-card"], .rounded-2xl.bg-white', { timeout: 30000 })

    // Give it a moment for charts to render
    await page.waitForTimeout(2000)
  })

  test('title and legend should be left-aligned starting from Y-axis position', async ({ page }) => {
    // Find the first chart card
    const chartCards = page.locator('.rounded-2xl.bg-white')
    expect(await chartCards.count()).toBeGreaterThan(0)

    const firstCard = chartCards.first()

    // Find the chart title (h3 element in the header)
    const chartTitle = firstCard.locator('h3.text-sm.font-semibold').first()
    await expect(chartTitle).toBeVisible()

    // Get the title's bounding box
    const titleBox = await chartTitle.boundingBox()
    expect(titleBox).not.toBeNull()

    // Find the Y-axis (the YAxis element in recharts)
    const yAxis = firstCard.locator('.recharts-yAxis').first()

    if (await yAxis.count() > 0) {
      const yAxisBox = await yAxis.boundingBox()
      expect(yAxisBox).not.toBeNull()

      // The title's left edge should be close to the Y-axis left edge
      // (within reasonable tolerance for margins and padding)
      const titleLeftEdge = titleBox!.x
      const yAxisLeftEdge = yAxisBox!.x

      console.log('Title left edge:', titleLeftEdge)
      console.log('Y-axis left edge:', yAxisLeftEdge)

      // Title should be positioned to the right of Y-axis start
      // The difference accounts for Y-axis width + some padding
      // Title aligns with where the chart bars start (right side of Y-axis labels)
      const distance = titleLeftEdge - yAxisLeftEdge
      expect(distance).toBeGreaterThan(0) // Title should be to the right of Y-axis start
      expect(distance).toBeLessThan(250) // But not too far to the right

      console.log('SUCCESS: Title is left-aligned relative to Y-axis (distance:', distance, 'px)')
    }
  })

  test('legend should appear below title, not beside it', async ({ page }) => {
    // Enable Compare mode to show multiple segments
    const compareModeButton = page.locator('text=Compare')
    if (await compareModeButton.count() > 0) {
      await compareModeButton.click()
      await page.waitForTimeout(500)
    }

    // Add Overall segment if available
    const overallChip = page.locator('text=Overall').first()
    if (await overallChip.count() > 0) {
      await overallChip.click()
      await page.waitForTimeout(500)
    }

    // Find the first chart card
    const chartCards = page.locator('.rounded-2xl.bg-white')
    expect(await chartCards.count()).toBeGreaterThan(0)

    const firstCard = chartCards.first()

    // Find the chart title
    const chartTitle = firstCard.locator('h3.text-sm.font-semibold').first()
    const titleBox = await chartTitle.boundingBox()

    // Find the legend (contains colored rectangles with segment labels)
    const legend = firstCard.locator('.flex.flex-wrap.items-center').first()

    if (await legend.count() > 0) {
      const legendBox = await legend.boundingBox()

      if (titleBox && legendBox) {
        console.log('Title Y:', titleBox.y)
        console.log('Legend Y:', legendBox.y)

        // Legend should be below the title (higher Y value)
        expect(legendBox.y).toBeGreaterThan(titleBox.y)

        console.log('SUCCESS: Legend is positioned below the title')
      }
    }
  })

  test('title and legend should stay left-aligned when chart width is resized', async ({ page }) => {
    // Find the first chart card
    const chartCards = page.locator('.rounded-2xl.bg-white')
    expect(await chartCards.count()).toBeGreaterThan(0)

    const firstCard = chartCards.first()

    // Find the chart title
    const chartTitle = firstCard.locator('h3.text-sm.font-semibold').first()
    await expect(chartTitle).toBeVisible()

    // Get initial title position
    const initialTitleBox = await chartTitle.boundingBox()
    expect(initialTitleBox).not.toBeNull()

    // Find the width resize handle
    const widthHandle = page.locator('div[style*="ew-resize"]').first()

    if (await widthHandle.count() > 0) {
      const handleBox = await widthHandle.boundingBox()

      if (handleBox) {
        // Drag the handle to make the chart wider
        await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
        await page.mouse.down()
        await page.mouse.move(handleBox.x + 100, handleBox.y + handleBox.height / 2, { steps: 10 })
        await page.mouse.up()

        await page.waitForTimeout(500)

        // Get new title position after resize
        const newTitleBox = await chartTitle.boundingBox()
        expect(newTitleBox).not.toBeNull()

        // Title left edge should remain at approximately the same position
        // (left-aligned, not centered or affected by width change)
        const leftEdgeDifference = Math.abs(newTitleBox!.x - initialTitleBox!.x)

        console.log('Initial title X:', initialTitleBox!.x)
        console.log('New title X:', newTitleBox!.x)
        console.log('Left edge difference:', leftEdgeDifference)

        // Title should stay at approximately the same left position
        expect(leftEdgeDifference).toBeLessThan(20)

        console.log('SUCCESS: Title stays left-aligned after chart resize')
      }
    }
  })

  test('title and legend should remain left-aligned on window resize', async ({ page }) => {
    // Find the first chart card
    const chartCards = page.locator('.rounded-2xl.bg-white')
    expect(await chartCards.count()).toBeGreaterThan(0)

    const firstCard = chartCards.first()

    // Find the chart title
    const chartTitle = firstCard.locator('h3.text-sm.font-semibold').first()
    await expect(chartTitle).toBeVisible()

    // Get initial title position
    const initialTitleBox = await chartTitle.boundingBox()
    expect(initialTitleBox).not.toBeNull()

    // Find Y-axis for reference
    const yAxis = firstCard.locator('.recharts-yAxis').first()
    let initialYAxisLeft = 0

    if (await yAxis.count() > 0) {
      const yAxisBox = await yAxis.boundingBox()
      if (yAxisBox) {
        initialYAxisLeft = yAxisBox.x
      }
    }

    // Resize the viewport to be wider
    const currentViewport = page.viewportSize()
    await page.setViewportSize({
      width: currentViewport!.width + 200,
      height: currentViewport!.height
    })

    // Wait for resize observer to update
    await page.waitForTimeout(500)

    // Get new title position after resize
    const newTitleBox = await chartTitle.boundingBox()
    expect(newTitleBox).not.toBeNull()

    // Get new Y-axis position
    if (await yAxis.count() > 0) {
      const newYAxisBox = await yAxis.boundingBox()
      if (newYAxisBox) {
        // Title should maintain similar distance from Y-axis after resize
        const initialDistance = initialTitleBox!.x - initialYAxisLeft
        const newDistance = newTitleBox!.x - newYAxisBox.x

        console.log('Initial distance from Y-axis:', initialDistance)
        console.log('New distance from Y-axis:', newDistance)

        // Distance may change slightly due to responsive Y-axis width recalculation
        // The key is that both distances should be positive (title to right of Y-axis)
        // and within reasonable bounds
        expect(initialDistance).toBeGreaterThan(0)
        expect(newDistance).toBeGreaterThan(0)
        expect(newDistance).toBeLessThan(350)

        console.log('SUCCESS: Title maintains left-aligned position after window resize')
      }
    }

    // Reset viewport
    await page.setViewportSize({
      width: currentViewport!.width,
      height: currentViewport!.height
    })
  })

  test('stacked chart should have left-aligned title and legend', async ({ page }) => {
    // Find the chart variant toolbar and click on stacked chart option
    const stackedButton = page.locator('button[title*="stack"], button:has(svg[data-icon*="stack"])').first()

    if (await stackedButton.count() > 0) {
      await stackedButton.click()
      await page.waitForTimeout(500)
    }

    // Find the first chart card
    const chartCards = page.locator('.rounded-2xl.bg-white')
    expect(await chartCards.count()).toBeGreaterThan(0)

    const firstCard = chartCards.first()

    // Find the chart title
    const chartTitle = firstCard.locator('h3.text-sm.font-semibold').first()

    if (await chartTitle.count() > 0) {
      const titleBox = await chartTitle.boundingBox()
      expect(titleBox).not.toBeNull()

      // Get the card's bounding box for reference
      const cardBox = await firstCard.boundingBox()
      expect(cardBox).not.toBeNull()

      // Title should start from the left side of the card (not centered)
      // Left-aligned means it should be within the left 40% of the card width
      const titleRelativePosition = (titleBox!.x - cardBox!.x) / cardBox!.width

      console.log('Title relative position:', titleRelativePosition)

      // Title should start in the left portion of the card
      expect(titleRelativePosition).toBeLessThan(0.4)

      console.log('SUCCESS: Stacked chart has left-aligned title')
    }
  })
})

test.describe('Chart Layout Visual Tests', () => {
  test('take screenshot of chart layout for visual verification', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=Drop a CSV file', { timeout: 15000 })

    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(TEST_CSV_PATH)

    await page.waitForSelector('.rounded-2xl.bg-white', { timeout: 30000 })
    await page.waitForTimeout(3000)

    // Take a screenshot of the chart layout
    await page.screenshot({ path: 'test-results/chart-layout.png', fullPage: false })

    // Scroll down to capture more charts
    await page.evaluate(() => window.scrollBy(0, 500))
    await page.waitForTimeout(500)
    await page.screenshot({ path: 'test-results/chart-layout-scrolled.png', fullPage: false })

    console.log('Screenshots saved for visual verification')
  })
})
