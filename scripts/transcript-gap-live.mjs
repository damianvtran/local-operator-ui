#!/usr/bin/env node
/**
 * Reopen a long conversation whose cached block sits behind the new tail page,
 * against a REAL backend, and count what the pane holds (issue #876).
 *
 *     node scripts/transcript-gap-live.mjs [--label=head] [--n=300,600,1400] \
 *       [--frames=<dir>] [--frame-n=600] [--echo] [--json]
 *
 * WHY THIS EXISTS BESIDE `reconnect-page-gap.test.mjs`. That suite drives the
 * shipped hook against a STUBBED backend contract, which proves the hook's rules
 * and nothing about the backend those rules were written for. This script is the
 * other half: the same sequence - open, paint, leave, rows arrive while away,
 * return - with the pages served by a real `lop serve`, from a real journal file
 * on disk, through the app's own renderer. Run it on the base tree and on the
 * fixed one; the difference between the two tables is the claim.
 *
 * WHAT IS REAL. `lop serve` (the `lop` on PATH, whichever build that is), its
 * `sessions.history` pages and page cache over a real `transcript.jsonl`; the
 * app's own `ChatPage`, sidebar click, `useCanonicalSession` and paint cache
 * (`session-open-live.tsx`, served by the app's own development desktop proxy);
 * the rows are counted off the pane, not off a fixture.
 *
 * WHAT IS NOT. The journal is SYNTHETIC: entries of the real shape
 * (`{id, ts, type, payload}`; user / assistant-with-tool_calls / tool / assistant
 * text, four entries to a turn) whose text is filler such as `User row 17`.
 * Nothing is copied from anyone's sessions. The page is the Vite dev bundle in a
 * headless Chrome, not the packaged app, so there is no Electron IPC hop - the
 * same on both trees. The "while away" rows are appended to the journal FILE by
 * this script (the backend is not restarted, so the run also proves the backend
 * serves an append it did not make itself - its page cache is keyed by file
 * identity, `session/page_cache.py`).
 *
 * HOW "PAINTED" IS READ. The pane's own model - the `transcript` prop of
 * `CanonicalTranscript`, found on its React fiber over CDP, read-only - is what
 * every row on screen is drawn from, and it is the thing the defect corrupts. The
 * DOM alone cannot be the count: the transcript mounts only a render window from
 * the tail (`WINDOW`, 60 rows) and folds finished turns' actions into a bar, so
 * rows that are on the pane are not all `[data-record-id]` nodes. The mounted
 * ids are reported beside it (`dom`) so the two can be compared.
 *
 * WHAT A CELL REPORTS, per N (rows appended while away):
 *   - `painted`: records held at settle that are journal rows;
 *   - `contiguous`: whether they are ONE journal suffix ending at the tail
 *     (the invariant: a hole is never painted);
 *   - `lost`: journal rows that are neither painted nor reachable after the real
 *     affordance ("Load earlier messages", or scrolling to the top, which the
 *     scroll pump turns into the same read) has been driven until history is
 *     exhausted;
 *   - `affordance`: what the pane says at the top at settle;
 *   - `history`: every `sessions.history` request of the reopen, with the page
 *     size it returned.
 *
 * Isolation (non-negotiable): `HOME`, `LOCAL_OPERATOR_CONFIG_DIR` and
 * `LOCAL_OPERATOR_LOG_DIR` are one scratch root; the environment of every child
 * is an allowlist (so no `CMUX_*`/`LOP_*` variable, desktop bearer or provider
 * credential is inherited); Chrome is headless on a private profile with the mock
 * keychain switch (`withMockKeychain`); every child is started in its own process
 * group and the group is killed on every exit path. The operator's sessions are
 * never read or written.
 */

import { execFileSync, spawn } from "node:child_process";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withMockKeychain } from "./chrome-keychain.mjs";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const ARGS = process.argv.slice(2);
const flag = (name, fallback) => {
	const hit = ARGS.find((a) => a.startsWith(`--${name}=`));
	return hit ? hit.slice(name.length + 3) : fallback;
};
const LABEL = flag("label", "tree");
const NS = flag("n", "300,600,1400")
	.split(",")
	.map((v) => Number(v));
