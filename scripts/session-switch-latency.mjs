#!/usr/bin/env node
/**
 * Measure how long a session switch takes, phase by phase.
 *
 *     pnpm vite --config scripts/session-switch.vite.mjs    # one shell
 *     node scripts/session-switch-latency.mjs               # then this
 *
 * The operator's report is qualitative - "the switches feel a bit slow" - and
 * a stopwatch is the wrong instrument for it: one number cannot say WHICH part
 * to change, and this switch has four candidates that need four different
 * fixes (the `sessions.get` round trip that gates the commit; the panel mount
 * that follows it; the stream handshake that delivers the transcript; the
 * transcript render itself). So the harness in `session-switch.html` reports
 * each of them separately, and this file is the command that produces the
 * table.
 *
 * WHAT IS REAL. The page mounts the shipped `ChatPage` - the sidebar, the
 * store, the canonical session hook, the transcript - and clicks a real
 * sidebar row. What is scripted is the owner at the far end of the transport
 * (`session-switch-bridge.ts`), because the two knobs that decide whether this
 * is a switch problem at all are the backend's service time and the stream's
 * snapshot delay: a real local backend answers in single-digit milliseconds,
 * and a switch whose cost is one IPC hop cannot be attributed by timing that
 * hop at its best case. The driver PRINTS the configured latencies with every
 * run, so the reader never has to guess what was assumed.
 *
 * WHAT IS NOT. This is the Vite dev bundle in a private headless Chrome, not
 * the packaged Electron app: no minified bundle, no Chromium IPC hop. Absolute
 * milliseconds are therefore an upper bound on the packaged app, and the
 * BEFORE/AFTER comparison is the number to read - it is one harness, one
 * machine, one run each, with the load average printed beside it.
 *
 * Raw CDP against a private headless Chrome with no browser-automation
 * dependency in the repo, exactly like `capture-evidence.mjs` and
 * `chat-alignment-geometry.mjs` (fresh user-data-dir under /tmp, killed on
 * exit).
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { loadavg, cpus } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ARGS = process.argv.slice(2);
const flag = (name, fallback) => {
	const hit = ARGS.find((a) => a.startsWith(`--${name}=`));
	return hit ? hit.slice(name.length + 3) : fallback;
};
const ORIGIN = ARGS.find((a) => !a.startsWith("--")) ?? "http://localhost:5211";
const PAGE = `${ORIGIN}/session-switch.html`;

/** How many switches to time per run, alternating between two sessions. */
const SWITCHES = Number(flag("switches", "9"));
/** Query parameters handed to the page, i.e. the scenario under test. */
const SCENARIO = {
	get: flag("get", null),
	stream: flag("stream", null),
	steps: flag("steps", null),
	history: flag("history", null),
	sessions: flag("sessions", null),
	outgoingSteps: flag("outgoing-steps", null),
};
const AS_JSON = ARGS.includes("--json");
const WIDTH = Number(flag("width", "1280"));
const HEIGHT = Number(flag("height", "900"));

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
		rmSync(dataDir, { recursive: true, force: true, maxRetries: 10 });
		dataDir = null;
	}
};
process.on("exit", teardown);
process.on("SIGINT", () => {
	teardown();
	process.exit(130);
});

/**
 * Run every switch in the page and hand the samples back.
 *
 * Written as an expression rather than as a loop of CDP calls, so the timing
 * of a switch is not entangled with a websocket round trip: the page decides
 * when a switch starts and when it has settled, and the driver only reads the
 * result. Every phase timestamp in a run is a `performance.now()` taken in the
 * page, on the same clock.
 */
const RUN = (count) => `(async () => {
	const probe = window.__lopSwitch;
	const meta = probe.snapshot();
	const runs = [];
	for (let i = 0; i < ${count}; i++) {
		const target = i % 2 === 0 ? meta.incoming : meta.outgoing;
		runs.push(await probe.switchTo(target, i === 0 ? "cold" : "steady"));
		await probe.settle(target);
	}
	return { meta, runs, latency: probe.bridge.log.latency };
})()`;

const median = (values) => {
	const sorted = [...values].sort((a, b) => a - b);
	if (sorted.length === 0) return null;
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? sorted[middle]
		: (sorted[middle - 1] + sorted[middle]) / 2;
};
const round = (n) => (n === null ? null : Math.round(n * 10) / 10);

/**
 * The phases, in the order the user pays for them.
 *
 * `pending` and `pendingPaint` are null on a switch that commits before
 * painting anything else, which is the shape this work is aiming for - so a
 * missing phase is reported as "-", never coerced to zero.
 */
const PHASES = [
	["click → pending set", (r) => (r.pendingAt === null ? null : r.pendingAt - r.clickAt)],
	[
		"pending set → pending painted",
		(r) =>
			r.pendingAt === null || r.pendingPaintedAt === null
				? null
				: r.pendingPaintedAt - r.pendingAt,
	],
	[
		"click → sessions.get settled",
		(r) => (r.getSettledAt === null ? null : r.getSettledAt - r.clickAt),
	],
	[
		"click → committed",
		(r) => (r.committedAt === null ? null : r.committedAt - r.clickAt),
	],
	[
		"committed → stream subscribed",
		(r) =>
			r.committedAt === null || r.streamSubscribedAt === null
				? null
				: r.streamSubscribedAt - r.committedAt,
	],
	[
		"committed → snapshot delivered",
		(r) =>
			r.committedAt === null || r.streamSnapshotAt === null
				? null
				: r.streamSnapshotAt - r.committedAt,
	],
	[
		"committed → transcript rows committed",
		(r) =>
			r.committedAt === null || r.firstRowAt === null
				? null
				: r.firstRowAt - r.committedAt,
	],
	[
		"committed → transcript painted",
		(r) =>
			r.committedAt === null || r.transcriptPaintedAt === null
				? null
				: r.transcriptPaintedAt - r.committedAt,
	],
	[
		"click → transcript painted (total)",
		(r) =>
			r.transcriptPaintedAt === null ? null : r.transcriptPaintedAt - r.clickAt,
	],
];

