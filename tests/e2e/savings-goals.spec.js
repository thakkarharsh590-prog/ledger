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
    await expect(page.locator('#savingsTotalCard')).toContainText('200');
  });

  test('editing a savings entry preserves createdAt', async ({ page }) => {
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
    expect(data.savings[0].createdAt, 'BUG: editing a savings entry wipes createdAt').toBe(1234567);
  });

  test('savings transfers affect balance without inflating income or spent totals', async ({ page }) => {
    await seedApp(page, {
      data: dataPayload({
        transactions: [
          { id: 'income1', type: 'income', amount: 1000, description: 'Pay', category: 'salary', date: isoDaysFromToday(0), note: '', createdAt: 1 },
          { id: 'expense1', type: 'expense', amount: 100, description: 'Food', category: 'food', date: isoDaysFromToday(0), note: '', createdAt: 2 },
        ],
      }),
    });

    await expect(page.locator('#balance')).toHaveText('900.00');
    await expect(page.locator('#totalIncome')).toContainText('1,000.00');
    await expect(page.locator('#totalExpense')).toContainText('100.00');

    await page.evaluate(() => window.goPage('savings'));
    await page.waitForSelector('#page-savings.active');
    await page.evaluate(() => window.openSavingsModal());
    await page.fill('#inpSavingsAmount', '200');
    await page.click('#savingsModal .btn-primary');

    await page.evaluate(() => window.openSavingsModal());
    await page.evaluate(() => window.setSavingsType('withdraw'));
    await page.fill('#inpSavingsAmount', '50');
    await page.click('#savingsModal .btn-primary');

    await page.evaluate(() => window.goPage('home'));
    await page.waitForSelector('#page-home.active');
    await expect(page.locator('#balance')).toHaveText('750.00');
    await expect(page.locator('#totalIncome')).toContainText('1,000.00');
    await expect(page.locator('#totalExpense')).toContainText('100.00');
    await expect(page.locator('#recentList')).toContainText('transfer');

    const totals = await page.evaluate(() => {
      const now = new Date();
      const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const snapshot = window.buildMonthlySnapshot(monthKey);
      const review = window.buildMonthlyReviewData();
      return {
        snapshotIncome: snapshot.incomeTotal,
        snapshotExpense: snapshot.expenseTotal,
        reviewIncome: review.income,
        reviewExpenses: review.expenses,
        reviewTopCategories: review.topCategories.map(c => c.id),
      };
    });

    expect(totals).toMatchObject({
      snapshotIncome: 1000,
      snapshotExpense: 100,
      reviewIncome: 1000,
      reviewExpenses: 100,
    });
    expect(totals.reviewTopCategories).not.toContain('savings');
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
