#!/usr/bin/env node
/**
 * Measure a conversation OPEN against a real backend: click -> latest messages
 * painted, and click -> the composer sends.
 *
 *     LOCAL_OPERATOR_DESKTOP_BACKEND_URL=... LOCAL_OPERATOR_DESKTOP_TOKEN=... \
 *       pnpm vite --config scripts/session-open-live.vite.mjs
 *     node scripts/session-open-live.mjs [origin] --sessions=<id,id,...> \
 *       [--runs=5] [--json] [--frames=<dir>] [--width=1280] [--height=900]
 *
 * The page is `session-open-live.tsx`; its header says what is real (every
 * request, through the app's own development desktop proxy) and what is not (the
 * dev bundle in headless Chrome, so no Electron IPC hop - the same on both trees,
 * so the base/branch difference is the number to read).
 *
 * Each run opens ONE session from the landing: the page goes back to `/chat`
 * between runs so every click is a real move onto a freshly mounted pane. The
 * sessions are opened round-robin, `--runs` times each. The acceptance budget
 * is the operator's: latest messages rendered and the composer usable within
 * 300 ms of the click.
 *
 * Every open paints from the WIRE: the page empties its paint cache between
 * opens, because a repeat open otherwise paints the window's memory of the
 * conversation in its first frame (`--warm-cache` keeps it, to measure that).
 *
 * `--frames=<dir>` also writes one WebP per session at two moments of its FIRST
 * open - the first painted frame (`<id>-first.webp`) and the settled one
 * (`<id>-settled.webp`) - for the before/after stills.
 *
 * Chrome runs headless on a private profile under this session's temp dir with
 * the mock keychain switch (via `withMockKeychain`), is killed by its own pid on
 * every exit path, and its profile is removed with it.
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { cpus, loadavg, tmpdir } from "node:os";
import { join } from "node:path";
import { withMockKeychain } from "./chrome-keychain.mjs";

const ARGS = process.argv.slice(2);
const flag = (name, fallback) => {
	const hit = ARGS.find((a) => a.startsWith(`--${name}=`));
	return hit ? hit.slice(name.length + 3) : fallback;
};
const ORIGIN = ARGS.find((a) => !a.startsWith("--")) ?? "http://127.0.0.1:5213";
const PAGE = `${ORIGIN}/session-open-live.html`;
const SESSIONS = (flag("sessions", "") || "").split(",").filter(Boolean);
const RUNS = Number(flag("runs", "5"));
const AS_JSON = ARGS.includes("--json");
/* Keep the paint cache between opens (see `home` in the page). */
const WARM_CACHE = ARGS.includes("--warm-cache");
const FRAMES = flag("frames", null);
const WIDTH = Number(flag("width", "1280"));
const HEIGHT = Number(flag("height", "900"));
const BUDGET_MS = 300;
/* How long one open may take before it is reported as timed out. */
const DEADLINE_MS = Number(flag("deadline", "30000"));
/*
 * `--send-early=<ms>`: type into the real composer and press Enter that long
 * after the click - inside the open window on any attach slower than it. The row
 * then reports how many `sessions.message` requests that ONE press produced and
 * what the composer said, which is the U1 question (UX round 1): does a send
 * pressed before the pane is live go out, once, without a second press.
 */
const SEND_EARLY = flag("send-early", null);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

if (SESSIONS.length === 0) {
	console.error("--sessions=<id,...> is required: the ids the backend serves");
	process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let chrome = null;
let dataDir = null;
const teardown = () => {
	if (chrome && chrome.exitCode === null) {
		try {
			process.kill(chrome.pid, "SIGKILL");
		} catch {
			/* already gone */
		}
	}
	chrome = null;
	if (dataDir) {
		rmSync(dataDir, { recursive: true, force: true, maxRetries: 10 });
		dataDir = null;
	}
};
process.on("exit", teardown);
for (const signal of ["SIGINT", "SIGTERM"])
	process.on(signal, () => {
		teardown();
		process.exit(130);
	});

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
			if (msg.method === "Runtime.exceptionThrown")
				console.error(
					"[page]",
					msg.params.exceptionDetails.exception?.description ??
						msg.params.exceptionDetails.text,
				);
		});
	}
	send(method, params = {}) {
		const id = ++this.next;
		this.ws.send(JSON.stringify({ id, method, params }));
		return new Promise((resolve, reject) =>
			this.pending.set(id, { resolve, reject }),
		);
	}
	async eval(expression, awaitPromise = false) {
		const { result, exceptionDetails } = await this.send("Runtime.evaluate", {
			expression,
			awaitPromise,
			returnByValue: true,
		});
		if (exceptionDetails)
			throw new Error(
				exceptionDetails.exception?.description ?? exceptionDetails.text,
			);
		return result.value;
	}
}

