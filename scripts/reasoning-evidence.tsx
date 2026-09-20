/**
 * Evidence harness: the model's reasoning, streaming into the SHIPPED transcript.
 *
 * See `reasoning-evidence.html` for why this exists and what it is allowed to
 * prove. The short version: the operator's complaint is 3-5 s of dead air
 * between submitting a message and seeing the model do anything, the runtime
 * has always received the model's reasoning (and discarded it before
 * `local-operator` PR #1350), and the remaining claim is a claim about PAINT.
 *
 * WHAT IS REAL HERE: `CanonicalTranscript` and everything under it — the
 * reducer (`applyEvent`), the row (`AssistantRow`), the block
 * (`LiveReasoning`), the bounded tail (`reasoningTail`), the working line, the
 * theme, the stylesheet. The frame feed is scripted, and the driver below says
 * so; the transport is `local-operator`'s own evidence, because reasoning is
 * display-only and a mock backend cannot emit it at all.
 *
 * THE TWO THINGS THIS MEASURES, and why they are the right two:
 *
 *  1. SUBMIT -> FIRST PAINTED MOTION. The composer's own send paints the
 *     optimistic echo and the admitted-send latch in one synchronous block
 *     (`canonical-sessions-store.ts:admitChatDraft`, whose comment says in
 *     those words that the echo is painted BEFORE the await). The daemon then
 *     acknowledges in ~13 ms (`local-operator` PR #1343). What this number
 *     bounds is therefore the RENDERER's own contribution: if it is a frame,
 *     nothing in the app is adding a delay the runtime does not have.
 *  2. EVENT -> PAINTED, for the reasoning channel and for the answer. Stamped
 *     from the instant a frame is handed to the reducer to the first animation
 *     frame whose DOM query sees the row. `requestAnimationFrame` runs
 *     immediately before the paint of its own frame, so the reading is the
 *     paint, bounded by one frame — stated rather than assumed, because the
 *     same rig would otherwise be able to call a 250 ms timer a paint (the
 *     stream hook's hidden-window fallback is 250 ms, and a hidden window never
 *     delivers an animation frame at all).
 *
 * And one more, because the classic streaming-UI regression is a scroll steal:
 *
 *  3. SCROLL DRIFT while the reasoning streams. `scrollTop` sampled before and
 *     after a burst of fragments, with the reader deliberately parked away from
 *     the tail. The transcript is bottom-anchored, so the failure this catches
 *     is the viewport being yanked to the newest content under a reader who was
 *     reading something else.
 */

import { CanonicalTranscript } from "@features/chat/canonical/canonical-transcript";
import type { TranscriptState } from "@features/chat/canonical/transcript-reducer";
import {
	EMPTY_TRANSCRIPT,
	appendPendingUser,
	applyEvent,
} from "@features/chat/canonical/transcript-reducer";
import { ThemeProvider } from "@shared/themes/theme-provider";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { CanonicalFrontendState } from "../src/shared/desktop-session-contract";
import "./reasoning-evidence.css";

/** Fixed row timestamps, so two runs of the same script paint the same rows. */
const TS = 1_760_000_000_000;
/** The admission request UUID the echo and the owner's durable row share. */
const REQUEST_ID = "7c1d2f4a-0b3e-4d5f-8a9b-0c1d2e3f4a5b";
const MESSAGE_ID = "a1b2c3d4";

const PROMPT =
	"A train leaves at 14:05 and travels 240 km at 80 km/h, then waits 25 " +
	"minutes, then travels another 160 km at 64 km/h. Work out the arrival time.";

/*
 * The reasoning, in the shape the wire delivers it: fragments. Split below into
 * ~14-character pieces rather than handed over whole, because the per-fragment
 * case is the one that matters — reasoning is one frame per token, measured at
 * up to 19,355 fragments in a single turn, and a block that only looked right
 * when handed one large string would be a block that never rendered.
 */
const REASONING = [
	"The train leaves at 14:05. First leg: 240 km at 80 km/h takes 3 hours, so ",
	"it arrives at 17:05. ",
	"Then it waits 25 minutes, so it departs again at 17:30. ",
	"Second leg: 160 km at 64 km/h is 2.5 hours, which is 2 hours 30 minutes, so ",
	"17:30 plus 02:30 lands at 20:00. ",
	"Let me double check the second leg: 64 x 2.5 = 160, yes. ",
	"So the arrival time is 20:00.",
].join("");

