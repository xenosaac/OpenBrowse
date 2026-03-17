/**
 * CDP script to auto-dismiss cookie consent banners.
 *
 * Strategy:
 * 1. Try direct selectors for well-known CMP (Consent Management Platform) accept buttons
 * 2. Find buttons with accept-like text inside cookie/consent container elements
 *
 * Returns { dismissed: boolean, method?: string, detail?: string }
 */
export const DISMISS_COOKIE_BANNER_SCRIPT = `
(function() {
  function isClickable(el) {
    if (!el) return false;
    var style = window.getComputedStyle(el);
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && style.opacity !== '0'
      && el.offsetWidth > 0
      && el.offsetHeight > 0;
  }

  // --- Strategy 1: Direct selectors for well-known CMP accept buttons ---
  var DIRECT_SELECTORS = [
    // OneTrust (used by many Fortune 500 sites)
    '#onetrust-accept-btn-handler',
    // CookieBot
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    '#CybotCookiebotDialogBodyButtonAccept',
    // Cookie Consent (Osano)
    '.cc-btn.cc-allow',
    '.cc-btn.cc-dismiss',
    // CookieFirst
    '[data-cookiefirst-action="accept"]',
    // Quantcast Choice
    '.qc-cmp2-summary-buttons button[mode="primary"]',
    // Didomi
    '#didomi-notice-agree-button',
    // TrustArc / TrustE
    '.truste-consent-button',
    // Termly
    '.t-acceptAllButton',
    // Generic well-known IDs/classes
    '#cookie-accept',
    '#accept-cookies',
    '#acceptAllCookies',
    '.cookie-accept-btn',
    '.accept-cookies-button',
    '#gdpr-cookie-accept',
    '.js-accept-cookies',
    '[data-testid="cookie-policy-dialog-accept-button"]',
    '[data-testid="accept-cookies"]',
  ];

  for (var i = 0; i < DIRECT_SELECTORS.length; i++) {
    try {
      var btn = document.querySelector(DIRECT_SELECTORS[i]);
      if (isClickable(btn)) {
        btn.click();
        return { dismissed: true, method: 'direct_selector', detail: DIRECT_SELECTORS[i] };
      }
    } catch(e) {}
  }

  // --- Strategy 2: Find buttons with accept-like text inside cookie containers ---
  var CONTAINER_SELECTORS = [
    '#CybotCookiebotDialog',
    '#onetrust-banner-sdk',
    '#onetrust-consent-sdk',
    '.cc-banner',
    '.cc-window',
    '#cookie-law-info-bar',
    '.cookie-consent',
    '#gdpr-consent',
    '.gdpr-banner',
    '#cookieNotice',
    '.js-cookie-consent',
    '#cookie-banner',
    '.cookie-banner',
    '#consent-banner',
    '.consent-banner',
    '[role="dialog"]',
    '[role="alertdialog"]',
    '[role="banner"]',
  ];

  var ACCEPT_PATTERN = /^(accept|agree|allow|ok|got it|i agree|accept all|allow all|accept cookies|allow cookies|i understand|continue|close|dismiss|acknowledge)$/i;

  for (var ci = 0; ci < CONTAINER_SELECTORS.length; ci++) {
    try {
      var containers = document.querySelectorAll(CONTAINER_SELECTORS[ci]);
      for (var cj = 0; cj < containers.length; cj++) {
        var container = containers[cj];
        if (!isClickable(container)) continue;

        // Check if this container actually relates to cookies/consent
        var containerText = (container.textContent || '').toLowerCase().slice(0, 500);
        var isCookieRelated = containerText.includes('cookie')
          || containerText.includes('consent')
          || containerText.includes('privacy')
          || containerText.includes('gdpr');

        // For generic dialog/banner roles, require cookie-related text
        if (CONTAINER_SELECTORS[ci].startsWith('[role=') && !isCookieRelated) continue;

        var buttons = container.querySelectorAll('button, a[role="button"], [role="button"], a.btn, input[type="button"], input[type="submit"]');
        for (var bi = 0; bi < buttons.length; bi++) {
          var btnText = (buttons[bi].textContent || '').trim();
          if (ACCEPT_PATTERN.test(btnText) && isClickable(buttons[bi])) {
            buttons[bi].click();
            return { dismissed: true, method: 'text_match', detail: btnText };
          }
        }
      }
    } catch(e) {}
  }

  return { dismissed: false };
})()
`;
