const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('C:/Users/HP/AppData/Roaming/npm/node_modules/playwright/index.js');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'qa', 'full-qa');
const REPORT_JSON = path.join(OUT_DIR, 'ledger-setup-wizard-qa-results.json');
const REPORT_HTML = path.join(OUT_DIR, 'Ledger_Compass_Setup_Wizard_QA_Report.html');
const REPORT_PDF = path.join(OUT_DIR, 'Ledger_Compass_Setup_Wizard_QA_Report.pdf');

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
    server.listen(0, '127.0.0.1', () => resolve({
      server,
      baseUrl: `http://127.0.0.1:${server.address().port}`,
    }));
  });
}

const results = [];
const screenshots = [];
const consoleErrors = [];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function record(name, status, duration, details = '') {
  results.push({ name, status, duration, details });
}

async function test(name, fn) {
  const started = Date.now();
  try {
    await fn();
    record(name, 'PASS', Date.now() - started);
  } catch (error) {
    record(name, 'FAIL', Date.now() - started, error.stack || error.message || String(error));
  }
}

async function snap(page, name) {
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  screenshots.push({ name, file });
}

async function newPage(browser, appUrl, initScript) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('__ledger_setup_qa_seeded')) {
      localStorage.clear();
      localStorage.setItem('ledger_install_dismissed', '1');
      sessionStorage.setItem('__ledger_setup_qa_seeded', '1');
    }
  });
  if (initScript) await context.addInitScript(initScript);
  const page = await context.newPage();
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push(err.message));
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  return { context, page };
}

async function expectVisible(page, selector, label) {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: 'visible', timeout: 5000 });
  if (!(await locator.isVisible())) throw new Error(`${label || selector} not visible`);
}

async function expectHidden(page, selector, label) {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: 'hidden', timeout: 5000 });
  if (await locator.isVisible().catch(() => false)) throw new Error(`${label || selector} still visible`);
}

async function completeWizard(page) {
  await expectVisible(page, '#setupWizard', 'setup wizard');
  await page.fill('#setupName', 'QA User');
  await page.locator('#setupNextBtn').click();
  await page.fill('#setupBalance', '1250.50');
  await page.locator('#setupNextBtn').click();
  await page.fill('#setupIncomeName', 'Salary');
  await page.fill('#setupIncomeAmount', '3200');
  await page.locator('#setupNextBtn').click();
  await page.fill('#setupBillName', 'Rent');
  await page.fill('#setupBillAmount', '650');
  await page.locator('button', { hasText: 'Add bill' }).click();
  await page.locator('#setupNextBtn').click();
  await page.locator('#setupNextBtn').click();
  await expectHidden(page, '#setupWizard', 'setup wizard');
}