/** The same channel, long enough to blow both bounds of the painted window. */
const LONG_REASONING = [
	REASONING,
	" ",
	"Re-checking from the beginning, because the second leg is the one that bites: ",
	"240 over 80 is 3 exactly, so 14:05 plus 03:00 is 17:05 and there is no remainder to carry. ",
	"The 25 minute wait is a real wait and it is not part of either leg, so 17:05 plus 00:25 is 17:30. ",
	"160 over 64 is 2.5 exactly, and 2.5 hours is 2 hours 30 minutes, ",
	"so 17:30 plus 02:30 is 20:00 and nothing here crosses midnight. ",
	"A third pass, on the units rather than the arithmetic: km over km/h is hours, ",
	"the wait was given in minutes and converted once, and the two legs are added to the departure. ",
	"Arrival 20:00, and the derivation is stable under repetition.",
].join("");

const ANSWER = "The arrival time is 20:00.";

type Mode = "reasoning" | "long" | "none" | "cancel";

type Sample = {
	mode: Mode;
	submitCommitMs: number;
	submitPaintMs: number;
	reasoningCommitMs: number;
	reasoningPaintMs: number;
	answerCommitMs: number;
	answerPaintMs: number;
	reasoningPaintedChars: number;
	note: string;
};

type DriftSample = {
	before: number;
	after: number;
	moved: boolean;
	maxScroll: number;
};

/** Split into wire-sized fragments, which is how the channel arrives. */
const fragments = (text: string, size = 14): string[] => {
	const out: string[] = [];
	for (let at = 0; at < text.length; at += size)
		out.push(text.slice(at, at + size));
	return out;
};

const median = (values: number[]): number => {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = sorted.length >> 1;
	return sorted.length % 2
		? sorted[middle]
		: Math.round((sorted[middle - 1] + sorted[middle]) / 2);
};

const p95 = (values: number[]): number => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const userFrame = {
	type: "message_start",
	message: {
		id: REQUEST_ID,
		role: "user",
		content: [{ type: "text", text: PROMPT }],
		tool_calls: [],
	},
};
const assistantStart = {
	type: "message_start",
	message: { id: MESSAGE_ID, role: "assistant", content: [], tool_calls: [] },
};
const assistantEnd = {
	type: "message_end",
	message: {
		id: MESSAGE_ID,
		role: "assistant",
		content: [{ type: "text", text: ANSWER }],
		tool_calls: [],
	},
};
const agentStart = { type: "agent_start", generation: "1" };
const agentEnd = { type: "agent_end", generation: "1" };
const agentAborted = { type: "agent_end", generation: "1", aborted: true };

type View = {
	transcript: TranscriptState;
	waiting: boolean;
	starting: boolean;
	startingAfterId: string | null;
};

const EMPTY_VIEW: View = {
	transcript: EMPTY_TRANSCRIPT,
	waiting: false,
	starting: false,
	startingAfterId: null,
};

/**
 * The geometry behind the frame.
 *
 * A still shows the symptom; these numbers show the cause, which is the rule
 * this repository's visual-validation section states. They are read from the
 * live DOM on a timer and rendered as TEXT, because this harness is driven by a
 * browser tool that cannot evaluate script — the same reason
 * `CanonicalTranscript` exposes its own development readout on the DOM.
 *
 * The two facts worth having are the scroll region (does the transcript have a
 * tail to be pulled away from?) and the rows' own rects, because the reflow
 * question the ticket asks — "does anything move when the reasoning gives way
 * to the answer" — is answered by two numbers and not by two pictures.
 */
const geometry = (container: HTMLDivElement | null): string => {
	if (!container) return "no transcript";
	const block = container.querySelector('[data-lo-reasoning="live"]');
	const line = container.querySelector("[data-lo-working-line]");
	/*
	 * The prose, not the row that holds it: `data-lo-streaming` is on
	 * `AssistantRow`'s content box, which is also the reasoning block's
	 * container, so reading the rect off that attribute would report the same
	 * numbers twice and hide the one fact this line exists for.
	 */
	const prose = container.querySelector("[data-lo-streaming] .lo-markdown p");
	const rect = (element: Element | null) =>
		element
			? `${Math.round(element.getBoundingClientRect().top)}px top / ${Math.round(element.getBoundingClientRect().height)}px tall`
			: "absent";
	return [
		`viewport ${window.innerWidth}x${window.innerHeight} @dpr${window.devicePixelRatio}`,
		`scroller scrollTop ${Math.round(container.scrollTop)} / scrollHeight ${Math.round(container.scrollHeight)} / clientHeight ${container.clientHeight}`,
		`reasoning block : ${rect(block)}`,
		`working line    : ${rect(line)}`,
		`streaming prose : ${rect(prose)}`,
	].join("\n");
};

