/**
 * Repro driver: the asks drawer, opened on a conversation that has a pending
 * ask, carried across a switch to a conversation with none.
 *
 * Launches ONE private headless Chrome (the repo's chrome-keychain switch
 * applied), drives the served renderer over raw CDP, photographs each step,
 * and prints a JSON report of what the DOM says at each one. The Chrome is
 * reaped by exact pid on exit; its profile is a scratch dir under TMPDIR.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withMockKeychain } from "../../../../scripts/chrome-keychain.mjs";

const ORIGIN = process.argv[2] ?? "http://localhost:5311";
const OUT = process.argv[3] ?? "shots";
const WAIT_MS = 20_000;

mkdirSync(OUT, { recursive: true });

/**
 * Chrome announces its own debug port on stderr; the pattern is module scope so the
 * listener does not rebuild it per chunk.
 */
const DEVTOOLS_URL = /DevTools listening on (ws:\/\/[^\s]+)/;

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const dataDir = mkdtempSync(join(tmpdir(), "asks-stuck-rig-"));
const chrome = spawn(
	CHROME,
	withMockKeychain([
		"--headless=new",
		"--no-sandbox",
		"--disable-gpu",
		"--hide-scrollbars",
		`--user-data-dir=${dataDir}`,
		"--remote-debugging-port=0",
		"about:blank",
	]),
);
let chromeExited = false;
chrome.on("exit", () => {
	chromeExited = true;
});

const wsUrl = await new Promise((resolve, reject) => {
	let buf = "";
	const t = setTimeout(
		() => reject(new Error("Chrome did not report a debug port")),
		30_000,
	);
	chrome.stderr.on("data", (d) => {
		buf += d.toString();
		const m = buf.match(DEVTOOLS_URL);
		if (m) {
			clearTimeout(t);
			resolve(m[1]);
		}
	});
});

const browser = new WebSocket(wsUrl);
await new Promise((resolve) => {
	browser.onopen = resolve;
});
let nextId = 1;
const pending = new Map();
browser.onmessage = (event) => {
	const msg = JSON.parse(event.data);
	if (msg.id && pending.has(msg.id)) {
		const { resolve, reject } = pending.get(msg.id);
		pending.delete(msg.id);
		msg.error
			? reject(new Error(JSON.stringify(msg.error)))
			: resolve(msg.result);
	}
};
const raw = (method, params, sessionId) =>
	new Promise((resolve, reject) => {
		const id = nextId++;
		pending.set(id, { resolve, reject });
		browser.send(
			JSON.stringify({
				id,
				method,
				params: params ?? {},
				...(sessionId ? { sessionId } : {}),
			}),
		);
	});

const target = await raw("Target.createTarget", { url: "about:blank" });
const attached = await raw("Target.attachToTarget", {
	targetId: target.targetId,
	flatten: true,
});
const sessionId = attached.sessionId;
const send = (method, params = {}) => raw(method, params, sessionId);

async function evaluate(expression) {
	const res = await send("Runtime.evaluate", {
		expression,
		awaitPromise: true,
		returnByValue: true,
	});
	if (res.exceptionDetails) {
		throw new Error(
			res.exceptionDetails.exception?.description ?? "page error",
		);
	}
	return res.result.value;
}

async function waitFor(expression, label, timeoutMs = WAIT_MS) {
	const start = Date.now();
	for (;;) {
		const value = await evaluate(expression);
		if (value) return value;
		if (Date.now() - start > timeoutMs) {
			throw new Error(`timed out waiting for ${label}`);
		}
		await wait(150);
	}
}

async function clickAt(x, y) {
	await send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x,
		y,
		button: "none",
	});
	await send("Input.dispatchMouseEvent", {
		type: "mousePressed",
		x,
		y,
		button: "left",
		clickCount: 1,
	});
	await send("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		x,
		y,
		button: "left",
		clickCount: 1,
	});
}

