const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'qa', 'full-qa', 'affordability');
const REPORT_JSON = path.join(OUT_DIR, 'ledger-affordability-qa-results.json');
const REPORT_HTML = path.join(OUT_DIR, 'Ledger_Compass_Affordability_QA_Report.html');
const REPORT_PDF = path.join(OUT_DIR, 'Ledger_Compass_Affordability_QA_Report.pdf');

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
    pass(name, Date.now() - start);
  } catch (error) {
    fail(name, Date.now() - start, error);
  }
}
async function snap(page, name) {
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  screenshots.push({ name, file });
}
async function expectText(page, selector, text) {
  const body = await page.locator(selector).innerText({ timeout: 5000 });
  if (!body.toLowerCase().includes(String(text).toLowerCase())) {
    throw new Error(`Expected ${selector} to include "${text}". Actual: ${body.slice(0, 700)}`);
  }
}
async function assertNoHorizontalScroll(page) {
  const dims = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  if (dims.doc > dims.innerWidth + 1 || dims.body > dims.innerWidth + 1) {
    throw new Error(`horizontal scroll detected ${JSON.stringify(dims)}`);
  }
}

async function newReadyPage(context, baseUrl) {
  const page = await context.newPage();
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(err.message));
  await page.goto(`${baseUrl}/www/index.html?v=affordability-qa`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('.nav-item') && typeof state !== 'undefined' && typeof renderAll === 'function' && typeof goPage === 'function');
  return page;
}

async function seedState(page, opts = {}) {
  await page.evaluate(options => {
    const today = todayISO();
    const plus = n => {
      const d = parseISODateLocal(today);
      d.setDate(d.getDate() + n);
      return isoOf(d);
    };
    state.transactions = [
      { id: 'qa_opening', type: 'income', amount: options.balance ?? 2000, description: 'Opening balance', category: 'salary', date: today, note: '', createdAt: Date.now() },
      ...(options.expenses || []),
    ];
    state.incomeSources = options.noIncome ? [] : [{
      id: 'qa_income',
      name: 'Salary',
      amount: options.incomeAmount ?? 1000,
      cycle: 'fortnightly',
      nextPay: plus(options.nextPayDays ?? 7),
      startDate: today,
      autoLog: false,
      lastAutoLogDate: null,
    }];
    state.recurringExpenses = (options.bills || []).map((bill, index) => ({
      id: `qa_bill_${index}`,
      name: bill.name,
      amount: bill.amount,
      category: bill.category || 'home',
      cycle: bill.cycle || 'monthly',
      nextDue: plus(bill.daysUntil),
      startDate: today,
      active: true,
      lastAutoLogDate: null,
    }));
    state.loans = [];
    state.savings = options.goal ? [{
      id: 'qa_save_goal',
      type: 'deposit',
      amount: options.goal.saved,
      note: 'Goal progress',
      goalId: 'qa_goal',
      date: today,
      affectsBalance: false,
      createdAt: Date.now(),
    }] : [];
    state.savingsGoals = options.goal ? [{
      id: 'qa_goal',
      name: options.goal.name || 'Emergency Fund',
      emoji: '',
      target: options.goal.target,
      deadline: plus(options.goal.deadlineDays),
      createdAt: Date.now() - 86400000 * 14,
    }] : [];
    state.decisions = [];
    saveData();
    renderAll();
  }, opts);
  await page.waitForTimeout(250);
}

