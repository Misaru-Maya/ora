import { test } from '@playwright/test';

test('open browser and upload file', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('text=Drop a CSV file', { timeout: 15000 });
  
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles('/Users/misakifunada/Downloads/All_data_-_Test_3_White_Leather_Trainer_Styles_Evaluation-1765499395332.csv');
  
  await page.waitForSelector('.rounded-2xl.bg-white', { timeout: 30000 });
  
  console.log('File uploaded! Browser will stay open.');
  
  // Keep browser open for 10 minutes
  await page.waitForTimeout(600000);
});
