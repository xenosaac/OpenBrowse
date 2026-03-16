export const EXTRACT_PAGE_MODEL_SCRIPT = `
(function() {
  const targetAttr = 'data-openbrowse-target-id';
  const actionableRoles = new Set([
    'button', 'link', 'textbox', 'checkbox', 'radio',
    'combobox', 'menuitem', 'tab', 'searchbox', 'slider',
    'switch', 'option', 'spinbutton', 'progressbar'
  ]);

  const actionableTags = new Set([
    'A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY', 'DETAILS'
  ]);

  function getRole(el) {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName;
    if (tag === 'A') return 'link';
    if (tag === 'BUTTON') return 'button';
    if (tag === 'INPUT') {
      const type = el.type || 'text';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'submit' || type === 'button') return 'button';
      return 'textbox';
    }
    if (tag === 'SELECT') return 'combobox';
    if (tag === 'TEXTAREA') return 'textbox';
    if (tag === 'SUMMARY') return 'button';
    if (tag === 'DETAILS') return 'group';
    if (el.getAttribute('contenteditable') === 'true') return 'textbox';
    return tag.toLowerCase();
  }

  function getLabel(el) {
    // 1. aria-label
    var label = el.getAttribute('aria-label');
    if (label) return label.slice(0, 80).trim();

    // 2. aria-labelledby
    var labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      var parts = labelledBy.split(/\\s+/).map(function(id) {
        var ref = document.getElementById(id);
        return ref ? ref.textContent || '' : '';
      }).filter(Boolean);
      if (parts.length > 0) return parts.join(' ').slice(0, 80).trim();
    }

    // 3. <label for="...">
    if (el.id) {
      var labelEl = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (labelEl) return (labelEl.textContent || '').slice(0, 80).trim();
    }

    // 4. title, placeholder
    label = el.getAttribute('title') || el.getAttribute('placeholder');
    if (label) return label.slice(0, 80).trim();

    // 5. innerText
    label = el.innerText;
    if (label) return label.slice(0, 80).trim();

    // 6. Nearest heading
    var heading = el.closest('section, article, fieldset, div');
    if (heading) {
      var h = heading.querySelector('h1, h2, h3, h4, h5, h6, legend');
      if (h) return (h.textContent || '').slice(0, 60).trim() + ' (section)';
    }

    return '';
  }

  function isVisible(el) {
    var style = window.getComputedStyle(el);
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && style.opacity !== '0'
      && el.offsetWidth > 0
      && el.offsetHeight > 0;
  }

  function isBoundingVisible(el) {
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0
      && rect.top < window.innerHeight && rect.bottom > 0
      && rect.left < window.innerWidth && rect.right > 0;
  }

  function getBoundingBox(el) {
    var rect = el.getBoundingClientRect();
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  }

  // --- Smart text compression: skip nav/header/footer/aside/script/style ---
  function extractVisibleText() {
    var SKIP_TAGS = new Set(['NAV', 'HEADER', 'FOOTER', 'ASIDE', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG']);
    var result = [];
    var charCount = 0;
    var MAX_CHARS = 4000;

    var walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function(node) {
          var parent = node.parentElement;
          while (parent && parent !== document.body) {
            if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
            parent = parent.parentElement;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    var node;
    while ((node = walker.nextNode()) && charCount < MAX_CHARS) {
      var text = (node.textContent || '').trim();
      if (text.length > 0) {
        // Collapse whitespace runs
        text = text.replace(/\\s+/g, ' ');
        result.push(text);
        charCount += text.length;
      }
    }
    return result.join(' ').slice(0, MAX_CHARS);
  }

  // --- Page type detection ---
  function detectPageType() {
    var url = document.location.href.toLowerCase();
    var hasPasswordField = !!document.querySelector('input[type=password]');
    var searchRole = !!document.querySelector('[role=search]');
    var searchInput = !!document.querySelector('input[type=search]');
    var formCount = document.querySelectorAll('form').length;

    // Login detection
    if (hasPasswordField) return 'login';

    // Checkout detection
    if (url.includes('checkout') || url.includes('payment') || url.includes('cart')) return 'checkout';
    if (document.querySelector('input[autocomplete=cc-number], input[name*=card]')) return 'checkout';

    // Search results detection
    if (searchRole || url.includes('/search') || url.includes('?q=') || url.includes('?query=')) return 'search_results';
    if (searchInput && document.querySelectorAll('[class*=result], [class*=Result], [data-result]').length > 2) return 'search_results';

    // Form-heavy page
    if (formCount >= 1 && document.querySelectorAll('input, select, textarea').length >= 3) return 'form';

    // Article detection
    if (document.querySelector('article') || document.querySelector('[role=article]')) return 'article';
    var mainContent = document.querySelector('main, [role=main]');
    if (mainContent) {
      var paragraphs = mainContent.querySelectorAll('p');
      if (paragraphs.length >= 3) return 'article';
    }

    return 'unknown';
  }

  // --- Forms extraction (enriched with field details) ---
  function extractForms() {
    var forms = document.querySelectorAll('form');
    var result = [];
    for (var i = 0; i < Math.min(forms.length, 5); i++) {
      var form = forms[i];
      var fields = [];
      var inputs = form.querySelectorAll('input, select, textarea');
      for (var fi = 0; fi < Math.min(inputs.length, 20); fi++) {
        var inp = inputs[fi];
        if (inp.type === 'hidden') continue;
        var fLabel = '';
        if (inp.id) {
          var lbl = document.querySelector('label[for="' + CSS.escape(inp.id) + '"]');
          if (lbl) fLabel = (lbl.textContent || '').trim().slice(0, 60);
        }
        if (!fLabel && inp.closest && inp.closest('label')) {
          fLabel = (inp.closest('label').textContent || '').trim().slice(0, 60);
        }
        if (!fLabel) {
          fLabel = inp.getAttribute('aria-label') || inp.getAttribute('placeholder') || inp.name || '';
        }
        var ref = inp.getAttribute(targetAttr) || '';
        var valMsg = inp.validationMessage || '';
        fields.push({
          ref: ref,
          label: fLabel.slice(0, 60),
          type: inp.type || inp.tagName.toLowerCase(),
          required: inp.required || inp.getAttribute('aria-required') === 'true',
          currentValue: inp.value || '',
          validationMessage: valMsg ? valMsg.slice(0, 120) : undefined
        });
      }
      var submitBtn = form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
      result.push({
        action: form.getAttribute('action') || '',
        method: (form.getAttribute('method') || 'get').toUpperCase(),
        fieldCount: inputs.length,
        fields: fields,
        submitRef: submitBtn ? (submitBtn.getAttribute(targetAttr) || '') : ''
      });
    }
    return result;
  }

  // --- Alerts extraction ---
  function extractAlerts() {
    var alertEls = document.querySelectorAll('[role=alert], [role=alertdialog], .error, .notification, .alert, .warning');
    var alerts = [];
    for (var i = 0; i < Math.min(alertEls.length, 5); i++) {
      var text = (alertEls[i].textContent || '').trim().slice(0, 200);
      if (text.length > 0) alerts.push(text);
    }
    return alerts;
  }

  // --- CAPTCHA detection ---
  function detectCaptcha() {
    // reCAPTCHA
    if (document.querySelector('iframe[src*="recaptcha"], iframe[title*="reCAPTCHA"], .g-recaptcha')) return true;
    // hCaptcha
    if (document.querySelector('iframe[src*="hcaptcha"], .h-captcha')) return true;
    // Cloudflare Turnstile
    if (document.querySelector('iframe[src*="challenges.cloudflare"], .cf-turnstile')) return true;
    // aria-label hints
    if (document.querySelector('[aria-label*="captcha" i], [aria-label*="CAPTCHA"]')) return true;
    return false;
  }

  // --- Active dialog detection ---
  function detectActiveDialog() {
    // 1. Native <dialog> with open attribute
    var dialog = document.querySelector('dialog[open]');
    if (dialog) {
      var label = dialog.getAttribute('aria-label')
        || dialog.getAttribute('aria-labelledby') && (function() {
          var ref = document.getElementById(dialog.getAttribute('aria-labelledby'));
          return ref ? (ref.textContent || '').trim() : '';
        })()
        || (dialog.querySelector('h1, h2, h3, h4, h5, h6') || {}).textContent
        || '';
      return { label: (label || '').trim().slice(0, 80) || 'Dialog' };
    }
    // 2. ARIA role="dialog" or role="alertdialog" that is visible
    var roleDialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
    for (var di = 0; di < roleDialogs.length; di++) {
      var rd = roleDialogs[di];
      if (isVisible(rd)) {
        var rdLabel = rd.getAttribute('aria-label')
          || rd.getAttribute('aria-labelledby') && (function() {
            var ref = document.getElementById(rd.getAttribute('aria-labelledby'));
            return ref ? (ref.textContent || '').trim() : '';
          })()
          || (rd.querySelector('h1, h2, h3, h4, h5, h6') || {}).textContent
          || '';
        return { label: (rdLabel || '').trim().slice(0, 80) || 'Dialog' };
      }
    }
    return undefined;
  }

  // --- Element enumeration ---
  var elements = [];
  var idCounter = 0;

  var allElements = document.querySelectorAll(
    'a, button, input, select, textarea, [role], [tabindex], [contenteditable], summary, details, [onclick]'
  );

  for (var j = 0; j < allElements.length; j++) {
    allElements[j].removeAttribute(targetAttr);
  }

  for (var k = 0; k < allElements.length; k++) {
    var el = allElements[k];
    if (!isVisible(el)) continue;
    var role = getRole(el);
    var isActionable = actionableRoles.has(role) || actionableTags.has(el.tagName)
      || el.hasAttribute('onclick') || el.hasAttribute('tabindex');
    var targetId = 'el_' + (idCounter++);

    el.setAttribute(targetAttr, targetId);

    var rect = el.getBoundingClientRect();
    var bv = rect.width > 0 && rect.height > 0
      && rect.top < window.innerHeight && rect.bottom > 0
      && rect.left < window.innerWidth && rect.right > 0;

    var elLabel = getLabel(el);
    var elInnerText = (el.innerText || '').trim().slice(0, 40);
    var elText = (elInnerText && elInnerText !== elLabel) ? elInnerText : undefined;

    elements.push({
      id: targetId,
      role: role,
      label: elLabel,
      text: elText,
      value: el.value || undefined,
      isActionable: isActionable,
      href: el.tagName === 'A' ? el.getAttribute('href') || undefined : undefined,
      inputType: el.tagName === 'INPUT' ? (el.type || 'text') : undefined,
      disabled: el.disabled || undefined,
      readonly: el.readOnly || undefined,
      checked: (el.type === 'checkbox' || el.type === 'radio') ? !!el.checked : (el.getAttribute('aria-checked') === 'true' ? true : undefined),
      selected: el.getAttribute('aria-selected') === 'true' ? true : undefined,
      expanded: el.getAttribute('aria-expanded') === 'true' ? true : (el.getAttribute('aria-expanded') === 'false' ? false : undefined),
      invalid: el.getAttribute('aria-invalid') === 'true' ? true : (el.validity && !el.validity.valid && el.validationMessage ? true : undefined),
      options: (function() {
        var opts;
        if (el.tagName === 'SELECT') {
          opts = el.querySelectorAll('option');
        } else if (el.tagName === 'INPUT' && el.getAttribute('list')) {
          var dl = document.getElementById(el.getAttribute('list'));
          if (dl && dl.tagName === 'DATALIST') {
            opts = dl.querySelectorAll('option');
          }
        }
        if (!opts) return undefined;
        var result = [];
        for (var oi = 0; oi < Math.min(opts.length, 20); oi++) {
          var opt = opts[oi];
          if (opt.disabled) continue;
          var val = opt.value || '';
          var lbl = (opt.textContent || '').trim().slice(0, 60);
          if (val || lbl) result.push({ value: val, label: lbl });
        }
        return result.length > 0 ? result : undefined;
      })(),
      boundingVisible: bv,
      boundingBox: { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) }
    });

    if (elements.length >= 300) break;
  }

  // Detect focused element among enumerated elements
  var focusedElementId = undefined;
  var active = document.activeElement;
  if (active && active !== document.body && active !== document.documentElement && active.closest) {
    var resolved = active.closest('[' + targetAttr + ']');
    focusedElementId = resolved ? resolved.getAttribute(targetAttr) || undefined : undefined;
  }

  return {
    url: document.location.href,
    title: document.title,
    summary: document.title + ' - ' + (document.querySelector('meta[name="description"]')?.getAttribute('content') || ''),
    focusedElementId: focusedElementId,
    elements: elements,
    visibleText: extractVisibleText(),
    pageType: detectPageType(),
    forms: extractForms(),
    alerts: extractAlerts(),
    captchaDetected: detectCaptcha(),
    scrollY: window.scrollY,
    activeDialog: detectActiveDialog()
  };
})()
`;
