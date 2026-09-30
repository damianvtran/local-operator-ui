#!/usr/bin/env node
/**
 * Drive the turn-answer rail harness and publish the before/after frames.
 *
 *     pnpm vite --config scripts/turn-answer-rail-evidence.vite.mjs   # one shell
 *     node scripts/turn-answer-rail-evidence.mjs --tree=after  --out=<dir>
 *     node scripts/turn-answer-rail-evidence.mjs --tree=before --out=<dir>
 *
 * WHAT IT CAPTURES. The shipped `CanonicalTranscript` over one synthetic turn
 * (a question, two condensed calls, a peer receipt, the elected answer), in
 * three states: the default (rail OFF, no capabilities answer — the fail-closed
 * path), the rail ON, and the old-backend skew (capabilities answer, no key).
 * It prints the row and prose boxes each state measured, because jsdom cannot
 * measure anything and the pixels alone cannot say WHY two states match.
 *
 * THE `--tree=before` ARM. The rail shipped always-on in #708, so "before" is
 * not a setting: it is the same page over the PREVIOUS transcript file. Rather
 * than a second worktree (`cp -Rc` twice, against a disk with a few GB free),
 * the mode reverts exactly `canonical-transcript.tsx` from `origin/main` for the
 * length of this process — and restores the working-copy bytes in a `finally`
 * and on exit, so the run cannot leave the tree half-reverted. Only that one
 * file differs between the two trees in what this frame renders.
 *
 * Raw CDP against ONE private headless Chrome, a scratch profile and
 * `--use-mock-keychain`, the process group killed by exact pid on exit.
 */

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withMockKeychain } from "./chrome-keychain.mjs";

const ARGS = process.argv.slice(2);
const flag = (name, fallback) => {
	const hit = ARGS.find((a) => a.startsWith(`--${name}=`));
	return hit ? hit.slice(name.length + 3) : fallback;
};

const ORIGIN = flag("origin", "http://localhost:5219");
const TREE = flag("tree", "after");
const OUT = flag("out", join(tmpdir(), `lo-rail-${process.pid}`));
const THEME = flag("theme", "localOperatorDark");
const WINT = flag("window", "1380x872");
const [W, H] = WINT.split("x").map(Number);
const CHROME =
	process.env.CHROME_PATH ??
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEBUG_WS_RE = /ws:\/\/[^\s]+/;
const TRANSCRIPT =
	"src/renderer/src/features/chat/canonical/canonical-transcript.tsx";

mkdirSync(OUT, { recursive: true });

/**
 * The BEFORE arm: `origin/main`'s transcript file written into the working
 * tree for the length of the run. `git show` into the path rather than a
 * checkout, so nothing else (that the dev server is reading) is touched and the
 * restore is the exact working-copy bytes this run found.
 */
let restore = null;
if (TREE === "before") {
	const kept = readFileSync(TRANSCRIPT);
	writeFileSync(
		TRANSCRIPT,
		spawnSync("git", ["show", `origin/main:${TRANSCRIPT}`], {
			encoding: "buffer",
		}).stdout,
	);
	restore = () => writeFileSync(TRANSCRIPT, kept);
	console.log(`before arm: ${TRANSCRIPT} reverted to origin/main`);
}

const dataDir = join(tmpdir(), `lo-rail-profile-${process.pid}`);
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
	try {
		restore?.();
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

const boxes = (b) =>
	b
		? `${b.left.toFixed(1)}..${b.right.toFixed(1)} (${b.width.toFixed(1)}px)`
		: "none";
const report = [];
const shots = [];
for (const rail of ["off", "on", "absent"]) {
	const url = `${ORIGIN}/turn-answer-rail-evidence.html?rail=${rail}&theme=${THEME}`;
	await send("Page.navigate", { url });
	const deadline = Date.now() + 45_000;
	for (;;) {
		if (Date.now() > deadline)
			throw new Error(`the page never became ready (rail=${rail})`);
		const ready = await evaluate("window.__railEvidence?.ready === true").catch(
			() => false,
		);
		if (ready) break;
		await sleep(120);
	}
	// One settle frame: the classes are applied on the render that seeded the
	// query, but the browser needs a paint before the box numbers are final.
	await sleep(150);
	const measured = await evaluate("window.__railEvidence");
	const name = `${TREE}-rail-${rail}-${THEME}`;
	const { data } = await send("Page.captureScreenshot", { format: "png" });
	writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, "base64"));
	shots.push(`${name}.png`);
	report.push({
		tree: TREE,
		state: `rail=${rail}`,
		markedRows: measured.markedCount,
		answerWearsTheMark: measured.answerStandaloneCount,
		classes: measured.classes,
		answerRowBox: boxes(measured.answerOuter),
		markedDivBox: boxes(measured.answerMark),
		proseBox: boxes(measured.answerProse),
		neighbourToolRowBox: boxes(measured.toolOuter),
	});
}

console.log(JSON.stringify({ out: OUT, shots, report }, null, 2));
cleanup();