const Harness = () => {
	const [view, setView] = useState<View>(EMPTY_VIEW);
	const [log, setLog] = useState<string[]>([]);
	const [status, setStatus] = useState("idle");
	const [phase, setPhase] = useState("");
	const [busy, setBusy] = useState(false);
	const [reads, setReads] = useState<string>("");
	const containerRef = useRef<HTMLDivElement>(null);

	// Sampled on a timer rather than only on render: the numbers a frame is
	// judged by (the scroll offset, the rows' rects) settle a frame AFTER the
	// commit that changed them, so a readout taken during render would be a
	// picture of the previous state.
	useEffect(() => {
		const sample = () => setReads(geometry(containerRef.current));
		sample();
		const timer = window.setInterval(sample, 400);
		return () => window.clearInterval(timer);
	}, []);

	const say = useCallback(
		(line: string) => setLog((current) => [...current, line]),
		[],
	);

	/** Apply canonical frames in one commit, exactly as the stream hook folds a batch. */
	const feed = useCallback((frames: Record<string, unknown>[]) => {
		setView((current) => ({
			...current,
			transcript: frames.reduce<TranscriptState>(
				(state, frame) => applyEvent(state, frame, TS),
				current.transcript,
			),
		}));
	}, []);

	/** The composer's own send: the echo and the admitted-send latch, one block. */
	const submit = useCallback(() => {
		setView((current) => ({
			...current,
			transcript: appendPendingUser(
				current.transcript,
				REQUEST_ID,
				PROMPT,
				[],
				TS,
			),
			starting: true,
			startingAfterId: REQUEST_ID,
		}));
	}, []);

	/*
	 * The probe, and WHY IT READS TWO NUMBERS RATHER THAN ONE.
	 *
	 * A pure `requestAnimationFrame` poll measures the COMPOSITOR's cadence as
	 * much as this app's work, and on this rig that is not a detail: the page is
	 * driven in a background tab that is never focused, and Chromium delivers
	 * frames to it at anything from 60 Hz to ~1 Hz. Measured on this box, the
	 * same nine-run measurement read a median of 8.4 ms at 13:57:29Z and 1008.3 ms
	 * at 13:59:40Z on identical code, because the tab's frame delivery had
	 * changed. Reporting either number as "the app's paint" would be reporting the
	 * tab.
	 *
	 * So the boundary is measured twice, and the two are different facts:
	 *
	 *  - `commit`: a `MutationObserver` callback, which runs as a microtask
	 *    immediately after the DOM mutation — this is what THE RENDERER controls,
	 *    and it is independent of frame delivery.
	 *  - `paint`: the next animation frame after that, which is when a reader
	 *    could see it. `requestAnimationFrame` runs immediately before the paint
	 *    of its own frame, so this is the paint instant; it equals the commit plus
	 *    at most one frame of whatever cadence the TAB has, which the readout
	 *    states per measurement.
	 *
	 * A `-1` is a timeout, reported rather than swallowed: on the BEFORE tree the
	 * reasoning block never appears at all, and a silent zero there would read as
	 * an instant paint.
	 */
	const waitFor = useCallback(
		(predicate: () => boolean, timeoutMs = 4000) =>
			new Promise<{ commit: number; paint: number }>((resolve) => {
				const started = performance.now();
				const observed = (commit: number) => {
					requestAnimationFrame(() =>
						resolve({ commit, paint: performance.now() - started }),
					);
				};
				if (predicate()) return observed(0);
				const observer = new MutationObserver(() => {
					if (!predicate()) return;
					observer.disconnect();
					window.clearTimeout(timer);
					observed(performance.now() - started);
				});
				observer.observe(containerRef.current as Node, {
					childList: true,
					subtree: true,
					characterData: true,
				});
				const timer = window.setTimeout(() => {
					observer.disconnect();
					resolve({ commit: -1, paint: -1 });
				}, timeoutMs);
			}),
		[],
	);

	/**
	 * How fast this TAB is delivering frames, and whether anyone could see it.
	 *
	 * Stated per measurement rather than assumed, because the whole point of the
	 * pair above is that a paint reading is bounded by the tab's cadence: a
	 * reader comparing a 8 ms median against a 1008 ms one needs the number that
	 * explains the difference, and `hidden`/`false` is it.
	 */
	const cadence = useCallback(
		() =>
			new Promise<{ fps: number; visibility: string; focused: boolean }>(
				(resolve) => {
					let frames = 0;
					const started = performance.now();
					const tick = () => {
						frames += 1;
						if (performance.now() - started >= 1000) {
							return resolve({
								fps: frames,
								visibility: document.visibilityState,
								focused: document.hasFocus(),
							});
						}
						requestAnimationFrame(tick);
					};
					requestAnimationFrame(tick);
				},
			),
		[],
	);

	/*
	 * The DOM predicates the probe is built from, as stable identities.
	 *
	 * `useCallback` rather than plain functions, and that is not tidiness: the
	 * driver's own callbacks list these as dependencies, so a fresh function per
	 * render would re-arm the driver's identity many times a second while a stream
	 * runs. They read the scroller through a ref, so they depend on nothing.
	 */
	const hasText = useCallback(
		(needle: string) =>
			(containerRef.current?.textContent ?? "").includes(needle),
		[],
	);
	const hasReasoning = useCallback(
		() =>
			Boolean(
				containerRef.current?.querySelector('[data-lo-reasoning="live"]'),
			),
		[],
	);
	const hasWorkingLine = useCallback(
		() =>
			Boolean(containerRef.current?.querySelector("[data-lo-working-line]")),
		[],
	);

	const paintedReasoningChars = useCallback(() => {
		const block = containerRef.current?.querySelector(
			'[data-lo-reasoning="live"] p',
		);
		return block?.textContent?.length ?? 0;
	}, []);

	/**
	 * One whole turn. `holdAt` stops the driver with the block still streaming,
	 * which is how the screenshot states are reached: a still taken while a
	 * stream is live is a picture of a state that has to be held, not raced.
	 */
	const playTurn = useCallback(
		async (
			mode: Mode,
			pace: { fragmentMs: number; holdAt?: number },
		): Promise<Sample> => {
			setPhase(mode);
			const reasoning = mode === "long" ? LONG_REASONING : REASONING;
			const pieces = mode === "none" ? [] : fragments(reasoning);
			setView(EMPTY_VIEW);
			setStatus(`running ${mode}`);
			// One frame for the reset to commit, so the probe cannot see the
			// PREVIOUS run's rows and report an instant paint.
			await waitFor(() => !hasText(PROMPT.slice(0, 24)), 1000);

			submit();
			const motion = await waitFor(
				() => hasText(PROMPT.slice(0, 24)) || hasWorkingLine(),
			);
			const submitCommitMs = motion.commit;
			const submitPaintMs = motion.paint;

			await sleep(pace.fragmentMs);
			feed([agentStart]);
			setView((current) => ({ ...current, waiting: true }));
			feed([userFrame, assistantStart]);

			let reasoningCommitMs = -1;
			let reasoningPaintMs = -1;
			for (const [index, piece] of pieces.entries()) {
				feed([
					{ type: "reasoning_delta", message_id: MESSAGE_ID, delta: piece },
				]);
				if (index === 0) {
					const first = await waitFor(hasReasoning);
					reasoningCommitMs = first.commit;
					reasoningPaintMs = first.paint;
				}
				if (pace.holdAt !== undefined && index + 1 >= pace.holdAt) {
					await waitFor(hasReasoning, 500);
					setPhase(`${mode}:held`);
					setStatus(`held mid-reasoning (${mode})`);
					return {
						mode,
						submitCommitMs,
						submitPaintMs,
						reasoningCommitMs,
						reasoningPaintMs,
						answerCommitMs: -1,
						answerPaintMs: -1,
						reasoningPaintedChars: paintedReasoningChars(),
						note: "held mid-reasoning; not settled",
					};
				}
				if (pace.fragmentMs > 0) await sleep(pace.fragmentMs);
			}

			if (mode === "cancel") {
				feed([agentAborted]);
				setView((current) => ({ ...current, waiting: false }));
				await waitFor(() => !hasWorkingLine(), 500);
				setPhase(`${mode}:settled`);
				setStatus("cancelled mid-reasoning");
				return {
					mode,
					submitCommitMs,
					submitPaintMs,
					reasoningCommitMs,
					reasoningPaintMs,
					answerCommitMs: -1,
					answerPaintMs: -1,
					reasoningPaintedChars: paintedReasoningChars(),
					note: "aborted; the block is expected to be frozen and kept",
				};
			}

			feed([
				{
					type: "message_update",
					delta: ANSWER,
					message: {
						id: MESSAGE_ID,
						role: "assistant",
						content: [],
						tool_calls: [],
					},
				},
			]);
			const answer = await waitFor(() => hasText(ANSWER));
			feed([assistantEnd, agentEnd]);
			setView((current) => ({ ...current, waiting: false, starting: false }));
			await waitFor(() => hasText(ANSWER), 500);
			setPhase(`${mode}:settled`);
			setStatus(`settled (${mode})`);
			return {
				mode,
				submitCommitMs,
				submitPaintMs,
				reasoningCommitMs,
				reasoningPaintMs,
				answerCommitMs: answer.commit,
				answerPaintMs: answer.paint,
				reasoningPaintedChars: paintedReasoningChars(),
				note: `answer chars painted: ${ANSWER.length}`,
			};
		},
		[
			feed,
			submit,
			waitFor,
			hasReasoning,
			hasText,
			hasWorkingLine,
			paintedReasoningChars,
		],
	);

	const run = useCallback(
		async (
			mode: Mode,
			pace: { fragmentMs: number; holdAt?: number },
			label: string,
		) => {
			setBusy(true);
			try {
				/*
				 * ONE DISCARDED WARM-UP. This tab is driven in the background and is never
				 * focused, so the first animation frame after an idle period is the
				 * browser's own throttling and not this app: measured on this box, the
				 * first update after a pause painted in 535.9 ms while nine back-to-back
				 * runs painted in a median of 8.4 ms on the same code. Reporting the
				 * first number as the app's paint would be reporting the tab's state, so
				 * the stills carry a warmed reading and the warm-up is stated in the
				 * log rather than hidden.
				 */
				await playTurn(mode, { fragmentMs: 0 });
				const sample = await playTurn(mode, pace);
				say(
					[
						`${label} (one discarded warm-up run, then this one)`,
						`  submit -> DOM commit           : ${round(sample.submitCommitMs)} ms`,
						`  submit -> painted              : ${round(sample.submitPaintMs)} ms`,
						`  reasoning event -> DOM commit  : ${sample.reasoningCommitMs < 0 ? "never (no block)" : `${round(sample.reasoningCommitMs)} ms`}`,
						`  reasoning event -> painted     : ${sample.reasoningPaintMs < 0 ? "never (no block)" : `${round(sample.reasoningPaintMs)} ms`}`,
						`  answer event -> painted        : ${sample.answerPaintMs < 0 ? "n/a (held)" : `${round(sample.answerPaintMs)} ms`}`,
						`  reasoning chars on screen      : ${sample.reasoningPaintedChars}`,
					].join("\n"),
				);
			} finally {
				setBusy(false);
			}
		},
		[playTurn, say],
	);

	/** Nine whole turns, back to back, and the summary a reader can quote. */
	const measure = useCallback(async () => {
		setBusy(true);
		setLog([]);
		try {
			/*
			 * ONE DISCARDED WARM-UP, and the reason is in the probe above: the first
			 * animation frame after an idle background tab is the browser's
			 * scheduling, not this app's work. Averaging it in would report the tab.
			 */
			await playTurn("reasoning", { fragmentMs: 0 });
			const samples: Sample[] = [];
			for (let index = 0; index < 9; index += 1) {
				samples.push(await playTurn("reasoning", { fragmentMs: 0 }));
			}
			const tab = await cadence();
			const line = (label: string, read: (sample: Sample) => number) => {
				const values = samples.map(read).filter((value) => value >= 0);
				return `  ${label}: median ${round(median(values))} ms  p95 ${round(p95(values))} ms  max ${round(Math.max(...values))} ms  (n=${values.length})`;
			};
			say(
				[
					`MEASUREMENT - 9 runs (plus one discarded warm-up), reasoning turn, ${new Date().toISOString()}`,
					`  TAB CADENCE: ${tab.fps} frames in 1.000 s, visibilityState=${tab.visibility}, hasFocus()=${tab.focused}`,
					line("submit -> DOM commit      ", (sample) => sample.submitCommitMs),
					line("submit -> painted         ", (sample) => sample.submitPaintMs),
					line(
						"reasoning event -> commit ",
						(sample) => sample.reasoningCommitMs,
					),
					line(
						"reasoning event -> painted",
						(sample) => sample.reasoningPaintMs,
					),
					line("answer event -> painted   ", (sample) => sample.answerPaintMs),
					`  per run (submit commit/paint, reasoning paint, answer paint): ${samples
						.map(
							(sample) =>
								`${round(sample.submitCommitMs)}/${round(sample.submitPaintMs)} ${round(sample.reasoningPaintMs)} ${round(sample.answerPaintMs)}`,
						)
						.join("  |  ")}`,
					`  runs with NO reasoning block painted: ${samples.filter((sample) => sample.reasoningPaintMs < 0).length}`,
				].join("\n"),
			);
		} finally {
			setBusy(false);
		}
	}, [playTurn, say, cadence]);

	/**
	 * The scroll steal, which is the classic streaming-UI regression.
	 *
	 * The reader is parked away from the tail and a burst of fragments arrives
	 * underneath them: the viewport must not follow the newest content. The offset
	 * is SAMPLED, not just compared at the end, because the failure this catches
	 * moves the viewport WHILE the content grows and then leaves it where the
	 * reader never put it — a before/after pair that happens to agree would report
	 * a steal as clean. So both the samples and the final comparison are reported,
	 * and the two facts the check needs — which end of the scroller is the tail,
	 * and whether the reader was actually parked away from it — are MEASURED in
	 * the run and printed beside the verdict, because a check that parks on the
	 * tail reports a pass for a steal it never created.
	 */
	const scrollCheck = useCallback(async () => {
		setBusy(true);
		setLog([]);
		try {
			/*
			 * From EMPTY, and awaited before anything else is fed: this check ran
			 * without the reset once and appended its filler to the previous run's
			 * transcript, which put the live turn's newest row out of the scroller's
			 * view at offset 0 and made the orientation measurement report the wrong
			 * end. A rig that does not start from a known state reports whatever the
			 * last button left behind.
			 */
			setView(EMPTY_VIEW);
			await waitFor(() => !hasText("Settled row 0"), 1000);
			/*
			 * The transcript needs a TAIL to be pulled away from, and the reasoning
			 * block alone cannot give it one: the block is bounded to six painted
			 * rows on purpose, so it saturates and the content stops growing. Real
			 * sessions are long for a different reason — rows — so the rig streams a
			 * settled history first. Without this the scroller's `scrollHeight`
			 * equals its `clientHeight`, `scrollTop` cannot move at all, and the
			 * check would pass by measuring nothing.
			 */
			feed([
				{
					type: "history_delta",
					messages: Array.from({ length: 14 }, (_, index) => ({
						id: `h${index}`,
						role: index % 2 === 0 ? "user" : "assistant",
						content: [
							{
								type: "text",
								text: `Settled row ${index}: the earlier part of this conversation, which is here so the scroller has a tail.`,
							},
						],
						tool_calls: [],
					})),
				},
			]);
			await waitFor(() => hasText("Settled row 13"), 1000);
			submit();
			feed([agentStart, userFrame, assistantStart]);
			setView((current) => ({ ...current, waiting: true }));
			const pieces = fragments(LONG_REASONING);
			for (const piece of pieces.slice(0, 40)) {
				feed([
					{ type: "reasoning_delta", message_id: MESSAGE_ID, delta: piece },
				]);
			}
			await waitFor(hasReasoning);
			const scroller = containerRef.current;
			if (!scroller) throw new Error("no scroller");

			/*
			 * WHICH END OF THE SCROLLER IS THE TAIL IS MEASURED, not assumed.
			 *
			 * The transcript is `column-reverse`, so the newest row is visually at
			 * the BOTTOM of the column while the scroll offset runs the other way,
			 * and a rig that hardcoded "the tail is scrollTop 0" would park the
			 * reader ON the tail and then measure the app correctly holding it
			 * there — reporting a pass for a check it never ran. (That is the shape
			 * of the first version of this check: parked at `scrollHeight / 2`, the
			 * offset moved to the tail and stayed, which is pinning, not stealing.)
			 *
			 * So: go to offset 0, ask the DOM whether the newest row — the live
			 * reasoning block — is inside the scroller's viewport, and take the
			 * other end as the park.
			 */
			const inView = () => {
				const box = scroller.getBoundingClientRect();
				const block = scroller.querySelector('[data-lo-reasoning="live"]');
				if (!block) return false;
				const rect = block.getBoundingClientRect();
				return rect.bottom > box.top + 1 && rect.top < box.bottom - 1;
			};
			scroller.scrollTop = 0;
			await sleep(120);
			const tailIsZero = inView();
			/*
			 * THE PARK IS NEGATIVE, and that is the whole reason the first version of
			 * this check measured nothing. `column-reverse` puts the scroll ORIGIN at
			 * the bottom, so the offset runs from 0 at the tail toward NEGATIVE as
			 * the reader moves up the history (`use-scroll-paging.ts`: "`scrollTop`
			 * runs from 0", `fromTail = Math.abs(scrollTop)`, and `el.scrollTop +=
			 * drift` documented as "making `scrollTop` MORE NEGATIVE moves content
			 * DOWN"). A positive park is outside the scrollable range, so the browser
			 * clamps it straight back to the tail and the reader was never parked —
			 * reported here rather than passed, because the check cannot measure a
			 * steal it did not create.
			 */
			const overflowBefore = scroller.scrollHeight - scroller.clientHeight;
			scroller.scrollTop = tailIsZero
				? -(overflowBefore - 24)
				: overflowBefore - 24;
			await sleep(120);
			/*
			 * THE CLAIM IS ABOUT A ROW'S SCREEN POSITION, NOT ABOUT `scrollTop`.
			 *
			 * Those are different facts here, and the difference is the whole
			 * subtlety of a `column-reverse` transcript: it carries
			 * `[overflow-anchor:auto]`, so mounting content at the tail moves
			 * `scrollTop` by exactly the growth while the reader's VIEW does not move
			 * at all — `use-scroll-paging.ts` measures the same thing ("`scrollHeight`
			 * +24px with `scrollTop` -24px and no input at all"). A rig that called an
			 * offset change a steal would call the browser's anchor-holding a defect,
			 * and a rig that only compared the offset would be blind to the real one.
			 * So the row in view is identified by its own record id and its viewport
			 * `top` is compared before and after: a steal is THAT number moving.
			 */
			const rowInView = () => {
				const box = scroller.getBoundingClientRect();
				for (const row of Array.from(
					scroller.querySelectorAll("[data-record-id]"),
				)) {
					const rect = row.getBoundingClientRect();
					if (rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1) {
						return {
							id: row.getAttribute("data-record-id") ?? "?",
							top: rect.top,
						};
					}
				}
				return null;
			};
			const watchedBefore = rowInView();
			const before = scroller.scrollTop;
			const maxBefore = scroller.scrollHeight;
			const overflow = maxBefore - scroller.clientHeight;
			const parkedAtTail = inView();

			/*
			 * The burst, sampled as it lands. `requestAnimationFrame` is the wrong
			 * cadence for this — it is the tab's, which this rig has measured at 1 Hz
			 * — so the offset is read on a timer instead, which is what a reader
			 * clicking through a stream would experience.
			 */
			const samples: number[] = [before];
			const sampler = window.setInterval(
				() => samples.push(Math.round(scroller.scrollTop)),
				25,
			);
			for (const piece of pieces.slice(40)) {
				feed([
					{ type: "reasoning_delta", message_id: MESSAGE_ID, delta: piece },
				]);
				await sleep(25);
			}
			await sleep(200);
			window.clearInterval(sampler);
			const after = scroller.scrollTop;
			const unique = [...new Set(samples)];
			const watchedAfter = rowInView();
			const drift =
				watchedBefore && watchedAfter
					? watchedAfter.top - watchedBefore.top
					: Number.NaN;
			const result: DriftSample = {
				before,
				after,
				moved: !Number.isFinite(drift) || Math.abs(drift) > 1,
				maxScroll: scroller.scrollHeight - maxBefore,
			};
			say(
				[
					`SCROLL CHECK - ${pieces.length - 40} fragments arrived with the reader parked off the tail`,
					`  overflow (scrollHeight - clientHeight)   : ${overflow} px`,
					`  tail end measured at: scrollTop ${tailIsZero ? 0 : overflowBefore} (newest row in view there); parked at ${tailIsZero ? `-${overflowBefore - 24}` : overflowBefore - 24}`,
					`  newest row in view while parked : ${parkedAtTail ? "yes - this run measured nothing" : "no"}`,
					`  the row being watched : ${watchedBefore?.id ?? "none (no row fully in view)"}`,
					`  its viewport top before / after : ${watchedBefore ? watchedBefore.top.toFixed(1) : "-"} / ${watchedAfter ? watchedAfter.top.toFixed(1) : "-"}`,
					`  DRIFT (the claim) : ${Number.isFinite(drift) ? `${drift.toFixed(1)} px` : "not measurable"}`,
					`  scrollTop before / after : ${result.before} / ${result.after}  (content grew ${result.maxScroll} px; the anchor holds the VIEW by moving the offset by the growth)`,
					`  distinct offsets sampled during the burst : ${unique.length} [${unique.slice(0, 8).join(", ")}${unique.length > 8 ? ", \u2026" : ""}]`,
					`  viewport moved   : ${result.moved ? "YES - the viewport fought the reader" : "no - the reader's view held"}`,
				].join("\n"),
			);
		} finally {
			setBusy(false);
		}
	}, [feed, say, submit, waitFor, hasReasoning, hasText]);

	const frontend = useMemo(
		() =>
			view.waiting
				? ({
						// The two fields `CanonicalTranscript` reads for the working line's
						// resumed phase, plus the session-level liveness flag the real fold
						// carries. The rest of `CanonicalFrontendState` is irrelevant to this
						// surface and is deliberately absent rather than invented: a rig that
						// filled in a model name and a token count would be asserting numbers
						// nobody measured.
						//
						// `activity_phase_started_at` is deliberately OMITTED. The epoch
						// fields carry a producer's absolute stamp, and this harness's rows are
						// pinned to a fixed fixture instant — handing that to the working line
						// makes it count the phase from October 2025, so every frame carried a
						// `100d` clock that no reader would ever see and that would make the
						// stills look broken for a reason that does not exist in the product.
						// Withheld, the line keeps its own local clock: `deriveWorkingLine`
						// withholds a stamp the producer has not stated rather than inventing
						// one, and a live turn starts at `0s` exactly as this does.
						activity_phase: "thinking",
						streaming: true,
					} as unknown as CanonicalFrontendState)
				: null,
		[view.waiting],
	);

	return (
		<div className="lo-harness">
			<div className="lo-harness__stage">
				<div className="lo-harness__frame">
					<CanonicalTranscript
						transcript={view.transcript}
						frontend={frontend}
						gate={null}
						waiting={view.waiting}
						starting={view.starting}
						startingAfterId={view.startingAfterId}
						loadingOlder={false}
						onLoadOlder={async () => true}
						containerRef={containerRef}
						isSmallView={false}
						status="live"
						failure={null}
						awaitingHydration={false}
						onReconnect={() => {}}
					/>
				</div>
				<div className="lo-harness__controls">
					<button
						type="button"
						id="btn-reset"
						disabled={busy}
						onClick={() => {
							setView(EMPTY_VIEW);
							setLog([]);
							setStatus("idle");
							setPhase("");
						}}
					>
						Reset
					</button>
					<button
						type="button"
						id="btn-reasoning-hold"
						disabled={busy}
						onClick={() =>
							run(
								"reasoning",
								{ fragmentMs: 60, holdAt: 12 },
								"REASONING, HELD MID-STREAM",
							)
						}
					>
						Send + reasoning (hold mid-stream)
					</button>
					<button
						type="button"
						id="btn-long-hold"
						disabled={busy}
						onClick={() =>
							run(
								"long",
								{ fragmentMs: 8, holdAt: 60 },
								"LONG REASONING, HELD MID-STREAM",
							)
						}
					>
						Long reasoning (hold mid-stream)
					</button>
					<button
						type="button"
						id="btn-answer"
						disabled={busy}
						onClick={async () => {
							setBusy(true);
							try {
								feed([
									{
										type: "message_update",
										delta: ANSWER,
										message: {
											id: MESSAGE_ID,
											role: "assistant",
											content: [],
											tool_calls: [],
										},
									},
								]);
								const painted = await waitFor(() => hasText(ANSWER));
								feed([assistantEnd, agentEnd]);
								setView((current) => ({
									...current,
									waiting: false,
									starting: false,
								}));
								await waitFor(() => !hasWorkingLine(), 500);
								setStatus("settled");
								say(
									`ANSWER, streamed on from the held state\n  answer event -> DOM commit : ${round(painted.commit)} ms\n  answer event -> painted    : ${round(painted.paint)} ms\n  reasoning block still on screen: ${hasReasoning() ? "yes" : "no - it gave way"}`,
								);
							} finally {
								setBusy(false);
							}
						}}
					>
						Continue: the answer
					</button>
					<button
						type="button"
						id="btn-cancel"
						disabled={busy}
						onClick={() =>
							run("cancel", { fragmentMs: 40 }, "CANCELLED MID-REASONING")
						}
					>
						Cancel mid-reasoning
					</button>
					<button
						type="button"
						id="btn-none"
						disabled={busy}
						onClick={() =>
							run("none", { fragmentMs: 40 }, "NO REASONING AT ALL")
						}
					>
						No reasoning
					</button>
					<button
						type="button"
						id="btn-measure"
						disabled={busy}
						onClick={measure}
					>
						Measure 9 runs
					</button>
					<button
						type="button"
						id="btn-scroll"
						disabled={busy}
						onClick={scrollCheck}
					>
						Scroll check
					</button>
				</div>
				<div className="lo-harness__probe" id="probe-status">
					<h2>Harness</h2>
					<div id="probe-state">{`state: ${status}`}</div>
					<div id="probe-phase">{`phase: ${phase || "-"}`}</div>
					<div id="probe-rows">{`rows on screen: ${view.transcript.records.length}`}</div>
					<div id="probe-reasoning">
						{`reasoning block: ${hasReasoning() ? "streaming" : "absent"}`}
					</div>
					<h2>Geometry</h2>
					<div id="probe-geometry">{reads || "-"}</div>
				</div>
			</div>
			<div className="lo-harness__probe" id="probe-readout">
				<h2>Probe</h2>
				<pre id="probe-log">
					{log.length ? log.join("\n\n") : "no runs yet"}
				</pre>
			</div>
		</div>
	);
};

const round = (value: number) => Math.round(value * 10) / 10;

createRoot(document.getElementById("root") as HTMLElement).render(
	<ThemeProvider>
		<Harness />
	</ThemeProvider>,
);
