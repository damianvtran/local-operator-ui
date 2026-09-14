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
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

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
/**
 * Write frames instead of a phase table: `docs/evidence/session-switch/
 * <state>/<theme>.webp`. One directory per state, and the states are the ones a
 * switch can put on screen.
 *
 * A capture runs with a deliberately LONG stream delay (see `--stream`), not
 * because the timings are being reported but because the hydrating state is a
 * window: it is photographed while it lasts, and at the shipped millisecond
 * scale no screenshot round trip could land inside it.
 */
const FRAMES = flag("frames", null);
/**
 * The states a capture writes, and the page each one is driven on.
 *
 * `hydrating` and `settled` are the switch's two states. The other four exist
 * because a still of those two cannot answer the questions they raise:
 *
 * - `mark`: the PR body's defence is that the sidebar row's own selected state
 *   is the acknowledgement now, and in a 24-row list the switched-to row sits
 *   below the captured window - so the frames showed a sidebar band of plain
 *   `surface` where the mark is claimed to be. This frame scrolls that row into
 *   view first. (The hover half of the same request is NOT captured: see the
 *   note on `mark` below.)
 * - `error`: the rollback's failure sentence, which had no frame while it was
 *   also (measured) painted for about 5 ms and cleared.
 * - `slow`: the same hydrating state at the pulse TROUGH. At shipped latency
 *   this state is three frames and invisible; on a slow or remote backend it is
 *   the whole first impression, and it is the frame that exposes a placeholder
 *   whose animation takes it under the contract's floor.
 * - `refusal`: the read window refusing a send - the sentence the composer
 *   paints when the user presses Enter before anything has confirmed the target
 *   (UX round 2 U8, round 3 U9). It is the one state on this path whose evidence
 *   was a reviewer's and a QA's own frame rather than one of this harness's.
 *
 * Every state gets its OWN page load and its own click: the states are all
 * reached from the same starting point, and a capture that reused one load
 * would be photographing states in sequence, where the second click starts from
 * a different view than the first.
 */
const FRAME_STATES = [
	"hydrating",
	"mark",
	"refusal",
	"slow",
	"settled",
	"error",
];
/**
 * The placeholder's pulse floor, as `styles/index.css` defines it.
 *
 * Held here as a number rather than read from the page because BOTH uses need
 * it: the capture waits for the trough, and `shoot` refuses a `slow` frame that
 * is not at it (design round 2, D8 - the floor moved from Tailwind's 0.5 to
 * 0.7 because the light brand palette's trough delivered deltaE00 1.63 against
 * the pane's canvas, under the ~2 the contract records; on the re-captured
 * frames the same measurement is 2.81 light and 4.26 dark).
 */
const PULSE_TROUGH = 0.7;
const FRAME_THEMES = (
	flag("themes", "localOperatorDark,localOperatorLight") ?? ""
).split(",").filter(Boolean);
/**
 * The page a CAPTURE loads: a stream delay long enough for the hydrating window
 * to outlive a screenshot round trip. It changes how long the state lasts,
 * which is what no still can show, and not what the state looks like.
 */
const FRAMES_URL = `${PAGE}?${new URLSearchParams({
	stream: SCENARIO.stream ?? "4000",
	get: SCENARIO.get ?? "12",
})}`;
/**
 * The same page with the target's guard read scripted to 404, for the `error`
 * frame: it is the rollback's own state, so it cannot be reached on the
 * happy-path URL.
 */
const FRAMES_FAIL_URL = `${FRAMES_URL}&fail=incoming`;
/**
 * The page a REFUSAL frame is driven on: the read window, held open.
 *
 * The state exists only while `sessions.get` has not answered, so this page
 * scripts that read LONG - the same reason every capture runs on a long stream,
 * since a window is photographed while it lasts and at shipped latency a
 * round trip leaves no frame to catch. Both bounds are delayed on purpose: with
 * the stream slow as well, the read's own latency is what closes the window,
 * which is the refusal's honest shape on a backend that is merely slow.
 */
