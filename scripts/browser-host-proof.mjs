#!/usr/bin/env node
/**
 * End-to-end proof for the browser host.
 *
 * Why this exists: the desktop suite's browser tests exercise the RULES with fake
 * views (no page is ever loaded), and the PR's claim is about a real Chromium
 * surface driven over a real loopback RPC by the code that ships. This harness is
 * the run that can falsify that claim — it boots the BUILT app headless, talks to
 * its real `/rpc`, drives a real page, and prints what came back.
 *
 * It is committed rather than pasted into a PR because a transcript that cannot be
 * re-run is a claim, not evidence.
 *
 * Isolation (non-negotiable, and why each piece is here):
 *   - `HOME` AND `LOCAL_OPERATOR_CONFIG_DIR` are both redirected: the config dir
 *     alone leaves the cache and hardcoded home roots in the real home, and this
 *     repo has already written 612 rows into the operator's live analytics database
 *     from a "sandboxed" run.
 *   - `LOCAL_OPERATOR_LOG_DIR` is redirected as well, and it is the one path the
 *     scratch HOME cannot move: the app's logger takes its default from Electron's
 *     `home` — the OS ACCOUNT's home on macOS and Linux, which the `HOME` variable
 *     does not change — so a run missing this override appends to the operator's
 *     own log files. Measured on this machine: QA app launches whose scratch trees
 *     were under `/private/tmp` wrote `Log path: …/Library/Application Support/Local
 *     Operator/logs` into his `backend-installer.log`, which interleaved rig lines
 *     with his app's and made a night's window-raise investigation unattributable.
 *   - the Electron profile root is a scratch `--user-data-dir`, so the run cannot
 *     see or touch the operator's real Local Operator profile — and cannot leak its
 *     own state into it either.
 *   - `--window-mode=headless` and every `CMUX_*`/`LOP_*` variable removed: the app
 *     must never take the operator's focus, and an inherited cmux workspace id has
 *     already renamed his real workspaces once.
 *
 * Usage: node scripts/browser-host-proof.mjs [--keep]
 */

import { execFile, spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { connect } from "node:net";
import { networkInterfaces } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
// The REAL Electron binary, not `node_modules/.bin/electron`. That path is a
// shell -> `node cli.js` -> Electron chain, so the pid a harness holds is the
// SHIM's: signalling it stops the shim and leaves the app running while the
// harness reports it stopped (QA round 1, Q1 — one leaked main in QA's run and
// five in their own harness). Imported from `electron` in plain Node it resolves
// to the binary itself, so the pid we hold is the app's.
import electronPath from "electron";
import { withNotificationsOff } from "./notifications-off.mjs";
import { withTelemetryOff } from "./telemetry-off.mjs";

const ROOT = process.cwd();
const SCRATCH = join(tmpdir(), `lo-browser-proof-${process.pid}`);
const HOME_DIR = join(SCRATCH, "home");
const CONFIG_DIR = join(SCRATCH, "config");
const USER_DATA = join(SCRATCH, "userdata");
const OUT_DIR = join(SCRATCH, "out");
/**
 * The app's own log files for this run, through the app's `LOCAL_OPERATOR_LOG_DIR`
 * override. Set because the default cannot be redirected from outside: see the
 * isolation note in the header, and `src/main/backend/log-dir.ts` for the
 * measurement.
 */
const LOG_DIR = join(SCRATCH, "logs");
/**
 * The renderer debugging port, chosen FRESH FOR EACH LAUNCH.
 *
 * Randomised rather than fixed: a fixed port is how an earlier failed run's
 * leftover app answered this run's CDP calls, which looked exactly like "the IPC
 * handler is missing" — the wrongest possible reading of a stale process. And
 * chosen per launch rather than once per run, because this harness launches the
 * app twice: reusing one number meant the second launch raced the first app's
 * teardown for it, Chromium reported `bind() failed: Address already in use (48)`
 * / `Cannot start http server for devtools`, and the harness's next CDP call went
 * to the dying app's socket and died with "other side closed". Measured, not
 * inferred: the app log carries both lines, and the run before this change
 * failed there with 36 checks already green.
 */
let DEVTOOLS_PORT = 0;

function pickDevtoolsPort() {
	return 9200 + Math.floor(Math.random() * 600);
}

/** Wait until nothing is listening on `port`, then return it. Bounded: a port
 * held by a process this run cannot see is a reason to pick another number, not
 * to hang. */
async function freeDevtoolsPort(timeoutMs = 10_000) {
	const started = Date.now();
	for (;;) {
		const port = pickDevtoolsPort();
		try {
			const response = await fetch(`http://127.0.0.1:${port}/json/version`);
			if (!response.ok) return port;
		} catch (error) {
			if (error instanceof TypeError) return port; // nothing listening: what we want
			throw error;
		}
		if (Date.now() - started > timeoutMs) {
			throw new Error(
				`no free devtools port: three random draws in ${timeoutMs}ms were all in use`,
			);
		}
	}
}

const transcript = [];
let failures = 0;
/** Checks this host could not make at all — the frontmost sampler is the one that
 * skips on a loaded machine. Declared here rather than at its first use because the
 * reference at that site had no declaration: the branch that increments it threw
 * `ReferenceError: skips is not defined`, which killed the run while it wrote its
 * summary and took every reading the run had already made with it (measured on this
 * host, 2026-10-02 — the `osascript` sampler never answered a sample, the skip
 * branch fired, and the run died after its last check had passed). */
let skips = 0;

function record(label, body) {
	transcript.push(`### ${label}\n\n\`\`\`\n${body}\n\`\`\`\n`);
}

function say(line) {
	console.log(line);
}

function check(label, ok, detail) {
	const status = ok ? "PASS" : "FAIL";
	if (!ok) failures += 1;
	say(
		`[${status}] ${label}${detail === undefined ? "" : `\n        ${detail}`}`,
	);
	record(label, `[${status}] ${detail === undefined ? "" : detail}`);
	return ok;
}

// ---- the local site the proof drives ---------------------------------------

/**
 * The page, deliberately small and hostile-free, but exercising exactly the
 * surfaces the capability matrix assigns to this host: a clickable control, a
 * text field, a long enough body to scroll, console output at three levels, an
 * uncaught exception, a permission request, a popup dance (open, opener check,
 * postMessage both ways, cookie share, grandchild refusal, self-close), a
 * same-origin link
 * so a click can be seen to navigate, and a probe written by the PAGE's own
 * script reporting which globals its world actually has (the isolation claim,
 * measured rather than read off the view's creation options).
 */
const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Browser host proof page</title>
<style>body{font:14px system-ui;margin:0;padding:24px}#tall{height:1600px;background:linear-gradient(#eef,#fff)}</style>
</head><body>
<h1>Browser host proof page</h1>
<p id="lede">A page for the local-operator browser host evidence run.</p>
<label for="name">Name</label>
<input id="name" type="text" />
<button id="go" type="button">Go</button>
<button id="nav" type="button">Next page</button>
<button id="popup-open" type="button">Popup dance</button>
<button id="popup-hold" type="button">Hold a popup</button>
<button id="popup-blank" type="button">Blank-first popup</button>
<button id="popup-denied" type="button">Denied scheme</button>
<button id="popup-cap" type="button">Fill the cap</button>
<button id="popup-cleanup" type="button">Cleanup popup</button>
<p id="result"></p>
<p id="geo">geolocation: not asked</p>
<p id="popup">popup: not asked</p>
<p id="isolation">isolation: unmeasured</p>
<div id="tall"></div>
<script>
  console.log("proof: log line");
  console.warn("proof: warning line");
  console.error("proof: error line");
  document.getElementById("go").addEventListener("click", () => {
    const value = document.getElementById("name").value;
    document.getElementById("result").textContent = "clicked with " + value;
    console.log("proof: clicked with [" + value + "]");
  });
  document.getElementById("nav").addEventListener("click", () => {
    window.location.href = "/page2";
  });
  // The isolation probe, run by the PAGE script in the PAGE's own world.
  // No backticks in this comment: it lives inside a template literal.
  // This is the measurement the PR body previously did not have: the view is
  // created with no preload and sandbox: true, so nothing named api may exist
  // here even if a future refactor adds an IPC channel, and a probe run from the
  // host's side (the isolated world, or a code read) cannot show it.
  document.getElementById("isolation").textContent =
    "isolation: api=" + (typeof window.api) +
    " require=" + (typeof require) +
    " process=" + (typeof process) +
    " electron=" + (typeof window.electron);
  try { navigator.geolocation.getCurrentPosition(
    () => { document.getElementById("geo").textContent = "geolocation: GRANTED"; },
    (error) => { document.getElementById("geo").textContent = "geolocation: denied (" + error.code + ")"; });
  } catch (error) {
    document.getElementById("geo").textContent = "geolocation: threw " + error;
  }
  // The popup dance (docs/design/browser-oauth-popups.md 5.1.3). The controls
  // are clicked by the harness with real input events, so window.open runs with
  // the user activation a person's click carries; each event is recorded into
  // #popup as it arrives, and the popup reports through postMessage.
  // No backticks in this comment: it lives inside a template literal.
  const popupLog = [];
  const recordPopup = (entry) => {
    popupLog.push(entry);
    document.getElementById("popup").textContent = "popup: " + popupLog.join(" / ");
  };
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.kind !== "popup-ready") return;
    recordPopup("opener=" + (data.hasOpener ? "yes" : "no"));
    recordPopup("selfCookie=" + (data.selfCookie ? "yes" : "no"));
    recordPopup("sharedJar=" + (document.cookie.includes("proof_popup") ? "yes" : "no"));
    recordPopup("grandchild=" + (data.grandchildDenied ? "denied" : "opened"));
    event.source.postMessage({ kind: "opener-ack" }, "*");
    recordPopup("ack=sent");
    recordPopup("opener-at=" + location.pathname);
  });
  document.getElementById("popup-open").addEventListener("click", () => {
    const popup = window.open("/popup-target", "proofpopup");
    recordPopup(popup ? "opened" : "blocked-by-host");
    if (!popup) return;
    const poll = setInterval(() => {
      if (popup.closed) {
        clearInterval(poll);
        recordPopup("closed=yes");
      }
    }, 50);
  });
  document.getElementById("popup-hold").addEventListener("click", () => {
    const popup = window.open("/popup-target?hold=1&which=direct", "holdpopup");
    recordPopup("hold=" + (popup ? "opened" : "blocked-by-host"));
  });
  document.getElementById("popup-blank").addEventListener("click", () => {
    // MSAL's shape: the window is opened EMPTY first and navigated after — the
    // case whose options Electron copies from the opener instead of taking ours.
    const popup = window.open("", "blankpopup");
    recordPopup("blank=" + (popup ? "opened" : "blocked-by-host"));
    if (popup) popup.location.href = "/popup-target?hold=1&which=blank";
  });
  document.getElementById("popup-denied").addEventListener("click", () => {
    let outcome;
    try {
      outcome = window.open("mailto:proof@example.com", "deniedpopup") ? "opened" : "refused";
    } catch (error) {
      outcome = "threw:" + error;
    }
    recordPopup("mailto=" + outcome);
  });
  document.getElementById("popup-cap").addEventListener("click", () => {
    // Three candidates with two children already live: the boundary is the 4th
    // live child, so this records opened / opened / refused when the cap is 4.
    const results = [];
    for (let index = 0; index < 3; index += 1) {
      const popup = window.open("/popup-target?hold=1&which=cap" + index, "cappopup" + index);
      results.push(index + ":" + (popup ? "opened" : "refused"));
    }
    recordPopup("cap=" + results.join(","));
  });
  document.getElementById("popup-cleanup").addEventListener("click", () => {
    const popup = window.open("/popup-target?hold=1&which=cleanup", "cleanuppopup");
    recordPopup("cleanup=" + (popup ? "opened" : "blocked-by-host"));
  });
  setTimeout(() => { throw new Error("proof: uncaught exception"); }, 0);
</script>
</body></html>`;

const PAGE2 = `<!doctype html><html><head><meta charset="utf-8"><title>Proof page two</title></head>
<body><h1>Second page</h1><p id="second">This is the second proof page.</p></body></html>`;

/**
 * The popup target (docs/design/browser-oauth-popups.md 5.1.3).
 *
 * Two shapes, chosen by the query string:
 *
 * - no `hold` — the DANCE. It asserts its own opener relation into its status
 *   line, writes a cookie and re-reads it in its own document, tries a
 *   grandchild (which the child's own deny-all handler must refuse), reports all
 *   of it to the opener over postMessage, closes itself once the opener's ack
 *   arrives, and is recorded by the opener as `closed=yes`.
 * - `hold=1` — a popup that only exists: it sits there so the harness can hold a
 *   live child, fill the cap and capture the frame over CDP. Its status line
 *   still carries the two cross-window readings (opener, shared cookie), which
 *   is what a held popup is FOR here.
 *
 * Both shapes report `cookies=` from THIS document, so a popup opened after the
 * dance proves the jar is shared in the child-to-parent direction the same way
 * the dance proves it in parent-to-child.
 */
const POPUP_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Popup proof target</title></head>
<body><h1>Popup target</h1><p id="popup-status">popup: starting</p>
<script>
  const params = new URLSearchParams(location.search);
  const status = document.getElementById("popup-status");
  status.textContent = "popup: opener=" + (window.opener ? "present" : "null") +
    " cookies=" + (document.cookie.includes("proof_popup") ? "shared" : "none");
  if (params.has("hold")) {
    status.textContent += " held";
  } else {
    document.cookie = "proof_popup=shared; Path=/";
    const selfCookie = document.cookie.includes("proof_popup");
    let grandchildDenied = false;
    try {
      grandchildDenied = window.open("/popup-target?which=grandchild", "proof-grandchild") === null;
    } catch (error) {
      grandchildDenied = true;
    }
    window.addEventListener("message", (event) => {
      if (event.data && event.data.kind === "opener-ack") {
        status.textContent += " acked";
        window.close();
      }
    });
    if (window.opener) {
      window.opener.postMessage({
        kind: "popup-ready",
        hasOpener: window.opener !== null,
        selfCookie: selfCookie,
        grandchildDenied: grandchildDenied,
      }, "*");
      status.textContent += " reported";
    } else {
      status.textContent += " NO-OPENER";
    }
  }
</script></body></html>`;

/**
 * The geometry fixture: the shape the structured reads (`styles`, `hit_test`,
 * `ancestors`) exist for, plus the bounds probe.
 *
 * The popper is the Radix popup's, because that is the case a text read cannot
 * answer: a fixed-positioned floating wrapper inside the app's root container,
 * offset by a transform, under a global `div` reset that makes every div
 * `position: relative` and border-boxed. Its bounding rect only exists if the
 * fixed positioning AND the transform are both applied; its computed `left`/
 * `top` are the pre-transform values (the disagreement is the point); the
 * placement data the popper library writes travels as inline `--*` custom
 * properties, which no computed-style key reports; and the listbox sheet sits
 * in a stack only `elementsFromPoint` can enumerate.
 *
 * The deep stack at the end exists for the BOUNDS halves of the contract:
 * twenty nested divs put more than eight elements under one point and more
 * than sixteen ancestors above one element, so numbers beyond the caps are a
 * failure of the cap rather than of the arithmetic.
 *
 * No backticks in this comment or its markup: it lives inside a template
 * literal.
 */
const GEOMETRY_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Geometry proof page</title>
<style>
  /* The reset the reads must be interpreted THROUGH: every div relative,
     border-box. The popover is the one element that overrides it. */
  div { position: relative; box-sizing: border-box; }
  body { font: 14px system-ui; margin: 0; padding: 24px; }
  #minerva-app-root { width: 900px; }
  #radix-popover {
    position: fixed; top: 120px; left: 300px;
    transform: translate(10px, 20px);
    width: 240px; padding: 8px; border: 1px solid #888;
    background: #fff; z-index: 50;
  }
  #radix-listbox { outline: none; }
  [role="option"] { padding: 4px 8px; }
  #deep-stack-holder { width: 200px; height: 140px; }
</style>
</head><body>
<div id="minerva-app-root">
  <h1>Geometry proof page</h1>
  <div id="radix-popover"
       style="--radix-popper-available-width: 640px; --radix-popper-transform-origin: 20px 30px">
    <div role="listbox" id="radix-listbox" aria-label="Options">
      <div role="option" id="option-a">Alpha</div>
      <div role="option" id="option-b">Beta</div>
      <div role="option" id="option-c">Gamma</div>
    </div>
  </div>
  <div id="deep-stack-holder"></div>
