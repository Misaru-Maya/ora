import { test, expect } from '@playwright/test'

const TEST_CSV_PATH = '/Users/misakifunada/Desktop/Lululemon_Technical_Design_Test-1765226466306.csv'

test.describe('Pie Chart Resize Debug', () => {
  test('compare resize handle behavior between pie and bar charts', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=Drop a CSV file', { timeout: 15000 })

    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(TEST_CSV_PATH)

    await page.waitForSelector('.rounded-2xl.bg-white', { timeout: 30000 })
    await page.waitForTimeout(3000)

    // Find pie toggle buttons (title="Pie chart" per the actual code)
    const pieToggleButtons = page.locator('button[title="Pie chart"]')
    const pieButtonCount = await pieToggleButtons.count()
    console.log(`Found ${pieButtonCount} pie toggle buttons`)

    if (pieButtonCount > 0) {
      // Scroll to the first pie toggle and click it
      await pieToggleButtons.first().scrollIntoViewIfNeeded()
      await pieToggleButtons.first().click()
      await page.waitForTimeout(1000)

      // Find the chart card that contains this pie chart
      const pieChartCard = pieToggleButtons.first().locator('xpath=ancestor::div[contains(@class, "shadow-md")]')

      // Get dimensions from JavaScript to understand the layout
      const dimensions = await page.evaluate(() => {
        const handles = document.querySelectorAll('div[style*="ew-resize"]')
        const results: any[] = []

        handles.forEach((handle, i) => {
          const handleEl = handle as HTMLElement
          const handleRect = handleEl.getBoundingClientRect()

          // Find the parent chart container
          let parent = handleEl.parentElement
          while (parent && !parent.classList.contains('shadow-md')) {
            parent = parent.parentElement
          }

          // Find the chart content (the white box with shadow)
          const chartContent = parent?.querySelector('div[style*="box-shadow"][style*="border-radius: 20px"]') as HTMLElement
          const contentRect = chartContent?.getBoundingClientRect()

          // Check what type of chart this is
          const isPie = chartContent?.style.width.includes('fit-content') ||
                       (chartContent?.style.width.includes('px') && !chartContent?.style.width.includes('%'))

          results.push({
            index: i,
            handleX: handleRect.x,
            handleY: handleRect.y,
            contentRight: contentRect ? contentRect.x + contentRect.width : null,
            contentWidth: contentRect?.width,
            contentStyle: chartContent?.style.width,
            isPie,
            distanceFromContent: contentRect ? handleRect.x - (contentRect.x + contentRect.width) : null
          })
        })

        return results.slice(0, 5)  // First 5 only
      })

      console.log('\n=== HANDLE POSITIONS ===')
      dimensions.forEach(d => {
        console.log(`Handle ${d.index}: x=${d.handleX?.toFixed(1)}, content right=${d.contentRight?.toFixed(1)}, ` +
                   `distance=${d.distanceFromContent?.toFixed(1)}px, isPie=${d.isPie}, contentWidth=${d.contentStyle}`)
      })

      // Test dragging the first visible handle
      const firstHandle = page.locator('div[style*="cursor: ew-resize"]').first()
      await firstHandle.scrollIntoViewIfNeeded()

      const beforeDrag = await firstHandle.boundingBox()
      console.log('\n=== DRAG TEST ===')
      console.log('Before drag:', beforeDrag)

      // Get chart container width before drag
      const beforeWidth = await page.evaluate(() => {
        const containers = document.querySelectorAll('div[style*="box-shadow"][style*="border-radius: 20px"]')
        if (containers.length > 0) {
          return (containers[0] as HTMLElement).offsetWidth
        }
        return null
      })
      console.log('Chart container width before:', beforeWidth)

      if (beforeDrag) {
        // Drag LEFT to shrink (since we're at max, dragging right won't work)
        await page.mouse.move(beforeDrag.x + 10, beforeDrag.y + 40)
        await page.mouse.down()
        await page.mouse.move(beforeDrag.x - 100, beforeDrag.y + 40, { steps: 20 })
        await page.waitForTimeout(100)
        await page.mouse.up()

        await page.waitForTimeout(500)

        const afterDrag = await firstHandle.boundingBox()
        console.log('After drag:', afterDrag)

        // Get chart container width after drag
        const afterWidth = await page.evaluate(() => {
          const containers = document.querySelectorAll('div[style*="box-shadow"][style*="border-radius: 20px"]')
          if (containers.length > 0) {
            return (containers[0] as HTMLElement).offsetWidth
          }
          return null
        })
        console.log('Chart container width after:', afterWidth)

        if (afterDrag) {
          console.log(`Handle moved: ${(afterDrag.x - beforeDrag.x).toFixed(1)}px`)
        }
        if (beforeWidth && afterWidth) {
          console.log(`Container width changed: ${afterWidth - beforeWidth}px`)
        }
      }
    } else {
      console.log('No pie chart toggle buttons found - checking bar chart handles')

      // Just test a bar chart handle
      const handles = page.locator('div[style*="cursor: ew-resize"]')
      const handleCount = await handles.count()
      console.log(`Found ${handleCount} resize handles`)

      if (handleCount > 0) {
        const firstHandle = handles.first()
        await firstHandle.scrollIntoViewIfNeeded()

        const beforeDrag = await firstHandle.boundingBox()
        console.log('Bar handle before drag:', beforeDrag)

        if (beforeDrag) {
          await page.mouse.move(beforeDrag.x + 10, beforeDrag.y + 40)
          await page.mouse.down()
          await page.mouse.move(beforeDrag.x - 100, beforeDrag.y + 40, { steps: 20 })
          await page.waitForTimeout(100)
          await page.mouse.up()

          await page.waitForTimeout(500)

          const afterDrag = await firstHandle.boundingBox()
          console.log('Bar handle after drag:', afterDrag)

          if (afterDrag) {
            console.log(`Handle moved: ${(afterDrag.x - beforeDrag.x).toFixed(1)}px`)
          }
        }
      }
    }
  })
})
