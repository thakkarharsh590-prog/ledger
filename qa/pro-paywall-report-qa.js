const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'qa', 'pro-paywall');
const REPORT_JSON = path.join(OUT_DIR, 'pro-paywall-results.json');
const REPORT_HTML = path.join(OUT_DIR, 'Pro_Paywall_QA_Report.html');
const REPORT_PDF = path.join(OUT_DIR, 'Pro_Paywall_QA_Report.pdf');

function ensureOutDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

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

function esc(value) {
  return String(value || '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

async function bodyText(page) {
  return page.locator('body').innerText();
}

async function expectBodyContains(page, text) {
  const body = await bodyText(page);
  if (!body.includes(text)) throw new Error(`Missing text: ${text}`);
}

async function expectLocatorContains(locator, text) {
  const actual = await locator.innerText();
  if (!actual.toLowerCase().includes(text.toLowerCase())) {
    throw new Error(`Missing text in locator: ${text}. Actual: ${actual}`);
  }
}

async function closeProModal(page) {
  const button = page.locator('#proModal button').filter({ hasText: 'Not now' });
  if (await button.isVisible().catch(() => false)) await button.click();
  await page.waitForTimeout(150);
}

async function snap(page, name, screenshots) {
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  screenshots.push({ name, file });
}

function reportHtml(summary, results, screenshots, metadata) {
  const shotHtml = screenshots.map(s => `
    <section class="shot">
      <h3>${esc(s.name)}</h3>
      <img src="${esc(path.basename(s.file))}" alt="${esc(s.name)} screenshot">
    </section>
  `).join('');
  const rows = results.map(r => `
    <tr class="${r.status.toLowerCase()}">
      <td>${esc(r.name)}</td>
      <td>${esc(r.status)}</td>
      <td>${esc(r.details)}</td>
    </tr>
  `).join('');
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>CapAhead Pro Paywall QA Report</title>
  <style>
    body { font-family: Arial, sans-serif; color: #111827; margin: 28px; line-height: 1.45; }
    h1 { margin-bottom: 4px; }
    .meta { color: #6b7280; font-size: 12px; margin-bottom: 18px; }
    .summary { display: flex; gap: 12px; margin: 18px 0; }
    .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 14px; min-width: 120px; }
    .card strong { display: block; font-size: 24px; }
    table { border-collapse: collapse; width: 100%; margin: 18px 0 24px; font-size: 13px; }
    th, td { border: 1px solid #e5e7eb; padding: 9px; text-align: left; vertical-align: top; }
    th { background: #f9fafb; }
    tr.pass td:nth-child(2) { color: #047857; font-weight: 700; }
    tr.fail td:nth-child(2) { color: #b91c1c; font-weight: 700; }
    .shot { page-break-inside: avoid; margin: 20px 0 28px; }
    .shot img { width: 100%; border: 1px solid #d1d5db; border-radius: 8px; }
  </style>
</head>
<body>
  <h1>CapAhead Pro Paywall QA Report</h1>
  <div class="meta">Generated ${esc(metadata.generatedAt)} from ${esc(metadata.url)}</div>
  <div class="summary">
    <div class="card"><span>Total</span><strong>${summary.total}</strong></div>
    <div class="card"><span>Pass</span><strong>${summary.pass}</strong></div>
    <div class="card"><span>Fail</span><strong>${summary.fail}</strong></div>
  </div>
  <table>
    <thead><tr><th>Scenario</th><th>Status</th><th>Details</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <h2>Screenshots</h2>
  ${shotHtml}
</body>
</html>`;
}

async function run() {
  ensureOutDir();
  const { server, baseUrl } = await serveWorkspace();
  const results = [];
  const screenshots = [];
  const consoleErrors = [];
  let browser;

  async function test(name, fn) {
    try {
      await fn();
      results.push({ name, status: 'PASS', details: '' });
    } catch (err) {
      results.push({ name, status: 'FAIL', details: err && err.stack ? err.stack : String(err) });
      if (global.page) {
        await global.page.evaluate(() => {
          ['affordModal', 'proModal', 'goalModal', 'loanModal'].forEach(id => closeModal(id));
        }).catch(() => {});
      }
    }
  }

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    await context.addInitScript(() => {
      localStorage.setItem('tour_completed', 'skipped');
      localStorage.setItem('ledger_setup_status_v1', JSON.stringify({ status: 'skipped', at: Date.now(), version: 'qa' }));
      localStorage.setItem('ledger_install_dismissed', '1');
      localStorage.setItem('first_launch_warning_shown', 'yes');
      localStorage.removeItem('ledger_pro_dev_unlocked_v1');
      localStorage.removeItem('ledger_data_v1');
    });

    const page = await context.newPage();
    global.page = page;
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(err.message));
    const appUrl = `${baseUrl}/www/index.html?v=pro-paywall-${Date.now()}`;
    await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);

    await page.evaluate(() => {
      const today = todayISO();
      const nextWeek = isoOf(addDays(today, 7));
      state.transactions = [
        { id: 'inc1', type: 'income', amount: 2500, description: 'Pay', category: 'salary', date: today, note: '', createdAt: Date.now() },
        { id: 'exp1', type: 'expense', amount: 120, description: 'Groceries', category: 'food', date: today, note: '', createdAt: Date.now() },
        ...Array.from({ length: 12 }, (_, i) => ({
          id: `exp_${i}`,
          type: 'expense',
          amount: 20 + i,
          description: `Expense ${i}`,
          category: i % 2 ? 'subs' : 'food',
          date: isoOf(addDays(today, -i)),
          note: '',
          createdAt: Date.now() - i,
        })),
      ];
      state.incomeSources = [{ id: 'src', name: 'Salary', amount: 2500, cycle: 'fortnightly', nextPay: nextWeek, startDate: today, autoLog: false }];
      state.recurringExpenses = [
        { id: 'rent', name: 'Rent', amount: 600, category: 'home', cycle: 'weekly', nextDue: nextWeek, startDate: today, active: true },
        { id: 'phone', name: 'Phone', amount: 80, category: 'subs', cycle: 'monthly', nextDue: nextWeek, startDate: today, active: true },
      ];
      state.loans = [{
        id: 'loan1',
        name: 'Car loan',
        lender: 'Bank',
        total: 8000,
        interestRate: 8,
        initialPaid: 1000,
        startDate: today,
        deductFromBalance: true,
        payments: [
          { id: 'lp1', amount: 200, date: isoOf(addDays(today, -28)), note: '' },
          { id: 'lp2', amount: 200, date: isoOf(addDays(today, -14)), note: '' },
          { id: 'lp3', amount: 200, date: today, note: '' },
        ],
        createdAt: Date.now(),
      }];
      state.savingsGoals = [
        { id: 'goal1', name: 'Emergency', emoji: '', target: 1000, deadline: isoOf(addDays(today, 30)), createdAt: Date.now() },
        { id: 'goal2', name: 'Holiday', emoji: '', target: 800, deadline: isoOf(addDays(today, 45)), createdAt: Date.now() },
      ];
      state.decisions = Array.from({ length: 5 }, (_, index) => ({
        id: `dec_${index}`,
        what: `Decision ${index}`,
        amount: 25,
        date: today,
        action: 'no',
        zone: 'green',
        createdAt: Date.now() + index,
      }));
      saveData();
      renderAll();
    });

    await test('Advanced forecast is paywalled for Free', async () => {
      await page.evaluate(() => {
        goPage('stats');
        billingState.isPro = false;
        renderStats();
        renderForecastChart();
      });
      await expectLocatorContains(page.locator('#forecastChartContainer'), 'Unlock Pro for the 60-day cashflow forecast');
      await snap(page, '01-advanced-forecast-paywall', screenshots);
    });

    await test('Loan payoff strategy is paywalled for Free', async () => {
      await page.locator('.nav-item').filter({ hasText: 'Loans' }).click();
      await expectBodyContains(page, 'Unlock Pro for the recommended payoff order');
      await snap(page, '02-loan-strategy-paywall', screenshots);
    });

    await test('Smart insights are paywalled for Free', async () => {
      await page.locator('.nav-item').filter({ hasText: 'Insights' }).click();
      await expectBodyContains(page, 'Unlock Pro for smart recurring bill insights');
      await snap(page, '03-smart-insights-paywall', screenshots);
    });

    await test('Monthly review PDF is paywalled for Free', async () => {
      await page.locator('.nav-item').filter({ hasText: 'Insights' }).click();
      await expectBodyContains(page, 'Monthly Review PDF');
      await expectBodyContains(page, 'Unlock Pro to download a monthly review PDF');
      await snap(page, '04-monthly-review-pdf-paywall', screenshots);
    });

    await test('Third savings goal opens Pro paywall', async () => {
      await page.evaluate(() => goPage('savings'));
      await page.locator('#page-savings.active .link').filter({ hasText: '+ New goal' }).click();
      await page.waitForSelector('#proModal.open', { timeout: 3000 });
      await expectBodyContains(page, 'Free includes 2 savings goals');
      await expectBodyContains(page, '7 days free');
      await expectBodyContains(page, 'A$4.99/mo');
      await expectBodyContains(page, 'A$39.99/yr');
      await snap(page, '05-third-goal-pro-modal', screenshots);
      await closeProModal(page);
    });

    await test('Goal impact detail is paywalled but affordability check still runs', async () => {
      await page.locator('.nav-item').filter({ hasText: 'Compass' }).click();
      await page.getByRole('button', { name: /Can I afford this/ }).click();
      await page.locator('#inpAffordAmount').fill('30');
      await page.locator('#inpAffordWhat').fill('Coffee machine');
      await page.locator('button').filter({ hasText: 'Run Check' }).click();
      await page.evaluate(() => {
        const amount = 300;
        const what = 'Coffee machine';
        const today = todayISO();
        state.savingsGoals = [{
          id: 'goal_impact_qa',
          name: 'Emergency',
          emoji: '',
          target: 1000,
          deadline: isoOf(addDays(today, 30)),
          createdAt: Date.now(),
        }];
        state.savings = [];
        const result = computeSmartAffordability(amount, what);
        document.getElementById('affordVerdict').innerHTML = renderAffordabilityResult(result, amount, what);
        document.getElementById('affordInputView').style.display = 'none';
        document.getElementById('affordResultView').style.display = 'block';
        state.pendingAffordCheck = { amount, what, zone: result.zone, title: result.title, date: todayISO() };
      });
      await expectLocatorContains(page.locator('#affordVerdict'), 'Goal impact');
      await expectLocatorContains(page.locator('#affordVerdict'), 'Unlock Pro to see how this purchase changes your savings goal timeline');
      await snap(page, '06-goal-impact-paywall', screenshots);
    });

    await test('Sixth saved decision opens Pro paywall', async () => {
      await page.evaluate(() => saveDecision('no'));
      await page.waitForSelector('#proModal.open', { timeout: 3000 });
      await expectBodyContains(page, 'Free saves 5 affordability decisions');
      await expectBodyContains(page, '7 days free');
      await snap(page, '07-sixth-decision-pro-modal', screenshots);
      const decisionCountStillFive = await page.evaluate(() => state.decisions.length === 5);
      if (!decisionCountStillFive) throw new Error('Sixth decision was saved despite Free cap');
      await closeProModal(page);
    });

    await test('Free can still record multiple loans', async () => {
      await page.locator('.nav-item').filter({ hasText: 'Loans' }).click();
      await page.locator('#page-loans.active .link').filter({ hasText: '+ New' }).click();
      await page.waitForSelector('#loanModal.open', { timeout: 3000 });
      await snap(page, '08-free-second-loan-modal', screenshots);
      await page.locator('#loanModal button').filter({ hasText: 'Cancel' }).click();
    });

    await test('Pro monthly review report renders and triggers print flow', async () => {
      await page.evaluate(() => {
        window.__qaPrintCount = 0;
        window.print = () => { window.__qaPrintCount += 1; };
        billingState.isPro = true;
        localStorage.setItem('ledger_pro_dev_unlocked_v1', 'yes');
        goPage('stats');
        renderStats();
      });
      await page.locator('button').filter({ hasText: 'Download monthly review' }).click();
      await page.waitForFunction(() => window.__qaPrintCount === 1);
      const reportText = await page.locator('#monthlyReportPrintRoot').innerText();
      if (!reportText.includes('CapAhead Monthly Review')) throw new Error('monthly report title missing');
      if (!reportText.includes('This report contains personal finance data')) throw new Error('privacy note missing');
      if (!reportText.includes('60-day forecast')) throw new Error('forecast section missing');
      await snap(page, '09-pro-monthly-review-report', screenshots);
    });

    if (consoleErrors.length) {
      results.push({ name: 'No console/page errors', status: 'FAIL', details: consoleErrors.join(' | ') });
    } else {
      results.push({ name: 'No console/page errors', status: 'PASS', details: '' });
    }

    const summary = {
      total: results.length,
      pass: results.filter(r => r.status === 'PASS').length,
      fail: results.filter(r => r.status === 'FAIL').length,
    };
    const metadata = { generatedAt: new Date().toISOString(), url: appUrl };
    fs.writeFileSync(REPORT_JSON, JSON.stringify({ summary, metadata, results, consoleErrors, screenshots }, null, 2));
    fs.writeFileSync(REPORT_HTML, reportHtml(summary, results, screenshots, metadata));
    const reportPage = await browser.newPage();
    await reportPage.goto('file://' + REPORT_HTML.replace(/\\/g, '/'), { waitUntil: 'load' });
    await reportPage.pdf({ path: REPORT_PDF, format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } });

    await browser.close();
    server.close();
    console.log(JSON.stringify({ summary, reportPdf: REPORT_PDF, reportHtml: REPORT_HTML, reportJson: REPORT_JSON, screenshots }, null, 2));
    process.exit(summary.fail === 0 ? 0 : 1);
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    server.close();
    console.error(error);
    process.exit(1);
  }
}

run();