async function pressEscape() {
	for (const type of ["rawKeyDown", "keyUp"]) {
		await send("Input.dispatchKeyEvent", {
			type,
			key: "Escape",
			code: "Escape",
			windowsVirtualKeyCode: 27,
			nativeVirtualKeyCode: 53,
		});
	}
}

let shotIndex = 0;
async function shot(name) {
	shotIndex += 1;
	const { data } = await send("Page.captureScreenshot", { format: "png" });
	const file = join(OUT, `${String(shotIndex).padStart(2, "0")}-${name}.png`);
	writeFileSync(file, Buffer.from(data, "base64"));
	return file;
}

const rectOf = (selector) => `(() => {
	const el = document.querySelector(${JSON.stringify(selector)});
	if (!el) return null;
	const r = el.getBoundingClientRect();
	return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), left: Math.round(r.left) };
})()`;

const PROBE = `(() => {
	const q = (sel) => document.querySelector(sel);
	const states = (sel) => document.querySelectorAll(sel).length;
	const slot = q('[data-tour-tag="ask-drawer-slot"]');
	const slotBox = slot ? (() => { const r = slot.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })() : null;
	return {
		url: location.hash,
		headerTitle: (q('main sectionheader h1') || {}).textContent ?? null,
		drawers: states('[data-ask-drawer]'),
		closeAsks: states('[aria-label="Close asks"]'),
		askSurfaces: states('[data-lo-ask-surfaces]'),
		slotPresent: Boolean(slot),
		slotBox,
		slotText: slot ? slot.innerText.replace(/\\s+/g, ' ').trim().slice(0, 120) : null,
		chip: states('[data-lo-ask-item-toggle]'),
		headerTrigger: states('[data-tour-tag="ask-pane-trigger"]'),
		drawerScopeLine: (q('[data-ask-scope]') || {}).textContent ?? null,
	};
})()`;

const report = { frames: {}, probes: {} };

