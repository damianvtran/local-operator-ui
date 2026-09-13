#!/usr/bin/env node
/**
 * Prove, by clicking, that a pending `ask` gate's option is a real control.
 *
 *     node scripts/click-proof.mjs <origin> <out-dir> [session-id]
 *
 * Drives the app the way `scripts/capture-evidence.mjs` drives it: a PRIVATE
 * `--headless=new` Chromium with a fresh profile under the system temp dir,
 * spoken to over raw CDP with Node's built-in WebSocket. No browser-automation
 * dependency is installed for this, and no window is opened or focused.
 *
 * ## Why this is a committed script and not a throwaway rig
 *
 * It was a throwaway rig, and the QA round said so: the frames in
 * `docs/evidence/ask-options-live/` named `/tmp/ask-gate-rig/proof.mjs`, which
 * exists on one machine and nowhere else, so nobody else could re-derive the
 * evidence they were asked to trust. The repository keeps its reusable drivers
 * (`scripts/diff-body-evidence.mjs`, `scripts/usage-real-evidence.mjs`); this
 * is that same piece for the click, and the README beside the frames gives the
 * two commands that stand the other two thirds of the rig up.
 *
 * ## What it asserts, and what it deliberately does not
 *
 * The click is dispatched at the option's PAINTED pixels after asking the page
 * which element owns them (`elementFromPoint`), never as a synthetic
 * `element.click()`, so a control that is painted but not hit-testable fails
 * here. What it cannot see is Electron's IPC/preload channel: the app in a
 * plain browser takes its shipped `/__desktop` branch, and the README states
 * that limit rather than implying otherwise.
 *
 * `click-result.json` records the pre-click DOM state, the aim point, the
 * post-click state and any surface the after-frame still carries. The
 * accessible name is computed here the way a screen reader computes it — the
 * `aria-hidden` ordinals removed — because the raw `textContent` includes them
 * and reading that as "the name" is the specific confusion the round-1 review
 * found in this file (its `names` array carried "2.Popup is not open…").
 */

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = process.argv[2] ?? "http://localhost:5199";
const OUT = process.argv[3] ?? "docs/evidence/ask-options-live";
const SESSION = process.argv[4] ?? "a1a1a1a1a1a1";
/* The app's own default window (src/main/index.ts). A live frame is only worth
 * anything if it is the window the operator runs. */
const WIDTH = Number(process.env.CLICK_PROOF_WIDTH ?? 1380);
const HEIGHT = Number(process.env.CLICK_PROOF_HEIGHT ?? 900);
/*
 * The option to press. Named rather than indexed, and named as the SECOND row
 * of the armed gate after the harness rotates `recommended` to the front — so
 * a pass cannot be an index-0 accident and cannot be the recommended option
 * either.
 */
const TARGET = process.env.CLICK_PROOF_TARGET ?? "Popup is open - generate the pairing code";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const dataDir = mkdtempSync(join(tmpdir(), "ask-click-proof-"));
const chrome = spawn(CHROME, [
	"--headless=new",
	"--no-sandbox",
	"--disable-gpu",
	"--hide-scrollbars",
	`--user-data-dir=${dataDir}`,
	"--remote-debugging-port=0",
	"about:blank",
]);

