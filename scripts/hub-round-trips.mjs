#!/usr/bin/env node
/**
 * How many requests one hub page costs, read off the page itself.
 *
 *     node scripts/hub-round-trips.mjs --origin=http://localhost:6007
 *     node scripts/hub-round-trips.mjs --stories=agent-hub-page--grid,agent-hub-page--signed-in
 *
 * Why this exists. "The hub feels slow" is a claim about request count, and no
 * screenshot can carry it: the frames show the same grid before and after. The
 * story installs a counting bridge (`agent-hub.stories.tsx`) that appends every
 * request it answers to a ledger, and this rig reads that ledger out of the
 * rendered page over CDP — the same page the evidence frames are taken from, so
 * the reading and the pictures cannot disagree about what ran.
 *
 * Two numbers per story, because the defect had two halves:
 *
 *   - the FIRST PAINT wave, which is the list plus whatever each card asks for
 *     on its own account; and
 *   - the FOCUS wave, which is what arrives again when the window is focused.
 *     React Query's focusManager refetches on `visibilitychange`, so the nudge
 *     below is the same event a user's window focus delivers. On the tree this
 *     replaces, the per-card status reads carried `refetchOnWindowFocus: true`
 *     while the list carried `false` — so the wave was made of the expensive
 *     half and none of the cheap one.
 *
 * The rig refuses a story that draws nothing (Storybook's own error display is
 * checked by name), because a ledger read from a crashed story is a measurement
 * of the crash.
 *
 * `NODE_TEST_CONTEXT` is not touched: this spawns no test runner.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withMockKeychain } from "./chrome-keychain.mjs";
import { isEntryPoint } from "./entry-point.mjs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** The stories this rig knows how to read, and what each one is for. */
export const HUB_STORIES = [
	[
		"agent-hub-page--grid",
		"signed out: the list alone should be the page's reads",
	],
	[
		"agent-hub-page--signed-in",
		"signed in: the list plus ONE batched status read",
	],
	["agent-hub-page--empty", "an empty catalogue is still one list read"],
	[
		"agent-hub-page--load-failed",
		"a refused list read is one read, not a retry loop",
	],
];

const ARGS = process.argv.slice(2);
const flag = (name) => {
	const hit = ARGS.find((arg) => arg.startsWith(`--${name}=`));
	return hit ? hit.slice(name.length + 3) : null;
};
const ORIGIN = flag("origin") ?? "http://localhost:6017";
const OUT = flag("out");
const STORIES = flag("stories")
	? HUB_STORIES.filter(([id]) => flag("stories").split(",").includes(id))
	: HUB_STORIES;

/** How long the page must be quiet before its wave is considered over. */
const SETTLE_MS = 2_000;
const SETTLE_POLL_MS = 200;
const SETTLE_TIMEOUT_MS = 20_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** The Chrome DevTools WebSocket address, as the child prints it on stderr. */
const DEBUGGER_URL = /ws:\/\/[^\s]+/;

/** A CDP client over Node's built-in WebSocket, in the idiom the other rigs use. */
const connect = async (userDataDir) => {
	const child = spawn(
		CHROME,
		withMockKeychain([
			"--headless=new",
			"--no-sandbox",
			"--disable-gpu",
			"--hide-scrollbars",
			`--user-data-dir=${userDataDir}`,
			"--remote-debugging-port=0",
			"about:blank",
		]),
		{ stdio: ["ignore", "ignore", "pipe"] },
	);
	const wsUrl = await new Promise((resolve, reject) => {
		let buffer = "";
		const timer = setTimeout(
			() => reject(new Error("Chrome did not report a debug port")),
			30_000,
		);
		child.stderr.on("data", (chunk) => {
			buffer += String(chunk);
			// Hoisted: a literal inside a callback is what `useTopLevelRegex`
			// reports, and `scripts/`'s backlog is burnt down as files are touched.
			const match = DEBUGGER_URL.exec(buffer);
			if (match) {
				clearTimeout(timer);
				resolve(match[0]);
			}
		});
		child.on("exit", () =>
			reject(new Error("Chrome exited before it was ready")),
		);
	});

	/*
	 * The browser endpoint speaks Target/Browser domains, not Page or Runtime -
	 * the page's own target is what those live on, and it is listed by the same
	 * debug port the ws URL names. (Counted here rather than assuming the first
	 * entry is the page: Electron rigs on this machine find its internals listed
	 * beside the renderer, so the type is read rather than implied.)
	 */
	const debugPort = new URL(wsUrl).port;
	const targets = await (
		await fetch(`http://127.0.0.1:${debugPort}/json/list`)
	).json();
	const page = targets.find((target) => target.type === "page");
	if (!page) throw new Error("Chrome listed no page target");

	const socket = new WebSocket(page.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		socket.addEventListener("open", resolve, { once: true });
		socket.addEventListener("error", reject, { once: true });
	});
	let nextId = 1;
	const pending = new Map();
	socket.addEventListener("message", (event) => {
		const message = JSON.parse(event.data);
		const waiter = pending.get(message.id);
		if (!waiter) return;
		pending.delete(message.id);
		if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
		else waiter.resolve(message.result);
	});
	const send = (method, params = {}) =>
		new Promise((resolve, reject) => {
			const id = nextId++;
			pending.set(id, { resolve, reject });
			socket.send(JSON.stringify({ id, method, params }));
		});
	return { child, socket, send };
};

