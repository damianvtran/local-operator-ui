#!/usr/bin/env node
/**
 * Measure and photograph the child reader's scroll behaviour.
 *
 *     node scripts/child-reader-scroll-evidence.mjs [--arm=before|after]
 *         [--themes=localOperatorDark,localOperatorLight] [--out=<dir>]
 *         [--port=5197] [--json=<file>] [--frames]
 *
 * WHY THIS IS A SCRIPT AND NOT A TEST. The claim is about a scroll container
 * over TIME: which row sits at the top of the viewport when a page lands, where
 * the offset sits after it, and whether the newest row is on screen. A unit test
 * can assert that the reader called a function; only a real layout engine can
 * answer where the reader is LOOKING. So this drives the shipped pane in a real
 * headless Chrome, over raw CDP, the same way `diff-body-evidence.mjs` and
 * `scroll-paging-evidence.mjs` do — no browser-automation dependency, no
 * installed engine.
 *
 * WHAT IS REAL, AND WHAT IS NOT. Real: the reader, its loader and cadence, the
 * reducer, `CanonicalTranscript`, `useScrollPaging`, the app stylesheet, the
 * typed desktop transport's `/__desktop` branch, and the browser's own scroll
 * anchoring. Scripted: the BACKEND behind `/__desktop` — see
 * `child-reader-scroll-evidence.vite.mjs`, which answers `subagents.transcript`
 * from a list this driver grows a batch at a time. The wire's own half (a real
 * child process, a real file, `subagent_progress` relays) is
 * `docs/evidence/chat-run-panel-live/`'s subject, and the README states the
 * split rather than implying this rig covers it.
 *
 * HOW AN ARRIVAL IS MADE. `POST /__child/batch` appends one tool batch to the
 * scripted child, and then the harness bumps the `pulse` prop — the same order
 * the wire has, and the same signal the reader's cadence is keyed on. So the
 * rows reach the pane through the shipped tail read, not through its state.
 *
 * WHY THE WHEEL EVENTS ARE REAL. "Scrolled up" is a reader's gesture, and the
 * paging policy is required to distinguish a reader's motion from the layout's
 * (`use-scroll-paging.ts`, clause A). Writing `scrollTop` would produce a
 * `scroll` event and no input event, which is precisely the case that policy
 * ignores — so the scrolled-up states below are produced by
 * `Input.dispatchMouseEvent` wheel events through the browser's own input
 * pipeline, and the offsets are then read back.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assertFramePaints } from "./check-evidence.mjs";
import { withMockKeychain } from "./chrome-keychain.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const CHROME =
	process.env.CHROME_PATH ??
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEBUG_PORT = /ws:\/\/[^:]+:(\d+)\//;

const ARGS = process.argv.slice(2);
const flag = (name, fallback) => {
	const hit = ARGS.find((a) => a.startsWith(`--${name}=`));
	return hit ? hit.slice(name.length + 3) : fallback;
};

const ARM = flag("arm", "after");
const THEMES = flag("themes", "localOperatorDark").split(",");
const PORT = Number(flag("port", "5197"));
const OUT = flag(
	"out",
	join(ROOT, "docs", "evidence", "child-reader-tail-follow"),
);
const JSON_OUT = flag("json", null);
const WANT_FRAMES = ARGS.includes("--frames");
/*
 * The module digest this arm's own bytes must have (see `ARM_MODULE`), and the
 * step groups to run.
 *
 * `--expect-digest` exists because a LABEL IS NOT EVIDENCE. The first version of
 * this rig validated the arm against nothing: run it with `--arm=before` on a
 * branch where the change is committed and it happily reported the AFTER bytes
 * under `arm before`, exit 0 (review round 1, R1-1 — the reviewer followed the
 * shipped recipe and got exactly that). `scripts/child-reader-scroll-evidence-arms.mjs`
 * is what performs the swap; this is what refuses to mislabel it.
 *
 * `--only` exists for the palette sweep, which needs one state across twelve
 * palettes rather than fifteen states across two.
 */
const EXPECT_DIGEST = flag("expect-digest", null);
const ONLY = flag("only", null)
	?.split(",")
	.map((part) => part.trim())
	.filter((part) => part.length > 0);
/** Batches of the scripted child to place before the first reading. */
const SEED = Number(flag("seed", "21"));
/*
 * The modules under test, hashed into both reports.
 *
 * The before arm is produced by taking these back to the base revision by hand
 * (the README carries the two commands), so the two reports have to say WHICH
 * BYTES each one measured — otherwise two runs of the same tree can be
 * presented as a before/after pair, which is the failure
 * `scripts/paging-evidence-arms.mjs` was written to make impossible for the
 * paging rig. This is the same record by the same means, printed rather than
 * enforced because swapping the files is the operator's step here.
 */
/*
 * The module the two arms differ in. The before arm is this file taken back to
 * the base revision, so its digest is what says which arm a report came from;
 * the other three are listed to PROVE they did not move (they are the scroll
 * machinery this branch does not touch).
 */
const ARM_MODULE =
	"src/renderer/src/features/chat/components/run-details/run-child-reader.tsx";

const MODULES = [
	"src/renderer/src/features/chat/components/run-details/run-child-reader.tsx",
	"src/renderer/src/features/chat/canonical/canonical-transcript.tsx",
	"src/renderer/src/features/chat/canonical/use-scroll-paging.ts",
	"src/renderer/src/features/chat/canonical/scroll-paging.ts",
];
/*
 * The viewport is the frame's own size: tall enough that the pane (820px) sits
 * whole inside it, and narrow enough that the 420px pane is the pane the app
 * draws rather than a stretched one.
 */