const FRAMES_REFUSAL_URL = `${PAGE}?${new URLSearchParams({
	get: SCENARIO.get ?? "12000",
	stream: SCENARIO.stream ?? "12000",
})}`;
/**
 * The refusal's message and its sentence, as the shipped copy states them.
 *
 * Held here rather than read back from the page, because the frame is evidence
 * FOR this copy: a frame showing another alert, or this sentence with the
 * composer's generic retry appended to it, is a picture of a state the PR no
 * longer ships (UX round 3, U9 - the hint asked for a retry the same window
 * refuses).
 */
const REFUSAL_TEXT = "Check the invoice totals";
const REFUSAL_SENTENCE =
	"This chat is not ready for messages yet, so the message was not sent. " +
	"Sending works once it is ready.";
/**
 * Capture the PRE-CHANGE state of the same switch.
 *
 * On the tree before this work the panel is not the target one frame after the
 * click - that is the point of the change - and the state actually on screen
 * is the outgoing conversation with "Opening chat…" over it. Photographing
 * that state is worth a flag rather than a relaxed assertion, because the
 * assertion is what keeps this from publishing a picture of a moment the
 * harness did not reach: under `--expect-outgoing` the frame must show the
 * outgoing session AND the pending affordance, which is a stronger claim about
 * that state than the target check would be.
 */
const EXPECT_OUTGOING = ARGS.includes("--expect-outgoing");
/**
 * Drive the ROLLBACK instead of the happy path: the guard read for the target
 * is scripted to 404, so the switch must end with the error and the outgoing
 * conversation still on screen.
 */
const FAIL_GET = ARGS.includes("--fail-get");
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

/**
 * The rollback, driven in the real renderer.
 *
 * The target's guard read fails, so nothing about the happy-path timing
 * applies here; what is read back is what the user is left with - the session
 * they were in, the sentence explaining the failure, and no half-switched
 * panel. `view()` reads the error out of the RENDERED text, because the
 * promise being checked is about the screen and not about the store.
 */
