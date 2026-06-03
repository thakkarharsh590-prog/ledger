const { chromium } = require('C:/Users/HP/AppData/Roaming/npm/node_modules/playwright/index.js');

const url = 'http://127.0.0.1:4173/www/index.html?v=2.8.5-a11y';
const results = [];

function pass(name) { results.push({ name, status: 'PASS' }); }
function fail(name, error) { results.push({ name, status: 'FAIL', error: error.message || String(error) }); }
async function check(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (error) {
    fail(name, error);
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  await context.addInitScript(() => {
    localStorage.setItem('tour_completed', 'skipped');
    localStorage.setItem('ledger_setup_status_v1', JSON.stringify({ status: 'skipped', at: Date.now(), version: 'qa' }));
    localStorage.setItem('ledger_install_dismissed', '1');
    localStorage.setItem('first_launch_warning_shown', 'yes');
    localStorage.removeItem('ledger_data_v1');
    localStorage.removeItem('ledger_ui_prefs_v1');
  });

  const page = await context.newPage();
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(err.message));

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);

  await check('Viewport allows user zoom', async () => {
    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
    if (!viewport.includes('width=device-width') || !viewport.includes('initial-scale=1.0')) throw new Error(viewport);
    if (viewport.includes('user-scalable') || viewport.includes('maximum-scale')) throw new Error(viewport);
  });

  await check('Toast uses an aria live status region', async () => {
    const toast = page.locator('#toast');
    if (await toast.getAttribute('role') !== 'status') throw new Error('missing status role');
    if (await toast.getAttribute('aria-live') !== 'polite') throw new Error('missing polite live region');
    if (await toast.getAttribute('aria-atomic') !== 'true') throw new Error('missing aria-atomic');
  });

  await check('Focus-visible ring is present on controls', async () => {
    await page.locator('#themeToggleBtn').focus();
    const style = await page.locator('#themeToggleBtn').evaluate(el => {
      const cs = getComputedStyle(el);
      return { outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, outlineColor: cs.outlineColor };
    });
    if (style.outlineStyle === 'none' || style.outlineWidth === '0px') throw new Error(JSON.stringify(style));
  });

  await check('Generated clickable controls are keyboard reachable', async () => {
    const hero = page.locator('.hero');
    if (await hero.getAttribute('role') !== 'button') throw new Error('hero role');
    if (await hero.getAttribute('tabindex') !== '0') throw new Error('hero tabindex');
    await page.locator('.nav-item').filter({ hasText: 'Profile' }).click();
    await page.waitForTimeout(300);
    const row = page.locator('.setting-row').first();
    if (await row.getAttribute('role') !== 'button') throw new Error('setting row role');
    if (await row.getAttribute('tabindex') !== '0') throw new Error('setting row tabindex');
  });

  await check('Nav exposes aria-current for active page', async () => {
    const profileCurrent = await page.locator('.nav-item[data-page="profile"]').getAttribute('aria-current');
    const homeCurrent = await page.locator('.nav-item[data-page="home"]').getAttribute('aria-current');
    if (profileCurrent !== 'page') throw new Error('profile not current');
    if (homeCurrent !== null) throw new Error('home still current');
  });

  await check('Form labels are programmatically associated', async () => {
    await page.evaluate(() => openAddModal('expense'));
    await page.waitForTimeout(150);
    const amountFor = await page.locator('#addModal label', { hasText: 'Amount' }).first().getAttribute('for');
    if (amountFor !== 'inpAmount') throw new Error('amount label for=' + amountFor);
  });

  await check('Modal has dialog semantics, focus, trap, and Escape close', async () => {
    const modal = page.locator('#addModal .modal');
    if (await modal.getAttribute('role') !== 'dialog') throw new Error('dialog role');
    if (await modal.getAttribute('aria-modal') !== 'true') throw new Error('aria-modal');
    if (await modal.getAttribute('aria-labelledby') !== 'addModalTitle') throw new Error('labelledby');
    const activeId = await page.evaluate(() => document.activeElement && document.activeElement.id);
    if (activeId !== 'inpAmount') throw new Error('expected focus on amount, got ' + activeId);
    await page.keyboard.press('Tab');
    await page.keyboard.down('Shift');
    await page.keyboard.press('Tab');
    await page.keyboard.up('Shift');
    const stillInside = await page.evaluate(() => !!document.querySelector('#addModal.open')?.contains(document.activeElement));
    if (!stillInside) throw new Error('focus escaped modal');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    if (await page.locator('#addModal').evaluate(el => el.classList.contains('open'))) throw new Error('modal still open');
  });

  await check('Reduced motion stylesheet is installed', async () => {
    const hasReducedMotion = await page.evaluate(() =>
      Array.from(document.querySelectorAll('style')).some(style =>
        style.textContent.includes('prefers-reduced-motion')
      )
    );
    if (!hasReducedMotion) throw new Error('missing prefers-reduced-motion media rule');
  });

  await browser.close();

  if (errors.length) fail('No browser console/page errors', new Error(errors.join('\n')));
  else pass('No browser console/page errors');

  const summary = {
    total: results.length,
    pass: results.filter(r => r.status === 'PASS').length,
    fail: results.filter(r => r.status === 'FAIL').length,
  };
  console.log(JSON.stringify({ summary, results }, null, 2));
  process.exit(summary.fail ? 1 : 0);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
