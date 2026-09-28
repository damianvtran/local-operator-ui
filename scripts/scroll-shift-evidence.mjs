#!/usr/bin/env node
/**
 * Drive the scroll-shift harness and read the per-frame trace.
 *
 *     pnpm vite --config scripts/scroll-shift-evidence.vite.mjs   # one shell
 *     node scripts/scroll-shift-evidence.mjs --scenario=stream-out --out=<dir>
 *
 * WHAT THE RUN DOES. Boots the harness page (the shipped `ChatPage` on the
 * scripted owner) in a private headless Chrome, waits until the fixture
 * conversation is painted, starts the page's per-frame sampler, plays one
 * scripted streaming turn, and reads the sampler's trace back. It then prints
 * the frames around the scrollable crossing plus the frame-to-frame maxima, and
 * writes the full trace (samples, marks, emitted frames, config) beside its
 * frames as JSON.
 *
 * WHY PER FRAME. The operator's report is "the whole conversation, including
 * the leading edge, shifts up, sometimes" - a claim about motion, and a claim
 * about motion needs consecutive frames. A settled screenshot cannot show a
 * one-frame lurch, and a pair of stills cannot tell a smooth scroll from a
 * jump that happened between them.
 *
 * Raw CDP against a private headless Chrome with no browser-automation
 * dependency, exactly like `session-switch-latency.mjs` and
 * `scroll-paging-evidence.mjs` (fresh user-data-dir under /tmp, killed on
 * exit, `--use-mock-keychain` so nothing touches the operator's keychain).
 */

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withMockKeychain } from "./chrome-keychain.mjs";

const ARGS = process.argv.slice(2);
const flag = (name, fallback) => {
	const hit = ARGS.find((a) => a.startsWith(`--${name}=`));
	return hit ? hit.slice(name.length + 3) : fallback;
};

const ORIGIN =
	flag("origin", null) ??
	ARGS.find((a) => a.startsWith("http")) ??
	"http://localhost:5212";
const SCENARIO = flag("scenario", "stream-out");
const OUT = flag("out", join(tmpdir(), `lo-scroll-shift-${process.pid}`));
const ROWS = Number(flag("rows", "3"));
const WORDS = Number(flag("words", "12"));
const CHUNKS = Number(flag("chunks", "80"));
const CHUNK_WORDS = Number(flag("chunk-words", "6"));
const TICK = Number(flag("tick", "60"));
/**
 * A chunk script handed in as a JSON array of strings, when a scenario needs
 * text the word-built default cannot express (a forming code fence, a table).
 * Each string is one delta, emitted `--tick` ms after the previous.
 */
const CHUNKS_FILE = flag("chunks-file", null);
const JSON_OUT = flag("json", null);
const WINT = flag("window", "1380x872");
const [W, H] = WINT.split("x").map(Number);

const CHROME =
	process.env.CHROME_PATH ??
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEBUG_WS_RE = /ws:\/\/[^\s]+/;
const PAGE = `${ORIGIN}/scroll-shift-evidence.html?rows=${ROWS}&words=${WORDS}`;

mkdirSync(OUT, { recursive: true });
const dataDir = join(tmpdir(), `lo-scroll-shift-profile-${process.pid}`);
mkdirSync(dataDir, { recursive: true });

const chrome = spawn(
	CHROME,
	withMockKeychain([
		"--headless=new",
		"--no-sandbox",
		"--disable-gpu",
		"--no-first-run",
		"--no-default-browser-check",
		`--window-size=${W},${H}`,
		`--user-data-dir=${dataDir}`,
		"--remote-debugging-port=0",
		"about:blank",
	]),
	{ detached: true, stdio: ["ignore", "ignore", "pipe"] },
);
const browserWs = await new Promise((resolve, reject) => {
	let buf = "";
	const timer = setTimeout(() => reject(new Error("no debug port")), 30_000);
	chrome.stderr.on("data", (chunk) => {
		buf += chunk.toString();
		const hit = buf.match(DEBUG_WS_RE);
		if (hit) {
			clearTimeout(timer);
			resolve(hit[0]);
		}
	});
});
const cleanup = () => {
	try {
		process.kill(-chrome.pid, "SIGKILL");
	} catch {}
	try {
		rmSync(dataDir, { recursive: true, force: true });
	} catch {}
};
process.on("exit", cleanup);

const list = await (
	await fetch(`http://127.0.0.1:${new URL(browserWs).port}/json/list`)
).json();
const page = list.find((t) => t.type === "page");
if (!page) throw new Error("no page target in the private Chromium");

let nextId = 1;
const pending = new Map();
const ws = new WebSocket(page.webSocketDebuggerUrl);
ws.onmessage = (event) => {
	const msg = JSON.parse(event.data);
	if (msg.id && pending.has(msg.id)) {
		const { resolve, reject } = pending.get(msg.id);
		pending.delete(msg.id);
		msg.error
			? reject(new Error(JSON.stringify(msg.error)))
			: resolve(msg.result);
	}
};
await new Promise((resolve) => {
	ws.onopen = resolve;
});
const send = (method, params = {}) =>
	new Promise((resolve, reject) => {
		const id = nextId++;
		pending.set(id, { resolve, reject });
		ws.send(JSON.stringify({ id, method, params }));
	});
