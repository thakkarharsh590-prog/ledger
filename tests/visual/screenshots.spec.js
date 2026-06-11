const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { seedApp, dataPayload, goPage, isoDaysFromToday } = require('../helpers');

const SHOT_DIR = path.resolve(__dirname, '../../test-results/screenshots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 667 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];
const PAGES = ['home', 'compass', 'stats', 'loans', 'profile'];

function seededData() {
  return dataPayload({
    userName: 'QA Tester',
    transactions: [
      { id: 't1', type: 'income', amount: 2000, description: 'Salary', category: 'salary', date: isoDaysFromToday(-5), note: '', createdAt: 1 },
      { id: 't2', type: 'expense', amount: 80.25, description: 'Groceries', category: 'food', date: isoDaysFromToday(-2), note: '', createdAt: 2 },
      { id: 't3', type: 'expense', amount: 45, description: 'Fuel', category: 'transport', date: isoDaysFromToday(-1), note: '', createdAt: 3 },
    ],
    incomeSources: [{ id: 'src1', name: 'Salary', amount: 2000, cycle: 'fortnightly', nextPay: isoDaysFromToday(9), startDate: isoDaysFromToday(-5), autoLog: false, lastAutoLogDate: null, note: '', createdAt: 1 }],
    recurringExpenses: [{ id: 'rec1', name: 'Rent', amount: 600, category: 'home', cycle: 'monthly', nextDue: isoDaysFromToday(12), startDate: isoDaysFromToday(-18), active: true, lastAutoLogDate: null, note: '', createdAt: 1 }],
    loans: [{ id: 'l1', name: 'Car Loan', lender: 'Bank', total: 8000, interestRate: 7, initialPaid: 2000, startDate: isoDaysFromToday(-200), note: '', deductFromBalance: false, payments: [], createdAt: 1 }],
    savingsGoals: [{ id: 'g1', name: 'Holiday', emoji: '', target: 3000, deadline: isoDaysFromToday(120), createdAt: 1 }],
    budgets: { food: 400 },
  });
}

for (const vp of VIEWPORTS) {
  test.describe(`viewport ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test(`renders all pages without layout collapse (${vp.name})`, async ({ page }) => {
      const { consoleErrors } = await seedApp(page, { data: seededData() });
      for (const pageName of PAGES) {
        if (pageName !== 'home') await goPage(page, pageName);
        await page.waitForTimeout(350);

        // sanity: page content has real height and no horizontal overflow
        const metrics = await page.evaluate(() => ({
          pageHeight: document.querySelector('.page.active').scrollHeight,
          overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        }));
        expect(metrics.pageHeight, `${pageName} renders content`).toBeGreaterThan(100);
        expect(metrics.overflowX, `${pageName} has no horizontal overflow at ${vp.name}`).toBeLessThanOrEqual(1);

        await page.screenshot({
          path: `${SHOT_DIR}/${pageName}__${vp.name}.png`,
          fullPage: true,
        });
      }
      expect(consoleErrors, `Console errors: ${consoleErrors.join('\n')}`).toHaveLength(0);
    });
  });
}