</div>
<script>
  // Twenty nested absolutely positioned divs, built by the page so the markup
  // stays readable. Each child shifts one pixel relative to its parent, so the
  // innermost center has all twenty under one point and all twenty above one
  // element.
  var parent = document.getElementById("deep-stack-holder");
  for (var index = 1; index <= 20; index += 1) {
    var div = document.createElement("div");
    div.id = "stack-" + index;
    div.style.position = "absolute";
    div.style.top = "1px";
    div.style.left = "1px";
    div.style.width = "120px";
    div.style.height = "60px";
    parent.appendChild(div);
    parent = div;
  }
</script>
</body></html>`;

/**
 * The hidden-view fixture: the two properties a DRIVEN (never-presented) tab's page
 * must keep, both reported by the page itself.
 *
 * WHY this exists beside the geometry page: the geometry fixture proves what a read
 * can SEE, and says nothing about the two failures an agent cannot see without
 * geometry reads — a renderer viewport of 0x0, and a capture that moves the page.
 * Measured 2026-10-01 against a real site (the alert-suppression page's Radix
 * selects): an unpresented view reported `innerWidth === 0`, which collapses any
 * popper that measures itself against the viewport (Radix's select content is
 * clamped by `--radix-select-content-available-height`, so it reached
 * `max-height: 0`), and every capture of that view RESIZED the renderer to the
 * clip box and fired a page `resize` — which closes `radix-ui/react-select`
 * popups outright, so an agent's own screenshot dismissed the popup it was about
 * to read.
 *
 * The three shapes here are therefore load-bearing rather than decoration:
 *  - `#metrics` prints the live viewport, so 0x0 is READABLE;
 *  - `#open` inserts the Radix-popper shape (fixed + translate3d +
 *    min-width:max-content) with its content clamped the way Radix clamps it, so
 *    a 0x0 viewport collapses it exactly as the real select collapses;
 *  - a `resize` listener closes that popup, mirroring SelectContentImpl, so "the
 *    capture resized the renderer" is observable as a CLOSED popup rather than as
 *    a metric nobody reads;
 *  - `#sentinel` is a 120x40 magenta block inside the popup, so the frame's pixels
 *    can be asserted rather than described.
 *
 * No backticks in this comment or its markup: it lives inside a template literal.
 */
const HIDDEN_VIEWPORT_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Hidden viewport proof page</title>
<style>
  body { font: 14px system-ui; margin: 0; padding: 20px; background: #14171c; color: #e6e8eb; }
  button { font: inherit; padding: 8px 12px; border-radius: 8px; border: 1px solid #3a3f47;
    background: #23272e; color: #e6e8eb; cursor: pointer; }
  .row { display: flex; gap: 12px; }
  #popper { position: fixed; left: 0; top: 0; transform: translate3d(120px, 160px, 0);
    min-width: max-content; will-change: transform; z-index: 1300; }
  /* Radix's available-height binding. The 0 default is the failure shape: on a 0x0
     viewport the content collapses to nothing and the sentinel never paints. */
  #popper-content { min-width: 240px; max-height: var(--viewport-available-height, 0px);
    /* The border is the popup's only boundary against the page, and the design round
       measured the first value at 2.21:1 on this page - below the 3:1 non-text floor,
       which makes an agent- and human-facing frame harder to read than it needs to be.
       This one measures 3.72:1 on the page and 3.38:1 on the panel fill. */
    overflow: hidden; border-radius: 8px; border: 1px solid #6b7280; background: #1c2027; }
  [role="option"] { padding: 10px 12px; }
  [role="option"] + [role="option"] { border-top: 1px solid #2a2f37; }
  #sentinel { width: 120px; height: 40px; background: rgb(255, 0, 255); }
  #metrics { margin-top: 16px; color: #9aa1ab; font-family: ui-monospace, monospace; }
</style>
</head><body>
<div class="row">
  <button id="open">open popup</button>
  <button id="close">close popup</button>
  <button id="reset">reset counters</button>
</div>
<p id="metrics">metrics: initializing</p>
<div id="popper-slot"></div>
<script>
  var counters = { resize: 0, blur: 0, focus: 0, vischange: 0, sizes: [] };
  var isOpen = false;

  function metrics() {
    var vv = window.visualViewport;
    return [
      "innerWidth=" + window.innerWidth,
      "innerHeight=" + window.innerHeight,
      "docEl=" + document.documentElement.clientWidth + "x" + document.documentElement.clientHeight,
      "vv=" + (vv ? vv.width + "x" + vv.height : "n/a"),
      "dpr=" + window.devicePixelRatio,
      "resize=" + counters.resize,
      "lastResizeSize=" + (counters.sizes.length ? counters.sizes[counters.sizes.length - 1] : "none"),
      "open=" + isOpen
    ].join(" ");
  }

  function render() {
    document.getElementById("metrics").textContent = "metrics: " + metrics();
  }

  // Mirrors Radix SelectContentImpl: any resize closes the popup. This is what turns
  // "the capture resized the renderer" into an observable closed popup.
  function close() {
    isOpen = false;
    document.getElementById("popper-slot").textContent = "";
    render();
  }

  window.addEventListener("resize", function () {
    counters.resize += 1;
    counters.sizes.push(window.innerWidth + "x" + window.innerHeight);
    close();
  });
  window.addEventListener("blur", function () { counters.blur += 1; render(); });
  window.addEventListener("focus", function () { counters.focus += 1; render(); });
  document.addEventListener("visibilitychange", function () { counters.vischange += 1; render(); });

  document.getElementById("open").addEventListener("click", function () {
    // The available height a popper measures before placing itself.
    var available = Math.max(0, document.documentElement.clientHeight - 200);
    var popper = document.createElement("div");
    popper.id = "popper";
    popper.setAttribute("data-state", "open");
    var content = document.createElement("div");
    content.id = "popper-content";
    content.style.setProperty("--viewport-available-height", available + "px");
    content.setAttribute("role", "listbox");
    content.setAttribute("aria-label", "hidden viewport options");
    ["Alpha", "Beta", "Gamma"].forEach(function (label) {
      var option = document.createElement("div");
      option.setAttribute("role", "option");
      option.textContent = label;
      content.appendChild(option);
    });
    var sentinel = document.createElement("div");
    sentinel.id = "sentinel";
    content.appendChild(sentinel);
    popper.appendChild(content);
    var slot = document.getElementById("popper-slot");
    slot.textContent = "";
    slot.appendChild(popper);
    isOpen = true;
    render();
  });

  document.getElementById("close").addEventListener("click", close);
  document.getElementById("reset").addEventListener("click", function () {
    counters.resize = 0;
    counters.blur = 0;
    counters.focus = 0;
    counters.vischange = 0;
    counters.sizes = [];
    render();
  });

  // Polled so the readout is LIVE rather than only as fresh as the last event: a
  // read must not race the counter it is asserting on.
  setInterval(render, 250);
  render();
</script>
</body></html>`;

/**
 * A payment-style field inside a CROSS-SITE iframe — the shape a validation run
 * hit (a card-number field in a payment provider's frame), where `type` aimed at
 * the frame element answered `Value is now '<text>'` with `via: "value_setter"`
 * while nothing was typed: the old setter fallback planted a `value` expando on
 * the iframe and read its own write back.
 *
 * The frame is served by a SECOND loopback server and addressed as `localhost`
 * while the page is `127.0.0.1`: a different host is a different site, so
 * Chromium puts the frame in its own process exactly as it does a real payment
 * frame, and the top document cannot reach into it. A different port alone would
 * be cross-origin but same-site, which is not the case being proved.
 *
 * A top-level field sits beside the frame as the control: the same page, the same
 * call, a target that can hold text.
 *
 * No backticks in this comment or its markup: it lives inside a template
 * literal.
 */
function iframeTypePage(frameOrigin) {
	return `<!doctype html>
<html><head><meta charset="utf-8"><title>Iframe type proof page</title>
<style>body{font:14px system-ui;margin:0;padding:24px}iframe{width:360px;height:80px;border:1px solid #888}</style>
</head><body>
<h1>Iframe type proof page</h1>
<label for="holder">Cardholder</label>
<input id="holder" type="text" />
<p>Card number (inside a cross-site frame):</p>
<iframe id="card" title="Card number" src="${frameOrigin}/card-frame"></iframe>
</body></html>`;
}

/**
 * The card frame. The `_top` link is the one navigation a frame can start on the
 * PAGE: ARCH-1 expected it to pause on the page session as a main-frame hop, so
 * the origin gate still applies; §5c clicks it through the frame to measure that.
 * It points at the frame's own origin, which the run never approves.
 */
function cardFramePage(frameOrigin) {
	return `<!doctype html>
<html><head><meta charset="utf-8"><title>Card frame</title></head>
<body style="margin:8px;font:14px system-ui">
<input id="number" type="text" autocomplete="cc-number" placeholder="1234 1234 1234 1234" />
<a id="escape" href="${frameOrigin}/escaped" target="_top">leave</a>
</body></html>`;
}

/** A Stripe-style frame with three fields: aimed at as an element, type must
 * not guess which one is meant. */
const MULTI_FRAME_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Multi frame</title></head>
<body style="margin:8px;font:14px system-ui">
<input id="number" type="text" placeholder="number" />
<input id="expiry" type="text" placeholder="MM / YY" />
<input name="cvc" type="text" placeholder="CVC" />
</body></html>`;

/** A frame with nothing editable in it: aimed at as an element, type keeps
 * #851's honest refusal. */
const BLANK_FRAME_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Blank frame</title></head>
<body style="margin:8px;font:14px system-ui"><p>Nothing to type into here.</p></body></html>`;

/** Served from 127.0.0.1 on the FRAME server's port: a different origin but the
 * same site as the page, so Chromium keeps it in the page's process and it has
 * no target of its own (measured, ARCH-1). */
const SAMESITE_FRAME_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Same-site frame</title></head>
<body style="margin:8px;font:14px system-ui">
<input id="postcode" type="text" placeholder="Postcode" />
</body></html>`;

/** The page with the frames type must refuse or reach by other routes. */
function iframeMorePage(frameOrigin, sameSiteOrigin) {
	return `<!doctype html>
<html><head><meta charset="utf-8"><title>Iframe refusal proof page</title>
<style>body{font:14px system-ui;margin:0;padding:24px}iframe{width:360px;height:80px;border:1px solid #888;display:block;margin:8px 0}</style>
</head><body>
<h1>Iframe refusal proof page</h1>
<iframe id="multi" title="Card details" src="${frameOrigin}/multi-frame"></iframe>
<iframe id="blank" title="Notice" src="${frameOrigin}/blank-frame"></iframe>
<iframe id="samesite" title="Postcode" src="${sameSiteOrigin}/samesite-frame"></iframe>
</body></html>`;
}

/**
 * Issue #871: fields that take a write and then give it back.
 *
 * `type` falls back to the node's value setter when `Input.insertText` does not
 * land, and used to report what that setter's own function returned - the value
 * read in the same breath as the assignment. A framework-controlled field can take
 * that write and revert it on the very next tick, so the old answer was "Value is
 * now ..." over an empty field. Three field shapes, so each claim has a control:
 *
 *   - `revert`: refuses `insertText` (a cancelled `beforeinput`, so the primary
 *     path's read-back disagrees and the setter fallback is the code that runs) and
 *     restores the empty value one macrotask after any `input` event, which is what
 *     the setter fallback dispatches. Nothing can make it keep text.
 *   - `setter-only`: refuses `insertText` the same way but KEEPS a setter write.
 *     The fallback must still land here, with `via: value_setter`, or the fix has
 *     broken the path it guards.
 *   - `keep`: an ordinary input; `insertText` lands.
 *
 * Shared by the top document and the cross-site frame so both go through the same
 * script; the frame is the case where the read-back must happen in the frame's own
 * session. No backticks in this comment or the markup: it lives inside a template
 * literal.
 */
const REVERT_FIELDS = `
<input id="REVERT_ID" type="text" />
<input id="SETTER_ID" type="text" />
<input id="KEEP_ID" type="text" />
<script>
for (const id of ["REVERT_ID", "SETTER_ID"]) {
  document.getElementById(id).addEventListener("beforeinput", (event) => {
    if (event.inputType === "insertText") event.preventDefault();
  });
}
const reverting = document.getElementById("REVERT_ID");
reverting.addEventListener("input", () => {
  setTimeout(() => { reverting.value = ""; }, 0);
});
</script>`;

const DOES_NOT_HOLD_TEXT = /does not hold the text/;
const NOTHING_REPORTED_TYPED = /nothing was reported typed/;

function revertFields(prefix) {
	return REVERT_FIELDS.replaceAll("REVERT_ID", `${prefix}revert`)
		.replaceAll("SETTER_ID", `${prefix}setter-only`)
		.replaceAll("KEEP_ID", `${prefix}keep`);
}

/** The top document: its own three fields and a cross-site frame holding three more. */
function revertTypePage(frameOrigin) {
	return `<!doctype html>
<html><head><meta charset="utf-8"><title>Reverting field proof page</title>
<style>body{font:14px system-ui;margin:0;padding:24px}iframe{width:360px;height:120px;border:1px solid #888;display:block}</style>
</head><body>
<h1>Reverting field proof page</h1>
${revertFields("top-")}
<iframe id="rv" title="Reverting card" src="${frameOrigin}/revert-frame"></iframe>
</body></html>`;
}

const REVERT_FRAME_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Reverting frame</title></head>
<body style="margin:8px;font:14px system-ui">${revertFields("frame-")}</body></html>`;

/** The second loopback server the iframes' documents come from. It serves only
 * the frames; anything else is a 404 so a wrong URL is visible. */
function startFrameSite() {
	const server = createServer((req, res) => {
		const url = new URL(req.url, "http://localhost");
		const pages = {
			"/card-frame": () => cardFramePage(`http://${req.headers.host}`),
			"/multi-frame": () => MULTI_FRAME_PAGE,
			"/blank-frame": () => BLANK_FRAME_PAGE,
			"/samesite-frame": () => SAMESITE_FRAME_PAGE,
			"/revert-frame": () => REVERT_FRAME_PAGE,
		};
		const page = pages[url.pathname];
		if (page) {
			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(page());
			return;
		}
		res.writeHead(404, { "Content-Type": "text/plain" });
		res.end("not found");
	});
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () =>
			resolve({ server, port: server.address().port }),
		);
	});
}

/** Responses still held open by the `/slow` route, destroyed at the end of the
 * run so a deliberately hung request cannot keep this process alive. */
const held = [];

function startSite(frameOrigin) {
	const server = createServer((req, res) => {
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		if (url.pathname === "/slow") {
			// Accepts the connection and never answers — the input QA round 1 used to
			// find the typed `nav_timeout` unreachable. Headers are sent so the client
			// knows the server is alive; the body never arrives and the request never
			// completes.
			held.push(res);
			res.writeHead(200, { "Content-Type": "text/html" });
			res.write("<!doctype html><title>slow</title><p>never finishes");
			return;
		}
		if (url.pathname === "/echo") {
			res.writeHead(200, { "Content-Type": "text/plain" });
			res.end(`COOKIE_HEADER: ${req.headers.cookie ?? "(none)"}`);
			return;
		}
		if (url.pathname === "/set") {
			// A SESSION cookie (no Expires/Max-Age: Chromium keeps it in memory and
			// drops it with the process) and a PERSISTENT one, so the restart probe
			// measures both in one visit.
			res.writeHead(200, {
				"Content-Type": "text/html",
				"Set-Cookie": [
					"session_only=1; Path=/",
					"persistent=1; Path=/; Max-Age=86400",
				],
			});
			res.end(
				"<!doctype html><title>cookie set</title><p id=cookies>cookies set</p>",
			);
			return;
		}
		if (url.pathname === "/page2") {
			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(PAGE2);
			return;
		}
		if (url.pathname === "/geometry") {
			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(GEOMETRY_PAGE);
			return;
		}
		if (url.pathname === "/hidden-viewport") {
			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(HIDDEN_VIEWPORT_PAGE);
			return;
		}
		if (url.pathname === "/iframe-type") {
			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(iframeTypePage(frameOrigin));
			return;
		}
		if (url.pathname === "/iframe-more") {
			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(
				iframeMorePage(
					frameOrigin,
					frameOrigin.replace("//localhost:", "//127.0.0.1:"),
				),
			);
			return;
		}
		if (url.pathname === "/revert-type") {
			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(revertTypePage(frameOrigin));
			return;
		}
		if (url.pathname === "/popup-target") {
			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(POPUP_PAGE);
			return;
		}
		res.writeHead(200, { "Content-Type": "text/html" });
		res.end(PAGE);
	});
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () =>
			resolve({ server, port: server.address().port }),
		);
	});
}