const FAIL_RUN = `(async () => {
	const probe = window.__lopSwitch;
	const meta = probe.snapshot();
	const before = probe.view();
	/*
	 * Started BEFORE the click and sampled per FRAME (see probe.record): what
	 * it reports about the sentence is what a frame contained, not what the store
	 * held at some instant between two paints.
	 */
	const recorder = probe.record();
	const run = await probe.switchTo(meta.incoming, "failing");
	const started = performance.now();
	const frame = () =>
		new Promise((resolve) => requestAnimationFrame(() => resolve()));
	while (
		probe.view().activeSessionId !== meta.outgoing &&
		performance.now() - started < 5000
	)
		await frame();
	const atRollback = probe.view();
	const rollbackAt = performance.now();
	/*
	 * WATCH LONGER THAN THE CATALOGUE'S OWN TIMER. sessions.list is polled
	 * every five seconds, and that poll is what erased the sentence on the
	 * previous head (measured: on screen for 4.95 s, then gone). A 300 ms window
	 * - what this observed before - cannot tell a sentence that survives from one
	 * the next poll wipes, so the window is the poll period plus a margin, and the
	 * verdict below counts the polls it lived through.
	 */
	await new Promise((resolve) => setTimeout(resolve, 6200));
	const stats = recorder.stats();
	const after = probe.view();
	recorder.stop();
	return {
		meta,
		before,
		run: {
			committedAt: run.committedAt,
			getSettledAt: run.getSettledAt,
			timedOut: run.timedOut,
		},
		atRollback,
		after,
		stats,
		rollbackAt,
		pollsAfterRollback: probe.bridge.log.requests.filter(
			(request) =>
				request.op === "sessions.list" && request.startedAt >= rollbackAt,
		).length,
		requests: probe.bridge.log.requests.map(
			(request) => request.op + ":" + (request.sessionId ?? ""),
		),
	};
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
 * The states of a switch, and what each frame is a picture OF.
 *
 * `hydrating` is the state the switch now reaches immediately: the target's own
 * panel, mounted, with the transcript it has not received yet. `settled` is the
 * same panel once the transcript is painted. For a reader's eye they are the
 * before/after of the change: the outgoing conversation held on screen under an
 * "Opening chat…" banner is the state that no longer exists here.
 *
 * The other four exist because those two cannot answer what the change is
 * defended on - see `FRAME_STATES` for what each one is for.
 *
 * EVERY state gets its own page load and its own click. The states are all
 * reached from the same starting point, and a capture that shared one load
 * would be photographing a SEQUENCE, where the second state starts from the
 * view the first one left behind rather than from the app's own boot.
 */
const captureFrames = async (cdp) => {
	const written = [];
	// Under `--expect-outgoing` the same script photographs the PRE-change state
	// on the pre-change tree, and only that state exists there.
	const states = EXPECT_OUTGOING ? ["hydrating"] : FRAME_STATES;
	for (const theme of FRAME_THEMES) {
		for (const state of states) {
			const url =
				state === "error"
					? FRAMES_FAIL_URL
					: state === "refusal"
						? FRAMES_REFUSAL_URL
						: FRAMES_URL;
			await cdp.send("Page.navigate", { url });
			await waitForCaptureReady(cdp);
			await cdp.send("Runtime.evaluate", {
				expression: `document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`,
			});
			await settleFrames(cdp);
			await prepareState(cdp, state);
			written.push(
				await shoot(cdp, join(FRAMES, state, `${theme}.webp`), state, theme),
			);
		}
	}
	return written;
};

/**
 * The page is mounted on a session AND its fonts have resolved - a switch
 * photographed against the fallback face would be a picture of this machine
 * rather than of the product. Polled, not slept on.
 */
const waitForCaptureReady = async (cdp) => {
	for (let i = 0; i < 240; i++) {
		const { result } = await cdp.send("Runtime.evaluate", {
			returnByValue: true,
			expression: `(() => {
				const probe = window.__lopSwitch;
				return Boolean(probe && probe.ready) && document.fonts.status === "loaded";
			})()`,
		});
		if (result.value === true) return;
		await sleep(250);
	}
	throw new Error("the harness never became ready for the capture");
};

/**
 * The click, dispatched in the page exactly as the timed runs do it, so what is
 * photographed is the shipped click path rather than a state forced from
 * outside it.
 */
const clickTarget = async (cdp) => {
	const { result } = await cdp.send("Runtime.evaluate", {
		returnByValue: true,
		expression: `(() => {
			const probe = window.__lopSwitch;
			const meta = probe.snapshot();
			const row = document.querySelector(
				'[data-chat-row][title^="' + meta.incomingTitle + '"]',
			);
			if (!row) return null;
			row.click();
			return meta;
		})()`,
	});
	if (!result.value) throw new Error("no sidebar row for the capture target");
	return result.value;
};

/*
 * The switched-to row, resolved the same way the click resolves it. Async,
 * because one caller awaits the list's own smooth scroll inside it.
 */
const targetRow = (expression) => `(async () => {
	const probe = window.__lopSwitch;
	const meta = probe.snapshot();
	const row = document.querySelector(
		'[data-chat-row][title^="' + meta.incomingTitle + '"]',
	);
	${expression}
})()`;

/** Put the page into the state under review, on the shipped click path. */
const prepareState = async (cdp, state) => {
	const meta = await clickTarget(cdp);
	// One settle after the click: the commit has happened and the transcript has
	// not arrived, which IS the state a switch now reaches.
	await settleFrames(cdp);

	if (state === "refusal") {
		/*
		 * THE SEND THE WINDOW REFUSES, typed and submitted through the real
		 * composer with real input events - so what is photographed is the shipped
		 * send path's own refusal and not a sentence planted in the DOM. The store
		 * raises `SESSION_UNVALIDATED_MESSAGE` from `admitChatDraft`, before the
		 * draft is latched and before the transport is reached, and the composer
		 * paints it in the same alert row every other refused send uses.
		 */
		await sendInComposer(cdp, REFUSAL_TEXT);
		await waitForComposerAlert(cdp, REFUSAL_SENTENCE);
		await settleFrames(cdp);
		}

	if (state === "settled") {
		await cdp.send("Runtime.evaluate", {
			awaitPromise: true,
			expression: `window.__lopSwitch.settle(${JSON.stringify(meta.incoming)})`,
		});
		await settleFrames(cdp);
		return;
	}

	if (state === "error") {
		/*
		 * The rollback, by the page's own definition of it: the view is back on the
		 * outgoing session - and then its CONVERSATION is back too, because that is
		 * the state the failure path promises ("the outgoing conversation still on
		 * screen" beside the sentence that explains why). A frame shot the instant
		 * the view moves would photograph the re-hydration window instead, and the
		 * claim it is evidence for is about what the user is left with.
		 */
		await cdp.send("Runtime.evaluate", {
			awaitPromise: true,
			expression: `(async () => {
				const probe = window.__lopSwitch;
				const deadline = performance.now() + 8000;
				while (
					probe.view().activeSessionId !== probe.view().outgoing &&
					performance.now() < deadline
				)
					await new Promise((r) => requestAnimationFrame(() => r()));
				await probe.settle(probe.view().outgoing);
			})()`,
		});
		await settleFrames(cdp);
		return;
	}

	if (state === "mark") {
		/*
		 * The mark is the acknowledgement this change is defended on, and in a
		 * 24-row fixture the switched-to row sits BELOW the captured window - which
		 * is why the frames showed a sidebar band of plain `surface` where the body
		 * claimed a mark (design D5). The frame scrolls its own subject into view.
		 *
		 * NO HOVER FRAME, and it was attempted rather than skipped. A CDP-dispatched
		 * `Input.dispatchMouseEvent` does not land the browser's hover state on the
		 * row it is aimed at here - two attempts put the pointer on a sidebar button
		 * that carried no row, and `[data-chat-row]:hover` stayed null - and the
		 * alternatives are worse than the omission: forcing the pseudo-state
		 * (`CSS.forcePseudoState`) would stage the state instead of driving it, and a
		 * frame published under a hover claim it does not have is exactly the kind of
		 * evidence this set exists to refuse. The selection/hover pair is pinned
		 * numerically instead, by the contrast contract's own rows.
		 */
		await cdp.send("Runtime.evaluate", {
			expression: targetRow(`row?.scrollIntoView({ block: "nearest" });`),
		});
		/*
		 * THEN WAIT FOR THE SCROLL TO STOP. The list scrolls smoothly (the
		 * stylesheet's own `scroll-behavior`), so two frames after the call the
		 * row's box is still moving - and a pointer dispatched at a rectangle
		 * measured mid-animation lands on whatever has moved under it, which is
		 * how the first attempt hovered a row that was not the one it aimed at.
		 * Stability, not a delay: two consecutive frames at the same offset.
		 */
		await cdp.send("Runtime.evaluate", {
			awaitPromise: true,
			expression: targetRow(`
				await new Promise((resolve) => {
					let last = null;
					let stable = 0;
					const deadline = performance.now() + 3000;
					const step = () => {
						const rect = row?.getBoundingClientRect();
						const key = rect ? Math.round(rect.top) : null;
						stable = key !== null && key === last ? stable + 1 : 0;
						last = key;
						if (stable >= 2 || performance.now() > deadline) return resolve();
						requestAnimationFrame(step);
					};
					requestAnimationFrame(step);
				});`),
		});
		await settleFrames(cdp);
	}

	/*
	 * THE PULSE'S PHASE, waited for rather than hoped for.
	 *
	 * The pulse runs on its own two-second clock, so a frame that claims a phase
	 * has to be shot AT that phase or it is a picture of an arbitrary moment with
	 * a measurement beside it describing a state the pixels do not show. Two
	 * phases are claimed here: `slow` is the TROUGH (the state D2/D8 is about,
	 * where the bar's step is at its weakest), and the hydrating states are shot
	 * at REST, which is what the "at rest" numbers beside them are measured
	 * against. The readback in `shoot` records the opacity that was actually on
	 * screen, so the frame states the phase it was taken at instead of the
	 * harness asserting one it hoped for.
	 */
	if (state !== "settled" && state !== "error")
		await awaitPulse(
			cdp,
			state === "slow" ? `<= ${PULSE_TROUGH + 0.03}` : ">= 0.995",
		);
};

/**
 * Wait for the placeholder's first bar to reach a phase of its pulse.
 *
 * `comparison` is the test on the element's rendered opacity, written out
 * rather than passed as a number because the two phases are opposite
 * inequalities: a ceiling for the trough (the animation's floor, plus the same
 * small slack the first version of this wait used, so the sample lands near the
 * floor rather than exactly on it) and a floor for rest. The rest test is
 * 0.995 rather than 0.97 on purpose: both ends of the animation are eased with
 * `cubic-bezier(0.4, 0, 0.6, 1)`, whose slope at the extremes is flat, so near
 * the peak the opacity barely moves across the screenshot round trip - while
 * catching the curve mid-FALL at 0.97 would let the capture land below the
 * rest guard a frame later and fail for being right about a different moment.
 */
const awaitPulse = (cdp, comparison) =>
	cdp.send("Runtime.evaluate", {
		awaitPromise: true,
		expression: `(async () => {
			const bar = () =>
				document.querySelector('[aria-label="Loading conversation"]')
					?.firstElementChild;
			const deadline = performance.now() + 20_000;
			while (performance.now() < deadline) {
				const el = bar();
				const opacity = el ? Number(getComputedStyle(el).opacity) : null;
				if (opacity !== null && opacity ${comparison}) return;
				await new Promise((r) => requestAnimationFrame(() => r()));
			}
		})()`,
	});

/**
 * Type into the composer and submit, the way the app's own user does it: real
 * input events on the focused field, then the Enter the submit path guards on.
 * The read-back is part of the instrument rather than politeness - a page whose
 * field never took the text would otherwise be photographed as a refusal of
 * nothing, which is the empty-frame failure this set exists to refuse.
 */
const sendInComposer = async (cdp, text) => {
	const focused = await cdp.send("Runtime.evaluate", {
		returnByValue: true,
		expression: `(() => {
			const field = document.querySelector("textarea");
			if (!field) return null;
			field.focus();
			return field.value;
		})()`,
	});
	if (focused.result.value === null)
		throw new Error("no composer on the page to send from");
	await cdp.send("Input.insertText", { text });
	const typed = await cdp.send("Runtime.evaluate", {
		returnByValue: true,
		expression: `document.querySelector("textarea")?.value ?? null`,
	});
	if (typed.result.value !== text)
		throw new Error(
			`the composer holds ${JSON.stringify(typed.result.value)} rather than ${JSON.stringify(text)}`,
		);
	for (const type of ["keyDown", "keyUp"])
		await cdp.send("Input.dispatchKeyEvent", {
			type,
			key: "Enter",
			code: "Enter",
			windowsVirtualKeyCode: 13,
			nativeVirtualKeyCode: 13,
			...(type === "keyDown" ? { text: "\r" } : {}),
		});
};

/**
 * The composer's alert row, once it states `sentence`. Polled, not slept on, so
 * the capture waits for a paint rather than for a delay - and it gives up loudly:
 * a refusal that never arrived would otherwise be photographed as a hydrating
 * panel with an empty alert.
 */
const waitForComposerAlert = async (cdp, sentence) => {
	for (let i = 0; i < 120; i++) {
		const { result } = await cdp.send("Runtime.evaluate", {
			returnByValue: true,
			expression: `(() => {
				const form = document.querySelector("textarea")?.closest("form");
				return form?.querySelector('[role="alert"]')?.innerText ?? null;
			})()`,
		});
		if (typeof result.value === "string" && result.value.includes(sentence))
			return;
		await sleep(50);
	}
	throw new Error(`the composer never stated the refusal: ${sentence}`);
};

/** Two frames: one for the change to lay out, one for it to paint. */
const settleFrames = (cdp) =>
	cdp.send("Runtime.evaluate", {
		awaitPromise: true,
		expression:
			"new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))",
	});

/**
 * One screenshot, refused unless it is a picture of the state it claims.
 *
 * `check-evidence.mjs` exists because a frame was committed that was of nothing
 * at all (a loading spinner on a white page, 2,762 bytes against its siblings'
 * 57KB), so this asserts what has to be true of the SURFACE before the bytes are
 * allowed into the tree - and, since a still cannot say whether the writer had
 * to scroll to reach its subject, the reads that a frame's own claim depends on
 * (the mark in view, the pointer on another row, the placeholder's phase) are
 * read back and printed with the file.
 */
const shoot = async (cdp, path, state, theme) => {
	const { result } = await cdp.send("Runtime.evaluate", {
		returnByValue: true,
		expression: `(() => ({
			...window.__lopSwitch.frame(),
			sentence: document.body.innerText.includes("Unknown session"),
		}))()`,
	});
	const seen = result.value;
	const refuse = (message) => {
		throw new Error(`${state}/${theme}: ${message}`);
	};
	if (EXPECT_OUTGOING) {
		if (seen.active !== seen.outgoing || !seen.pendingIndicator)
			refuse("expected the outgoing session held under its pending affordance");
	} else if (state === "error") {
		if (seen.active !== seen.outgoing)
			refuse("the view is not back on the outgoing session");
		if (!seen.content) refuse("the outgoing conversation has not come back");
		if (!seen.sentence) refuse("the failure sentence is not on screen");
	} else {
		if (seen.active !== seen.target)
			refuse("the panel is not the switch's target");
		if (state === "settled") {
			if (!seen.content) refuse("the transcript is still empty");
		} else {
			if (seen.content) refuse("the transcript already has content");
			if (!seen.placeholder) refuse("no placeholder is on screen");
		}
		if (state === "mark") {
			if (!seen.rowInView) refuse("the switched-to sidebar row is not in view");
		}
		if (state === "slow" && !((seen.placeholderOpacity ?? 1) <= PULSE_TROUGH + 0.1))
			refuse(
				`the placeholder is not at its pulse trough (opacity ${seen.placeholderOpacity})`,
			);
		if (state === "refusal") {
			/*
			 * The state is the REFUSAL, and the frame has to be a picture of both
			 * halves of it: the sentence in the composer's own row, and the fact that
			 * nothing was sent. The second half is the one a still cannot show by
			 * itself, so it is read off the bridge's request log - the refusal exists
			 * precisely because no `sessions.message` was issued.
			 */
			if (!(seen.composerAlert ?? "").includes(REFUSAL_SENTENCE))
				refuse(
					`the composer is not stating the refusal (${JSON.stringify(seen.composerAlert)})`,
				);
			if ((seen.composerAlert ?? "").includes("Send it again"))
				refuse(
					"the notice still asks for a retry that this same window refuses",
				);
			if (seen.sentMessages !== 0)
				refuse(`a message reached the transport (${seen.sentMessages})`);
		}
		/*
		 * The mirror of the trough guard: the hydrating states are measured as the
		 * pulse's REST phase (that is what "at rest" means beside those numbers),
		 * so a frame caught mid-fade is refused rather than published under a
		 * measurement it does not show.
		 */
		if (state !== "slow" && state !== "settled" && (seen.placeholderOpacity ?? 1) < 0.99)
			refuse(
				`the placeholder is not at the pulse's rest phase (opacity ${seen.placeholderOpacity})`,
			);
	}
	const { data } = await cdp.send("Page.captureScreenshot", {
		format: "webp",
		quality: 88,
	});
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, Buffer.from(data, "base64"));
	return { path: relative(process.cwd(), path), state, ...seen };
};

