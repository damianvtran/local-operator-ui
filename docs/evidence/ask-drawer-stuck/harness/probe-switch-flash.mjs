/**
 * Does the auto-close FLASH a painted frame of the drawer over the conversation
 * it is leaving?
 *
 * The close runs in a passive effect, so React may paint the mount before the
 * effect flushes. `drive-asks.mjs` samples the DOM at 0.5 s intervals, which is
 * far too coarse to see a one-frame flash, so this probe samples on EVERY
 * animation frame from the moment the switch is clicked until a second has
 * passed, and records whether the ask surface was ever present in a frame the
 * browser actually painted.
 *
 * usage: node probe-switch-flash.mjs <origin>
 *
 * WHY THE UNREAD WINDOW IS NOT CLOSED ON. The sampler separates the two states that
 * look alike in a coarse probe: a frame painted with the drawer's OWN chrome before
 * the browser has painted anything else (a paint-phase artifact, which a layout effect
 * could remove) and the drawer sitting in its UNREAD state (`frameUnread`, the scope
 * line reads `Not read yet`) while the leaving conversation's frame is still the one in
 * hand. Only the second is reachable here, and it must not be closed on: a switch to a
 * conversation that DOES have asks looks identical until its frame lands.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withMockKeychain } from "../../../../scripts/chrome-keychain.mjs";

const ORIGIN = process.argv[2] ?? "http://localhost:5314";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const dataDir = mkdtempSync(join(tmpdir(), "asks-switch-flash-"));
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
let exited = false;
chrome.on("exit", () => {
	exited = true;
});
const wsUrl = await new Promise((resolve, reject) => {
	let buf = "";
	const t = setTimeout(() => reject(new Error("no debug port")), 30_000);
	chrome.stderr.on("data", (d) => {
		buf += d.toString();
		const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
		if (m) {
			clearTimeout(t);
			resolve(m[1]);
		}
	});
});
const browser = new WebSocket(wsUrl);
await new Promise((r) => {
	browser.onopen = r;
});
let nextId = 1;
const pending = new Map();
browser.onmessage = (e) => {
	const msg = JSON.parse(e.data);
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
const { sessionId } = await raw("Target.attachToTarget", {
	targetId: target.targetId,
	flatten: true,
});
const send = (m, p = {}) => raw(m, p, sessionId);
const evaluate = async (expression) => {
	const res = await send("Runtime.evaluate", {
		expression,
		awaitPromise: true,
		returnByValue: true,
	});
	if (res.exceptionDetails)
		throw new Error(
			res.exceptionDetails.exception?.description ?? "page error",
		);
	return res.result.value;
};
const waitFor = async (expr, label, ms = 30_000) => {
	const t0 = Date.now();
	for (;;) {
		if (await evaluate(expr)) return true;
		if (Date.now() - t0 > ms) throw new Error(`timed out: ${label}`);
		await wait(150);
	}
};

const report = {};
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

	await send("Page.navigate", { url: `${ORIGIN}/#/chat/aaaa11112222` });
	await waitFor(
		`document.querySelector('[data-lo-ask-item-toggle]') !== null`,
		"ask chip",
	);
	await wait(600);
	const chip = await evaluate(
		`(() => { const r = document.querySelector('[data-lo-ask-item-toggle]').getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`,
	);
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
		await send("Input.dispatchMouseEvent", {
			type,
			x: chip.x,
			y: chip.y,
			button: "left",
			clickCount: 1,
		});
	}
	await waitFor(
		`document.querySelector('[data-ask-drawer="session"]') !== null`,
		"the drawer",
	);
	await wait(700);

	// The switch, watched frame by frame: install the sampler, click, then read it.
	await evaluate(`(() => {
		window.__flash = { frames: 0, withSurface: 0, firstWith: null, marks: [] };
		const t0 = performance.now();
		const tick = () => {
			const f = window.__flash;
			const present = document.querySelector('[data-lo-ask-surfaces]') !== null;
			f.frames += 1;
			if (present) {
				f.withSurface += 1;
				if (f.firstWith === null) f.firstWith = performance.now() - t0;
			}
			f.marks.push({ t: Math.round(performance.now() - t0), surface: present, hash: location.hash.slice(-12), slot: document.querySelector('[data-tour-tag="ask-drawer-slot"]') !== null, rows: document.querySelectorAll('[data-lo-ask-row]').length, scope: (document.querySelector('[data-ask-scope]') || {}).textContent ?? null });
			if (performance.now() - t0 < 1500) requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
		return true;
	})()`);

	const row = await evaluate(`(() => {
		const b = [...document.querySelectorAll('nav button')].find((x) => /Notes/.test(x.innerText));
		if (!b) return null;
		b.scrollIntoView({ block: 'center' });
		const r = b.getBoundingClientRect();
		return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
	})()`);
	if (!row) throw new Error("no Notes row");
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
		await send("Input.dispatchMouseEvent", {
			type,
			x: row.x,
			y: row.y,
			button: "left",
			clickCount: 1,
		});
	}
	await waitFor(`location.hash.includes('bbbb11112222')`, "the switch");
	await wait(2200);

	report.flash = await evaluate(`(() => {
		const f = window.__flash;
		const onB = f.marks.filter((m) => m.hash.includes('bbbb'));
		return {
			framesSampled: f.frames,
			framesWithSurface: f.withSurface,
			firstSurfaceAtMs: f.firstWith,
			framesOnB: onB.length,
			framesOnBWithSurface: onB.filter((m) => m.surface).length,
			framesOnBWithSlot: onB.filter((m) => m.slot).length,
			firstMarksOnB: f.marks.filter((m) => m.hash.includes('bbbb')).slice(0, 14),
			lastFrames: f.marks.slice(-4),
		};
	})()`);
	report.ok = true;
} catch (error) {
	report.ok = false;
	report.error = String(error?.stack ?? error);
} finally {
	console.log(JSON.stringify(report, null, 2));
	try {
		await raw("Browser.close");
	} catch {
		/* gone */
	}
	if (!exited) chrome.kill();
	await wait(500);
	rmSync(dataDir, { recursive: true, force: true });
}
