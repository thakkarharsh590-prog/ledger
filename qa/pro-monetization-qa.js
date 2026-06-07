const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');

function serveWorkspace() {
  const server = http.createServer((req, res) => {
    let urlPath = req.url.split('?')[0];
    if (urlPath === '/') urlPath = '/www/index.html';
    const file = path.resolve(ROOT, urlPath.replace(/^\//, ''));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'content-type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function bodyText(page) {
  return page.locator('body').innerText();
}

async function expectBodyContains(page, text) {
  const body = await bodyText(page);
  if (!body.includes(text)) throw new Error(`Missing text: ${text}`);
}

(async () => {
  const { server, baseUrl } = await serveWorkspace();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
    });
    await context.addInitScript(() => {
      localStorage.setItem('tour_completed', 'skipped');
      localStorage.setItem('ledger_setup_status_v1', JSON.stringify({ status: 'skipped', at: Date.now(), version: 'qa' }));
      localStorage.setItem('ledger_install_dismissed', '1');
      localStorage.setItem('first_launch_warning_shown', 'yes');
      localStorage.removeItem('ledger_pro_dev_unlocked_v1');
      localStorage.removeItem('ledger_data_v1');
    });

    const page = await context.newPage();
    await page.goto(`${baseUrl}/www/index.html?v=pro-qa-${Date.now()}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    await page.evaluate(() => {
      const today = todayISO();
      state.transactions = [
        { id: 'qa_inc', type: 'income', amount: 2500, description: 'Salary QA', category: 'salary', date: today, note: '', createdAt: Date.now() },
        { id: 'qa_exp', type: 'expense', amount: 50, description: 'Food QA', category: 'food', date: today, note: '', createdAt: Date.now() },
      ];
      state.incomeSources = [{ id: 'qa_src', name: 'Salary QA', amount: 2500, cycle: 'fortnightly', nextPay: today, startDate: today, autoLog: false }];
      state.recurringExpenses = [{ id: 'qa_bill', name: 'Rent QA', amount: 600, category: 'home', cycle: 'weekly', nextDue: today, startDate: today, active: true }];
      state.loans = [{ id: 'qa_loan', name: 'Car QA', lender: 'Bank', total: 5000, interestRate: 8, initialPaid: 300, startDate: today, payments: [], createdAt: Date.now() }];
      state.savingsGoals = [{ id: 'qa_goal', name: 'Emergency QA', emoji: '', target: 1000, deadline: today, createdAt: Date.now() }];
      state.decisions = Array.from({ length: 5 }, (_, index) => ({
        id: `qa_decision_${index}`,
        what: `Decision ${index}`,
        amount: 20 + index,
        date: today,
        action: 'no',
        zone: 'green',
        createdAt: Date.now() + index,
      }));
      saveData();
      renderAll();
    });

    await page.locator('.nav-item').filter({ hasText: 'Loans' }).click();
    await expectBodyContains(page, 'Unlock Pro for the recommended payoff order');
    await page.locator('#page-loans.active .link').filter({ hasText: '+ New' }).click();
    const freeLoanModalOpen = await page.locator('#loanModal.open').count();
    if (!freeLoanModalOpen) throw new Error('Free should allow recording multiple loans for accurate forecasts');
    await page.locator('#loanModal button').filter({ hasText: 'Cancel' }).click();

    await page.evaluate(() => goPage('savings'));
    await page.locator('#page-savings.active .link').filter({ hasText: '+ New goal' }).click();
    const secondGoalModalOpen = await page.locator('#goalModal.open').count();
    if (!secondGoalModalOpen) throw new Error('Free should allow creating a second savings goal');
    await page.locator('#inpGoalName').fill('Holiday QA');
    await page.locator('#inpGoalTarget').fill('800');
    await page.locator('#goalModal button').filter({ hasText: 'Save Goal' }).click();
    const hasTwoGoals = await page.evaluate(() => state.savingsGoals.length === 2);
    if (!hasTwoGoals) throw new Error('Free should save exactly two goals before paywalling');
    await page.locator('#page-savings.active .link').filter({ hasText: '+ New goal' }).click();
    await expectBodyContains(page, 'Free includes 2 savings goals');
    await expectBodyContains(page, '7 days free');
    await expectBodyContains(page, 'A$4.99/mo');
    await expectBodyContains(page, 'A$39.99/yr');
    await page.locator('#proModal button').filter({ hasText: 'Not now' }).click();

    await page.locator('.nav-item').filter({ hasText: 'Compass' }).click();
    await page.locator('.compass-cta').click();
    await page.locator('#inpAffordAmount').fill('25');
    await page.locator('#inpAffordWhat').fill('QA purchase');
    await page.locator('button').filter({ hasText: 'Run Check' }).click();
    await page.locator('#affordResultView button').filter({ hasText: "I'll wait / skip" }).click();
    await expectBodyContains(page, 'Free saves 5 affordability decisions');
    await page.locator('#proModal button').filter({ hasText: 'Not now' }).click();
    const decisionCountStillFive = await page.evaluate(() => state.decisions.length === 5);
    if (!decisionCountStillFive) throw new Error('Free decision limit should not create a sixth decision');

    await page.locator('.nav-item').filter({ hasText: 'Profile' }).click();
    await page.locator('.setting-row').filter({ hasText: 'Browser test Pro' }).click();
    await expectBodyContains(page, 'Browser test Pro enabled');

    await page.locator('.nav-item').filter({ hasText: 'Loans' }).click();
    await page.locator('#page-loans.active .link').filter({ hasText: '+ New' }).click();
    const loanModalOpen = await page.locator('#loanModal.open').count();
    if (!loanModalOpen) throw new Error('Pro should still allow opening add-loan modal');
    await page.locator('#loanModal button').filter({ hasText: 'Cancel' }).click();

    await browser.close();
    server.close();
    console.log(JSON.stringify({ pass: true }, null, 2));
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    server.close();
    console.error(error);
    process.exit(1);
  }
})();