const FRAMES = flag("frames", null);
const FRAME_N = Number(flag("frame-n", "600"));
const AS_JSON = ARGS.includes("--json");
/*
 * `--echo`: the user sent a message after returning, while the stale cached
 * paint was on screen, and the owner had already journaled it as the NEWEST row
 * by the time the page arrived. The app retains the unconfirmed echo under the
 * admission request id - which is also the id of that journal row - and a held
 * set that counts the echo reads the tail page as "reaching what the pane held"
 * (#876, review round 1). One extra journal row (a user row: INITIAL + N is a
 * multiple of four for every N the defaults use) is appended last and its id is
 * painted as the pending send before the reopen.
 */
const ECHO = ARGS.includes("--echo");
const EXTRA = ECHO ? 1 : 0;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
/* The journal the first visit sees: longer than the snapshot page (100). */
const INITIAL = 400;
const TOKEN = "d".repeat(64);
const VITE_LISTENING = /Local:/;
const DEVTOOLS_URL = /DevTools listening on (ws:\/\/[^\s]+)/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ROOT = mkdtempSync(join(tmpdir(), "lo-gap-live-"));
const HOME_DIR = join(ROOT, "home");
const CONFIG_DIR = join(ROOT, "config");
const WORK_DIR = join(ROOT, "work");
for (const dir of [HOME_DIR, CONFIG_DIR, WORK_DIR]) mkdirSync(dir);

/* An allowlist, not a copy: see the isolation note in the header. */
const childEnv = (extra = {}) => ({
	PATH: process.env.PATH,
	HOME: HOME_DIR,
	TMPDIR: ROOT,
	LANG: process.env.LANG ?? "en_US.UTF-8",
	TERM: "xterm-256color",
	LOCAL_OPERATOR_CONFIG_DIR: CONFIG_DIR,
	LOCAL_OPERATOR_LOG_DIR: join(ROOT, "logs"),
	LOCAL_OPERATOR_NO_NOTIFICATIONS: "1",
	LOCAL_OPERATOR_NO_TERMINAL_TITLE: "1",
	...extra,
});

/** Children, each the leader of its own process group, reaped by group. */
const children = [];
function start(command, args, { env, cwd = ROOT, stdio }) {
	const child = spawn(command, args, {
		env,
		cwd,
		detached: true,
		stdio: stdio ?? ["ignore", "pipe", "pipe"],
	});
	let log = "";
	child.stdout?.on("data", (d) => {
		log += d;
	});
	child.stderr?.on("data", (d) => {
		log += d;
	});
	child.text = () => log;
	children.push(child);
	return child;
}
function killGroup(child, signal) {
	if (!child.pid) return;
	try {
		process.kill(-child.pid, signal);
	} catch {
		/* already gone */
	}
}
let reaped = false;
function teardown() {
	if (reaped) return;
	reaped = true;
	for (const child of children) killGroup(child, "SIGKILL");
	rmSync(ROOT, { recursive: true, force: true, maxRetries: 10 });
}
process.on("exit", teardown);
for (const signal of ["SIGINT", "SIGTERM"])
	process.on(signal, () => {
		teardown();
		process.exit(130);
	});

const freePort = () =>
	new Promise((resolve, reject) => {
		const server = createServer();
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address();
			server.close(() => resolve(port));
		});
		server.on("error", reject);
	});

/* ------------------------------------------------------------- the journal */

const T0 = 1_790_000_000;
const hex32 = (n) => n.toString(16).padStart(32, "0");
/**
 * Entry `i` (1-based) of the synthetic journal. Four entries make a turn:
 * the user's message, an assistant frame that only calls a tool, the tool's
 * result, and the assistant's closing prose. `ts` rises with `i`, so "written
 * while away" is "a later timestamp", which is how the pane orders pages.
 */
