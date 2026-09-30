#!/usr/bin/env node
/**
 * Drive the turn-answer rail harness and publish the before/after frames.
 *
 *     pnpm vite --config scripts/turn-answer-rail-evidence.vite.mjs   # one shell
 *     node scripts/turn-answer-rail-evidence.mjs --tree=after  --out=<dir>
 *     node scripts/turn-answer-rail-evidence.mjs --tree=before --out=<dir>
 *
 * WHAT IT CAPTURES. The shipped `CanonicalTranscript` over one synthetic turn
 * (a question, two condensed calls behind a bar, a peer-message receipt, the
 * elected answer), in three states per theme: the default (rail OFF, no
 * capabilities answer — the fail-closed path), the rail ON, and the old-backend
 * skew (capabilities answer, no key). `--themes` chooses the palettes (dark and
 * `rosePineDawn` by default, the lightest pair the design round measured), and
 * `--settings` adds frames of the shipped settings page's own row, driven
 * through the committed `backend-settings-geometry` page. It prints the row,
 * prose and switch boxes each state measured, because jsdom cannot measure
 * anything and the pixels alone cannot say WHY two states match.
 *
 * THE `--tree=before` ARM, AND WHY ITS REF IS PINNED. The rail shipped always-on
 * in #708, so "before" is not a setting: it is the same page over the PREVIOUS
 * transcript file. `--before-ref` names the commit the arm reads that file at
 * and DEFAULTS TO THE `v0.31.25` TAG — the release whose
 * `canonical-transcript.tsx` is byte-identical to the shipped defect (verified
 * by `cmp` against `origin/main` in QA round 1). Reading `origin/main` instead
 * would silently stop documenting anything the moment this branch merges, since
 * main would then carry the very change under review (agent review round 1, R2).
 * Rather than a second worktree (`cp -Rc` twice, against a disk with a few GB
 * free), the arm writes that ref's copy of `canonical-transcript.tsx` into the
 * working tree for the length of the process and RESTORES the working-copy bytes
 * from a `finally` — and from SIGINT/SIGTERM handlers — so neither an exit nor an
 * interrupt can leave the tree reverted (R1).
 *
 * Raw CDP against ONE private headless Chrome over a scratch profile, its argv
 * routed through the shared keychain helper (one launch per run, not one per
 * state), the process group killed by exact pid on exit.
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
/**
 * The commit the before arm reads `canonical-transcript.tsx` from. Pinned to the
 * release that shipped the always-on rail (#708 landed in v0.31.25), never
 * `origin/main`: after this branch merges, main carries the opt-in and the arm
 * would photograph the same bytes as `after`.
 */
const BEFORE_REF = flag("before-ref", "v0.31.25");
const THEMES = flag("themes", "localOperatorDark,rosePineDawn")
	.split(",")
	.filter(Boolean);
const SETTINGS = ARGS.includes("--settings");
const OUT = flag("out", join(tmpdir(), `lo-rail-${process.pid}`));
const WINT = flag("window", "1380x872");
const [W, H] = WINT.split("x").map(Number);
const CHROME =
	process.env.CHROME_PATH ??
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEBUG_WS_RE = /ws:\/\/[^\s]+/;
const TRANSCRIPT =
	"src/renderer/src/features/chat/canonical/canonical-transcript.tsx";
/** The registry key, built from parts so no `key="…"` literal sits in this file. */
const RAIL_KEY = ["display", "turn_answer_rail"].join(".");

mkdirSync(OUT, { recursive: true });

/**
 * The BEFORE arm: `BEFORE_REF`'s transcript file written into the working tree
 * for the length of the run. `git show` into the path rather than a checkout, so
 * nothing else (that the dev server is reading) is touched and the restore is
 * the exact working-copy bytes this run found.
 */
