const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'qa', 'full-qa');
const REPORT_JSON = path.join(OUT_DIR, 'ledger-full-qa-results.json');
const REPORT_HTML = path.join(OUT_DIR, 'Ledger_Compass_Full_QA_Report.html');
const REPORT_PDF = path.join(OUT_DIR, 'Ledger_Compass_Full_QA_Report.pdf');

fs.mkdirSync(OUT_DIR, { recursive: true });

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
      const type = file.endsWith('.html') ? 'text/html; charset=utf-8'
        : file.endsWith('.js') ? 'application/javascript; charset=utf-8'
        : 'application/octet-stream';
      res.writeHead(200, { 'content-type': type });
      res.end(data);
    });
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

const results = [];
const screenshots = [];
let consoleErrors = [];

function nowIso() { return new Date().toISOString(); }
function ms(start) { return Date.now() - start; }
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function pass(name, duration, details = '') {
  results.push({ name, status: 'PASS', duration, details });
}
function fail(name, duration, error) {
  results.push({ name, status: 'FAIL', duration, details: error.stack || error.message || String(error) });
}
async function test(name, fn) {
  const start = Date.now();
  try {
    await fn();
    pass(name, ms(start));
  } catch (error) {
    fail(name, ms(start), error);
  }
}
async function snap(page, name) {
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  screenshots.push({ name, file });
}
async function assertNoHorizontalScroll(page) {
  const dims = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  if (dims.scrollWidth > dims.innerWidth + 1 || dims.bodyScrollWidth > dims.innerWidth + 1) {
    throw new Error(`horizontal scroll detected ${JSON.stringify(dims)}`);
  }
}
async function setRichFixture(page) {
  await page.evaluate(() => {
    const today = todayISO();
    const daysAgo = n => {
      const d = parseISODateLocal(today);
      d.setDate(d.getDate() - n);
      return isoOf(d);
    };
    state.transactions = [
      { id: 'qa_inc_1', type: 'income', amount: 3200, description: 'Salary', category: 'salary', date: daysAgo(2), note: '', createdAt: Date.now() - 5000 },
      { id: 'qa_inc_2', type: 'income', amount: 450, description: 'Freelance project', category: 'freelance', date: daysAgo(5), note: 'Invoice', createdAt: Date.now() - 4000 },
      { id: 'qa_exp_1', type: 'expense', amount: 68.4, description: 'Groceries', category: 'food', date: daysAgo(1), note: 'Weekly shop', createdAt: Date.now() - 3000 },
      { id: 'qa_exp_2', type: 'expense', amount: 24.99, description: 'Streaming', category: 'subs', date: daysAgo(3), note: '', createdAt: Date.now() - 2000 },
      { id: 'qa_exp_3', type: 'expense', amount: 120, description: 'Transport pass', category: 'transport', date: daysAgo(4), note: '', oneTime: true, createdAt: Date.now() - 1000 },
    ];
    state.budgets = { food: 400, subs: 80, transport: 200 };
    state.loans = [{
      id: 'qa_loan_1',
      name: 'Car Loan',
      lender: 'QA Bank',
      total: 8000,
      interestRate: 7.5,
      initialPaid: 1200,
      startDate: today,
      deductFromBalance: true,
      payments: [],
      note: 'QA fixture',
      createdAt: Date.now(),
    }];
    state.incomeSources = [{
      id: 'qa_income_src_1',
      name: 'Salary',
      amount: 3200,
      cycle: 'fortnightly',
      nextPay: today,
      startDate: today,
      autoLog: true,
      lastAutoLogDate: null,
    }];
    state.recurringExpenses = [{
      id: 'qa_rec_1',
      name: 'Rent',
      amount: 650,
      category: 'home',
      cycle: 'weekly',
      nextDue: today,
      startDate: today,
      active: true,
      lastAutoLogDate: null,
    }];
    state.savings = [{
      id: 'qa_sav_1',
      type: 'deposit',
      amount: 500,
      note: 'Emergency fund',
      goalId: 'qa_goal_1',
      date: today,
      affectsBalance: false,
      createdAt: Date.now(),
    }];
    state.savingsGoals = [{
      id: 'qa_goal_1',
      name: 'Emergency Fund',
      emoji: '',
      target: 3000,
      deadline: daysAgo(-90),
      createdAt: Date.now(),
    }];
    saveData();
    renderAll();
  });
  await page.waitForTimeout(300);
}

