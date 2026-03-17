/**
 * Inject and remove element annotation overlays for planner screenshots.
 *
 * The overlay draws small numbered badges (`el_N`) at the top-left corner of
 * each interactive element that has a `data-openbrowse-target-id` attribute.
 * This lets the planner correlate visual positions in screenshots with the
 * element IDs it can act on.
 *
 * Cap: first 50 annotated elements to avoid visual clutter.
 */

export const INJECT_ANNOTATION_OVERLAY_SCRIPT = `
(function() {
  var ATTR = 'data-openbrowse-target-id';
  var MAX = 50;
  var CONTAINER_ID = '__openbrowse_annotation_overlay__';

  // Remove any previous overlay (idempotent)
  var prev = document.getElementById(CONTAINER_ID);
  if (prev) prev.remove();

  var container = document.createElement('div');
  container.id = CONTAINER_ID;
  container.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;';

  var els = document.querySelectorAll('[' + ATTR + ']');
  var count = 0;

  for (var i = 0; i < els.length && count < MAX; i++) {
    var el = els[i];
    var tid = el.getAttribute(ATTR);
    if (!tid) continue;

    var rect = el.getBoundingClientRect();
    // Skip elements outside viewport or zero-size
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
    if (rect.right < 0 || rect.left > window.innerWidth) continue;

    var badge = document.createElement('div');
    badge.style.cssText = 'position:fixed;padding:1px 3px;font:bold 9px/11px monospace;color:#fff;background:rgba(220,38,38,0.85);border-radius:3px;white-space:nowrap;pointer-events:none;';
    badge.style.left = Math.max(0, Math.round(rect.left)) + 'px';
    badge.style.top = Math.max(0, Math.round(rect.top)) + 'px';
    badge.textContent = tid;

    container.appendChild(badge);
    count++;
  }

  document.documentElement.appendChild(container);
  return { injected: count };
})()
`;

export const REMOVE_ANNOTATION_OVERLAY_SCRIPT = `
(function() {
  var el = document.getElementById('__openbrowse_annotation_overlay__');
  if (el) { el.remove(); return { removed: true }; }
  return { removed: false };
})()
`;
