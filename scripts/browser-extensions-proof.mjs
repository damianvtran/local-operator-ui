#!/usr/bin/env node
/**
 * Native proof for the unpacked-extension manager.
 *
 * Why this exists: `scripts/browser-extensions.test.mjs` drives the manager's
 * RULES against a mocked runtime — no Chromium ever loads anything — and the
 * claim this feature makes is about a real Electron session. "A manifest is
 * inspected, an approval is asked for, and the extension is then really loaded"
 * is a statement about `session.extensions.loadExtension`, Chromium's own
 * path-derived extension ID, and a service worker that actually runs. This is
 * the run that can falsify it, and it prints what came back.
 *
 * It is committed rather than pasted into a PR because a transcript that cannot
 * be re-run is a claim, not evidence.
 *
 * WHAT IT DRIVES, and at which layer:
 *   - the SHIPPED main-process modules — `src/main/browser/extension-ui.ts`
 *     (the factory the browser host builds) and the manager it constructs — are
 *     bundled from this tree and required by a real Electron main process. The
 *     registry, the approval gate, the popup window and the unload path are the
 *     product's own code, not a re-implementation.
 *   - the two NATIVE DIALOGS are stubbed, because the alternative is a modal
 *     panel on the operator's screen. The stub records every call with its
 *     title, its message and the manifest detail it was shown, so the approval
 *     text is inspected here rather than assumed.
 *   - the browser session is the product's own partition name, resolved from
 *     `profile.ts`, so the extension lives in the same jar a browser tab uses.
 *     It is isolated by `--user-data-dir`, not by a different partition.
 *
 * Isolation (non-negotiable, and why each piece is here):
 *   - `HOME` AND `LOCAL_OPERATOR_CONFIG_DIR` are both redirected: the config dir
 *     alone leaves the cache and hardcoded home roots in the real home.
 *   - the Electron profile root is a scratch `--user-data-dir`, so the run
 *     cannot see or touch the operator's real profile and cannot leak into it.
 *   - every `CMUX_*`/`LOP_*` variable is removed from the child environment: an
 *     inherited cmux workspace id has already renamed the operator's real
 *     workspaces once.
 *   - no window is ever shown. Each phase asserts it at exit
 *     (`windowsNeverShown`), because the one thing an agent run must not do
 *     here is take the operator's focus.
 *
 * Usage: node scripts/browser-extensions-proof.mjs [--keep]
 */