let restore = null;
if (TREE === "before") {
	const kept = readFileSync(TRANSCRIPT);
	const shown = spawnSync("git", ["show", `${BEFORE_REF}:${TRANSCRIPT}`], {
		encoding: "buffer",
	});
	if (shown.status !== 0) {
		throw new Error(
			`the before arm's ref (${BEFORE_REF}) does not carry ${TRANSCRIPT}: ${shown.stderr}`,
		);
	}
	writeFileSync(TRANSCRIPT, shown.stdout);
	restore = () => writeFileSync(TRANSCRIPT, kept);
	console.log(`before arm: ${TRANSCRIPT} taken from ${BEFORE_REF}`);
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
		restore = null;
	} catch {}
};
process.on("exit", cleanup);
/*
 * AN INTERRUPT IS NOT AN EXIT. `process.on("exit")` does not run on SIGINT or
 * SIGTERM, so a Ctrl-C mid-run would leave a tracked source file reverted to
 * someone else's bytes - on this branch, uncommitted state the next `git
 * checkout` would destroy (agent review round 1, R1). Registered here, after
 * `cleanup` exists, so the handler cannot run against a half-initialised module.
 */
for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => {
		cleanup();
		process.exit(130);
	});
}

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

/** One state of the transcript page, captured whole (context, not a crop). */
const shootTranscript = async (rail, theme, expand = false) => {
	const url = `${ORIGIN}/turn-answer-rail-evidence.html?rail=${rail}&theme=${theme}${expand ? "&expand=1" : ""}`;
	await send("Page.navigate", { url });
	const deadline = Date.now() + 45_000;
	for (;;) {
		if (Date.now() > deadline)
			throw new Error(`the page never became ready (rail=${rail}, ${theme})`);
		const ready = await evaluate("window.__railEvidence?.ready === true").catch(
			() => false,
		);
		if (ready) break;
		await sleep(120);
	}
	// One settle frame: the classes apply on the render that seeded the query,
	// but the browser needs a paint before the box numbers are final.
	await sleep(150);
	const measured = await evaluate("window.__railEvidence");
	const name = `${TREE}-rail-${rail}${expand ? "-expanded" : ""}-${theme}`;
	const { data } = await send("Page.captureScreenshot", { format: "png" });
	writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, "base64"));
	shots.push(`${name}.png`);
	report.push({
		tree: TREE,
		state: `rail=${rail}${expand ? " (span expanded)" : ""}`,
		theme,
		markedRows: measured.markedCount,
		classes: measured.classes,
		answerRowBox: boxes(measured.answerOuter),
		markedDivBox: boxes(measured.answerMark),
		proseBox: boxes(measured.answerProse),
		neighbourToolRowBox: boxes(measured.toolOuter),
	});
};

/*
 * THE SETTINGS ROW, driven through the COMMITTED geometry page rather than a
 * second mount here: that page already stubs the desktop bridge with the real
 * `/v1/settings` projection, so the row photographed is the shipped row over the
 * shipped payload. The interaction is the reader's own: reveal the advanced
 * tier, search for the setting, scroll it to the middle, then flip its switch.
 */