function entry(i) {
	const turn = Math.ceil(i / 4);
	const base = { id: hex32(i), ts: T0 + i * 2, type: "message" };
	switch ((i - 1) % 4) {
		case 0:
			return {
				...base,
				payload: {
					kind: "message",
					role: "user",
					content: [{ text: `User row ${i}` }],
				},
			};
		case 1:
			return {
				...base,
				payload: {
					kind: "message",
					role: "assistant",
					tool_calls: [
						{
							id: `call-${turn}`,
							name: "bash",
							arguments: { command: `echo ${turn}`, i: `Echo ${turn}` },
						},
					],
					stop_reason: "toolUse",
				},
			};
		case 2:
			return {
				...base,
				payload: {
					kind: "message",
					role: "tool",
					tool_call_id: `call-${turn}`,
					tool_name: "bash",
					content: [{ text: `Tool output ${i}` }],
					provider_payload: { duration_s: 0.1 },
				},
			};
		default:
			return {
				...base,
				payload: {
					kind: "message",
					role: "assistant",
					content: [{ text: `Assistant row ${i}` }],
					stop_reason: "stop",
				},
			};
	}
}
/** The id the pane keys the entry's record by (`durableRecord`). */
const recordIdOf = (e) =>
	e.payload.role === "tool" ? `tool:${e.payload.tool_call_id}` : e.id;
const lines = (from, to) => {
	let out = "";
	for (let i = from; i <= to; i++) out += `${JSON.stringify(entry(i))}\n`;
	return out;
};

function seedSession(id, title) {
	const dir = join(CONFIG_DIR, "sessions", id);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "transcript.jsonl"), lines(1, INITIAL));
	writeFileSync(
		join(dir, "title.json"),
		JSON.stringify({ text: title, user_set: true, names: [title] }),
	);
	writeFileSync(join(dir, "created_at.json"), String(T0 - 10));
	writeFileSync(
		join(dir, "desktop.json"),
		JSON.stringify({ version: 1, cwd: WORK_DIR }),
	);
	return join(dir, "transcript.jsonl");
}

/* ----------------------------------------------------------------- the CDP */