const evaluate = async (send, expression, { awaitPromise = false } = {}) => {
	const { result, exceptionDetails } = await send("Runtime.evaluate", {
		expression,
		returnByValue: true,
		awaitPromise,
	});
	if (exceptionDetails) {
		throw new Error(`page evaluation failed: ${exceptionDetails.text}`);
	}
	return result.value;
};

/**
 * Wait until the ledger stops growing.
 *
 * A fixed sleep would be a guess about the slowest read in the wave, and the
 * number this rig exists to report is exactly the one a guess would change.
 */
const settle = async (send) => {
	const deadline = Date.now() + SETTLE_TIMEOUT_MS;
	let previous = -1;
	let quietSince = Date.now();
	while (Date.now() < deadline) {
		const length = await evaluate(
			send,
			"window.__hubLedger ? window.__hubLedger().length : 0",
		);
		if (length !== previous) {
			previous = length;
			quietSince = Date.now();
		} else if (Date.now() - quietSince >= SETTLE_MS) {
			return length;
		}
		await sleep(SETTLE_POLL_MS);
	}
	return previous;
};

/**
 * Wait until the rendered story has published its ledger.
 *
 * `iframe.html` renders Storybook's own chrome and then the story, and the
 * ledger is published by the story's module — so this is the difference between
 * measuring a page and measuring a loading screen.
 */
const waitForLedger = async (send) => {
	const deadline = Date.now() + SETTLE_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const published = await evaluate(
			send,
			'typeof window.__hubLedger === "function"',
		);
		if (published) return;
		await sleep(SETTLE_POLL_MS);
	}
};

const histogram = (ops) => {
	const counts = {};
	for (const op of ops) counts[op] = (counts[op] ?? 0) + 1;
	return Object.fromEntries(
		Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)),
	);
};

