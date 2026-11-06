#!/usr/bin/env node
/**
 * Q1 (QA round 2): the Start recording chord, taken by main, while a push to
 * talk hold on Command or Control is ALREADY recording.
 *
 *     node chord-takeover.mjs --repo <checkout with out/ built> --out <file.json> --port 46170
 *
 * Real: the built Electron app, a real `lop serve`, the composer, a real
 * MediaRecorder on a synthetic stream (a delayed `getUserMedia` stands in for
 * the microphone), key events from CDP `Input.dispatchKeyEvent`, and the REAL
 * `start-speech-to-text` channel, sent from the main process over the Node
 * inspector (`webContents.send`) - the call main's own `before-input-event`
 * hook makes. Not real: a physical microphone, and the keystroke that makes main
 * send it (CDP key events do not pass main's hook).
 *
 * Dictation is enabled the way the app enables it for a key user: the app's own
 * `credentials.update` desktop op stores a dummy `RADIENT_API_KEY` in the scratch
 * config dir (nothing here calls Radient - no transcription is requested).
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
const PORT = Number(arg("--port", "46170"));
const DEBUG = PORT + 1;
const INSPECT = PORT + 2;
const ROOT = mkdtempSync(
	join(process.env.LOCAL_OPERATOR_SCRATCHPAD ?? process.env.TMPDIR, "chord-"),
);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const config = join(ROOT, "config");
mkdirSync(config, { recursive: true, mode: 0o700 });
mkdirSync(join(ROOT, "cwd"), { recursive: true });

const env = {
	PATH: process.env.PATH,
	TMPDIR: process.env.TMPDIR,
	LANG: "en_US.UTF-8",
	HOME: ROOT,
	LOCAL_OPERATOR_CONFIG_DIR: config,
	LOCAL_OPERATOR_LOG_DIR: join(ROOT, "profile", "logs"),
	LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
	LOCAL_OPERATOR_NO_NOTIFICATIONS: "1",
	LOCAL_OPERATOR_NO_TERMINAL_TITLE: "1",
	LOCAL_OPERATOR_UI_TELEMETRY: "off",
	VITE_LOCAL_OPERATOR_API_URL: `http://127.0.0.1:${PORT}`,
	VITE_DISABLE_BACKEND_MANAGER: "true",
};
const children = [];
const launch = (cmd, args) => {
	const child = spawn(cmd, args, {
		cwd: join(ROOT, "cwd"),
		env,
		stdio: "ignore",
		detached: true,
	});
	children.push(child);
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
	`--inspect=${INSPECT}`,
	REPO,
	`--remote-debugging-port=${DEBUG}`,
	`--user-data-dir=${join(ROOT, "profile")}`,
	"--window-size=1380x900",
]);

const socketFor = async (url, pick) => {
	for (let i = 0; i < 120; i++) {
		try {
			const list = await (await fetch(url)).json();
			const t = list.find(pick);
			if (t) {
				const ws = new WebSocket(t.webSocketDebuggerUrl);
				await new Promise((r) => ws.addEventListener("open", r, { once: true }));
				return ws;
			}
		} catch {}
		await wait(1000);
	}
	throw new Error(`no target at ${url}`);
};
const client = (ws) => {
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
	return { cdp, evaluate };
};

const page = client(
	await socketFor(
		`http://127.0.0.1:${DEBUG}/json/list`,
		(t) => t.type === "page" && /\/renderer\/index\.html/.test(t.url ?? ""),
	),
);
const main = client(
	await socketFor(`http://127.0.0.1:${INSPECT}/json/list`, (t) => t.webSocketDebuggerUrl),
);
await page.cdp("Page.enable");
await page.cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
/*
 * RIG-ONLY SETUP, done by hand before the run and NOT part of the app: the
 * page's `connect-src` allows only :1111 and :8080, and the composer's key probe
 * calls the daemon from the renderer, so on a scratch port it is blocked and
 * dictation reads as unavailable. Ports 1111/8080 belong to other daemons on
 * this machine, so the BUILD OUTPUT's `out/renderer/index.html` (untracked) was
 * edited to add `http://127.0.0.1:46170` and `:46180` to `connect-src` in both
 * trees compared. The two trees are otherwise as built.
 */
for (let i = 0; i < 120; i++) {
	const log = join(ROOT, "profile", "logs", "backend-service.log");
	if (existsSync(log) && /Claimed the desktop plane/.test(readFileSync(log, "utf8")))
		break;
	if (i === 119) throw new Error("the app never claimed the daemon");
	await wait(1000);
}

/** The chord's own channel, from main, exactly as `before-input-event` sends it. */
const sendChord = () =>
	main.evaluate(`(() => {
		const { BrowserWindow } = process.mainModule.require("electron");
		const win = BrowserWindow.getAllWindows().find((w) => /\\/renderer\\/index\\.html/.test(w.webContents.getURL()));
		win.webContents.send("start-speech-to-text");
		return !!win;
	})()`);

const VK = { Control: 17, Meta: 91 };
const MOD = { Control: 2, Meta: 4 };
const key = (type, k, code, modifiers = 0) =>
	page.cdp("Input.dispatchKeyEvent", {
		type,
		key: k,
		code,
		windowsVirtualKeyCode: VK[k],
		modifiers,
	});

