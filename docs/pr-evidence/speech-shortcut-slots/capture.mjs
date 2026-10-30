#!/usr/bin/env node
/**
 * Frames and key-event proofs for the Speech to text shortcut boxes, from the
 * BUILT Electron app (headless window mode, scratch profile, scratch HOME and
 * config dir, a `lop serve` of its own) driven over CDP.
 *
 *     node capture.mjs --repo <checkout with out/ built> --out <dir> \
 *          --label before|after --port 46150
 *
 * What is real: the Electron main + renderer, the preload bridge, a real
 * `lop serve` holding the settings registry, and key events injected with
 * `Input.dispatchKeyEvent` (they pass through Chromium's input pipeline and
 * the main process' `before-input-event` hook). What is not: a microphone (no
 * recording is started), and any platform but this Mac.
 *
 * Never calls Page.bringToFront / Target.activateTarget / window.focus(): focus
 * emulation keeps a never-shown page reading as focused.
 */
import { spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const arg = (name, fallback) => {
	const at = process.argv.indexOf(name);
	return at === -1 ? fallback : process.argv[at + 1];
};
const REPO = resolve(arg("--repo"));
const OUT = resolve(arg("--out"));
const LABEL = arg("--label", "after");
const PORT = Number(arg("--port", "46150"));
const DEBUG = PORT + 1;
const scratch = process.env.LOCAL_OPERATOR_SCRATCHPAD ?? process.env.TMPDIR;
const ROOT = mkdtempSync(join(scratch, "speech-frames-"));
mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const env = {
	PATH: process.env.PATH,
	TMPDIR: process.env.TMPDIR,
	LANG: process.env.LANG ?? "en_US.UTF-8",
	HOME: ROOT,
	LOCAL_OPERATOR_CONFIG_DIR: join(ROOT, "config"),
	LOCAL_OPERATOR_LOG_DIR: join(ROOT, "profile", "logs"),
	LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
	LOCAL_OPERATOR_NO_NOTIFICATIONS: "1",
	LOCAL_OPERATOR_NO_TERMINAL_TITLE: "1",
	LOCAL_OPERATOR_UI_TELEMETRY: "off",
	VITE_LOCAL_OPERATOR_API_URL: `http://127.0.0.1:${PORT}`,
	VITE_DISABLE_BACKEND_MANAGER: "true",
};
mkdirSync(env.LOCAL_OPERATOR_CONFIG_DIR, { recursive: true });
mkdirSync(join(ROOT, "cwd"), { recursive: true });

const children = [];
const launch = (cmd, args) => {
	const child = spawn(cmd, args, {
		cwd: join(ROOT, "cwd"),
		env,
		stdio: "ignore",
		detached: true,
	});
	children.push(child);
	return child;
};
const stopAll = () => {
	for (const child of children) {
		try {
			process.kill(-child.pid, "SIGTERM");
		} catch {}
	}
};
process.on("exit", stopAll);
for (const sig of ["SIGINT", "SIGTERM"])
	process.on(sig, () => {
		stopAll();
		process.exit(1);
	});

launch("lop", ["serve", "--port", String(PORT)]);
launch(join(REPO, "node_modules/.bin/electron"), [
	REPO,
	`--remote-debugging-port=${DEBUG}`,
	`--user-data-dir=${join(ROOT, "profile")}`,
	"--window-size=1380x900",
]);

const page = async () => {
	for (let i = 0; i < 120; i++) {
		try {
			const list = await (
				await fetch(`http://127.0.0.1:${DEBUG}/json/list`)
			).json();
			const target = list.find(
				(t) =>
					t.type === "page" &&
					t.webSocketDebuggerUrl &&
					/\/renderer\/index\.html/.test(t.url ?? ""),
			);
			if (target) return target;
		} catch {}
		await wait(1000);
	}
	throw new Error("no app page");
};
const target = await page();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
	const m = JSON.parse(e.data);
	if (m.id && pending.has(m.id)) {
		const { ok, bad } = pending.get(m.id);
		pending.delete(m.id);
		m.error ? bad(new Error(JSON.stringify(m.error))) : ok(m.result);
	}
});
const cdp = (method, params = {}) =>
	new Promise((ok, bad) => {
		const id = ++seq;
		pending.set(id, { ok, bad });
		ws.send(JSON.stringify({ id, method, params }));
	});
const evaluate = async (expression) => {
	const r = await cdp("Runtime.evaluate", {
		expression,
		returnByValue: true,
		awaitPromise: true,
	});
	if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
	return r.result.value;
};
await cdp("Page.enable");
await cdp("Emulation.setFocusEmulationEnabled", { enabled: true });

