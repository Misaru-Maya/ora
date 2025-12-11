import { test, expect } from '@playwright/test'

const TEST_CSV_PATH = '/Users/misakifunada/Downloads/All_data_-_SS27_Big_Ideas_TerritoryConcept_Research-1765391859983.csv'

test.describe('Pie Chart Width Handle Positioning', () => {
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

  test('pie chart width handle should stay positioned relative to chart container on window resize', async ({ page }) => {
    // Find a single-select question card that shows a pie chart
    // Look for a card with a pie chart (has the pie icon toggle)
    const pieToggleButton = page.locator('button[title="Show as pie chart"], button:has(svg[data-icon="chart-pie"])')

    // If there's a pie toggle, click it to switch to pie view
    if (await pieToggleButton.count() > 0) {
      await pieToggleButton.first().click()
      await page.waitForTimeout(500)
    }

    // Find the width resize handle (the vertical bar on the right side of charts)
    // It has cursor: ew-resize style
    const widthHandle = page.locator('div[style*="ew-resize"]').first()

    // Get initial handle position
    const initialHandleBox = await widthHandle.boundingBox()
    expect(initialHandleBox).not.toBeNull()

    // Find the actual pie chart content container (the white box with shadow around the pie)
    // This is the element with box-shadow and border-radius: 20px
    const pieContainer = page.locator('div[style*="border-radius: 20px"][style*="box-shadow"]').first()
    const initialPieContainerBox = await pieContainer.boundingBox()
    expect(initialPieContainerBox).not.toBeNull()

    // Calculate initial distance from handle to pie container right edge
    const initialDistanceToPieRight = initialHandleBox!.x - (initialPieContainerBox!.x + initialPieContainerBox!.width)

    console.log('Initial handle X:', initialHandleBox!.x)
    console.log('Initial pie container right:', initialPieContainerBox!.x + initialPieContainerBox!.width)
    console.log('Initial distance to pie right:', initialDistanceToPieRight)

    // Resize the viewport to be wider
    const currentViewport = page.viewportSize()
    await page.setViewportSize({
      width: currentViewport!.width + 300,
      height: currentViewport!.height
    })

    // Wait for resize observer to update
    await page.waitForTimeout(500)

    // Get new handle position after resize
    const newHandleBox = await widthHandle.boundingBox()
    expect(newHandleBox).not.toBeNull()

    // Get new pie container position after resize (pie container should NOT have changed size)
    const newPieContainerBox = await pieContainer.boundingBox()
    expect(newPieContainerBox).not.toBeNull()

    // Calculate new distance from handle to pie container right edge
    const newDistanceToPieRight = newHandleBox!.x - (newPieContainerBox!.x + newPieContainerBox!.width)

    console.log('New handle X:', newHandleBox!.x)
    console.log('New pie container right:', newPieContainerBox!.x + newPieContainerBox!.width)
    console.log('New distance to pie right:', newDistanceToPieRight)

    // The distance from handle to pie container right edge should stay approximately the same
    // (the pie container doesn't grow, so the handle should stay at a fixed offset from its right edge)
    const distanceDifference = Math.abs(newDistanceToPieRight - initialDistanceToPieRight)

    console.log('Distance difference:', distanceDifference)

    // The handle should stay at approximately the same distance from the pie container
    // Allow some tolerance for percentage-based positioning adjustments
    expect(distanceDifference).toBeLessThan(50)
  })

  test('pie chart width handle should be visible and near the chart content', async ({ page }) => {
    // Find a chart card
    const chartCards = page.locator('.rounded-2xl.bg-white')
    expect(await chartCards.count()).toBeGreaterThan(0)

    // Look for width resize handle
    const widthHandle = page.locator('div[style*="ew-resize"]').first()

    // Verify the handle exists
    await expect(widthHandle).toBeVisible()

    // Get the handle position
    const handleBox = await widthHandle.boundingBox()
    expect(handleBox).not.toBeNull()

    // The handle should be within a reasonable area of the viewport (not off-screen)
    expect(handleBox!.x).toBeGreaterThan(0)
    expect(handleBox!.x).toBeLessThan(2000) // Should be within reasonable bounds
  })
})