async function runCheck(page, amount, label = 'QA purchase') {
  await page.evaluate(() => goPage('compass'));
  await page.waitForFunction(() => document.getElementById('page-compass')?.classList.contains('active'));
  await page.locator('.compass-cta').click();
  await page.locator('#inpAffordAmount').fill(String(amount));
  await page.locator('#inpAffordWhat').fill(label);
  await page.getByRole('button', { name: 'Run Check' }).click();
  await expectText(page, '#affordModal', 'If you buy today');
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
  <title>Ledger Compass Affordability QA Report</title>
  <style>
    body { font-family: Arial, sans-serif; color: #111827; margin: 32px; line-height: 1.45; }
    h1, h2 { margin: 0 0 12px; }
    .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 18px 0 24px; }
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
  </style>
</head>
<body>
  <h1>Ledger Compass Affordability QA Report</h1>
  <p>Generated ${esc(metadata.generatedAt)} for the richer decision moment helper.</p>
  <div class="summary">
    <div class="box"><strong>Total</strong><br>${summary.total}</div>
    <div class="box"><strong>Passed</strong><br><span class="passText">${summary.pass}</span></div>
    <div class="box"><strong>Failed</strong><br><span class="${summary.fail ? 'failText' : 'passText'}">${summary.fail}</span></div>
    <div class="box"><strong>Console errors</strong><br>${consoleErrors.length}</div>
  </div>
  <h2>Test Results</h2>
  <table><thead><tr><th>Status</th><th>Test</th><th>Time</th><th>Details</th></tr></thead><tbody>${rows}</tbody></table>
  <h2>Screenshots</h2>
  ${shots || '<p>No screenshots captured.</p>'}
</body>
</html>`;
}

async function main() {
  const { server, baseUrl } = await serveWorkspace();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  await context.addInitScript(() => {
    localStorage.setItem('ledger_setup_status_v1', JSON.stringify({ status: 'completed', updatedAt: Date.now() }));
    localStorage.setItem('tour_completed', 'affordability-qa');
    localStorage.setItem('ledger_install_dismissed', '1');
  });

  try {
    await test('Affordable purchase shows safe timeline recommendation', async () => {
      const page = await newReadyPage(context, baseUrl);
      await seedState(page, { balance: 2400, nextPayDays: 6, bills: [{ name: 'Internet', amount: 80, daysUntil: 12 }] });
      await runCheck(page, 100, 'Desk lamp');
      await expectText(page, '#affordModal', 'Buy now looks okay');
      await expectText(page, '#affordModal', 'Next Pay');
      await expectText(page, '#affordModal', '14 Days');
      await snap(page, '01-affordable');
      await page.close();
    });

    await test('Positive today but negative later after recurring bill is blocked', async () => {
      const page = await newReadyPage(context, baseUrl);
      await seedState(page, { balance: 500, nextPayDays: 14, bills: [{ name: 'Rent', amount: 800, daysUntil: 7, cycle: 'weekly' }] });
      await runCheck(page, 100, 'Concert ticket');
      await expectText(page, '#affordModal', 'Avoid for now');
      await expectText(page, '#affordModal', 'Future negative balance');
      await expectText(page, '#affordModal', 'Bill money gets used');
      await snap(page, '02-negative-after-bill');
      await page.close();
    });

    await test('Nearest deadline goal impact is shown with estimated delay', async () => {
      const page = await newReadyPage(context, baseUrl);
      await seedState(page, {
        balance: 1800,
        nextPayDays: 5,
        goal: { name: 'Holiday Fund', target: 1000, saved: 500, deadlineDays: 35 },
      });
      await runCheck(page, 200, 'New headphones');
      await expectText(page, '#affordModal', 'Goal impact');
      await expectText(page, '#affordModal', 'Holiday Fund');
      await expectText(page, '#affordModal', 'delay');
      await snap(page, '03-goal-impact');
      await page.close();
    });

    await test('No-goal state omits goal impact card', async () => {
      const page = await newReadyPage(context, baseUrl);
      await seedState(page, { balance: 1800, nextPayDays: 5 });
      await runCheck(page, 120, 'Shoes');
      const text = await page.locator('#affordModal').innerText();
      if (text.includes('Goal impact')) throw new Error('Goal impact rendered with no active deadline goal');
      await page.close();
    });

    await test('No-income state gives useful fallback guidance', async () => {
      const page = await newReadyPage(context, baseUrl);
      await seedState(page, { balance: 900, noIncome: true });
      await runCheck(page, 80, 'Groceries');
      await expectText(page, '#affordModal', 'No income source');
      await expectText(page, '#affordModal', 'Add income in Profile');
      await page.close();
    });

    await test('Saved decision journal includes projection snapshot', async () => {
      const page = await newReadyPage(context, baseUrl);
      await seedState(page, {
        balance: 1800,
        nextPayDays: 6,
        goal: { name: 'Emergency Fund', target: 1200, saved: 500, deadlineDays: 49 },
      });
      await runCheck(page, 180, 'Bike repair');
      await page.getByRole('button', { name: "I'll wait / skip" }).click();
      await page.evaluate(() => goPage('decisions'));
      await expectText(page, '#decisionList', 'Bike repair');
      await expectText(page, '#decisionList', 'Next pay');
      await expectText(page, '#decisionList', '14 days');
      await expectText(page, '#decisionList', 'Lowest point');
      await snap(page, '04-decision-journal');
      await page.close();
    });

    await test('Affordability modal is accessible and mobile layout has no horizontal scroll', async () => {
      const page = await newReadyPage(context, baseUrl);
      await seedState(page, { balance: 2000, nextPayDays: 7 });
      await runCheck(page, 90, 'Backpack');
      const role = await page.locator('#affordModal .modal').getAttribute('role');
      const ariaModal = await page.locator('#affordModal .modal').getAttribute('aria-modal');
      if (role !== 'dialog' || ariaModal !== 'true') throw new Error(`dialog semantics missing role=${role} aria-modal=${ariaModal}`);
      await page.keyboard.press('Tab');
      const activeInside = await page.evaluate(() => document.getElementById('affordModal').contains(document.activeElement));
      if (!activeInside) throw new Error('focus escaped affordability modal');
      await assertNoHorizontalScroll(page);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.getElementById('affordModal')?.classList.contains('open'));
      await page.close();
    });
  } finally {
    const summary = {
      total: results.length,
      pass: results.filter(r => r.status === 'PASS').length,
      fail: results.filter(r => r.status === 'FAIL').length,
    };
    const metadata = { generatedAt: new Date().toISOString(), url: baseUrl };
    fs.writeFileSync(REPORT_JSON, JSON.stringify({ summary, metadata, consoleErrors, results, screenshots }, null, 2));
    const html = reportHtml(summary, metadata);
    fs.writeFileSync(REPORT_HTML, html);
    const reportPage = await browser.newPage({ viewport: { width: 1200, height: 1600 } });
    await reportPage.setContent(html, { waitUntil: 'load' });
    try {
      await reportPage.pdf({ path: REPORT_PDF, format: 'A4', printBackground: true });
    } catch (error) {
      const fallback = path.join(OUT_DIR, `Ledger_Compass_Affordability_QA_Report_${Date.now()}.pdf`);
      await reportPage.pdf({ path: fallback, format: 'A4', printBackground: true });
    }
    await reportPage.close();
    await browser.close();
    server.close();

    console.log(JSON.stringify({ summary, report: REPORT_HTML, pdf: REPORT_PDF, consoleErrors }, null, 2));
    if (summary.fail || consoleErrors.length) process.exit(1);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
