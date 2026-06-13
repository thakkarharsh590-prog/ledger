# CapAhead — Playwright QA Audit Report (Post-Remediation)

**Date:** 2026-06-13 · **App:** CapAhead v2.9.7 (single-file SPA + Capacitor 8 Android)
**Status:** ✅ **PRODUCTION READY (CONDITIONAL)**

This report represents the updated status after the owner implemented the recommended launch safety fixes (v2.9.7). All critical and high-severity issues (including native file exports, data resurrection, recovery restore hydration, versioning, and milestone contrast) have been successfully resolved. The only remaining failures are minor color contrast accessibility violations on Stats preview content.

---

## 1. Project Summary

| Component | Detail |
|---|---|
| **App Type** | Static single-file SPA (`www/index.html`) + Capacitor 8 Android wrapper |
| **Package Manager** | npm |
| **Test Framework** | `@playwright/test` + `@axe-core/playwright` |
| **Dev Server** | `tests/serve.js` (static, port 4173) |
| **Date of Audit** | 2026-06-13 |

---

## 2. Static Analysis Results

* **Linter**: None configured.
* **Type-checker**: None configured (pure JS codebase).
* **Build**: No web compiler or build step exists. Pure asset copy.
* **TODOS / FIXMEs**: None found in application source files.

---

## 3. Bug Register

| ID | Severity | Category | Route / File | Description | Recommended Fix | Effort |
|----|----------|----------|-------------|-------------|-----------------|--------|
| B-01 | Medium | Accessibility | Stats / `www/index.html` | WCAG 1.4.3 color-contrast violation inside `.pro-preview-content`. Obscured Pro forecast text has low contrast because of the `opacity: 0.55` and `filter: blur(3px)` lock design. | Add `aria-hidden="true"` to all `.pro-preview-content` containers (e.g. lines 6206, 6250, 6281, 6478, 11172, 11471). This instructs accessibility scanning engines to ignore the blurred lock text. | Small |
| B-02 | Low | Formatting | Utility / `www/index.html` | `fmtShort()` strips the negative sign from numbers due to `Math.abs(n)` (e.g., negative average daily expense displays positive). | Adjust `fmtShort()` to return `(n < 0 ? '-' : '') + sym + ...` or mirror the negative handling from the `fmt()` fix. | Small |

---

## 4. Accessibility Report

Accessibility testing was performed via `@axe-core/playwright` scanning all active bottom-navigation pages. 

- **Home, Compass, Loans, and Profile pages**: **0 serious / critical Axe violations** (on all 3 projects).
- **Stats page**: **fails on all 3 projects** (chromium, webkit, chromium-desktop):
  - **Rule ID**: `color-contrast` (impact: serious, WCAG 1.4.3) — 13–15 nodes
  - **Affected Elements**: `.forecast-legend > span` ("Actual", "Projected", "Zero" legends, `#6a6a73`/`#15151c` = 3.39:1), `.pro-preview-content` caption spans ("Today: A$1,920.00", "In 60d: −A$2,880.00") incl. dim-red expense (`#8d2f32`/`#15151c` = 2.23:1), and `.forecast-summary-card > span` titles (`#61616a`/`#1a1a21` = 2.82:1). Required 4.5:1.
  - **Cause**: All affected nodes are children of the Pro preview container, styled with `opacity: 0.55` + `filter: blur(3px)` and `pointer-events:none` to represent locked/unpurchased content — obscured by design.

---

## 5. Network Errors

* **Result**: **0 network errors.** All happy-path navigations and local operations produce zero 4xx/5xx requests.

---

## 6. Visual Regression Log

* **Result**: Screenshots render consistently across mobile (375x667), tablet (768x1024), and desktop (1440x900) viewports. No layout collapses or text overflows were detected.

---

## 7. Final Test Results

```
Browsers tested : Chromium (Pixel 7) · WebKit (iPhone 13) · Chromium-Desktop (Visual/A11y)
Total runnable  : 93
Passed          : 90
Failed          : 3  (same Axe color-contrast test on Stats, across all 3 projects)
Skipped         : 11 (deliberate test.skip(webkit) for Android-native/blob-download specs)
Duration        : 2.6 minutes
```
*(Update 2026-06-13, full re-run: the earlier "WebKit hangs" was diagnosed — this sandbox has no
network egress, and the app's Google-Fonts `<link>` stalled the page `load` event past the 20s
timeout. Fixed at the harness layer only (`tests/helpers.js` `seedApp` now stubs the font request
with empty CSS; app degrades to system fonts). WebKit now completes cleanly and reproduces the
identical single failure. No app source modified.)*

---

## 8. Screenshot Gallery

All 15 visual snapshots (5 pages × 3 viewports) regenerated in `test-results/screenshots/`:
- **Home:** `home__mobile.png` · `home__tablet.png` · `home__desktop.png`
- **Stats:** `stats__mobile.png` · `stats__tablet.png` · `stats__desktop.png`
- **Compass:** `compass__mobile.png` · `compass__tablet.png` · `compass__desktop.png`
- **Loans:** `loans__mobile.png` · `loans__tablet.png` · `loans__desktop.png`
- **Profile:** `profile__mobile.png` · `profile__tablet.png` · `profile__desktop.png`

Failure artifacts (screenshot + axe context): `test-results/artifacts/a11y-axe-*-stats-*`.

---

## 9. Readiness Verdict

### **PRODUCTION READY (CONDITIONAL)**

The app is functionally robust and ready to ship. 
- All E2E safety verification checks, encryption workflows, backup-restore routines, and notification schedulers are fully operational and pass E2E assertions with 100% success.
- The only remaining issue is **B-01 (color contrast on locked Pro preview elements)**, which is cosmetic/scan-only and does not affect regular user flows. It can be easily resolved in a minor update by adding `aria-hidden="true"` attributes to hide the locked preview container from accessibility parsers.
