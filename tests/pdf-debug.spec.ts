import { test, expect } from '@playwright/test'

const TEST_CSV_PATH = '/Users/misakifunada/Desktop/Lululemon_Technical_Design_Test-1765226466306.csv'

test.describe('PDF Export Debug', () => {
  test('debug element dimensions for PDF export', async ({ page }) => {
    // Navigate to the app
    await page.goto('/')

    // Wait for the app to load
    await page.waitForSelector('text=Drop a CSV file', { timeout: 15000 })

    // Upload the test CSV file
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(TEST_CSV_PATH)

    // Wait for charts to render
    await page.waitForSelector('.rounded-2xl.bg-white', { timeout: 30000 })
    await page.waitForTimeout(3000)

    // Get dimensions of key elements
    const dimensions = await page.evaluate(() => {
      // The main content container
      const mainEl = document.querySelector('main')
      // The chart gallery wrapper (the div with ref={chartGalleryRef})
      const chartGalleryEl = document.querySelector('.rounded-2xl.bg-white.p-3')
      // First chart card
      const firstChartCard = document.querySelector('.rounded-2xl.bg-white.p-3 > div')

      const getElementInfo = (el: Element | null, name: string) => {
        if (!el) return { name, exists: false }
        const rect = el.getBoundingClientRect()
        const style = window.getComputedStyle(el)
        return {
          name,
          exists: true,
          clientWidth: (el as HTMLElement).clientWidth,
          clientHeight: (el as HTMLElement).clientHeight,
          scrollWidth: (el as HTMLElement).scrollWidth,
          scrollHeight: (el as HTMLElement).scrollHeight,
          offsetWidth: (el as HTMLElement).offsetWidth,
          offsetHeight: (el as HTMLElement).offsetHeight,
          boundingRect: {
            width: rect.width,
            height: rect.height,
            left: rect.left,
            top: rect.top
          },
          overflow: style.overflow,
          overflowX: style.overflowX,
          overflowY: style.overflowY,
          width: style.width,
          maxWidth: style.maxWidth,
          minWidth: style.minWidth
        }
      }

      return {
        viewport: {
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight
        },
        main: getElementInfo(mainEl, 'main'),
        chartGallery: getElementInfo(chartGalleryEl, 'chartGallery'),
        firstChartCard: getElementInfo(firstChartCard, 'firstChartCard')
      }
    })

    console.log('\n=== VIEWPORT ===')
    console.log(JSON.stringify(dimensions.viewport, null, 2))

    console.log('\n=== MAIN ELEMENT ===')
    console.log(JSON.stringify(dimensions.main, null, 2))

    console.log('\n=== CHART GALLERY ELEMENT ===')
    console.log(JSON.stringify(dimensions.chartGallery, null, 2))

    console.log('\n=== FIRST CHART CARD ===')
    console.log(JSON.stringify(dimensions.firstChartCard, null, 2))

    // Check if scrollWidth > clientWidth (indicates horizontal overflow)
    if (dimensions.chartGallery.exists) {
      const hasHorizontalOverflow = dimensions.chartGallery.scrollWidth > dimensions.chartGallery.clientWidth
      console.log(`\n=== OVERFLOW CHECK ===`)
      console.log(`Has horizontal overflow: ${hasHorizontalOverflow}`)
      console.log(`Overflow amount: ${dimensions.chartGallery.scrollWidth - dimensions.chartGallery.clientWidth}px`)
    }

    // Now check individual chart containers
    const chartContainerInfo = await page.evaluate(() => {
      const containers = document.querySelectorAll('[style*="width: 95%"]')
      return Array.from(containers).slice(0, 3).map((el, i) => {
        const rect = el.getBoundingClientRect()
        return {
          index: i,
          scrollWidth: (el as HTMLElement).scrollWidth,
          clientWidth: (el as HTMLElement).clientWidth,
          boundingWidth: rect.width,
          innerHTML: el.innerHTML.substring(0, 100)
        }
      })
    })

    console.log('\n=== CHART CONTAINERS (first 3) ===')
    chartContainerInfo.forEach(info => {
      console.log(`Container ${info.index}: scrollWidth=${info.scrollWidth}, clientWidth=${info.clientWidth}, boundingWidth=${info.boundingWidth}`)
    })

    // Check ResponsiveContainer elements from Recharts
    const responsiveContainerInfo = await page.evaluate(() => {
      const containers = document.querySelectorAll('.recharts-responsive-container')
      return Array.from(containers).slice(0, 3).map((el, i) => {
        const rect = el.getBoundingClientRect()
        const svg = el.querySelector('svg')
        const svgRect = svg?.getBoundingClientRect()
        return {
          index: i,
          containerWidth: rect.width,
          containerHeight: rect.height,
          svgWidth: svgRect?.width,
          svgHeight: svgRect?.height,
          svgViewBox: svg?.getAttribute('viewBox')
        }
      })
    })

    console.log('\n=== RECHARTS RESPONSIVE CONTAINERS (first 3) ===')
    responsiveContainerInfo.forEach(info => {
      console.log(`Chart ${info.index}: containerWidth=${info.containerWidth}, svgWidth=${info.svgWidth}, viewBox=${info.svgViewBox}`)
    })
  })
})