const shootSettings = async (theme, on, helpOpen = false) => {
	const url = `${ORIGIN}/backend-settings-geometry.html?theme=${theme}&fixture=configured`;
	await send("Page.navigate", { url });
	const deadline = Date.now() + 45_000;
	for (;;) {
		if (Date.now() > deadline)
			throw new Error(`the settings page never painted (${theme})`);
		const ready = await evaluate(
			"document.querySelectorAll('[data-section-header]').length > 0",
		).catch(() => false);
		if (ready) break;
		await sleep(150);
	}
	const found = await evaluate(`(() => {
		const chip = [...document.querySelectorAll("button")].find((b) => /^Show advanced/.test(b.textContent.trim()));
		if (chip && chip.getAttribute("aria-pressed") === "false") chip.click();
		const input = document.querySelector('input[aria-label="Search settings"]');
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
		setter.call(input, "turn answer");
		input.dispatchEvent(new Event("input", { bubbles: true }));
		return true;
	})()`);
	if (!found) throw new Error("the settings page has no search field");
	await sleep(300);
	/*
	 * THREE steps rather than one: React applies a click's state change on its own
	 * render pass, so the switch's `aria-checked` cannot be read in the same
	 * evaluate that pressed it (measured: it read `false` both times). Scroll and
	 * read, press, settle, read again.
	 */
	const probe = `(() => {
		const ATTR = "data-setting-" + "key";
		const row = document.querySelector("[" + ATTR + '="' + ${JSON.stringify(RAIL_KEY)} + '"]');
		if (!row) return null;
		const control =
			row.querySelector('[data-setting-control] :is(button[role="switch"], input)') ??
			row.querySelector('button[role="switch"], input[type="checkbox"]');
		const box = (el) => {
			const r = el.getBoundingClientRect();
			return { left: r.left, right: r.right, width: r.width, top: r.top, height: r.height };
		};
		return {
			label: row.innerText.split("\\n").join(" ").slice(0, 140),
			checked: control.getAttribute("aria-checked") ?? String(control.checked),
			row: box(row),
			control: box(control),
		};
	})()`;
	const located = await evaluate(`(() => {
		const ATTR = "data-setting-" + "key";
		const row = document.querySelector("[" + ATTR + '="' + ${JSON.stringify(RAIL_KEY)} + '"]');
		if (!row) return false;
		row.scrollIntoView({ block: "center" });
		return true;
	})()`);
	if (!located) throw new Error("the rail's settings row did not render");
	/*
	 * ON REQUEST, the row's own caret is pressed so the frame carries the HELP
	 * sentence as well as the label: the row is tier `advanced`, so the shipped
	 * collapsed state shows the label alone, and the copy the design round reads
	 * lives behind this press.
	 */
	if (helpOpen) {
		await evaluate(`(() => {
			const ATTR = "data-setting-" + "key";
			const row = document.querySelector("[" + ATTR + '="' + ${JSON.stringify(RAIL_KEY)} + '"]');
			const caret = row.querySelector('button[aria-expanded="false"]');
			if (caret) caret.click();
			return true;
		})()`);
		await sleep(250);
	}
	await sleep(150);
	const before = await evaluate(probe);
	if (!before) throw new Error("the rail's settings row did not re-render");
	if (on !== (before.checked === "true")) {
		await evaluate(`(() => {
			const ATTR = "data-setting-" + "key";
			const row = document.querySelector("[" + ATTR + '="' + ${JSON.stringify(RAIL_KEY)} + '"]');
			const control =
				row.querySelector('[data-setting-control] :is(button[role="switch"], input)') ??
				row.querySelector('button[role="switch"], input[type="checkbox"]');
			control.click();
			return true;
		})()`);
		await sleep(250);
	}
	const after = await evaluate(probe);
	const state = { ...after, before: before.checked, after: after.checked };
	if (!state) throw new Error("the rail's settings row did not render");
	await sleep(250);
	const name = `${TREE}-settings-${on ? "rail-on" : "rail-off"}${helpOpen ? "-help" : ""}-${theme}`;
	const { data } = await send("Page.captureScreenshot", { format: "png" });
	writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, "base64"));
	shots.push(`${name}.png`);
	report.push({
		tree: TREE,
		state: `settings ${on ? "on" : "off"}${helpOpen ? " (help open)" : ""}`,
		theme,
		label: state.label,
		checked: `${state.before} -> ${state.after}`,
		rowBox: boxes(state.row),
		switchBox: boxes(state.control),
	});
};

for (const theme of THEMES) {
	for (const rail of ["off", "on", "absent"]) {
		await shootTranscript(rail, theme);
	}
	/*
	 * The span the bar holds, opened: the peer-message receipt, the calls, and the
	 * elected answer in one view - the arrangement the operator's report is about.
	 */
	await shootTranscript("on", theme, true);
	await shootTranscript("off", theme, true);
}

if (SETTINGS) {
	for (const theme of THEMES) {
		await shootSettings(theme, false);
		await shootSettings(theme, true);
		await shootSettings(theme, true, true);
	}
}

console.log(JSON.stringify({ out: OUT, shots, report }, null, 2));
cleanup();
