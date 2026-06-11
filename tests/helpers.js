// Shared helpers for CapAhead Playwright suite.
// The app is a single-file SPA with several first-run interferers (setup wizard,
// welcome tour, first-launch alert, cache-bust redirect, install banner).
// seedApp() neutralises them deterministically via localStorage before load.

const APP_URL = '/www/index.html?v=qa'; // ?v= skips autoCacheBust() redirect

/** Base flags that make the app boot straight to Home with no overlays. */
function baseFlags() {
  return {
    ledger_setup_status_v1: JSON.stringify({ status: 'completed', at: Date.now(), version: 'qa' }),
    tour_completed: 'yes',
    first_launch_warning_shown: 'yes',
    ledger_install_dismissed: '1',
    recovery_dismissed: 'yes',
    ledger_last_bust: String(Date.now()),
    theme_preference: 'dark',
  };
}

/** Minimal valid schema-v10 data payload; override any field. */
function dataPayload(overrides = {}) {
  return {
    schemaVersion: 10,
    transactions: [],
    budgets: {},
    loans: [],
    customCategories: { income: [], expense: [] },
    incomeSources: [],
    decisions: [],
    recurringExpenses: [],
    savings: [],
    savingsGoals: [],
    earnedMilestones: {},
    monthlySnapshots: [],
    alertSettings: { enabled: false, permission: 'unknown', inAppOnly: true, lastScheduledAt: null },
    currency: 'AUD',
    userName: '',
    lastSaved: Date.now(),
    ...overrides,
  };
}

function isoDaysFromToday(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Navigate to the app with seeded localStorage.
 * opts.data    – object stored at ledger_data_v1 (omit for empty install)
 * opts.flags   – extra/override localStorage keys
 * opts.firstRun – if true, do NOT set the base flags (test first-run UX)
 * Returns { consoleErrors, failedRequests } collectors.
 */
async function seedApp(page, opts = {}) {
  const consoleErrors = [];
  const failedRequests = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('response', res => {
    const url = res.url();
    if (res.status() >= 400 && !url.includes('favicon') && !url.includes('fonts.g')) {
      failedRequests.push(`${res.status()} ${url}`);
    }
  });

  const flags = opts.firstRun ? {} : baseFlags();
  const storage = { ...flags, ...(opts.flags || {}) };
  if (opts.data) storage.ledger_data_v1 = JSON.stringify(opts.data);

  // Seed exactly once per context: a reload must observe what the app wrote,
  // not have the seed re-applied over it (e.g. dismissal flags, cleared data).
  await page.addInitScript(entries => {
    if (localStorage.getItem('__qa_seeded')) return;
    for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
    localStorage.setItem('__qa_seeded', '1');
  }, storage);

  await page.goto(APP_URL);
  await page.waitForSelector('.bottom-nav');
  return { consoleErrors, failedRequests };
}

/** Read parsed app data back out of localStorage. */
async function readAppData(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('ledger_data_v1') || 'null'));
}

/** Navigate via bottom nav. */
async function goPage(page, name) {
  await page.evaluate(n => window.goPage(n), name);
  await page.waitForSelector(`#page-${name}.active`);
}

module.exports = { APP_URL, baseFlags, dataPayload, isoDaysFromToday, seedApp, readAppData, goPage };
