const { test, expect } = require('@playwright/test');
const { seedApp, dataPayload, readAppData, isoDaysFromToday } = require('../helpers');

// KNOWN-BUG PROBE (review finding #2):
// "Clear All Data" must clear ALL user data. Today it leaves incomeSources,
// recurringExpenses, savings, savingsGoals, decisions, earnedMilestones,
// monthlySnapshots and userName behind — and runAutoLog() then resurrects
// transactions from the surviving recurring sources.
// These tests are EXPECTED TO FAIL until the fix is approved & applied.

function fullState() {
  return dataPayload({
    userName: 'QA Tester',
    transactions: [
      { id: 't1', type: 'income', amount: 100, description: 'Pay', category: 'salary', date: isoDaysFromToday(-1), note: '', createdAt: 1 },
    ],
    budgets: { food: 300 },
    loans: [{ id: 'l1', name: 'Loan', lender: '', total: 1000, interestRate: 5, initialPaid: 0, startDate: isoDaysFromToday(-30), note: '', deductFromBalance: false, payments: [], createdAt: 1 }],
    incomeSources: [{ id: 'src1', name: 'Pay', amount: 100, cycle: 'weekly', nextPay: isoDaysFromToday(-1), startDate: isoDaysFromToday(-8), autoLog: true, lastAutoLogDate: null, note: '', createdAt: 1 }],
    recurringExpenses: [{ id: 'rec1', name: 'Rent', amount: 50, category: 'home', cycle: 'weekly', nextDue: isoDaysFromToday(2), startDate: isoDaysFromToday(-5), active: true, lastAutoLogDate: null, note: '', createdAt: 1 }],
    savings: [{ id: 's1', type: 'deposit', amount: 20, note: '', goalId: null, date: isoDaysFromToday(-2), affectsBalance: false, createdAt: 1 }],
    savingsGoals: [{ id: 'g1', name: 'Goal', emoji: '', target: 500, deadline: null, createdAt: 1 }],
    decisions: [{ id: 'd1', amount: 10, what: 'Thing', zone: 'green', title: 'ok', date: isoDaysFromToday(-3), action: 'yes', createdAt: 1 }],
  });
}

test.describe('Clear All Data', () => {
  test('clears every user-data collection', async ({ page }) => {
    await seedApp(page, { data: fullState() });
    page.on('dialog', d => d.accept()); // two confirm() dialogs
    await page.evaluate(() => window.confirmClearAll());

    const data = await readAppData(page);
    expect(data.transactions, 'transactions cleared').toHaveLength(0);
    expect(Object.keys(data.budgets), 'budgets cleared').toHaveLength(0);
    expect(data.loans, 'loans cleared').toHaveLength(0);
    expect(data.incomeSources, 'incomeSources cleared').toHaveLength(0);
    expect(data.recurringExpenses, 'recurringExpenses cleared').toHaveLength(0);
    expect(data.savings, 'savings cleared').toHaveLength(0);
    expect(data.savingsGoals, 'savingsGoals cleared').toHaveLength(0);
    expect(data.decisions, 'decisions cleared').toHaveLength(0);
  });

  test('cleared app does not resurrect transactions via auto-log on reload', async ({ page }) => {
    await seedApp(page, { data: fullState() });
    page.on('dialog', d => d.accept());
    await page.evaluate(() => window.confirmClearAll());

    await page.reload();
    await page.waitForSelector('.bottom-nav');
    await page.waitForTimeout(500);

    const data = await readAppData(page);
    expect(data.transactions, 'no auto-logged resurrection after Clear All').toHaveLength(0);
  });
});
