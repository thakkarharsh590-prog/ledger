const { test, expect } = require('@playwright/test');
const { seedApp, dataPayload, readAppData, isoDaysFromToday } = require('../helpers');

test.describe('Recurring income/expenses + auto-log', () => {
  test('auto-log creates income transaction for past pay date and advances nextPay', async ({ page }) => {
    const payDate = isoDaysFromToday(-1); // yesterday
    await seedApp(page, {
      data: dataPayload({
        incomeSources: [{
          id: 'src1', name: 'Day Job', amount: 1200, cycle: 'fortnightly',
          nextPay: payDate, startDate: isoDaysFromToday(-15),
          autoLog: true, lastAutoLogDate: null, note: '', createdAt: 1,
        }],
      }),
    });
    const data = await readAppData(page);
    const auto = data.transactions.filter(t => t.autoLogged);
    expect(auto).toHaveLength(1);
    expect(auto[0]).toMatchObject({ type: 'income', amount: 1200, date: payDate, description: 'Day Job' });
    // nextPay advanced into the future
    expect(data.incomeSources[0].nextPay > isoDaysFromToday(0)).toBe(true);
    // banner shown
    await expect(page.locator('.auto-log-banner')).toBeVisible();
  });

  test('auto-log creates expense for past due bill and does not duplicate on reload', async ({ page }) => {
    const dueDate = isoDaysFromToday(-2);
    await seedApp(page, {
      data: dataPayload({
        recurringExpenses: [{
          id: 'rec1', name: 'Gym', amount: 25, category: 'gym', cycle: 'monthly',
          nextDue: dueDate, startDate: isoDaysFromToday(-30),
          active: true, lastAutoLogDate: null, note: '', createdAt: 1,
        }],
      }),
    });
    let data = await readAppData(page);
    expect(data.transactions.filter(t => t.autoLogged)).toHaveLength(1);

    await page.reload();
    await page.waitForSelector('.bottom-nav');
    data = await readAppData(page);
    expect(data.transactions.filter(t => t.autoLogged)).toHaveLength(1); // still exactly one
  });

  test('deleting an auto-logged transaction restores the source date', async ({ page }) => {
    const payDate = isoDaysFromToday(-1);
    await seedApp(page, {
      data: dataPayload({
        incomeSources: [{
          id: 'src1', name: 'Day Job', amount: 1200, cycle: 'fortnightly',
          nextPay: payDate, startDate: isoDaysFromToday(-15),
          autoLog: true, lastAutoLogDate: null, note: '', createdAt: 1,
        }],
      }),
    });
    page.once('dialog', d => d.accept());
    await page.click('#recentList .tx'); // open the auto-logged tx
    await page.click('#deleteBtn');
    const data = await readAppData(page);
    expect(data.transactions).toHaveLength(0);
    expect(data.incomeSources[0].nextPay).toBe(payDate); // restored to deleted date
  });

  test('add income source via Profile UI', async ({ page }) => {
    await seedApp(page, { data: dataPayload() });
    await page.evaluate(() => window.goPage('profile'));
    await page.waitForSelector('#page-profile.active');
    await page.evaluate(() => window.openIncomeSrcModal());
    await expect(page.locator('#incomeSrcModal')).toHaveClass(/open/);
    await page.fill('#inpIncSrcName', 'Side Hustle');
    await page.fill('#inpIncSrcAmount', '300');
    await page.click('.cycle-opt[data-cycle="weekly"]');
    await page.fill('#inpIncSrcNextPay', isoDaysFromToday(2));
    await page.click('#incomeSrcModal .btn-primary');
    const data = await readAppData(page);
    expect(data.incomeSources).toHaveLength(1);
    expect(data.incomeSources[0]).toMatchObject({ name: 'Side Hustle', amount: 300, cycle: 'weekly' });
    expect(data.incomeSources[0].startDate).toBeTruthy();
  });
});
