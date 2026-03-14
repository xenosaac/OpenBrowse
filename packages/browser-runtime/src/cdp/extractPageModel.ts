export const EXTRACT_PAGE_MODEL_SCRIPT = `
(function() {
  const targetAttr = 'data-openbrowse-target-id';
  const actionableRoles = new Set([
    'button', 'link', 'textbox', 'checkbox', 'radio',
    'combobox', 'menuitem', 'tab', 'searchbox', 'slider'
  ]);

  const actionableTags = new Set([
    'A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'
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
    return tag.toLowerCase();
  }

  function getLabel(el) {
    return el.getAttribute('aria-label')
      || el.getAttribute('title')
      || el.getAttribute('placeholder')
      || el.innerText?.slice(0, 80)?.trim()
      || '';
  }

  function isVisible(el) {
    const style = window.getComputedStyle(el);
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && style.opacity !== '0'
      && el.offsetWidth > 0
      && el.offsetHeight > 0;
  }

  const elements = [];
  let idCounter = 0;

  const allElements = document.querySelectorAll('a, button, input, select, textarea, [role]');

  for (const el of allElements) {
    el.removeAttribute(targetAttr);
  }

  for (const el of allElements) {
    if (!isVisible(el)) continue;
    const role = getRole(el);
    const isActionable = actionableRoles.has(role) || actionableTags.has(el.tagName);
    const targetId = 'el_' + (idCounter++);

    el.setAttribute(targetAttr, targetId);

    elements.push({
      id: targetId,
      role: role,
      label: getLabel(el),
      value: el.value || undefined,
      isActionable: isActionable
    });

    if (elements.length >= 200) break;
  }

  const bodyText = document.body?.innerText?.slice(0, 3000) || '';

  // Detect focused element among enumerated elements
  let focusedElementId = undefined;
  const active = document.activeElement;
  if (active && active !== document.body && active !== document.documentElement && active.closest) {
    const resolved = active.closest('[' + targetAttr + ']');
    focusedElementId = resolved ? resolved.getAttribute(targetAttr) || undefined : undefined;
  }

  return {
    url: document.location.href,
    title: document.title,
    summary: document.title + ' - ' + (document.querySelector('meta[name="description"]')?.getAttribute('content') || ''),
    focusedElementId: focusedElementId,
    elements: elements,
    visibleText: bodyText
  };
})()
`;
