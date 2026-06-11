const { test, expect } = require('@playwright/test');
const { seedApp, dataPayload, readAppData, isoDaysFromToday } = require('../helpers');

test.describe('Savings & goals', () => {
  test('create goal, deposit toward it (affecting balance), verify linked expense tx', async ({ page }) => {
    await seedApp(page, { data: dataPayload() });
    await page.evaluate(() => window.goPage('savings'));
    await page.waitForSelector('#page-savings.active');

    // goal
    await page.evaluate(() => window.openGoalModal());
    await page.fill('#inpGoalName', 'Emergency fund');
    await page.fill('#inpGoalTarget', '1000');
    await page.click('#goalModal .btn-primary');
    let data = await readAppData(page);
    expect(data.savingsGoals).toHaveLength(1);

    // deposit
    await page.evaluate(() => window.openSavingsModal());
    await page.fill('#inpSavingsAmount', '200');
    await page.selectOption('#inpSavingsGoal', data.savingsGoals[0].id);
    await page.click('#savingsModal .btn-primary');
    data = await readAppData(page);
    expect(data.savings).toHaveLength(1);
    expect(data.savings[0]).toMatchObject({ type: 'deposit', amount: 200 });
    // affectsBalance default ON → linked expense transaction
    const linked = data.transactions.filter(t => t.savingsId);
    expect(linked).toHaveLength(1);
    expect(linked[0]).toMatchObject({ type: 'expense', amount: 200, category: 'savings' });

    // progress shows on savings page
    await expect(page.locator('#goalsList')).toContainText('Emergency fund');
    await expect(page.locator('#goalsList')).toContainText('20%');
  });

  test('editing a savings entry preserves createdAt (known-bug probe)', async ({ page }) => {
    await seedApp(page, {
      data: dataPayload({
        savings: [{ id: 's1', type: 'deposit', amount: 50, note: '', goalId: null, date: isoDaysFromToday(-1), affectsBalance: false, createdAt: 1234567 }],
      }),
    });
    await page.evaluate(() => window.goPage('savings'));
    await page.waitForSelector('#page-savings.active');
    await page.evaluate(() => window.openSavingsModal('s1'));
    await page.fill('#inpSavingsAmount', '75');
    await page.click('#savingsModal .btn-primary');
    const data = await readAppData(page);
    expect(data.savings[0].amount).toBe(75);
    // KNOWN BUG #7 (review): edit spreads createdAt: undefined over the record
    expect(data.savings[0].createdAt, 'BUG: editing a savings entry wipes createdAt').toBe(1234567);
  });

  test('free tier allows only 2 goals, third opens Pro modal', async ({ page }) => {
    await seedApp(page, {
      data: dataPayload({
        savingsGoals: [
          { id: 'g1', name: 'A', emoji: '', target: 10, deadline: null, createdAt: 1 },
          { id: 'g2', name: 'B', emoji: '', target: 10, deadline: null, createdAt: 2 },
        ],
      }),
    });
    await page.evaluate(() => window.goPage('savings'));
    await page.waitForSelector('#page-savings.active');
    await page.evaluate(() => window.openGoalModal());
    await expect(page.locator('#goalModal')).not.toHaveClass(/open/);
    await expect(page.locator('#proModal')).toHaveClass(/open/);
  });

  test('QA Pro unlock lifts the goal limit', async ({ page }) => {
    await seedApp(page, {
      flags: { ledger_pro_dev_unlocked_v1: 'yes' },
      data: dataPayload({
        savingsGoals: [
          { id: 'g1', name: 'A', emoji: '', target: 10, deadline: null, createdAt: 1 },
          { id: 'g2', name: 'B', emoji: '', target: 10, deadline: null, createdAt: 2 },
        ],
      }),
    });
    // wait for billing init to apply QA pro
    await page.waitForTimeout(500);
    await page.evaluate(() => window.goPage('savings'));
    await page.waitForSelector('#page-savings.active');
    await page.evaluate(() => window.openGoalModal());
    await expect(page.locator('#goalModal')).toHaveClass(/open/);
  });
});