const wsUrl = await new Promise((resolve, reject) => {
	let buf = "";
	const t = setTimeout(
		() => reject(new Error("Chrome did not report a debug port")),
		30_000,
	);
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
await new Promise((r) => (browser.onopen = r));
let nextId = 1;
const pending = new Map();
browser.onmessage = (event) => {
	const msg = JSON.parse(event.data);
	if (msg.id && pending.has(msg.id)) {
		const { resolve, reject } = pending.get(msg.id);
		pending.delete(msg.id);
		msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
	}
};
const raw = (method, params = {}, sessionId) =>
	new Promise((resolve, reject) => {
		const id = nextId++;
		pending.set(id, { resolve, reject });
		browser.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
	});

const target = await raw("Target.createTarget", { url: "about:blank" });
const attached = await raw("Target.attachToTarget", { targetId: target.targetId, flatten: true });
const sessionId = attached.sessionId;
const send = (method, params = {}) => raw(method, params, sessionId);

async function evaluate(expression) {
	const res = await send("Runtime.evaluate", {
		expression,
		awaitPromise: true,
		returnByValue: true,
	});
	if (res.exceptionDetails) {
		throw new Error(res.exceptionDetails.exception?.description ?? "page error");
	}
	return res.result.value;
}

/**
 * The state of the gate, read from the DOM exactly as a user would find it.
 *
 * `accessibleName` strips `aria-hidden` subtrees rather than reading
 * `innerText`, because the ordinal IS `aria-hidden` and reading the raw text
 * is what made the previous record look like it contradicted the claim it
 * supported.
 */
const READ_STATE = `(() => {
	const field = document.querySelector('fieldset[aria-label="Answer options"]');
	const buttons = field ? [...field.querySelectorAll("button")] : [];
	const name = (b) => {
		const copy = b.cloneNode(true);
		copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
		return copy.textContent.replace(/\\s+/g, " ").trim();
	};
	return {
		found: Boolean(field),
		count: buttons.length,
		tags: buttons.map((b) => b.tagName),
		textContent: buttons.map((b) => b.textContent.replace(/\\s+/g, " ").trim()),
		accessibleName: buttons.map(name),
		ordinalHidden: buttons.length > 0 && buttons.every((b) => b.querySelector('span[aria-hidden="true"]')),
		disabled: buttons.map((b) => b.disabled),
		pointerEvents: buttons[0] ? getComputedStyle(buttons[0]).pointerEvents : null,
		eyebrow: document.querySelector('section[aria-label="Question from the agent"] p')?.textContent ?? null,
		alerts: [...document.querySelectorAll('[role="alert"]')].map((n) => n.textContent.replace(/\\s+/g, " ").trim()).filter(Boolean),
		incidentRow: document.body.innerText.includes("session incident"),
	};
})()`;

async function shoot(name) {
	mkdirSync(join(OUT, name), { recursive: true });
	const theme =
		(await evaluate(
			`document.documentElement.dataset.theme || (document.documentElement.classList.contains("dark") ? "localOperatorDark" : "localOperatorLight")`,
		)) ?? "localOperatorDark";
	const { data } = await send("Page.captureScreenshot", {
		format: "webp",
		quality: 88,
	});
	const path = join(OUT, name, `${theme}.webp`);
	writeFileSync(path, Buffer.from(data, "base64"));
	return { path, theme };
}

const record = {
	origin: ORIGIN,
	session: SESSION,
	viewport: { width: WIDTH, height: HEIGHT },
	driver: "scripts/click-proof.mjs",
	at: new Date().toISOString(),
};

/* Page-side errors and console output, collected so a failed run explains
 * itself: the round-1 rig died between its two frames with nothing recorded,
 * and the frames it left behind were read as evidence. */
const pageProblems = [];
browser.addEventListener("message", (event) => {
	const msg = JSON.parse(event.data);
	if (msg.method === "Runtime.exceptionThrown") {
		pageProblems.push(
			`exception: ${msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text}`,
		);
	}
	if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
		pageProblems.push(
			`console.error: ${msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(" ")}`,
		);
	}
});

try {
	await send("Page.enable");
	await send("Runtime.enable");
	await send("Emulation.setDeviceMetricsOverride", {
		width: WIDTH,
		height: HEIGHT,
		deviceScaleFactor: 1,
		mobile: false,
	});
	/*
	 * The provider-onboarding modal opens on any install with no credential and
	 * would cover the transcript, so it is settled the way a returning user has
	 * it: the store's own persisted completion flags (`onboarding-storage`),
	 * seeded before the app's modules run. `CLICK_PROOF_NO_SEED=1` skips it,
	 * which is how the effect of the seed itself was isolated.
	 */
	if (process.env.CLICK_PROOF_NO_SEED !== "1") {
		await send("Page.addScriptToEvaluateOnNewDocument", {
			source: `try {
			window.localStorage.setItem("onboarding-storage", JSON.stringify({
				state: { isModalComplete: true, isTourComplete: true },
				version: 0,
			}));
		} catch {}`,
		});
	}
	await send("Page.navigate", { url: `${ORIGIN}/#/chat/${SESSION}` });

	// Wait for the app SHELL, then arm the card.
	//
	// Order matters and cost a debugging round: the rig's host denies an
	// unanswered gate after 30 seconds when nothing can present it, and this
	// app takes 15-25 seconds to paint in a plain browser. A card armed at rig
	// startup therefore expires into the harness's "user escaped" answer before
	// the page that would click it exists, and the result reads like a failed
	// click. Arming when the composer is on screen is the ordering a user
	// produces: the surface is ready, then the question arrives.
	const shellDeadline = Date.now() + 90_000;
	for (;;) {
		if (await evaluate(`Boolean(document.querySelector('textarea[aria-label="Message"]'))`))
			break;
		if (Date.now() > shellDeadline)
			throw new Error("the app shell never painted");
		await wait(1000);
	}
	const armed = await evaluate(`fetch("${ORIGIN}/rig-arm").then((r) => r.json())`);
	record.arm = armed;

	const deadline = Date.now() + 60_000;
	for (;;) {
		if (await evaluate(`Boolean(document.querySelector('fieldset[aria-label="Answer options"]'))`))
			break;
		if (Date.now() > deadline) {
			throw new Error("the gate never rendered");
		}
		await wait(1000);
	}
	// Wait until the option is actually hit-testable, not merely present.
	//
	// The card arrives with the frontend state while the session's history rows
	// arrive on their own request: between the two, `CanonicalTranscript` is
	// collapsed, so the option exists in the DOM with a rect above the top of
	// the viewport. Measured on the running app at that moment: `top: -30`
	// inside a zero-height scroller, `elementFromPoint` returning a container.
	// Aiming then would either fail or, worse, land somewhere else.
	const hittableDeadline = Date.now() + 45_000;
	for (;;) {
		const probe = await evaluate(`(() => {
			const field = document.querySelector('fieldset[aria-label="Answer options"]');
			if (!field) return { ok: false, why: "no fieldset" };
			const buttons = [...field.querySelectorAll("button")];
			const strip = (b) => { const c = b.cloneNode(true);
				c.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
				return c.textContent.replace(/\\s+/g, " ").trim(); };
			const b = buttons.find((node) => strip(node).startsWith(${JSON.stringify(TARGET)}));
			if (!b) return { ok: false, why: "no option with that label" };
			const r = b.getBoundingClientRect();
			const x = Math.round(r.left + r.width / 2);
			const y = Math.round(r.top + r.height / 2);
			const hit = document.elementFromPoint(x, y);
			return { ok: Boolean(hit) && hit.closest("button") === b, x, y, top: Math.round(r.top), iw: innerWidth, ih: innerHeight };
		})()`);
		if (probe.ok) break;
		if (Date.now() > hittableDeadline)
			throw new Error(
				`the option never became hit-testable: ${JSON.stringify(probe)}`,
			);
		await wait(500);
	}

	record.before = await evaluate(READ_STATE);
	const before = await shoot("before-click");
	record.frames = { before: `${before.theme}.webp` };

	const aim = await evaluate(`(() => {
		const field = document.querySelector('fieldset[aria-label="Answer options"]');
		const buttons = [...field.querySelectorAll("button")];
		const strip = (b) => { const c = b.cloneNode(true);
			c.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
			return c.textContent.replace(/\\s+/g, " ").trim(); };
		const index = buttons.findIndex((b) => strip(b).startsWith(${JSON.stringify(TARGET)}));
		if (index < 0) return { ok: false, reason: "no option with that label" };
		const r = buttons[index].getBoundingClientRect();
		const x = Math.round(r.left + r.width / 2);
		const y = Math.round(r.top + r.height / 2);
		const hit = document.elementFromPoint(x, y);
		return {
			ok: Boolean(hit) && hit.closest("button") === buttons[index],
			x, y, index,
			label: strip(buttons[index]),
			hitTested: hit ? hit.tagName + (hit.closest("button") === buttons[index] ? " (the option itself)" : " (NOT the option)") : null,
			rect: { top: Math.round(r.top), height: Math.round(r.height) },
		};
	})()`);
	record.aim = aim;
	if (!aim.ok) throw new Error(`cannot aim at the option: ${JSON.stringify(aim)}`);

	// A real press and release at those pixels.
	for (const type of ["mousePressed", "mouseReleased"]) {
		await send("Input.dispatchMouseEvent", {
			type,
			x: aim.x,
			y: aim.y,
			button: "left",
			clickCount: 1,
		});
	}

	// The gate clearing IS the resolution: the owner's future returns and the
	// backend stops projecting a pending gate.
	const cleared = Date.now() + 30_000;
	let resolved = false;
	while (Date.now() < cleared) {
		if (!(await evaluate(`Boolean(document.querySelector('fieldset[aria-label="Answer options"]'))`))) {
			resolved = true;
			break;
		}
		await wait(250);
	}
	record.resolved = resolved;
	await wait(1500);
	record.after = await evaluate(READ_STATE);
	const after = await shoot("after-click");
	record.frames.after = `${after.theme}.webp`;

	writeFileSync(join(OUT, "click-result.json"), `${JSON.stringify(record, null, 2)}\n`);
	console.log(
		`click-proof: ${resolved ? "the gate resolved" : "the gate did NOT resolve"} at ${aim.x},${aim.y} -> ${aim.label}`,
	);
	if (!resolved) process.exitCode = 1;
} catch (error) {
	/*
	 * A FAILED RUN IS NOT EVIDENCE, so it does not overwrite the record the
	 * committed frames are read against. It writes a diagnostic beside it and
	 * exits non-zero - which is the property the round-1 rig lacked: it died
	 * mid-run, left its frames, and nothing about the run said so.
	 */
	record.error = String(error?.stack ?? error);
	record.pageProblems = pageProblems;
	record.pageText = await evaluate("document.body.innerText").catch(() => null);
	writeFileSync(
		join(OUT, "click-result.diagnostic.json"),
		`${JSON.stringify(record, null, 2)}\n`,
	);
	console.error(`click-proof FAILED: ${record.error}`);
	process.exitCode = 1;
} finally {
	try {
		browser.close();
		chrome.kill();
		/* The profile is Chrome's, and Chrome may still be releasing it; a
		 * failure to remove a temp directory must never replace the run's own
		 * error, which is what hid this run's first failure. */
		await wait(1000);
		rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	} catch {}
}
