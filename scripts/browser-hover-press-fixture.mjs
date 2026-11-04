/**
 * The fixture page for the browser host's `hover` and chord `press` proof.
 *
 * It lives in its own module because two rigs need the SAME page: the
 * measurement ladder (which raw-CDP mechanism reaches a hidden view at all) and
 * the end-to-end proof (does the SHIPPED `hover`/`press` reach it). A page that
 * differs between the two would make the ladder's verdict about a different
 * document from the one the shipped code is judged on.
 *
 * WHAT EACH PIECE PROVES, because a fixture is only evidence if its failure is
 * attributable:
 *  - `.row .menu-btn` is `display:none` until `.row:hover` - the "row action
 *    button revealed on hover" pattern (GitHub, Linear, Gmail). A CSS-only
 *    reveal: moving no pointer leaves it unreachable, so a missing :hover state
 *    is visible as the button having no layout box.
 *  - `.row` also listens for `mouseenter`/`mouseleave`/`pointerenter` and writes
 *    to `#tip` and `window.__events`: the JS-handler reveal pattern. It is a
 *    separate signal from the CSS one because the two have different mechanisms
 *    (style invalidation vs. event dispatch) and a mechanism may deliver one and
 *    not the other.
 *  - `#nav` opens a dropdown on `mouseenter` (a mouseenter-revealed menu).
 *  - `li#item` (tabindex=0, NOT editable) listens for keydown `e`: the
 *    "keyboard shortcut on a focused non-editable element" pattern.
 *  - `document` listens for Control+K / Meta+K and toggles `#palette`: the
 *    command-palette pattern. It calls preventDefault, so a key that arrives is
 *    also visibly consumed.
 *  - every keydown/keypress is appended to `window.__keys` with its modifier
 *    flags and `key`/`code`, so a chord that reached the page with the WRONG
 *    modifiers is a FAIL with the received value in hand, not a silent miss.
 */
export const HOVER_PRESS_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Hover and press fixture</title>
<style>
  body { font: 14px system-ui; margin: 0; padding: 16px; }
  #nav { display: inline-block; padding: 8px 12px; border: 1px solid #888; margin-bottom: 12px; }
  #nav-menu { display: none; position: absolute; background: #eef; border: 1px solid #66a; padding: 6px; }
  #nav.open #nav-menu { display: block; }
  ul#rows { list-style: none; padding: 0; width: 520px; }
  .row { display: flex; justify-content: space-between; align-items: center;
         padding: 10px; border: 1px solid #ccc; margin-bottom: 4px; background: #fff; }
  .row:hover { background: #ffd; }
  .row .menu-btn { display: none; padding: 4px 10px; }
  .row:hover .menu-btn { display: inline-block; }
  #tip { min-height: 20px; color: #060; }
  #item { padding: 10px; border: 1px solid #aaa; width: 300px; margin: 12px 0; }
  #item:focus { outline: 3px solid #36f; }
  #palette { display: none; border: 2px solid #c60; padding: 10px; width: 300px; }
  #palette.open { display: block; }
  #far-row { margin-top: 1400px; }
</style></head>
<body>
  <h1>Hover and press fixture</h1>
  <div id="nav" data-testid="nav">Products
    <div id="nav-menu"><a href="#a" id="nav-link">Pricing page</a></div>
  </div>
  <ul id="rows">
    <li class="row" id="row-1"><span>Row one</span><button class="menu-btn" id="menu-1">Row one actions</button></li>
    <li class="row" id="row-2"><span>Row two</span><button class="menu-btn" id="menu-2">Row two actions</button></li>
  </ul>
  <div id="tip"></div>
  <ul><li id="item" tabindex="0">Focusable item (press e to edit)</li></ul>
  <div id="editing" style="display:none">editing</div>
  <div id="palette">Command palette</div>
  <pre id="state">idle</pre>
  <div class="row" id="far-row"><span id="far">Far row (below the fold)</span><button class="menu-btn" id="menu-far">Far row actions</button></div>
<script>
  window.__events = [];
  window.__keys = [];
  const log = (s) => { window.__events.push(s); };
  for (const row of document.querySelectorAll('.row')) {
    row.addEventListener('mouseenter', () => { document.getElementById('tip').textContent = 'tip for ' + row.id; log('mouseenter:' + row.id); });
    row.addEventListener('mouseleave', () => { document.getElementById('tip').textContent = ''; log('mouseleave:' + row.id); });
    row.addEventListener('pointerenter', () => log('pointerenter:' + row.id));
    row.addEventListener('mousemove', () => log('mousemove:' + row.id));
  }
  const nav = document.getElementById('nav');
  nav.addEventListener('mouseenter', () => { nav.classList.add('open'); log('mouseenter:nav'); });
  nav.addEventListener('mouseleave', () => { nav.classList.remove('open'); log('mouseleave:nav'); });
  const item = document.getElementById('item');
  item.addEventListener('keydown', (e) => {
    if (e.key === 'e' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      document.getElementById('editing').style.display = 'block';
    }
  });
  document.addEventListener('keydown', (e) => {
    window.__keys.push('down:' + [e.key, e.code, e.ctrlKey ? 'C' : '-', e.metaKey ? 'M' : '-', e.shiftKey ? 'S' : '-', e.altKey ? 'A' : '-'].join('|'));
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      document.getElementById('palette').classList.toggle('open');
    }
  });
  document.addEventListener('keypress', (e) => { window.__keys.push('press:' + e.key); });
  window.__reading = () => JSON.stringify({
    hoverRow1: document.getElementById('row-1').matches(':hover'),
    menu1Display: getComputedStyle(document.getElementById('menu-1')).display,
    menu1Box: !!document.getElementById('menu-1').getClientRects().length,
    tip: document.getElementById('tip').textContent,
    navOpen: nav.classList.contains('open'),
    navMenuDisplay: getComputedStyle(document.getElementById('nav-menu')).display,
    events: window.__events.slice(),
    keys: window.__keys.slice(),
    editing: document.getElementById('editing').style.display === 'block',
    palette: document.getElementById('palette').classList.contains('open'),
    active: document.activeElement && document.activeElement.id,
    scrollY: Math.round(window.scrollY),
  });
</script></body></html>`;
