#!/usr/bin/env node
/**
 * Photograph the chat surface while its session stream is refused.
 *
 * Why this exists rather than a hand-taken screenshot: it drives Chrome over raw
 * CDP exactly the way `scripts/capture-evidence.mjs` does - same private
 * `--headless=new` profile under the system temp dir, same DevTools websocket,
 * same `Page.captureScreenshot` - so these frames come from the repo's
 * established capture mechanism and not from a second browser stack. The
 * difference from that script is only WHAT is photographed: it sweeps Storybook
 * stories across twelve themes, and this drives the real chat surface through a
 * stream refusal.
 *
 *     node capture.mjs <out-dir> <case> [origin]
 *
 * `case` names the state, and each case ASSERTS the state it photographed
 * before writing the frame - a blank or wrong frame has to fail here rather
 * than be noticed in review:
 *
 *   - `refused`   the stream is refused and never recovers (stub `down`).
 *   - `recovered` the stream is refused, then served (stub `flaky`).
 *
 * The measured assertions come from the page itself: the presence of the
 * greeting, the number of painted transcript rows, and whether a Retry control
 * exists.
 */

import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OUT = process.argv[2];
const CASE = process.argv[3] ?? "recovered";
const ORIGIN = process.argv[4] ?? process.env.SESSION_LOAD_ORIGIN ?? "http://localhost:5211";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
/** The session the stub catalogue lists. Clicked, not assumed. */
const SESSION = process.env.SESSION_LOAD_SESSION ?? "92602660eb9e";

