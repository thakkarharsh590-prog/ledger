const { test, expect } = require('@playwright/test');
const { seedApp, dataPayload, isoDaysFromToday, installCapacitorMocks } = require('../helpers');

function alertData(overrides = {}) {
  return dataPayload({
    alertSettings: { enabled: false, permission: 'unknown', inAppOnly: true, lastScheduledAt: null, scheduledIds: [] },
    recurringExpenses: [
      { id: 'r1', name: 'Rent', amount: 900, category: 'home', cycle: 'monthly', nextDue: isoDaysFromToday(0), startDate: isoDaysFromToday(0), active: true, note: '', createdAt: 1 },
    ],
    transactions: [
      { id: 't1', type: 'expense', amount: 12, description: 'Music subscription', category: 'subs', date: isoDaysFromToday(-1), note: '', createdAt: 1 },
    ],
    ...overrides,
  });
}

test.describe('Pro forecast notifications', () => {
  test.skip(({ browserName }) => browserName === 'webkit', 'Native Android notification coverage targets the Chromium WebView runtime.');

  test('granted permission schedules inexact local notifications and stores ids', async ({ page }) => {
    await installCapacitorMocks(page, { notificationPermission: 'granted' });
    await seedApp(page, { data: alertData() });

    const result = await page.evaluate(async () => {
      billingState.isPro = true;
      state.alertSettings = { enabled: true, permission: 'granted', inAppOnly: false, lastScheduledAt: 1, scheduledIds: [7999] };
      await scheduleProAlerts();
      return { calls: window.__notificationCalls, settings: state.alertSettings };
    });

    expect(result.calls.map(c => c.method)).toContain('requestPermissions');
    expect(result.calls.map(c => c.method)).toContain('createChannel');
    expect(result.calls.map(c => c.method)).toContain('cancel');
    expect(result.calls.map(c => c.method)).toContain('schedule');
    const scheduleCall = result.calls.find(c => c.method === 'schedule');
    expect(scheduleCall.payload.notifications.length).toBeGreaterThan(0);
    expect(scheduleCall.payload.notifications[0]).toMatchObject({
      channelId: 'forecast_alerts',
      smallIcon: 'ic_stat_capahead',
    });
    expect(scheduleCall.payload.notifications[0].schedule.allowWhileIdle).toBe(false);
    expect(result.settings).toMatchObject({ enabled: true, permission: 'granted', inAppOnly: false });
    expect(result.settings.scheduledIds.length).toBe(scheduleCall.payload.notifications.length);
  });

  test('denied permission cancels stale ids and falls back to in-app state', async ({ page }) => {
    await installCapacitorMocks(page, { notificationPermission: 'denied' });
    await seedApp(page, { data: alertData() });

    const result = await page.evaluate(async () => {
      billingState.isPro = true;
      state.alertSettings = { enabled: true, permission: 'granted', inAppOnly: false, lastScheduledAt: 1, scheduledIds: [7000, 7001] };
      await scheduleProAlerts();
      return { calls: window.__notificationCalls, settings: state.alertSettings };
    });

    expect(result.calls.map(c => c.method)).toContain('cancel');
    expect(result.calls.map(c => c.method)).not.toContain('schedule');
    expect(result.settings).toMatchObject({ enabled: true, permission: 'denied', inAppOnly: true, scheduledIds: [] });
  });

  test('permission refresh detects Android Settings revoke', async ({ page }) => {
    await installCapacitorMocks(page, { notificationPermission: 'denied' });
    await seedApp(page, { data: alertData() });

    const result = await page.evaluate(async () => {
      billingState.isPro = true;
      state.alertSettings = { enabled: true, permission: 'granted', inAppOnly: false, lastScheduledAt: 1, scheduledIds: [7000] };
      await refreshProAlertPermissionAndSchedule({ reschedule: true });
      return { calls: window.__notificationCalls, settings: state.alertSettings };
    });

    expect(result.calls.map(c => c.method)).toContain('checkPermissions');
    expect(result.calls.map(c => c.method)).toContain('cancel');
    expect(result.settings).toMatchObject({ enabled: true, permission: 'denied', inAppOnly: true, scheduledIds: [] });
  });

  test('toggle off cancels scheduled notifications', async ({ page }) => {
    await installCapacitorMocks(page, { notificationPermission: 'granted' });
    await seedApp(page, { data: alertData() });

    const result = await page.evaluate(async () => {
      billingState.isPro = true;
      state.alertSettings = { enabled: true, permission: 'granted', inAppOnly: false, lastScheduledAt: 1, scheduledIds: [7000, 7001] };
      await toggleProAlerts();
      return { calls: window.__notificationCalls, settings: state.alertSettings };
    });

    expect(result.calls.map(c => c.method)).toContain('cancel');
    expect(result.settings).toMatchObject({ enabled: false, inAppOnly: true, scheduledIds: [] });
  });

  test('enabled alerts reschedule after material data save', async ({ page }) => {
    await installCapacitorMocks(page, { notificationPermission: 'granted' });
    await seedApp(page, { data: alertData() });

    const result = await page.evaluate(async () => {
      billingState.isPro = true;
      state.alertSettings = { enabled: true, permission: 'granted', inAppOnly: false, lastScheduledAt: 1, scheduledIds: [7000] };
      state.transactions.push({ id: 't2', type: 'expense', amount: 15, description: 'Video subscription', category: 'subs', date: todayISO(), note: '', createdAt: Date.now() });
      saveData();
      await new Promise(resolve => setTimeout(resolve, 1400));
      return { calls: window.__notificationCalls, data: JSON.parse(localStorage.getItem('ledger_data_v1')) };
    });

    expect(result.calls.map(c => c.method)).toContain('schedule');
    expect(result.data.alertSettings.permission).toBe('granted');
  });
});
