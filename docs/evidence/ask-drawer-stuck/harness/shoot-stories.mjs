/**
 * The states no live run reaches on demand: the empty-but-published queue, the
 * unread frame, a runtime with no queued engine at all, and the wire bound's own
 * frame - a live tally with the row list dropped.
 *
 * One Storybook and ONE private headless Chrome (the repository's own
 * `chrome-keychain.mjs` switch applied, so it never reaches Keychain Services
 * under a scratch profile), driven over raw CDP at 1280x800. Each state is shot
 * in BOTH brand palettes, which is the set's own convention, and the PNGs are
 * re-encoded to the canonical `.webp` the sweep judges, named for the palette
 * they render (`<state>/<theme>.webp`).
 *
 * Why a scratch rig rather than `scripts/capture-evidence.mjs`: these stories are
 * new in this change, so they are not on that tool's story list, and adding them
 * there is what makes a set part of the SWEEP rather than a declared
 * supplementary set. The drawer's own evidence set took the same route.
 *
 * usage: node shoot-stories.mjs <storybook-origin> <out-root>
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { withMockKeychain } from "../../../../scripts/chrome-keychain.mjs";

const ORIGIN = process.argv[2] ?? "http://localhost:5313";
const OUT = process.argv[3] ?? "states";
const WAIT_MS = 30_000;

/*
 * THE STATES, and the story each one is. The ids are the shipped stories'
 * (`Chat/Asks/Queued asks` -> `chat-asks-queued-asks`), so a reviewer can open
 * the same frame by hand at the same URL.
 *
 * EACH STATE'S DIRECTORY IS `story-<state>` (remediation round 1): the set ships
 * `story-empty-wire/`, `story-unread/`, `story-unsupported/` and `story-clipped-rows/`
 * beside its `live-*` siblings, so a raw `<out-root>/<state>` would have written the
 * frames somewhere the set does not carry and left the committed ones stale - which
 * is exactly what happened on the first attempt at this round.
 */
const STATES = [
	["empty-wire", "chat-asks-queued-asks--empty-wire-frame"],
	["unread", "chat-asks-queued-asks--unread-frame"],
	["unsupported", "chat-asks-queued-asks--unsupported-backend"],
	/*
	 * `{asks: null, asks_open: 4, asks_truncated: true}` - the wire bound's frame
	 * (remediation round 1, R1). Added with that fix: it is the state the drawer must
	 * keep and must count, and no live rig reaches it on demand (the seed's owners
	 * always publish rows).
	 */
	["clipped-rows", "chat-asks-queued-asks--clipped-rows-frame"],
];
const THEMES = ["localOperatorDark", "localOperatorLight"];

/**
 * Chrome announces its own debug port on stderr; the pattern is module scope so the
 * listener does not rebuild it per chunk.
 */
const DEVTOOLS_URL = /DevTools listening on (ws:\/\/[^\s]+)/;

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const dataDir = mkdtempSync(join(tmpdir(), "asks-stuck-stories-"));
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
		if (await evaluate(expression)) return true;
		if (Date.now() - start > timeoutMs) {
			throw new Error(`timed out waiting for ${label}`);
		}
		await wait(150);
	}
}

/*
 * WHAT THE SURFACE SAYS, read off the DOM at the moment of the shutter. A frame
 * on its own cannot tell a reader whether the dismiss was on screen, and that is
 * the whole claim of this set, so the probe travels with the frames.
 */
const PROBE = `(() => {
	const q = (sel) => document.querySelector(sel);
	const n = (sel) => document.querySelectorAll(sel).length;
	const root = q('[data-lo-ask-surfaces]');
	return {
		theme: document.documentElement.getAttribute('data-theme'),
		drawer: n('[data-ask-drawer]'),
		closeAsks: n('[aria-label="Close asks"]'),
		scopeLine: (q('[data-ask-scope]') || {}).textContent ?? null,
		emptySentence: (q('[data-lo-ask-empty]') || {}).textContent ?? null,
		bodyText: root ? root.innerText.replace(/\\s+/g, ' ').trim().slice(0, 200) : null,
		rows: n('[data-lo-ask-row]'),
	};
})()`;

const report = { states: {}, failures: [] };
mkdirSync(OUT, { recursive: true });

try {
	await send("Page.enable");
	await send("Runtime.enable");

	for (const [state, id] of STATES) {
		const dir = `story-${state}`;
		mkdirSync(join(OUT, dir), { recursive: true });
		for (const theme of THEMES) {
			await send("Emulation.setDeviceMetricsOverride", {
				width: 1280,
				height: 800,
				deviceScaleFactor: 1,
				mobile: false,
			});
			await send("Page.navigate", {
				url: `${ORIGIN}/iframe.html?id=${id}&args=theme:${theme}`,
			});
			await waitFor(
				`document.querySelector('[data-lo-ask-surfaces]') !== null`,
				`${state} in ${theme}`,
			);
			/* A settle beat after the theme bridge repaints the variables. */
			await wait(700);
			const probe = await evaluate(PROBE);
			const { data } = await send("Page.captureScreenshot", {
				format: "png",
			});
			const file = join(OUT, dir, `${theme}.webp`);
			await sharp(Buffer.from(data, "base64"))
				.webp({ quality: 92 })
				.toFile(file);
			report.states[`${state}/${theme}`] = { file, ...probe };
		}
	}
} catch (error) {
	report.failures.push(String(error?.stack ?? error));
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