// ---- the app ---------------------------------------------------------------

/** The app this run started, so a failure anywhere still stops it. */
let app = null;

async function stopApp() {
	if (!app) return;
	const stopping = app;
	app = null;
	stopping.flush();
	await stopping.stop();
}

async function launchApp() {
	/*
	 * `withNotificationsOff`, and not merely for tidiness: this rig boots the
	 * real app, and a backend it spawns reaches macOS through `osascript` for a
	 * parked gate — a banner in the operator's real Notification Center from a
	 * harness run. See `notifications-off.mjs`.
	 *
	 * `withTelemetryOff` for the same reason one project over: this rig boots the
	 * real app, whose build carries the live PostHog project key, and neither the
	 * scratch HOME nor the scratch profile can switch off a client the renderer
	 * configures from a value inlined at build time. See `telemetry-off.mjs`.
	 */
	const env = withNotificationsOff({
		...process.env,
		HOME: HOME_DIR,
		LOCAL_OPERATOR_CONFIG_DIR: CONFIG_DIR,
		// The operator's own log files are the one path HOME does not move; see the
		// header's isolation note.
		LOCAL_OPERATOR_LOG_DIR: LOG_DIR,
		LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
		// The app would otherwise try to install and start a Local Operator backend
		// in this scratch HOME — a pip install, a dialog and a quit path that have
		// nothing to do with the browser host. The same switch the repo's other
		// app-proof harness uses.
		VITE_DISABLE_BACKEND_MANAGER: "true",
	});
	withTelemetryOff(env);
	// Every inherited cmux/lop variable is removed rather than overwritten: this
	// process is driven by a session that has them set, and an inherited workspace
	// id has already renamed the operator's real workspaces in this project.
	for (const key of Object.keys(env)) {
		if (key.startsWith("CMUX_") || key.startsWith("LOP_")) delete env[key];
	}
	// A port nobody is listening on, checked immediately before the spawn: the
	// check that used to run once per run is now per launch, which is where the
	// collision actually happened.
	DEVTOOLS_PORT = await freeDevtoolsPort();
	const child = spawn(
		electronPath,
		[
			".",
			`--user-data-dir=${USER_DATA}`,
			`--remote-debugging-port=${DEVTOOLS_PORT}`,
		],
		{
			env,
			cwd: ROOT,
			stdio: ["ignore", "pipe", "pipe"],
			// Own the whole tree. Electron spawns helpers (GPU, renderer, utility), so a
			// signal to the direct child alone is not a stop — `detached` puts the app in
			// its own process group and `stop` below signals that group, the same rule
			// `scripts/npx-smoke-test.mjs` documents.
			detached: true,
		},
	);
	const logPath = join(SCRATCH, "app.log");
	const stream = [];
	// The pid the sampler's reading is judged against (see `startFrontmostSampler`);
	// the run launches the app twice, so every pid this process launched is kept.
	appPids.push(child.pid);
	child.stdout.on("data", (chunk) => stream.push(chunk.toString()));
	child.stderr.on("data", (chunk) => stream.push(chunk.toString()));
	const flush = () => writeFileSync(logPath, stream.join(""));
	const timer = setInterval(flush, 500);
	child.on("exit", () => {
		clearInterval(timer);
		flush();
	});
	return {
		child,
		logPath,
		stream,
		flush,
		stop: () =>
			new Promise((resolve) => {
				/** Kill the process GROUP, not just the pid, and tolerate a group that has
				 * already gone away. */
				const killTree = (signal) => {
					try {
						process.kill(-child.pid, signal);
					} catch {
						try {
							child.kill(signal);
						} catch {
							/* already dead */
						}
					}
				};
				child.once("exit", resolve);
				killTree("SIGTERM");
				setTimeout(() => {
					killTree("SIGKILL");
					resolve();
				}, 5000);
			}),
	};
}

function stateFilePath() {
	return join(CONFIG_DIR, "run", "ui-browser", "host.json");
}

async function waitForState(timeoutMs = 60_000) {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		if (existsSync(stateFilePath())) {
			const raw = readFileSync(stateFilePath(), "utf8");
			try {
				const parsed = JSON.parse(raw);
				if (parsed.port) return parsed;
			} catch {
				// A reader can catch the file mid-write only if the writer is not
				// staging; it stages, so this is the "not yet" case.
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`no state file appeared at ${stateFilePath()}`);
}

async function rpc(state, method, params = {}, options = {}) {
	const key = options.key === undefined ? state.session_key : options.key;
	const response = await fetch(`http://127.0.0.1:${state.port}/rpc`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(options.omitKey ? {} : { "X-Bridge-Key": key }),
		},
		body:
			typeof options.rawBody === "string"
				? options.rawBody
				: JSON.stringify({
						id: options.id ?? `proof-${method}`,
						method,
						params,
					}),
	});
	const text = await response.text();
	let json = null;
	try {
		json = JSON.parse(text);
	} catch {
		/* not JSON: the status is the fact */
	}
	return { status: response.status, headers: response.headers, text, json };
}

/** Call the RPC and require `ok: true`, returning the result. A refusal here is a
 * failure of the run, not a result to interpret. */
async function rpcOk(state, method, params = {}) {
	const out = await rpc(state, method, params);
	if (out.status !== 200 || !out.json?.ok) {
		throw new Error(`${method} failed: ${out.status} ${out.text}`);
	}
	return out.json.result;
}

// ---- the renderer, over CDP -------------------------------------------------

/**
 * Evaluate an expression in the app's own renderer.
 *
 * A CDP error response (a context being torn down between navigate and evaluate,
 * which happens whenever this runs while the page is still loading) is surfaced
 * as an error rather than as `undefined`. That distinction cost a whole debugging
 * round: the first version read only `message.result`, so an early call reported
 * "the IPC handler is missing" while the handler was registered and working.
 */
async function rendererEvaluate(expression, options = {}) {
	const list = await (
		await fetch(`http://127.0.0.1:${DEVTOOLS_PORT}/json/list`)
	).json();
	const page = list.find(
		(target) => target.type === "page" && target.url.startsWith("file:"),
	);
	if (!page) throw new Error("no renderer target on the debugging port");
	const socket = new WebSocket(page.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		socket.addEventListener("open", resolve, { once: true });
		socket.addEventListener("error", reject, { once: true });
	});
	const logged = [];
	// The evaluate gets an id of its own and is resolved on THAT id: with
	// `collectLogs` the enabling calls also consume ids, and resolving on "the first
	// response" read the log-enable reply and reported the expression as `undefined`.
	const EVALUATE_ID = 100;
	const message = await new Promise((resolve, reject) => {
		let nextId = 0;
		const request = (method, params, id = ++nextId) => {
			socket.send(JSON.stringify({ id, method, params }));
		};
		socket.addEventListener("message", (event) => {
			const incoming = JSON.parse(event.data);
			if (incoming.method === "Log.entryAdded" && incoming.params?.entry) {
				logged.push(String(incoming.params.entry.text ?? ""));
			}
			if (incoming.method === "Runtime.consoleAPICalled") {
				const args = (incoming.params?.args ?? []).map((a) =>
					String(a.value ?? a.description ?? ""),
				);
				logged.push(args.join(" "));
			}
			if (incoming.id === EVALUATE_ID) resolve(incoming);
		});
		socket.addEventListener("error", reject, { once: true });
		if (options.collectLogs) {
			// The browser's OWN sentence for a blocked fetch is the evidence: "Failed
			// to fetch" alone does not say whether CORS, a private-network check or a
			// dead server refused it.
			request("Log.enable", {});
			request("Runtime.enable", {});
		}
		request(
			"Runtime.evaluate",
			{ expression, awaitPromise: true, returnByValue: true },
			EVALUATE_ID,
		);
	});
	// The blocked-request report arrives after the evaluate settles, so give the log
	// channel a moment before closing the socket.
	if (options.collectLogs)
		await new Promise((resolve) => setTimeout(resolve, 1500));
	socket.close();
	if (message.error) return { error: `CDP: ${message.error.message}` };
	if (message.result?.exceptionDetails) {
		return {
			error:
				message.result.exceptionDetails.exception?.description ??
				message.result.exceptionDetails.text ??
				"threw",
		};
	}
	return { value: message.result?.result?.value, logged };
}

/** Wait until the renderer's page has loaded AND its preload has exposed the
 * browser namespace: the state file appears before the window's first paint, so
 * everything the renderer does has to wait for it. */
async function waitForRenderer(timeoutMs = 60_000) {
	const started = Date.now();
	for (;;) {
		const ready = await rendererEvaluate(
			"typeof window.api?.browser?.state === 'function' ? 'ready' : 'waiting'",
		);
		if (ready.value === "ready") return;
		if (Date.now() - started > timeoutMs) {
			throw new Error(
				`the renderer never exposed window.api.browser (${JSON.stringify(ready)})`,
			);
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
}

// ---- the run ----------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Every target the app exposes on the debugging port, page targets included.
 * The driven views are targets here, and so is every popup a page opened — which
 * is what makes "a popup target appeared / disappeared" a reading rather than a
 * claim. */
async function targets() {
	return await (
		await fetch(`http://127.0.0.1:${DEVTOOLS_PORT}/json/list`)
	).json();
}

/** The page targets' urls, in list order — the transcript's own record of what
 * exists on the port at a moment. */
function pageTargetUrls(list) {
	return list
		.filter((target) => target.type === "page")
		.map((target) => target.url);
}

/** Wait until a page target matches `predicate`, returning it. */
async function waitForTarget(predicate, label, timeoutMs = 15_000) {
	const started = Date.now();
	for (;;) {
		const hit = (await targets()).find(
			(target) => target.type === "page" && predicate(target),
		);
		if (hit) return hit;
		if (Date.now() - started > timeoutMs) {
			throw new Error(`timed out waiting for ${label}`);
		}
		await sleep(250);
	}
}

/** Wait until NO page target matches `predicate` — the reading a close path
 * produces (a popup's target leaves the port when its window closes). */
async function waitForTargetGone(predicate, label, timeoutMs = 15_000) {
	const started = Date.now();
	for (;;) {
		const hit = (await targets()).find(
			(target) => target.type === "page" && predicate(target),
		);
		if (!hit) return true;
		if (Date.now() - started > timeoutMs) {
			throw new Error(`timed out waiting for ${label} to disappear`);
		}
		await sleep(250);
	}
}

/** One one-shot CDP request against a specific target, over its own socket. */
async function cdpOnTarget(target, method, params = {}, id = 1) {
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		socket.addEventListener("open", resolve, { once: true });
		socket.addEventListener("error", reject, { once: true });
	});
	const message = await new Promise((resolve, reject) => {
		socket.addEventListener("message", (event) => {
			const incoming = JSON.parse(event.data);
			if (incoming.id === id) resolve(incoming);
		});
		socket.addEventListener("error", reject, { once: true });
		socket.send(JSON.stringify({ id, method, params }));
	});
	socket.close();
	if (message.error) {
		throw new Error(`${method}: ${message.error.message}`);
	}
	return message.result;
}

/** Several CDP requests on ONE socket, in order: an isolated world created on a
 * socket is gone with it, so a read inside a same-process frame (which has no
 * target of its own) needs its three steps on one connection. */
async function cdpSequence(target, run) {
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		socket.addEventListener("open", resolve, { once: true });
		socket.addEventListener("error", reject, { once: true });
	});
	const pending = new Map();
	socket.addEventListener("message", (event) => {
		const incoming = JSON.parse(event.data);
		const waiter = pending.get(incoming.id);
		if (!waiter) return;
		pending.delete(incoming.id);
		if (incoming.error) waiter.reject(new Error(incoming.error.message));
		else waiter.resolve(incoming.result);
	});
	let next = 0;
	const send = (method, params = {}) =>
		new Promise((resolve, reject) => {
			next += 1;
			pending.set(next, { resolve, reject });
			socket.send(JSON.stringify({ id: next, method, params }));
		});
	try {
		return await run(send);
	} finally {
		socket.close();
	}
}

/** Evaluate inside a child frame of a page target, by the frame's url, from the
 * PAGE target's own debugging socket — a read that shares nothing with the host
 * under test. Used for a same-process frame, which has no target to read from. */
async function frameEvaluate(pageTarget, urlPart, expression) {
	return cdpSequence(pageTarget, async (send) => {
		const { frameTree } = await send("Page.getFrameTree");
		const frame = (frameTree.childFrames ?? []).find((child) =>
			child.frame.url.includes(urlPart),
		)?.frame;
		if (!frame) return { error: `no frame whose url has ${urlPart}` };
		const world = await send("Page.createIsolatedWorld", {
			frameId: frame.id,
			worldName: "proof-readback",
		});
		const out = await send("Runtime.evaluate", {
			expression,
			contextId: world.executionContextId,
			returnByValue: true,
		});
		return { value: out?.result?.value, url: frame.url };
	});
}

/**
 * The popup-under-a-headless-run frame (docs/design/browser-oauth-popups.md
 * 2.6, 5.1.3), captured over CDP against the popup's OWN target.
 *
 * WHY CDP AND NOT THE HOST'S `screenshot` ACTION: the popup is deliberately not
 * a tab, so the driver — which drives views — cannot see it; and `capturePage`'s
 * visibility-forcing semantics are exactly what the driver refuses for page
 * content. `Page.captureScreenshot` on the popup's target is the same capture
 * the driver uses for the renderer, aimed at the window the popup actually is.
 */
async function captureTargetFrame(target, path) {
	const result = await cdpOnTarget(target, "Page.captureScreenshot", {
		format: "png",
	});
	const data = result?.data;
	if (!data) throw new Error(`no frame came back from ${target.url}`);
	const bytes = Buffer.from(data, "base64");
	writeFileSync(path, bytes);
	return { bytes: bytes.length, url: target.url };
}

/** Evaluate an expression in a specific target (a popup's own document), the
 * same shape `rendererEvaluate` uses for the app's renderer. */
async function targetEvaluate(target, expression) {
	const result = await cdpOnTarget(target, "Runtime.evaluate", {
		expression,
		awaitPromise: true,
		returnByValue: true,
	});
	if (result?.exceptionDetails) {
		return {
			error:
				result.exceptionDetails.exception?.description ??
				result.exceptionDetails.text ??
				"threw",
		};
	}
	return { value: result?.result?.value };
}

/** Click a control in a driven tab by its accessible name, through the host's
 * own `click` action — a real CDP input event, so `window.open` runs with the
 * activation a person's click carries. */
async function clickControl(state, tab, label) {
	const snapshot = await rpcOk(state, "snapshot", { tab });
	const ref = new RegExp(`- button "${label}" \\[(e\\d+)\\]`).exec(
		snapshot.snapshot,
	)?.[1];
	if (!ref) {
		throw new Error(`no "${label}" control in the snapshot`);
	}
	return await rpcOk(state, "click", { tab, ref });
}

/** The text a selector shows in a driven tab. */
async function readSelector(state, tab, selector) {
	const read = await rpcOk(state, "read", { tab, selector });
	return read.text;
}

/** A persistent CDP session on one target, for a sequence of commands against the
 * same view (the ladder below). One socket, ids resolved per request: a one-shot
 * helper cannot measure a sequence.
 *
 * The caveat is the driver's own documented one (`src/main/browser/cdp.ts`): a
 * foreign CDP attachment DETACHES the app's debugger attachment, and the app
 * re-attaches on its next action. That is tolerable for a measurement leg run at
 * the END of a section, and it is why the ladder is opt-in rather than part of the
 * always-on checks. */
