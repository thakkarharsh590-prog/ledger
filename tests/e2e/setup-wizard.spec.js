const { test, expect } = require('@playwright/test');
const { seedApp, readAppData, isoDaysFromToday } = require('../helpers');

test.describe('Setup wizard', () => {
  test('full walkthrough creates opening balance, income source, and bill', async ({ page }) => {
    await seedApp(page, { firstRun: true, flags: { ledger_last_bust: String(Date.now()) } });
    await expect(page.locator('#setupWizard')).toBeVisible({ timeout: 5000 });

    // Step 0: name
    await page.fill('#setupName', 'QA Tester');
    await page.click('#setupNextBtn');

    // Step 1: balance
    await page.fill('#setupBalance', '1500');
    await page.click('#setupNextBtn');

    // Step 2: income
    await page.fill('#setupIncomeName', 'Main Job');
    await page.fill('#setupIncomeAmount', '2000');
    await page.click('.setup-cycle-btn:has-text("Fortnightly")');
    await page.fill('#setupNextPay', isoDaysFromToday(3));
    await page.click('#setupNextBtn');

    // Step 3: one bill
    await page.fill('#setupBillName', 'Rent');
    await page.fill('#setupBillAmount', '400');
    await page.fill('#setupBillDue', isoDaysFromToday(5));
    await page.click('button:has-text("Add bill")');
    await expect(page.locator('.setup-bill-name')).toHaveText('Rent');
    await page.click('#setupNextBtn');

    // Step 4: summary → finish
    await expect(page.locator('.setup-summary-grid')).toBeVisible();
    await page.click('#setupNextBtn');

    // Lands on Compass
    await expect(page.locator('#page-compass.active')).toBeVisible();
    await expect(page.locator('#setupWizard')).toBeHidden();

    const data = await readAppData(page);
    expect(data.userName).toBe('QA Tester');
    expect(data.transactions.some(t => t.description === 'Opening balance' && t.amount === 1500)).toBe(true);
    expect(data.incomeSources).toHaveLength(1);
    expect(data.incomeSources[0]).toMatchObject({ name: 'Main Job', amount: 2000, cycle: 'fortnightly' });
    expect(data.recurringExpenses).toHaveLength(1);
    expect(data.recurringExpenses[0]).toMatchObject({ name: 'Rent', amount: 400, active: true });
  });

  test('validation blocks empty balance and bad income', async ({ page }) => {
    await seedApp(page, { firstRun: true, flags: { ledger_last_bust: String(Date.now()) } });
    await expect(page.locator('#setupWizard')).toBeVisible({ timeout: 5000 });
    await page.click('#setupNextBtn'); // step 0 -> 1
    await page.click('#setupNextBtn'); // empty balance
    await expect(page.locator('#setupError')).toBeVisible();
    await page.fill('#setupBalance', '0');
    await page.click('#setupNextBtn');
    await page.click('#setupNextBtn'); // empty income name
    await expect(page.locator('#setupError')).toBeVisible();
  });

  test('skip exits and does not recreate wizard on reload', async ({ page }) => {
    await seedApp(page, { firstRun: true, flags: { ledger_last_bust: String(Date.now()) } });
    await expect(page.locator('#setupWizard')).toBeVisible({ timeout: 5000 });
    await page.click('#setupSkipBtn');
    await expect(page.locator('#setupWizard')).toBeHidden();
    await page.reload();
    await page.waitForSelector('.bottom-nav');
    await page.waitForTimeout(1500);
    await expect(page.locator('#setupWizard')).toBeHidden();
  });
});