try {
	await send("Page.enable");
	await send("Runtime.enable");
	await send("Emulation.setDeviceMetricsOverride", {
		width: 1380,
		height: 900,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await send("Page.addScriptToEvaluateOnNewDocument", {
		source:
			'try { localStorage.setItem("onboarding-storage", JSON.stringify({ state: { isModalComplete: true, isTourComplete: true, currentStep: "create_agent" }, version: 0 })); } catch (error) {}',
	});

	// 1. Session A: the conversation WITH a pending ask.
	await send("Page.navigate", {
		url: `${ORIGIN}/#/chat/aaaa11112222`,
	});
	await waitFor(
		`document.querySelector('[data-lo-ask-item-toggle]') !== null`,
		"the ask chip on session A",
	);
	await wait(600);
	report.frames.aPopulated = await shot("a-populated");

	// 2. Open the drawer the way a user does: press the chip.
	const chip = await evaluate(rectOf("[data-lo-ask-item-toggle]"));
	report.chip = chip;
	await clickAt(chip.x, chip.y);
	await waitFor(
		`document.querySelector('[data-ask-drawer="session"]') !== null`,
		"the drawer",
	);
	await wait(700);
	report.frames.drawerOpen = await shot("drawer-open");
	report.closeButton = await evaluate(rectOf('[aria-label="Close asks"]'));

	// 3. SWITCH to session B — a conversation with no asks.
	// Scroll the row into view first and hit-test the exact point before
	// clicking: the row can sit below the visible list area (measured: a
	// centre read straight from the un-scrolled rect landed on the sidebar's
	// Settings button at the very bottom, an 878px y against a 900px window).
	const row = await evaluate(`(() => {
		const buttons = [...document.querySelectorAll('nav button')];
		const match = buttons.find((b) => /Notes/.test(b.innerText) && /(last active|Ready|Open|Scheduled)/.test(b.innerText));
		if (!match) return null;
		match.scrollIntoView({ block: 'center' });
		const r = match.getBoundingClientRect();
		const x = Math.round(r.left + r.width / 2);
		const y = Math.round(r.top + r.height / 2);
		const hit = document.elementFromPoint(x, y);
		return {
			x, y,
			text: match.innerText.replace(/\\s+/g, ' ').slice(0, 120),
			hitInsideRow: Boolean(hit && (match.contains(hit) || match === hit)),
			hitText: hit ? (hit.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80) : null,
		};
	})()`);
	report.notesRow = row;
	if (!row) throw new Error("no Notes row found in the sidebar nav");
	if (!row.hitInsideRow)
		throw new Error(
			`Notes row not hit-testable at its centre: hit ${JSON.stringify(row.hitText)}`,
		);
	await wait(400);
	const rowAfterScroll = await evaluate(`(() => {
		const buttons = [...document.querySelectorAll('nav button')];
		const match = buttons.find((b) => /Notes/.test(b.innerText) && /(last active|Ready|Open|Scheduled)/.test(b.innerText));
		const r = match.getBoundingClientRect();
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
	await clickAt(rowAfterScroll.x, rowAfterScroll.y);
	await waitFor(
		`location.hash.includes('bbbb11112222')`,
		"the switch to session B",
	);
	await wait(1500);
	report.frames.switchStuck = await shot("switch-stuck");
	report.probes.afterSwitch = await evaluate(PROBE);

	// 4. A quiet window first: does the empty slot resolve on its own?
	const active = await evaluate(
		`(() => { const a = document.activeElement; return a ? { tag: a.tagName, label: a.getAttribute('aria-label'), text: (a.textContent||'').replace(/\\s+/g,' ').trim().slice(0,60) } : null; })()`,
	);
	report.activeElementAfterSwitch = active;
	const slotProbe = `!!document.querySelector('[data-tour-tag="ask-drawer-slot"]')`;
	report.timeline = [];
	for (let i = 0; i < 12; i += 1) {
		await wait(500);
		report.timeline.push({
			t: `${(i + 1) * 0.5}s`,
			slot: await evaluate(slotProbe),
			drawer: await evaluate(`!!document.querySelector('[data-ask-drawer]')`),
			close: await evaluate(
				`!!document.querySelector('[aria-label="Close asks"]')`,
			),
		});
	}

	// 5. Arm A: focus OUTSIDE the composer (a click on the empty void), then
	// Escape — the press a stuck user makes after looking for a control.
	await clickAt(1050, 380);
	await wait(400);
	report.activeAfterVoidClick = await evaluate(
		`(() => { const a = document.activeElement; return a ? { tag: a.tagName, label: a.getAttribute('aria-label') } : null; })()`,
	);
	await pressEscape();
	await wait(800);
	report.probes.afterVoidClickEscape = await evaluate(PROBE);
	report.frames.afterVoidClickEscape = await shot("after-void-click-escape");

	// 6. Arm B: focus IN the composer (where a conversation switch leaves it),
	// then Escape — the one path the empty state still has.
	const composer = await evaluate(
		rectOf(
			'textarea[aria-label="Message"], [data-tour-tag="chat-input-textarea"] textarea, [data-tour-tag="chat-input-textarea"]',
		),
	);
	report.composerRect = composer;
	if (composer) await clickAt(composer.x, Math.min(composer.y, 880));
	await wait(300);
	await pressEscape();
	await wait(800);
	report.probes.afterComposerEscape = await evaluate(PROBE);
	report.frames.afterComposerEscape = await shot("after-composer-escape");

	report.ok = true;
} catch (error) {
	report.ok = false;
	report.error = String(error?.stack ?? error);
	try {
		report.frames.failure = await shot("failure");
		report.probes.failure = await evaluate(PROBE);
	} catch {
		/* the page may be gone; the error above is the record */
	}
} finally {
	console.log(JSON.stringify(report, null, 2));
	try {
		await raw("Browser.close");
	} catch {
		/* already gone */
	}
	if (!chromeExited) chrome.kill();
	await wait(500);
	rmSync(dataDir, { recursive: true, force: true });
}
