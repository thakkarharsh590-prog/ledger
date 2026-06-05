const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

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
      res.writeHead(200, {
        'content-type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream',
      });
      res.end(data);
    });
  });

  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function swipe(client, x, y1, y2) {
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y: y1, radiusX: 4, radiusY: 4 }],
  });
  for (let i = 1; i <= 8; i += 1) {
    const y = y1 + ((y2 - y1) * i) / 8;
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y, radiusX: 4, radiusY: 4 }],
    });
    await new Promise(resolve => setTimeout(resolve, 16));
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

(async () => {
  const { server, port } = await serveWorkspace();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto(`http://127.0.0.1:${port}/www/index.html?v=mobile-scroll-qa`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(1000);
  const client = await context.newCDPSession(page);

  await page.evaluate(() => {
    localStorage.setItem('tour_completed', 'skipped');
    localStorage.setItem('ledger_setup_status_v1', JSON.stringify({ status: 'skipped', at: Date.now(), version: 'qa' }));
    document.body.insertAdjacentHTML('beforeend', '<div id="scrollProbe" style="height:1800px"></div>');
    window.scrollTo(0, 0);
  });
  await swipe(client, 195, 650, 250);
  await page.waitForTimeout(300);
  const bodyScroll = await page.evaluate(() => window.scrollY);

  await page.evaluate(() => {
    window.scrollTo(0, 0);
    SetupWizardController.open({ manual: true });
    document.getElementById('setupContent').insertAdjacentHTML('beforeend', '<div id="setupScrollProbe" style="height:1400px"></div>');
    document.getElementById('setupWizard').scrollTop = 0;
  });
  await page.waitForTimeout(200);
  await swipe(client, 195, 650, 250);
  await page.waitForTimeout(300);
  const setupScroll = await page.evaluate(() => document.getElementById('setupWizard').scrollTop);

  await browser.close();
  server.close();

  const pass = bodyScroll > 20 && setupScroll > 20 && errors.length === 0;
  console.log(JSON.stringify({ pass, bodyScroll, setupScroll, errors }, null, 2));
  process.exit(pass ? 0 : 1);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