async function openTargetSession(target) {
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		socket.addEventListener("open", resolve, { once: true });
		socket.addEventListener("error", reject, { once: true });
	});
	let nextId = 0;
	const pending = new Map();
	socket.addEventListener("message", (event) => {
		const incoming = JSON.parse(event.data);
		const settle = pending.get(incoming.id);
		if (settle) {
			pending.delete(incoming.id);
			settle(incoming);
		}
	});
	return {
		send: (method, params = {}, timeoutMs = 20_000) =>
			new Promise((resolve, reject) => {
				const id = ++nextId;
				const timer = setTimeout(() => {
					pending.delete(id);
					reject(new Error(`${method}: no reply inside ${timeoutMs} ms`));
				}, timeoutMs);
				pending.set(id, (message) => {
					clearTimeout(timer);
					if (message.error)
						reject(new Error(`${method}: ${message.error.message}`));
					else resolve(message.result);
				});
				socket.send(JSON.stringify({ id, method, params }));
			}),
		close: () => socket.close(),
	};
}

/**
 * How many pixels of a capture are the fixture's magenta sentinel, counted by the
 * app's OWN Chromium.
 *
 * WHY THE FRAME GOES BACK INTO THE RENDERER rather than through a decoder in this
 * file: the claim is about pixels, and the repository already has one PNG decoder
 * (`scripts/band-occlusion-evidence.mjs`) written for a different question (row
 * comparisons from a file). Handing the bytes to Chromium as a bitmap answers the
 * same question with the engine that produced them, and keeps this rig runnable on
 * its own - the property the rig's header asks for. The bitmap arrives as a Blob
 * rather than a `data:` URL so no CSP `img-src` applies.
 *
 * TOLERANCE, NOT EQUALITY, and the reason is not slackness: the captures carry an
 * embedded Display-P3 ICC profile (the design round measured it: `mntr`, RGB/XYZ,
 * red primary 0.5151/0.2412), so the fixture's `rgb(255, 0, 255)` is STORED as
 * `#EA33F7` and a strict `=== #ff00ff` check would fail on this host. The tagging is
 * identical before and after the fix, so it says nothing about the change; the range
 * below is what keeps this check about the sentinel rather than about the profile.
 */
async function magentaPixels(base64) {
	const result = await rendererEvaluate(`(async () => {
		const binary = atob("${base64}");
		const bytes = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
		const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
		const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
		const context = canvas.getContext("2d");
		context.drawImage(bitmap, 0, 0);
		const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
		let magenta = 0;
		for (let index = 0; index < data.length; index += 4) {
			if (data[index] > 200 && data[index + 1] < 60 && data[index + 2] > 200) magenta += 1;
		}
		return JSON.stringify({ width: bitmap.width, height: bitmap.height, magenta });
	})()`);
	if (result.error) throw new Error(`could not count pixels: ${result.error}`);
	return JSON.parse(String(result.value ?? "{}"));
}

/**
 * The capture ladder: which capture shapes a HIDDEN view answers, and whether they
 * move the page.
 *
 * WHY IT IS OPT-IN AND RAW CDP: the property under test is "which capture perturbs
 * the page", and the shipped binary only ever issues the one shape it ships, so a
 * rig that can only ask for that shape cannot falsify the choice. This leg asks for
 * every candidate side by side, on the driven view's own target, and prints the page's
 * own counter around each one. It runs last because attaching a foreign CDP session
 * detaches the app's own attachment (see `openTargetSession`).
 *
 * The candidates exist because of a measured history rather than curiosity:
 * `captureBeyondViewport: false` copies the COMPOSITED surface, which a hidden view
 * was measured to lack before the view was sized before its first hide, and
 * `fromSurface: false` is the historical renderer-side capture.
 *
 * EVERY ROW HERE IS A COMPARISON, NOT A CHECK: this leg asserts nothing and its rows
 * pass or fail no part of the run. The shipped shape's own pass/fail reading lives in
 * §5d (`a capture does not resize the page`), which is where the `resize 0 -> 2`
 * number comes from — the clipped row below is the same shape ANSWERING NOTHING inside
 * 20 s in that run, so a reader looking for the resize count here will not find it.
 */
async function measureCaptureLadder(state, tab, fixtureUrl) {
	const target = await waitForTarget(
		(candidate) => candidate.url.startsWith(fixtureUrl),
		"the hidden-viewport tab's own CDP target",
	);
	const session = await openTargetSession(target);
	const evaluate = async (expression) => {
		const result = await session.send("Runtime.evaluate", {
			expression,
			returnByValue: true,
		});
		return result?.result?.value;
	};
	const reset = () => evaluate("document.getElementById('reset').click()");
	const metrics = () =>
		evaluate("document.getElementById('metrics').textContent");
	const candidates = [
		[
			"the shape this PR removed: captureBeyondViewport + clip to the view bounds",
			{
				format: "png",
				captureBeyondViewport: true,
				clip: { x: 0, y: 0, width: 1280, height: 720, scale: 1 },
			},
		],
		[
			"captureBeyondViewport: false (composited surface)",
			{ format: "png", captureBeyondViewport: false },
		],
		["fromSurface: false (renderer)", { format: "png", fromSurface: false }],
		[
			"captureBeyondViewport: true, no clip",
			{ format: "png", captureBeyondViewport: true },
		],
	];
	for (const [label, params] of candidates) {
		await reset();
		const before = await metrics();
		const started = Date.now();
		let outcome = "";
		let bytes = 0;
		try {
			const shot = await session.send("Page.captureScreenshot", params, 20_000);
			bytes = Buffer.from(shot?.data ?? "", "base64").length;
			outcome = "answered";
		} catch (error) {
			outcome = `FAILED: ${error.message}`;
		}
		const elapsed = Date.now() - started;
		const after = await metrics();
		const line = `[LADDER] ${label}: ${outcome} in ${elapsed} ms, ${bytes} bytes\n        before: ${before}\n        after:  ${after}`;
		// Said as well as recorded: a measurement leg that only reaches the final
		// transcript is lost the moment anything kills the run, and this one is the
		// evidence the capture path is chosen from.
		say(line);
		record(`capture ladder: ${label}`, line);
	}
	// The shipped path LAST, so the leg ends on what actually ships.
	await reset();
	const before = await metrics();
	const shot = await rpcOk(state, "screenshot", { tab });
	const after = await metrics();
	const shipped = `[LADDER] the shipped screenshot action: ${Buffer.from(shot.data, "base64").length} bytes\n        before: ${before}\n        after:  ${after}`;
	say(shipped);
	record("capture ladder: the shipped screenshot action", shipped);
	session.close();
}

/** A popup's own status line, once its document has run — polled, because the
 * document may still be loading when the target appears. */
async function waitForPopupStatus(target, label, timeoutMs = 10_000) {
	const started = Date.now();
	for (;;) {
		const result = await targetEvaluate(
			target,
			"document.getElementById('popup-status')?.textContent ?? ''",
		);
		if (typeof result.value === "string" && result.value.startsWith("popup:")) {
			return result.value;
		}
		if (Date.now() - started > timeoutMs) {
			throw new Error(
				`timed out waiting for ${label} (${JSON.stringify(result)})`,
			);
		}
		await sleep(250);
	}
}

/*
 * The app-not-frontmost sampler (docs/design/browser-oauth-popups.md 2.6): the
 * second reading beside the log's `presentation=never` token, reused from
 * `scripts/browser-chrome-proof.mjs:1070-1104` and bounded the same way, because
 * `osascript` reaching System Events is slow on this host (measured there at
 * 5.31-19.98 s per call). Re-armed one second AFTER each answer rather than by a
 * fixed timer — one `osascript` in flight, never a stack of them — and an
 * in-flight child is killed on stop so a slow answer cannot hold this process
 * open past its own end.
 */
const FRONTMOST_TIMEOUT_MS = 15_000;
const frontmostChildren = new Set();

function cancelFrontmost() {
	for (const child of frontmostChildren) child.kill();
	frontmostChildren.clear();
}

function frontmost() {
	return new Promise((resolve) => {
		const child = execFile(
			"osascript",
			[
				"-e",
				'tell application "System Events" to set p to first application process whose frontmost is true',
				"-e",
				'tell application "System Events" to return (name of p) & "|" & (unix id of p)',
			],
			{ stdio: ["ignore", "pipe", "ignore"], timeout: FRONTMOST_TIMEOUT_MS },
			(error, stdout) => {
				frontmostChildren.delete(child);
				resolve(error ? null : String(stdout).trim());
			},
		);
		frontmostChildren.add(child);
	});
}

function startFrontmostSampler() {
	const samples = [];
	let stopped = false;
	let timer = null;
	const tick = async () => {
		const value = await frontmost();
		if (value) samples.push(value);
		if (!stopped) timer = setTimeout(tick, 1000);
	};
	timer = setTimeout(tick, 1000);
	return {
		stop: () => {
			stopped = true;
			if (timer) clearTimeout(timer);
			cancelFrontmost();
		},
		samples,
	};
}

/** Every pid this run launched, so the sampler's reading can name them all (the
 * run restarts the app once, and a replaced pid is not the one to test). */
const appPids = [];
let frontmostSampler = null;

async function approve(state, origin, decision, kind = "async") {
	const requested = await rpcOk(state, "request_access", {
		url: origin,
		requester: "session:proof",
	});
	if (requested.state === "allowed")
		return { requested, answered: null, awaited: { state: "allowed" } };
	const pending = await rendererEvaluate(
		"window.api.browser.state().then((s) => JSON.stringify(s.pendingConsent))",
	);
	const entry = JSON.parse(pending.value ?? "[]").find(
		(candidate) => candidate.origin === origin,
	);
	if (!entry)
		throw new Error(
			`no pending consent for ${origin}: ${JSON.stringify(pending)}`,
		);
	const answered = await rendererEvaluate(
		`window.api.browser.respondToConsent(${JSON.stringify(entry.entryId)}, ${JSON.stringify(decision)}).then((s) => JSON.stringify(s))`,
	);
	const awaited = await rpcOk(state, "await_access", {
		url: origin,
		requester: "session:proof",
	});
	return { requested, answered, awaited, kind };
}

/** Fail fast if something else already owns the debugging port: see the comment
 * on `DEVTOOLS_PORT`. `freeDevtoolsPort()` performs the same check per launch;
 * this one runs once up front so a machine-wide leftover is named before the
 * first app starts. */
async function assertDevtoolsPortFree() {
	const port = DEVTOOLS_PORT || pickDevtoolsPort();
	try {
		const response = await fetch(`http://127.0.0.1:${port}/json/version`);
		if (response.ok) {
			say(
				`[note] port ${port} already serves a debugger (another run's app); this run will pick a different one`,
			);
		}
	} catch (error) {
		if (error instanceof TypeError) return; // nothing listening: what we want
		throw error;
	}
}

