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

    const lowestAfter = page.locator('.forecast-summary-card').filter({ hasText: 'Near-term floor after' }).locator('strong');
    await expect(lowestAfter).toContainText('-');
  });

  test('what-if loan adds borrowed cash and does not delay funded goal', async ({ page }) => {
    await seedApp(page, {
      flags: { ledger_pro_dev_unlocked_v1: 'yes' },
      data: dataPayload({
        transactions: [
          { id: 't1', type: 'income', amount: 300, description: 'Starting cash', category: 'salary', date: isoDaysFromToday(0), note: '', createdAt: 1 },
        ],
        savingsGoals: [
          { id: 'tr', name: 'TR', target: 4600, deadline: isoDaysFromToday(84), createdAt: Date.now() - 86400000 * 14 },
        ],
      }),
    });
    await page.waitForTimeout(500);
    await goPage(page, 'compass');
    await page.click('.compass-cta >> nth=1');
    await page.locator('.scenario-type').filter({ hasText: 'Take a loan' }).click();
    await page.fill('#inpScenarioName', '5000');
    await page.fill('#inpScenarioAmount', '5000');
    await page.click('#scenarioInputView .btn-primary');

    const text = await page.locator('#scenarioResult').innerText();
    expect(text).toContain('borrowed cash');
    expect(text).toContain('estimated repayments');
    expect(text).toContain('TR would be funded now');
    expect(text).not.toContain('move back by about 84');
    const cashDelta = await page.evaluate(() => state.pendingScenario.cashDelta60);
    expect(cashDelta).toBeGreaterThan(4500);
  });

  test('what-if cancel bill removes recurring bill occurrences and avoids zero-day copy', async ({ page }) => {
    await seedApp(page, {
      flags: { ledger_pro_dev_unlocked_v1: 'yes' },
      data: dataPayload({
        transactions: [
          { id: 't1', type: 'income', amount: 1000, description: 'Starting cash', category: 'salary', date: isoDaysFromToday(0), note: '', createdAt: 1 },
        ],
        recurringExpenses: [
          { id: 'amazon', name: 'Amazon', amount: 9.99, category: 'subs', cycle: 'monthly', nextDue: isoDaysFromToday(1), startDate: isoDaysFromToday(-29), active: true, createdAt: 1 },
        ],
        savingsGoals: [
          { id: 'tr', name: 'TR', target: 4600, deadline: isoDaysFromToday(30), createdAt: Date.now() - 86400000 * 30 },
        ],
      }),
    });
    await page.waitForTimeout(500);
    await goPage(page, 'compass');
    await page.click('.compass-cta >> nth=1');
    await page.locator('.scenario-type').filter({ hasText: 'Cancel bill' }).click();
    await page.selectOption('#inpScenarioBill', 'amazon');
    await page.click('#scenarioInputView .btn-primary');

    const text = await page.locator('#scenarioResult').innerText();
    expect(text).toContain('Removes Amazon');
    expect(text).toContain('date is unchanged, but this frees');
    expect(text).not.toContain('about 0 days');
    const pending = await page.evaluate(() => ({
      cashDelta60: state.pendingScenario.cashDelta60,
      removed: state.pendingScenario.scenarioExplanation,
    }));
    expect(pending.cashDelta60).toBeGreaterThanOrEqual(19.9);
    expect(pending.removed).toContain('Amazon');
  });

  test('what-if reduce spend caps savings at current average spend', async ({ page }) => {
    await seedApp(page, {
      flags: { ledger_pro_dev_unlocked_v1: 'yes' },
      data: dataPayload({
        transactions: [
          { id: 't1', type: 'income', amount: 1000, description: 'Starting cash', category: 'salary', date: isoDaysFromToday(0), note: '', createdAt: 1 },
          { id: 't2', type: 'expense', amount: 10, description: 'Snack', category: 'food', date: isoDaysFromToday(-1), note: '', createdAt: 2 },
        ],
      }),
    });
    await page.waitForTimeout(500);
    await goPage(page, 'compass');
    await page.click('.compass-cta >> nth=1');
    await page.locator('.scenario-type').filter({ hasText: 'Reduce spend' }).click();
    await page.fill('#inpScenarioName', 'Cut everything');
    await page.fill('#inpScenarioAmount', '100');
    await page.click('#scenarioInputView .btn-primary');

    const pending = await page.evaluate(() => ({
      cashDelta60: state.pendingScenario.cashDelta60,
      explanation: state.pendingScenario.scenarioExplanation,
    }));
    expect(pending.explanation).toContain('capped at your current average spending');
    expect(pending.cashDelta60).toBeCloseTo(600, 1);
  });

  test('what-if boost goal compares amounts against the same goal', async ({ page }) => {
    await seedApp(page, {
      flags: { ledger_pro_dev_unlocked_v1: 'yes' },
      data: dataPayload({
        transactions: [
          { id: 't1', type: 'income', amount: 2000, description: 'Starting cash', category: 'salary', date: isoDaysFromToday(0), note: '', createdAt: 1 },
        ],
        savingsGoals: [
          { id: 'tr', name: 'TR', target: 1000, deadline: isoDaysFromToday(70), createdAt: Date.now() - 86400000 * 10 },
        ],
      }),
    });
    await page.waitForTimeout(500);
    await goPage(page, 'compass');
    await page.click('.compass-cta >> nth=1');
    await page.locator('.scenario-type').filter({ hasText: 'Boost goal' }).click();
    await page.selectOption('#inpScenarioGoal', 'tr');
    await page.fill('#inpScenarioName', 'Boost TR');
    await page.fill('#inpScenarioAmount', '50');
    await page.click('#scenarioInputView .btn-primary');
    const fifty = await page.evaluate(() => state.pendingScenario.goalImpact.days);
    await page.locator('#scenarioResultView .btn-secondary').filter({ hasText: 'Try another' }).click();
    await page.locator('.scenario-type').filter({ hasText: 'Boost goal' }).click();
    await page.selectOption('#inpScenarioGoal', 'tr');
    await page.fill('#inpScenarioName', 'Boost TR');
    await page.fill('#inpScenarioAmount', '100');
    await page.click('#scenarioInputView .btn-primary');
    const hundred = await page.evaluate(() => state.pendingScenario.goalImpact.days);
    expect(hundred).toBeGreaterThan(fifty);
  });

  test('old saved scenario decisions render safely', async ({ page }) => {
    await seedApp(page, {
      data: dataPayload({
        decisions: [{
          id: 'legacy-scenario', amount: 40, what: 'Legacy scenario', zone: 'green',
          title: 'Reduce spend scenario', date: isoDaysFromToday(-1), action: 'scenario',
          scenarioType: 'reduce_spend', createdAt: 1,
          projectionSnapshot: { lowPointDate: isoDaysFromToday(1), lowPointBalance: 100, firstNegativeDate: null, fourteenDayBalance: 200 },
          goalImpact: { goalName: 'TR', improveDays: 7 },
        }],
      }),
    });
    await goPage(page, 'decisions');
    await expect(page.locator('.decision-item')).toHaveCount(1);
    await expect(page.locator('.decision-item')).toContainText('Legacy scenario');
    await expect(page.locator('.decision-item')).toContainText('Scenario');
  });
});