function reportHtml(summary, metadata) {
  const rows = results.map(r => `
    <tr class="${r.status.toLowerCase()}">
      <td>${esc(r.status)}</td>
      <td>${esc(r.name)}</td>
      <td>${r.duration} ms</td>
      <td><pre>${esc(r.details)}</pre></td>
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
  <title>Ledger Compass Setup Wizard QA Report</title>
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
    .page-break { page-break-before: always; }
  </style>
</head>
<body>
  <h1>Ledger Compass Setup Wizard QA Report</h1>
  <p>Generated ${esc(metadata.generatedAt)} for ${esc(metadata.url)}.</p>
  <div class="summary">
    <div class="box"><strong>Total</strong><br>${summary.total}</div>
    <div class="box"><strong>Passed</strong><br><span class="passText">${summary.pass}</span></div>
    <div class="box"><strong>Failed</strong><br><span class="${summary.fail ? 'failText' : 'passText'}">${summary.fail}</span></div>
    <div class="box"><strong>Duration</strong><br>${summary.durationMs} ms</div>
  </div>
  <div class="box"><strong>Console/page errors</strong><br>${consoleErrors.length ? esc(consoleErrors.join('\n')) : 'None'}</div>
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
  const appUrl = `${baseUrl}/www/index.html?v=setup-qa-${Date.now()}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });

    await test('Fresh empty install opens setup wizard automatically', async () => {
      const { context, page } = await newPage(browser, appUrl);
      await expectVisible(page, '#setupWizard', 'setup wizard');
      await expectVisible(page, '#setupName', 'name field');
      const title = await page.locator('#setupTitle').textContent();
      if (title !== 'Set up Ledger Compass') throw new Error(`unexpected title: ${title}`);
      await snap(page, 'setup-01-fresh-wizard');
      await context.close();
    });

    await test('Validation blocks blank balance with inline error', async () => {
      const { context, page } = await newPage(browser, appUrl);
      await expectVisible(page, '#setupWizard', 'setup wizard');
      await page.locator('#setupNextBtn').click();
      await page.locator('#setupNextBtn').click();
      await expectVisible(page, '#setupError', 'setup validation error');
      const error = await page.locator('#setupError').textContent();
      if (!error.includes('current balance')) throw new Error(`wrong validation: ${error}`);
      await context.close();
    });

    await test('User completes 5-step wizard and real finance data persists', async () => {
      const { context, page } = await newPage(browser, appUrl);
      await completeWizard(page);
      await expectVisible(page, '#page-compass.active', 'compass page');
      const stored = await page.evaluate(() => ({
        setup: JSON.parse(localStorage.getItem('ledger_setup_status_v1')),
        data: JSON.parse(localStorage.getItem('ledger_data_v1')),
        balance: getCurrentBalance(),
      }));
      if (stored.setup.status !== 'completed') throw new Error('setup not completed');
      if (stored.data.userName !== 'QA User') throw new Error('name not saved');
      if (stored.data.transactions.length !== 1) throw new Error('opening balance transaction missing');
      if (stored.data.transactions[0].description !== 'Opening balance') throw new Error('wrong opening transaction');
      if (stored.data.incomeSources.length !== 1) throw new Error('income source missing');
      if (stored.data.incomeSources[0].autoLog !== false) throw new Error('auto-log should default off');
      if (stored.data.recurringExpenses.length !== 1) throw new Error('recurring bill missing');
      if (Math.abs(stored.balance - 1250.5) > 0.01) throw new Error(`wrong balance ${stored.balance}`);
      await snap(page, 'setup-02-completed-compass');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      if (await page.locator('#setupWizard').isVisible()) throw new Error('setup reopened after completion');
      await context.close();
    });

    await test('Existing users with data are not interrupted', async () => {
      const { context, page } = await newPage(browser, appUrl, () => {
        localStorage.setItem('ledger_data_v1', JSON.stringify({
          schemaVersion: 9,
          transactions: [{ id: 'existing_tx', type: 'income', amount: 100, description: 'Existing', category: 'other_in', date: '2026-06-03', note: '', createdAt: Date.now() }],
          budgets: {},
          loans: [],
          customCategories: { income: [], expense: [] },
          incomeSources: [],
          decisions: [],
          recurringExpenses: [],
          savings: [],
          savingsGoals: [],
          earnedMilestones: {},
          currency: 'AUD',
          userName: 'Existing User',
        }));
        localStorage.setItem('tour_completed', 'auto-skipped');
        localStorage.setItem('first_launch_warning_shown', 'yes');
      });
      await page.waitForTimeout(1500);
      if (await page.locator('#setupWizard').isVisible()) throw new Error('setup opened for existing user');
      await expectVisible(page, '#page-home.active', 'home page');
      await context.close();
    });

    await test('Skip flow persists and does not loop after reload', async () => {
      const { context, page } = await newPage(browser, appUrl);
      await expectVisible(page, '#setupWizard', 'setup wizard');
      await page.locator('#setupSkipBtn').click();
      await expectHidden(page, '#setupWizard', 'setup wizard');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      if (await page.locator('#setupWizard').isVisible()) throw new Error('setup reopened after skip');
      const status = await page.evaluate(() => JSON.parse(localStorage.getItem('ledger_setup_status_v1')).status);
      if (status !== 'skipped') throw new Error(`wrong skip status ${status}`);
      await context.close();
    });

    await test('Profile can manually reopen setup wizard', async () => {
      const { context, page } = await newPage(browser, appUrl);
      await completeWizard(page);
      await page.locator('.nav-item[data-page="profile"]').click();
      await expectVisible(page, '#profileContent', 'profile content');
      await page.locator('.setting-row', { hasText: 'Run setup wizard' }).click();
      await expectVisible(page, '#setupWizard', 'setup wizard');
      await snap(page, 'setup-03-profile-rerun');
      await context.close();
    });

    await test('Setup wizard has dialog semantics, labels, focus trap, and no horizontal scroll', async () => {
      const { context, page } = await newPage(browser, appUrl);
      await expectVisible(page, '#setupWizard', 'setup wizard');
      const semantics = await page.evaluate(() => {
        const shell = document.querySelector('#setupWizard .setup-shell');
        const labels = Array.from(document.querySelectorAll('#setupWizard label')).map(l => ({
          text: l.textContent.trim(),
          forAttr: l.getAttribute('for'),
        }));
        const dims = {
          innerWidth: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          bodyScrollWidth: document.body.scrollWidth,
        };
        return {
          role: shell.getAttribute('role'),
          modal: shell.getAttribute('aria-modal'),
          labelledby: shell.getAttribute('aria-labelledby'),
          labels,
          dims,
        };
      });
      if (semantics.role !== 'dialog' || semantics.modal !== 'true' || semantics.labelledby !== 'setupTitle') {
        throw new Error(`bad dialog semantics ${JSON.stringify(semantics)}`);
      }
      if (!semantics.labels.every(l => l.forAttr)) throw new Error(`unlinked labels ${JSON.stringify(semantics.labels)}`);
      if (semantics.dims.scrollWidth > semantics.dims.innerWidth + 1 || semantics.dims.bodyScrollWidth > semantics.dims.innerWidth + 1) {
        throw new Error(`horizontal scroll ${JSON.stringify(semantics.dims)}`);
      }
      await page.locator('#setupName').focus();
      for (let i = 0; i < 8; i += 1) await page.keyboard.press('Tab');
      const focusInside = await page.evaluate(() => document.querySelector('#setupWizard').contains(document.activeElement));
      if (!focusInside) throw new Error('focus escaped setup wizard');
      await context.close();
    });

    if (consoleErrors.length) {
      throw new Error(`Console/page errors detected:\n${consoleErrors.join('\n')}`);
    }
  } finally {
    if (browser) await browser.close();
    server.close();
  }

  const summary = {
    total: results.length,
    pass: results.filter(r => r.status === 'PASS').length,
    fail: results.filter(r => r.status === 'FAIL').length,
    durationMs: Date.now() - started,
  };
  const metadata = { generatedAt: new Date().toISOString(), url: appUrl };
  fs.writeFileSync(REPORT_JSON, JSON.stringify({ summary, metadata, results, screenshots, consoleErrors }, null, 2));
  fs.writeFileSync(REPORT_HTML, reportHtml(summary, metadata));

  browser = await chromium.launch({ headless: true });
  try {
    const reportPage = await browser.newPage();
    await reportPage.goto('file:///' + REPORT_HTML.replace(/\\/g, '/'), { waitUntil: 'load' });
    await reportPage.pdf({ path: REPORT_PDF, format: 'A4', printBackground: true });
  } finally {
    await browser.close();
  }

  console.log(JSON.stringify({ summary, reports: { json: REPORT_JSON, html: REPORT_HTML, pdf: REPORT_PDF }, consoleErrors }, null, 2));
  process.exit(summary.fail === 0 ? 0 : 1);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
