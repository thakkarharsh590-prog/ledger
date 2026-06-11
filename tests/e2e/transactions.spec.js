const { test, expect } = require('@playwright/test');
const { seedApp, dataPayload, readAppData, goPage } = require('../helpers');

test.describe('Transaction CRUD', () => {
  test('add income via quick add', async ({ page }) => {
    await seedApp(page, { data: dataPayload() });
    await page.click('.quickadd .add-income');
    await expect(page.locator('#addModal')).toHaveClass(/open/);
    await page.fill('#inpAmount', '500');
    await page.fill('#inpDesc', 'Freelance gig');
    await page.click('#addModal .btn-primary');
    await expect(page.locator('#addModal')).not.toHaveClass(/open/);
    await expect(page.locator('#balance')).toHaveText('500.00');
    await expect(page.locator('#recentList .tx-title').first()).toContainText('Freelance gig');
  });

  test('add expense, then edit it, then delete it', async ({ page }) => {
    await seedApp(page, { data: dataPayload() });

    // add
    await page.click('.quickadd .add-expense');
    await page.fill('#inpAmount', '120');
    await page.fill('#inpDesc', 'Petrol');
    await page.click('#addModal .btn-primary');
    // hero balance is signed (raw toLocaleString), so an expense-only ledger shows -120.00
    await expect(page.locator('#balance')).toHaveText('-120.00');
    let data = await readAppData(page);
    expect(data.transactions).toHaveLength(1);
    expect(data.transactions[0]).toMatchObject({ type: 'expense', amount: 120, description: 'Petrol' });

    // edit
    await page.click('#recentList .tx');
    await expect(page.locator('#addModal')).toHaveClass(/open/);
    await page.fill('#inpAmount', '99.95');
    await page.click('#addModal .btn-primary');
    data = await readAppData(page);
    expect(data.transactions[0].amount).toBe(99.95);

    // delete (confirm dialog)
    page.once('dialog', d => d.accept());
    await page.click('#recentList .tx');
    await page.click('#deleteBtn');
    data = await readAppData(page);
    expect(data.transactions).toHaveLength(0);
  });

  test('validation: empty amount rejected', async ({ page }) => {
    await seedApp(page, { data: dataPayload() });
    await page.click('.quickadd .add-expense');
    await page.click('#addModal .btn-primary');
    await expect(page.locator('#addModal')).toHaveClass(/open/); // still open
    await expect(page.locator('#toast')).toHaveClass(/show/);
    const data = await readAppData(page);
    expect(data.transactions).toHaveLength(0);
  });

  test('filters on transactions page work', async ({ page }) => {
    const today = new Date();
    const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const old = new Date(today); old.setDate(old.getDate() - 40);
    await seedApp(page, {
      data: dataPayload({
        transactions: [
          { id: 'a', type: 'income', amount: 10, description: 'New income', category: 'salary', date: iso(today), note: '', createdAt: 2 },
          { id: 'b', type: 'expense', amount: 5, description: 'Old expense', category: 'food', date: iso(old), note: '', createdAt: 1 },
        ],
      }),
    });
    await goPage(page, 'transactions');
    await expect(page.locator('#allList .tx')).toHaveCount(2);
    await page.click('.pill[data-filter="income"]');
    await expect(page.locator('#allList .tx')).toHaveCount(1);
    await expect(page.locator('#allList .tx-title')).toContainText('New income');
    await page.click('.pill[data-filter="week"]');
    await expect(page.locator('#allList .tx')).toHaveCount(1);
  });

  test('search finds transactions by description', async ({ page }) => {
    await seedApp(page, {
      data: dataPayload({
        transactions: [
          { id: 'a', type: 'expense', amount: 42, description: 'Unique Zebra Purchase', category: 'fun', date: '2026-06-01', note: '', createdAt: 1 },
        ],
      }),
    });
    await goPage(page, 'transactions');
    await page.click('#page-transactions .icon-btn');
    await page.fill('#searchInp', 'zebra');
    await expect(page.locator('#searchResults .tx-title')).toContainText('Unique Zebra Purchase');
  });
});