const VIEWPORT = { width: 900, height: 900 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(url, attempts = 120) {
	for (let i = 0; i < attempts; i++) {
		try {
			const response = await fetch(url);
			if (response.ok) return;
		} catch {
			// not up yet
		}
		await sleep(500);
	}
	throw new Error(`${url} never came up`);
}

/** A private headless Chrome over raw CDP, the shape every rig here uses. */
async function launchChrome(profile) {
	if (!existsSync(CHROME))
		throw new Error(`no Chrome at ${CHROME} — set CHROME_PATH to one`);
	const chrome = spawnOwned(
		CHROME,
		withMockKeychain([
			"--headless=new",
			"--no-first-run",
			"--no-default-browser-check",
			"--remote-debugging-port=0",
			`--user-data-dir=${profile}`,
			"--disable-gpu",
			"--window-size=900,900",
			"about:blank",
		]),
		// `spawnOwned` puts it in its own group and remembers it AT SPAWN, which is
		// what closes R2-2: Chrome's renderer and GPU children are the ones a
		// killed wrapper leaves behind, and the handshake's await is exactly when
		// a signal used to make the browser unreachable.
	);
	const port = await new Promise((resolvePort, reject) => {
		chrome.stderr.on("data", (chunk) => {
			const match = DEBUG_PORT.exec(String(chunk));
			if (match) resolvePort(match[1]);
		});
		chrome.on("exit", (code) => reject(new Error(`Chrome exited (${code})`)));
		setTimeout(() => reject(new Error("Chrome reported no debug port")), 20000);
	});
	const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
	const page = list.find((target) => target.type === "page");
	let nextId = 1;
	const pending = new Map();
	const ws = new WebSocket(page.webSocketDebuggerUrl);
	ws.onmessage = (event) => {
		const message = JSON.parse(event.data);
		if (!message.id || !pending.has(message.id)) return;
		const { resolve: done, reject } = pending.get(message.id);
		pending.delete(message.id);
		message.error
			? reject(new Error(JSON.stringify(message.error)))
			: done(message.result);
	};
	await new Promise((opened) => {
		ws.onopen = opened;
	});
	const send = (method, params = {}) =>
		new Promise((done, reject) => {
			const id = nextId++;
			pending.set(id, { resolve: done, reject });
			ws.send(JSON.stringify({ id, method, params }));
		});
	return { chrome, send };
}

/**
 * The rows the driver records, in the order it takes them.
 *
 * The `expect` fields are the CLAIMS, stated before the run so a reader can see
 * which number falsifies which sentence — the same discipline the paging
 * evidence README applies to its own table.
 */
const STEPS = [];

/**
 * Every child this rig starts, tracked from the moment `spawn` returns.
 *
 * ROUND 2, R2-2: a child recorded only AFTER its handshake resolves is
 * unreachable to a signal that lands while the handshake is pending, and
 * Chrome's own tree goes with it (measured: 8 processes re-parented to pid 1
 * when the wrapper was signalled ~4s in, and none when signalled at ~30s). The
 * set is module-level so `launchChrome` can register at its own spawn rather
 * than returning a child nobody owns yet.
 */
const CHILDREN = new Set();

/** Spawn into its OWN PROCESS GROUP, and remember it. */
function spawnOwned(command, args, options = {}) {
	const child = spawn(command, args, { ...options, detached: true });
	CHILDREN.add(child);
	return child;
}

/**
 * Kill a child's process GROUP.
 *
 * The group first: `pnpm vite` forks a `vite` grandchild that re-parents to
 * launchd when only the wrapper is signalled, and that grandchild is what holds
 * the port. Chrome's renderer and GPU processes are the same shape.
 */
function killGroup(child) {
	if (!child?.pid) return;
	try {
		process.kill(-child.pid, "SIGKILL");
	} catch {
		// Already gone, or never had a group of its own.
	}
	try {
		child.kill("SIGKILL");
	} catch {
		// Same.
	}
	child.stdout?.destroy();
	child.stderr?.destroy();
	CHILDREN.delete(child);
}

function reapChildren() {
	for (const child of [...CHILDREN]) killGroup(child);
}

/**
 * Whether nothing is listening on the port yet.
 *
 * THE HAZARD THIS CLOSES is not tidiness. The rig waits for its own URL before
 * it starts, so a server left behind by an earlier run answers that wait — and
 * then the whole run measures bytes it did not start (review round 1, R1-2:
 * the reviewer saw a run complete with an orphan still holding the port). A
 * pre-flight is the cheap half; spawning into its own process group and killing
 * the GROUP is the other, because `pnpm vite` forks a grandchild that re-parents
 * to launchd when only the wrapper is signalled.
 */
function portInUse(port) {
	const probe = (host) =>
		new Promise((resolve) => {
			const socket = createConnection({ port, host });
			const settle = (value) => {
				socket.destroy();
				resolve(value);
			};
			socket.on("connect", () => settle(true));
			socket.on("error", () => settle(false));
			setTimeout(() => settle(false), 500);
		});
	return probe("::1").then((v6) => v6 || probe("127.0.0.1"));
}

async function main() {
	const profile = mkdtempSync(join(tmpdir(), "child-reader-scroll-chrome-"));
	let chrome = null;
	/*
	 * THE ARM IS CHECKED BEFORE A SINGLE FRAME IS TAKEN — AND BEFORE ANYTHING IS
	 * SPAWNED (review round 2, R2-1).
	 *
	 * `--arm` names the output directory and the report's label, and it cannot
	 * swap the code under test — so on a branch where the change is committed the
	 * two arms are the same bytes and the label is a lie (review round 1, R1-1).
	 * `scripts/child-reader-scroll-evidence-arms.mjs` performs the swap and hands
	 * this flag the digest it expects; this refuses to run if the bytes disagree.
	 *
	 * WHERE the refusal happens is the round-2 finding: this check used to sit
	 * below the Vite spawn and OUTSIDE the `try` that owns `teardown`, so the
	 * refusal exited with the rig's own `pnpm`→`vite` pair still holding the port
	 * (reproduced twice by the reviewer). The rig's own rule is that a run either
	 * measures its own bytes or holds nothing; a refusal now happens before the
	 * first child exists, and the port pre-flight below is ordered with it for the
	 * same reason.
	 */
	if (EXPECT_DIGEST) {
		const got = moduleDigest(ARM_MODULE);
		if (got !== EXPECT_DIGEST)
			throw new Error(
				`--expect-digest=${EXPECT_DIGEST} but ${ARM_MODULE} is ${got}: this arm is not the bytes it claims to be. Take the arm with \`node scripts/child-reader-scroll-evidence-arms.mjs ${ARM}${
					ARM === "after" ? "" : " <the-ref-this-arm-is-taken-from>"
				} -- <the rest of these arguments>\`, which checks the module out of that revision and passes this flag for you.`,
			);
	}

	if (await portInUse(PORT)) {
		throw new Error(
			`something is already listening on ${PORT}, and this rig cannot tell its own server from a stranger's: a leaked run would make every frame below a picture of bytes this run did not start. Find and reap it by pid - \`lsof -nP -iTCP:${PORT} -sTCP:LISTEN\` - or re-run with --port=<a free one>.`,
		);
	}
	const vite = spawnOwned(
		"pnpm",
		["vite", "--config", "scripts/child-reader-scroll-evidence.vite.mjs"],
		{
			cwd: ROOT,
			env: { ...process.env, CHILD_READER_SCROLL_PORT: String(PORT) },
			/*
			 * STDIN IS A PIPE THAT THE RIG HOLDS AND NEVER WRITES TO, and the server
			 * watches it: when this process goes away for ANY reason - a clean exit,
			 * a signal, `kill -9` - the write end closes, the server's fd 0 reaches
			 * EOF, and it closes itself (`child-reader-scroll-evidence.vite.mjs`).
			 * That is the one path no signal handler in this rig can cover, and it
			 * is the path a held port costs another session its run. The vite
			 * process inherits this fd through `pnpm`, so the watch is on the
			 * server's own stdin rather than on a wrapper's.
			 */
			stdio: ["pipe", "pipe", "pipe"],
		},
	);
	let viteLog = "";
	const collect = (chunk) => {
		viteLog += chunk;
	};
	vite.stdout.on("data", collect);
	vite.stderr.on("data", collect);

	/*
	 * Teardown kills both children AND detaches the handles this process holds on
	 * them.
	 *
	 * Measured, not defensive: with the kills alone the run printed its last line,
	 * wrote every frame and then sat for as long as its caller allowed (two runs
	 * under `timeout 700` both exited 124 with a complete report on stdout), because
	 * a killed child's piped stdio is still a live handle on this loop. The rig
	 * therefore tears its own handles down explicitly — the same reason
	 * `diff-body-evidence.mjs` kills the browser whose stderr it reads for the
	 * debug-port handshake — and `main` exits by name once the report is out.
	 */
	const teardown = () => {
		/*
		 * EVERY tracked child, not the two the happy path happens to hold: the set
		 * is what makes a signal during the Chrome handshake safe (R2-2).
		 */
		reapChildren();
		try {
			rmSync(profile, { recursive: true, force: true });
		} catch {
			// Chrome may still hold a handle; the path is under the temp dir.
		}
	};
	for (const [signal, code] of [
		["SIGINT", 130],
		["SIGTERM", 143],
		["SIGHUP", 129],
	]) {
		process.on(signal, () => {
			teardown();
			process.exit(code);
		});
	}

	try {
		await waitFor(`http://localhost:${PORT}/child-reader-scroll-evidence.html`);
		const launched = await launchChrome(profile);
		chrome = launched.chrome;
		const send = launched.send;
		await send("Page.enable");
		await send("Runtime.enable");

		const evaluate = async (expression, awaitPromise = false) => {
			/*
			 * A NAVIGATION RACE IS NOT A PAGE ERROR. This rig navigates once per
			 * palette, and a `Runtime.evaluate` in flight while the target unloads
			 * answers `-32000 Inspected target navigated or closed` rather than
			 * returning anything (observed on the twelve-palette sweep). Retried here,
			 * once per call site's problem rather than forty times: a real page
			 * exception is a different error and is NOT swallowed.
			 */
			for (let attempt = 0; ; attempt++) {
				try {
					const { result, exceptionDetails } = await send("Runtime.evaluate", {
						expression,
						awaitPromise,
						returnByValue: true,
					});
					if (exceptionDetails)
						throw new Error(
							`page threw: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`,
						);
					return result.value;
				} catch (error) {
					const racing =
						attempt < 6 &&
						/navigated or closed|Cannot find context|Execution context was destroyed/i.test(
							String(error),
						);
					if (!racing) throw error;
					await sleep(400);
				}
			}
		};
		/** A wheel event the renderer cannot tell from a trackpad's. */
		const wheel = async (deltaY) => {
			const box = await evaluate("window.__childScroll.scrollerBox()");
			if (!box) throw new Error("no scroller to wheel over");
			await send("Input.dispatchMouseEvent", {
				type: "mouseWheel",
				x: Math.round(box.x),
				y: Math.round(box.y),
				deltaX: 0,
				deltaY,
				pointerType: "mouse",
			});
		};
		const reads = async () => {
			const response = await fetch(`http://localhost:${PORT}/__child/state`);
			return (await response.json()).reads;
		};
		/**
		 * The read count, once it has stopped moving.
		 *
		 * The settled pair below is a claim about a SETTLED child, so a read that was
		 * already in flight when the settle landed must not be counted as one the
		 * settled child made. Observed once on this host at load ~138 (`a settled
		 * child was read again (54 -> 55)`, the previous arrival's refetch the
		 * obvious candidate), and the same rig had passed that assertion in three
		 * consecutive runs: the wait is what makes the pair measure the settled state
		 * rather than the tail of the previous step.
		 */
		const stableReads = async () => {
			let last = await reads();
			for (let attempt = 0; attempt < 20; attempt++) {
				await sleep(700);
				const now = await reads();
				if (now === last) return now;
				last = now;
			}
			return last;
		};
		/*
		 * One frame per STATE per theme, laid out the way the sweep lays its own out:
		 * `<slug>/<story>/<theme>.webp`. The directory name is not decoration — both
		 * `check-evidence.mjs`'s frame predicate and its manifest arithmetic read the
		 * theme off the FILENAME, so a frame called `localOperatorDark-anchored.webp`
		 * resolves to no palette at all and fails the gate as "not a picture of the
		 * app" rather than as a naming mistake.
		 */
		const shoot = async (state, theme) => {
			if (!WANT_FRAMES) return null;
			const { data } = await send("Page.captureScreenshot", {
				format: "webp",
				quality: 88,
			});
			const dir = join(OUT, ARM, state);
			mkdirSync(dir, { recursive: true });
			const frame = join(dir, `${theme}.webp`);
			writeFileSync(frame, Buffer.from(data, "base64"));
			await assertFramePaints(frame, theme);
			return frame;
		};
		/*
		 * The palette the CURRENT theme loop is on. The row builder is defined
		 * outside that loop (it is shared by every step) and each row records the
		 * palette it measured, so the loop's own variable cannot be the one it
		 * reads: it would be out of scope here and, worse, a `let` captured by
		 * closure would be right by accident.
		 */
		let themeOf = THEMES[0];
		const step = async (label, expected) => {
			return waitForStep(label, expected, () => true, 0);
		};
		/*
		 * `null` and `undefined` are the same answer here, and the difference is
		 * real: `reading()` returns `null` when the pane paints no scroller at all
		 * (the session-less child), so a spread row carries no key rather than a
		 * null one. A gate that "has no control" must accept both, or it reports a
		 * failure on the state it is meant to describe.
		 */
		const absent = (value) => value === null || value === undefined;
		/**
		 * A reading taken once a condition holds, or when the bound expires.
		 *
		 * `step` is this with "immediately, unconditionally", which is what most of the
		 * states want; the couple that depend on the pane's own commit rate ask for the
		 * condition, so the run samples the state it means rather than whichever side
		 * of a tick it happened to land on.
		 */
		const waitForStep = async (label, expected, holds, timeoutMs) => {
			if (timeoutMs > 0) {
				const until = Date.now() + timeoutMs;
				while (Date.now() < until) {
					const reading = await evaluate("window.__childScroll.measure()");
					if (reading && holds(reading)) break;
					await sleep(100);
				}
			}
			const reading = await evaluate("window.__childScroll.measure()");
			const row = {
				step: label,
				/*
				 * The palette is ON the row, not inferred from its position in the file.
				 * Two themes run back to back and the palette sweep runs twelve, so a
				 * reader who cannot tell which palette a row measured has to trust the
				 * order — which is the class of mistake this rig was already bitten by
				 * once (review round 1, R1-1).
				 */
				theme: themeOf,
				expected,
				...reading,
				reads: await reads(),
			};
			STEPS.push(row);
			return row;
		};

		for (const theme of THEMES) {
			await send("Emulation.setDeviceMetricsOverride", {
				...VIEWPORT,
				deviceScaleFactor: 1,
				mobile: false,
			});
			const url = `http://localhost:${PORT}/child-reader-scroll-evidence.html?theme=${theme}`;
			themeOf = theme;
			await send("Page.navigate", { url });
			let ready = false;
			for (let attempt = 0; attempt < 120; attempt++) {
				if (await evaluate("Boolean(window.__childScroll)")) {
					ready = true;
					break;
				}
				await sleep(250);
			}
			if (!ready)
				throw new Error(`${theme}: the harness never armed __childScroll`);
			const themeNow = await evaluate("document.documentElement.dataset.theme");
			if (themeNow !== theme)
				throw new Error(`${theme}: the page carries theme ${themeNow}`);
			/* Each theme measures its own run of the scripted child from the launch turn. */
			await evaluate("window.__childScroll.reset()", true);

			/*
			 * Seed: enough batches that the child's conversation overflows the
			 * pane, which is the only state in which "the tail" is a position at
			 * all.
			 */
			/*
			 * The seed is deliberately PAST `WINDOW` (60 rows in
			 * `canonical-transcript.tsx`), because that is the state a watched child is
			 * in within a minute or two of real work and it is a different scroller: the
			 * local window saturates, so every arrival DROPS the oldest mounted row as
			 * well as appending a new one, and the top slot changes state with it. A
			 * seed under 60 measures the wide-open case only.
			 */
			await evaluate(`window.__childScroll.batch(${SEED})`, true);
			await sleep(400);
			const seeded = await step(
				"0 seeded",
				"the pane is scrollable and opened at the tail",
			);
			if (!seeded.canScroll)
				throw new Error(
					`${theme}: the child's page does not overflow the pane, so there is no tail to follow`,
				);

			/*
			 * The palette sweep: ONE state per palette.
			 *
			 * Design D1 asks for the control's own boundary across all twelve
			 * palettes, because the ring is the whole boundary (the fill measures
			 * 1.07-1.09:1 off the transcript ground) and the palettes are where that
			 * changes. The state that carries it shows the control over the
			 * conversation with nothing else in the frame, so the sweep takes that
			 * state rather than paying fifteen states times ten palettes.
			 */
			/*
			 * The foot group: the states the FOCUS RULE appeared in wrongly, for an
			 * arm taken from a head that had the band without the clip (design round
			 * 2, D6 — `scripts/child-reader-scroll-evidence-arms.mjs prev <ref>`
			 * produces it). Two states rather than sixteen: the rule is a property of
			 * the foot's geometry, and `at-tail` and `scrolled-up` are the two the
			 * foot's own composition is judged from, in every palette asked for.
			 */
			if (ONLY?.includes("foot")) {
				const tailFoot = await step(
					"P0 at the tail (foot group)",
					"the foot's own composition with the control hidden",
				);
				/*
				 * THE RULE MUST NOT SHOW (design round 2, D6). The ring's bottom
				 * segment is paint an ancestor's clip either keeps or cuts; the fix
				 * keeps the clip at the scroller's own box, so the ring lies BEYOND the
				 * clip bottom and nothing can paint in the band. `contained` true is
				 * the defect this step exists to catch: the ring painting inside the
				 * clip box again, which is the rule this round removed.
				 */
				if (ARM === "after" && tailFoot.ringClip?.contained)
					throw new Error(
						`${theme}: the scroller's focus ring paints inside its clip box (ring bottom ${tailFoot.ringClip.ringBottom}, clip ${tailFoot.ringClip.clipBottom}) — the band is showing a segment of the ring again`,
					);
				await shoot("at-tail", theme);
				await wheel(-600);
				await sleep(700);
				const scrolledFoot = await step(
					"P1 scrolled up (foot group)",
					"the foot's own composition with the control shown",
				);
				if (ARM === "after" && scrolledFoot.ringClip?.contained)
					throw new Error(
						`${theme}: the scroller's focus ring paints inside its clip box while scrolled up (ring bottom ${scrolledFoot.ringClip.ringBottom}, clip ${scrolledFoot.ringClip.clipBottom}) — the band is showing a segment of the ring again`,
					);
				await shoot("scrolled-up", theme);
				continue;
			}
			if (ONLY?.includes("ring")) {
				await wheel(-600);
				await sleep(700);
				const ring = await step(
					"R0 scrolled up (palette sweep)",
					"the control is shown, over this palette's own transcript ground",
				);
				if (ARM === "after" && !ring.button?.visible)
					throw new Error(
						`${theme}: no control while scrolled up, so this palette has no boundary to judge`,
					);
				/*
				 * Its own state directory rather than the core run's `scrolled-up`:
				 * the sweep takes its reading much earlier in the child's life (right
				 * after the seed), so a frame from here is a different picture of a
				 * different row set, and two sets of frames that look alike should not
				 * share a name.
				 */
				await shoot("ring", theme);
				continue;
			}

			/* ---- A: anchored at the tail, rows arrive -------------------- */
			/*
			 * A positive `deltaY` wheels TOWARD the end of the content, which in this
			 * `column-reverse` scroller is the tail; negative is a reader travelling
			 * back into the conversation. The gesture is real so the paging policy
			 * sees an input event rather than only an offset change.
			 */
			await wheel(4000);
			await sleep(900);
			const tailReading = await step(
				"A0 at the tail",
				"scrollTop 0, the newest row on screen",
			);
			/*
			 * R2-7: the semantic guard at the foot of this function, pulled up to where
			 * it can still be BEFORE the first frame is written. A bare
			 * `--arm=before --frames` on the head's bytes used to overwrite the `before/`
			 * frames it reached and only then hit the end-of-run guard, so a reader who
			 * ignored the exit status was left holding after pictures labelled before.
			 * The first reading is the cheapest place to notice: a before arm is defined
			 * by having NO control at all, and this state paints none.
			 */
			if (ARM === "before" && !absent(tailReading.button))
				throw new Error(
					`${theme}: the first reading found a follow-the-tail control, and the before arm is defined by NOT having one — refusing before a single frame is written (the module digest says ${moduleDigest(ARM_MODULE)}, so the arm's label and its bytes disagree about what is being measured).`,
				);
			const tailSteps = [];
			for (let i = 1; i <= 3; i++) {
				await evaluate("window.__childScroll.batch(1)", true);
				await sleep(250);
				tailSteps.push(
					await step(
						`A${i} after a batch`,
						"scrollTop stays 0 and the newest row is on screen",
					),
				);
			}
			/*
			 * The claim, asserted rather than only printed — and ONLY for the fixed
			 * arm. The before arm exists to show this failing, so asserting it there
			 * would make the before arm unrunnable, which is how a rig stops being
			 * usable as evidence.
			 */
			/*
			 * The tail-follow claim, asserted in BOTH arms: this is a property of the
			 * shipped head rather than of the change, and the point of the rig is to say
			 * whether it holds. `newestCutPx` is the sharp form (the number of pixels of
			 * the newest row below the fold), so a batch that half-fell off screen fails
			 * where `newestVisible` would have passed it.
			 */
			for (const reading of tailSteps) {
				if (reading.fromBottom > 0.5)
					throw new Error(
						`${theme}: ${reading.step} left the reader ${reading.fromBottom}px from the tail`,
					);
				if ((reading.newestCutPx ?? 0) > 1)
					throw new Error(
						`${theme}: ${reading.step} cut ${reading.newestCutPx}px off the newest row`,
					);
			}
			await shoot("anchored", theme);
			/* ---- B: scrolled up, rows arrive ----------------------------- */
			await wheel(-600);
			await sleep(700);
			const before = await step(
				"B0 scrolled up",
				"a reading position above the tail (fromBottom > 0)",
			);
			await shoot("scrolled-up", theme);
			const upSteps = [];
			for (let i = 1; i <= 2; i++) {
				await evaluate("window.__childScroll.batch(1)", true);
				await sleep(250);
				upSteps.push(
					await step(
						`B${i} after a batch`,
						`the viewport does not move (anchor ${before.anchorId} holds its offset)`,
					),
				);
			}
			if (ARM === "after") {
				for (const reading of upSteps) {
					/*
					 * The invariant is the ANCHORED ROW's on-screen offset, not
					 * `scrollTop`: a page that lands below the held row grows the extent
					 * under a pinned reader, so `scrollTop` legitimately moves by the
					 * growth while the reader sees nothing move at all. Asserting on
					 * `scrollTop` here would demand the reader BE yanked.
					 */
					if (reading.anchorId !== before.anchorId)
						throw new Error(
							`${theme}: ${reading.step} moved the reader's anchor ${before.anchorId} -> ${reading.anchorId}`,
						);
					const drift = Math.abs(
						(reading.anchorOffset ?? 0) - (before.anchorOffset ?? 0),
					);
					if (drift > 1)
						throw new Error(
							`${theme}: ${reading.step} yanked the reader ${drift}px (anchor offset ${before.anchorOffset} -> ${reading.anchorOffset})`,
						);
				}
			}
			await shoot("scrolled-up-after-batches", theme);

			/* ---- C: the affordance -------------------------------------- */
			const scrolledUp = await step(
				"C0 scrolled up",
				"the scroll-to-bottom control is present and hit-testable",
			);
			if (ARM === "after") {
				if (!scrolledUp.button?.visible || !scrolledUp.button.hitTestable)
					throw new Error(
						`${theme}: no usable scroll-to-bottom control while scrolled up ` +
							`(${JSON.stringify(scrolledUp.button)})`,
					);
			}
			await wheel(4000);
			await sleep(700);
			const atTail = await step(
				"C1 back at the tail",
				"the control is hidden at the tail",
			);
			await shoot("at-tail", theme);
			if (atTail.button?.hitTestable)
				throw new Error(
					`${theme}: the hidden control is still a hit target — the trap scroll-to-bottom-button.tsx documents`,
				);

			/* ---- E: a reader a few pixels off the tail ------------------- */
			/*
			 * THE MEASUREMENT THIS HALF OF THE SLICE TURNS ON. `column-reverse` puts the
			 * newest row at `scrollTop === 0`, and the browser's own `overflow-anchor`
			 * pins a reader who is exactly there — which `A0` to `A3` show for a reader at
			 * the origin. This step asks the harder question: a reader a few pixels off
			 * it (trackpad momentum, a bounce, a late image) is still inside
			 * `TAIL_EPS_PX`, so the product's own definition says they are following the
			 * tail — does the next arrival land below the fold?
			 *
			 * The failing shape is real and was measured in a bare scroller carrying this
			 * scroller's own declarations (headless Chromium, 2026-09-24): at `scrollTop`
			 * -3 an appended batch moved the offset to -147, and in a second run to -267,
			 * putting the newest row 144-247px below the fold, because the browser
			 * switched from "pinned to the end" to "hold the anchored row". Whether THIS
			 * tree is in that state is a question for the reading, not for the argument.
			 *
			 * E0 is read from the placement itself, in the same evaluate: a round trip
			 * later is already a different state, and what is under test is the offset
			 * rather than how it got there.
			 */
			const placed = await evaluate("window.__childScroll.drift(3)", true);
			STEPS.push({
				...placed,
				step: "E0 3px off the tail",
				theme,
				/*
				 * The route's read count, taken here rather than dropped: this row is
				 * built from the placement's own return value, and the omission left a
				 * `null` in a column whose every other row is a number (review round 1,
				 * R1-4). It is the count BEFORE the arrival two lines down, which is what
				 * makes the E1 delta readable as "one read for one batch".
				 */
				reads: await reads(),
				expected: "placed and read in the same frame, inside TAIL_EPS_PX",
			});
			if (placed.fromBottom < 0.5)
				throw new Error(
					`${theme}: E0 could not place the offset off the origin`,
				);
			if (placed.fromBottom > 24)
				throw new Error(
					`${theme}: E0 landed outside TAIL_EPS_PX (${placed.fromBottom}px)`,
				);
			await sleep(400);
			await shoot("drifted", theme);
			await evaluate("window.__childScroll.batch(1)", true);
			await sleep(300);
			const afterDrift = await step(
				"E1 after a batch",
				"the arrival lands on screen and the reader stays inside TAIL_EPS_PX",
			);
			if (afterDrift.fromBottom > 24)
				throw new Error(
					`${theme}: E1 left the reader ${afterDrift.fromBottom}px from the tail`,
				);
			if ((afterDrift.newestCutPx ?? 0) > placed.fromBottom + 1)
				throw new Error(
					`${theme}: E1 cut ${afterDrift.newestCutPx}px off the newest row - the batch landed below the fold`,
				);
			await evaluate("window.__childScroll.batch(1)", true);
			await sleep(300);
			const afterSecond = await step(
				"E2 after a second batch",
				"and again: the drift does not accumulate",
			);
			if (afterSecond.fromBottom > 24)
				throw new Error(
					`${theme}: E2 left the reader ${afterSecond.fromBottom}px from the tail`,
				);
			await shoot("drifted-then-batch", theme);

			/* ---- D: a settled child ------------------------------------- */
			await evaluate("window.__childScroll.settle()", true);
			await stableReads();
			const settled = await step(
				"D0 settled",
				"no cadence is left: the read count has stopped moving",
			);
			/*
			 * Two safety-net intervals, not one: the reader's fallback poll is 5s, so a
			 * 6s window can miss a poll by landing inside it and the assertion would
			 * pass on a pane that polls. Eleven seconds cannot.
			 */
			await sleep(11000);
			const quiet = await step(
				"D1 eleven seconds later",
				"the read count is unchanged across two 5s poll intervals",
			);
			if (quiet.reads !== settled.reads)
				throw new Error(
					`${theme}: a settled child was read again (${settled.reads} -> ${quiet.reads})`,
				);
			await shoot("settled", theme);

			/* ---- F: the band the threshold lives in (UX U3) --------------- */
			/*
			 * U3's state, and the number that made it a finding: the paging policy says a
			 * reader past `TAIL_EPS_PX` (24px) is NOT following the tail, while the
			 * control's own threshold was 50 — so 26-49px off the tail was the one band
			 * where a reader was quietly being left behind with nothing offered. The
			 * placement is a write rather than a gesture for the same reason E's is: the
			 * claim is about the STATE, and a small wheel delta is subject to the
			 * browser's own snap.
			 */
			const nearTailPlaced = await evaluate(
				"window.__childScroll.drift(40)",
				true,
			);
			if (nearTailPlaced.fromBottom !== 40)
				throw new Error(
					`${theme}: F0 could not place the offset at 40px (${nearTailPlaced.fromBottom})`,
				);
			/*
			 * The placement is a synchronous write, but the control's visibility is
			 * not: the hook updates inside a `requestAnimationFrame` off the scroll
			 * event. A read in the same turn would sample the state before that rAF
			 * and report a hidden control for a code path that is about to show it —
			 * the assertion below would then fail for the rig's own reason.
			 */
			/*
			 * Polled, not slept: the control's visibility lands a frame after the
			 * placement (the hook recomputes inside a `requestAnimationFrame`), and a
			 * fixed sleep either wastes time or, under load, samples the state before
			 * the frame that carries it (R2-5's shape).
			 */
			const nearTail = await waitForStep(
				"F0 40px off the tail",
				"inside the band the paging policy calls not-following, so the control is offered",
				(reading) => reading?.button?.visible === true,
				8000,
			);
			if (ARM === "after" && !nearTail.button?.visible)
				throw new Error(
					`${theme}: a reader 40px off the tail is not offered the way back — the control's threshold is above TAIL_EPS_PX again`,
				);
			await shoot("near-tail-40", theme);
			await evaluate("window.__childScroll.batch(1)", true);
			await sleep(300);
			const nearTailAfter = await step(
				"F1 after a batch",
				"the arrival moves the tail away AND the way back is on screen",
			);
			if (ARM === "after" && !nearTailAfter.button?.visible)
				throw new Error(
					`${theme}: the control left the screen while the reader was being left behind`,
				);
			await shoot("near-tail-40-after-batch", theme);

			/* ---- G: the control's own interaction states (design D4) ------ */
			await evaluate("window.__childScroll.drift(0)", true);
			await sleep(200);
			/*
			 * THE APPEARANCE, FROZEN RATHER THAN RACED (design round 2, D7).
			 *
			 * The pair used to be two frames taken after sleeps, and both were
			 * settled — mean |Δ| 0.05/255 in the chip's own box in light — so the
			 * pairing answered nothing about the transition. `freezeFade` watches for
			 * the transition on the frame it starts, pauses it and moves its clock to
			 * 40% of the duration it actually has, so `appearing` is a fade in
			 * flight; `runFade` then completes it for `appeared`. Both frames carry
			 * the wrapper's computed opacity in their readings, so the pair is a
			 * number even if a capture lands late.
			 */
			await wheel(-600);
			const frozen = await evaluate(
				"window.__childScroll.freezeFade(0.4)",
				true,
			);
			const appearing = await waitForStep(
				"G0 the control appearing (fade frozen at 40%)",
				"a fade in flight: the control is mounted, its opacity is mid-transition",
				(reading) => reading?.button?.visible === true,
				8000,
			);
			appearing.frozen = frozen;
			if (ARM === "after" && !appearing.button?.visible)
				throw new Error(
					`${theme}: the control never appeared while the reader was scrolled up`,
				);
			if (ARM === "after" && frozen.count === 0)
				throw new Error(
					`${theme}: no transition was running when the control appeared, so this arm cannot show the fade`,
				);
			await shoot("appearing", theme);
			const released = await evaluate("window.__childScroll.runFade()", true);
			await sleep(400);
			const appeared = await step(
				"G1 the control settled (fade released)",
				"the fade has completed: opacity 1",
			);
			appeared.released = released;
			await shoot("appeared", theme);
			const chip = await evaluate("window.__childScroll.chipBox()");
			if (ARM === "after" && !chip)
				throw new Error(`${theme}: no control to point at while scrolled up`);

			if (chip) {
				await send("Input.dispatchMouseEvent", {
					type: "mouseMoved",
					x: chip.x,
					y: chip.y,
					button: "none",
					clickCount: 0,
				});
				await sleep(260);
				const hovered = await step(
					"G2 hover",
					"a real pointer over the control",
				);
				if (ARM === "after" && !hovered.button?.hovered)
					throw new Error(
						`${theme}: the pointer is over the control but it does not read as hovered`,
					);
				await shoot("hover", theme);

				/*
				 * Focus by REAL Tab presses, counted: the claim is about the pane's tab
				 * order (UX U4 moved the control to the top of the DOM for it), and a
				 * programmatic `.focus()` would prove nothing about the order.
				 */
				let focused = null;
				let tabs = 0;
				for (let press = 0; press < 24 && !focused; press++) {
					await send("Input.dispatchKeyEvent", {
						type: "rawKeyDown",
						key: "Tab",
						code: "Tab",
						windowsVirtualKeyCode: 9,
						nativeVirtualKeyCode: 9,
					});
					await send("Input.dispatchKeyEvent", {
						type: "keyUp",
						key: "Tab",
						code: "Tab",
						windowsVirtualKeyCode: 9,
						nativeVirtualKeyCode: 9,
					});
					tabs = press + 1;
					await sleep(140);
					const now = await evaluate("window.__childScroll.measure()");
					if (now?.button?.focused) focused = now;
				}
				if (ARM === "after" && !focused)
					throw new Error(
						`${theme}: ${tabs} Tab presses never reached the control`,
					);
				const order = await evaluate("window.__childScroll.tabOrder()");
				const at = order.findIndex((entry) => entry.isControl);
				if (ARM === "after" && at < 0)
					throw new Error(
						`${theme}: the control is not in the page's tab order at all`,
					);
				if (focused)
					STEPS.push({
						...focused,
						step: `G3 focus (${tabs} tabs)`,
						theme: themeOf,
						reads: await reads(),
						tabOrderIndex: at,
						tabOrderLength: order.length,
						expected:
							"keyboard focus lands on the control, and it sits with the pane's own controls rather than after the conversation",
					});
				await shoot("focus", theme);

				/*
				 * A real press, held: the frame is taken while the button is down, which is
				 * the only way a `:active` state is a picture rather than a claim.
				 */
				await send("Input.dispatchMouseEvent", {
					type: "mousePressed",
					x: chip.x,
					y: chip.y,
					button: "left",
					clickCount: 1,
				});
				await sleep(140);
				await shoot("pressed", theme);
				await send("Input.dispatchMouseEvent", {
					type: "mouseReleased",
					x: chip.x,
					y: chip.y,
					button: "left",
					clickCount: 1,
				});
				/*
				 * WAIT ON THE EVENT, NOT ON A CLOCK (review round 2, R2-5). This was a
				 * `sleep 1400` followed by a 1px tolerance, and it flaked in the
				 * reviewer's round at load ~200 ("pressing the control left the reader
				 * 192px from the tail") — a smooth scroll still in flight read as a
				 * product defect. A wait that can read a mid-flight state as a failure
				 * is a defect in the instrument, so the state is polled until it holds
				 * (`waitForStep`) and the elapsed wait is recorded on the row; the
				 * assertion below still fires, with the time it waited, if the bound
				 * expires.
				 */
				const pressStart = Date.now();
				const afterPress = await waitForStep(
					"G4 after the press",
					"the reader is back at the tail and the control is hidden again",
					(reading) =>
						(reading?.fromBottom ?? Number.POSITIVE_INFINITY) <= 1 &&
						!reading?.button?.visible,
					8000,
				);
				afterPress.waitedMs = Date.now() - pressStart;
				/*
				 * The throw re-asserts BOTH halves of the poll condition above (agent review
				 * round 3, F4): checking only `fromBottom` let a control that stayed visible
				 * at the tail time out, record `button: on` with the full waitedMs, and pass
				 * the run - a state the poll itself refuses to accept.
				 */
				if (afterPress.fromBottom > 1 || afterPress.button?.visible)
					throw new Error(
						`${theme}: pressing the control left the reader ${afterPress.fromBottom}px from the tail${afterPress.button?.visible ? " with the control still showing" : ""} after waiting ${afterPress.waitedMs}ms`,
					);
			}

			/* ---- H: the gate (design D3, QA Q2) -------------------------- */
			await wheel(-600);
			await sleep(700);
			await evaluate('window.__childScroll.shape("failed")', true);
			const failed = await step(
				"H0 a failed child, scrolled up",
				"no control and no band: the exception text owns the foot",
			);
			if (!absent(failed.button) || !absent(failed.band))
				throw new Error(
					`${theme}: a failed child paints the control's band or the control itself over its exception text (button=${JSON.stringify(failed.button)}, band=${JSON.stringify(failed.band)})`,
				);
			await shoot("failed-scrolled-up", theme);
			await evaluate('window.__childScroll.shape("no-session")', true);
			const noSession = await step(
				"H1 a child with no session id",
				"no control and no band: there is no scroller to lead back to",
			);
			if (!absent(noSession.button) || !absent(noSession.band))
				throw new Error(
					`${theme}: a session-less child paints the control's band or the control (button=${JSON.stringify(noSession.button)}, band=${JSON.stringify(noSession.band)})`,
				);
			if (!absent(noSession.scrollTop))
				throw new Error(
					`${theme}: a session-less child still has a scroller to lead back to (${noSession.scrollTop})`,
				);
			await shoot("no-session", theme);
			await evaluate('window.__childScroll.shape("live")', true);
			await sleep(300);
		}

		/*
		 * And the semantic half, which the digest cannot state: the BEFORE arm has
		 * no control in it at all. A digest check catches a swap that did not happen;
		 * this catches the other direction — a harness that stopped painting the
		 * control would make the before arm pass by carrying the after arm's failure.
		 */
		if (ARM === "before" && STEPS.some((row) => !absent(row.button)))
			throw new Error(
				`${ARM}: a reading found a follow-the-tail control, and the before arm is defined by NOT having one — the module digest says ${moduleDigest(ARM_MODULE)}, so the arm's label and its bytes disagree about what is being measured.`,
			);

		const report = {
			arm: ARM,
			armModule: ARM_MODULE,
			expectDigest: EXPECT_DIGEST,
			head: exec(["git", "rev-parse", "HEAD"]).trim(),
			/*
			 * The bytes each arm measured, module by module. Two reports are a
			 * before/after pair only if these differ, and printing them is what makes
			 * that checkable instead of asserted in prose.
			 */
			modules: MODULES.map((path) => ({
				path,
				md5: moduleDigest(path),
			})),
			themes: THEMES,
			viewport: VIEWPORT,
			steps: STEPS,
		};
		if (JSON_OUT) {
			mkdirSync(resolve(JSON_OUT, ".."), { recursive: true });
			writeFileSync(JSON_OUT, `${JSON.stringify(report, null, 2)}\n`);
		}
		print(STEPS);
		for (const module of report.modules)
			console.log(
				`  ${module.md5.slice(0, 12)}  ${module.path.split("/").pop()}${
					module.path === ARM_MODULE ? "   <- the arm's module" : ""
				}`,
			);
		console.log(
			`\narm ${ARM} · head ${report.head.slice(0, 9)} · ${STEPS.length} readings${
				WANT_FRAMES ? ` · frames in ${join(OUT, ARM)}` : ""
			}`,
		);
	} catch (error) {
		teardown();
		console.error(viteLog.split("\n").slice(-12).join("\n"));
		throw error;
	}
	teardown();
	// The report is written and the children are reaped; exit by name rather
	// than waiting for a handle to drain (see `teardown`).
	process.exit(0);
}

function exec(command) {
	return spawnSync(command[0], command.slice(1), {
		cwd: ROOT,
		encoding: "utf8",
	}).stdout;
}

/** The md5 of one module under test, as it stands on disk right now. */
function moduleDigest(path) {
	return createHash("md5")
		.update(readFileSync(join(ROOT, path)))
		.digest("hex");
}

/** The readings as a table, which is the artefact a reviewer reads. */
function print(steps) {
	/*
	 * Every cell is a string, and a reading that does not exist is "-" rather than
	 * a crash: the session-less child paints no scroller, so its row has no
	 * `scrollTop` to print, and the table is the artefact a reviewer reads.
	 */
	const num = (value, digits = 1) =>
		value === null || value === undefined ? "-" : Number(value).toFixed(digits);
	const head = [
		"step",
		"scrollTop",
		"fromBottom",
		"extent",
		"rows",
		"anchor",
		"anchorOffset",
		"cut",
		/*
		 * `cover` is the control's own footprint on the transcript: the tallest
		 * intersection between its box and any painted row's. Zero is the clearance
		 * the band is reserved for, so the fix is a number in the artefact rather
		 * than a sentence in the pull request (QA Q1, UX U1).
		 */
		"cover",
		"under",
		"band",
		"tab",
		"button",
		"reads",
	];
	const rows = steps.map((s) => [
		s.step,
		s.scrollTop === undefined ? "-" : String(s.scrollTop),
		s.fromBottom === undefined ? "-" : String(s.fromBottom),
		s.extent === undefined ? "-" : String(s.extent),
		s.paintedRows === undefined ? "-" : String(s.paintedRows),
		String(s.anchorId ?? "-"),
		num(s.anchorOffset),
		num(s.newestCutPx),
		s.button ? num(s.button.overlapPx) : "-",
		s.button?.underCentre ?? "-",
		s.band ? num(s.band.height) : "-",
		s.tabOrderIndex === undefined
			? "-"
			: `${s.tabOrderIndex}/${s.tabOrderLength}`,
		s.button
			? `${s.button.visible ? "on" : "off"}${s.button.hitTestable ? "" : "/inert"}${
					s.button.hovered ? "/hover" : ""
				}${s.button.focused ? "/focus" : ""}`
			: "absent",
		String(s.reads),
	]);
	const widths = head.map((h, i) =>
		Math.max(h.length, ...rows.map((r) => r[i].length)),
	);
	const line = (cells) =>
		cells.map((cell, i) => cell.padEnd(widths[i])).join("  ");
	console.log(line(head));
	console.log(line(widths.map((w) => "-".repeat(w))));
	for (const row of rows) console.log(line(row));
}

await main();