const main = async () => {
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(SCENARIO))
		if (value !== null && value !== undefined) query.set(key, value);
	const url = query.toString() ? `${PAGE}?${query}` : PAGE;

	dataDir = join(tmpdir(), `lo-switch-${process.pid}`);
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
	/*
	 * A harness that swallows the page's own errors reports "never became
	 * ready" for every cause, which is the one failure mode that makes a
	 * measurement instrument useless rather than merely wrong. Console output
	 * and uncaught exceptions go to stderr, where they cannot be mistaken for
	 * the phase table.
	 */
	ws.addEventListener("message", (event) => {
		const message = JSON.parse(event.data);
		if (message.method === "Runtime.exceptionThrown")
			console.error(
				"[page]",
				message.params.exceptionDetails.exception?.description ??
					message.params.exceptionDetails.text,
			);
		if (message.method === "Runtime.consoleAPICalled") {
			const text = message.params.args
				.map((arg) => arg.value ?? arg.description ?? arg.type)
				.join(" ");
			console.error(`[page:${message.params.type}]`, text);
		}
	});
	await cdp.send("Emulation.setDeviceMetricsOverride", {
		width: WIDTH,
		height: HEIGHT,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await cdp.send("Page.navigate", { url });

	/* Ready means the app is mounted on a session AND its fonts have resolved:
	   a switch measured against the fallback face would be a number about this
	   machine rather than about the product. Polled, not slept on. */
	let ready = false;
	for (let i = 0; i < 240 && !ready; i++) {
		const { result } = await cdp.send("Runtime.evaluate", {
			returnByValue: true,
			expression: `(() => {
				const probe = window.__lopSwitch;
				if (!probe || !probe.ready) return false;
				if (document.fonts.status !== "loaded") return false;
				return true;
			})()`,
		});
		ready = result.value === true;
		if (!ready) await sleep(250);
	}
	if (!ready) throw new Error(`the harness at ${url} never became ready`);

	const runWithDeadline = (expression, ms) =>
		Promise.race([
			cdp.send("Runtime.evaluate", {
				awaitPromise: true,
				returnByValue: true,
				expression,
			}),
			new Promise((_, reject) =>
				setTimeout(
					() =>
						reject(
							new Error(
								`the page did not finish the run within ${ms} ms - a phase never settled (see the run table)`,
							),
						),
					ms,
				),
			),
		]);

	const { result } = await runWithDeadline(RUN(SWITCHES), 60_000 + SWITCHES * 25_000);
	if (!result.value)
		throw new Error(
			`the page threw instead of returning a run table: ${result.description ?? JSON.stringify(result)}`,
		);

	const { meta, runs, latency } = result.value;
	const steady = runs.filter((run) => run.label === "steady");
	const cold = runs.filter((run) => run.label === "cold");
	const loads = loadavg().map((value) => Math.round(value * 100) / 100);
	const numbers = (runs_, of) => runs_.map(of).filter((value) => value !== null);

	const summary = {
		url,
		latency,
		sessions: meta.sessions.length,
		incoming: meta.incoming,
		outgoing: meta.outgoing,
		samples: steady.length,
		loadAverage: loads,
		cores: cpus().length,
		phases: PHASES.map(([label, of]) => {
			const values = numbers(steady, of);
			return {
				phase: label,
				median: round(median(values)),
				min: values.length ? round(Math.min(...values)) : null,
				max: values.length ? round(Math.max(...values)) : null,
				samples: values.length,
			};
		}),
		firstSwitch: cold.length
			? round(numbers(cold, PHASES.at(-1)[1])[0] ?? null)
			: null,
		sessionsGetPerSwitch: steady.map((run) => run.targetRequests),
		requestSequence: steady.at(-1)?.requests ?? [],
		transcripts: runs.map((run) => ({
			label: run.label,
			rows: run.firstRowAt === null ? null : "committed",
			timedOut: run.timedOut,
		})),
		timedOut: runs.some((run) => run.timedOut),
	};

	if (AS_JSON) {
		console.log(JSON.stringify({ summary, runs }, null, 2));
	} else {
		console.log(`switch latency — ${url}`);
		console.log(
			`configured owner latencies (ms): ${JSON.stringify(latency)}  ·  ` +
				`step function (sessions.get) included in every switch`,
		);
		console.log(
			`load average ${loads.join(" ")} on ${summary.cores} cores  ·  ` +
				`${summary.samples} timed switches (median), first switch after boot ${summary.firstSwitch} ms`,
		);
		console.log("");
		console.log(
			`${"phase".padEnd(42)}${"median".padStart(9)}${"min".padStart(8)}${"max".padStart(8)}${"n".padStart(4)}`,
		);
		for (const phase of summary.phases)
			console.log(
				`${phase.phase.padEnd(42)}${fmt(phase.median).padStart(9)}${fmt(phase.min).padStart(8)}${fmt(phase.max).padStart(8)}${String(phase.samples).padStart(4)}`,
			);
		console.log("");
		console.log(
			`sessions.get for the target, per switch: ${summary.sessionsGetPerSwitch.join(", ")}`,
		);
		console.log(`requests issued by the last switch: ${summary.requestSequence.join(", ")}`);
		if (summary.timedOut) console.log("NOTE: at least one switch hit the 20s deadline");
	}
};

const fmt = (n) => (n === null || n === undefined ? "-" : String(n));

main().then(teardown, (error) => {
	teardown();
	console.error(error);
	process.exit(1);
});
