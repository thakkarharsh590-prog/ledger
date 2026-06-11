const { test, expect } = require('@playwright/test');
const fs = require('fs');
const { seedApp, dataPayload, readAppData, isoDaysFromToday } = require('../helpers');

// In-browser round trip of the encrypted backup. NOTE: this passing in Chromium
// does NOT validate the Android WebView path (review blocker #1) — blob downloads
// work in desktop browsers but not in the Capacitor WebView. Device test required.

async function previewRestoreWithKey(page, recoveryKey) {
  await page.locator('#restoreRecoveryKey').evaluate((el, value) => {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, recoveryKey);
  await page.evaluate(() => decryptImportedBackup());
}

test.describe('Encrypted backup & restore', () => {
  test.skip(({ browserName }) => browserName === 'webkit', 'Encrypted backup download/import coverage is validated on Chromium; Android native export has its own mocked tests.');

  test('create encrypted backup, wipe, restore via file import with recovery key', async ({ page }) => {
    const data = dataPayload({
      userName: 'Backup User',
      transactions: [{ id: 't1', type: 'income', amount: 321, description: 'Pay', category: 'salary', date: isoDaysFromToday(-2), note: '', createdAt: 1 }],
      savingsGoals: [{ id: 'g1', name: 'Trip', emoji: '', target: 900, deadline: null, createdAt: 1 }],
    });
    await seedApp(page, { data });

    // First backup: recovery key modal appears
    await page.evaluate(() => window.exportData());
    await expect(page.locator('#backupKeyModal')).toHaveClass(/open/);
    const recoveryKey = (await page.locator('#recoveryKeyDisplay').textContent()).trim();
    expect(recoveryKey.length).toBeGreaterThan(10);

    // "Save key file" enables confirm; capture both downloads (key + backup)
    const dl1Promise = page.waitForEvent('download');
    await page.click('#backupKeyModal button:has-text("Save key file")');
    await dl1Promise;

    const dl2Promise = page.waitForEvent('download');
    await page.click('#confirmRecoverySavedBtn');
    const backupDl = await dl2Promise;
    const backupPath = await backupDl.path();
    const envelope = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    expect(envelope.format).toBe('ledger-compass-encrypted-backup');
    expect(envelope.cipher?.text, 'AES-GCM ciphertext present').toBeTruthy();
    expect(envelope.kdf?.salt, 'PBKDF2 salt present').toBeTruthy();
    // plaintext must not leak into the envelope
    expect(JSON.stringify(envelope)).not.toContain('Backup User');

    // Wipe app data, reload empty
    await page.evaluate(() => {
      localStorage.removeItem('ledger_data_v1');
      localStorage.setItem('recovery_dismissed', 'yes');
    });
    await page.reload();
    await page.waitForSelector('.bottom-nav');
    await expect(page.locator('#balance')).toHaveText('0.00');

    // Import the backup file
    await page.setInputFiles('#importFile', backupPath);
    await expect(page.locator('#restoreModal')).toHaveClass(/open/);
    await previewRestoreWithKey(page, recoveryKey);
    await expect(page.locator('#restoreStepPreview')).toBeVisible();
    await expect(page.locator('#restorePreviewCounts')).toContainText('1'); // tx count

    await page.click('#restoreConfirmBtn');
    await page.waitForSelector('#page-home.active');

    const restored = await readAppData(page);
    expect(restored.transactions).toHaveLength(1);
    expect(restored.transactions[0].amount).toBe(321);
    expect(restored.savingsGoals).toHaveLength(1);
    expect(restored.userName).toBe('Backup User');
  });

  test('wrong recovery key is rejected with friendly error', async ({ page }) => {
    const data = dataPayload({
      transactions: [{ id: 't1', type: 'income', amount: 100, description: 'Pay', category: 'salary', date: isoDaysFromToday(-2), note: '', createdAt: 1 }],
    });
    await seedApp(page, { data });

    await page.evaluate(() => window.exportData());
    await expect(page.locator('#backupKeyModal')).toHaveClass(/open/);
    const dl1 = page.waitForEvent('download');
    await page.click('#backupKeyModal button:has-text("Save key file")');
    await dl1;
    const dl2 = page.waitForEvent('download');
    await page.click('#confirmRecoverySavedBtn');
    const backupPath = await (await dl2).path();

    await page.setInputFiles('#importFile', backupPath);
    await expect(page.locator('#restoreModal')).toHaveClass(/open/);
    await previewRestoreWithKey(page, 'WRONG-KEY-1234-5678');
    await expect(page.locator('#restoreError')).toContainText("didn't work");
    await expect(page.locator('#restoreStepPreview')).toBeHidden();
  });

  test('CSV export downloads and contains transaction rows', async ({ page }) => {
    const data = dataPayload({
      transactions: [{ id: 't1', type: 'expense', amount: 12.5, description: 'Coffee, with comma', category: 'food', date: isoDaysFromToday(-1), note: '', createdAt: 1 }],
    });
    await seedApp(page, { data });
    const dlPromise = page.waitForEvent('download');
    await page.evaluate(() => window.exportCSV());
    const dl = await dlPromise;
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    expect(csv).toContain('Date,Type,Category,Description,Amount,Note');
    expect(csv).toContain('expense');
    expect(csv).toContain('12.5');
  });
});
