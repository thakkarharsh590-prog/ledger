const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { seedApp, dataPayload, goPage, isoDaysFromToday } = require('../helpers');

const PAGES = ['home', 'compass', 'stats', 'loans', 'profile'];

function seededData() {
  return dataPayload({
    transactions: [
      { id: 't1', type: 'income', amount: 2000, description: 'Pay', category: 'salary', date: isoDaysFromToday(-5), note: '', createdAt: 1 },
      { id: 't2', type: 'expense', amount: 80, description: 'Food', category: 'food', date: isoDaysFromToday(-2), note: '', createdAt: 2 },
    ],
    loans: [{ id: 'l1', name: 'Car', lender: 'Bank', total: 5000, interestRate: 7, initialPaid: 500, startDate: isoDaysFromToday(-90), note: '', deductFromBalance: false, payments: [], createdAt: 1 }],
    savingsGoals: [{ id: 'g1', name: 'Trip', emoji: '', target: 900, deadline: null, createdAt: 1 }],
  });
}

for (const pageName of PAGES) {
  test(`a11y: no serious/critical axe violations on ${pageName}`, async ({ page }) => {
    await seedApp(page, { data: seededData() });
    if (pageName !== 'home') await goPage(page, pageName);
    await page.waitForTimeout(400); // let renders settle

    const results = await new AxeBuilder({ page }).analyze();

    const bad = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
    const summary = bad.map(v => `${v.impact}: ${v.id} — ${v.help} (${v.nodes.length} nodes)`).join('\n');
    expect(bad, `Axe violations on ${pageName}:\n${summary}`).toHaveLength(0);
  });
}