const evaluate = async (expression) => {
	const r = await send("Runtime.evaluate", {
		expression,
		awaitPromise: true,
		returnByValue: true,
	});
	if (r.exceptionDetails)
		throw new Error(
			String(r.exceptionDetails.exception?.description ?? r.exceptionDetails),
		);
	return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send("Page.enable");
await send("Page.navigate", { url: PAGE });

// Wait for the fixture to be painted.
const readyDeadline = Date.now() + 45_000;
for (;;) {
	if (Date.now() > readyDeadline)
		throw new Error("the page never became ready");
	const ready = await evaluate("window.__shift?.ready === true").catch(
		() => false,
	);
	if (ready) break;
	await sleep(120);
}

const shot = async (name) => {
	const { data } = await send("Page.captureScreenshot", {
		format: "webp",
		quality: 85,
	});
	writeFileSync(join(OUT, `${name}.webp`), Buffer.from(data, "base64"));
	return `${name}.webp`;
};

const shots = [];
shots.push(await shot("before"));

await evaluate("window.__shift.start(); 'ok'");

/*
 * One scripted turn: `CHUNKS` chunks of `CHUNK_WORDS` words each, `TICK` ms
 * apart. The chunk text is written here rather than in the page so a run's
 * cadence and content are both parameters of the run.
 */
const chunkText = (i) => {
	const pool =
		"alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega".split(
			" ",
		);
	return Array.from(
		{ length: CHUNK_WORDS },
		(_, k) => pool[(i * 5 + k * 3) % pool.length],
	).join(" ");
};

const script = {
	messageId: `${"5c011a33ca11"}-live-1`,
	startAfterMs: 0,
	chunks: CHUNKS_FILE
		? JSON.parse(readFileSync(CHUNKS_FILE, "utf8")).map((text) => ({
				text,
				afterMs: TICK,
			}))
		: Array.from({ length: CHUNKS }, (_, i) => ({
				text: `${i === 0 ? "" : " "}${chunkText(i)}`,
				afterMs: TICK,
			})),
	end: true,
	frontend: true,
};

await evaluate("window.__shift.mark('turn-start'); 'ok'");
void (await evaluate(
	`(() => { void window.__shift.playTurn(${JSON.stringify(script)}).then(() => { window.__turnDone = true; }); return "started"; })()`,
));

// Watch while the turn streams: detect the crossing and photograph it, and
// photograph the column's first shift (the foot row's engagement) once its
// move has settled - the state a single still cannot show is the one 300ms
// after the geometry landed.
let crossingShot = false;
let popShot = false;
let prevTop0 = null;
const turnDeadline = Date.now() + 90_000;
for (;;) {
	if (Date.now() > turnDeadline) throw new Error("the turn never finished");
	const state = await evaluate(`(() => {
		const s = window.__shift.samples;
		const last = s[s.length - 1] ?? null;
		return {
			done: window.__turnDone === true,
			n: s.length,
			scrollable: last ? last.sh - last.ch > 1 : false,
			sh: last?.sh ?? 0,
			ch: last?.ch ?? 0,
			top0: last?.rows?.length ? last.rows[0][1] : null,
		};
	})()`);
	if (!crossingShot && state.scrollable) {
		crossingShot = true;
		shots.push(await shot("crossing"));
	}
	/*
	 * A row moving UP is the signature this whole rig exists for: in the
	 * top-populating phase rows only arrive BELOW the settled ones, and `top0`
	 * - the oldest row's top - is therefore static until the anchor moves the
	 * column. Shot 300ms later so the frame shows the settled geometry rather
	 * than a mid-transition blur of it.
	 */
	if (
		!popShot &&
		state.top0 !== null &&
		prevTop0 !== null &&
		state.top0 - prevTop0 < -4
	) {
		popShot = true;
		await sleep(300);
		shots.push(await shot("pop"));
	}
	if (state.top0 !== null) prevTop0 = state.top0;
	if (state.done) break;
	await sleep(40);
}
if (!crossingShot) shots.push(await shot("crossing"));

await sleep(900);
await evaluate("window.__shift.mark('settle'); 'ok'");
shots.push(await shot("settled"));
await evaluate("window.__shift.stop(); 'ok'");

const trace = await evaluate(`(() => ({
	samples: window.__shift.samples,
	marks: window.__shift.marks,
	emitted: window.__shift.emitted,
}))()`);

const config = {
	scenario: SCENARIO,
	rows: ROWS,
	words: WORDS,
	chunks: CHUNKS,
	chunkWords: CHUNK_WORDS,
	tick: TICK,
	window: WINT,
	shots,
};
const jsonPath = JSON_OUT ?? join(OUT, "trace.json");
writeFileSync(jsonPath, JSON.stringify({ config, ...trace }, null, 1));

// ------------------------------------------------------------- the digest
const { samples } = trace;
const D = (a, b) => Math.round((a - b) * 10) / 10;
let crossing = -1;
for (let i = 0; i < samples.length; i++) {
	if (samples[i].sh - samples[i].ch > 1) {
		crossing = i;
		break;
	}
}
console.log(
	`scenario=${SCENARIO} origin=${ORIGIN} rows=${ROWS} words=${WORDS} chunks=${CHUNKS}x${CHUNK_WORDS} tick=${TICK}ms samples=${samples.length} crossingFrame=${crossing}`,
);
const between = (a, b) => {
	let mSt = 0;
	let mSy = 0;
	let mLead = 0;
	let mRow = 0;
	let atSt = 0;
	let atSy = 0;
	let atLead = 0;
	let atRow = 0;
	for (let i = Math.max(1, a); i < Math.min(samples.length, b); i++) {
		const f = samples[i];
		const p = samples[i - 1];
		const dst = Math.abs(f.st - p.st);
		const dsy = Math.abs(f.sy - p.sy);
		const dlead =
			f.lead === null || p.lead === null ? 0 : Math.abs(f.lead - p.lead);
		if (dst > mSt) [mSt, atSt] = [dst, i];
		if (dsy > mSy) [mSy, atSy] = [dsy, i];
		if (dlead > mLead) [mLead, atLead] = [dlead, i];
		const pm = new Map(p.rows);
		for (const [id, top] of f.rows) {
			const before = pm.get(id);
			if (before === undefined) continue;
			const d = Math.abs(top - before);
			if (d > mRow) [mRow, atRow] = [d, i];
		}
	}
	return { mSt, atSt, mSy, atSy, mLead, atLead, mRow, atRow };
};
const seg = (a, b, label) => {
	const m = between(a, b);
	console.log(
		`${label}: max|ΔscrollTop|=${m.mSt}@${m.atSt} max|ΔscrollerTop|=${m.mSy}@${m.atSy} max|Δlead|=${m.mLead}@${m.atLead} max|ΔrowTop|=${m.mRow}@${m.atRow}`,
	);
};
if (crossing > 0) {
	seg(0, crossing, "phase1");
	seg(crossing, samples.length, "phase2");
} else {
	seg(0, samples.length, "all");
}
/*
 * Notability: any frame where a settled row, the leading edge, the content
 * box, the working line's presence or the composer band moved by more than a
 * few pixels. These are the frames a reader would see as motion; the raw
 * trace is there for the rest.
 */
console.log("--- notable frames (geometry changes > 4px) ---");
for (let i = 1; i < samples.length; i++) {
	const f = samples[i];
	const p = samples[i - 1];
	const notes = [];
	if (Math.abs(f.ch - p.ch) > 4) notes.push(`ch ${p.ch}->${f.ch}`);
	if (Math.abs(f.band - p.band) > 4 || (f.band === null) !== (p.band === null))
		notes.push(`band ${p.band}->${f.band}`);
	if (Math.abs(f.ct - p.ct) > 4) notes.push(`ct ${p.ct}->${f.ct}`);
	if (Math.abs(f.cb - p.cb) > 4) notes.push(`cb ${p.cb}->${f.cb}`);
	if (Math.abs(f.lead - p.lead) > 4) notes.push(`lead ${p.lead}->${f.lead}`);
	if ((f.wl === null) !== (p.wl === null))
		notes.push(`wl ${f.wl === null ? "left" : "appeared"}`);
	const pm = new Map(p.rows);
	const moved = f.rows.filter(([id, top]) => {
		const before = pm.get(id);
		return before !== undefined && Math.abs(top - before) > 4;
	});
	if (moved.length > 0) {
		const deltas = moved.map(([id, top]) => top - pm.get(id));
		notes.push(
			`rows ${moved.length} moved ${Math.min(...deltas).toFixed(1)}..${Math.max(...deltas).toFixed(1)}`,
		);
	}
	const appeared = f.rows.filter(([id]) => !pm.has(id)).map(([id]) => id);
	if (appeared.length > 0) notes.push(`new rows: ${appeared.join(",")}`);
	if (notes.length > 0)
		console.log(
			`  #${String(i).padStart(4)} t=${f.t} st=${f.st} ${notes.join(" | ")}`,
		);
}
console.log(
	"--- frames around the crossing (deltas: st / sy / lead / rows) ---",
);
const lo = Math.max(0, (crossing < 0 ? samples.length : crossing) - 6);
const hi = Math.min(
	samples.length,
	(crossing < 0 ? samples.length : crossing) + 10,
);
for (let i = lo; i < hi; i++) {
	const f = samples[i];
	const p = samples[i - 1];
	const d = p
		? `d st ${D(f.st, p.st)} sy ${D(f.sy, p.sy)} lead ${f.lead === null || p.lead === null ? "-" : D(f.lead, p.lead)}`
		: "-";
	console.log(
		`#${String(i).padStart(4)} t=${String(f.t).padStart(9)} st=${f.st} sh=${f.sh} ch=${f.ch} sy=${f.sy} lead=${f.lead} rows=${f.rows.length} ${d}`,
	);
}
console.log(`frames: ${shots.join(", ")}`);
console.log(`trace: ${jsonPath}`);

cleanup();
