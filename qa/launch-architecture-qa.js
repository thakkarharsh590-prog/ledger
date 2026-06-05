const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const web = fs.readFileSync(path.join(root, 'www', 'index.html'), 'utf8');
const ownerPage = fs.readFileSync(path.join(root, 'harsh-iphone-pro-590', 'index.html'), 'utf8');
const manifest = fs.readFileSync(path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
const gradle = fs.readFileSync(path.join(root, 'android', 'app', 'build.gradle'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const checks = [];
function check(name, pass) {
  checks.push({ name, pass: !!pass });
}

const appVersion = (web.match(/const APP_VERSION = '([^']+)'/) || [])[1];
const androidVersion = (gradle.match(/versionName "([^"]+)"/) || [])[1];

check('APP_VERSION is 2.9.4', appVersion === '2.9.4');
check('package version matches APP_VERSION', pkg.version === appVersion);
check('Android versionName matches APP_VERSION', androidVersion === appVersion);
check('Android versionCode is 7', /versionCode 7\b/.test(gradle));
check('Android auto backup disabled', /android:allowBackup="false"/.test(manifest));

check('last-good storage key exists', web.includes("const LAST_GOOD_STORAGE_KEY = 'ledger_last_good_data_v1'"));
check('safe save validates before write', web.includes('validateAppDataShape(payload)'));
check('safe save verifies written data', web.includes('Saved data did not verify after write'));
check('safe save stores status', web.includes('LAST_SAVE_STATUS_KEY'));
check('load path validates saved data', web.includes('Saved app data is not a valid Ledger Compass payload'));

check('crash guard installs error handler', web.includes("window.addEventListener('error'"));
check('crash guard installs rejection handler', web.includes("window.addEventListener('unhandledrejection'"));
check('recovery overlay exists', web.includes('launchRecoveryOverlay'));
check('emergency export exists', web.includes('function exportEmergencyBackup()'));
check('last-good restore exists', web.includes('function restoreLastGoodData()'));

check('QA Pro simulation requires localhost', web.includes('function allowQaProSimulation()') && web.includes('isLocalQaHost()'));
check('GitHub/browser purchase fallback is not broad', !web.includes('if (!isNativeAndroidApp()) {\n      localStorage.setItem(PRO_DEV_UNLOCK_KEY'));
check('Profile dev toggle is local-QA only', web.includes('${allowQaProSimulation() ? `'));
check('owner PWA unlock key exists', web.includes("const OWNER_PWA_UNLOCK_KEY = 'ledger_owner_pwa_unlocked_v1'"));
check('owner PWA unlock is web-only', web.includes('if (isNativeAndroidApp()) return false;'));
check('private owner link sets only Pro flag', ownerPage.includes("localStorage.setItem('ledger_owner_pwa_unlocked_v1', 'yes')") && !ownerPage.includes('ledger_data_v1'));
check('private owner link returns to real app', ownerPage.includes("../www/index.html?owner=harsh"));
check('real app reads owner URL', web.includes('function applyOwnerPwaUnlockFromUrl()') && web.includes("params.get('owner') !== 'harsh'"));

const failed = checks.filter(c => !c.pass);
console.log(JSON.stringify({ pass: failed.length === 0, checks, failed }, null, 2));
process.exit(failed.length === 0 ? 0 : 1);