/** The app's own plane claim, from its log, so settings.list can answer. */
for (let i = 0; i < 120; i++) {
	const log = join(ROOT, "profile", "logs", "backend-service.log");
	if (
		existsSync(log) &&
		/Claimed the desktop plane/.test(readFileSync(log, "utf8"))
	)
		break;
	if (i === 119) throw new Error("the app never claimed the daemon");
	await wait(1000);
}

const go = async (hash, theme) => {
	await evaluate(`(() => {
		localStorage.setItem("onboarding-storage", JSON.stringify({ state: { isModalComplete: true, isTourComplete: true, currentStep: "congratulations" }, version: 0 }));
		const raw = localStorage.getItem("ui-preferences-storage");
		const store = raw ? JSON.parse(raw) : { state: {}, version: 0 };
		store.state.themeName = ${JSON.stringify(theme)};
		localStorage.setItem("ui-preferences-storage", JSON.stringify(store));
		location.hash = ${JSON.stringify(hash)};
		location.reload();
		return 1;
	})()`);
	await wait(4000);
	for (let i = 0; i < 60; i++) {
		const ready = await evaluate(
			`!!document.querySelector('[data-speech-rank],[data-search-section="keyboard"]') || [...document.querySelectorAll('h2,h3')].some(h => h.textContent.trim() === 'Speech to text')`,
		).catch(() => false);
		if (ready) break;
		await wait(1000);
	}
	await wait(1500);
};
const scrollToGroup = () =>
	evaluate(`(() => {
		const h = [...document.querySelectorAll('h2,h3,h4')].find(x => x.textContent.trim() === 'Speech to text');
		h?.scrollIntoView({ block: 'start' });
		return !!h;
	})()`);
const shot = async (name) => {
	const { data } = await cdp("Page.captureScreenshot", {
		format: "png",
		fromSurface: true,
	});
	writeFileSync(join(OUT, `${LABEL}-${name}.png`), Buffer.from(data, "base64"));
};

const VK = {
	Control: 17,
	Alt: 18,
	Meta: 91,
	Shift: 16,
	a: 65,
	r: 82,
	s: 83,
	p: 80,
	Tab: 9,
};
const MOD = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };
const key = (type, k, code, modifiers = 0, text) =>
	cdp("Input.dispatchKeyEvent", {
		type,
		key: k,
		code,
		windowsVirtualKeyCode: VK[k] ?? k.toUpperCase().charCodeAt(0),
		modifiers,
		...(text ? { text } : {}),
	});
const down = (k, code, modifiers) => key("rawKeyDown", k, code, modifiers);
const up = (k, code, modifiers = 0) => key("keyUp", k, code, modifiers);
const tap = async (k, code) => {
	await down(k, code, MOD[k]);
	await wait(60);
	await up(k, code, 0);
	await wait(400);
};
const focusField = (selector) =>
	evaluate(
		`document.querySelector(${JSON.stringify(selector)})?.focus() ?? 'none'`,
	);
const START = '[data-shortcut-action="keymap.start_recording"]';
const HOLD = '[data-shortcut-action="keymap.push_to_talk"]';
const read = (selector) =>
	evaluate(
		`(() => { const f = document.querySelector(${JSON.stringify(selector)}); const row = f?.closest('[data-speech-rank]'); return f ? { value: f.value, invalid: f.getAttribute('aria-invalid'), text: row?.innerText ?? '' } : null; })()`,
	);
const record = { label: LABEL, platform: await evaluate("navigator.platform") };

const hasHold = () => evaluate(`!!document.querySelector('${HOLD}')`);

// --- default, dark ---------------------------------------------------------
await go("#/settings", "localOperatorDark");
await scrollToGroup();
record.bridge = await evaluate(`({
	api: typeof window.api?.recordingShortcut,
	electron: typeof window.electron?.recordingShortcut,
})`);
record.hasHoldBox = await hasHold();
await shot("default-dark");
record.defaultRows = {
	primary: await read(START),
	secondary: record.hasHoldBox ? await read(HOLD) : null,
};

