#!/usr/bin/env node
/**
 * Drive the Q-7 slash-command trap through the real composer.
 *
 * Q-7 is two defects in one paste: an over-cap slash-command argument was
 * refused with "Invalid desktop operation." (a sentence naming nothing the user
 * can act on), and the composer was CLEARED, destroying the text the refusal
 * asks them to shorten. Both halves have to be shown against the running app,
 * because both live in the seam between the pre-flight, the dispatcher's return
 * value and the composer's clear -- a unit test can pin the contract but only
 * the real surface proves the three agree.
 *
 * Same mechanism as `capture-413.mjs` beside it: raw CDP against a private
 * headless profile, the app's own `index.html` through `chat-413.vite.mjs`, and
 * `/__desktop` calling the same `requestDesktop` Electron's IPC handler calls.
 * The differences from that script are the case it drives and one addition:
 *
 * FOCUS EMULATION. A headless window is unfocused, and an unfocused window
 * throttles timers -- which makes anything time-driven read as broken and has
 * already produced false "frozen spinner" findings elsewhere in this project.
 * The send path here shows a pending state, so the window is focus-emulated
 * before anything is measured or photographed.
 *
 *     node capture-q7.mjs <out-dir>
 */

import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OUT = process.argv[2];
const ORIGIN = process.env.DESKTOP_413_ORIGIN ?? "http://localhost:5199";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** Same minimal CDP client as `capture-413.mjs`. */
class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.next = 0;
		this.pending = new Map();
		ws.addEventListener("message", (ev) => {
			const msg = JSON.parse(ev.data);
			if (msg.id !== undefined && this.pending.has(msg.id)) {
				const { resolve, reject } = this.pending.get(msg.id);
				this.pending.delete(msg.id);
				msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
			}
		});
	}
	send(method, params = {}) {
		const id = ++this.next;
		this.ws.send(JSON.stringify({ id, method, params }));
		return new Promise((resolve, reject) =>
			this.pending.set(id, { resolve, reject }),
		);
	}
}

let chrome = null;
let dataDir = null;
const teardown = () => {
	if (chrome) {
		chrome.kill("SIGKILL");
		chrome = null;
	}
	if (dataDir) {
		rmSync(dataDir, { recursive: true, force: true });
		dataDir = null;
	}
};
const sweepStaleProfiles = () => {
	const mine = `lo-q7-${process.pid}`;
	for (const name of readdirSync(tmpdir())) {
		if (!name.startsWith("lo-q7-") || name === mine) continue;
		try {
			process.kill(Number(name.slice("lo-q7-".length)), 0);
			continue;
		} catch {
			rmSync(join(tmpdir(), name), { recursive: true, force: true });
		}
	}
};
process.on("exit", teardown);
for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => {
		teardown();
		process.exit(1);
	});
}

// One past the 200,000-character schema cap: the smallest input that proves the
// boundary rather than a number chosen to be comfortably over it.
const OVER_CAP = 200_001;