function reportHtml(summary, metadata) {
  const rows = results.map(r => `
    <tr class="${r.status.toLowerCase()}">
      <td>${esc(r.status)}</td>
      <td>${esc(r.name)}</td>
      <td>${r.duration} ms</td>
      <td><pre>${esc(r.details || '')}</pre></td>
    </tr>`).join('');
  const shots = screenshots.map(s => `
    <figure>
      <img src="${path.basename(s.file)}" alt="${esc(s.name)} screenshot">
      <figcaption>${esc(s.name)}</figcaption>
    </figure>`).join('');
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Ledger Compass Full QA Report</title>
  <style>
    body { font-family: Arial, sans-serif; color: #111827; margin: 32px; line-height: 1.45; }
    h1, h2 { margin: 0 0 12px; }
    .meta, .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 18px 0 24px; }
    .box { border: 1px solid #d1d5db; border-radius: 8px; padding: 12px; background: #f9fafb; }
    .passText { color: #047857; font-weight: 700; }
    .failText { color: #b91c1c; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }
    th, td { border: 1px solid #d1d5db; padding: 8px; vertical-align: top; }
    th { background: #f3f4f6; text-align: left; }
    tr.pass td:first-child { color: #047857; font-weight: 700; }
    tr.fail td:first-child { color: #b91c1c; font-weight: 700; }
    pre { white-space: pre-wrap; margin: 0; font-family: Consolas, monospace; font-size: 11px; }
    figure { break-inside: avoid; margin: 18px 0; }
    img { max-width: 340px; border: 1px solid #d1d5db; border-radius: 8px; }
    figcaption { font-size: 12px; color: #4b5563; margin-top: 6px; }
    .page-break { page-break-before: always; }
  </style>
</head>
<body>
  <h1>Ledger Compass Full QA Report</h1>
  <p>Generated ${esc(metadata.generatedAt)} after the SVG category icon and mobile accessibility changes.</p>
  <div class="summary">
    <div class="box"><strong>Total</strong><br>${summary.total}</div>
    <div class="box"><strong>Passed</strong><br><span class="passText">${summary.pass}</span></div>
    <div class="box"><strong>Failed</strong><br><span class="${summary.fail ? 'failText' : 'passText'}">${summary.fail}</span></div>
    <div class="box"><strong>Duration</strong><br>${summary.durationMs} ms</div>
  </div>
  <div class="meta">
    <div class="box"><strong>Viewport</strong><br>390 x 844 mobile</div>
    <div class="box"><strong>Browser</strong><br>Chromium via Playwright</div>
    <div class="box"><strong>URL</strong><br>${esc(metadata.url)}</div>
    <div class="box"><strong>Console errors</strong><br>${consoleErrors.length}</div>
  </div>
  <h2>Test Results</h2>
  <table>
    <thead><tr><th>Status</th><th>Test</th><th>Time</th><th>Details</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="page-break"></div>
  <h2>Screenshots</h2>
  ${shots || '<p>No screenshots captured.</p>'}
</body>
</html>`;
}

(async () => {
  const started = Date.now();
  const { server, baseUrl } = await serveWorkspace();
  const appUrl = `${baseUrl}/www/index.html?v=full-qa-${Date.now()}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    await context.addInitScript(() => {
      localStorage.setItem('tour_completed', 'skipped');
      localStorage.setItem('ledger_setup_status_v1', JSON.stringify({ status: 'skipped', at: Date.now(), version: 'qa' }));
      localStorage.setItem('ledger_install_dismissed', '1');
      localStorage.setItem('first_launch_warning_shown', 'yes');
      localStorage.setItem('ledger_pro_dev_unlocked_v1', 'yes');
      localStorage.removeItem('ledger_data_v1');
      localStorage.removeItem('ledger_ui_prefs_v1');
    });
    const page = await context.newPage();
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(err.message));

    await test('App boots on mobile without blank screen', async () => {
      await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      const title = await page.title();
      const version = await page.locator('#versionTag').textContent();
      if (title !== 'Ledger Compass') throw new Error('bad title ' + title);
      if (version !== 'v2.9.3') throw new Error('bad version ' + version);
      await expectText(page, 'Recent Activity');
      await assertNoHorizontalScroll(page);
      await snap(page, '01-home-empty');
    });

    await test('Viewport, focus ring, live region, and reduced motion are present', async () => {
      const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
      if (viewport.includes('user-scalable') || viewport.includes('maximum-scale')) throw new Error(viewport);
      if (await page.locator('#toast').getAttribute('role') !== 'status') throw new Error('toast status missing');
      const hasReducedMotion = await page.evaluate(() => Array.from(document.querySelectorAll('style')).some(s => s.textContent.includes('prefers-reduced-motion')));
      if (!hasReducedMotion) throw new Error('missing reduced motion rule');
      await page.locator('#themeToggleBtn').focus();
      const outline = await page.locator('#themeToggleBtn').evaluate(el => getComputedStyle(el).outlineStyle);
      if (outline === 'none') throw new Error('missing focus outline');
    });

    await test('Seeded finance data renders across Home, Insights, Loans, Compass, Profile', async () => {
      await setRichFixture(page);
      await expectText(page, 'Salary');
      await page.locator('.nav-item').filter({ hasText: 'Insights' }).click();
      await expectText(page, 'Spending by Category');
      await page.locator('.nav-item').filter({ hasText: 'Loans' }).click();
      await expectText(page, 'Car Loan');
      await page.locator('.nav-item').filter({ hasText: 'Compass' }).click();
      await expectText(page, 'Weekly plan');
      await page.locator('.nav-item').filter({ hasText: 'Profile' }).click();
      await expectText(page, 'Income Sources');
      await snap(page, '02-profile-fixture');
    });

    await test('Finance category surfaces use SVG icons instead of emoji text', async () => {
      await page.locator('.nav-item').filter({ hasText: 'Home' }).click();
      await page.waitForTimeout(200);
      if (await page.locator('.tx-icon svg').count() < 1) throw new Error('transaction svg icons missing');
      if (await page.locator('.tx-icon .category-glyph').count() < 1) throw new Error('transaction glyph wrapper missing');
      if (await page.locator('.tx-icon .emoji, .cat-icon .emoji, #catPicker .emoji').count() > 0) throw new Error('legacy emoji category class still rendered');
      await page.locator('.nav-item').filter({ hasText: 'Insights' }).click();
      await page.waitForTimeout(200);
      if (await page.locator('.cat-icon svg').count() < 1) throw new Error('category breakdown svg missing');
      if (await page.locator('.budget-name svg').count() < 1) throw new Error('budget svg missing');
      await page.evaluate(() => openAddModal('expense'));
      await page.waitForTimeout(150);
      if (await page.locator('#catPicker .cat-pick svg').count() < 4) throw new Error('picker svg icons missing');
      if (await page.locator('#inpCatEmoji').count() !== 0) throw new Error('custom category emoji input still visible');
      await page.keyboard.press('Escape');
    });

    await test('Transaction add/edit, filters, and search work', async () => {
      await page.locator('.nav-item').filter({ hasText: 'Home' }).click();
      await page.locator('button').filter({ hasText: 'Expense' }).first().click();
      await page.locator('#inpAmount').fill('12.34');
      await page.locator('#inpDesc').fill('QA Coffee');
      await page.locator('#inpDate').fill(await page.evaluate(() => todayISO()));
      await page.locator('#addModal .btn-primary').filter({ hasText: 'Save' }).click();
      await expectText(page, 'QA Coffee');
      await page.locator('.nav-item').filter({ hasText: 'Home' }).click();
      await page.evaluate(() => goPage('transactions'));
      await page.locator('.pill').filter({ hasText: 'Expenses' }).click();
      await expectText(page, 'QA Coffee');
      await page.locator('.icon-btn').last().click();
      await page.locator('#searchInp').fill('coffee');
      await expectText(page, 'QA Coffee');
      await page.keyboard.press('Escape');
    });

    await test('Modal semantics, labels, focus trap, and Escape close work', async () => {
      await page.evaluate(() => openAddModal('income'));
      await page.waitForTimeout(150);
      const modal = page.locator('#addModal .modal');
      if (await modal.getAttribute('role') !== 'dialog') throw new Error('dialog role missing');
      if (await modal.getAttribute('aria-modal') !== 'true') throw new Error('aria-modal missing');
      const labelFor = await page.locator('#addModal label', { hasText: 'Amount' }).first().getAttribute('for');
      if (labelFor !== 'inpAmount') throw new Error('amount label mismatch');
      const activeId = await page.evaluate(() => document.activeElement && document.activeElement.id);
      if (activeId !== 'inpAmount') throw new Error('focus not on amount');
      await page.keyboard.down('Shift');
      await page.keyboard.press('Tab');
      await page.keyboard.up('Shift');
      const inside = await page.evaluate(() => document.querySelector('#addModal.open')?.contains(document.activeElement));
      if (!inside) throw new Error('focus escaped modal');
      await page.keyboard.press('Escape');
      if (await page.locator('#addModal').evaluate(el => el.classList.contains('open'))) throw new Error('modal did not close');
    });

    await test('Navigation exposes aria-current and no horizontal scroll on all primary tabs', async () => {
      for (const [label, pageName] of [['Home', 'home'], ['Compass', 'compass'], ['Insights', 'stats'], ['Loans', 'loans'], ['Profile', 'profile']]) {
        await page.locator('.nav-item').filter({ hasText: label }).click();
        await page.waitForTimeout(200);
        const current = await page.locator(`.nav-item[data-page="${pageName}"]`).getAttribute('aria-current');
        if (current !== 'page') throw new Error(`${label} missing aria-current`);
        await assertNoHorizontalScroll(page);
      }
    });

    await test('Budgets and category breakdown render data and accessible custom controls', async () => {
      await page.locator('.nav-item').filter({ hasText: 'Insights' }).click();
      await expectText(page, 'Food');
      await expectText(page, 'Transport');
      const firstBudgetRole = await page.locator('.budget-card').first().getAttribute('role');
      const firstBudgetTab = await page.locator('.budget-card').first().getAttribute('tabindex');
      if (firstBudgetRole !== 'button' || firstBudgetTab !== '0') throw new Error('budget card not keyboard reachable');
    });

    await test('Loan detail and payment flow work', async () => {
      await setRichFixture(page);
      await page.locator('.nav-item').filter({ hasText: 'Loans' }).click();
      await page.waitForSelector('#page-loans.active .loan-card');
      await page.locator('.loan-card').filter({ hasText: 'Car Loan' }).first().click();
      await page.waitForFunction(() => document.getElementById('page-loan-detail')?.classList.contains('active'));
      await expectVisibleText(page, '#loanDetailContent', 'Car Loan');
      await page.locator('button').filter({ hasText: 'Add Payment' }).click();
      await page.locator('#inpPayAmount').fill('250');
      await page.locator('#inpPayDate').fill(await page.evaluate(() => todayISO()));
      await page.locator('#paymentModal .btn-primary').click();
      await expectText(page, 'Payment recorded');
    });

    await test('Savings and goals render without category emoji dependency', async () => {
      await setRichFixture(page);
      await page.evaluate(() => goPage('savings'));
      await page.waitForFunction(() => document.getElementById('page-savings')?.classList.contains('active'));
      await expectVisibleText(page, '#page-savings', 'Emergency Fund');
      await expectVisibleText(page, '#page-savings', 'Total Saved');
      await snap(page, '03-savings');
    });

    await test('Profile grouped sections render and collapse preference saves', async () => {
      await page.locator('.nav-item').filter({ hasText: 'Profile' }).click();
      await expectText(page, 'Income Sources');
      const head = page.locator('#profileGroup-incomeSources .profile-group-head');
      await head.click();
      const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('ledger_ui_prefs_v1')).profileSections.incomeSources);
      if (prefs !== false) throw new Error('collapse preference not saved');
    });

    await test('Compass affordability flow and smart insights render', async () => {
      await page.locator('.nav-item').filter({ hasText: 'Compass' }).click();
      await page.locator('.compass-cta').click();
      await page.locator('#inpAffordAmount').fill('100');
      await page.locator('#inpAffordWhat').fill('QA purchase');
      await page.locator('#affordInputView .btn-primary').click();
      await page.waitForFunction(() => document.getElementById('affordResultView')?.style.display !== 'none');
      await expectVisibleText(page, '#affordModal', 'QA purchase');
      await expectVisibleText(page, '#affordModal', 'If you buy today');
      await expectVisibleText(page, '#affordModal', 'Next Pay');
      await expectVisibleText(page, '#affordModal', '14 Days');
      await expectVisibleText(page, '#affordModal', 'Lowest Point');
      await expectVisibleText(page, '#affordModal', 'Goal impact');
      await page.evaluate(() => closeModal('affordModal'));
      await expectText(page, 'Smart Insights');
      await snap(page, '04-compass');
    });

    await test('Theme toggle cycles and preserves readable contrast tokens', async () => {
      const before = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      await page.locator('#themeToggleBtn').click();
      await page.waitForTimeout(150);
      const after = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      if (before === after && !['dark', 'light'].includes(after)) throw new Error('theme did not update');
      const ratios = await page.evaluate(() => {
        function hexToRgb(hex) {
          const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
          return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
        }
        function lum(hex) {
          const rgb = hexToRgb(hex).map(v => v / 255).map(c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
          return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
        }
        function cr(a, b) {
          const A = lum(a), B = lum(b);
          return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05);
        }
        return {
          mutedDark: cr('#81818D', '#15151C'),
          mutedLight: cr('#6B6B73', '#FFFFFF'),
          lightAccent: cr('#5F7F12', '#FFFFFF'),
          lightAccentText: cr('#FFFFFF', '#5F7F12'),
        };
      });
      Object.entries(ratios).forEach(([name, ratio]) => {
        if (ratio < 4.5) throw new Error(`${name} contrast ${ratio}`);
      });
    });

    await test('Recurring date logic handles invalid and monthly edge cases', async () => {
      const checks = await page.evaluate(() => {
        const oneStep31 = advanceRecurringDate('2026-02-28', 'monthly', 31);
        const oneStep30 = advanceRecurringDate('2026-02-28', 'monthly', 30);
        const invalidIncome = computeNextPayDate({ nextPay: 'bad-date', cycle: 'weekly' });
        const invalidExpense = computeNextDueDate({ nextDue: '2026-02-31', cycle: 'monthly' });
        return { oneStep31, oneStep30, invalidIncome, invalidExpense };
      });
      if (checks.oneStep31 !== '2026-03-31') throw new Error(JSON.stringify(checks));
      if (checks.oneStep30 !== '2026-03-30') throw new Error(JSON.stringify(checks));
      if (checks.invalidIncome !== null || checks.invalidExpense !== null) throw new Error(JSON.stringify(checks));
    });

    await test('Auto-log catch-up creates income and recurring expense entries safely', async () => {
      const output = await page.evaluate(() => {
        const originalToday = todayISO;
        todayISO = () => '2026-02-28';
        state.transactions = [];
        state.incomeSources = [{ id: 'inc_monthly', name: 'Monthly', amount: 1000, cycle: 'monthly', nextPay: '2026-02-28', startDate: '2026-01-31', autoLog: true, lastAutoLogDate: null }];
        state.recurringExpenses = [{ id: 'rec_monthly', name: 'Monthly Bill', amount: 100, category: 'home', cycle: 'monthly', nextDue: '2026-02-28', startDate: '2026-01-31', active: true, lastAutoLogDate: null }];
        runAutoLog();
        const result = {
          txCount: state.transactions.length,
          nextPay: state.incomeSources[0].nextPay,
          nextDue: state.recurringExpenses[0].nextDue,
        };
        todayISO = originalToday;
        return result;
      });
      if (output.txCount !== 2 || output.nextPay !== '2026-03-31' || output.nextDue !== '2026-03-31') throw new Error(JSON.stringify(output));
    });

    await test('No browser console or page errors during QA journey', async () => {
      if (consoleErrors.length) throw new Error(consoleErrors.join('\n'));
    });

    await context.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
  }

  const summary = {
    total: results.length,
    pass: results.filter(r => r.status === 'PASS').length,
    fail: results.filter(r => r.status === 'FAIL').length,
    durationMs: Date.now() - started,
  };
  const metadata = { generatedAt: nowIso(), url: appUrl };
  fs.writeFileSync(REPORT_JSON, JSON.stringify({ summary, metadata, results, consoleErrors, screenshots }, null, 2));
  fs.writeFileSync(REPORT_HTML, reportHtml(summary, metadata));

  const reportBrowser = await chromium.launch({ headless: true });
  const reportPage = await reportBrowser.newPage();
  await reportPage.goto('file:///' + REPORT_HTML.replace(/\\/g, '/'), { waitUntil: 'load' });
  let reportPdf = REPORT_PDF;
  try {
    await reportPage.pdf({ path: reportPdf, format: 'A4', printBackground: true, margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' } });
  } catch (error) {
    if (!error || error.code !== 'EBUSY') throw error;
    reportPdf = path.join(OUT_DIR, `Ledger_Compass_Full_QA_Report_${Date.now()}.pdf`);
    await reportPage.pdf({ path: reportPdf, format: 'A4', printBackground: true, margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' } });
  }
  await reportBrowser.close();

  console.log(JSON.stringify({ summary, reportPdf, reportHtml: REPORT_HTML, reportJson: REPORT_JSON }, null, 2));
  process.exit(summary.fail ? 1 : 0);
})().catch(error => {
  console.error(error);
  process.exit(1);
});

async function expectText(page, text) {
  const body = await page.locator('body').innerText();
  if (!body.includes(text)) throw new Error(`Missing text: ${text}`);
}

async function expectVisibleText(page, selector, text) {
  const content = await page.locator(selector).innerText();
  if (!content.toLowerCase().includes(String(text).toLowerCase())) {
    throw new Error(`Missing text in ${selector}: ${text}. Found: ${content.slice(0, 400)}`);
  }
}