/**
 * The phases, in the order the user pays for them.
 *
 * There is no pending phase on this head and there must not be one: the switch
 * has no pending affordance left to paint, so "pending set → pending painted"
 * would be two timestamps that can never be taken. The table reports the phases
 * that exist, and the click's own frame is `click → committed`.
 */
const PHASES = [
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
	if (FAIL_GET) query.set("fail", "incoming");
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
	await cdp.send("Page.navigate", { url: FRAMES ? FRAMES_URL : url });

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
	if (!ready) throw new Error(`the harness at ${FRAMES ? FRAMES_URL : url} never became ready`);

	if (FRAMES) {
		const written = await captureFrames(cdp);
		console.log(JSON.stringify(written, null, 2));
		return;
	}

	const runWithDeadline = (expression, ms) =>		Promise.race([
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

	const { result } = await runWithDeadline(
		FAIL_GET ? FAIL_RUN : RUN(SWITCHES),
		FAIL_GET ? 90_000 : 60_000 + SWITCHES * 25_000,
	);
	if (!result.value)
		throw new Error(
			`the page threw instead of returning a run table: ${result.description ?? JSON.stringify(result)}`,
		);

	if (FAIL_GET) {
		const {
			before,
			run,
				atRollback,
				after,
			stats,
				pollsAfterRollback,
				requests,
			} = result.value;
			/*
					* EVERY CLAIM IS ABOUT A FRAME, not about the store's history.
			*
				* "The failure sentence reached the screen" used to be computed as
			* `transitions.some((entry) => entry.shown)` over entries pushed from a
				* `store.subscribe` callback - a `document.body.innerText` read taken at a
				* store notification, i.e. at an instant no browser ever painted. It was
						* true there and false on every delivered frame: the rollback's own
					* catalogue refetch cleared the sentence 4.5-8.1 ms after writing it, and
					* 0 of ~1,100 sampled frames contained it (UX round 1, U1). The recorder
				* samples per `rAF` now, so `shownFrames > 0` is a claim about paints, and
				* `shownAtEnd` is the one the fix has to satisfy: the sentence has to
			* outlive the five-second poll that used to wipe it, and the run waits for
			* at least one of those polls (`pollsAfterRollback`) before asking.
			*/
				const verdict = {
			"the switch committed the target first": run.committedAt !== null,
			"the view came back to the outgoing session":
				atRollback.activeSessionId === before.activeSessionId,
			"the failure sentence was recorded in the store": stats.recorded,
			"the failure sentence reached a painted frame": stats.shownFrames > 0,
			"the sentence is stated on exactly one surface":
			stats.maxSurfaces === 1,
				"the sentence outlived a catalogue poll":
		stats.shownAtEnd && pollsAfterRollback > 0,
		"the sidebar marks the outgoing session again":
		atRollback.selectedRow === before.selectedRow,
	};
	const passed = Object.values(verdict).every(Boolean);
	if (AS_JSON) {
	console.log(
		JSON.stringify(
			{
				verdict,
				before,
				run,
				atRollback,
				after,
				stats,
				pollsAfterRollback,
				requests,
			},
			null,
			2,
		),
	);
	} else {
	console.log("guard-read failure — the rollback, driven in the real renderer");
	console.log(`  before:      ${JSON.stringify(before)}`);
	console.log(`  at rollback: ${JSON.stringify(atRollback)}`);
	console.log(`  6.2 s later: ${JSON.stringify(after)}`);
	console.log(
		`  the switch committed at ${run.committedAt === null ? "-" : "yes"} and its read settled at ${run.getSettledAt === null ? "-" : "yes"}, then rolled back`,
	);
	console.log(
		`  frames: ${stats.frames} sampled, ${stats.shownFrames} showing the sentence` +
			` (first ${stats.firstShownAt ?? "-"}, last ${stats.lastShownAt ?? "-"}),` +
			` ${pollsAfterRollback} catalogue poll(s) after the rollback`,
	);
	console.log(`  transitions: ${JSON.stringify(stats.transitions)}`);
	console.log(`  requests: ${requests.join(", ")}`);
	for (const [claim, held] of Object.entries(verdict))
		console.log(`  ${held ? "PASS" : "FAIL"}  ${claim}`);
	}
	if (!passed) process.exitCode = 1;
	return;
	}
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

main().then(
	() => {
		/*
		 * The websocket to the browser keeps the event loop alive, so the driver
		 * exits explicitly once the table is on stdout: a harness that prints its
		 * results and then hangs looks identical to one that is still measuring,
		 * and the next reader waits on it. Seen for real on a loaded machine - the
		 * run had finished and written every frame while the process sat there.
		 */
		teardown();
		process.exit(0);
	},
	(error) => {
		teardown();
		console.error(error);
		process.exit(1);
	},
);