/** Same minimal CDP client as `scripts/capture-evidence.mjs`. */
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
		// Chrome's profile is still being written when the process is killed, so a
		// single recursive remove can race it. Best-effort: a leftover temp
		// profile is swept by the next run, and failing the capture over it would
		// lose the frame that was already taken.
		try {
			rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
		} catch {
			// swept on the next run
		}
		dataDir = null;
	}
};
process.on("exit", teardown);

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const main = async () => {
	mkdirSync(OUT, { recursive: true });
	// A profile left behind by a killed run would carry the previous run's
	// last-opened session and drafts, which is how one evidence set ends up
	// photographing another's state.
	for (const entry of readdirSync(tmpdir())) {
		if (entry.startsWith("lo-session-load-"))
			rmSync(join(tmpdir(), entry), { recursive: true, force: true });
	}
	dataDir = join(tmpdir(), `lo-session-load-${process.pid}`);
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
	// The viewport the app's own evidence set uses, read back below so the frame
	// can be labelled with a size the page really had.
	await cdp.send("Emulation.setDeviceMetricsOverride", {
		width: 1380,
		height: 872,
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
		const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
		writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, "base64"));
		process.stdout.write(`captured ${name}.png\n`);
	};

	cdp.ws.addEventListener("message", (ev) => {
		const msg = JSON.parse(ev.data);
		if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error")
			process.stdout.write(`page error: ${JSON.stringify(msg.params.args.map((a) => a.value ?? a.description))}\n`);
		if (msg.method === "Runtime.exceptionThrown")
			process.stdout.write(`page exception: ${msg.params.exceptionDetails.text}\n`);
	});
	await cdp.send("Page.navigate", { url: `${ORIGIN}/` });
	
	process.stdout.write(`body: ${JSON.stringify((await evaluate("document.body.innerText")).slice(0, 600))}\n`);

	/** What the page is showing, read from the DOM rather than assumed. */
	const readState = () =>
		evaluate(`(() => {
			const text = document.body.innerText;
			const transcript = document.querySelector('[data-lo-transcript-content]');
			return {
				greeting: text.includes("What can I help you with today?"),
				loading: document.querySelector('[aria-label="Loading conversation"]') !== null,
				rows: transcript ? transcript.querySelectorAll(':scope > div').length : 0,
				retry: (() => {
					// Scoped to the transcript's own pane, not the page: the shell also
					// carries a legacy server banner with its own "Retry", and an
					// unscoped query would report that button as this control.
					const pane = transcript?.closest("div")?.parentElement ?? document.body;
					return [...pane.querySelectorAll("button")].filter((b) => b.textContent.trim() === "Retry").length;
				})(),
				// What the transcript pane actually says, so a frame that lost its
				// notice fails here rather than in review.
				notice: transcript
					? transcript.innerText.replace(/\\s+/g, " ").trim().slice(0, 160)
					: null,
				size: [window.innerWidth, window.innerHeight],
			};
		})()`);

	// Open the conversation the stub catalogue lists. The row is clicked through
	// the app's own handler; nothing is forced into the store.
	const opened = await (async () => {
		for (let attempt = 0; attempt < 40; attempt += 1) {
			// The row lives under a COLLAPSED "Previous chats" heading: the count
			// says the row is in the list while nothing is rendered for it. So the
			// group is opened through the app's own control and THEN the row is
			// clicked - both are real presses, nothing is forced into the store.
			const clicked = await evaluate(`(() => {
				const clickable = [...document.querySelectorAll("button, [role='button'], a")];
				const row = clickable.find((el) => el.textContent.trim() === "Failing deploys" || el.textContent.includes("Failing deploys"));
				if (row) { row.click(); return "row"; }
				const group = clickable.find((el) => el.textContent.trim() === "Previous chats" || el.textContent.includes("Previous chats"));
				if (group) { group.click(); return "group"; }
				return false;
			})()`);
			if (clicked === "row") return true;
			await settle(250);
		}
		return false;
	})();
	if (!opened) {
		process.stdout.write(`body: ${JSON.stringify((await evaluate("document.body.innerText")).slice(0, 800))}\n`);
		process.stdout.write(`matches: ${JSON.stringify(await evaluate(`(() => [...document.querySelectorAll("*")].filter((el) => el.children.length === 0 && el.textContent.includes("Failing")).map((el) => el.tagName + "." + el.className))()`))}\n`);
		throw new Error("the sidebar never listed the conversation");
	}
	// Long enough for the retry schedule to run out in `refused` (23.5s of
	// backoff) and for the served snapshot to paint in `recovered`.
	await settle(CASE === "refused" ? 30_000 : 4_000);
	// One more settle for the transcript's own layout pass.
	await settle(1_000);

	const state = await readState();
	process.stdout.write(`${CASE} state ${JSON.stringify(state)}\n`);

	if (CASE === "refused") {
		// The whole point: the app must NOT claim this conversation is empty, and
		// it must offer a way back rather than sitting silent.
		if (state.greeting)
			throw new Error("refused: the greeting is painted over a conversation that is not empty");
		if (state.retry < 1)
			throw new Error("refused: no Retry control reached the user");
		if (state.rows < 1)
			throw new Error("refused: the failure notice is not rendered where the reader can see it");
		if ((state.notice ?? "").trim() === "")
			throw new Error("refused: the transcript pane is blank, so the app failed silently");
	} else if (CASE === "before") {
		/*
		 * The defect frame, captured from the tree WITHOUT the fix and asserted so
		 * it cannot be mistaken for a working state: the conversation has rows on
		 * the stub, the stream was refused, and the app paints the greeting over
		 * it - the operator's screenshot. `rows === 0` and `greeting` are the two
		 * halves of the claim being made about this frame.
		 */
		if (!state.greeting)
			throw new Error("before: the greeting is missing, so this tree already carries the fix");
		if (state.rows !== 0)
			throw new Error(`before: expected an empty transcript, got ${state.rows} rows`);
		if (state.retry > 0)
			throw new Error("before: a Retry control exists, so this tree is not the pre-fix behaviour");
	} else {
		if (state.rows < 2)
			throw new Error(`recovered: the transcript painted ${state.rows} rows`);
		if (state.greeting)
			throw new Error("recovered: the greeting is painted over a conversation with rows");
	}

	await shoot(`${CASE}`);
	process.stdout.write(`viewport ${state.size[0]}x${state.size[1]}\n`);
	/*
	 * Leave the page before killing Chrome, so the open SSE stream is closed by
	 * the CLIENT rather than by a SIGKILL'd socket. Killing the browser under an
	 * in-flight response is what made the dev server's own proxy throw
	 * `ERR_HTTP_HEADERS_SENT` on a later write to that response, which took the
	 * whole server down mid-capture (the next run then failed with "the sidebar
	 * never listed the conversation" and no request reached the stub at all).
	 */
	await cdp.send("Page.navigate", { url: "about:blank" }).catch(() => {});
	await settle(750);
	teardown();
};

main().catch((error) => {
	teardown();
	process.stderr.write(`${error.stack}\n`);
	process.exit(1);
});
