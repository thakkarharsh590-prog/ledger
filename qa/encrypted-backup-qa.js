const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('C:/Users/HP/AppData/Roaming/npm/node_modules/playwright/index.js');

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

async function expectText(page, text) {
  const body = await page.locator('body').innerText();
  if (!body.includes(text)) throw new Error(`Missing text: ${text}`);
}

async function waitForText(page, text) {
  await page.waitForFunction(expected => document.body.innerText.includes(expected), text, { timeout: 10000 });
}

(async () => {
  const { server, baseUrl } = await serveWorkspace();
  const downloads = path.join(ROOT, 'qa', 'encrypted-backup-downloads');
  fs.mkdirSync(downloads, { recursive: true });
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      acceptDownloads: true,
    });
    await context.addInitScript(() => {
      localStorage.setItem('tour_completed', 'skipped');
      localStorage.setItem('ledger_setup_status_v1', JSON.stringify({ status: 'skipped', at: Date.now(), version: 'qa' }));
      localStorage.setItem('ledger_install_dismissed', '1');
      localStorage.setItem('first_launch_warning_shown', 'yes');
      localStorage.removeItem('ledger_data_v1');
      localStorage.removeItem('ledger_recovery_key_v1');
      localStorage.removeItem('ledger_last_encrypted_backup');
    });
    const page = await context.newPage();
    await page.goto(`${baseUrl}/www/index.html?v=encrypted-backup-qa-${Date.now()}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    await page.evaluate(() => {
      const today = todayISO();
      state.transactions = [
        { id: 'qa_inc', type: 'income', amount: 2000, description: 'Salary QA', category: 'salary', date: today, note: '', createdAt: Date.now() },
        { id: 'qa_exp', type: 'expense', amount: 42, description: 'Groceries QA', category: 'food', date: today, note: '', createdAt: Date.now() },
      ];
      state.incomeSources = [{ id: 'qa_src', name: 'Salary QA', amount: 2000, cycle: 'fortnightly', nextPay: today, startDate: today, autoLog: false }];
      state.recurringExpenses = [{ id: 'qa_bill', name: 'Rent QA', amount: 600, category: 'home', cycle: 'weekly', nextDue: today, startDate: today, active: true }];
      state.loans = [{ id: 'qa_loan', name: 'Car QA', lender: '', total: 3000, interestRate: 7, initialPaid: 0, startDate: today, payments: [], deductFromBalance: false }];
      state.savingsGoals = [{ id: 'qa_goal', name: 'Emergency QA', emoji: '', target: 1000, deadline: today, createdAt: Date.now() }];
      state.decisions = [{ id: 'qa_decision', what: 'Laptop QA', amount: 100, date: today, action: 'no', zone: 'yellow', createdAt: Date.now() }];
      saveData();
      renderAll();
    });

    await page.locator('.nav-item').filter({ hasText: 'Profile' }).click();
    await page.locator('#profileGroup-dataBackup .profile-group-head').click();
    await page.locator('.setting-row').filter({ hasText: 'Back up data' }).click();
    await expectText(page, 'Save your recovery key');
    const confirmInitiallyDisabled = await page.locator('#confirmRecoverySavedBtn').isDisabled();
    if (!confirmInitiallyDisabled) throw new Error('Recovery confirmation should start disabled');
    const keyDownloadPromise = page.waitForEvent('download');
    await page.locator('button').filter({ hasText: 'Save key file' }).click();
    const keyDownload = await keyDownloadPromise;
    await keyDownload.saveAs(path.join(downloads, await keyDownload.suggestedFilename()));
    const confirmEnabled = !(await page.locator('#confirmRecoverySavedBtn').isDisabled());
    if (!confirmEnabled) throw new Error('Recovery confirmation did not enable after copy');
    const firstDownloadPromise = page.waitForEvent('download');
    await page.locator('#confirmRecoverySavedBtn').click();
    const firstDownload = await firstDownloadPromise;
    const firstPath = path.join(downloads, await firstDownload.suggestedFilename());
    await firstDownload.saveAs(firstPath);
    const encryptedText = fs.readFileSync(firstPath, 'utf8');
    const envelope = JSON.parse(encryptedText);
    if (envelope.format !== 'ledger-compass-encrypted-backup') throw new Error('Bad encrypted backup format');
    if (encryptedText.includes('Salary QA') || encryptedText.includes('Rent QA')) throw new Error('Encrypted backup leaked plaintext finance data');
    const savedKey = await page.evaluate(() => localStorage.getItem('ledger_recovery_key_v1'));
    if (!savedKey) throw new Error('Recovery key was not saved for later backups');

    await page.locator('.setting-row').filter({ hasText: 'Back up data' }).click();
    const secondDownload = await page.waitForEvent('download');
    await secondDownload.saveAs(path.join(downloads, await secondDownload.suggestedFilename()));
    const keyModalOpen = await page.locator('#backupKeyModal.open').count();
    if (keyModalOpen) throw new Error('Later backup should not show recovery key ceremony');

    await page.locator('#importFile').setInputFiles(firstPath);
    await page.locator('#restoreRecoveryKey').fill('wrong-key');
    await page.locator('button').filter({ hasText: 'Preview restore' }).click();
    await waitForText(page, "That key didn't work");
    const formattedSavedKey = savedKey.match(/.{1,4}/g).join('-');
    await page.locator('#restoreRecoveryKey').fill(formattedSavedKey);
    await page.locator('button').filter({ hasText: 'Preview restore' }).click();
    await waitForText(page, 'Restore will replace everything currently in this app');
    const previewStatCount = await page.locator('#restorePreviewCounts .backup-preview-stat').count();
    if (previewStatCount !== 6) throw new Error(`Expected 6 restore preview stats, got ${previewStatCount}`);

    await browser.close();
    server.close();
    console.log(JSON.stringify({ pass: true, firstPath }, null, 2));
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    server.close();
    console.error(error);
    process.exit(1);
  }
})();