if (LABEL === "after") {
	// --- listening: focused, hint visible, modifier held ----------------------
	await focusField(HOLD);
	await down("Control", "ControlLeft", MOD.Control);
	await wait(400);
	await scrollToGroup();
	await shot("listening-dark");
	record.listening = await read(HOLD);
	await up("Control", "ControlLeft");
	await wait(600);
	record.afterTapSaved = await read(HOLD);
	record.settingAfterTap = await evaluate(
		`window.api.desktop.request({ op: "settings.list" }).then(r => { const b = r?.body ?? r; const rows = (b?.result ?? b)?.settings ?? []; return rows.find(s => s.key === 'keymap.push_to_talk')?.value ?? null; })`,
	).catch((e) => String(e));
	await scrollToGroup();
	await shot("rebound-overlap-dark");
	record.rebound = await read(HOLD);

	// --- a chord must not rebind: Cmd+Shift+S typed into the box --------------
	await focusField(HOLD);
	await down("Meta", "MetaLeft", MOD.Meta);
	await down("Shift", "ShiftLeft", MOD.Meta | MOD.Shift);
	await key("rawKeyDown", "s", "KeyS", MOD.Meta | MOD.Shift);
	await up("s", "KeyS", MOD.Meta | MOD.Shift);
	await up("Shift", "ShiftLeft", MOD.Meta);
	await up("Meta", "MetaLeft");
	await wait(500);
	record.afterChord = await read(HOLD);

	// --- refused: a letter ---------------------------------------------------
	await focusField(HOLD);
	await key("rawKeyDown", "a", "KeyA", 0);
	await up("a", "KeyA");
	await wait(400);
	await scrollToGroup();
	await shot("refused-dark");
	record.refused = await read(HOLD);

	// --- U5: a rebound Primary reaches the bridge and the overlap note --------
	await focusField(HOLD);
	await up("a", "KeyA");
	await focusField(HOLD);
	await tap("Alt", "AltRight"); // back to Option so a Cmd+Option chord overlaps
	record.holdBackToOption = await read(HOLD);
	const before = await evaluate(`window.api.recordingShortcut.get()`);
	await focusField(START);
	const both = MOD.Meta | MOD.Alt;
	await down("Meta", "MetaLeft", MOD.Meta);
	await down("Alt", "AltLeft", both);
	await key("rawKeyDown", "r", "KeyR", both);
	await up("r", "KeyR", both);
	await up("Alt", "AltLeft", MOD.Meta);
	await up("Meta", "MetaLeft");
	await wait(1500);
	const after = await evaluate(`window.api.recordingShortcut.get()`);
	record.primaryRebind = {
		before,
		after,
		primaryRow: await read(START),
		holdRow: await read(HOLD),
	};
	await scrollToGroup();
	await shot("primary-rebound-note-dark");

	// --- F2: which keys main swallows ----------------------------------------
	await evaluate(`(() => {
		window.__keys = [];
		window.__ipc = [];
		window.addEventListener('keydown', (e) => window.__keys.push(e.code), true);
		for (const ch of ['start-speech-to-text', 'toggle-command-palette', 'toggle-command-palette-commands'])
			window.electron.ipcRenderer.on(ch, () => window.__ipc.push(ch));
		document.activeElement?.blur();
		return 1;
	})()`);
	await tap("Alt", "AltRight"); // not focused: no field is listening
	const f2 = {};
	// Cmd+P (palette door) and the rebound Primary (Cmd+Option+R), typed on the page.
	await down("Meta", "MetaLeft", MOD.Meta);
	await key("rawKeyDown", "p", "KeyP", MOD.Meta);
	await up("p", "KeyP", MOD.Meta);
	await up("Meta", "MetaLeft");
	await wait(500);
	f2.cmdP = await evaluate(
		`({ keys: window.__keys.slice(), ipc: window.__ipc.slice() })`,
	);
	await evaluate(`(window.__keys.length = 0, window.__ipc.length = 0, 1)`);
	await down("Meta", "MetaLeft", MOD.Meta);
	await down("Alt", "AltLeft", both);
	await key("rawKeyDown", "r", "KeyR", both);
	await up("r", "KeyR", both);
	await up("Alt", "AltLeft", MOD.Meta);
	await up("Meta", "MetaLeft");
	await wait(500);
	f2.cmdOptR = await evaluate(
		`({ keys: window.__keys.slice(), ipc: window.__ipc.slice() })`,
	);
	record.mainSwallow = f2;

	// --- light and narrow ----------------------------------------------------
	await go("#/settings", "githubLight");
	await scrollToGroup();
	await shot("default-light");
	await go("#/settings?setting=keymap.push_to_talk", "githubLight");
	await scrollToGroup();
	record.deepLinkActive = await evaluate(
		`document.activeElement?.getAttribute('data-shortcut-action') ?? document.activeElement?.tagName`,
	);
	await shot("deeplink-focused-light");
	await cdp("Emulation.setDeviceMetricsOverride", {
		width: 760,
		height: 868,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await wait(800);
	await scrollToGroup();
	await shot("narrow-light");
} else {
	await go("#/settings", "githubLight");
	await scrollToGroup();
	await shot("default-light");
	await cdp("Emulation.setDeviceMetricsOverride", {
		width: 760,
		height: 868,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await wait(800);
	await scrollToGroup();
	await shot("narrow-light");
}

writeFileSync(
	join(OUT, `${LABEL}-record.json`),
	JSON.stringify(record, null, 2),
);
console.log(JSON.stringify(record, null, 2));
stopAll();
await wait(3000);
rmSync(ROOT, { recursive: true, force: true });
process.exit(0);
