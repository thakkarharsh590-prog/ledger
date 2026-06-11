const { test, expect } = require('@playwright/test');
const { seedApp, dataPayload, readAppData, isoDaysFromToday } = require('../helpers');

// KNOWN-BUG PROBE (review finding #3):
// restoreFromRecovery() hand-copies only pre-v2.4 fields and silently drops
// savings, savingsGoals, earnedMilestones, monthlySnapshots, alertSettings,
// and userName. Expected to FAIL until the fix is approved & applied.

test.describe('Recovery mode', () => {
  test('empty install with a snapshot offers recovery banner', async ({ page }) => {
    const snapshot = dataPayload({
      transactions: [{ id: 't1', type: 'income', amount: 500, description: 'Pay', category: 'salary', date: isoDaysFromToday(-3), note: '', createdAt: 1 }],
    });
    await seedApp(page, {
      flags: {
        recovery_dismissed: '', // allow banner
        ['ledger_snap_' + isoDaysFromToday(-1)]: JSON.stringify(snapshot),
      },
    });
    await expect(page.locator('#recoveryBanner')).toBeVisible();
    await expect(page.locator('#recoveryBanner')).toContainText('1 transactions');
  });

  test('restore preserves ALL fields including savings, goals, and userName', async ({ page }) => {
    const snapshot = dataPayload({
      userName: 'Snapshot User',
      transactions: [{ id: 't1', type: 'income', amount: 500, description: 'Pay', category: 'salary', date: isoDaysFromToday(-3), note: '', createdAt: 1 }],
      savings: [{ id: 's1', type: 'deposit', amount: 75, note: '', goalId: 'g1', date: isoDaysFromToday(-4), affectsBalance: false, createdAt: 1 }],
      savingsGoals: [{ id: 'g1', name: 'Holiday', emoji: '', target: 2000, deadline: null, createdAt: 1 }],
      earnedMilestones: { first_save: 1700000000000 },
    });
    await seedApp(page, {
      flags: {
        recovery_dismissed: '',
        ['ledger_snap_' + isoDaysFromToday(-1)]: JSON.stringify(snapshot),
      },
    });
    await expect(page.locator('#recoveryBanner')).toBeVisible();
    page.once('dialog', d => d.accept());
    await page.click('.recovery-restore');

    const data = await readAppData(page);
    expect(data.transactions, 'transactions restored').toHaveLength(1);
    expect(data.savings, 'BUG: savings dropped by restoreFromRecovery').toHaveLength(1);
    expect(data.savingsGoals, 'BUG: savingsGoals dropped by restoreFromRecovery').toHaveLength(1);
    expect(data.userName, 'BUG: userName dropped by restoreFromRecovery').toBe('Snapshot User');
    expect(Object.keys(data.earnedMilestones || {}), 'BUG: milestones dropped').toHaveLength(1);
  });

  test('"Start fresh" dismisses and persists across reload', async ({ page }) => {
    const snapshot = dataPayload({
      transactions: [{ id: 't1', type: 'income', amount: 500, description: 'Pay', category: 'salary', date: isoDaysFromToday(-3), note: '', createdAt: 1 }],
    });
    await seedApp(page, {
      flags: {
        recovery_dismissed: '',
        ['ledger_snap_' + isoDaysFromToday(-1)]: JSON.stringify(snapshot),
      },
    });
    await expect(page.locator('#recoveryBanner')).toBeVisible();
    await page.click('.recovery-dismiss');
    await expect(page.locator('#recoveryBanner')).toHaveCount(0);
    await page.reload();
    await page.waitForSelector('.bottom-nav');
    await page.waitForTimeout(500);
    await expect(page.locator('#recoveryBanner')).toHaveCount(0);
  });
});