class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.next = 0;
		this.pending = new Map();
		this.listeners = [];
		ws.addEventListener("message", (ev) => {
			const msg = JSON.parse(ev.data);
			if (msg.id !== undefined && this.pending.has(msg.id)) {
				const { resolve, reject } = this.pending.get(msg.id);
				this.pending.delete(msg.id);
				msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
			} else if (msg.method) {
				for (const fn of this.listeners) fn(msg);
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

/**
 * Read-only inspection of the pane, evaluated in the page. The model is the
 * `transcript` prop on `CanonicalTranscript`'s fiber (see the header).
 */
const INSPECT = `(() => {
	const content = document.querySelector("[data-lo-transcript-content]");
	if (!content) return null;
	const key = Object.keys(content).find((k) => k.startsWith("__reactFiber$"));
	let fiber = key ? content[key] : null;
	let transcript = null;
	while (fiber && !transcript) {
		const t = fiber.memoizedProps && fiber.memoizedProps.transcript;
		if (t && Array.isArray(t.records)) transcript = t;
		fiber = fiber.return;
	}
	const text = (content.parentElement ? content.parentElement.innerText : "") || "";
	const slot = ["Load earlier messages", "Loading earlier messages", "Scroll up for earlier", "Start of conversation", "Could not load earlier messages", "Earlier history above"]
		.filter((s) => text.includes(s));
	let scroller = content;
	while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
	/* How far the reader is from the oldest end (the scroller is flex-col-reverse). */
	const toTop = scroller ? Math.round(scroller.scrollHeight - scroller.clientHeight + scroller.scrollTop) : null;
	return {
		toTop,
		records: transcript ? transcript.records.map((r) => r.id) : null,
		hasMore: transcript ? transcript.hasMore : null,
		oldestId: transcript ? transcript.oldestId : null,
		dom: [...content.querySelectorAll("[data-record-id]")].map((n) => n.getAttribute("data-record-id")),
		slot,
	};
})()`;

const CLICK_LOAD_EARLIER = `(() => {
	const b = [...document.querySelectorAll("button")].find((n) => (n.textContent || "").trim() === "Load earlier messages");
	if (!b) return false;
	b.click();
	return true;
})()`;

/* ------------------------------------------------------------------- main */

const sourceIdentity = () => {
	const sha = (path) =>
		execFileSync("git", ["hash-object", path], { cwd: REPO })
			.toString()
			.trim()
			.slice(0, 12);
	return {
		head: execFileSync("git", ["rev-parse", "--short=11", "HEAD"], {
			cwd: REPO,
		})
			.toString()
			.trim(),
		"use-canonical-session.ts": sha(
			"src/renderer/src/shared/hooks/use-canonical-session.ts",
		),
		"transcript-reducer.ts": sha(
			"src/renderer/src/features/chat/canonical/transcript-reducer.ts",
		),
	};
};

async function waitFor(fn, what, timeoutMs = 60_000, every = 250) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const value = await fn();
		if (value) return value;
		if (Date.now() > deadline) throw new Error(`timed out: ${what}`);
		await sleep(every);
	}
}

async function main() {
	/* 1. the sessions, on disk, before the backend looks at the store */
	const ids = Object.fromEntries(
		NS.map((n) => [n, `c0ffee${String(n).padStart(6, "0")}`]),
	);
	const journals = Object.fromEntries(
		NS.map((n) => [n, seedSession(ids[n], `Synthetic journal, ${n} away`)]),
	);

	/* 2. a real backend */
	const serve = start("lop", ["serve", "--port", "0"], {
		env: childEnv({ LOCAL_OPERATOR_DESKTOP_TOKEN: TOKEN }),
	});
	const record = await waitFor(
		() => {
			const file = join(CONFIG_DIR, "run", "serve", `${serve.pid}.json`);
			if (!existsSync(file)) return null;
			try {
				return JSON.parse(readFileSync(file, "utf8"));
			} catch {
				return null; // a torn read mid-publish
			}
		},
		"the serve record",
		60_000,
	);
	const backendUrl = `http://${record.host}:${record.port}`;

	/* 3. the app's own renderer, behind its own desktop proxy */
	const vitePort = await freePort();
	const vite = start(
		process.execPath,
		[
			join(REPO, "node_modules/vite/bin/vite.js"),
			"--config",
			"scripts/session-open-live.vite.mjs",
		],
		{
			cwd: REPO,
			env: childEnv({
				LOCAL_OPERATOR_DESKTOP_BACKEND_URL: backendUrl,
				LOCAL_OPERATOR_DESKTOP_TOKEN: TOKEN,
				SESSION_OPEN_LIVE_PORT: String(vitePort),
			}),
		},
	);
	await waitFor(
		() => VITE_LISTENING.test(vite.text()) || null,
		"vite to listen",
		90_000,
	);

	/* 4. a private headless Chrome */
	const chrome = start(
		CHROME,
		withMockKeychain([
			"--headless=new",
			"--no-sandbox",
			"--disable-gpu",
			"--hide-scrollbars",
			`--user-data-dir=${join(ROOT, "chrome")}`,
			"--remote-debugging-port=0",
			"about:blank",
		]),
		{ env: childEnv() },
	);
	const wsUrl = await waitFor(
		() => chrome.text().match(DEVTOOLS_URL)?.[1],
		"Chrome's debug port",
		30_000,
		100,
	);
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
	await cdp.send("Network.enable");
	await cdp.send("Emulation.setDeviceMetricsOverride", {
		width: 1280,
		height: 900,
		deviceScaleFactor: 1,
		mobile: false,
	});

	/* Every desktop op the page sends, with the history pages' sizes. */
	const requests = new Map();
	const history = [];
	let inFlight = 0;
	cdp.listeners.push((msg) => {
		const p = msg.params;
		if (msg.method === "Network.requestWillBeSent") {
			if (!p.request.url.endsWith("/__desktop") || !p.request.postData) return;
			let body = {};
			try {
				body = JSON.parse(p.request.postData);
			} catch {
				return;
			}
			inFlight++;
			requests.set(p.requestId, { body, startedAt: Date.now() });
		} else if (msg.method === "Network.loadingFinished") {
			const req = requests.get(p.requestId);
			if (!req) return;
			inFlight--;
			if (req.body.op !== "sessions.history") return;
			void cdp
				.send("Network.getResponseBody", { requestId: p.requestId })
				.then(({ body }) => {
					const parsed = JSON.parse(body);
					/* The proxy's envelope: {status, body: {result: <the page>}}. */
					const page = parsed.body?.result ?? parsed.result ?? parsed;
					history.push({
						session: req.body.sessionId,
						beforeId: req.body.beforeId ?? null,
						limit: req.body.limit ?? null,
						entries: page.entries?.length ?? null,
						hasMore: page.has_more ?? null,
						bytes: body.length,
					});
				})
				.catch(() => {});
		} else if (msg.method === "Network.loadingFailed") {
			if (requests.delete(p.requestId)) inFlight--;
		}
	});

	await cdp.send("Page.navigate", {
		url: `http://127.0.0.1:${vitePort}/session-open-live.html`,
	});
	await waitFor(
		() =>
			cdp
				.eval(
					`(() => { const p = window.__lopOpen; if (!p || !p.ready || document.fonts.status !== "loaded") return false; const rows = p.rows(); return ${JSON.stringify(Object.values(ids))}.every((id) => rows.includes(id)); })()`,
				)
				.catch(() => false),
		"the sidebar to list every synthetic session",
		90_000,
	);

	const shoot = async (path) => {
		const { data } = await cdp.send("Page.captureScreenshot", {
			format: "webp",
			quality: 80,
		});
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, Buffer.from(data, "base64"));
		return path;
	};

	/**
	 * A real wheel notch over the transcript, upward. The scroll pump
	 * (`use-scroll-paging.ts`) takes demand from input devices only - a script
	 * writing `scrollTop` is not a reader - so this is `Input.dispatchMouseEvent`,
	 * the same events a trackpad produces.
	 */
	async function wheelUp(times = 1, deltaY = -1600) {
		for (let k = 0; k < times; k++) {
			await cdp.send("Input.dispatchMouseEvent", {
				type: "mouseWheel",
				x: 700,
				y: 450,
				deltaX: 0,
				deltaY,
			});
			await sleep(60);
		}
	}

	/** Open from the landing and wait until the pane stops changing. */
	async function openAndSettle(id) {
		const run = await cdp.eval(
			`window.__lopOpen.open(${JSON.stringify(id)}, 30000)`,
			true,
		);
		if (run.timedOut) throw new Error(`${id}: never painted`);
		let last = "";
		let stableSince = Date.now();
		const deadline = Date.now() + 45_000;
		for (;;) {
			const view = await cdp.eval(INSPECT);
			const signature = `${view?.records?.length}|${view?.oldestId}|${view?.hasMore}|${inFlight}`;
			if (signature !== last) {
				last = signature;
				stableSince = Date.now();
			}
			if (inFlight === 0 && Date.now() - stableSince > 2_000) return view;
			if (Date.now() > deadline) throw new Error(`${id}: never settled`);
			await sleep(100);
		}
	}

	const cells = [];
	for (const n of NS) {
		const id = ids[n];
		const journalEntries = [];
		for (let i = 1; i <= INITIAL + n + EXTRA; i++)
			journalEntries.push(entry(i));
		const journal = journalEntries.map(recordIdOf);

		/* (1) first visit: the tail page, painted, with the cache kept */
		await cdp.eval("window.__lopOpen.home(true)"); // an empty cache to start
		await sleep(400);
		const first = await openAndSettle(id);
		const firstHeld = first.records.length;

		/* (2) away: the landing; the paint cache is KEPT (home(false)) */
		await cdp.eval("window.__lopOpen.home(false)");
		await sleep(600);

		/* (3) rows written while away, to the journal file, strictly later */
		appendFileSync(journals[n], lines(INITIAL + 1, INITIAL + n + EXTRA));
		if (ECHO) {
			/* The send, retained as the composer's press retains it. */
			await cdp.eval(
				`window.__lopOpen.paintPendingSend(${JSON.stringify(id)}, ${JSON.stringify(hex32(INITIAL + n + 1))}, "sent after returning")`,
			);
		}

		/* (4) reopen from the landing */
		const mark = history.length;
		await sleep(300);
		const view = await openAndSettle(id);
		const reopenHistory = history.slice(mark).filter((h) => h.session === id);

		const index = new Map(journal.map((rid, i) => [rid, i]));
		const painted = view.records.filter((rid) => index.has(rid));
		const positions = painted.map((rid) => index.get(rid));
		const contiguous =
			positions.length > 0 &&
			positions.at(-1) === journal.length - 1 &&
			positions.every((p, i) => i === 0 || p === positions[i - 1] + 1);
		const cell = {
			label: LABEL,
			n,
			journal: journal.length,
			firstVisitPainted: firstHeld,
			painted: painted.length,
			contiguous,
			firstPaintedRow: positions[0] + 1,
			hole: positions.reduce(
				(sum, p, i) => sum + (i > 0 ? p - positions[i - 1] - 1 : 0),
				0,
			),
			hasMore: view.hasMore,
			/* Where "load earlier" resumes, as a journal position (1-based). */
			cursorAt: (() => {
				const at = journalEntries.findIndex((e) => e.id === view.oldestId);
				return at < 0 ? null : at + 1;
			})(),
			affordance: view.slot,
			dom: view.dom.length,
			extra: view.records.length - painted.length,
			history: reopenHistory.map(
				(h) => `${h.entries}${h.beforeId ? "b" : "t"}`,
			),
			historyCursors: reopenHistory.map((h) => {
				const at = journalEntries.findIndex((e) => e.id === h.beforeId);
				return at < 0 ? "tail" : at + 1;
			}),
			historyRequests: reopenHistory.length,
			historyBytes: reopenHistory.reduce((s, h) => s + h.bytes, 0),
		};

		/*
		 * A frame around the seam: the first hole when there is one (the junction
		 * of the cached block and the tail), else the top of what is painted. The
		 * wheel moves in small steps and stops the moment the row is mounted, so
		 * the frame is taken BEFORE the reader has paged anything - the paging
		 * below is a separate, later act.
		 */
		if (FRAMES && n === FRAME_N) {
			const hole = positions.findIndex(
				(p, i) => i > 0 && p !== positions[i - 1] + 1,
			);
			const around = painted[hole > 0 ? hole : 0];
			const mounted = `!!document.querySelector('[data-record-id="${around}"]')`;
			for (let k = 0; k < 60 && !(await cdp.eval(mounted)); k++) {
				await wheelUp(1, -500);
				await sleep(150);
			}
			await cdp.eval(
				`(() => { const n = document.querySelector('[data-record-id="${around}"]'); if (n) n.scrollIntoView({ block: "center" }); })()`,
			);
			await sleep(700);
			cell.frame = basename(
				await shoot(join(FRAMES, `${LABEL}-${n}-away.webp`)),
			);
			cell.frameAt = { hole: hole > 0, row: index.get(around) + 1 };
		}

		/* (5) drive the real affordance until history is exhausted */
		const pagingMark = history.length; // the frame step above is paging too
		let pages = 0;
		let stalls = 0;
		let now = await cdp.eval(INSPECT);
		/*
		 * Progress is the pane's whole reading, not the record count alone: a
		 * "windowed" pane first mounts more of the rows it already holds (the
		 * render window widens 60 at a time), and only at the top does it read.
		 */
		const reading = (v) =>
			`${v.records.length}|${v.dom.length}|${v.slot}|${v.toTop}`;
		for (let step = 0; step < 200 && stalls < 4; step++) {
			const before = reading(now);
			const clicked = await cdp.eval(CLICK_LOAD_EARLIER);
			if (clicked) pages++;
			else await wheelUp(8);
			await sleep(700);
			for (let w = 0; w < 100 && inFlight > 0; w++) await sleep(100);
			now = await cdp.eval(INSPECT);
			stalls = reading(now) === before ? stalls + 1 : 0;
			if (now.slot.includes("Start of conversation") && stalls >= 2) break;
		}
		const held = new Set(now.records);
		cell.loadEarlierClicks = pages;
		cell.finalPainted = journal.filter((rid) => held.has(rid)).length;
		cell.lost = journal.filter((rid) => !held.has(rid)).length;
		cell.finalAffordance = now.slot;
		const paging = history.slice(pagingMark).filter((h) => h.session === id);
		cell.pagingRequests = paging.length;
		/* Each paging request as the journal position of its cursor. */
		cell.pagingCursors = paging.map((h) => {
			const at = journalEntries.findIndex((e) => e.id === h.beforeId);
			return at < 0 ? "tail" : at + 1;
		});
		const finalPositions = now.records
			.map((rid) => index.get(rid))
			.filter((p) => p !== undefined);
		cell.finalContiguous =
			finalPositions.length > 0 &&
			finalPositions.at(-1) === journal.length - 1 &&
			finalPositions.every(
				(p, i) => i === 0 || p === finalPositions[i - 1] + 1,
			);
		cell.finalRecords = now.records.length;
		cells.push(cell);
		console.error(
			`[${LABEL}] N=${n}: painted ${cell.painted}/${cell.journal} contiguous=${cell.contiguous} lost-after-paging=${cell.lost}`,
		);
	}

	const identity = sourceIdentity();
	if (AS_JSON) {
		console.log(
			JSON.stringify({ identity, backendUrl: "<backend>", cells }, null, 2),
		);
		return;
	}
	console.log(`label ${LABEL} · source ${JSON.stringify(identity)}`);
	console.log(
		`backend: ${execFileSync("lop", ["--version"], { env: childEnv() }).toString().trim()} · journal ${INITIAL} entries, N appended while away`,
	);
	console.log(
		"N     first-visit  painted  contiguous  painted-rows   cursor  hole  unreachable  reopen-history          affordance",
	);
	for (const c of cells) {
		const first = c.firstPaintedRow;
		console.log(
			[
				String(c.n).padEnd(5),
				String(c.firstVisitPainted).padEnd(12),
				`${c.painted}/${c.journal}`.padEnd(8),
				String(c.contiguous).padEnd(11),
				`${first}..${c.journal}`.padEnd(14),
				String(c.cursorAt).padEnd(7),
				String(c.hole).padEnd(5),
				String(c.lost).padEnd(12),
				`${c.historyRequests}: ${c.history.join(" ")}`.padEnd(23),
				c.affordance.join(" / "),
			].join(" "),
		);
	}
	console.log(
		"\ncolumns: painted = journal rows held at settle; contiguous = one journal suffix ending at the tail;",
	);
	console.log(
		"painted-rows = first painted journal position..tail; cursor = journal position the pane's `load earlier` resumes from;",
	);
	console.log(
		"hole = journal rows between the painted blocks that are not painted at settle; unreachable = journal rows neither painted",
	);
	console.log(
		"nor reached after `Load earlier messages` / wheel-up is driven until the pane says `Start of conversation`.",
	);
	console.log("\nper cell (json):");
	for (const c of cells) console.log(JSON.stringify(c));
}

main().then(
	() => {
		teardown();
		process.exit(0);
	},
	(error) => {
		console.error(error);
		for (const child of children)
			if (child.text().length)
				console.error(
					`--- ${child.spawnargs[0]} ---\n${child.text().slice(-1500)}`,
				);
		teardown();
		process.exit(1);
	},
);