import { spawn } from "node:child_process";
import {
	mkdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEEP = process.argv.includes("--keep");
const SCRATCH = join(tmpdir(), `lo-browser-extensions-proof-${process.pid}`);
const HOME_DIR = join(SCRATCH, "home");
const CONFIG_DIR = join(SCRATCH, "config");
const USER_DATA = join(SCRATCH, "userdata");
const HARNESS_DIR = join(SCRATCH, "harness");
const PACK_DIR = join(SCRATCH, "pack");
const REGISTRY_DIR = join(SCRATCH, "registry");
const OUT_DIR = join(SCRATCH, "out");
/** Where the transcript lands. Deliberately OUTSIDE the scratch tree: the run
 * deletes that tree on the way out, and the transcript is the artifact a
 * reviewer reads. */
const REPORT = join(tmpdir(), `lo-browser-extensions-proof-report-${process.pid}.md`);
const ELECTRON = join(ROOT, "node_modules", ".bin", "electron");

const transcript = [];
let failures = 0;

function record(label, body) {
	transcript.push(`### ${label}\n\n\`\`\`\n${body}\n\`\`\`\n`);
}

function say(line) {
	console.log(line);
}

function check(label, ok, detail) {
	const status = ok ? "PASS" : "FAIL";
	if (!ok) failures += 1;
	say(`[${status}] ${label}${detail === undefined ? "" : `\n        ${detail}`}`);
	record(label, `[${status}] ${detail === undefined ? "" : detail}`);
	return ok;
}

/** A measurement reported without a verdict, for a capability whose honest
 * answer is a number rather than pass/fail — a scheduled alarm that was never
 * delivered, an API that exists but cannot reach a host. Recorded in the
 * transcript so the compatibility matrix cites the run rather than the prose. */
function note(label, detail) {
	say(`[MEASURED] ${label}${detail === undefined ? "" : `\n        ${detail}`}`);
	record(label, `[MEASURED] ${detail === undefined ? "" : detail}`);
}

// ---- the fixture extensions -------------------------------------------------

/** The main fixture: the MV3 shape the capability matrix is about — a service
 * worker, alarms, storage, a content script and a default popup. Small on
 * purpose: every part of it is a thing being measured, not scenery. */
const POPUP_MANIFEST = {
	manifest_version: 3,
	name: "Proof Extension",
	version: "1.0",
	description: "Local-operator extension proof fixture",
	permissions: ["storage", "alarms"],
	host_permissions: ["http://127.0.0.1/*"],
	background: { service_worker: "sw.js" },
	content_scripts: [{ matches: ["http://127.0.0.1/*"], js: ["content.js"] }],
	action: { default_popup: "popup.html" },
};

const SERVICE_WORKER = [
	"// The realistic MV3 shape: the worker writes on boot and an alarm wakes it.",
	"chrome.storage.local.set({ workerBootedAt: Date.now() });",
	"chrome.alarms.create('proof-alarm', { delayInMinutes: 0.5 });",
	"chrome.alarms.onAlarm.addListener((alarm) => {",
	"  chrome.storage.local.set({ alarmFired: alarm.name + '@' + Date.now() });",
	"});",
	"chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {",
	"  if (message === 'who') sendResponse({ from: 'service-worker' });",
	"  return true;",
	"});",
].join("\n");

const CONTENT_SCRIPT = [
	"// Content scripts run in an isolated world, so the page cannot see this",
	"// variable — the DOM (shared) and chrome.storage are the observables.",
	"document.documentElement.dataset.proofContentScript = 'ran';",
	"chrome.storage.local.set({ contentScriptRan: location.href });",
].join("\n");

const POPUP_PAGE = [
	"<!doctype html><html><head><meta charset=\"utf-8\"><title>Proof popup</title></head>",
	"<body style=\"margin:0;font:14px -apple-system,system-ui,sans-serif;padding:16px\">",
	"<h1 id=\"title\" style=\"margin:0 0 8px;font-size:18px\">Proof extension</h1>",
	"<p id=\"summary\">loading</p>",
	"<script src=\"popup.js\"></script></body></html>",
].join("\n");

const POPUP_SCRIPT = [
	"const out = document.getElementById('summary');",
	"chrome.storage.local.get(null).then((values) => {",
	"  out.textContent = 'worker=' + (values.workerBootedAt ? 'ran' : 'absent') +",
	"    ' alarm=' + (values.alarmFired ? 'fired' : 'none');",
	"});",
].join("\n");

const BAD_MANIFEST = JSON.stringify(
	{
		manifest_version: 9,
		name: "Proof Bad Manifest",
		version: "1.0",
		action: { default_popup: "https://example.com/" },
	},
	null,
	2,
);

function writeExtension(name, files) {
	const dir = join(PACK_DIR, name);
	mkdirSync(dir, { recursive: true });
	for (const [file, body] of Object.entries(files))
		writeFileSync(join(dir, file), body);
	return dir;
}

function writeFixtures() {
	mkdirSync(PACK_DIR, { recursive: true });
	writeExtension("popup-mv3", {
		"manifest.json": JSON.stringify(POPUP_MANIFEST, null, 2),
		"sw.js": SERVICE_WORKER,
		"content.js": CONTENT_SCRIPT,
		"popup.html": POPUP_PAGE,
		"popup.js": POPUP_SCRIPT,
	});
	// Loads, but declares the permission whose API Electron does not implement.
	// Whether the MANIFEST is refused and whether the API exists are two separate
	// measurements, so the extension carries a page that reports the surface.
	writeExtension("native-messaging", {
		"manifest.json": JSON.stringify(
			{
				manifest_version: 3,
				name: "Proof Native Messaging",
				version: "1.0",
				permissions: ["nativeMessaging"],
			},
			null,
			2,
		),
		"probe.html":
			'<!doctype html><html><body><div id="probe">probe</div><script src="probe.js"></script></body></html>',
		"probe.js": "document.getElementById('probe').textContent = 'ready';",
	});
	// An action with no default popup: a warning path, and the one the refusal
	// check installs and then declines.
	writeExtension("action-only", {
		"manifest.json": JSON.stringify(
			{
				manifest_version: 3,
				name: "Proof Action Only",
				version: "1.0",
				action: {},
				permissions: ["storage"],
			},
			null,
			2,
		),
	});
	writeExtension("bad-manifest", { "manifest.json": BAD_MANIFEST });
	// Syntactically invalid, which is a different failure path inside
	// `inspectExtension`: `JSON.parse` throws before the shape check can produce
	// the manager's own message. Recorded rather than asserted — see the report.
	writeExtension("broken-json", {
		"manifest.json": '{ "manifest_version": 3, "name": "Broken", }',
	});
}

// ---- the site the fixture's content script matches --------------------------

let sitePort = 0;

function startSite() {
	return new Promise((resolve) => {
		const server = createServer((request, response) => {
			response.writeHead(200, { "Content-Type": "text/html" });
			response.end(
				'<!doctype html><html><head><meta charset="utf-8"><title>Proof site</title></head>' +
					'<body><h1 id="heading">Proof site</h1><p id="state">not measured</p>' +
					"<script>document.getElementById('state').textContent = 'page script ran';</script>" +
					"</body></html>",
			);
		});
		// A real loopback listener, so the content script's `matches` is a real
		// origin rather than a file:// special case.
		server.listen(0, "127.0.0.1", () => {
			sitePort = server.address().port;
			resolve(server);
		});
	});
}

// ---- the Electron entry -----------------------------------------------------
/*
 * Kept as one inline program rather than a file under `scripts/fixtures`,
 * because it is generated per run (the scratch paths are arguments) and the
 * repository's other proof harnesses are self-contained the same way. It
 * contains no template literals so that it can live inside this one.
 */
const HARNESS_SOURCE = String.raw`
/* No backticks anywhere in this program: it lives inside a template literal
   above, and one in a comment ends the string and the file stops parsing. */
"use strict";
const { app, BrowserWindow, dialog, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const UI = require(path.join(__dirname, "extension-ui.cjs"));

const PHASE = process.env.PROOF_PHASE;
const PACK = process.env.PROOF_PACK;
const REGISTRY_DIR = process.env.PROOF_REGISTRY;
const SITE_URL = process.env.PROOF_SITE_URL;
const SCENARIO = JSON.parse(fs.readFileSync(process.env.PROOF_SCENARIO, "utf8"));

const observations = {};
const observe = (label, value) => { observations[label] = value; };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The two native surfaces are stubbed here so a run cannot put a modal panel on
// the operator's screen. Every call is recorded with the text it was shown, so
// the approval copy is inspected rather than assumed.
const chooserQueue = (SCENARIO.chooser || []).slice();
const confirmQueue = (SCENARIO.confirm || []).slice();
const dialogCalls = [];
const electronModule = require("electron");
electronModule.dialog.showOpenDialog = async (_window, options) => {
  const next = chooserQueue.length ? chooserQueue.shift() : null;
  dialogCalls.push({
    kind: "chooser",
    answer: next,
    title: options && options.title,
    properties: options && options.properties,
  });
  return { canceled: next === null, filePaths: next === null ? [] : [next] };
};
electronModule.dialog.showMessageBox = async (_window, options) => {
  const approved = confirmQueue.length ? Boolean(confirmQueue.shift()) : false;
  dialogCalls.push({
    kind: "confirm",
    approved,
    title: options && options.title,
    message: options && options.message,
    detail: options && options.detail,
    buttons: options && options.buttons,
    defaultId: options && options.defaultId,
  });
  return { response: approved ? 1 : 0, checkboxChecked: false };
};

let browserSession = null;
let manager = null;
let extensionKey = null;
let nativeKey = null;

async function extensionPage(id, page, expression, timeoutMs) {
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 700,
    webPreferences: {
      session: browserSession,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
    },
  });
  try {
    await win.loadURL("chrome-extension://" + id + "/" + page);
    const deadline = Date.now() + (timeoutMs || 5000);
    for (;;) {
      try {
        // A race, not a bare await: an expression that returns a promise which
        // never settles (a message with no listener) would otherwise hold this
        // loop past every deadline and stall the phase.
        const value = await Promise.race([
          win.webContents.executeJavaScript(expression),
          new Promise((resolve) => setTimeout(resolve, 5000)),
        ]);
        if (value !== null && value !== undefined) return value;
      } catch (error) {
        /* a page mid-load has no chrome yet: retry until the deadline */
      }
      if (Date.now() > deadline) return null;
      await wait(200);
    }
  } finally {
    win.destroy();
  }
}

async function apiSurface(id, page) {
  const list = [
    "runtime.connectNative",
    "runtime.sendNativeMessage",
    "runtime.getManifest",
    "runtime.getURL",
    "runtime.sendMessage",
    "runtime.onMessage",
    "runtime.lastError",
    "storage.local",
    "storage.sync",
    "alarms",
    "tabs",
    "action",
    "i18n",
    "scripting",
    "declarativeNetRequest",
    "declarativeNetRequestFeedback",
    "commands",
    "webNavigation",
    "cookies",
    "permissions",
    "notifications",
    "contextMenus",
    "bookmarks",
    "history",
    "downloads",
    "webRequest",
    "identity",
    "offscreen",
  ];
  const expression =
    "JSON.stringify(Object.fromEntries([" + list.map((name) => {
      const parts = name.split(".");
      let accessor = "chrome." + parts[0];
      for (const part of parts.slice(1)) accessor += " && chrome." + parts[0] + "." + part;
      return "['" + name + "', typeof (" + accessor + ")]";
    }).join(", ") + "]))";
  const raw = await extensionPage(id, page, expression, 8000);
  return raw === null ? null : JSON.parse(raw);
}

async function phaseInstall() {
  observe("electron", process.versions.electron);
  observe("chrome", process.versions.chrome);
  observe("partition", UI.BROWSER_PARTITION);
  observe("api.persistent", typeof session.fromPartition(UI.BROWSER_PARTITION).extensions.loadExtension);
  observe("api.defaultSession", typeof session.defaultSession.extensions.loadExtension);
  const memory = session.fromPartition("proof-in-memory-" + Date.now());
  observe("api.inMemory", typeof memory.extensions.loadExtension);
  try {
    await memory.extensions.loadExtension(path.join(PACK, "popup-mv3"), { allowFileAccess: false });
    observe("api.inMemoryLoad", "loaded");
  } catch (error) {
    observe("api.inMemoryLoad", String(error && error.message ? error.message : error));
  }

  browserSession = session.fromPartition(UI.BROWSER_PARTITION);
  const window = new BrowserWindow({ show: false, width: 1000, height: 700 });
  manager = UI.createBrowserExtensionManager({
    window: window,
    session: browserSession,
    dir: REGISTRY_DIR,
    windowShow: "never",
  });

  observe("baseline", manager.list());
  const installed = await manager.install();
  const row = installed.rows[0];
  extensionKey = row && row.key;
  observe("install.row", row);
  observe("install.dialogCalls", dialogCalls.slice());
  observe("install.registryMode", fs.existsSync(manager.filePath)
    ? (fs.statSync(manager.filePath).mode & 0o777).toString(8)
    : null);
  observe("install.dirMode", fs.existsSync(REGISTRY_DIR)
    ? (fs.statSync(REGISTRY_DIR).mode & 0o777).toString(8)
    : null);
  observe("install.sourceIntact", fs.existsSync(path.join(PACK, "popup-mv3", "manifest.json")));
  observe("install.loadedInChromium", !!browserSession.extensions.getExtension(row.id));
  observe("install.allIds", browserSession.extensions.getAllExtensions().map((entry) => entry.id));

  // The service worker from the fixture: proof that MV3 background code runs.
  await wait(2500);
  const stored = await extensionPage(row.id, "popup.html", "chrome.storage.local.get(null).then((v) => JSON.stringify(v))", 10000);
  const values = JSON.parse(stored || "{}");
  observe("worker.booted", typeof values.workerBootedAt === "number");

  // A real page under the browser session, so the content script has a real
  // origin to match and the DOM it writes is the DOM a user would see.
  const page = new BrowserWindow({
    show: false,
    width: 900,
    height: 700,
    webPreferences: {
      session: browserSession,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  await page.loadURL(SITE_URL);
  let contentFlag = null;
  const contentDeadline = Date.now() + 8000;
  while (Date.now() < contentDeadline && !contentFlag) {
    contentFlag = await page.webContents.executeJavaScript(
      "document.documentElement.dataset.proofContentScript || null",
    );
    if (!contentFlag) await wait(250);
  }
  observe("contentScript.domFlag", contentFlag);
  const contentStored = await extensionPage(
    row.id,
    "popup.html",
    "chrome.storage.local.get('contentScriptRan').then((v) => v.contentScriptRan || null)",
    8000,
  );
  observe("contentScript.storage", contentStored);
  page.destroy();

  // Message passing worker <- extension page, the other half of a working MV3
  // worker: a listener that answers is a listener that was registered.
  observe("worker.messageRoundTrip", await extensionPage(
    row.id,
    "popup.html",
    "new Promise((resolve) => { let done = false;" +
      " const finish = (value) => { if (!done) { done = true; resolve(value); } };" +
      " chrome.runtime.sendMessage('who', (reply) => finish(reply ? reply.from : null));" +
      " setTimeout(() => finish(null), 4000); })",
    10000,
  ));

  observe("chromeApis", await apiSurface(row.id, "popup.html"));

  // Alarms: created in the worker, read back from a page, and then waited for
  // with a listener in a page that stays OPEN for the whole window. Both halves
  // are needed: the worker can be suspended before an alarm is due, so a page-
  // side listener tells the scheduler apart from the worker's wake-up path.
  const alarmStarted = Date.now();
  observe("alarms.registered", await extensionPage(
    row.id,
    "popup.html",
    "chrome.alarms.getAll().then((all) => all.map((a) => a.name))",
    8000,
  ));
  observe("alarms.platformDelayMs", await extensionPage(
    row.id,
    "popup.html",
    "chrome.alarms.getAll().then((all) => all.length ? Math.round(all[0].scheduledTime - Date.now()) : null)",
    8000,
  ));
  const scheduledTime = await extensionPage(
    row.id,
    "popup.html",
    "chrome.alarms.getAll().then((all) => all.length ? all[0].scheduledTime : null)",
    8000,
  );
  const watch = new BrowserWindow({
    show: false,
    width: 400,
    height: 300,
    webPreferences: {
      session: browserSession,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  await watch.loadURL("chrome-extension://" + row.id + "/popup.html");
  await watch.webContents.executeJavaScript(
    "window.__proofAlarm = null;" +
      " chrome.alarms.onAlarm.addListener((alarm) => {" +
      " window.__proofAlarm = { name: alarm.name, at: Date.now() }; }); true",
  );
  let pageAlarm = null;
  let workerAlarm = null;
  const alarmDeadline = Date.now() + 75000;
  while (Date.now() < alarmDeadline && !(pageAlarm && workerAlarm)) {
    try {
      pageAlarm =
        pageAlarm ?? (await watch.webContents.executeJavaScript("window.__proofAlarm"));
      workerAlarm =
        workerAlarm ??
        (await watch.webContents.executeJavaScript(
          "chrome.storage.local.get('alarmFired').then((v) => v.alarmFired || null)",
        ));
    } catch (error) {
      /* the page is being torn down: the loop's deadline still bounds the wait */
    }
    if (!(pageAlarm && workerAlarm)) await wait(2000);
  }
  observe("alarms.firedInPage", pageAlarm && pageAlarm.name);
  observe(
    "alarms.firedDeltaVsScheduleMs",
    pageAlarm && scheduledTime ? pageAlarm.at - scheduledTime : null,
  );
  observe("alarms.firedInWorker", workerAlarm);
  observe("alarms.waitedMs", Date.now() - alarmStarted);
  watch.destroy();

  // The product's own popup path: a real hidden window on the extension page.
  await manager.openPopup(extensionKey);
  const popupWindow = BrowserWindow.getAllWindows().find(
    (entry) => entry.webContents.getURL().indexOf("chrome-extension://" + row.id + "/popup.html") === 0,
  );
  observe("appPopup.opened", !!popupWindow);
  if (popupWindow) {
    observe("appPopup.url", popupWindow.webContents.getURL());
    observe("appPopup.sandboxed", popupWindow.webContents.getURL().startsWith("chrome-extension://"));
    observe("appPopup.visible", popupWindow.isVisible());
    observe("appPopup.size", popupWindow.getContentBounds());
    observe("appPopup.bodyText", await popupWindow.webContents.executeJavaScript("document.getElementById('summary').textContent"));
  }

  // What has to survive a restart for the documented login path to be true. The
  // cookie carries an expiry on purpose: a cookie with no expirationDate is a
  // SESSION cookie, which Chromium keeps in memory and never writes to the
  // profile's cookie store — measuring persistence with one would measure the
  // wrong thing and report the shared profile as non-persistent.
  await browserSession.cookies.set({
    url: "http://127.0.0.1/",
    name: "proof-session",
    value: "phase-a",
    expirationDate: Math.floor(Date.now() / 1000) + 3600,
  });
  observe("cookie.set", (await browserSession.cookies.get({ name: "proof-session" })).map((c) => c.value));

  const disabled = await manager.setEnabled(extensionKey, false);
  observe("disable.row", disabled.rows[0]);
  observe("disable.loadedInChromium", !!browserSession.extensions.getExtension(row.id));
  observe("disable.sourceIntact", fs.existsSync(path.join(PACK, "popup-mv3", "manifest.json")));

  const reenabled = await manager.setEnabled(extensionKey, true);
  observe("reenable.row", reenabled.rows[0]);

  // A refused approval: the dialog is answered Cancel, and nothing may load or
  // be written. The chooser points at a different directory so the refusal is
  // the only reason this did not install.
  const refused = await manager.install();
  observe("refusal.state", refused);  observe("refusal.loadedNames", browserSession.extensions.getAllExtensions().map((entry) => entry.name));

  // A manifest Chromium or the inspector must reject.
  let badManifestError = null;
  try {
    await manager.install();
  } catch (error) {
    badManifestError = String(error && error.message ? error.message : error);
  }
  observe("badManifest.error", badManifestError);
  observe("badManifest.rows", manager.list().rows.length);

  // A manifest that is not JSON at all takes a different path inside the
  // inspector: JSON.parse throws before the shape check can produce the
  // manager's own sentence. Recorded so the report can state what a user
  // would actually be shown.
  let brokenJsonError = null;
  try {
    await manager.install();
  } catch (error) {
    brokenJsonError = String(error && error.message ? error.message : error);
  }
  observe("brokenJson.error", brokenJsonError);

  // The permission Electron does not implement: does the MANIFEST load, does the
  // API exist once it has, and what happens when it is actually CALLED? Three
  // separate questions, and the third is the one a 1Password-class extension
  // depends on.
  const native = await manager.install();
  const nativeRow = native.rows[native.rows.length - 1];
  nativeKey = nativeRow && nativeRow.key;
  observe("native.row", nativeRow);
  if (nativeRow && nativeRow.loaded) {
    observe("native.apis", await apiSurface(nativeRow.id, "probe.html"));
    observe("native.connectNativeCall", await extensionPage(
      nativeRow.id,
      "probe.html",
      "new Promise((resolve) => { try {" +
        " const port = chrome.runtime.connectNative('com.proof.absent.host');" +
        " resolve('returned a port object: ' + (port ? typeof port.onDisconnect : 'null'));" +
        " } catch (error) { resolve('threw: ' + error.message); } })",
      10000,
    ));
    observe("native.sendNativeMessageCall", await extensionPage(
      nativeRow.id,
      "probe.html",
      "new Promise((resolve) => { let settled = false;" +
        " const finish = (value) => { if (!settled) { settled = true; resolve(value); } };" +
        " try { chrome.runtime.sendNativeMessage('com.proof.absent.host', { probe: true }, (reply) =>" +
        " finish('callback reply=' + JSON.stringify(reply) + ' lastError=' + (chrome.runtime.lastError ? chrome.runtime.lastError.message : 'none')));" +
        " } catch (error) { finish('threw: ' + error.message); }" +
        " setTimeout(() => finish('no callback within 5s'), 5000); })",
      12000,
    ));
  }
  observe("dialogCalls.all", dialogCalls.slice());
  // Chromium writes its cookie and storage databases asynchronously, so a run
  // that exits immediately after setting them measures its own abrupt exit
  // rather than the profile's persistence. Flush, then leave.
  await browserSession.cookies.flushStore();
  await browserSession.flushStorageData();
  await wait(500);
  observe("windowsNeverShown", BrowserWindow.getAllWindows().filter((entry) => entry.isVisible()).length);
}

async function phaseRestart() {
  browserSession = session.fromPartition(UI.BROWSER_PARTITION);
  const window = new BrowserWindow({ show: false, width: 1000, height: 700 });
  manager = UI.createBrowserExtensionManager({
    window: window,
    session: browserSession,
    dir: REGISTRY_DIR,
    windowShow: "never",
  });
  // The restore path: the same registry, a fresh process, no install call.
  await manager.start();
  const state = manager.list();
  observe("restart.rows", state.rows);
  const byPath = (name) => state.rows.find((entry) => entry.path.endsWith("/" + name));
  const popupRow = byPath("popup-mv3");
  const nativeRow = byPath("native-messaging");
  extensionKey = popupRow && popupRow.key;
  nativeKey = nativeRow && nativeRow.key;
  observe("restart.loadedNames", browserSession.extensions.getAllExtensions().map((entry) => entry.name));

  observe("cookie.survived", (await browserSession.cookies.get({ name: "proof-session" })).map((c) => c.value));

  // Reviewing the changed manifest: decline, then accept.
  const declined = await manager.setEnabled(extensionKey, true);
  observe("restore.declinedRow", declined.rows.find((entry) => entry.key === extensionKey));
  const accepted = await manager.setEnabled(extensionKey, true);
  const acceptedRow = accepted.rows.find((entry) => entry.key === extensionKey);
  observe("restore.acceptedRow", acceptedRow);
  observe("restore.extensionStorage", acceptedRow && acceptedRow.loaded
    ? await extensionPage(acceptedRow.id, "popup.html", "chrome.storage.local.get(null).then((v) => JSON.stringify(v))", 10000)
    : null);

  // The directory that disappeared after approval: re-enabling must not load it,
  // and must say why. The inspection runs before the approval dialog, so this
  // rejects rather than recording a row error - the shape the IPC layer surfaces.
  try {
    const vanished = await manager.setEnabled(nativeKey, true);
    observe("vanished.row", vanished.rows.find((entry) => entry.key === nativeKey));
    observe("vanished.error", null);
  } catch (error) {
    observe("vanished.row", manager.list().rows.find((entry) => entry.key === nativeKey));
    observe("vanished.error", String(error && error.message ? error.message : error));
  }

  const removedPopup = await manager.remove(extensionKey);
  observe("remove.rows", removedPopup.rows);
  const removedNative = await manager.remove(nativeKey);
  observe("remove.rows", removedNative.rows);
  observe("remove.sourceIntact", fs.existsSync(path.join(PACK, "popup-mv3", "manifest.json")));
  observe("remove.loadedAfter", browserSession.extensions.getAllExtensions().map((entry) => entry.name));
  await browserSession.cookies.flushStore();
  await browserSession.flushStorageData();
  await wait(500);
  observe("dialogCalls.all", dialogCalls.slice());
  observe("windowsNeverShown", BrowserWindow.getAllWindows().filter((entry) => entry.isVisible()).length);
}

app.whenReady().then(async () => {
  try {
    if (PHASE === "install") await phaseInstall();
    else if (PHASE === "restart") await phaseRestart();
    else throw new Error("unknown phase " + PHASE);
  } catch (error) {
    observe("fatal", String(error && error.stack ? error.stack : error));
  }
  for (const [label, value] of Object.entries(observations)) {
    console.log("OBS " + label + " " + JSON.stringify(value));
  }
  console.log("PHASE_DONE " + PHASE);
  app.exit(0);
}).catch((error) => {
  console.log("PHASE_FATAL " + String(error && error.stack ? error.stack : error));
  app.exit(1);
});
`;

// ---- running a phase --------------------------------------------------------

function runPhase(phase, scenario, timeoutMs) {
	const scenarioPath = join(HARNESS_DIR, `scenario-${phase}.json`);
	writeFileSync(scenarioPath, JSON.stringify(scenario, null, 2));
	const env = { ...process.env };
	for (const key of Object.keys(env)) {
		if (key.startsWith("CMUX_") || key.startsWith("LOP_")) delete env[key];
	}
	Object.assign(env, {
		HOME: HOME_DIR,
		LOCAL_OPERATOR_CONFIG_DIR: CONFIG_DIR,
		LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
		PROOF_PHASE: phase,
		PROOF_PACK: PACK_DIR,
		PROOF_REGISTRY: REGISTRY_DIR,
		PROOF_SITE_URL: `http://127.0.0.1:${sitePort}/`,
		PROOF_SCENARIO: scenarioPath,
	});
	return new Promise((resolve) => {
		const child = spawn(
			ELECTRON,
			[join(HARNESS_DIR, "main.cjs"), `--user-data-dir=${USER_DATA}`],
			{ env, cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
		);
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		const timer = setTimeout(() => {
			// Exact pid only: process.pid is this driver's own, so no pattern kill.
			child.kill("SIGKILL");
		}, timeoutMs);
		child.on("close", (code) => {
			clearTimeout(timer);
			const observations = {};
			for (const line of stdout.split("\n")) {
				if (!line.startsWith("OBS ")) continue;
				const body = line.slice(4);
				const space = body.indexOf(" ");
				observations[body.slice(0, space)] = JSON.parse(body.slice(space + 1));
			}
			resolve({
				phase,
				code,
				stdout,
				stderr,
				observations,
				done: stdout.includes(`PHASE_DONE ${phase}`),
			});
		});
	});
}

// ---- main -------------------------------------------------------------------

async function main() {
	say(`browser-extensions native proof — scratch ${SCRATCH}`);
	mkdirSync(HOME_DIR, { recursive: true });
	mkdirSync(CONFIG_DIR, { recursive: true });
	mkdirSync(USER_DATA, { recursive: true });
	mkdirSync(HARNESS_DIR, { recursive: true });
	mkdirSync(OUT_DIR, { recursive: true });
	writeFixtures();

	const { build } = await import("esbuild");
	const bundle = await build({
		stdin: {
			contents: [
				'export { createBrowserExtensionManager } from "./src/main/browser/extension-ui";',
				'export { BROWSER_PARTITION } from "./src/main/browser/profile";',
			].join("\n"),
			resolveDir: ROOT,
		},
		bundle: true,
		platform: "node",
		format: "cjs",
		target: "node22",
		write: false,
		external: ["electron"],
	});
	writeFileSync(join(HARNESS_DIR, "extension-ui.cjs"), bundle.outputFiles[0].text);
	writeFileSync(join(HARNESS_DIR, "main.cjs"), HARNESS_SOURCE);
	say(`bundled src/main/browser/extension-ui.ts (${bundle.outputFiles[0].text.length} bytes) into the isolated Electron entry`);

	const site = await startSite();
	let installPhase = null;
	let restartPhase = null;
	try {
		// Phase 1 installs, exercises the live extension, and leaves one enabled
		// registration plus one whose directory the driver then removes.
		installPhase = await runPhase(
			"install",
			{
				chooser: [
					join(PACK_DIR, "popup-mv3"),
					join(PACK_DIR, "action-only"),
					join(PACK_DIR, "bad-manifest"),
					join(PACK_DIR, "broken-json"),
					join(PACK_DIR, "native-messaging"),
				],
				confirm: [true, true, false, true],
			},
			240000,
		);
		const a = installPhase.observations;
		say(installPhase.stdout.split("\n").filter((line) => line.startsWith("OBS ")).join("\n"));
		if (!installPhase.done) {
			say(`phase install did not finish (exit ${installPhase.code})\n${installPhase.stderr.slice(-4000)}`);
		}

		check("the harness booted the shipped modules in a real Electron main process", installPhase.done, `electron ${a.electron}, chrome ${a.chrome}`);
		check("the extension APIs are present on the product's persistent partition", a["api.persistent"] === "function" && a["api.defaultSession"] === "function", `persistent=${a["api.persistent"]} defaultSession=${a["api.defaultSession"]} inMemory=${a["api.inMemory"]} inMemoryLoad=${JSON.stringify(a["api.inMemoryLoad"])}`);
		check("the registry starts empty", (a.baseline?.rows ?? []).length === 0 && a.baseline?.error === null, JSON.stringify(a.baseline));

		const row = a["install.row"] ?? {};
		check("install loads the chosen directory into the browser session", row.loaded === true && /^[a-p]{32}$/.test(String(row.id)), JSON.stringify(row));
		check("the loaded extension is the real Chromium extension", a["install.loadedInChromium"] === true && (a["install.allIds"] ?? []).includes(row.id), `getExtension=${a["install.loadedInChromium"]} all=${JSON.stringify(a["install.allIds"])}`);
		check("the approval dialog is asked before anything loads, and names the manifest's access", (a["install.dialogCalls"] ?? []).length === 2 && (a["install.dialogCalls"] ?? [])[0].kind === "chooser" && (a["install.dialogCalls"] ?? [])[1].kind === "confirm" && String((a["install.dialogCalls"] ?? [])[1].detail).includes("Permission: storage") && String((a["install.dialogCalls"] ?? [])[1].detail).includes("Site access: http://127.0.0.1/*"), JSON.stringify((a["install.dialogCalls"] ?? []).map((call) => ({ kind: call.kind, approved: call.approved, title: call.title }))));
		check("the registry is written 0600 inside a 0700 directory", a["install.registryMode"] === "600" && a["install.dirMode"] === "700", `file=${a["install.registryMode"]} dir=${a["install.dirMode"]}`);
		check("the user's source directory is never written to or deleted", a["install.sourceIntact"] === true && a["disable.sourceIntact"] === true, `after install=${a["install.sourceIntact"]} after disable=${a["disable.sourceIntact"]}`);

		check("the MV3 service worker runs", a["worker.booted"] === true, `workerBootedAt observed: ${a["worker.booted"]}`);
		check("an extension page can message the worker and get an answer", a["worker.messageRoundTrip"] === "service-worker", String(a["worker.messageRoundTrip"]));
		check("a content script runs in a real page and can reach storage", a["contentScript.domFlag"] === "ran" && String(a["contentScript.storage"] ?? "").startsWith("http://127.0.0.1:"), `dom=${a["contentScript.domFlag"]} storage=${a["contentScript.storage"]}`);
		check("alarms are created in the worker and visible from a page", Array.isArray(a["alarms.registered"]) && a["alarms.registered"].includes("proof-alarm"), `registered=${JSON.stringify(a["alarms.registered"])} platform delay=${a["alarms.platformDelayMs"]}ms`);
		note("alarms delivered", `fired in an open extension page: ${JSON.stringify(a["alarms.firedInPage"])} (${a["alarms.firedDeltaVsScheduleMs"]}ms after its scheduled time); recorded by the service worker listener: ${JSON.stringify(a["alarms.firedInWorker"])} - waited ${a["alarms.waitedMs"]}ms for a ${a["alarms.platformDelayMs"]}ms schedule`);

		check("the product's own popup path opens the declared popup page in a sandboxed hidden window", a["appPopup.opened"] === true && a["appPopup.visible"] === false && String(a["appPopup.url"] ?? "").startsWith("chrome-extension://"), `${a["appPopup.url"]} visible=${a["appPopup.visible"]} bounds=${JSON.stringify(a["appPopup.size"])} body=${JSON.stringify(a["appPopup.bodyText"])}`);

		const disabled = a["disable.row"] ?? {};
		check("disable unloads from Chromium and records the denial", disabled.enabled === false && disabled.loaded === false && a["disable.loadedInChromium"] === false, JSON.stringify(disabled));
		const reenabled = a["reenable.row"] ?? {};
		check("re-enabling restores the same path-derived extension ID", reenabled.loaded === true && reenabled.id === row.id, `id=${reenabled.id} first=${row.id}`);

		const refused = a["refusal.state"] ?? {};
		check("a refused approval loads nothing and registers nothing", (refused.rows ?? []).length === 1 && (a["refusal.loadedNames"] ?? []).length === 1, `rows=${JSON.stringify((refused.rows ?? []).map((entry) => entry.name))} loaded=${JSON.stringify(a["refusal.loadedNames"])}`);
		check("a manifest with an unsupported version is refused with the manager's own message and leaves the registry unchanged", /valid Manifest V2 or V3/.test(String(a["badManifest.error"])) && a["badManifest.rows"] === 1, `${JSON.stringify(a["badManifest.error"])} rows=${a["badManifest.rows"]}`);
		note("a manifest that is not JSON at all (adjacent finding, not asserted)", JSON.stringify(a["brokenJson.error"]));

		const nativeRow = a["native.row"] ?? {};
		check("an extension declaring nativeMessaging LOADS (the manifest is not the blocker)", nativeRow.loaded === true, JSON.stringify(nativeRow));
		check("native messaging is gated on the declared permission, and the API is present once it is", a.chromeApis?.["runtime.connectNative"] === "undefined" && a["native.apis"]?.["runtime.connectNative"] === "function" && (nativeRow.permissions ?? []).includes("Permission: nativeMessaging"), `without the permission: ${JSON.stringify(a.chromeApis?.["runtime.connectNative"])}; with it: ${JSON.stringify(a["native.apis"]?.["runtime.connectNative"])}; declared: ${JSON.stringify(nativeRow.permissions)}`);
		check("a native messaging host connection is refused by the platform (the 1Password-class blocker, measured)", String(a["native.sendNativeMessageCall"] ?? "").includes("disabled"), `connectNative -> ${JSON.stringify(a["native.connectNativeCall"])}; sendNativeMessage -> ${JSON.stringify(a["native.sendNativeMessageCall"])}`);
		const actionOnlyConfirm =
			(a["dialogCalls.all"] ?? []).find((call) => String(call.message ?? "").includes("Proof Action Only")) ?? {};
		check("an action with no default popup is a warning shown in the approval, not a refusal", String(actionOnlyConfirm.detail ?? "").includes("no default popup") && String(actionOnlyConfirm.detail ?? "").includes("partial"), `${JSON.stringify(actionOnlyConfirm.message)} -> warning present=${String(actionOnlyConfirm.detail ?? "").includes("no default popup")}`);
		check("no window was ever made visible in the install phase", a.windowsNeverShown === 0, `visible windows at exit: ${a.windowsNeverShown}`);

		// Between the phases the driver edits the approved manifest and removes a
		// directory — the two failures a restart is supposed to catch.
		writeFileSync(
			join(PACK_DIR, "popup-mv3", "manifest.json"),
			JSON.stringify({ ...POPUP_MANIFEST, permissions: ["storage", "alarms", "tabs"] }, null, 2),
		);
		rmSync(join(PACK_DIR, "native-messaging"), { recursive: true, force: true });

		restartPhase = await runPhase("restart", { chooser: [], confirm: [false, true, true] }, 180000);
		const b = restartPhase.observations;
		say(restartPhase.stdout.split("\n").filter((line) => line.startsWith("OBS ")).join("\n"));
		if (!restartPhase.done) {
			say(`phase restart did not finish (exit ${restartPhase.code})\n${restartPhase.stderr.slice(-4000)}`);
		}

		const changedRow = (b["restart.rows"] ?? []).find((entry) => String(entry.path).endsWith("/popup-mv3")) ?? {};
		const vanishedRow = (b["restart.rows"] ?? []).find((entry) => String(entry.path).endsWith("/native-messaging")) ?? {};
		check("a restart reloads the approved registration from disk", restartPhase.done === true, `rows=${JSON.stringify((b["restart.rows"] ?? []).map((entry) => entry.name))}`);
		check("a manifest changed after approval fails closed on the next launch", changedRow.loaded === false && /manifest changed/.test(String(changedRow.error)), JSON.stringify({ loaded: changedRow.loaded, error: changedRow.error }));
		check("a directory that disappeared after approval fails closed and says so", vanishedRow.loaded === false && vanishedRow.error !== null, JSON.stringify({ loaded: vanishedRow.loaded, error: vanishedRow.error }));
		check("renewing approval after an edit requires the dialog again (declining stays unloaded, with the reason kept)", (b["restore.declinedRow"] ?? {}).loaded === false && (b["restore.declinedRow"] ?? {}).error !== null, JSON.stringify(b["restore.declinedRow"]));
		const accepted = b["restore.acceptedRow"] ?? {};
		check("approving the edited manifest loads the extension with its ORIGINAL id and the new permission list", accepted.loaded === true && accepted.id === row.id && (accepted.permissions ?? []).includes("Permission: tabs"), JSON.stringify({ id: accepted.id, firstId: row.id, permissions: accepted.permissions }));
		check("the extension's own storage and the browser profile's cookies survive a restart", String(b["restore.extensionStorage"] ?? "").includes("contentScriptRan") && (b["cookie.survived"] ?? []).includes("phase-a"), `storage=${b["restore.extensionStorage"]} cookies=${JSON.stringify(b["cookie.survived"])}`);
		check("re-enabling a directory that disappeared refuses to load it and reports why", (b["vanished.error"] ?? null) !== null && (b["vanished.row"] ?? {}).loaded === false, `${JSON.stringify(b["vanished.error"])} row=${JSON.stringify(b["vanished.row"])}`);
		check("remove unloads from Chromium, empties the registry and leaves every source directory", (b["remove.rows"] ?? []).length === 0 && (b["remove.loadedAfter"] ?? []).length === 0 && b["remove.sourceIntact"] === true, `rows=${JSON.stringify(b["remove.rows"])} loaded=${JSON.stringify(b["remove.loadedAfter"])} sourceIntact=${b["remove.sourceIntact"]}`);
		check("no window was ever made visible in the restart phase", b.windowsNeverShown === 0, `visible windows at exit: ${b.windowsNeverShown}`);

		record("install phase observations", JSON.stringify(a, null, 2));
		record("restart phase observations", JSON.stringify(b, null, 2));
		record("chrome API surface measured in a loaded extension page", JSON.stringify(a.chromeApis, null, 2));
	} finally {
		site.close();
		// The run's own Electron processes are already gone: each phase awaited its
		// child's close before this point, and the driver kills by the exact pid it
		// spawned rather than by pattern.
		if (!KEEP) rmSync(SCRATCH, { recursive: true, force: true });
		else say(`scratch kept at ${SCRATCH}`);
	}

	writeFileSync(
		REPORT,
		`# Unpacked-extension manager: native proof\n\n${transcript.join("\n")}`,
	);
	say(`transcript written to ${REPORT}`);
	say(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
	process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
	console.error("proof run failed:", error);
	process.exitCode = 1;
});
