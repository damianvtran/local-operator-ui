#!/usr/bin/env node
/**
 * Photograph the sign-in dialog's footer at a settled MCP grant.
 *
 *     node docs/evidence/mcp-auth-complete/harness/capture.mjs
 *         [--tree=after|before] [--themes=localOperatorDark,localOperatorLight]
 *         [--out=<dir>] [--port=5213]
 *
 * Why this exists rather than a hand-taken screenshot: it drives Chrome over raw
 * CDP the way `scripts/capture-evidence.mjs` does — a private `--headless=new`
 * profile under the system temp dir, the DevTools websocket, and
 * `Page.captureScreenshot` — so these frames come from the repository's
 * established capture mechanism and not from a second browser stack. What
 * differs from that script is only what is photographed: it sweeps Storybook
 * stories across twelve themes, and this drives one shipped dialog through the
 * bridge that ships.
 *
 * `--tree` names WHICH TREE the frames are claimed to be of, and each case
 * ASSERTS the footer it photographed before the frame is written:
 *
 *   - `after`  (the default): the completed grant offers `Close` alone. The
 *              `failed` and `cancelled` control frames must still offer both
 *              controls, because a frame that showed the retry gone everywhere
 *              would be evidence of a blanket removal rather than of this fix.
 *   - `before`: the completed grant offers `Close` AND `Try again` — the defect
 *              this change removes. Run it on the base tree (`origin/main`), with
 *              the harness copied in, and the assertion is what stops a `before`
 *              frame being captured from a tree that no longer reproduces it.
 *
 * The two expectations are exclusive, so a rig pointed at the wrong tree fails
 * instead of committing a mislabelled frame. `assertFramePaints` runs on every
 * frame on the way out: a blank or unstyled frame has to fail here rather than be
 * noticed in review.
 *
 * The viewport is 1000x700 at device scale factor 2, and the frame is CLIPPED to
 * the dialog's own box plus 16px of the scrim around it — the subject is the
 * footer, and a 2760px-wide frame of a 576px dialog spends most of its pixels on
 * nothing.
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assertFramePaints } from "../../../../scripts/check-evidence.mjs";
/* The one thing this rig shares with `scripts/`: the switch that keeps its own
   Chrome out of the operator's keychain. See `scripts/chrome-keychain.mjs` for
   the measurements — a scratch `HOME` has no login keychain, and Chrome then
   asks the operator to authorize creating one. */
import { withMockKeychain } from "../../../../scripts/chrome-keychain.mjs";

const ROOT = resolve(import.meta.dirname, "../../../..");
const SURFACE = resolve(import.meta.dirname, "..");
const CHROME =
	process.env.CHROME_PATH ??
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const ARGS = process.argv.slice(2);
const flag = (name, fallback) => {
	const hit = ARGS.find((arg) => arg.startsWith(`--${name}=`));
	return hit ? hit.slice(name.length + 3) : fallback;
};

const TREE = flag("tree", "after");
if (TREE !== "after" && TREE !== "before") {
	console.error(`--tree must be \`after\` or \`before\`, not \`${TREE}\``);
	process.exit(2);
}
const THEMES = flag("themes", "localOperatorDark,localOperatorLight").split(",");
const PORT = Number(flag("port", "5213"));
const OUT = resolve(flag("out", SURFACE));
/** The scrim kept around the dialog so the panel reads as a modal, not a crop. */
const PADDING = 16;
/** The app's own evidence scale; a PNG frame at 2x is legible at review size. */
const SCALE = 2;

/**
 * The cases this tree can show, and the footer each one must have.
 *
 * `before` is the base tree, whose only subject is the defect: the completed
 * grant. The control frames come from the fixed tree, where the change is
 * claimed to be scoped.
 */
const CASES =
	TREE === "before"
		? [{ status: "complete", retry: true }]
		: [
				{ status: "complete", retry: false },
				{ status: "failed", retry: true },
				{ status: "cancelled", retry: true },
			];

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