const pct = (values, p) => {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const index = Math.min(
		sorted.length - 1,
		Math.ceil((p / 100) * sorted.length) - 1,
	);
	return Math.round(sorted[Math.max(0, index)] * 10) / 10;
};

const main = async () => {
	dataDir = join(tmpdir(), `lo-open-live-${process.pid}`);
	mkdirSync(dataDir, { recursive: true });
	chrome = spawn(
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
		{ stdio: ["ignore", "ignore", "pipe"] },
	);
	const wsUrl = await new Promise((resolve, reject) => {
		let buf = "";
		const timer = setTimeout(
			() => reject(new Error("Chrome did not report a debug port")),
			30_000,
		);
		chrome.stderr.on("data", (data) => {
			buf += data.toString();
			const match = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
			if (match) {
				clearTimeout(timer);
				resolve(match[1]);
			}
		});
		chrome.on("exit", (code) =>
			reject(new Error(`Chrome exited early (${code})`)),
		);
	});
	const { host } = new URL(wsUrl);
	const target = (
		await fetch(`http://${host}/json`).then((r) => r.json())
	).find((t) => t.type === "page");
	const ws = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		ws.addEventListener("open", resolve, { once: true });
		ws.addEventListener("error", reject, { once: true });
	});
	const cdp = new Cdp(ws);
	await cdp.send("Page.enable");
	await cdp.send("Runtime.enable");
	await cdp.send("Emulation.setDeviceMetricsOverride", {
		width: WIDTH,
		height: HEIGHT,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await cdp.send("Page.navigate", { url: PAGE });

	/* Ready: mounted, fonts resolved, and every session asked for has a row. */
	let ready = false;
	for (let i = 0; i < 240 && !ready; i++) {
		ready = await cdp
			.eval(`(() => {
				const probe = window.__lopOpen;
				if (!probe || !probe.ready || document.fonts.status !== "loaded") return false;
				const rows = probe.rows();
				return ${JSON.stringify(SESSIONS)}.every((id) => rows.includes(id));
			})()`)
			.catch(() => false);
		if (!ready) await sleep(250);
	}
	if (!ready && !ARGS.includes("--allow-unlisted"))
		throw new Error(`the page at ${PAGE} never listed every session`);

	const shoot = async (path) => {
		const { data } = await cdp.send("Page.captureScreenshot", {
			format: "webp",
			quality: 88,
		});
		writeFileSync(path, Buffer.from(data, "base64"));
		return path;
	};

	const runs = [];
	const frames = [];
	if (FRAMES) mkdirSync(FRAMES, { recursive: true });
	for (let round = 0; round < RUNS; round++) {
		for (const id of SESSIONS) {
			await cdp.eval(`window.__lopOpen.home(${!WARM_CACHE})`);
			await sleep(400);
			const load = Math.round(loadavg()[0] * 10) / 10;
			const firstOpen = round === 0 && FRAMES;
			const pending = cdp.eval(
				`window.__lopOpen.open(${JSON.stringify(id)}, ${DEADLINE_MS})`,
				true,
			);
			if (firstOpen) {
				/*
				 * The LOADING still: the first frame after the commit, before any
				 * message has painted - taken as soon as the view names the target.
				 * Then the FIRST PAINTED frame, sampled until transcript content is on
				 * screen (bounded; an open that never paints - a gone conversation, or
				 * an empty one - gets its settled frame below instead).
				 */
				for (let i = 0; i < 200; i++) {
					const state = await cdp.eval("window.__lopOpen.state()");
					if (state.active === id) break;
					await sleep(2);
				}
				frames.push(await shoot(join(FRAMES, `${id}-loading.webp`)));
				for (let i = 0; i < 400; i++) {
					const state = await cdp.eval("window.__lopOpen.state()");
					if (state.active === id && state.painted) {
						frames.push(await shoot(join(FRAMES, `${id}-first.webp`)));
						break;
					}
					await sleep(5);
				}
			}
			let early = null;
			if (SEND_EARLY !== null) {
				await sleep(Number(SEND_EARLY));
				const before = (await cdp.eval("window.__lopOpen.messages()")).length;
				const typed = await cdp.eval(
					`window.__lopOpen.typeAndSend(${JSON.stringify(`early send ${round}`)})`,
				);
				const pressedState = await cdp.eval("window.__lopOpen.state()");
				early = { typed, before, pressedState };
			}
			const run = await pending;
			const endState = await cdp.eval("window.__lopOpen.state()");
			if (early) {
				// Long enough for a held send to be released by the snapshot and for
				// the transport to answer; the count is what is asserted, not a time.
				await sleep(3000);
				const messages = await cdp.eval("window.__lopOpen.messages()");
				early.messages = messages.length - early.before;
				early.after = await cdp.eval("window.__lopOpen.state()");
			}
			if (firstOpen) {
				await sleep(1200);
				frames.push(await shoot(join(FRAMES, `${id}-settled.webp`)));
			}
			runs.push({
				round,
				load,
				target: id,
				painted_ms:
					run.paintedAt === null
						? null
						: Math.round((run.paintedAt - run.clickAt) * 10) / 10,
				sendable_ms:
					run.sendableAt === null
						? null
						: Math.round((run.sendableAt - run.clickAt) * 10) / 10,
				timedOut: run.timedOut,
				ops: run.ops,
				...(early ? { early } : {}),
				endState,
			});
		}
	}

	const bySession = {};
	for (const id of SESSIONS) {
		const mine = runs.filter((r) => r.target === id);
		const painted = mine.map((r) => r.painted_ms).filter((v) => v !== null);
		const sendable = mine.map((r) => r.sendable_ms).filter((v) => v !== null);
		const ready = mine
			.map((r) =>
				r.painted_ms === null || r.sendable_ms === null
					? null
					: Math.max(r.painted_ms, r.sendable_ms),
			)
			.filter((v) => v !== null);
		bySession[id] = {
			n: mine.length,
			painted: { p50: pct(painted, 50), p95: pct(painted, 95) },
			sendable: { p50: pct(sendable, 50), p95: pct(sendable, 95) },
			both: { p50: pct(ready, 50), p95: pct(ready, 95) },
			over_budget: ready.filter((v) => v > BUDGET_MS).length,
			ops_per_open: mine.at(-1)?.ops.map((o) => o.op) ?? [],
			timedOut: mine.filter((r) => r.timedOut).length,
		};
	}
	const summary = {
		page: PAGE,
		budget_ms: BUDGET_MS,
		load: loadavg().map((v) => Math.round(v * 10) / 10),
		cores: cpus().length,
		bySession,
		frames,
	};
	if (AS_JSON) {
		console.log(JSON.stringify({ summary, runs }, null, 2));
		return;
	}
	console.log(`open latency against a real backend — ${PAGE}`);
	console.log(
		`load ${summary.load.join(" ")} on ${summary.cores} cores · budget ${BUDGET_MS} ms`,
	);
	for (const [id, s] of Object.entries(bySession))
		console.log(
			`${id}  painted p50 ${s.painted.p50} p95 ${s.painted.p95} · sends p50 ${s.sendable.p50} p95 ${s.sendable.p95} · both p50 ${s.both.p50} p95 ${s.both.p95} · over ${s.over_budget}/${s.n} · ops ${s.ops_per_open.join(",")}`,
		);
};

main().then(
	() => {
		teardown();
		process.exit(0);
	},
	(error) => {
		teardown();
		console.error(error);
		process.exit(1);
	},
);
