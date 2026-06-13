const { test, expect } = require('@playwright/test');
const { seedApp, dataPayload, readAppData, goPage, isoDaysFromToday } = require('../helpers');

function richData() {
  return dataPayload({
    transactions: [
      { id: 't1', type: 'income', amount: 2000, description: 'Pay', category: 'salary', date: isoDaysFromToday(-7), note: '', createdAt: 1 },
      { id: 't2', type: 'expense', amount: 60, description: 'Food', category: 'food', date: isoDaysFromToday(-3), note: '', createdAt: 2 },
      { id: 't3', type: 'expense', amount: 40, description: 'Fuel', category: 'transport', date: isoDaysFromToday(-2), note: '', createdAt: 3 },
    ],
    incomeSources: [{
      id: 'src1', name: 'Pay', amount: 2000, cycle: 'fortnightly',
      nextPay: isoDaysFromToday(7), startDate: isoDaysFromToday(-7),
      autoLog: false, lastAutoLogDate: null, note: '', createdAt: 1,
    }],
    recurringExpenses: [{
      id: 'rec1', name: 'Rent', amount: 500, category: 'home', cycle: 'monthly',
      nextDue: isoDaysFromToday(10), startDate: isoDaysFromToday(-20),
      active: true, lastAutoLogDate: null, note: '', createdAt: 1,
    }],
  });
}

test.describe('Affordability & decisions', () => {
  test('run a check, get verdict with timeline, save decision', async ({ page }) => {
    await seedApp(page, { data: richData() });
    await goPage(page, 'compass');
    await page.click('.compass-cta >> nth=0'); // "Can I afford this?"
    await expect(page.locator('#affordModal')).toHaveClass(/open/);
    await page.fill('#inpAffordAmount', '150');
    await page.fill('#inpAffordWhat', 'New headphones');
    await page.click('#affordInputView .btn-primary');

    await expect(page.locator('#affordResultView')).toBeVisible();
    await expect(page.locator('.afford-hero .afford-badge')).toHaveText(/Buy|Wait|Avoid/);
    await expect(page.locator('.afford-metric')).toHaveCount(4); // Today / Next Pay / 14 Days / Lowest Point
    await expect(page.locator('#affordVerdict')).toContainText('New headphones');

    // save decision
    await page.click('#affordResultView .btn-primary'); // "I'm buying it"
    const data = await readAppData(page);
    expect(data.decisions).toHaveLength(1);
    expect(data.decisions[0]).toMatchObject({ what: 'New headphones', amount: 150, action: 'yes' });
    expect(data.decisions[0].projectionSnapshot).toBeTruthy();
  });

  test('decision history renders saved decisions', async ({ page }) => {
    await seedApp(page, {
      data: dataPayload({
        decisions: [{
          id: 'd1', amount: 99, what: 'Old thing', zone: 'green', verdict: 'buy', title: 'Easily affordable',
          date: isoDaysFromToday(-5), action: 'no', createdAt: 5,
          projectionSnapshot: { todayAfterPurchase: 100, nextPayDate: null, nextPayBalance: null, fourteenDayBalance: 50, lowPointDate: isoDaysFromToday(-1), lowPointBalance: 20, firstNegativeDate: null },
          goalImpact: null,
        }],
      }),
    });
    await goPage(page, 'decisions');
    await expect(page.locator('.decision-item')).toHaveCount(1);
    await expect(page.locator('.decision-what')).toContainText('Old thing');
    await expect(page.locator('.decision-verdict-dot')).toHaveText('Skipped');
  });

  test('free tier blocks 6th saved decision with Pro modal', async ({ page }) => {
    const decisions = Array.from({ length: 5 }, (_, i) => ({
      id: `d${i}`, amount: 10 + i, what: `Item ${i}`, zone: 'green', title: 'ok',
      date: isoDaysFromToday(-1), action: 'yes', createdAt: i,
    }));
    await seedApp(page, { data: dataPayload({ decisions }) });
    await goPage(page, 'compass');
    await page.click('.compass-cta >> nth=0');
    await page.fill('#inpAffordAmount', '20');
    await page.click('#affordInputView .btn-primary');
    await page.click('#affordResultView .btn-primary'); // attempt save #6
    await expect(page.locator('#proModal')).toHaveClass(/open/);
    const data = await readAppData(page);
    expect(data.decisions).toHaveLength(5); // not saved
  });

  test('what-if scenario planner produces comparison and saves', async ({ page }) => {
    await seedApp(page, { flags: { ledger_pro_dev_unlocked_v1: 'yes' }, data: richData() });
    await page.waitForTimeout(500); // billing init
    await goPage(page, 'compass');
    await page.click('.compass-cta >> nth=1'); // "What if?"
    await expect(page.locator('#scenarioModal')).toHaveClass(/open/);
    await page.fill('#inpScenarioName', 'New phone');
    await page.fill('#inpScenarioAmount', '900');
    await page.click('#scenarioInputView .btn-primary');
    await expect(page.locator('#scenarioResultView')).toBeVisible();
    await page.click('#scenarioResultView .btn-primary'); // save
    const data = await readAppData(page);
    expect(data.decisions.some(d => d.action === 'scenario')).toBe(true);
  });

  test('what-if CTA is clean and negative lowest point keeps its minus sign', async ({ page }) => {
    await seedApp(page, {
      flags: { ledger_pro_dev_unlocked_v1: 'yes' },
      data: dataPayload({
        transactions: [
          { id: 't1', type: 'income', amount: 100, description: 'Starting cash', category: 'salary', date: isoDaysFromToday(0), note: '', createdAt: 1 },
        ],
      }),
    });
    await page.waitForTimeout(500); // billing init
    await goPage(page, 'compass');

    await expect(page.locator('.compass-cta').nth(1)).toHaveText('What if?');
    await page.click('.compass-cta >> nth=1');
    await page.fill('#inpScenarioName', 'Large purchase');
    await page.fill('#inpScenarioAmount', '500');
    await page.click('#scenarioInputView .btn-primary');

    const lowestAfter = page.locator('.forecast-summary-card').filter({ hasText: 'Lowest point after' }).locator('strong');
    await expect(lowestAfter).toContainText('-');
  });
});
