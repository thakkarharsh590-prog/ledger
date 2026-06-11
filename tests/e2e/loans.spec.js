const { test, expect } = require('@playwright/test');
const { seedApp, dataPayload, readAppData, goPage } = require('../helpers');

test.describe('Loans', () => {
  test('add a loan, record a payment with balance deduction, delete payment', async ({ page }) => {
    await seedApp(page, { data: dataPayload() });
    await goPage(page, 'loans');

    // add loan
    await page.evaluate(() => window.openLoanModal());
    await page.fill('#inpLoanName', 'Car Loan');
    await page.fill('#inpLoanLender', 'Bank');
    await page.fill('#inpLoanTotal', '10000');
    await page.fill('#inpLoanRate', '7.5');
    await page.click('#loanDeductSwitch'); // count payments as expenses
    await page.click('#loanModal .btn-primary');
    let data = await readAppData(page);
    expect(data.loans).toHaveLength(1);
    expect(data.loans[0]).toMatchObject({ name: 'Car Loan', total: 10000, interestRate: 7.5, deductFromBalance: true });

    // open detail, record payment
    await page.click('.loan-card');
    await page.waitForSelector('#page-loan-detail.active');
    await page.click('#loanDetailContent .btn-primary');
    await page.fill('#inpPayAmount', '350');
    await page.click('#paymentModal .btn-primary');
    data = await readAppData(page);
    expect(data.loans[0].payments).toHaveLength(1);
    expect(data.loans[0].payments[0].amount).toBe(350);
    // matching expense transaction created
    const linked = data.transactions.filter(t => t.loanPaymentId);
    expect(linked).toHaveLength(1);
    expect(linked[0]).toMatchObject({ type: 'expense', amount: 350, category: 'loan_pay' });

    // delete payment removes linked transaction
    page.once('dialog', d => d.accept());
    await page.click('.payment-delete');
    data = await readAppData(page);
    expect(data.loans[0].payments).toHaveLength(0);
    expect(data.transactions.filter(t => t.loanPaymentId)).toHaveLength(0);
  });

  test('loan requires interest rate', async ({ page }) => {
    await seedApp(page, { data: dataPayload() });
    await goPage(page, 'loans');
    await page.evaluate(() => window.openLoanModal());
    await page.fill('#inpLoanName', 'No Rate Loan');
    await page.fill('#inpLoanTotal', '500');
    await page.click('#loanModal .btn-primary');
    await expect(page.locator('#loanModal')).toHaveClass(/open/); // rejected, still open
    const data = await readAppData(page);
    expect(data.loans).toHaveLength(0);
  });

  test('paid-off loan shows badge and summary math is signed correctly', async ({ page }) => {
    await seedApp(page, {
      data: dataPayload({
        loans: [{
          id: 'l1', name: 'Tiny Loan', lender: 'Friend', total: 100, interestRate: 0,
          initialPaid: 100, startDate: '2026-01-01', note: '', deductFromBalance: false,
          payments: [], createdAt: 1,
        }],
      }),
    });
    await goPage(page, 'loans');
    await expect(page.locator('.loan-badge').first()).toHaveText('Paid Off');
    await expect(page.locator('.loans-summary-amount')).toContainText('0.00'); // remaining
  });
});
