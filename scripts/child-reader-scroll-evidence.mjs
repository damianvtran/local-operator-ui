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
	const chrome = spawn(
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

async function main() {
	const profile = mkdtempSync(join(tmpdir(), "child-reader-scroll-chrome-"));
	let chrome = null;
	const vite = spawn(
		"pnpm",
		["vite", "--config", "scripts/child-reader-scroll-evidence.vite.mjs"],
		{
			cwd: ROOT,
			env: { ...process.env, CHILD_READER_SCROLL_PORT: String(PORT) },
			stdio: ["ignore", "pipe", "pipe"],
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
		vite.kill("SIGKILL");
		vite.stdout?.destroy();
		vite.stderr?.destroy();
		chrome?.kill("SIGKILL");
		chrome?.stdout?.destroy();
		chrome?.stderr?.destroy();
		try {
			rmSync(profile, { recursive: true, force: true });
		} catch {
			// Chrome may still hold a handle; the path is under the temp dir.
		}
	};
	process.on("SIGINT", () => {
		teardown();
		process.exit(130);
	});

	try {
		await waitFor(`http://localhost:${PORT}/child-reader-scroll-evidence.html`);
		const launched = await launchChrome(profile);
		chrome = launched.chrome;
		const send = launched.send;
		await send("Page.enable");
		await send("Runtime.enable");

		const evaluate = async (expression, awaitPromise = false) => {
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
		const step = async (label, expected) => {
			return waitForStep(label, expected, () => true, 0);
		};
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

			/* ---- A: anchored at the tail, rows arrive -------------------- */
			/*
			 * A positive `deltaY` wheels TOWARD the end of the content, which in this
			 * `column-reverse` scroller is the tail; negative is a reader travelling
			 * back into the conversation. The gesture is real so the paging policy
			 * sees an input event rather than only an offset change.
			 */
			await wheel(4000);
			await sleep(900);
			await step("A0 at the tail", "scrollTop 0, the newest row on screen");
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
			const settled = await step(
				"D0 settled",
				"no cadence is left: the read count stops moving",
			);
			await sleep(6000);
			const quiet = await step(
				"D1 six seconds later",
				"the read count is unchanged (no 5s safety-net poll)",
			);
			if (quiet.reads !== settled.reads)
				throw new Error(
					`${theme}: a settled child was read again (${settled.reads} -> ${quiet.reads})`,
				);
			await shoot("settled", theme);
		}

		const report = {
			arm: ARM,
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
				`  ${module.md5.slice(0, 12)}  ${module.path.split("/").pop()}`,
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
	const head = [
		"step",
		"scrollTop",
		"fromBottom",
		"extent",
		"rows",
		"anchor",
		"anchorOffset",
		"newestVisible",
		"newestCutPx",
		"button",
		"reads",
	];
	const rows = steps.map((s) => [
		s.step,
		String(s.scrollTop),
		String(s.fromBottom),
		String(s.extent),
		String(s.paintedRows),
		String(s.anchorId ?? "-"),
		s.anchorOffset === null ? "-" : s.anchorOffset.toFixed(1),
		String(s.newestVisible),
		s.newestCutPx === null || s.newestCutPx === undefined
			? "-"
			: s.newestCutPx.toFixed(1),
		s.button
			? `${s.button.visible ? "on" : "off"}${s.button.hitTestable ? "" : "/inert"}`
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