const setup = async (token, micDelay) => {
	await page.evaluate(`(async () => {
		await window.api.desktop.request({ op: "settings.edit", key: "keymap.push_to_talk", value: ${JSON.stringify(token)} });
		localStorage.setItem("onboarding-storage", JSON.stringify({ state: { isModalComplete: true, isTourComplete: true, currentStep: "congratulations" }, version: 0 }));
		location.hash = "#/";
		// Deferred: a reload inside the call would kill its own CDP reply.
		setTimeout(() => location.reload(), 50);
		return 1;
	})()`);
	await wait(5000);
	await page.evaluate(`(() => {
		const ac = new AudioContext();
		window.__log = [];
		navigator.mediaDevices.getUserMedia = async () => {
			window.__log.push("gum");
			await new Promise((r) => setTimeout(r, ${micDelay}));
			return ac.createMediaStreamDestination().stream;
		};
		const start = MediaRecorder.prototype.start;
		const stop = MediaRecorder.prototype.stop;
		MediaRecorder.prototype.start = function () { window.__log.push("rec-start"); return start.apply(this, arguments); };
		MediaRecorder.prototype.stop = function () { window.__log.push("rec-stop"); return stop.apply(this, arguments); };
		document.querySelector("textarea")?.focus();
		return 1;
	})()`);
};
const recordingUi = () =>
	page.evaluate(`/Confirm recording/.test(document.body.innerHTML)`);
const log = () => page.evaluate(`window.__log.slice()`);
const cancel = async () => {
	await page.evaluate(`(document.querySelector('[aria-label="Cancel recording"]')?.click(), 1)`);
	await wait(400);
};

await page.evaluate(`window.api.desktop.request({ op: "credentials.update", key: "RADIENT_API_KEY", value: "rig-dummy-not-a-real-key" })`);
await setup("meta-right-hold", 150);
const diag = await page.evaluate(`(() => {
	const mic = document.querySelector('[aria-label="Start recording"]');
	return {
		hash: location.hash,
		textarea: !!document.querySelector("textarea"),
		micPresent: !!mic,
		micDisabled: mic?.disabled ?? null,
		micTitle: mic?.getAttribute("title") ?? mic?.getAttribute("aria-describedby") ?? null,
		labels: [...document.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label")).filter((l) => /record|mic|dictat/i.test(l)),
		body: document.body.innerText.slice(0, 300),
	};
})()`);
diag.credentialsList = await page.evaluate(`window.api.desktop.request({ op: "credentials.list" }).then((r) => JSON.stringify(r).slice(0, 200), (e) => "ERR " + e.message)`);
diag.account = await page.evaluate(`window.api.desktop.request({ op: "capabilities" }).then((r) => JSON.stringify(r).slice(0, 200), (e) => "ERR " + e.message)`);
diag.logTail = readFileSync(join(ROOT, "profile", "logs", "backend-service.log"), "utf8").split("\n").filter((l) => /error|CSP|Content Security/i.test(l)).slice(-4).map((l) => l.slice(0, 220));
console.log("DIAG", JSON.stringify(diag));
if (process.argv.includes("--diag-only")) {
	stopAll();
	await wait(3000);
	rmSync(ROOT, { recursive: true, force: true });
	process.exit(0);
}
const results = [];
const TOKENS = [
	["meta-right-hold", "MetaRight", "Meta"],
	["ctrl-right-hold", "ControlRight", "Control"],
];
for (const [token, code, k] of TOKENS) {
	for (const micDelay of [150, 500]) {
		await setup(token, micDelay);
		// Reference: the chord alone, no hold engaged.
		await page.evaluate(`(window.__log.length = 0, document.querySelector("textarea")?.focus(), 1)`);
		await sendChord();
		await wait(micDelay + 700);
		const alone = { recording: await recordingUi(), log: await log() };
		await cancel();

		const cases = [];
		for (const afterMs of [40, 100, 300, 700, 1500]) {
			await page.evaluate(`(window.__log.length = 0, document.querySelector("textarea")?.focus(), 1)`);
			await key("rawKeyDown", k, code, MOD[k]);
			await wait(afterMs);
			await sendChord();
			await wait(micDelay + 800);
			const duringHold = { recording: await recordingUi(), log: await log() };
			await key("keyUp", k, code, 0);
			await wait(600);
			const afterRelease = { recording: await recordingUi(), log: await log() };
			await cancel();
			cases.push({ afterMs, duringHold, afterRelease });
		}
		// A chord AFTER a hold was released still works.
		await page.evaluate(`(window.__log.length = 0, document.querySelector("textarea")?.focus(), 1)`);
		await key("rawKeyDown", k, code, MOD[k]);
		await wait(micDelay + 500);
		await key("keyUp", k, code, 0);
		await wait(900);
		await page.evaluate(`(window.__log.length = 0, 1)`);
		await sendChord();
		await wait(micDelay + 700);
		const afterHold = { recording: await recordingUi(), log: await log() };
		await cancel();
		results.push({ token, micDelay, alone, cases, afterHold });
	}
}
const summary = results.map((r) => ({
	token: r.token,
	micDelay: r.micDelay,
	chordAlone: r.alone.recording,
	holdThenChordRecording: Object.fromEntries(
		r.cases.map((c) => [`${c.afterMs}ms`, c.duringHold.recording]),
	),
	chordAfterReleasedHold: r.afterHold.recording,
}));
writeFileSync(OUT, JSON.stringify({ diag, summary, results }, null, 2));
console.log(JSON.stringify(summary, null, 1));
stopAll();
await wait(3000);
rmSync(ROOT, { recursive: true, force: true });
process.exit(0);