async function main() {
	rmSync(SCRATCH, { recursive: true, force: true });
	mkdirSync(HOME_DIR, { recursive: true });
	mkdirSync(CONFIG_DIR, { recursive: true });
	mkdirSync(USER_DATA, { recursive: true });
	mkdirSync(OUT_DIR, { recursive: true });
	mkdirSync(LOG_DIR, { recursive: true });

	const frameSite = await startFrameSite();
	const frameOrigin = `http://localhost:${frameSite.port}`;
	const site = await startSite(frameOrigin);
	const siteOrigin = `http://127.0.0.1:${site.port}`;
	say(`scratch: ${SCRATCH}`);
	say(`local site: ${siteOrigin}`);
	say(`cross-site frame origin: ${frameOrigin}`);

	await assertDevtoolsPortFree();
	app = await launchApp();
	let state = await waitForState();
	say(`state file: ${stateFilePath()}`);
	say(
		app.stream
			.join("")
			.split("\n")
			.filter((line) => line.includes("[browser]"))
			.join("\n"),
	);

	await waitForRenderer();
	// The app-not-frontmost sampler runs alongside everything below (design 2.6):
	// its reading is the OS's own answer to "did any of this take the screen",
	// and it is stopped beside the final log check.
	frontmostSampler = startFrontmostSampler();
	// The renderer owns layout (design 11.2): the chrome measures its content area
	// and reports it, and main applies it to the active tab. The route that does
	// this is PR 4, so this run reports the rect itself — through the real IPC
	// channel, which is also the proof that the renderer namespace works.
	const rect = await rendererEvaluate(
		"window.api.browser.setContentRect({ x: 0, y: 0, width: 1280, height: 800 }).then((s) => JSON.stringify(s))",
	);
	check(
		"the renderer can report its content rect over the browser IPC namespace",
		typeof rect.value === "string" && rect.value.includes('"activeTabId"'),
		`window.api.browser.setContentRect({x:0,y:0,width:1280,height:800}) -> ${rect.value ?? rect.error}`,
	);
	const ipcState = await rendererEvaluate(
		"window.api.browser.state().then((s) => JSON.stringify(s))",
	);
	check(
		"the renderer's projection carries tab ids and no surface token",
		typeof ipcState.value === "string" &&
			ipcState.value.includes("activeTabId") &&
			!ipcState.value.includes("ui:"),
		`window.api.browser.state() -> ${ipcState.value ?? ipcState.error}`,
	);

	// --- 1. the state file on disk ------------------------------------------
	const stat = statSync(stateFilePath());
	const dirStat = statSync(join(CONFIG_DIR, "run", "ui-browser"));
	check(
		"the state file exists with the permissions the design requires",
		(stat.mode & 0o777) === 0o600 && (dirStat.mode & 0o777) === 0o700,
		`${stateFilePath()} mode ${(stat.mode & 0o777).toString(8)}; directory mode ${(dirStat.mode & 0o777).toString(8)}; ${JSON.stringify(state)}`,
	);
	check(
		"the record names a live ui host with a protocol version",
		state.host === "ui" &&
			state.proto === 1 &&
			typeof state.session_key === "string" &&
			state.session_key.length >= 32,
		`host=${state.host} proto=${state.proto} key length=${state.session_key.length} pid=${state.pid}`,
	);

	// --- 2. the loopback RPC -------------------------------------------------
	const health = await fetch(`http://127.0.0.1:${state.port}/health`);
	const healthBody = await health.json();
	check(
		"/health identifies this process",
		health.status === 200 &&
			healthBody.host === "ui" &&
			healthBody.pid === state.pid,
		`GET /health -> ${health.status} ${JSON.stringify(healthBody)}`,
	);
	const noKey = await rpc(state, "status", {}, { omitKey: true });
	check(
		"a request without the key is refused",
		noKey.status === 401,
		`-> ${noKey.status} ${noKey.text}`,
	);
	const wrongKey = await rpc(
		state,
		"status",
		{},
		{ key: `${state.session_key}x` },
	);
	check(
		"a request with the wrong key is refused",
		wrongKey.status === 401,
		`-> ${wrongKey.status} ${wrongKey.text}`,
	);
	const unknownMethod = await rpc(state, "teleport", {});
	check(
		"an unknown method is refused at the boundary",
		unknownMethod.status === 422,
		`-> ${unknownMethod.status} ${unknownMethod.text}`,
	);
	const malformed = await rpc(state, "status", {}, { rawBody: "{not json" });
	check(
		"a malformed body is refused",
		malformed.status === 422,
		`-> ${malformed.status} ${malformed.text}`,
	);
	const extraField = await rpc(
		state,
		"status",
		{},
		{
			rawBody: JSON.stringify({
				id: "x",
				method: "status",
				params: {},
				extra: 1,
			}),
		},
	);
	check(
		"an unknown envelope field is refused",
		extraField.status === 422,
		`-> ${extraField.status} ${extraField.text}`,
	);
	const unauthorised = await rpc(state, "read", { tab: "ui:1:deadbeef" });
	check(
		"an unauthorised surface handle is refused with the tool's own code",
		unauthorised.status === 200 &&
			unauthorised.json?.ok === false &&
			unauthorised.json.error.code === "tab_closed",
		`-> ${unauthorised.text}`,
	);
	// --- 2b. the bind address, and what the rest of this machine's LAN can do --
	const hostLine = app.stream
		.join("")
		.split("\n")
		.map((line) => line.trim())
		.find((line) => line.includes("[browser] host on"));
	check(
		"the host publishes the loopback address it bound, naming the state file's port",
		Boolean(hostLine) && hostLine.includes(`127.0.0.1:${state.port}`),
		`${hostLine || "(no '[browser] host on' line in the log)"}\nstate file port=${state.port}`,
	);
	const lan = Object.values(networkInterfaces())
		.flat()
		.find((entry) => entry && entry.family === "IPv4" && !entry.internal);
	if (!lan) {
		say(
			"[SKIPPED] no non-loopback IPv4 on this machine: the off-host refusal could not be measured here",
		);
		record(
			"the off-host refusal (design 11.7 rule 1)",
			"[SKIPPED] this machine has no non-loopback IPv4 interface",
		);
	} else {
		const refused = await new Promise((resolve) => {
			const socket = connect({
				host: lan.address,
				port: state.port,
				timeout: 2000,
			});
			socket.once("connect", () => {
				socket.destroy();
				resolve("CONNECTED");
			});
			socket.once("error", (error) => resolve(error.code ?? String(error)));
			socket.once("timeout", () => {
				socket.destroy();
				resolve("TIMEOUT");
			});
		});
		check(
			"a connection to this machine's non-loopback address is refused",
			refused !== "CONNECTED",
			`net.connect({host: "${lan.address}", port: ${state.port}}) -> ${refused}`,
		);
	}

	const statusCall = await rpc(state, "status", {});
	check(
		"a valid call answers the envelope the Python client expects",
		statusCall.status === 200 &&
			statusCall.json?.id === "proof-status" &&
			statusCall.json.ok === true,
		`-> ${statusCall.text.slice(0, 400)}`,
	);
	record("status", JSON.stringify(statusCall.json.result, null, 2));

	// --- 3. the origin gate --------------------------------------------------
	const unapproved = await rpc(state, "open", {
		url: `${siteOrigin}/`,
		requester: "session:proof",
	});
	check(
		"an agent open on an unapproved origin fails early, before any prompt",
		unapproved.status === 200 &&
			unapproved.json?.error?.code === "origin_not_allowed",
		`-> ${unapproved.text}`,
	);

	// --- 4. the consent flow, answered through the app's own IPC -------------
	const approved = await approve(state, siteOrigin, "site");
	check(
		"request_access raises a prompt the app's chrome can answer, and await_access sees the decision",
		approved.requested.state === "pending" &&
			approved.awaited.state === "allowed",
		`request_access -> ${JSON.stringify(approved.requested)}\nrespondToConsent (via window.api.browser) -> ${approved.answered?.value ?? approved.answered?.error}\nawait_access -> ${JSON.stringify(approved.awaited)}`,
	);

	// --- 5. a real page, driven ---------------------------------------------
	const opened = await rpcOk(state, "open", {
		url: `${siteOrigin}/`,
		requester: "session:proof",
	});
	const handle = opened.tab;
	say(`opened ${handle} -> ${opened.url} "${opened.title}"`);
	const read = await rpcOk(state, "read", { tab: handle });
	check(
		"read returns the page's text from the isolated world",
		read.text.includes("Browser host proof page") &&
			read.url === `${siteOrigin}/`,
		`read.text starts: ${JSON.stringify(read.text.slice(0, 120))}... url=${read.url}`,
	);
	const isolation = await rpcOk(state, "read", {
		tab: handle,
		selector: "#isolation",
	});
	check(
		"the driven page's own script finds no bridge surface (no preload, sandboxed)",
		/isolation: api=undefined/.test(isolation.text) &&
			/ require=undefined/.test(isolation.text) &&
			/ process=undefined/.test(isolation.text) &&
			/ electron=undefined/.test(isolation.text),
		`the page reported back: ${JSON.stringify(isolation.text)}`,
	);
	const snapshot1 = await rpcOk(state, "snapshot", { tab: handle });
	check(
		"snapshot returns a pruned AX tree with refs",
		snapshot1.refs > 0 && snapshot1.snapshot.includes("[e"),
		`refs=${snapshot1.refs} epoch=${snapshot1.epoch}\n${snapshot1.snapshot.split("\n").slice(0, 12).join("\n")}`,
	);
	// The ref for the name field and the Go button, taken from the snapshot the
	// agent would have read.
	const nameRef = /- textbox "Name" \[(e\d+)\]/.exec(snapshot1.snapshot)?.[1];
	const goRef = /- button "Go" \[(e\d+)\]/.exec(snapshot1.snapshot)?.[1];
	check(
		"the snapshot exposes the controls by ref",
		Boolean(nameRef && goRef),
		`name=${nameRef} go=${goRef}`,
	);
	const typed = await rpcOk(state, "type", {
		tab: handle,
		ref: nameRef,
		text: "Ada Lovelace",
	});
	check(
		"type lands in the field and reads back",
		typed.value === "Ada Lovelace",
		`type -> ${JSON.stringify(typed)}`,
	);
	const clicked = await rpcOk(state, "click", { tab: handle, ref: goRef });
	const readAfter = await rpcOk(state, "read", { tab: handle });
	check(
		"click fires the page's handler (the click reads back as the page wrote it)",
		readAfter.text.includes("clicked with Ada Lovelace") &&
			clicked.navigated === false,
		`click -> ${JSON.stringify(clicked)}\nread after click: ${JSON.stringify(readAfter.text.slice(0, 160))}`,
	);
	// Taken BEFORE the scroll below: the frame should be the page the agent just
	// read, and a capture after scrolling to the bottom is a gradient and a
	// scrollbar (which is what the first version of this harness produced).
	const shot = await rpcOk(state, "screenshot", { tab: handle });
	const shotPath = join(OUT_DIR, "proof-page.png");
	const bytes = Buffer.from(shot.data, "base64");
	writeFileSync(shotPath, bytes);
	check(
		"screenshot returns a PNG, written here and magic-checked",
		bytes[0] === 0x89 &&
			bytes[1] === 0x50 &&
			bytes[2] === 0x4e &&
			bytes[3] === 0x47 &&
			bytes.length > 10_000,
		`${shotPath}: ${bytes.length} bytes, magic ${bytes.subarray(0, 8).toString("hex")}, url=${shot.url}, title=${JSON.stringify(shot.title)}`,
	);

	const scrolled = await rpcOk(state, "scroll", {
		tab: handle,
		direction: "bottom",
	});
	check(
		"scroll moves the page and reports whether more remains",
		scrolled.scrollY > 0 && scrolled.moreBelow === false,
		`scroll -> ${JSON.stringify(scrolled)}`,
	);
	const logs = await rpcOk(state, "logs", { tab: handle });
	const levels = new Set(logs.entries.map((entry) => entry.level));
	check(
		"logs carry console output and the uncaught exception",
		logs.entries.length >= 4 &&
			levels.has("error") &&
			levels.has("warning") &&
			levels.has("log"),
		`${logs.entries.length} entries\n${logs.entries.map((entry) => `  ${entry.level} [${entry.source}] ${entry.text.replace(/\n/g, " ").slice(0, 90)}`).join("\n")}`,
	);
	// The page records the permission outcome asynchronously, so poll for it rather
	// than racing it.
	let geoText = await rpcOk(state, "read", { tab: handle, selector: "#geo" });
	for (
		let attempt = 0;
		attempt < 20 && geoText.text.includes("not asked");
		attempt += 1
	) {
		await sleep(250);
		geoText = await rpcOk(state, "read", { tab: handle, selector: "#geo" });
	}
	check(
		"a permission request is denied by default",
		geoText.text.includes("denied"),
		`geolocation result on the page: ${JSON.stringify(geoText.text)}`,
	);
	// --- 5b. the popup policy, as a dance -------------------------------------
	/*
	 * The popup parity dance (docs/design/browser-oauth-popups.md 5.1.3). Before
	 * this change the check standing here asserted the OPPOSITE — "a popup is
	 * blocked and creates no tab" — and the deny-all it recorded is what broke
	 * the operator's Microsoft sign-in: a denied `window.open` returns `null` and
	 * MSAL cannot rebuild its opener/postMessage contract from that. So this
	 * section now drives the flow the fix exists for, on a real page and real
	 * child windows, and reads every property the design claims back out of the
	 * running app: the opener relation both ways, the shared cookie jar, the
	 * grandchild refusal, the cap boundary, the tab-close cleanup, and a frame of
	 * the popup itself under this headless run.
	 */
	const tabsBefore = await rpcOk(state, "tabs", { requester: "session:proof" });
	record(
		"page targets before the popup section",
		pageTargetUrls(await targets()).join("\n"),
	);

	// (a) The dance, driven by a real click: opened, opener present, the cookie
	// visible from both sides, the grandchild refused, ack received, self-closed.
	await clickControl(state, handle, "Popup dance");
	let danceText = "";
	for (let attempt = 0; attempt < 80; attempt += 1) {
		await sleep(250);
		danceText = await readSelector(state, handle, "#popup");
		if (danceText.includes("closed=yes")) break;
	}
	check(
		"the popup dance ran end to end: opened, opener=yes, cookies shared both ways, grandchild denied, closed=yes",
		[
			"opened",
			"opener=yes",
			"selfCookie=yes",
			"sharedJar=yes",
			"grandchild=denied",
			"ack=sent",
			"opener-at=/",
			"closed=yes",
		].every((token) => danceText.includes(token)),
		`popup result on the page: ${JSON.stringify(danceText)}`,
	);
	// The popup closed itself, so its target leaves the port — the page's own
	// close path, before the cap test counts live children.
	await waitForTargetGone(
		(target) => target.url.endsWith("/popup-target"),
		"the dance popup's target",
	);
	const tabsAfterDance = await rpcOk(state, "tabs", {
		requester: "session:proof",
	});
	check(
		"a popup is a window, not a tab: the tab list did not move",
		tabsAfterDance.tabs.length === tabsBefore.tabs.length,
		`tabs before ${tabsBefore.tabs.length}, after the popups ${tabsAfterDance.tabs.length}`,
	);

	// (b) MSAL's shape: open EMPTY first, then navigate — the case whose
	// WebPreferences Electron copies from the opener instead of taking ours. The
	// popup's own status line carries the two cross-window readings, so the
	// copied-prefs path is measured rather than assumed.
	await clickControl(state, handle, "Blank-first popup");
	const blankTarget = await waitForTarget(
		(target) => target.url.includes("which=blank"),
		"the blank-first popup target",
	);
	const blankStatus = await waitForPopupStatus(
		blankTarget,
		"the blank-first popup's status",
	);
	const blankRecord = await readSelector(state, handle, "#popup");
	check(
		"an about:blank-first popup opens, navigates, and keeps its opener and the shared jar",
		blankRecord.includes("blank=opened") &&
			blankStatus.includes("opener=present") &&
			blankStatus.includes("cookies=shared"),
		`opener record: ${JSON.stringify(blankRecord)}\npopup status: ${JSON.stringify(blankStatus)}`,
	);

	// (c) A denied scheme refuses, creates nothing, and is logged.
	await clickControl(state, handle, "Denied scheme");
	await sleep(1000);
	const deniedRecord = await readSelector(state, handle, "#popup");
	const afterDeniedTargets = pageTargetUrls(await targets());
	check(
		"a denied scheme (mailto:) is refused with nothing created",
		deniedRecord.includes("mailto=refused") &&
			!afterDeniedTargets.some((url) => url.includes("mailto")),
		`opener record: ${JSON.stringify(deniedRecord)}\ntargets: ${JSON.stringify(afterDeniedTargets)}`,
	);

	// (d) The cap: a held popup is opened for the capture, which makes TWO live
	// children (the blank-first one above and this one); the three candidates
	// then walk the boundary — the 4th live child is admitted, the 5th refused.
	await clickControl(state, handle, "Hold a popup");
	const directTarget = await waitForTarget(
		(target) => target.url.includes("which=direct"),
		"the held popup target",
	);
	await clickControl(state, handle, "Fill the cap");
	await sleep(1500);
	const capRecord = await readSelector(state, handle, "#popup");
	await waitForTarget(
		(target) => target.url.includes("which=cap1"),
		"the last admitted cap candidate",
	);
	const capTargets = pageTargetUrls(await targets());
	check(
		"the cap admits the 4th live child and refuses the 5th",
		capRecord.includes("cap=0:opened,1:opened,2:refused") &&
			capTargets.some((url) => url.includes("which=cap0")) &&
			capTargets.some((url) => url.includes("which=cap1")) &&
			!capTargets.some((url) => url.includes("which=cap2")),
		`opener record: ${JSON.stringify(capRecord)}\ntargets: ${JSON.stringify(capTargets)}`,
	);

	// (e) The popup-under-headless frames, over the popups' own CDP targets —
	// twice, because the about:blank-first child went through a different
	// creation path (copied prefs) than the direct one (our options).
	const directFrame = await captureTargetFrame(
		directTarget,
		join(OUT_DIR, "popup-headless.png"),
	);
	const blankFrame = await captureTargetFrame(
		blankTarget,
		join(OUT_DIR, "popup-blank-headless.png"),
	);
	check(
		"each popup captures as a full frame while the run is headless",
		directFrame.bytes > 5000 && blankFrame.bytes > 5000,
		`popup-headless.png ${directFrame.bytes} bytes (${directFrame.url})\npopup-blank-headless.png ${blankFrame.bytes} bytes (${blankFrame.url})`,
	);

	// (f) Opener-close cleanup: a second tab opens a held popup, and closing the
	// TAB takes the popup's target off the port — Chromium's documented
	// child-closes-with-opener default, which is the whole cleanup story.
	const cleanupTab = await rpcOk(state, "open", {
		url: `${siteOrigin}/`,
		requester: "session:proof",
	});
	await clickControl(state, cleanupTab.tab, "Cleanup popup");
	await waitForTarget(
		(target) => target.url.includes("which=cleanup"),
		"the cleanup popup target",
	);
	await rpcOk(state, "close", { tab: cleanupTab.tab });
	await waitForTargetGone(
		(target) => target.url.includes("which=cleanup"),
		"the cleanup popup's target after its tab closed",
	);
	const survivors = pageTargetUrls(await targets());
	const tabsAfterCleanup = await rpcOk(state, "tabs", {
		requester: "session:proof",
	});
	check(
		"closing the tab takes its popup with it, and only its popup",
		survivors.some((url) => url.includes("which=direct")) &&
			!survivors.some((url) => url.includes("which=cleanup")) &&
			tabsAfterCleanup.tabs.length === tabsBefore.tabs.length,
		`targets after the close: ${JSON.stringify(survivors)}\ntabs: ${tabsAfterCleanup.tabs.length}`,
	);
	// --- 5c. the structured reads, against the Radix-shaped fixture ----------
	/*
	 * The case a text read cannot answer: the popper's bounding rect (which
	 * exists only if the fixed positioning AND the transform are both applied),
	 * its computed `position`/`transform`/`width` (which disagree with its
	 * computed `left`/`top`), the inline `--*` placement properties the popper
	 * library writes, the element stack under a point, and the ancestor chain
	 * above an element - one call each. The bounds ride the same section: five
	 * matches, eight elements, twelve steps by default, sixteen as the hard
	 * ceiling.
	 */
	const geometryTab = await rpcOk(state, "open", {
		url: `${siteOrigin}/geometry`,
		requester: "session:proof",
	});
	const popover = await rpcOk(state, "styles", {
		tab: geometryTab.tab,
		selector: "#radix-popover",
		properties: ["border-top-width"],
	});
	const pop = popover.matches?.[0] ?? {};
	check(
		"styles answers the popper question in one call: rect, computed position/transform/width, inline --* props",
		popover.count === 1 &&
			pop.rect?.x === 310 &&
			pop.rect?.y === 140 &&
			pop.rect?.width === 240 &&
			pop.styles?.position === "fixed" &&
			pop.styles?.transform === "matrix(1, 0, 0, 1, 10, 20)" &&
			pop.styles?.left === "300px" &&
			pop.styles?.top === "120px" &&
			pop.styles?.width === "240px" &&
			pop.styles?.["border-top-width"] === "1px" &&
			pop.inline?.["--radix-popper-available-width"] === "640px" &&
			pop.inline?.["--radix-popper-transform-origin"] === "20px 30px",
		`count=${popover.count} rect=${JSON.stringify(pop.rect)}\nstyles.position=${pop.styles?.position} styles.transform=${pop.styles?.transform} styles.left=${pop.styles?.left} styles.top=${pop.styles?.top} styles.width=${pop.styles?.width} styles[border-top-width]=${pop.styles?.["border-top-width"]}\ninline=${JSON.stringify(pop.inline)}`,
	);
	record("styles('#radix-popover') (raw)", JSON.stringify(popover, null, 2));

	const many = await rpcOk(state, "styles", {
		tab: geometryTab.tab,
		selector: "div",
	});
	check(
		"styles caps its matches at five, so a broad selector cannot flood the wire",
		many.count === 5 && many.truncated === true,
		`div matches: count=${many.count} truncated=${many.truncated} first=${JSON.stringify((many.matches ?? []).map((match) => match.id || match.tag))}`,
	);

	const beta = await rpcOk(state, "styles", {
		tab: geometryTab.tab,
		selector: "#option-b",
	});
	const betaRect = beta.matches?.[0]?.rect;
	const betaX = betaRect.x + betaRect.width / 2;
	const betaY = betaRect.y + betaRect.height / 2;
	const hit = await rpcOk(state, "hit_test", {
		tab: geometryTab.tab,
		x: betaX,
		y: betaY,
	});
	const hitStack = (hit.elements ?? []).map(
		(element) => element.id || element.tag,
	);
	check(
		"hit_test answers the element stack under a point, topmost first",
		hit.elements?.[0]?.id === "option-b" &&
			hitStack.includes("radix-listbox") &&
			hitStack.includes("radix-popover") &&
			hitStack.includes("minerva-app-root"),
		`point=(${betaX}, ${betaY}) stack=${JSON.stringify(hitStack)}`,
	);
	record("hit_test at #option-b (raw)", JSON.stringify(hit, null, 2));

	const innermost = await rpcOk(state, "styles", {
		tab: geometryTab.tab,
		selector: "#stack-20",
	});
	const innerRect = innermost.matches?.[0]?.rect;
	const deepHit = await rpcOk(state, "hit_test", {
		tab: geometryTab.tab,
		x: innerRect.x + innerRect.width / 2,
		y: innerRect.y + innerRect.height / 2,
	});
	check(
		"hit_test caps its stack at eight, still topmost first",
		deepHit.elements?.length === 8 && deepHit.elements?.[0]?.id === "stack-20",
		`count=${deepHit.count} first=${deepHit.elements?.[0]?.id} stack=${JSON.stringify(
			(deepHit.elements ?? []).map((element) => element.id || element.tag),
		)}`,
	);

	const chain = await rpcOk(state, "ancestors", {
		tab: geometryTab.tab,
		selector: "#option-b",
	});
	const chainIds = (chain.chain ?? []).map(
		(element) => element.id || element.tag,
	);
	const popoverEntry = (chain.chain ?? []).find(
		(element) => element.id === "radix-popover",
	);
	check(
		"ancestors walks from the element up to the document element, each with its own rect and styles",
		chain.count === 6 &&
			chainIds.join(">") ===
				"option-b>radix-listbox>radix-popover>minerva-app-root>body>html" &&
			popoverEntry?.styles?.position === "fixed" &&
			popoverEntry?.styles?.["z-index"] === "50",
		`chain=${chainIds.join(" > ")} count=${chain.count}\npopover entry styles.position=${popoverEntry?.styles?.position} styles.z-index=${popoverEntry?.styles?.["z-index"]} styles.top=${popoverEntry?.styles?.top}`,
	);
	record("ancestors('#option-b') ids (raw)", JSON.stringify(chainIds));

	const deepChain = await rpcOk(state, "ancestors", {
		tab: geometryTab.tab,
		selector: "#stack-20",
	});
	check(
		"ancestors bounds the walk at twelve steps by default",
		deepChain.count === 12 && deepChain.chain?.[0]?.id === "stack-20",
		`count=${deepChain.count} head=${deepChain.chain?.[0]?.id} tail=${deepChain.chain?.[deepChain.chain.length - 1]?.tag}`,
	);
	const cappedChain = await rpcOk(state, "ancestors", {
		tab: geometryTab.tab,
		selector: "#stack-20",
		depth: 99,
	});
	check(
		"ancestors hard-caps the walk at sixteen even when asked for more",
		cappedChain.count === 16,
		`depth=99 -> count=${cappedChain.count}`,
	);

	const ghost = await rpc(state, "styles", {
		tab: geometryTab.tab,
		selector: "#ghost",
	});
	check(
		"a selector that matches nothing is the existing element_not_found refusal",
		ghost.json?.error?.code === "element_not_found",
		ghost.text,
	);
	// An invalid selector in the BUILT app: Electron's isolated world reports a
	// generic "Script failed to execute" for any thrown exception, so the message
	// the dev-time INVALID_SELECTOR mapping matches on never arrives here —
	// measured for `read` itself first (same generic text, same `internal`). The
	// contract this asserts is therefore PARITY: the new selector-keyed method
	// refuses exactly the way the existing selector-keyed `read` refuses — typed,
	// with no crash and no silent success.
	const invalidRead = await rpc(state, "read", {
		tab: geometryTab.tab,
		selector: "###",
	});
	const invalid = await rpc(state, "styles", {
		tab: geometryTab.tab,
		selector: "###",
	});
	check(
		"an invalid selector is refused the same way `read` refuses it",
		invalid.json?.ok === false &&
			invalid.json.error.code === invalidRead.json?.error?.code,
		`read -> ${invalidRead.text}\nstyles -> ${invalid.text}`,
	);
	const noSelector = await rpc(state, "styles", { tab: geometryTab.tab });
	check(
		"a missing selector is the extension's own `selector is required` refusal",
		noSelector.json?.error?.code === "element_not_found" &&
			/selector is required/.test(noSelector.text),
		noSelector.text,
	);
	const offViewport = await rpc(state, "hit_test", {
		tab: geometryTab.tab,
		x: 5000,
		y: 5000,
	});
	check(
		"a point with no element on it is `no element at point`, not an empty success",
		offViewport.json?.error?.code === "element_not_found" &&
			/no element at point/.test(offViewport.text),
		offViewport.text,
	);
	await rpcOk(state, "close", { tab: geometryTab.tab });

	// --- 5c. type into fields inside iframes ----------------------------------
	/*
	 * ARCH-1: a field inside a frame is reachable through the frame's own CDP
	 * session. Every claim below is READ BACK from the frame's OWN target over the
	 * devtools port, never from the host's reply: the host's read-back is the code
	 * under test. Before this change every one of these answered #851's refusal;
	 * the honesty that refusal bought is kept by the multi-field and no-field
	 * frames further down.
	 */
	const iframeTab = await rpcOk(state, "open", {
		url: `${siteOrigin}/iframe-type`,
		requester: "session:proof",
	});
	const frameTargets = async (path = "/card-frame") =>
		(await targets()).filter(
			(target) =>
				target.type === "iframe" &&
				target.url.startsWith(frameOrigin) &&
				target.url.includes(path),
		);
	let frameTarget = null;
	for (let attempt = 0; attempt < 40 && !frameTarget; attempt += 1) {
		frameTarget = (await frameTargets())[0] ?? null;
		if (!frameTarget) await sleep(250);
	}
	check(
		"the card field's frame loaded cross-site, in its own frame target",
		frameTarget !== null,
		frameTarget
			? `iframe target ${frameTarget.url} (page ${siteOrigin}/iframe-type)`
			: `no iframe target for ${frameOrigin}; targets: ${JSON.stringify((await targets()).map((target) => `${target.type} ${target.url}`))}`,
	);
	const pageTarget = await waitForTarget(
		(target) => target.url === `${siteOrigin}/iframe-type`,
		"the iframe proof page's target",
	);
	const frameNumber = async () => {
		if (!frameTarget) return { error: "no frame target" };
		const read = await targetEvaluate(
			frameTarget,
			"JSON.stringify({ origin: location.origin, number: document.getElementById('number').value })",
		);
		return read.value ? JSON.parse(read.value) : read;
	};
	const typedInFrame = async (label, selector, text) => {
		const typed = await rpc(state, "type", {
			tab: iframeTab.tab,
			selector,
			text,
		});
		const field = await frameNumber();
		check(
			label,
			typed.json?.ok === true &&
				typed.json.result?.frame_origin === frameOrigin &&
				field.number === text &&
				field.origin === frameOrigin,
			`type {selector: ${JSON.stringify(selector)}, text: "${text}"} -> ${typed.text}\nframe target #number (read over devtools) -> ${JSON.stringify(field)}`,
		);
	};
	await typedInFrame(
		"type aimed at the iframe ELEMENT lands in its one field, read back from the frame's own target",
		"#card",
		"4000056655665556",
	);
	const expando = await targetEvaluate(
		pageTarget,
		"JSON.stringify({ hasOwnValue: Object.prototype.hasOwnProperty.call(document.getElementById('card'), 'value'), value: String(document.getElementById('card').value) })",
	);
	check(
		"nothing was planted on the iframe element itself",
		expando.value ===
			JSON.stringify({ hasOwnValue: false, value: "undefined" }),
		`top document #card -> ${expando.value ?? expando.error}`,
	);
	await typedInFrame(
		"an explicit hop `iframe#card >>> #number` lands",
		"iframe#card >>> #number",
		"5555555555554444",
	);
	await typedInFrame(
		"a selector the page misses (`#number`) is found in the one frame that has it, and lands",
		"#number",
		"378282246310005",
	);
	const frameSnap = await rpcOk(state, "snapshot", { tab: iframeTab.tab });
	const frameBlock = frameSnap.snapshot.slice(
		Math.max(0, frameSnap.snapshot.indexOf("- frame iframe#card")),
	);
	const frameRef = /- textbox[^\n]*\[(e\d+)\]/.exec(frameBlock)?.[1] ?? null;
	check(
		"snapshot shows the frame's own tree, with a ref for its textbox",
		frameSnap.snapshot.includes("- frame iframe#card") && frameRef !== null,
		`snapshot ->\n${frameSnap.snapshot}`,
	);
	const cardText = "4242424242424242";
	if (frameRef) {
		const typed = await rpc(state, "type", {
			tab: iframeTab.tab,
			ref: frameRef,
			text: cardText,
		});
		const field = await frameNumber();
		check(
			"type by that ref lands in the frame",
			typed.json?.ok === true && field.number === cardText,
			`type {ref: "${frameRef}", text: "${cardText}"} -> ${typed.text}\nframe target #number -> ${JSON.stringify(field)}`,
		);
	}
	const holderTyped = await rpc(state, "type", {
		tab: iframeTab.tab,
		selector: "#holder",
		text: "Ada Lovelace",
	});
	check(
		"the control: type on the same page's top-level field lands exactly as before, with no frame_origin",
		holderTyped.json?.ok === true &&
			holderTyped.json.result?.value === "Ada Lovelace" &&
			holderTyped.json.result?.via === "insert_text" &&
			!("frame_origin" in (holderTyped.json.result ?? {})),
		`type {selector: "#holder"} -> ${holderTyped.text}`,
	);
	const iframeShotPath = join(OUT_DIR, "iframe-type.png");
	const iframeShot = await rpcOk(state, "screenshot", { tab: iframeTab.tab });
	writeFileSync(iframeShotPath, Buffer.from(iframeShot.data, "base64"));
	say(`iframe page frame: ${iframeShotPath}`);

	// A `_top` navigation started INSIDE the frame, toward an origin this run never
	// approved (the frame's own): it must be gated like any main-frame hop. ARCH-1
	// left this unmeasured; the page must still be the approved one afterwards.
	//
	// FIXED PRECONDITION (QA round 1, Q-1): without user activation in the frame,
	// Chromium blocks a frame's top navigation itself and the gate is never asked,
	// so a pass would prove nothing about OUR gate. The frame has activation here
	// because the type calls above dispatched input into it; that is ASSERTED,
	// read from the frame's own target, and the check then demands the gate's own
	// refusal - origin_not_allowed naming the frame origin - not just "no escape".
	const activation = frameTarget
		? await targetEvaluate(
				frameTarget,
				"JSON.stringify({ hasBeenActive: navigator.userActivation.hasBeenActive, isActive: navigator.userActivation.isActive })",
			)
		: { error: "no frame target" };
	const activated =
		typeof activation.value === "string" &&
		JSON.parse(activation.value).hasBeenActive === true;
	check(
		"precondition: the card frame has user activation, so a _top hop reaches the host's gate rather than Chromium's own block",
		activated,
		`frame target navigator.userActivation -> ${activation.value ?? activation.error}`,
	);
	const escapeClick = await rpc(state, "click", {
		tab: iframeTab.tab,
		selector: "iframe#card >>> #escape",
	});
	await sleep(500);
	const escapedTo = (await targets()).filter(
		(target) => target.type === "page" && target.url.includes("/escaped"),
	);
	check(
		"a _top link clicked inside the frame is refused by the host's origin gate, and the tab stays put",
		activated &&
			escapedTo.length === 0 &&
			escapeClick.json?.ok === false &&
			escapeClick.json.error?.code === "origin_not_allowed" &&
			escapeClick.json.error?.data?.origin === frameOrigin,
		`click {selector: "iframe#card >>> #escape"} -> ${escapeClick.text}\npage targets at /escaped: ${escapedTo.length}`,
	);
	await rpcOk(state, "close", { tab: iframeTab.tab });

	// The refusals that keep #851's honesty, and the same-site frame.
	const moreTab = await rpcOk(state, "open", {
		url: `${siteOrigin}/iframe-more`,
		requester: "session:proof",
	});
	let multiTarget = null;
	for (let attempt = 0; attempt < 40 && !multiTarget; attempt += 1) {
		multiTarget = (await frameTargets("/multi-frame"))[0] ?? null;
		if (!multiTarget) await sleep(250);
	}
	const blankFrameTarget = (await frameTargets("/blank-frame"))[0] ?? null;
	const multiTyped = await rpc(state, "type", {
		tab: moreTab.tab,
		selector: "#multi",
		text: "4242424242424242",
	});
	const multiFields = multiTarget
		? await targetEvaluate(
				multiTarget,
				"JSON.stringify(Array.from(document.querySelectorAll('input')).map((i) => i.value))",
			)
		: { error: "no multi-field frame target" };
	check(
		"type at a frame holding several fields refuses, lists each as a >>> path, and types nothing",
		multiTyped.json?.ok === false &&
			multiTyped.json.error?.code === "element_not_found" &&
			/iframe#multi >>> #number/.test(multiTyped.text) &&
			/iframe#multi >>> #expiry/.test(multiTyped.text) &&
			/cvc/.test(multiTyped.text) &&
			multiFields.value === JSON.stringify(["", "", ""]),
		`type {selector: "#multi"} -> ${multiTyped.text}\nframe target inputs -> ${multiFields.value ?? multiFields.error}`,
	);
	const blankTyped = await rpc(state, "type", {
		tab: moreTab.tab,
		selector: "#blank",
		text: "4242424242424242",
	});
	const blankText = blankFrameTarget
		? await targetEvaluate(blankFrameTarget, "document.body.innerText")
		: { error: "no blank frame target" };
	check(
		"type at a frame with no editable field is still #851's refusal, and writes nothing",
		blankTyped.json?.ok === false &&
			blankTyped.json.error?.code === "element_not_found" &&
			/not an editable field/.test(blankTyped.text) &&
			!String(blankText.value ?? "").includes("4242"),
		`type {selector: "#blank"} -> ${blankTyped.text}\nframe target text -> ${JSON.stringify(blankText.value ?? blankText.error)}`,
	);
	const morePage = await waitForTarget(
		(target) => target.url === `${siteOrigin}/iframe-more`,
		"the refusal page's target",
	);
	const sameSiteTyped = await rpc(state, "type", {
		tab: moreTab.tab,
		selector: "iframe#samesite >>> #postcode",
		text: "SW1A 1AA",
	});
	const postcode = await frameEvaluate(
		morePage,
		"/samesite-frame",
		"document.getElementById('postcode').value",
	);
	check(
		"a same-site frame (in the page's process, no target of its own) is reached through its document, and lands",
		sameSiteTyped.json?.ok === true &&
			postcode.value === "SW1A 1AA" &&
			typeof sameSiteTyped.json.result?.frame_origin === "string",
		`type {selector: "iframe#samesite >>> #postcode"} -> ${sameSiteTyped.text}\nframe document #postcode (page target, isolated world in that frame) -> ${JSON.stringify(postcode)}`,
	);
	await rpcOk(state, "close", { tab: moreTab.tab });

	// #851's top-document refusal, byte-stable (QA round 1, Q-2): a top-level
	// element that holds no text still gets the original sentence, with the hop
	// grammar appended as an extra clause rather than replacing it.
	const plainTab = await rpcOk(state, "open", {
		url: `${siteOrigin}/iframe-type`,
		requester: "session:proof",
	});
	const headingTyped = await rpc(state, "type", {
		tab: plainTab.tab,
		selector: "h1",
		text: "nope",
	});
	check(
		"type at a non-editable top-level element keeps #851's sentence, with the >>> hint appended",
		headingTyped.json?.ok === false &&
			headingTyped.json.error?.code === "element_not_found" &&
			headingTyped.json.error?.message?.startsWith(
				"h1 is not an editable field (no value setter, not contenteditable), so nothing was typed; if the field lives inside an iframe, it cannot be targeted from the top document",
			) &&
			/>>>/.test(headingTyped.json.error?.message ?? ""),
		`type {selector: "h1"} -> ${headingTyped.text}`,
	);

	// --- 5c-ii. type into a field that reverts the write (#871) ----------------
	/*
	 * `type`'s value-setter fallback used to report the setter's own echo, so a
	 * field that took the write and gave it back one tick later was still answered
	 * "Value is now ...". The fix reads the field back again, independently, in the
	 * node's own session, and refuses when it does not hold the text. Every claim
	 * below is read back from the page's or frame's OWN target over the devtools
	 * port, never from the host's reply, which is the code under test.
	 *
	 * Placed before the DENY block below because that deny persists for the frame's
	 * origin and would refuse the cross-site cases here for the wrong reason.
	 */
	const revertTab = await rpcOk(state, "open", {
		url: `${siteOrigin}/revert-type`,
		requester: "session:proof",
	});
	let revertFrame = null;
	for (let attempt = 0; attempt < 40 && !revertFrame; attempt += 1) {
		revertFrame = (await frameTargets("/revert-frame"))[0] ?? null;
		if (!revertFrame) await sleep(250);
	}
	const revertPage = await waitForTarget(
		(target) => target.url === `${siteOrigin}/revert-type`,
		"the reverting-field proof page's target",
	);
	check(
		"the reverting field's frame loaded cross-site, in its own frame target",
		revertFrame !== null,
		revertFrame
			? `iframe target ${revertFrame.url} (page ${siteOrigin}/revert-type)`
			: `no iframe target for ${frameOrigin}/revert-frame`,
	);
	const fieldValue = async (target, id) => {
		if (!target) return "(no target)";
		const read = await targetEvaluate(
			target,
			`document.getElementById(${JSON.stringify(id)}).value`,
		);
		return read.value ?? read.error;
	};
	const REVERT_TEXT = "4000056655665556";
	const refusedAsNotHolding = (typed) =>
		typed.json?.ok === false &&
		DOES_NOT_HOLD_TEXT.test(typed.json.error?.message ?? "") &&
		NOTHING_REPORTED_TYPED.test(typed.json.error?.message ?? "");

	// The page has to be able to revert at all, or every refusal below is vacuous:
	// a setter write on the reverting field reads back the text for the instant
	// before the page restores it, and empty afterwards.
	const revertProbe = await targetEvaluate(
		revertPage,
		`new Promise((resolve) => {
			const field = document.getElementById("top-revert");
			field.value = "x";
			field.dispatchEvent(new Event("input", { bubbles: true }));
			const instant = field.value;
			setTimeout(() => resolve(JSON.stringify({ instant, later: field.value })), 50);
		})`,
	);
	check(
		"precondition: the fixture field takes a setter write and reverts it a tick later",
		revertProbe.value === JSON.stringify({ instant: "x", later: "" }),
		`top-revert, set + input event, read at once and 50 ms later -> ${revertProbe.value ?? revertProbe.error}`,
	);

	const topRevert = await rpc(state, "type", {
		tab: revertTab.tab,
		selector: "#top-revert",
		text: REVERT_TEXT,
	});
	const topRevertField = await fieldValue(revertPage, "top-revert");
	check(
		"type at a top-document field that reverts the write is REFUSED, and the field reads back empty",
		refusedAsNotHolding(topRevert) && topRevertField === "",
		`type {selector: "#top-revert"} -> ${topRevert.text}\ntop document #top-revert (read over devtools) -> ${JSON.stringify(topRevertField)}`,
	);
	const frameRevert = await rpc(state, "type", {
		tab: revertTab.tab,
		selector: "iframe#rv >>> #frame-revert",
		text: REVERT_TEXT,
	});
	const frameRevertField = await fieldValue(revertFrame, "frame-revert");
	check(
		"type at a cross-site frame field that reverts the write is REFUSED, and the field reads back empty from the frame's own target",
		refusedAsNotHolding(frameRevert) && frameRevertField === "",
		`type {selector: "iframe#rv >>> #frame-revert"} -> ${frameRevert.text}\nframe target #frame-revert (read over devtools) -> ${JSON.stringify(frameRevertField)}`,
	);
	// By the iframe ELEMENT: the descent picks the frame's field, and its setter
	// fallback is verified inside the frame too. This frame holds three fields, so
	// the host asks which one is meant - a refusal that types nothing - and the
	// field stays empty either way.
	const frameElementRevert = await rpc(state, "type", {
		tab: revertTab.tab,
		selector: "#rv",
		text: REVERT_TEXT,
	});
	check(
		"type aimed at the multi-field iframe ELEMENT types nothing, and the reverting field stays empty",
		frameElementRevert.json?.ok === false &&
			(await fieldValue(revertFrame, "frame-revert")) === "" &&
			(await fieldValue(revertFrame, "frame-setter-only")) === "" &&
			(await fieldValue(revertFrame, "frame-keep")) === "",
		`type {selector: "#rv"} -> ${frameElementRevert.text}`,
	);

	// Controls: the same fallback must still LAND where the field keeps the write,
	// and the primary path must still land on an ordinary field. A fix that refused
	// everything would pass the checks above.
	const topSetter = await rpc(state, "type", {
		tab: revertTab.tab,
		selector: "#top-setter-only",
		text: REVERT_TEXT,
	});
	const topSetterField = await fieldValue(revertPage, "top-setter-only");
	check(
		"the control: a top-document field that refuses insertText but keeps a setter write lands via value_setter",
		topSetter.json?.ok === true &&
			topSetter.json.result?.via === "value_setter" &&
			topSetter.json.result?.value === REVERT_TEXT &&
			topSetterField === REVERT_TEXT,
		`type {selector: "#top-setter-only"} -> ${topSetter.text}\ntop document #top-setter-only (read over devtools) -> ${JSON.stringify(topSetterField)}`,
	);
	const frameSetter = await rpc(state, "type", {
		tab: revertTab.tab,
		selector: "iframe#rv >>> #frame-setter-only",
		text: REVERT_TEXT,
	});
	const frameSetterField = await fieldValue(revertFrame, "frame-setter-only");
	check(
		"the control: a cross-site frame field that keeps a setter write lands via value_setter, read back from the frame's own target",
		frameSetter.json?.ok === true &&
			frameSetter.json.result?.via === "value_setter" &&
			frameSetter.json.result?.frame_origin === frameOrigin &&
			frameSetterField === REVERT_TEXT,
		`type {selector: "iframe#rv >>> #frame-setter-only"} -> ${frameSetter.text}\nframe target #frame-setter-only (read over devtools) -> ${JSON.stringify(frameSetterField)}`,
	);
	const topKeep = await rpc(state, "type", {
		tab: revertTab.tab,
		selector: "#top-keep",
		text: REVERT_TEXT,
	});
	check(
		"the control: an ordinary field on the same page still lands via insert_text",
		topKeep.json?.ok === true &&
			topKeep.json.result?.via === "insert_text" &&
			(await fieldValue(revertPage, "top-keep")) === REVERT_TEXT,
		`type {selector: "#top-keep"} -> ${topKeep.text}`,
	);
	await rpcOk(state, "close", { tab: revertTab.tab });

	// A frame from an origin the user DENIED (review round 1, M1): approval stays
	// per top-level origin, but an explicit deny overrides it everywhere else, so a
	// denied origin must not become drivable or readable by being embedded. Denied
	// through the app's own consent path, then every route into the frame refused,
	// and the frame's field read back EMPTY from its own target. Last in the
	// section: the deny persists for the rest of the run.
	const denyRequest = await rpcOk(state, "request_access", {
		url: frameOrigin,
		requester: "session:proof",
	});
	const denyPending = await rendererEvaluate(
		"window.api.browser.state().then((s) => JSON.stringify(s.pendingConsent))",
	);
	const denyEntry = JSON.parse(denyPending.value ?? "[]").find(
		(candidate) => candidate.origin === frameOrigin,
	);
	if (denyEntry) {
		await rendererEvaluate(
			`window.api.browser.respondToConsent(${JSON.stringify(denyEntry.entryId)}, "deny").then((s) => JSON.stringify(s))`,
		);
	}
	const deniedAwait = await rpcOk(state, "await_access", {
		url: frameOrigin,
		requester: "session:proof",
	});
	check(
		"precondition: the frame origin is DENIED through the consent path",
		deniedAwait.state === "denied",
		`request_access -> ${denyRequest.state}; await_access -> ${JSON.stringify(deniedAwait)}`,
	);
	const deniedTab = await rpcOk(state, "open", {
		url: `${siteOrigin}/iframe-type`,
		requester: "session:proof",
	});
	let deniedFrame = null;
	for (let attempt = 0; attempt < 40 && !deniedFrame; attempt += 1) {
		const pageNow = (await targets()).find(
			(target) =>
				target.type === "page" && target.url === `${siteOrigin}/iframe-type`,
		);
		deniedFrame = pageNow ? ((await frameTargets())[0] ?? null) : null;
		if (!deniedFrame) await sleep(250);
	}
	const deniedRoutes = {};
	for (const [label, params] of [
		["hop", { selector: "iframe#card >>> #number" }],
		["element", { selector: "#card" }],
		["auto", { selector: "#number" }],
	]) {
		deniedRoutes[label] = await rpc(state, "type", {
			tab: deniedTab.tab,
			...params,
			text: "4111111111111111",
		});
	}
	const deniedSnap = await rpcOk(state, "snapshot", { tab: deniedTab.tab });
	const deniedField = deniedFrame
		? await targetEvaluate(
				deniedFrame,
				"document.getElementById('number').value",
			)
		: { error: "no frame target" };
	check(
		"a frame from a DENIED origin is refused on every route, absent from snapshot, and its field stays empty",
		deniedRoutes.hop.json?.error?.code === "origin_not_allowed" &&
			deniedRoutes.hop.json.error?.data?.reason === "denied" &&
			deniedRoutes.element.json?.error?.code === "origin_not_allowed" &&
			deniedRoutes.auto.json?.ok === false &&
			!deniedSnap.snapshot.includes("- frame") &&
			deniedField.value === "",
		`hop -> ${deniedRoutes.hop.text}\nelement -> ${deniedRoutes.element.text}\nauto -> ${deniedRoutes.auto.text}\nsnapshot ->\n${deniedSnap.snapshot}\nframe target #number (read over devtools) -> ${JSON.stringify(deniedField.value ?? deniedField.error)}`,
	);
	await rpcOk(state, "close", { tab: deniedTab.tab });
	await rpcOk(state, "close", { tab: plainTab.tab });

	// --- 5d. the hidden view's page viewport, and what a capture does to it ----
	/*
	 * A tab an agent OPENED is never presented (design 11.4: an agent's `open`
	 * must not switch the tab the user is looking at), so every agent tab is a
	 * `setVisible(false)` WebContentsView laid out at BACKGROUND_VIEWPORT — and a
	 * hidden view's renderer used to report a 0x0 viewport for it, which collapses
	 * every popper that measures itself against the viewport, and every capture used
	 * to resize the renderer to the clip box and fire a page `resize`, which closes
	 * `radix-ui/react-select` popups outright. Both are invisible to a text read:
	 * the page looked normal while its popups could not paint and an agent's own
	 * screenshot dismissed the popup it was about to read. Measured 2026-10-01 on
	 * the live alert-suppression page (`ui:43`/`ui:45`).
	 *
	 * The fixture reports both properties itself; see `HIDDEN_VIEWPORT_PAGE`.
	 */
	const hiddenTab = await rpcOk(state, "open", {
		url: `${siteOrigin}/hidden-viewport`,
		requester: "session:proof",
	});
	const hiddenMetrics = async () => {
		const text = String(await readSelector(state, hiddenTab.tab, "#metrics"));
		const number = (pattern) => Number(pattern.exec(text)?.[1] ?? -1);
		return {
			text,
			width: number(/innerWidth=(-?\d+)/),
			height: number(/innerHeight=(-?\d+)/),
			docElWidth: number(/docEl=(-?\d+)x/),
			viewportWidth: number(/vv=(-?\d+)x/),
			resize: number(/resize=(-?\d+)/),
			dpr: number(/dpr=(-?\d+)/),
			lastResizeSize: /lastResizeSize=(\S+)/.exec(text)?.[1] ?? "",
			open: /open=(true|false)/.exec(text)?.[1] === "true",
		};
	};
	const freshMetrics = await hiddenMetrics();
	check(
		"an unpresented tab reports a non-zero page viewport",
		freshMetrics.width > 0 &&
			freshMetrics.height > 0 &&
			freshMetrics.docElWidth > 0 &&
			freshMetrics.viewportWidth > 0,
		`${freshMetrics.text}`,
	);
	// The half that motivated re-measuring on the merged base: the original finding
	// was that the metrics reset to 0x0 after EVERY navigation while hidden, so the
	// property has to hold after one rather than only on a fresh tab.
	await rpcOk(state, "goto", {
		tab: hiddenTab.tab,
		url: `${siteOrigin}/hidden-viewport`,
		requester: "session:proof",
	});
	const navigatedMetrics = await hiddenMetrics();
	check(
		"the viewport survives a navigation while the tab stays hidden",
		navigatedMetrics.width > 0 && navigatedMetrics.docElWidth > 0,
		`${navigatedMetrics.text}`,
	);
	// The target list is recorded because the ladder below needs a CDP session on the
	// driven view's OWN target, and whether a `WebContentsView` appears on the app's
	// debugging port is a fact rather than an assumption.
	record(
		"page targets on the app's debugging port (raw)",
		pageTargetUrls(await targets()).join("\n"),
	);

	// A capture must not move a page-visible counter. The counter is the fixture's own
	// `resize` listener, which is what closes a Radix popup.
	await clickControl(state, hiddenTab.tab, "reset counters");
	const beforeCapture = await hiddenMetrics();
	const captureShot = await rpcOk(state, "screenshot", { tab: hiddenTab.tab });
	const afterCapture = await hiddenMetrics();
	const captureFrame = join(OUT_DIR, "hidden-view-capture.png");
	writeFileSync(captureFrame, Buffer.from(captureShot.data, "base64"));
	check(
		"a capture does not resize the page",
		afterCapture.resize === beforeCapture.resize &&
			afterCapture.width === beforeCapture.width &&
			afterCapture.lastResizeSize === "none",
		`resize ${beforeCapture.resize} -> ${afterCapture.resize}, size ${beforeCapture.width}x${beforeCapture.height}, lastResizeSize=${afterCapture.lastResizeSize}\nbefore: ${beforeCapture.text}\nafter:  ${afterCapture.text}\nframe: ${captureFrame}`,
	);

	// An open popup survives a capture, and its pixels are in the frame. Both halves
	// matter: the popup's own listeners prove the page was not moved, and the pixels
	// prove the frame holds what the popup painted.
	await clickControl(state, hiddenTab.tab, "open popup");
	const openedMetrics = await hiddenMetrics();
	// On a 0x0 viewport the popper's content collapses through the fixture's
	// `--viewport-available-height` binding, which is the shape the live page showed.
	const content = await rpcOk(state, "styles", {
		tab: hiddenTab.tab,
		selector: "#popper-content",
	});
	const contentRect = content.matches?.[0]?.rect;
	check(
		"the popper's content has height on a driven tab",
		openedMetrics.open && (contentRect?.height ?? 0) > 40,
		`open=${openedMetrics.open} content rect=${JSON.stringify(contentRect)}\n${openedMetrics.text}`,
	);
	const popupShot = await rpcOk(state, "screenshot", { tab: hiddenTab.tab });
	const afterPopupShot = await hiddenMetrics();
	const popupFrame = join(OUT_DIR, "hidden-view-popup.png");
	writeFileSync(popupFrame, Buffer.from(popupShot.data, "base64"));
	check(
		"an open popup is still open after a capture",
		afterPopupShot.open,
		`open before=${openedMetrics.open} after=${afterPopupShot.open}\nbefore: ${openedMetrics.text}\nafter:  ${afterPopupShot.text}\nframe: ${popupFrame}`,
	);
	const magenta = await magentaPixels(popupShot.data);
	// The GEOMETRY is gated with the pixels, and the two claims need each other: the
	// capture no longer carries a clip, so "a viewport-sized PNG" is the property that
	// says the composited surface was the view's own box rather than the whole
	// document — and a capture that silently returned 1280x720 css at the WRONG ratio,
	// or 1280x3778, would pass on the pixel count alone. 1280x720 is
	// `BACKGROUND_VIEWPORT`; the ratio is read from the page rather than assumed from
	// this host.
	const expectedWidth = 1280 * navigatedMetrics.dpr;
	const expectedHeight = 720 * navigatedMetrics.dpr;
	check(
		"the popup's own pixels are in the capture",
		(magenta.magenta ?? 0) > 1_000 &&
			magenta.width === expectedWidth &&
			magenta.height === expectedHeight,
		`frame ${popupFrame}: ${JSON.stringify(magenta)} — expected the 1280x720 view at dpr ${navigatedMetrics.dpr} = ${expectedWidth}x${expectedHeight} (the fixture's #sentinel is 120x40 css)`,
	);

	if (process.argv.includes("--capture-ladder")) {
		await measureCaptureLadder(
			state,
			hiddenTab.tab,
			`${siteOrigin}/hidden-viewport`,
		);
	}
	await rpcOk(state, "close", { tab: hiddenTab.tab });
	// --- 6. a navigation, and the epoch it invalidates ----------------------
	const staleClick = await rpc(state, "click", { tab: handle, ref: goRef });
	const navigated = await rpcOk(state, "goto", {
		tab: handle,
		url: `${siteOrigin}/page2`,
		requester: "session:proof",
	});
	const afterNav = await rpc(state, "click", { tab: handle, ref: goRef });
	check(
		"a goto re-reports the page that arrived, and a pre-navigation ref is refused",
		navigated.url === `${siteOrigin}/page2` &&
			afterNav.json?.error?.code === "element_not_found",
		`goto -> ${JSON.stringify(navigated)}\nclick with the pre-navigation ref -> ${afterNav.text}`,
	);
	check(
		"the ref was valid before the navigation",
		staleClick.json?.ok === true,
		`same ref before the navigation -> ${staleClick.text.slice(0, 200)}`,
	);

	// --- 6b. a page that never answers: the typed timeout, inside the budget ---
	//
	// The published budget is `COMMAND_TIMEOUTS_S.goto` = 30 s, and the session
	// client gives up at that plus its own 5 s slack. The settle's ceiling is the
	// budget, so the typed code has to arrive inside it — which is exactly what
	// did NOT happen while `loadURL` was awaited first under a 35 s deadline.
	const hungStarted = Date.now();
	const hung = await rpc(state, "goto", {
		tab: handle,
		url: `${siteOrigin}/slow`,
		requester: "session:proof",
	});
	const hungElapsed = Date.now() - hungStarted;
	check(
		"a hung navigation ends as the typed nav_timeout, inside the published budget",
		hung.json?.ok === false &&
			hung.json?.error?.code === "nav_timeout" &&
			hungElapsed < 35_000,
		`goto ${siteOrigin}/slow -> ${hung.text}\nelapsed ${hungElapsed}ms against the 30 s budget (the client's deadline is 35 s)`,
	);

	// The lane must be free again and the tab usable: a timed-out navigation that
	// left the tab wedged for the rest of its life would be a worse bug than the
	// untyped timeout it replaced.
	const afterHung = await rpc(state, "goto", {
		tab: handle,
		url: `${siteOrigin}/page2`,
		requester: "session:proof",
	});
	check(
		"the tab is usable again after a timed-out navigation",
		afterHung.json?.ok === true &&
			afterHung.json.result.url === `${siteOrigin}/page2`,
		`goto ${siteOrigin}/page2 after the timeout -> ${afterHung.text}`,
	);

	// --- 7. the renderer cannot reach the RPC --------------------------------
	const rendererReach = await rendererEvaluate(
		`(async () => {
			try {
				const response = await fetch("http://127.0.0.1:${state.port}/rpc", {
					method: "POST",
					headers: { "Content-Type": "application/json", "X-Bridge-Key": "whatever" },
					body: JSON.stringify({ id: "x", method: "status", params: {} })
				});
				const body = await response.text();
				return "REACHED IT: " + response.status + " " + body.slice(0, 80);
			} catch (error) {
				return "blocked: " + String(error);
			}
		})()`,
		{ collectLogs: true },
	);
	check(
		"the app's own renderer cannot use the agent's RPC",
		String(rendererReach.value).startsWith("blocked:"),
		`from the renderer: ${rendererReach.value ?? rendererReach.error}\nchromium's own reason: ${
			(rendererReach.logged ?? [])
				.filter((line) => /CORS|blocked|fetch|Access-Control/i.test(line))
				.slice(-3)
				.join(" | ") || "(no console line captured)"
		}`,
	);
	const rendererNoCors = await rendererEvaluate(
		`(async () => {
			try {
				const response = await fetch("http://127.0.0.1:${state.port}/rpc", {
					method: "POST", mode: "no-cors",
					headers: { "Content-Type": "text/plain" },
					body: "{}"
				});
				return "status " + response.status + ", type " + response.type + ", readable: " + JSON.stringify(await response.text());
			} catch (error) {
				return "blocked: " + String(error);
			}
		})()`,
		{ collectLogs: true },
	);
	check(
		"a no-cors attempt yields nothing readable either",
		typeof rendererNoCors.value === "string" &&
			(rendererNoCors.value.startsWith("blocked:") ||
				(rendererNoCors.value.includes("type opaque") &&
					rendererNoCors.value.includes('readable: ""'))),
		`from the renderer: ${rendererNoCors.value ?? rendererNoCors.error}\nchromium's own reason: ${
			(rendererNoCors.logged ?? [])
				.filter((line) =>
					/CORS|blocked|fetch|Access-Control|private/i.test(line),
				)
				.slice(-3)
				.join(" | ") || "(no console line captured)"
		}`,
	);

	// --- 8. where the jar lives, and what is in it ---------------------------
	const profileDir = statusCall.json.result.profile_dir;
	// Compared against the REAL path: on macOS Electron's `getStoragePath()` returns
	// `/private/var/...` where the scratch dir was created as `/var/...`, and a
	// string prefix check would fail for a correct answer.
	const realUserData = realpathSync(USER_DATA);
	check(
		"the host publishes the resolved storage path of the persistent partition",
		typeof profileDir === "string" &&
			profileDir.startsWith(realUserData) &&
			profileDir.includes("Partitions"),
		`profile_dir=${profileDir} (persistent=${statusCall.json.result.profile_persistent}, user_agent=${statusCall.json.result.user_agent})`,
	);
	// The cookie store is read with a tool that is not this app, AFTER the app has
	// quit (see the restart step below): Chromium keeps cookies in memory and writes
	// them lazily, so a read against a running app reports an empty table and would
	// have "measured" the wrong thing.
	await rpcOk(state, "open", {
		url: `${siteOrigin}/set`,
		requester: "session:proof",
	});
	const echoBefore = await rpcOk(state, "goto", {
		tab: handle,
		url: `${siteOrigin}/echo`,
		requester: "session:proof",
	});
	const echoBeforeRead = await rpcOk(state, "read", { tab: handle });
	record("cookies the jar sent before restart", echoBeforeRead.text);
	say(`before restart, /echo received: ${echoBeforeRead.text.trim()}`);

	// --- 9. restart: what survives -------------------------------------------
	const logPath = app.logPath;
	await stopApp();
	const logBefore = readFileSync(logPath, "utf8");
	// Chromium's own cookie store, read now that the app has written and released it.
	const cookieDb = join(profileDir, "Cookies");
	const cookieQuery = await run("/usr/bin/sqlite3", [
		cookieDb,
		"select host_key,name,is_persistent,has_expires from cookies order by name;",
	]);
	const cookieRows = cookieQuery.stdout.trim();
	check(
		"the persistent cookie is in Chromium's own store, with the flags to match",
		cookieRows
			.split("\n")
			.some((row) => row.includes("persistent") && row.includes("|1|1")),
		`sqlite3 ${cookieDb} "select host_key,name,is_persistent,has_expires from cookies order by name"\n${cookieRows || "(no rows)"}\nstderr: ${cookieQuery.stderr.trim() || "(none)"}`,
	);
	record(
		"what the cookie store held after a clean quit",
		cookieRows ||
			"(no rows: Chromium had not written any cookie to disk, which is itself the measurement)",
	);
	await sleep(1500);
	app = await launchApp();
	state = await waitForState();
	say(`restarted: new port ${state.port}, same profile ${state.profile_dir}`);
	const persistedApproval = await rpcOk(state, "open", {
		url: `${siteOrigin}/echo`,
		requester: "session:proof",
	});
	const echoAfter = await rpcOk(state, "read", { tab: persistedApproval.tab });
	check(
		"an approved origin stays approved across a restart (the grant is durable)",
		typeof persistedApproval.tab === "string" &&
			persistedApproval.tab.startsWith("ui:"),
		`open after restart -> ${JSON.stringify({ tab: persistedApproval.tab, url: persistedApproval.url })}`,
	);
	record("cookies the jar sent after restart", echoAfter.text);
	say(`after restart, /echo received: ${echoAfter.text.trim()}`);
	const sessionSurvived = echoAfter.text.includes("session_only=1");
	const persistentSurvived = echoAfter.text.includes("persistent=1");
	check(
		"MEASURED: a persistent cookie survives the restart",
		persistentSurvived,
		`after restart /echo saw: ${echoAfter.text.trim()}`,
	);
	say(
		`[MEASURED] session cookie across a clean restart: ${sessionSurvived ? "SURVIVED" : "DID NOT SURVIVE"} (the design predicted it would not — P2)`,
	);
	record(
		"session-cookie-across-restart (probe P2)",
		`before restart: ${echoBeforeRead.text.trim()}\nafter restart:  ${echoAfter.text.trim()}\nsession cookie survived: ${sessionSurvived}\npersistent cookie survived: ${persistentSurvived}\nnote: this is a clean SIGTERM quit; the design's P2 asks for the SIGKILL case as well.`,
	);

	// --- 9b. clearing browsing data, and what it does NOT touch --------------
	const cleared = await rendererEvaluate(
		'window.api.browser.clearData("cookies").then((s) => JSON.stringify(s))',
	);
	await sleep(1000);
	const afterClear = await rpcOk(state, "goto", {
		tab: persistedApproval.tab,
		url: `${siteOrigin}/echo`,
		requester: "session:proof",
	});
	const afterClearRead = await rpcOk(state, "read", {
		tab: persistedApproval.tab,
	});
	const afterClearStatus = await rpcOk(state, "status", {});
	check(
		"clearing cookies empties the jar over the app's own IPC",
		cleared.value?.includes("cookies") === true &&
			afterClearRead.text.includes("(none)"),
		`window.api.browser.clearData("cookies") -> ${cleared.value ?? cleared.error}\nafter clearing, /echo saw: ${afterClearRead.text.trim()}`,
	);
	check(
		"clearing cookies does NOT revoke the agent's approvals (they are policy, not data)",
		afterClearStatus.approvals.allowed_origins >= 1 ||
			afterClearStatus.approvals.broad_grants >= 1,
		`status.approvals after the clear: ${JSON.stringify(afterClearStatus.approvals)}`,
	);
	void afterClear;

	// --- 10. the host's own log ---------------------------------------------
	const finalLogPath = app.logPath;
	await stopApp();
	const logAfter = readFileSync(finalLogPath, "utf8");
	/*
	 * TWO READINGS OF ONE STREAM, and the split is load-bearing: the checks about
	 * denials and decisions read `browserLines` (the `[browser]`-tagged lines),
	 * while the presentation checks below read every line — the raise-family
	 * tokens are `[window-raise] …` and can never appear in a `[browser]`-filtered
	 * stream, so a fallback check run against the filtered array would be
	 * vacuously true (review round 1, finding 1). The live rig scans the
	 * unfiltered stream for the same reason.
	 */
	const combinedLines = (logAfter + logBefore).split("\n");
	const browserLines = combinedLines.filter((line) =>
		line.includes("[browser]"),
	);
	check(
		"the host logged its denials and its decisions",
		browserLines.some((line) => line.includes("denied a geolocation")),
		browserLines.slice(0, 40).join("\n"),
	);
	// The popup half of the log, token by token (design 8, 5.1.3): every allow
	// carries the disposition and the effective presentation, every refusal
	// carries its reason, and the about:blank case is visible as itself.
	check(
		"the log carries every popup call: opened lines with presentation=never, the blank case, the scheme refusal, the grandchild refusal and the cap refusal",
		browserLines.some(
			(line) =>
				line.includes("opened a popup:") &&
				line.includes("which=direct") &&
				line.includes("presentation=never"),
		) &&
			browserLines.some((line) =>
				line.includes("opened a popup: about:blank"),
			) &&
			browserLines.some(
				(line) =>
					line.includes("refused a popup from a driven page: mailto:") &&
					line.includes("(scheme)"),
			) &&
			browserLines.some((line) =>
				line.includes("refused a popup from a popup"),
			) &&
			browserLines.some(
				(line) =>
					line.includes("refused a popup from a driven page:") &&
					line.includes("which=cap2") &&
					line.includes("(cap)"),
			),
		browserLines.filter((line) => line.includes("popup")).join("\n"),
	);
	// The `never` plan's fallback is the one line a hidden window would leave
	// behind if `show:false` had not been honoured — the falsifier the design
	// names, asserted absent rather than assumed.
	check(
		"no presentation fallback fired: no popup under the never plan ever read visible",
		!combinedLines.some((line) => line.includes("fallback=fired")) &&
			!combinedLines.some((line) => line.includes("[window-raise]")),
		combinedLines
			.filter(
				(line) => line.includes("fallback") || line.includes("window-raise"),
			)
			.join("\n") || "(no fallback= or [window-raise] lines at all)",
	);
	// The second reading for "no window appeared" (design 2.6): the OS's own
	// answer, sampled from outside, by pid — the app was frontmost in none of the
	// samples below, which is what a fired `show()` would have contradicted.
	frontmostSampler?.stop();
	{
		const samples = frontmostSampler?.samples ?? [];
		const appFrontmost = samples.filter((sample) =>
			appPids.some((pid) => sample.endsWith(`|${pid}`)),
		).length;
		if (samples.length === 0) {
			skips += 1;
			say(
				"[SKIPPED] the app-not-frontmost reading: the OS never answered a sample in this run",
			);
			record(
				"app-not-frontmost sampling",
				"SKIPPED: the OS never answered a frontmost sample in this run",
			);
		} else {
			check(
				"the app was never frontmost (sampled from outside, by pid)",
				appFrontmost === 0,
				`${samples.length} sample(s), app frontmost in ${appFrontmost}: ${JSON.stringify(samples.slice(-6))}`,
			);
		}
	}
	record(
		"app log lines from the browser host",
		browserLines.slice(0, 60).join("\n"),
	);

	const summary = [
		"# Browser host end-to-end proof",
		"",
		`Scratch: \`${SCRATCH}\``,
		"Runs: two (a clean quit, then a restart against the same profile)",
		`Result: ${failures === 0 ? "every check passed" : `${failures} check(s) FAILED`}${skips ? ` (${skips} skipped)` : ""}`,
		"",
		transcript.join("\n"),
	].join("\n");
	writeFileSync(join(OUT_DIR, "proof.md"), summary);
	say(`\ntranscript: ${join(OUT_DIR, "proof.md")}`);
	say(`screenshots: ${OUT_DIR}`);
	if (failures > 0) process.exitCode = 1;
	for (const response of held) response.destroy();
	await site.server.close();
	await frameSite.server.close();
}

function run(command, args) {
	return new Promise((resolve) => {
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		child.on("close", (code) => resolve({ code, stdout, stderr }));
	});
}

main()
	.catch(async (error) => {
		console.error("proof run failed:", error);
		writeFileSync(
			join(OUT_DIR, "proof.md"),
			`# Browser host end-to-end proof\n\nFAILED: ${error?.stack ?? error}\n\n${transcript.join("\n")}`,
		);
		process.exitCode = 1;
	})
	.finally(async () => {
		// A failed run must not leave an app behind holding the scraping port and a
		// state file — the leftover is what made the previous failure so confusing.
		// The sampler's in-flight `osascript` is reaped here too, so a slow OS answer
		// cannot hold this process open past its own end.
		frontmostSampler?.stop();
		await stopApp();
	});