const main = async () => {
	sweepStaleProfiles();
	mkdirSync(OUT, { recursive: true });
	dataDir = join(tmpdir(), `lo-q7-${process.pid}`);
	mkdirSync(dataDir, { recursive: true });

	chrome = spawn(CHROME, [
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
		const timer = setTimeout(
			() => reject(new Error("Chrome did not report a debug port")),
			30_000,
		);
		chrome.stderr.on("data", (d) => {
			buf += d.toString();
			const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
			if (m) {
				clearTimeout(timer);
				resolve(m[1]);
			}
		});
		chrome.on("exit", (code) =>
			reject(new Error(`Chrome exited early (${code})`)),
		);
	});
	const { host } = new URL(wsUrl);
	const list = await fetch(`http://${host}/json`).then((r) => r.json());
	const target = list.find((t) => t.type === "page");
	const ws = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		ws.addEventListener("open", resolve, { once: true });
		ws.addEventListener("error", reject, { once: true });
	});
	const cdp = new Cdp(ws);
	await cdp.send("Page.enable");
	await cdp.send("Runtime.enable");
	// Before any measurement: an unfocused window throttles timers, so a pending
	// state or a settling banner reads as stuck when it is only starved.
	await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
	await cdp.send("Emulation.setDeviceMetricsOverride", {
		width: 1440,
		height: 900,
		deviceScaleFactor: 2,
		mobile: false,
	});

	const evaluate = async (expression) => {
		const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
		});
		if (exceptionDetails)
			throw new Error(exceptionDetails.exception?.description ?? "eval failed");
		return result.value;
	};
	const shoot = async (name) => {
		const { data } = await cdp.send("Page.captureScreenshot", {
			format: "png",
		});
		writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, "base64"));
		process.stdout.write(`captured ${name}.png\n`);
	};
	const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	// React tracks the textarea's value on its own descriptor, so a plain
	// assignment is not seen. Setting through the prototype setter and firing a
	// bubbling input event is how a real keystroke reaches the component.
	const type = (text) =>
		evaluate(`(() => {
			const area = document.querySelector('[aria-label="Message"]');
			const setter = Object.getOwnPropertyDescriptor(
				window.HTMLTextAreaElement.prototype, 'value').set;
			setter.call(area, ${text});
			area.dispatchEvent(new Event('input', { bubbles: true }));
			return area.value.length;
		})()`);
	const composerLength = () =>
		evaluate(
			`document.querySelector('[aria-label="Message"]').value.length`,
		);
	const banner = () =>
		evaluate(`(() => {
			const alerts = [...document.querySelectorAll('[role="alert"]')]
				.map((node) => node.innerText.trim())
				.filter((text) => text && !text.includes('Retry refresh'));
			return alerts[0] ?? '';
		})()`);
	// The transcript is where a slash-command refusal lands (it is a system note,
	// not the composer's send-error banner), so the sentence is read from there.
	const lastNote = () =>
		evaluate(`(() => {
			const text = document.body.innerText;
			const line = text.split('\\n').reverse()
				.find((l) => l.includes('characters') || l.includes('could not run')
					|| l.includes('one command can carry'));
			return line ? line.trim() : '';
		})()`);

	const report = {};

	// A first-run profile raises the six-step "Connect a provider" onboarding
	// wizard OVER the composer, and it has no skip control. Left up, every later
	// selector silently addresses nothing and the run reports a zero-length
	// composer - which is indistinguishable from a passing draft-retention check,
	// and is exactly the false PASS this capture exists to avoid.
	//
	// Seeded through the app's OWN persisted completion flags
	// (`onboarding-store.ts`, zustand `persist` under "onboarding-storage")
	// rather than by hiding the dialog, so the app boots into the ordinary
	// post-onboarding state a returning user has. Nothing on the path under test
	// is stubbed.
	await cdp.send("Page.navigate", { url: ORIGIN });
	await settle(2000);
	await evaluate(`(() => {
		localStorage.setItem("onboarding-storage", JSON.stringify({
			state: { isModalComplete: true, isTourComplete: true, currentStep: "congratulations" },
			version: 0,
		}));
		return true;
	})()`);
	await cdp.send("Page.reload", { ignoreCache: true });
	await settle(9000);
	// Asserted, not assumed: if the wizard is still up, every number below is
	// about a covered composer and the run must be read as void.
	report.dialogStillOpen = await evaluate(
		`Boolean(document.querySelector('[role="dialog"]'))`,
	);
	await evaluate(`(() => {
		const button = [...document.querySelectorAll('button')]
			.find((b) => b.textContent?.trim() === 'New chat' && b.closest('main'));
		if (button) button.click();
		return Boolean(button);
	})()`);
	await settle(2500);
	// The composer must actually exist before this run means anything.
	report.composerPresent = await evaluate(
		`Boolean(document.querySelector('[aria-label="Message"]'))`,
	);

	// 0. Open a real conversation FIRST. A slash command with no session takes an
	//    earlier branch entirely ("/theme needs an open conversation"), which is
	//    a different, correct refusal - and a run that stops there photographs a
	//    passing composer while never reaching the budget check at all.
	await type(`'hello'`);
	await settle(1000);
	await evaluate(
		`document.querySelector('button[aria-label="Send message"]').click()`,
	);
	await settle(12000);
	report.sessionOpened = await evaluate(
		`/\\/chat\\/[0-9a-f]{12}/.test(location.pathname)`,
	);
	await shoot("q7-session-open");

	// 1. An over-cap slash command. Must be refused with a sentence naming the
	//    CHARACTER limit, and must leave the draft in the composer.
	const typed = await type(
		`'/theme ' + 'x'.repeat(${OVER_CAP})`,
	);
	report.typedLength = typed;
	await settle(1200);
	await shoot("q7-composed");
	await evaluate(
		`document.querySelector('button[aria-label="Send message"]').click()`,
	);
	await settle(9000);
	await shoot("q7-refused");
	report.refusalNote = await lastNote();
	report.refusalBanner = await banner();
	report.composerAfterRefusal = await composerLength();

	// 2. The recovery the sentence asks for: shorten it and send. This is what
	//    makes the refusal escapable rather than a trap.
	await type(`'/theme dracula'`);
	await settle(1200);
	await evaluate(
		`document.querySelector('button[aria-label="Send message"]').click()`,
	);
	await settle(9000);
	await shoot("q7-after-shortening");
	report.composerAfterShortenedSend = await composerLength();
	report.noteAfterShortenedSend = await lastNote();

	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	ws.close();
	teardown();
};

main().catch((error) => {
	process.stderr.write(`${error.stack ?? error}\n`);
	teardown();
	process.exit(1);
});