/** A minimal CDP client, the same shape `scripts/capture-evidence.mjs` uses. */
class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.next = 0;
		this.pending = new Map();
		ws.addEventListener("message", (event) => {
			const message = JSON.parse(event.data);
			if (message.id !== undefined && this.pending.has(message.id)) {
				const { resolve: done, reject } = this.pending.get(message.id);
				this.pending.delete(message.id);
				message.error
					? reject(new Error(message.error.message))
					: done(message.result);
			}
		});
	}
	send(method, params = {}) {
		const id = ++this.next;
		this.ws.send(JSON.stringify({ id, method, params }));
		return new Promise((done, reject) =>
			this.pending.set(id, { resolve: done, reject }),
		);
	}
}

let vite = null;
let chrome = null;
let profile = null;
let socket = null;
let viteLog = "";

const teardown = () => {
	if (vite) {
		/*
		 * The GROUP, not the wrapper this handle names. `pnpm` is a shim that execs
		 * the Vite server as a child, so a signal to the wrapper alone leaves the
		 * server running and holding the port — and the run that ends on the error
		 * path is exactly the one that has to clean up after itself. See the spawn's
		 * own note.
		 */
		try {
			process.kill(-vite.pid, "SIGKILL");
		} catch {
			vite.kill("SIGKILL");
		}
		vite = null;
	}
	if (chrome) {
		chrome.kill("SIGKILL");
		chrome = null;
	}
	/* The DevTools websocket is a live handle on the event loop: without closing
	   it the driver prints its last line and then hangs forever instead of
	   exiting, which reads as a capture that never finished. */
	if (socket) {
		socket.close();
		socket = null;
	}
	if (profile) {
		/* Chrome is still writing its profile when it is killed, so a single
		   recursive remove races it. Best-effort: a leftover temp profile is swept
		   by the next run, and failing over it would lose frames already taken. */
		try {
			rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
		} catch {
			// swept on the next run
		}
		profile = null;
	}
};
process.on("exit", teardown);
process.on("SIGINT", () => {
	teardown();
	process.exit(130);
});

async function waitForServer(url, attempts = 160) {
	for (let attempt = 0; attempt < attempts; attempt++) {
		try {
			if ((await fetch(url)).ok) return;
		} catch {
			// not up yet
		}
		await sleep(500);
	}
	throw new Error(`${url} never came up`);
}

async function launchChrome() {
	profile = join(tmpdir(), `lo-mcp-auth-complete-${process.pid}`);
	mkdirSync(profile, { recursive: true });
	chrome = spawn(
		CHROME,
		withMockKeychain([
			"--headless=new",
			"--no-first-run",
			"--no-default-browser-check",
			"--disable-gpu",
			"--hide-scrollbars=false",
			`--user-data-dir=${profile}`,
			"--remote-debugging-port=0",
			"about:blank",
		]),
	);
	const wsUrl = await new Promise((done, reject) => {
		let buffer = "";
		const timer = setTimeout(
			() => reject(new Error("Chrome reported no debug port")),
			30_000,
		);
		chrome.stderr.on("data", (chunk) => {
			buffer += chunk.toString();
			const match = buffer.match(/DevTools listening on (ws:\/\/[^\s]+)/);
			if (match) {
				clearTimeout(timer);
				done(match[1]);
			}
		});
		chrome.on("exit", (code) => reject(new Error(`Chrome exited (${code})`)));
	});
	const { host } = new URL(wsUrl);
	const list = await fetch(`http://${host}/json`).then((response) =>
		response.json(),
	);
	const target = list.find((candidate) => candidate.type === "page");
	const ws = new WebSocket(target.webSocketDebuggerUrl);
	socket = ws;
	await new Promise((open, reject) => {
		ws.addEventListener("open", open, { once: true });
		ws.addEventListener("error", reject, { once: true });
	});
	const cdp = new Cdp(ws);
	await cdp.send("Page.enable");
	await cdp.send("Runtime.enable");
	ws.addEventListener("message", (event) => {
		const message = JSON.parse(event.data);
		if (message.method === "Runtime.exceptionThrown")
			process.stdout.write(
				`page exception: ${message.params.exceptionDetails.text}\n`,
			);
	});
	return cdp;
}

