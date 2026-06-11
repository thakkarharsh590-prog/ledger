const { test, expect } = require('@playwright/test');
const { seedApp, dataPayload, isoDaysFromToday, installCapacitorMocks } = require('../helpers');

test.describe('Native Android exports', () => {
  test.skip(({ browserName }) => browserName === 'webkit', 'Native Android export coverage targets the Chromium WebView runtime.');

  test('encrypted backup writes and shares a real native file before recording success', async ({ page }) => {
    await installCapacitorMocks(page);
    await seedApp(page, {
      data: dataPayload({
        transactions: [{ id: 't1', type: 'income', amount: 500, description: 'Pay', category: 'salary', date: isoDaysFromToday(-1), note: '', createdAt: 1 }],
      }),
    });

    const result = await page.evaluate(async () => {
      localStorage.removeItem('ledger_last_encrypted_backup');
      await createEncryptedBackup(generateRecoveryKey());
      return {
        calls: window.__nativeExportCalls,
        lastBackup: localStorage.getItem('ledger_last_encrypted_backup'),
      };
    });

    expect(result.calls.map(c => `${c.plugin}.${c.method}`)).toEqual(['Filesystem.writeFile', 'Share.share']);
    expect(result.calls[0].options).toMatchObject({
      directory: 'CACHE',
      encoding: 'utf8',
      recursive: true,
    });
    expect(result.calls[0].options.path).toContain('ledger-encrypted-backup-');
    expect(result.calls[1].options.files[0]).toContain('ledger-encrypted-backup-');
    expect(result.lastBackup).toBeTruthy();
  });

  test('failed native backup export does not mark the backup as saved', async ({ page }) => {
    await installCapacitorMocks(page, { failShare: true });
    await seedApp(page, {
      data: dataPayload({
        transactions: [{ id: 't1', type: 'income', amount: 500, description: 'Pay', category: 'salary', date: isoDaysFromToday(-1), note: '', createdAt: 1 }],
      }),
    });

    const result = await page.evaluate(async () => {
      localStorage.removeItem('ledger_last_encrypted_backup');
      await createEncryptedBackup(generateRecoveryKey());
      return {
        calls: window.__nativeExportCalls,
        lastBackup: localStorage.getItem('ledger_last_encrypted_backup'),
      };
    });

    expect(result.calls.map(c => `${c.plugin}.${c.method}`)).toEqual(['Filesystem.writeFile', 'Share.share']);
    expect(result.lastBackup).toBeNull();
  });

  test('CSV export uses the same native file/share path', async ({ page }) => {
    await installCapacitorMocks(page);
    await seedApp(page, {
      data: dataPayload({
        transactions: [{ id: 't1', type: 'expense', amount: 12.5, description: 'Coffee', category: 'food', date: isoDaysFromToday(-1), note: '', createdAt: 1 }],
      }),
    });

    const calls = await page.evaluate(async () => {
      await exportCSV();
      return window.__nativeExportCalls;
    });

    expect(calls.map(c => `${c.plugin}.${c.method}`)).toEqual(['Filesystem.writeFile', 'Share.share']);
    expect(calls[0].options.path).toContain('ledger-');
    expect(calls[0].options.path).toContain('.csv');
    expect(calls[0].options.data).toContain('Coffee');
  });
});