const main = async () => {
	const userDataDir = mkdtempSync(join(tmpdir(), "lo-hub-round-trips-"));
	const { child, socket, send } = await connect(userDataDir);
	const report = [];
	try {
		await send("Page.enable");
		await send("Runtime.enable");
		for (const [story, why] of STORIES) {
			await send("Page.navigate", {
				url: `${ORIGIN}/iframe.html?id=${story}&viewMode=story`,
			});
			/*
			 * WAIT FOR THE STORY TO MOUNT before reading anything.
			 *
			 * The first draft settled on a ledger that did not exist yet: the
			 * poll saw "no growth" in a page that had not run the story's module,
			 * and reported a story that publishes no ledger as a broken story.
			 * Loading is a state with a length, so it is waited on like one.
			 */
			await waitForLedger(send);
			/*
			 * Storybook keeps the error display MOUNTED and hides it, so asking
			 * whether the element exists answers yes on every healthy story: the
			 * first draft of this rig reported four crashes against a hub that had
			 * drawn four grids. Visibility is the question.
			 */
			const crashed = await evaluate(
				send,
				`(() => {
					const display = document.querySelector(".sb-errordisplay");
					return Boolean(display) && getComputedStyle(display).display !== "none";
				})()`,
			);
			if (crashed) throw new Error(`${story} crashed before it drew anything`);
			const first = await settle(send);
			const ledger = await evaluate(
				send,
				"window.__hubLedger ? window.__hubLedger() : null",
			);
			if (ledger === null) {
				throw new Error(`${story} publishes no ledger: it is not a hub story`);
			}

			/*
			 * The focus wave, twice: as delivered, and as delivered five minutes
			 * later.
			 *
			 * A FOCUS IS A TRANSITION, not a focus event. React Query's
			 * focusManager tracks one boolean and refetches when it goes false →
			 * true; a headless page is "visible" from the start, so dispatching
			 * `visibilitychange` on a page that already believes it is focused is
			 * a no-op and the first draft of this rig measured that no-op as
			 * "no wave". The nudge below goes hidden, waits a frame, and comes
			 * back — the same pair a user's window switch delivers.
			 *
			 * The second visit advances the CLOCK by six minutes first, because
			 * React Query only refetches a focused query whose data is stale and
			 * these reads carry a five-minute `staleTime`. It is the one fake in
			 * this file, named here: no query option changes, only whether the
			 * moment has arrived.
			 */
			await evaluate(
				send,
				`(() => {
				if (!window.__hubVisibilityPatched) {
					Object.defineProperty(document, "visibilityState", {
						configurable: true,
						get: () => window.__hubVisibility ?? "visible",
					});
					window.__hubVisibilityPatched = true;
				}
				return true;
			})()`,
			);
			/*
			 * BUBBLING, and it has to be: React Query's focusManager subscribes
			 * on `window`, and a `visibilitychange` fired at the document with
			 * the default `bubbles: false` never reaches it. Two drafts before
			 * this one measured a nudge nothing heard.
			 */
			const nudge = async (skewMs) => {
				const skew = skewMs
					? `if (!window.__hubClockSkew) {
							const real = Date.now;
							window.__hubClockSkew = ${skewMs};
							Date.now = () => real() + window.__hubClockSkew;
						}`
					: "";
				await evaluate(
					send,
					`(async () => {
						${skew}
						window.__hubVisibility = "hidden";
						document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
						await new Promise((resolve) => setTimeout(resolve, 60));
						window.__hubVisibility = "visible";
						document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
						window.dispatchEvent(new Event("focus"));
						return true;
					})()`,
					{ awaitPromise: true },
				);
			};

			await nudge(0);
			const afterFocus = await settle(send);
			const focusLedger = await evaluate(
				send,
				"window.__hubLedger ? window.__hubLedger() : []",
			);

			await nudge(6 * 60 * 1000);
			const afterStaleFocus = await settle(send);
			const staleLedger = await evaluate(
				send,
				"window.__hubLedger ? window.__hubLedger() : []",
			);

			report.push({
				story,
				why,
				firstPaint: first,
				afterFocus,
				focusWave: afterFocus - first,
				afterStaleFocus,
				staleFocusWave: afterStaleFocus - afterFocus,
				operations: histogram(ledger),
				focusOperations: histogram(focusLedger.slice(first)),
				staleFocusOperations: histogram(staleLedger.slice(afterFocus)),
			});
			console.log(
				`${story}: ${first} request(s) to first paint, ${afterFocus - first} on focus, ${afterStaleFocus - afterFocus} on a focus five minutes later`,
			);
			console.log(`  ${JSON.stringify(histogram(ledger))}`);
			if (afterFocus - first > 0) {
				console.log(
					`  focus: ${JSON.stringify(histogram(focusLedger.slice(first)))}`,
				);
			}
			if (afterStaleFocus - afterFocus > 0) {
				console.log(
					`  stale focus: ${JSON.stringify(histogram(staleLedger.slice(afterFocus)))}`,
				);
			}
		}
	} finally {
		socket.close();
		child.kill("SIGTERM");
		/*
		 * Chrome keeps writing its own profile for a moment after SIGTERM, so the
		 * removal can lose the race with a directory it re-creates. A rig that
		 * died on its own cleanup would report a measurement it had already
		 * taken as a failure.
		 */
		try {
			rmSync(userDataDir, { recursive: true, force: true });
		} catch {
			console.warn(
				`left ${userDataDir} behind: Chrome was still writing to it`,
			);
		}
	}
	if (OUT) writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
	return report;
};

if (isEntryPoint(import.meta.url)) {
	await main();
}