async function main() {
	mkdirSync(OUT, { recursive: true });
	console.log(`tree ${TREE}: ${CASES.length * THEMES.length} frames into ${OUT}`);

	vite = spawn(
		"pnpm",
		["vite", "--config", join(import.meta.dirname, "mcp-auth-complete.vite.mjs")],
		{
			cwd: ROOT,
			env: { ...process.env, MCP_AUTH_EVIDENCE_PORT: String(PORT) },
			stdio: ["ignore", "pipe", "pipe"],
			/*
			 * `detached` puts the wrapper and the Vite server it execs into a process
			 * group of their own, which is the only handle that reaches the server:
			 * `vite.kill()` alone signals the `pnpm` shim and leaves the server
			 * holding the port, so a run that ends on its error path (a page that
			 * never reports its state) used to leak one and make the next run fail
			 * for a reason that reads as a state failure (QA round 1, Q3). The
			 * teardown signals the group for the same reason.
			 */
			detached: true,
		},
	);
	const collect = (chunk) => {
		viteLog += chunk;
	};
	vite.stdout.on("data", collect);
	vite.stderr.on("data", collect);

	const origin = `http://localhost:${PORT}`;
	const page = `${origin}/docs/evidence/mcp-auth-complete/harness/mcp-auth-complete.html`;
	await waitForServer(page);
	const cdp = await launchChrome();

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

	for (const testCase of CASES) {
		for (const theme of THEMES) {
			await cdp.send("Emulation.setDeviceMetricsOverride", {
				width: 1000,
				height: 700,
				deviceScaleFactor: SCALE,
				mobile: false,
			});
			await cdp.send("Page.navigate", {
				url: `${page}?case=${testCase.status}&theme=${theme}`,
			});

			let state = null;
			for (let attempt = 0; attempt < 240; attempt++) {
				state = await evaluate("window.__mcpAuthEvidence || null");
				if (state) break;
				await sleep(250);
			}
			if (!state)
				throw new Error(
					`${testCase.status}/${theme}: the harness never reported the state it settled in`,
				);

			/*
			 * The state the FRAME is claimed to be of, asserted before the shutter.
			 * The sentence is read from the dialog's own body, so a frame cannot be
			 * labelled with a state its body does not state.
			 */
			const expectedSentence = `Sign-in ${testCase.status}.`;
			if (state.sentence !== expectedSentence)
				throw new Error(
					`${testCase.status}/${theme}: the dialog says ${JSON.stringify(state.sentence)}, expected ${JSON.stringify(expectedSentence)}`,
				);
			if (!(state.footer ?? []).includes("Close"))
				throw new Error(
					`${testCase.status}/${theme}: the footer has no Close: ${JSON.stringify(state.footer)}`,
				);
			const hasRetry = (state.footer ?? []).includes("Try again");
			if (hasRetry !== testCase.retry)
				throw new Error(
					`${testCase.status}/${theme}: on the \`${TREE}\` tree the footer must ${testCase.retry ? "still carry" : "not carry"} \`Try again\`, and it reads ${JSON.stringify(state.footer)}`,
				);
			const theme_ = await evaluate("document.documentElement.dataset.theme");
			if (theme_ !== theme)
				throw new Error(
					`a frame named ${theme} carries theme ${JSON.stringify(theme_)}`,
				);

			const [x, y, width, height] = state.rect;
			const { data } = await cdp.send("Page.captureScreenshot", {
				format: "png",
				clip: {
					x: Math.max(0, x - PADDING),
					y: Math.max(0, y - PADDING),
					width: width + PADDING * 2,
					height: height + PADDING * 2,
					scale: 1,
				},
			});
			const dir = join(OUT, `${testCase.status}-${TREE}`);
			mkdirSync(dir, { recursive: true });
			const frame = join(dir, `${theme}.png`);
			writeFileSync(frame, Buffer.from(data, "base64"));
			assertFramePaints(frame, theme);
			console.log(
				`${testCase.status}-${TREE}/${theme}.png: footer ${JSON.stringify(state.footer)}, ` +
					`body ${JSON.stringify(state.sentence)}, dialog ${width}x${height} at ${x},${y}, ` +
					`page ${state.size.join("x")}`,
			);
		}
	}
	teardown();
	console.log(`frames in ${OUT}`);
	/*
	 * Exit rather than draining: the websocket, Chrome's piped stderr and Vite's
	 * two pipes are all handles on the loop, and a rig that has printed its last
	 * line and then sits there reads as a capture that never finished — which is
	 * how a complete run came to be killed by its own timeout with every frame
	 * already on disk.
	 */
	process.exit(0);
}

try {
	await main();
} catch (error) {
	teardown();
	console.error(viteLog.split("\n").slice(-12).join("\n"));
	throw error;
}
