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
  if (!body.includes(text)) throw new Error(`Missing text: ${text}\nBody:\n${body.slice(0, 4000)}`);
}

(async () => {
  const web = fs.readFileSync(path.join(ROOT, 'www', 'index.html'), 'utf8');
  const staticChecks = [
    ['Loan modal no longer mentions NAB', !web.includes('e.g. NAB, HECS, Friend') && web.includes('e.g. Bank, HECS, Friend')],
    ['Browser test Pro is not visible source copy', !web.includes('Browser test Pro')],
    ['Public owner URL unlock is stripped', !web.includes('applyOwnerPwaUnlockFromUrl') && web.includes("params.get('owner') === '1'")],
    ['Public owner storage key is stripped', !web.includes('ledger_owner_pwa_unlocked_v1')],
    ['Foresight schema is present', web.includes('SCHEMA_VERSION = 10') && web.includes('monthlySnapshots') && web.includes('alertSettings')],
  ];
  const failedStatic = staticChecks.filter(([, pass]) => !pass);
  if (failedStatic.length) {
    console.error(JSON.stringify({ pass: false, failedStatic }, null, 2));
    process.exit(1);
  }

  const { server, baseUrl } = await serveWorkspace();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    await context.addInitScript(() => {
      localStorage.setItem('tour_completed', 'skipped');
      localStorage.setItem('ledger_setup_status_v1', JSON.stringify({ status: 'skipped', at: Date.now(), version: 'qa' }));
      localStorage.setItem('ledger_install_dismissed', '1');
      localStorage.setItem('first_launch_warning_shown', 'yes');
      localStorage.removeItem('ledger_data_v1');
      localStorage.removeItem('ledger_pro_dev_unlocked_v1');
      localStorage.setItem('ledger_owner_pwa_unlocked_v1', 'yes');
    });
    const page = await context.newPage();
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(`${baseUrl}/www/index.html?owner=harsh&v=foresight-${Date.now()}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);

    const ownerBypassBlocked = await page.evaluate(() => !isPro());
    if (!ownerBypassBlocked) throw new Error('Public owner localStorage/URL path should not unlock Pro');
    await page.locator('.nav-item').filter({ hasText: 'Profile' }).click();
    const normalProfile = await bodyText(page);
    if (normalProfile.includes('Owner Pro pass')) throw new Error('Owner Pro pass row should be hidden in normal Profile');

    const ownerToolPage = await context.newPage();
    await ownerToolPage.goto(`${baseUrl}/www/index.html?owner=1&v=owner-tools-${Date.now()}`, { waitUntil: 'domcontentloaded' });
    await ownerToolPage.waitForTimeout(900);
    await ownerToolPage.locator('.nav-item').filter({ hasText: 'Profile' }).click();
    await expectBodyContains(ownerToolPage, 'Owner Pro pass');
    const ownerFlagDoesNotUnlock = await ownerToolPage.evaluate(() => !isPro());
    if (!ownerFlagDoesNotUnlock) throw new Error('?owner=1 must reveal tools only, not unlock Pro');
    await ownerToolPage.close();

    await page.evaluate(() => {
      const base = Date.now();
      state.transactions = [
        { id: 'inc_may', type: 'income', amount: 4000, description: 'May salary', category: 'salary', date: '2026-05-05', note: '', createdAt: base },
        { id: 'exp_may', type: 'expense', amount: 900, description: 'May rent', category: 'home', date: '2026-05-06', note: '', createdAt: base + 1 },
        { id: 'inc_jun', type: 'income', amount: 4000, description: 'June salary', category: 'salary', date: '2026-06-05', note: '', createdAt: base + 2 },
        { id: 'exp_jun', type: 'expense', amount: 110, description: 'Streaming', category: 'subs', date: '2026-06-06', note: '', createdAt: base + 3 },
        ...Array.from({ length: 10 }, (_, i) => ({ id: `food_${i}`, type: 'expense', amount: 20 + i, description: `Food ${i}`, category: 'food', date: '2026-06-07', note: '', createdAt: base + 10 + i })),
      ];
      state.incomeSources = [{ id: 'src', name: 'Salary', amount: 4000, cycle: 'monthly', nextPay: '2026-07-05', startDate: '2026-05-05', autoLog: false }];
      state.recurringExpenses = [{ id: 'bill', name: 'Rent', amount: 900, category: 'home', cycle: 'monthly', nextDue: '2026-07-06', startDate: '2026-05-06', active: true }];
      state.savingsGoals = [{ id: 'goal', name: 'Holiday', emoji: '', target: 1200, deadline: '2026-09-30', createdAt: Date.now() - 86400000 * 30 }];
      state.savings = [{ id: 'sav', type: 'deposit', amount: 300, goalId: 'goal', date: '2026-06-01', note: '', createdAt: base + 50 }];
      state.loans = [{ id: 'loan', name: 'Car', lender: 'Bank', total: 3000, interestRate: 8, initialPaid: 500, startDate: '2026-05-01', payments: [], createdAt: base + 60 }];
      state.decisions = Array.from({ length: 5 }, (_, i) => ({ id: `dec_${i}`, what: `Decision ${i}`, amount: 10, action: 'no', zone: 'green', date: '2026-06-07', createdAt: base + 70 + i }));
      state.monthlySnapshots = [{ month: '2026-04', balance: 100, savingsTotal: 0, debtTotal: 3000, incomeTotal: 1000, expenseTotal: 900, categoryTotals: {}, createdAt: base }];
      saveData();
      backfillMonthlySnapshots();
      renderAll();
    });
    const snapshotCheck = await page.evaluate(() => ({
      months: state.monthlySnapshots.map(s => s.month),
      unique: new Set(state.monthlySnapshots.map(s => s.month)).size === state.monthlySnapshots.length,
    }));
    if (!snapshotCheck.months.includes('2026-05') || !snapshotCheck.unique) {
      throw new Error(`Monthly snapshots did not backfill safely: ${JSON.stringify(snapshotCheck)}`);
    }

    const lockedAheadPreview = await page.evaluate(async () => {
      localStorage.removeItem('ledger_pro_dev_unlocked_v1');
      await syncProEntitlement();
      state.monthlySnapshots = [
        { month: '2026-05', balance: 1000, savingsTotal: 500, debtTotal: 9000, incomeTotal: 4000, expenseTotal: 900, categoryTotals: {}, createdAt: Date.now() },
      ];
      renderAheadTrends();
      return document.getElementById('aheadTrends').innerText;
    });
    if (lockedAheadPreview.includes('Net progress') || lockedAheadPreview.includes('-A$') || lockedAheadPreview.includes('−A$')) {
      throw new Error(`Locked ahead preview should not expose scary net progress copy/value: ${lockedAheadPreview}`);
    }

    const oneSnapshotAhead = await page.evaluate(async () => {
      localStorage.setItem('ledger_pro_dev_unlocked_v1', 'yes');
      await syncProEntitlement();
      state.monthlySnapshots = [
        { month: '2026-05', balance: 1000, savingsTotal: 500, debtTotal: 9000, incomeTotal: 4000, expenseTotal: 900, categoryTotals: {}, createdAt: Date.now() },
      ];
      renderAheadTrends();
      return document.getElementById('aheadTrends').innerText;
    });
    if (!oneSnapshotAhead.includes('Baseline set for May 2026') || !oneSnapshotAhead.includes("Your trend appears next month once there's a month to compare.")) {
      throw new Error(`One-snapshot ahead card should show baseline copy: ${oneSnapshotAhead}`);
    }
    if (oneSnapshotAhead.includes('Net progress') || oneSnapshotAhead.includes('Net worth') || oneSnapshotAhead.includes('-A$') || oneSnapshotAhead.includes('−A$')) {
      throw new Error(`One-snapshot ahead card should not show net-worth headline/value: ${oneSnapshotAhead}`);
    }

    const positiveAhead = await page.evaluate(() => {
      state.monthlySnapshots = [
        { month: '2026-04', balance: 1000, savingsTotal: 500, debtTotal: 2000, incomeTotal: 4000, expenseTotal: 900, categoryTotals: { home: 500 }, createdAt: Date.now() - 1 },
        { month: '2026-05', balance: 1200, savingsTotal: 800, debtTotal: 1800, incomeTotal: 4200, expenseTotal: 700, categoryTotals: { food: 300 }, createdAt: Date.now() },
      ];
      renderAheadTrends();
      return {
        text: document.getElementById('aheadTrends').innerText,
        netWorth: state.monthlySnapshots[1].balance + state.monthlySnapshots[1].savingsTotal - state.monthlySnapshots[1].debtTotal,
      };
    });
    for (const expected of ['Savings', 'Up A$300.00', 'Debt', 'Paid down A$200.00 - nice.', 'Spending', 'Down A$200.00', 'Net worth', 'A$200.00', 'Cash A$1,200.00', 'Savings A$800.00', 'Debt -A$1,800.00']) {
      if (!positiveAhead.text.includes(expected)) throw new Error(`Positive ahead card missing "${expected}": ${positiveAhead.text}`);
    }
    if (positiveAhead.netWorth !== 200) throw new Error(`Net-worth math mismatch: ${JSON.stringify(positiveAhead)}`);

    const borrowedAhead = await page.evaluate(() => {
      state.monthlySnapshots = [
        { month: '2026-05', balance: 1500, savingsTotal: 800, debtTotal: 1800, incomeTotal: 4200, expenseTotal: 700, categoryTotals: {}, createdAt: Date.now() - 1 },
        { month: '2026-06', balance: 1500, savingsTotal: 850, debtTotal: 2700, incomeTotal: 4200, expenseTotal: 650, categoryTotals: {}, createdAt: Date.now() },
      ];
      renderAheadTrends();
      return document.getElementById('aheadTrends').innerText;
    });
    if (!borrowedAhead.includes('Borrowed A$900.00 this month') || borrowedAhead.includes('fell behind')) {
      throw new Error(`Debt increase should be framed as borrowed, not failure: ${borrowedAhead}`);
    }
    await page.evaluate(async () => {
      localStorage.removeItem('ledger_pro_dev_unlocked_v1');
      await syncProEntitlement();
      renderAll();
    });

    await page.locator('.nav-item').filter({ hasText: 'Compass' }).click();
    await page.locator('.compass-cta').filter({ hasText: 'What if?' }).click();
    await page.locator('#inpScenarioName').fill('Free QA scenario');
    await page.locator('#inpScenarioAmount').fill('55');
    await page.locator('#scenarioModal button').filter({ hasText: 'Run scenario' }).click();
    await expectBodyContains(page, 'Pro shows the full 60-day scenario impact');
    await page.locator('#scenarioModal button').filter({ hasText: 'Save scenario' }).click();
    await expectBodyContains(page, 'Free saves 5 decisions or scenarios');
    await page.locator('#proModal button').filter({ hasText: 'Not now' }).click();

    await page.evaluate(async () => {
      localStorage.setItem('ledger_pro_dev_unlocked_v1', 'yes');
      await syncProEntitlement();
      renderAll();
    });
    await page.locator('.nav-item').filter({ hasText: 'Compass' }).click();
    await page.locator('.compass-cta').filter({ hasText: 'What if?' }).click();
    await page.locator('#inpScenarioName').fill('Pro QA scenario');
    await page.locator('#inpScenarioAmount').fill('40');
    await page.locator('#scenarioModal button').filter({ hasText: 'Run scenario' }).click();
    await expectBodyContains(page, 'Cash safety');
    await page.locator('#scenarioModal button').filter({ hasText: 'Save scenario' }).click();

    await page.evaluate(() => goPage('savings'));
    await page.locator('button').filter({ hasText: 'Boost this goal' }).first().click();
    const boostNoTransaction = await page.evaluate(() => ({
      modalOpen: document.getElementById('scenarioModal').classList.contains('open'),
      txCount: state.transactions.length,
    }));
    if (!boostNoTransaction.modalOpen || boostNoTransaction.txCount !== 14) {
      throw new Error(`Goal boost should open scenario without creating transaction: ${JSON.stringify(boostNoTransaction)}`);
    }
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    const notificationFallback = await page.evaluate(async () => {
      window.Capacitor = window.Capacitor || { Plugins: {} };
      window.Capacitor.Plugins = window.Capacitor.Plugins || {};
      delete window.Capacitor.Plugins.LocalNotifications;
      await scheduleProAlerts();
      return state.alertSettings;
    });
    if (!notificationFallback.enabled || !notificationFallback.inAppOnly || notificationFallback.permission !== 'unavailable') {
      throw new Error(`Notification unavailable fallback failed: ${JSON.stringify(notificationFallback)}`);
    }
    const notificationGranted = await page.evaluate(async () => {
      window.Capacitor = window.Capacitor || { Plugins: {} };
      window.Capacitor.Plugins = window.Capacitor.Plugins || {};
      let scheduled = 0;
      window.Capacitor.Plugins.LocalNotifications = {
        requestPermissions: async () => ({ display: 'granted' }),
        schedule: async payload => { scheduled = payload.notifications.length; },
      };
      state.alertSettings = { enabled: false, permission: 'unknown', inAppOnly: true, lastScheduledAt: null };
      await scheduleProAlerts();
      return { settings: state.alertSettings, scheduled };
    });
    if (!notificationGranted.settings.enabled || notificationGranted.settings.inAppOnly || notificationGranted.scheduled < 0) {
      throw new Error(`Notification granted path failed: ${JSON.stringify(notificationGranted)}`);
    }

    const horizontal = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    if (horizontal) throw new Error('Mobile layout has horizontal scroll');
    if (errors.length) throw new Error(`Console/page errors: ${errors.join(' | ')}`);

    await browser.close();
    server.close();
    console.log(JSON.stringify({ pass: true, snapshotCheck, notificationGranted }, null, 2));
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    server.close();
    console.error(error);
    process.exit(1);
  }
})();
