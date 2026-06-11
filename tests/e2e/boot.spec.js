const { test, expect } = require('@playwright/test');
const { seedApp, dataPayload, APP_URL } = require('../helpers');

test.describe('App boot', () => {
  test('boots clean with seeded data: no console errors, no failed requests', async ({ page }) => {
    const { consoleErrors, failedRequests } = await seedApp(page, { data: dataPayload() });
    await expect(page.locator('#balance')).toHaveText('0.00');
    await expect(page.locator('.brand-word')).toHaveText('CapAhead');
    // settle: init timers (tour/setup checks fire at 700-2000ms)
    await page.waitForTimeout(2500);
    expect(consoleErrors, `Console errors: ${consoleErrors.join('\n')}`).toHaveLength(0);
    expect(failedRequests, `Failed requests: ${failedRequests.join('\n')}`).toHaveLength(0);
    // no recovery overlay, no setup wizard, no tour
    await expect(page.locator('#launchRecoveryOverlay')).toHaveCount(0);
    await expect(page.locator('#setupWizard')).toBeHidden();
    await expect(page.locator('#tourOverlay')).toBeHidden();
  });

  test('first run on empty install opens the setup wizard', async ({ page }) => {
    await seedApp(page, { firstRun: true, flags: { ledger_last_bust: String(Date.now()) } });
    await expect(page.locator('#setupWizard')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#setupTitle')).toContainText('Set up CapAhead');
  });

  test('balance reflects seeded transactions', async ({ page }) => {
    await seedApp(page, {
      data: dataPayload({
        transactions: [
          { id: 't1', type: 'income', amount: 1000, description: 'Pay', category: 'salary', date: '2026-06-01', note: '', createdAt: 1 },
          { id: 't2', type: 'expense', amount: 250.5, description: 'Groceries', category: 'food', date: '2026-06-02', note: '', createdAt: 2 },
        ],
      }),
    });
    await expect(page.locator('#balance')).toHaveText('749.50');
    await expect(page.locator('#totalIncome')).toContainText('1,000.00');
    await expect(page.locator('#totalExpense')).toContainText('250.50');
  });

  test('corrupt saved data shows recovery UI instead of blank app', async ({ page }) => {
    await seedApp(page, { flags: { ledger_data_v1: '{not valid json!!' } });
    await expect(page.locator('#launchRecoveryOverlay')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#launchRecoveryOverlay')).toContainText('CapAhead recovery');
  });
});
