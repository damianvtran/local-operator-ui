/**
 * THE COLLAPSED TURN'S OWN STATES (the frozen design's §4-§5).
 *
 * Why this is a story beside the tests. `turn-collapse-model.test.mjs` asserts
 * the plan's arithmetic and `turn-collapse-behaviour.test.mjs` drives the
 * interactions through the shipped transcript; neither can show the LINE a
 * reader looks at, in the pane a reader reads it in. The change is a row on
 * screen, so the evidence for it is a frame - one per state of the §5 case
 * matrix that a still can express, plus the live control.
 *
 * THE FIXTURES ARE BUILT THROUGH THE REAL REDUCER, so the records these cells
 * render are the records the app paints, `settledAt` included: the collapsed
 * bar's span is derived from frames of actual events, not a number typed beside
 * them. `Restored` is the one durable cell - a history page, no live `ts` to
 * settle from, which is exactly the state reload lands readers in.
 *
 * THE CAPTIONS ARE FIXTURE-LEVEL ON PURPOSE. The before half of this pair is
 * the same story on the pre-change tree (§10), where nothing collapses; a
 * caption that said "the work folds to one line" would be false of that frame.
 * Each caption names what the fixture IS, so it reads true on both halves.
 *
 * THE PANE IS PINNED (685px, the transcript's measured `clientHeight` at
 * 1380x900 - the figure the other transcript stories pin), so a cell cannot
 * quietly grow its viewport into a state no reader is in.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useRef } from "react";
import "../../../styles/index.css";
import type {
	DesktopHistoryPage,
	PendingDesktopGate,
} from "../../../../../shared/desktop-session-contract";
import { CanonicalTranscript } from "./canonical-transcript";
import type { CanonicalTranscriptStatus } from "./transcript-pane";
import {
	EMPTY_TRANSCRIPT,
	type TranscriptState,
	applyEvent,
	applyHistoryPage,
} from "./transcript-reducer";

/** One instant for every frame, so the frames are byte-reproducible. */
const TS = 1_760_000_000_000;

/**
 * The wall clock the LIVE cells measure against (design round 1, D5).
 *
 * A cell whose row is still running paints elapsed = now − start (`formatDuration`
 * clamps), so a fixture pinned to `TS` alone read `100d+` — the capture-time now
 * against a stamp from last October. The frozen `TS` stays where the frame's
 * stamps are FICTION-FREE anyway (a completed turn's stamp is a fixed fact), and
 * the two in-flight cells (`Running`, `Parked`) take `NOW` instead so their
 * clocks describe the seconds the frame actually shows.
 */
const NOW = Date.now();

/** The reader's own pane height (see the file comment). */
const PANE = 685;

const userMessage = (id: string, text: string) => ({
	id,
	role: "user",
	content: [{ type: "text", text }],
	tool_calls: [],
});

const assistantMessage = (id: string, text: string) => ({
	id,
	role: "assistant",
	content: text ? [{ type: "text", text }] : [],
	tool_calls: [],
});

type CallSpec = {
	id: string;
	name: string;
	command: string;
	durationS: number;
	failed?: boolean;
	/** Left in flight: the start's frame and nothing after it. */
	holding?: boolean;
	/**
	 * The pictures this call's result carries, one base64 PNG each. They ride
	 * the end frame's `result.content` as `{type: "image"}` blocks - the shape
	 * `transcript-reducer.ts`'s `extractImages` reads off the wire - so a story
	 * that needs a picture-bearing run builds it through the same path the app
	 * runs, not by planting a record.
	 */
	images?: string[];
};

/**
 * One call on the ledger, as the transcript's own events paint it: a start
 * frame (which is where the row's `ts` and its `startedAt` come from) and,
 * unless the call is still running, the end frame that settles it - the end's
 * `endedAt` is the reducer's own composition (`startedAt + duration_s`), so the
 * bar's span reads the same arithmetic the app would run.
 */
const runCalls = (
	state: TranscriptState,
	calls: CallSpec[],
	startMs: number,
	spacingMs = 10_000,
): TranscriptState => {
	let next = state;
	let at = startMs;
	for (const call of calls) {
		next = applyEvent(
			next,
			{
				type: "tool_execution_start",
				tool_call_id: call.id,
				tool_name: call.name,
				args: { command: call.command },
			},
			at,
		);
		if (!call.holding) {
			next = applyEvent(
				next,
				{
					type: "tool_execution_end",
					tool_call_id: call.id,
					tool_name: call.name,
					result: {
						content: [
							{ type: "text", text: `${call.id} done\n` },
							...(call.images ?? []).map((data) => ({
								type: "image",
								data,
								mime_type: "image/png",
							})),
						],
					},
					is_error: call.failed === true,
					duration_s: call.durationS,
				},
				at + 500,
			);
		}
		at += spacingMs;
	}
	return next;
};

const CALL_A: CallSpec = {
	id: "c1",
	name: "bash",
	command: "pnpm test:desktop",
	durationS: 12.5,
};
const CALL_B: CallSpec = {
	id: "c2",
	name: "read",
	command: "src/invoices/query.ts",
	durationS: 0.4,
};

/**
 * A finished turn: the question, some calls, the answer - with the answer
 * settling at its own frame (`message_end`), which is the live half of the
 * span (`settledAt`; the durable half is `Restored`).
 */
const finishedTurn = (calls: CallSpec[]): TranscriptState => {
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{ type: "message_start", message: userMessage("u1", QUESTION) },
		TS,
	);
	state = runCalls(state, calls, TS + 2_000);
	state = applyEvent(
		state,
		{ type: "message_start", message: assistantMessage("a1", "") },
		TS + 70_000,
	);
	return applyEvent(
		state,
		{ type: "message_end", message: assistantMessage("a1", ANSWER) },
		TS + 72_000,
	);
};

/**
 * THREE PIXEL FIXTURES FOR THE SPAN'S PICTURES, the same bytes the fold stories'
 * strip is judged against (`trace-fold.stories.tsx`): a 360x240 band, a 200x360
 * portrait and a 360x240 text-bearing plot. A strip is a presence cue rather
 * than a reader of the pictures, so what a fixture must prove is that THREE
 * DISTINCT pictures are present - not what any of them says.
 */
const SHOT_BAND =
	"iVBORw0KGgoAAAANSUhEUgAAAWgAAADwCAIAAACixWkYAAAC/0lEQVR42u3UsQnAIBRFUacJVs6RgTKLjbUOaRo3CPwiksCBM8HjcdORC0BIMgEgHIBwAMIBCAcgHADCAQgHIByAcADCASAcgHAAwgEIByAcAMIBCAcgHIBwAMIBCAeAcADCAQgHIByAcAAIByAcwAfCUVsHCBEOQDiADeGY8wYIEQ5AOADhAIQDEA5AOACEAxAOQDgA4QCEA0A4AOEAhAMQDkA4AIQDEA5AOADhAIQDEA4rAMIBCAcgHIBwAMIB8KdwnNcAngmHcIBwCAcIh3CAcAgHCIdwgHAIh3CAcAgHCIdwgHAIBwiHcIBwCAcgHMIBwiEcIBzCAcIhHCAcwgEIh3CAcAgHCIdwgHAIBwiHcIBwCIdwgHAIBwiHcIBwCAcIh3CAcAiHT4BwCAcIh3CAcAgHCIdwgHAIByAcwgHCIRwgHMIBwiEcIBzCAQiHcIBwCAcIh3CAcAgHCIdwgHAIh3CAcAgHCIdwgHAIBwiHcIBwCAcgHMIBwiEcIBzCAcIhHCAcwgEIh3CAcAgHCIdwgHAIBwiHcADCIRwgHMIBwiEcIBzCAcIhHCAcwiEcIBzCAcIhHCAcwgHCIRwgHMIBCIdwgHAIBwiHcIBwCAcIh3AAwiEcIBzCAcIhHCAcwgHCIRyAcAgHCIdwgHAIBwiHcIBwCAcIh3AIBwiHcIBwCAcIh3CAcAgHCIdwAMIhHCAcwgHCIRwgHMIBwiEcgHAIBwiHcIBwCAcIh3CAcAgHCIdwCAcIh3CAcAgHCIdwgHAIBwiHcAgHCIdwgHAIBwiHcIBwCAcIh3AAwiEcIBzCAcIhHCAcwgHCIRyAcAgHCIdwgHAACAcgHIBwAMIBCAeAcADCAQgHIByAcAAIByAcgHAAwgEIByAcAMIBCAcgHIBwAMIBIByAcADCAQgHIBwAwgEIByAcgHAAwgEgHIBwAMIBCAcgHIBwAAgHIByAcADCAQgHgHAAwgEIByAcgHAACAcgHIBwAMIBCAeAcADCAQgHIByAcADCASAcwCsWE+1fusL0MMsAAAAASUVORK5CYII=";
const SHOT_TALL =
	"iVBORw0KGgoAAAANSUhEUgAAAMgAAAFoCAIAAACdUSOTAAADD0lEQVR42u3SsQ2AIBRFUaYxVszhNIxjYy1DfhpXoPgJkpzkTvDeKcdZpfSKCQSWwBJYElgCS2BJYAksgSWBJbAElgSWwBJYElgCS2BJYAksgSWBJbAElgSWwBJYElgCS2BJYAksgSWBJbAElgSWwBJYElgCS2BJYGk1rPt5pfTAEljaCFbEkNIDS2AJLIFlBYElsASWBJbAElgSWAJLYElgCSyBJYElsASWBJbAElgSWAJLYElgCSyBJYElsASWBJbAElgSWAJLYElgCSyBJYElsATWVL1d2jewBJbAAgsssASWwAILLLAElsACCyywBJbAAgsssASWwAILLLAElsACCyywBJbAAgsssASWwAILLLAElsACCyywBJbAAgsssASWwAILLLAElsACCyywBJbAAgsssASWwAILLLAElsACCyywBJbAAgsssASWwAILLLAElsACCyywBJbAAgsssASWwAILLLAElsACCyywBJbAAgsssASWwPINWGAJLIElsMASWAJLYIElsASWwAJLYAksgQWWwBJYAgssgSWwBBZYYIElsAQWWGCBJbAEFlhggSWwBBZYYIElsAQWWGCBJbAEFlhggSWwBBZYYIElsAQWWGCBJbAEFlhggSWwBBZYYIElsAQWWGCBJbAEFlhggSWwBBZYYIElsAQWWGCBJbAEFlhggSWwBBZYYIElsAQWWGCBJbAEFlhggSWwBBZYYIElsAQWWGCBJbAEFlhggSWwBBZYYIElsAQWWGCBJbAElnvAAktgCSyBBZbAElgCCyyBJbAEFlgCS2AJLLAElsASWGCBBZbAElhggQWWwBJYElgCS2BJYAksgSWBJbAElgSWwBJYElgCS2BJYAksgSWBJbAElgSWwBJYElgCS2BJYAksgSWBJbAElgSWwBJYElgCS2BJYAksgSWBJbAElgSWwBJYElgCS2BJYAksgSWBJbAElgSWwBJYElgCS2BJYAksgSWBJbAElsAygcASWAJLAktgCSwJLIElsCSwBJbAksASWAJLAktgCSwJLP20D2a4hLjaytrlAAAAAElFTkSuQmCC";
const SHOT_PLOT =
	"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";

/**
 * THE TURN WHOSE CALLS PRODUCED PICTURES (operator report, 2026-09-29: at
 * EITHER fold level the images a folded span holds must stay visible - the
 * group's own strip answers the fold, and this bar answers the turn
 * condensation). A read of a screenshot and a run that shot two more, so the
 * strip has one landscape, one portrait and one text picture to stand for.
 */
const IMAGE_CALLS: CallSpec[] = [
	{ id: "c1", name: "bash", command: "pnpm test:desktop", durationS: 12.5 },
	{
		id: "c2",
		name: "read",
		command: "~/shots/pager-grid-2x.png",
		durationS: 0.4,
		images: [SHOT_BAND],
	},
	{
		id: "c3",
		name: "bash",
		command: "scripts/shoot.sh --report",
		durationS: 3.2,
		images: [SHOT_TALL, SHOT_PLOT],
	},
];

/**
 * The pathological span: eight pictures over five calls, so the strip's cap
 * and its overflow count are on a frame rather than in a comment.
 */
const MANY_IMAGE_CALLS: CallSpec[] = [
	{
		id: "m1",
		name: "bash",
		command: "scripts/shoot.sh --all",
		durationS: 8.1,
		images: [SHOT_BAND],
	},
	{
		id: "m2",
		name: "read",
		command: "~/shots/band.png",
		durationS: 0.3,
		images: [SHOT_BAND],
	},
	{
		id: "m3",
		name: "read",
		command: "~/shots/tall.png",
		durationS: 0.3,
		images: [SHOT_TALL],
	},
	{
		id: "m4",
		name: "read",
		command: "~/shots/plot.png",
		durationS: 0.3,
		images: [SHOT_PLOT],
	},
	{
		id: "m5",
		name: "bash",
		command: "scripts/shoot.sh --pair",
		durationS: 2.4,
		images: [SHOT_BAND, SHOT_TALL, SHOT_PLOT, SHOT_BAND],
	},
];

const QUESTION = "Which invoices were late last month?";
const ANSWER =
	"Four were late: 1042, 1088, 1103 and 1177. The pattern is the card that expired on file.";

/**
 * A turn the reader STEERED: the second question arrives while the first
 * answer is still being written, so it is not a turn of its own - it belongs
 * to the run it interrupted, and the collapse carries it inside.
 */
const steeredTurn = (): TranscriptState => {
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{ type: "message_start", message: userMessage("u1", QUESTION) },
		TS,
	);
	state = runCalls(state, [CALL_A], TS + 2_000);
	state = applyEvent(
		state,
		{
			type: "message_start",
			message: userMessage(
				"u2",
				"Actually, include the ones credited late too.",
			),
		},
		TS + 30_000,
	);
	state = runCalls(state, [CALL_B], TS + 32_000);
	state = applyEvent(
		state,
		{ type: "message_start", message: assistantMessage("a1", "") },
		TS + 70_000,
	);
	return applyEvent(
		state,
		{ type: "message_end", message: assistantMessage("a1", ANSWER) },
		TS + 72_000,
	);
};

/**
 * A turn the READER STOPPED: the answer was being written when the abort
 * arrived, so the record settles at the turn end's own frame (`agent_end`'s
 * sweep) and keeps its `Stopped before finishing` caption - the collapse does
 * not restate the interruption in the bar (v1; the sibling session owns the
 * outcome wording).
 */
const interruptedTurn = (): TranscriptState => {
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{ type: "message_start", message: userMessage("u1", QUESTION) },
		TS,
	);
	state = runCalls(state, [CALL_A], TS + 2_000);
	state = applyEvent(
		state,
		{ type: "message_start", message: assistantMessage("a1", "") },
		TS + 40_000,
	);
	state = applyEvent(
		state,
		{
			type: "message_update",
			delta: "I was checking the credit ledger when",
			message: assistantMessage("a1", ""),
		},
		TS + 40_500,
	);
	return applyEvent(state, { type: "agent_end", aborted: true }, TS + 41_000);
};

/** A turn where one call genuinely ERRORED: the bar's one failure control. */
const failedTurn = (): TranscriptState => {
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{ type: "message_start", message: userMessage("u1", QUESTION) },
		TS,
	);
	state = runCalls(state, [{ ...CALL_A, failed: true }, CALL_B], TS + 2_000);
	state = applyEvent(
		state,
		{ type: "message_start", message: assistantMessage("a1", "") },
		TS + 70_000,
	);
	return applyEvent(
		state,
		{ type: "message_end", message: assistantMessage("a1", ANSWER) },
		TS + 72_000,
	);
};

/** Twelve calls, so the count clause is read at its long form. */
const LONG_CALLS: CallSpec[] = [
	{ id: "l1", name: "read", command: "src/invoices/query.ts", durationS: 0.3 },
	{
		id: "l2",
		name: "read",
		command: "src/invoices/refunds.ts",
		durationS: 0.4,
	},
	{
		id: "l3",
		name: "bash",
		command: "psql -c 'select * from invoices'",
		durationS: 4.2,
	},
	{
		id: "l4",
		name: "bash",
		command: "psql -c 'select * from credits'",
		durationS: 3.8,
	},
	{
		id: "l5",
		name: "eval",
		command: "join_frames.py --month august",
		durationS: 8.1,
	},
	{
		id: "l6",
		name: "eval",
		command: "late_by_card.py --month august",
		durationS: 2.9,
	},
	{ id: "l7", name: "read", command: "src/cards/expiry.ts", durationS: 0.5 },
	{ id: "l8", name: "bash", command: "git log --oneline -5", durationS: 0.2 },
	{
		id: "l9",
		name: "read",
		command: "src/settings/tolerance.ts",
		durationS: 0.3,
	},
	{ id: "l10", name: "bash", command: "rg 'grace_period' src", durationS: 1.1 },
	{ id: "l11", name: "eval", command: "tolerance_check.py", durationS: 3.4 },
	{
		id: "l12",
		name: "bash",
		command: "pnpm vitest run invoices",
		durationS: 6.6,
	},
];

/**
 * The same completed turn read from HISTORY: durable rows, whose `ts` is the
 * commit the runtime wrote, and no live frames at all - no `settledAt`, which
 * is the state reload lands readers in (the span must still read the same).
 */
const restoredTurn = (): TranscriptState => {
	type Entry = DesktopHistoryPage["entries"][number];
	const entry = (
		id: string,
		ts: number,
		payload: Record<string, unknown>,
	): Entry => ({ id, ts, type: "message", payload });
	/*
	 * DURABLE ENTRIES CARRY SECONDS, not milliseconds (design round 1, D1):
	 * `applyHistoryPage` multiplies by 1000 the way the wire stores them, so
	 * feeding it `TS` read 72,000ms as 72,000s — `Took 20h`, stamp year 57742.
	 * The frame must read what the collapsed cell reads: `Took 1m12s` and
	 * `Oct 9, 2025`.
	 */
	const S = TS / 1000;
	return applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [
			entry("u1", S, {
				kind: "message",
				role: "user",
				content: [{ text: QUESTION }],
			}),
			entry("t1", S + 3, {
				kind: "message",
				role: "tool",
				tool_call_id: "c1",
				tool_name: "bash",
				content: [{ type: "text", text: "tests 40\npass 40\n" }],
				provider_payload: { duration_s: 12.5, details: {} },
			}),
			entry("a1", S + 72, {
				kind: "message",
				role: "assistant",
				content: [{ type: "text", text: ANSWER }],
				stop_reason: "stop",
			}),
		],
		has_more: false,
		cursor_missing: false,
	});
};

/**
 * A turn still in flight: the control - nothing condenses while it runs.
 *
 * The stamps sit BEHIND the capture's own clock (D5): a call started five
 * seconds ago reads `5s` rather than the `0s` a start at module load shows or
 * the `100d+` the frozen `TS` showed.
 */
const runningTurn = (): TranscriptState => {
	const state = applyEvent(
		EMPTY_TRANSCRIPT,
		{ type: "message_start", message: userMessage("u1", QUESTION) },
		NOW - 10_000,
	);
	return runCalls(
		state,
		[
			{ ...CALL_A, holding: true },
			{ ...CALL_B, holding: true },
		],
		NOW - 5_000,
	);
};

/**
 * A turn PARKED on the reader's gate (design review round 1, D3).
 *
 * The same shape the live rig parks in: the call is out and the transcript
 * awaits an approval, so the pane's working line stands down - which is why
 * the collapse cannot read the working line alone. `Parked` passes the gate;
 * the fix's own test is that NO bar renders here (and the live set carries the
 * moment with its question card).
 */
const parkedTurn = (): TranscriptState => {
	const state = applyEvent(
		EMPTY_TRANSCRIPT,
		{ type: "message_start", message: userMessage("u1", QUESTION) },
		NOW - 10_000,
	);
	return runCalls(state, [{ ...CALL_A, holding: true }], NOW - 5_000);
};

/** A minimal pending approval, shaped as the wire sends it. */
const PARKED_GATE: PendingDesktopGate = {
	request_id: "gate-1",
	kind: "approval",
	title: "Run the checks?",
	detail: "bash: pnpm test:desktop",
	options: [{ label: "Approve" }, { label: "Deny" }],
	secret: false,
	question_index: 0,
	question_total: 1,
};

/**
 * §5 case 3 (design round 1, D4a): the in-between is NARRATION - a settled
 * mid-turn assistant row and no calls at all - so the bar's whole sentence is
 * the span (`Took 1m12s`, no action clause).
 */
const narrationTurn = (): TranscriptState => {
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{ type: "message_start", message: userMessage("u1", QUESTION) },
		TS,
	);
	state = applyEvent(
		state,
		{ type: "message_start", message: assistantMessage("n1", "") },
		TS + 20_000,
	);
	state = applyEvent(
		state,
		{
			type: "message_end",
			message: assistantMessage("n1", "Checking the invoice ledger first."),
		},
		TS + 21_000,
	);
	state = applyEvent(
		state,
		{ type: "message_start", message: assistantMessage("a1", "") },
		TS + 70_000,
	);
	return applyEvent(
		state,
		{ type: "message_end", message: assistantMessage("a1", ANSWER) },
		TS + 72_000,
	);
};

/**
 * §11-R4 (design round 1, D4b): a PINNED statement inside the span - a
 * completion marker between two call rows - so the clustering the caveat names
 * is on a frame: collapsed, the marker sits below the bar, in its own place.
 */
const pinnedTurn = (): TranscriptState => {
	const S = TS / 1000;
	type Entry = DesktopHistoryPage["entries"][number];
	const entry = (
		id: string,
		ts: number,
		payload: Record<string, unknown>,
	): Entry => ({ id, ts, type: "message", payload });
	/*
	 * The marker is a CUSTOM entry, not a message (the durable reader switches
	 * on `entry.type === "custom" && payload.custom_type ===
	 * "completion_attention"`): a `message` spelling of it silently paints
	 * nothing, which is how the first capture of this cell missed its notice.
	 */
	const customEntry = (
		id: string,
		ts: number,
		payload: Record<string, unknown>,
	): Entry => ({ id, ts, type: "custom", payload });
	return applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [
			entry("u1", S, {
				kind: "message",
				role: "user",
				content: [{ text: QUESTION }],
			}),
			entry("t1", S + 3, {
				kind: "message",
				role: "tool",
				tool_call_id: "c1",
				tool_name: "bash",
				content: [{ type: "text", text: "tests 40\npass 40\n" }],
				provider_payload: { duration_s: 12.5, details: {} },
			}),
			customEntry("n1", S + 6, {
				custom_type: "completion_attention",
				details: { anchor: "n1", kind: "interrupted" },
			}),
			entry("t2", S + 9, {
				kind: "message",
				role: "tool",
				tool_call_id: "c2",
				tool_name: "read",
				content: [{ type: "text", text: "src/invoices/query.ts\n" }],
				provider_payload: { duration_s: 0.4, details: {} },
			}),
			entry("a1", S + 72, {
				kind: "message",
				role: "assistant",
				content: [{ type: "text", text: ANSWER }],
				stop_reason: "stop",
			}),
		],
		has_more: false,
		cursor_missing: false,
	});
};

/**
 * THE OPERATOR'S OWN STATE (2026-09-29, issue: the condensed bar's spacing):
 * "the condensed row ('Context compacted') hugs the summary row's rule too
 * closely" and "the chevron ('>') doesn't reach the right end of the rule".
 *
 * The `pinned` cell above photographs a completion MARKER; this one is the pin
 * list's first member - the memory statement - read durably so its sentence is
 * the cold reader's own (`COMPACTED_LINE`), which is the string the report
 * quotes and the row BOTH halves of the fix move: the gap under the bar's rule,
 * and the bar's own chevron against the rule's end.
 */
const compactedTurn = (): TranscriptState => {
	const S = TS / 1000;
	type Entry = DesktopHistoryPage["entries"][number];
	const entry = (
		id: string,
		ts: number,
		payload: Record<string, unknown>,
	): Entry => ({ id, ts, type: "message", payload });
	return applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [
			entry("u1", S, {
				kind: "message",
				role: "user",
				content: [{ text: QUESTION }],
			}),
			entry("t1", S + 3, {
				kind: "message",
				role: "tool",
				tool_call_id: "c1",
				tool_name: "bash",
				content: [{ type: "text", text: "tests 40\npass 40\n" }],
				provider_payload: { duration_s: 12.5, details: {} },
			}),
			/*
			 * The durable compaction entry: `append_compaction` writes
			 * `tokens_before` and no after-figure, and a row with no settled
			 * sentence of its own keeps `COMPACTED_LINE` - the operator's row.
			 */
			{
				id: "n1",
				ts: S + 6,
				type: "compaction",
				payload: { tokens_before: 41_000 },
			},
			entry("t2", S + 9, {
				kind: "message",
				role: "tool",
				tool_call_id: "c2",
				tool_name: "read",
				content: [{ type: "text", text: "src/invoices/query.ts\n" }],
				provider_payload: { duration_s: 0.4, details: {} },
			}),
			entry("a1", S + 72, {
				kind: "message",
				role: "assistant",
				content: [{ type: "text", text: ANSWER }],
				stop_reason: "stop",
			}),
		],
		has_more: false,
		cursor_missing: false,
	});
};

/**
 * THE INCIDENT ROW'S STATE (operator report, 2026-09-29, second round): a turn
 * that DIED after a compaction. The memory statement and the incident reason
 * are the two rows the collapsed bar leaves under its rule, and the incident
 * was the one hugging the statement by the ledger's 2px - the class the walk's
 * re-tier now covers (every visible group after a bar, not only the first).
 *
 * The incident payload is quoted from the operator's own store, the `mcp` row
 * 636 of its 946 incidents carry (see `canonical-notice.stories.tsx` for the
 * full set); the turn has no closing answer because it never got one - the
 * reason is the last row of it.
 */
const incidentTurn = (): TranscriptState => {
	const S = TS / 1000;
	type Entry = DesktopHistoryPage["entries"][number];
	const entry = (
		id: string,
		ts: number,
		payload: Record<string, unknown>,
	): Entry => ({ id, ts, type: "message", payload });
	return applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [
			entry("u1", S, {
				kind: "message",
				role: "user",
				content: [{ text: QUESTION }],
			}),
			entry("t1", S + 3, {
				kind: "message",
				role: "tool",
				tool_call_id: "c1",
				tool_name: "bash",
				content: [{ type: "text", text: "tests 40\npass 40\n" }],
				provider_payload: { duration_s: 12.5, details: {} },
			}),
			{
				id: "n1",
				ts: S + 6,
				type: "compaction",
				payload: { tokens_before: 41_000 },
			},
			entry("t2", S + 9, {
				kind: "message",
				role: "tool",
				tool_call_id: "c2",
				tool_name: "read",
				content: [{ type: "text", text: "src/invoices/query.ts\n" }],
				provider_payload: { duration_s: 0.4, details: {} },
			}),
			entry("i1", S + 12, {
				kind: "custom",
				custom_type: "session_incident",
				details: {
					text: "[session incident (openrouter/deepseek/deepseek-v4.1-flash)] mcp: MCP server 'notion': MCP authorization failed; run /mcp reauth notion — authorization expired\nsuggested action: An MCP server is unavailable: its tools are gone until it reconnects. Do not call its tools in a tight loop; say which server is down.\nThis is why the previous turn ended. Take it into account before repeating the same request.",
					raw: "MCP server 'notion': MCP authorization failed; run /mcp reauth notion — authorization expired",
				},
			}),
		],
		has_more: false,
		cursor_missing: false,
	});
};

/**
 * ISSUE #5'S CELL (operator feedback, 2026-09-29): the turn as the operator
 * sees it when a window-collect runs - peer and wake delivery receipts among
 * the call rows. Under the narrowed pin list these collapse WITH the work, and
 * the pair of frames (this one, and the same story pressed open in the
 * capture table) is what the design round judges.
 */
const receiptsTurn = (): TranscriptState => {
	const S = TS / 1000;
	type Entry = DesktopHistoryPage["entries"][number];
	const entry = (
		id: string,
		ts: number,
		payload: Record<string, unknown>,
	): Entry => ({ id, ts, type: "message", payload });
	return applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [
			entry("u1", S, {
				kind: "message",
				role: "user",
				content: [{ text: QUESTION }],
			}),
			entry("p1", S + 2, {
				kind: "custom",
				custom_type: "peer_message",
				details: {
					body: "window-collect: 140 records staged for the next batch.",
					sender: {
						pid: "",
						conversationName: "ingest-rail",
						cwd: "",
						sessionId: "",
						modelLabel: "",
					},
				},
			}),
			entry("t1", S + 3, {
				kind: "message",
				role: "tool",
				tool_call_id: "c1",
				tool_name: "bash",
				content: [{ type: "text", text: "tests 40\npass 40\n" }],
				provider_payload: { duration_s: 12.5, details: {} },
			}),
			entry("w1", S + 5, {
				kind: "custom",
				custom_type: "wake_prompt",
				details: {
					text: "(alarm) Scheduled wake w-9 (1, every 6h)\n\nCollect the staged records.",
				},
			}),
			entry("t2", S + 9, {
				kind: "message",
				role: "tool",
				tool_call_id: "c2",
				tool_name: "read",
				content: [{ type: "text", text: "src/invoices/query.ts\n" }],
				provider_payload: { duration_s: 0.4, details: {} },
			}),
			entry("a1", S + 72, {
				kind: "message",
				role: "assistant",
				content: [{ type: "text", text: ANSWER }],
				stop_reason: "stop",
			}),
		],
		has_more: false,
		cursor_missing: false,
	});
};

/**
 * THE OPERATOR'S EXACT SHAPE FOR THE COMPLETION-VISIBILITY CHANGE
 * (`U T88 A1(stop) W T3 A2(stop) K`), read durably.
 *
 * Why it is its own fixture. No other cell in this file renders a run whose
 * FULSOME completion answers real work, is continued past by a wake, and is then
 * followed by a SHORT reply: `Collapsed`/`Restored` end on their one answer, and
 * `Receipts`/`Pinned` hold their receipts among calls with no completion before
 * the close. The complaint was this shape - the substance sat in `A1`, the
 * shipped fold kept only the last close visible, so `A1` was inside the bar and
 * "I have to click to expand" to read it.
 *
 *   U   the question
 *   T88 eighty-eight calls of real work (one bar: 1 to 88)
 *   A1  the FULSOME completion, settled `stop_reason: "stop"` (the provider's
 *       own declaration that the model had finished) - the row the change keeps
 *       out of the bar
 *   W   the wake that re-enters the run after A1 (a `wake_prompt` receipt; a
 *       collapsed span holds it, so it is not a visible row)
 *   T3  three calls the wake prompted (the second bar)
 *   A2  the SHORT reply, also `stop` - the run's elected answer, which keeps the
 *       foot and the one stamp
 *   K   the closed receipt the disposal leaves after the reply
 *
 * What the frame must show: both completions visible, one bar (88 actions) above
 * A1 and a second (3 actions) between A1 and A2, the stamp on A2 only. On the
 * pre-change tree A1 is inside the bar. The before half is this same cell
 * captured from the base tree (copy this story file into a base worktree and
 * serve that Storybook - it reads only the shipped reducer and transcript, so it
 * renders there unchanged). The fixture's partition was checked by `partitionRun`
 * directly: visible rows are A1, A2 and K; hidden spans are T1-T88 and W+T3.
 *
 * The text is fiction written for the cell, shaped like the journal's lengths
 * (a multi-paragraph close, then a one-line reply); no journal prose is quoted.
 */
const FULSOME_CLOSE = [
	"All 88 steps are done, and the invoice export is complete.",
	"What changed: the late-invoice query now joins the credit ledger, so credits issued after the due date no longer count as paid on time. Four invoices were late in September: 1042, 1088, 1103 and 1177.",
	"What I verified: the totals match the ledger to the cent, the export has 214 rows, and the card-expiry pattern holds for three of the four.",
	"Still open: invoice 1177 has no card on file at all, which I left for you to decide.",
].join("\n\n");
const SHORT_REPLY = "The collector is staged and the export is attached.";

const completionsBothVisibleTurn = (): TranscriptState => {
	type Entry = DesktopHistoryPage["entries"][number];
	const S = TS / 1000;
	const entry = (
		id: string,
		ts: number,
		payload: Record<string, unknown>,
	): Entry => ({ id, ts, type: "message", payload });
	const customEntry = (
		id: string,
		ts: number,
		payload: Record<string, unknown>,
	): Entry => ({ id, ts, type: "custom", payload });
	const call = (n: number, ts: number): Entry =>
		entry(`t${n}`, ts, {
			kind: "message",
			role: "tool",
			tool_call_id: `c${n}`,
			tool_name: n % 3 === 0 ? "read" : "bash",
			content: [{ type: "text", text: `c${n} done\n` }],
			provider_payload: { duration_s: 1.5, details: {} },
		});
	const work = Array.from({ length: 88 }, (_, i) => call(i + 1, S + 2 + i * 2));
	const followUp = [89, 90, 91].map((n, i) => call(n, S + 215 + i * 3));
	return applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [
			entry("u1", S, {
				kind: "message",
				role: "user",
				content: [{ text: QUESTION }],
			}),
			...work,
			entry("a1", S + 185, {
				kind: "message",
				role: "assistant",
				content: [{ type: "text", text: FULSOME_CLOSE }],
				stop_reason: "stop",
			}),
			entry("w1", S + 205, {
				kind: "custom",
				custom_type: "wake_prompt",
				details: {
					text: "(alarm) Scheduled wake w-9 (1, every 6h)\n\nCollect the staged records.",
				},
			}),
			...followUp,
			entry("a2", S + 230, {
				kind: "message",
				role: "assistant",
				content: [{ type: "text", text: SHORT_REPLY }],
				stop_reason: "stop",
			}),
			customEntry("k1", S + 231, {
				custom_type: "completion_attention",
				details: { anchor: "k1", kind: "closed" },
			}),
		],
		has_more: false,
		cursor_missing: false,
	});
};

/**
 * THE REPORTER'S TURN (issue #756), AND THE ONE SHAPE THE MODE MOVES.
 *
 * WHY THIS CELL EXISTS (design review round 1, D1 MAJOR). The two display modes
 * came out BYTE-IDENTICAL on every settled transcript cell the round could
 * shoot, and on those fixtures they had to: V1 keeps every RESPONSE close
 * visible in both modes (`partitionRun`), so a turn whose assistant rows are all
 * closes is already showing everything `by-response` would add. The widening is
 * observable on exactly one shape - a settled, text-bearing assistant row that
 * is neither a close nor `stop`-declared - and no shipped fixture had one. That
 * shape is the issue's own report (an answer, then a nine-item addendum as the
 * final message): the substance went out as prose the agent then kept working
 * past, so nothing in the invariant keeps it and only the second mode shows it.
 *
 * THE FIXTURE IS THE REPORTER'S TURN ROW BY ROW, built through the durable door
 * (`applyHistoryPage`) because seconds and a `message` payload are how a journal
 * row actually arrives:
 *
 * | row  | what it is                                                            |
 * |------|-----------------------------------------------------------------------|
 * | `u1` | the question                                                          |
 * | `c1` | the call that answered it                                             |
 * | `n1` | THE SUBSTANCE PROSE: settled, text-bearing, carrying NO `stop_reason`, |
 * |      | and followed by more work - so it is narration, not a close, and the  |
 * |      | invariant has no clause that keeps it                                 |
 * | `c2` | the call that produced the addendum                                    |
 * | `a1` | the addendum as the last message, `stop`-declared: the turn's elected  |
 * |      | answer, and the row the caption and the foot key on IN BOTH MODES      |
 *
 * WHAT THE TWO MODES DO WITH IT, read out of the shipped plan rather than
 * asserted here: `by-turn` spends ONE bar over `[c1, n1, c2]` reading
 * `2 actions` (the narration is inside it), while `by-response` keeps `n1` on
 * screen and spends TWO bars, `[c1]` and `[c2]`, one action each - and the
 * elected answer is `a1` in both, which is #665's lesson holding under the
 * widening. That difference is the feature, so this cell is the one whose pair
 * cannot be identical.
 *
 * THE PROSE IS SYNTHETIC, composed from the vocabulary this file already uses
 * for the same query (`QUESTION`, `ANSWER`); no journal text is quoted.
 */
const SUBSTANCE =
	"Four were late in September: 1042, 1088, 1103 and 1177. The pattern is the card that expired on file.";
const ADDENDUM =
	"Addendum: the export holds 214 rows. Invoice 1177 has no card on file at all, which I left for you to decide.";

const substanceThenAddendumTurn = (): TranscriptState => {
	type Entry = DesktopHistoryPage["entries"][number];
	const S = TS / 1000;
	const entry = (
		id: string,
		ts: number,
		payload: Record<string, unknown>,
	): Entry => ({ id, ts, type: "message", payload });
	/* A call row, as the durable door carries one: the result text and the
	 * provider's own duration, which is what the bar's `Took` clause reads. */
	const call = (
		id: string,
		ts: number,
		toolName: string,
		text: string,
		durationS: number,
	): Entry =>
		entry(id, ts, {
			kind: "message",
			role: "tool",
			tool_call_id: id,
			tool_name: toolName,
			content: [{ type: "text", text }],
			provider_payload: { duration_s: durationS, details: {} },
		});
	return applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [
			entry("u1", S, {
				kind: "message",
				role: "user",
				content: [{ text: QUESTION }],
			}),
			call(
				"c1",
				S + 3,
				"bash",
				"psql -c 'select late invoices'\n4 rows\n",
				3.5,
			),
			/*
			 * THE ROW THE MODE MOVES. No `stop_reason` on purpose: a declared finish
			 * would put it in V4 and both modes would keep it, which is what made every
			 * earlier cell a pair of identical frames.
			 */
			entry("n1", S + 40, {
				kind: "message",
				role: "assistant",
				content: [{ text: SUBSTANCE }],
			}),
			call(
				"c2",
				S + 60,
				"bash",
				"scripts/export_late_invoices.sh\n214 rows\n",
				6.2,
			),
			entry("a1", S + 72, {
				kind: "message",
				role: "assistant",
				content: [{ text: ADDENDUM }],
				stop_reason: "stop",
			}),
		],
		has_more: false,
		cursor_missing: false,
	});
};

/** Which receipt RE-OPENS the settled run: the two the operator's report names. */
type CycleTrigger = "wake" | "peer";

/**
 * THE OPERATOR'S JITTER, AS THE INSTANT IT HAPPENS (report, 2026-10-01).
 *
 * WHY THIS CELL EXISTS. The report: "messages are condensed, and then if a peer
 * message or job completes and the agent goes into thinking, the last condensed
 * sequence suddenly un-condenses". A wake or a peer receipt does not open a run -
 * only a `user` row does - so it RE-OPENS the run that had just settled, which is
 * then the newest run and therefore `live`. The shipped rule spent `live` on the
 * WHOLE run, so the bar the reader had just read came apart the moment the agent
 * started thinking again, and folded back when it stopped: motion, twice, with no
 * reader action. What replaced that bar is NOT 88 drawn rows - see the base-frame
 * paragraph below, which is what the pair photographs. `planRun` now spends `live`
 * on the IN-FLIGHT CYCLE
 * only - the rows after the last settled close (`turn-collapse-model.ts`'s
 * `settledCloseOf`) - so everything the reader has watched settle keeps its bar,
 * and the one thing drawn in place is the cycle still being written.
 *
 * THE SHAPE IS THE SIBLING CELL'S, HELD ONE INSTANT EARLIER.
 * `CompletionsBothVisible` renders this same run settled (`U T88 A1(stop) W T3
 * A2(stop) K`); this cell is that fixture held while the trigger's cycle is still
 * running. A settled frame cannot show this defect at all - with nothing in flight
 * `live` is false and both trees condense, so the pair would be identical, which is
 * why the row this file already had was not enough.
 *
 * WHY THE CYCLE'S TAIL IS BUILT FROM LIVE FRAMES. The durable door cannot carry an
 * in-flight row: `durableRecord` settles every tool row it reads (`phase: "done"`,
 * `startedAt: null`), because a history page has no in-flight record to be. So the
 * prefix arrives the way a reload paints it (`applyHistoryPage`) and the cycle's
 * last call arrives as the live frame the harness sends it with - the same two
 * doors `FreshConversation` mixes, for the same reason. Everything imported here is
 * shipped on both trees, so the before half is this file copied into a base worktree
 * (§10's method).
 *
 * THE BASE CLAIM IS TWO CLAIMS, AND ONLY ONE OF THEM IS TRUE OF THE PIXELS (design
 * round 2, D1). The MODEL reading is `collapses: false`: driven through the shipped
 * plan, the base tree spends `live` on the WHOLE run again while the trigger's cycle
 * is out, where this tree answers one bar hiding the 88 calls. What the base FRAME
 * paints is not 88 rows - it is ONE COLLAPSED TRACE FOLD, `Explored 29 files, ran 59
 * commands`, with NO turn-collapse bar at all and `A1` (the receipt and everything
 * below it with it) 13.00 px HIGHER than here. 29 + 59 = 88: the fold and the bar
 * count the SAME 88 rows in two idioms (`29 files / 59 commands` against `88
 * actions`), so the two numbers do not disagree - they are the same work, condensed
 * by different mechanisms (the trace group vs the turn summary). The reader-visible
 * base defect is therefore that fold, its swapped vocabulary and chevron side, and
 * the 13.00 px reflow of the answer - real motion, and fixed here, but an order of
 * magnitude smaller than an unbarred wall of 88 rows.
 *
 * WHAT THE FRAME MUST SHOW: one bar (88 actions) above `A1`, `A1` whole, the receipt
 * the trigger left, and the cycle drawn in place as ONE live trace fold over its
 * three calls (`Explored 1 file, ran 2 commands`, the third still out - three calls,
 * one row, because the trace group condenses them) above the working line. The bar
 * and `A1` must not move when the trigger lands; that stillness is the fix.
 *
 * THE CLOCK IS `NOW`, NOT THE FROZEN `TS`: a call is still out, so this is a live
 * frame and its whole turn is anchored on the capture's own clock the way `Running`
 * and `Parked` are. A fixture pinned to `TS` would paint the in-flight call's
 * elapsed as `100d+` and put the turn's own stamp in last October. The turn opens
 * 4m05s back, so the durable door's offsets below (`A1` at +3m05s, the trigger at
 * +3m25s, the two settled calls at +3m35s/+3m38s) land inside it, ahead of the live
 * call at -5s.
 *
 * TWO CELLS, ONE PER TRIGGER, because the operator's report names both and they are
 * two different hidden rows (`peer_message`, `wake_prompt`) reaching the same rule -
 * and the reproduction was the peer one, which is why the peer cell is not the
 * footnote here.
 *
 * The prose is the sibling cell's `FULSOME_CLOSE`, so the pair differs by the
 * instant and nothing else; no journal text is quoted.
 */
const midCycleTurn = (trigger: CycleTrigger): TranscriptState => {
	type Entry = DesktopHistoryPage["entries"][number];
	const S = Math.round(NOW / 1000) - 245;
	const entry = (
		id: string,
		ts: number,
		payload: Record<string, unknown>,
	): Entry => ({ id, ts, type: "message", payload });
	const call = (n: number, ts: number): Entry =>
		entry(`t${n}`, ts, {
			kind: "message",
			role: "tool",
			tool_call_id: `c${n}`,
			tool_name: n % 3 === 0 ? "read" : "bash",
			content: [{ type: "text", text: `c${n} done\n` }],
			provider_payload: { duration_s: 1.5, details: {} },
		});
	const work = Array.from({ length: 88 }, (_, i) => call(i + 1, S + 2 + i * 2));
	const settled = [89, 90].map((n, i) => call(n, S + 215 + i * 3));
	const state = applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [
			entry("u1", S, {
				kind: "message",
				role: "user",
				content: [{ text: QUESTION }],
			}),
			...work,
			entry("a1", S + 185, {
				kind: "message",
				role: "assistant",
				content: [{ type: "text", text: FULSOME_CLOSE }],
				stop_reason: "stop",
			}),
			/*
			 * The receipt goes through the `message` door with `kind: "custom"`, the two
			 * fields the durable reader switches on - an entry `type: "custom"` is read
			 * only for `completion_attention` and dropped otherwise, which is how the
			 * first attempt at this cell lost its trigger row and drew the cycle as
			 * bare calls.
			 */
			trigger === "wake"
				? entry("w1", S + 205, {
						kind: "custom",
						custom_type: "wake_prompt",
						details: {
							text: "(alarm) Scheduled wake w-9 (1, every 6h)\n\nCollect the staged records.",
						},
					})
				: entry("p1", S + 205, {
						kind: "custom",
						custom_type: "peer_message",
						details: {
							body: "window-collect: 140 records staged for the next batch.",
							sender: {
								pid: "",
								conversationName: "ingest-rail",
								cwd: "",
								sessionId: "",
								modelLabel: "",
							},
						},
					}),
			...settled,
		],
		has_more: false,
		cursor_missing: false,
	});
	/*
	 * The cycle's third call is the one still out (`holding`). The pane's own `waiting`
	 * prop - `canonical.busy` in the app, true here because the owner is generating -
	 * is what turns that running row into the working line the reader sees under the
	 * last cycle; it is passed on the cell, the way `Running` passes it, and it is
	 * half of what makes `live` true for the collapse plan.
	 */
	const collect: CallSpec = {
		id: "c91",
		name: "bash",
		command: "records stage --window next",
		durationS: 4.2,
	};
	return runCalls(state, [{ ...collect, holding: true }], NOW - 5_000);
};

const Frame = ({
	transcript,
	caption,
	status = "live",
	waiting = false,
	gate = null,
}: {
	transcript: TranscriptState;
	caption: string;
	status?: CanonicalTranscriptStatus;
	waiting?: boolean;
	gate?: PendingDesktopGate | null;
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	return (
		<div className="flex flex-col gap-2 bg-canvas p-6">
			{/* A fixed caption box, so the pair overlays when a reviewer flips
			 * between the frames: two captions of different lengths would move the
			 * conversation under them. */}
			<p className="h-10 text-body-sm text-ink-muted">{caption}</p>
			<div
				className="flex min-h-0 flex-col"
				style={{ height: PANE }}
				ref={containerRef}
			>
				<CanonicalTranscript
					transcript={transcript}
					gate={gate}
					waiting={waiting}
					starting={false}
					loadingOlder={false}
					onLoadOlder={async () => true}
					containerRef={containerRef}
					isSmallView={false}
					status={status}
					failure={null}
					awaitingHydration={false}
					onReconnect={() => {}}
				/>
			</div>
		</div>
	);
};

const meta: Meta = {
	title: "chat/turn-collapse",
	parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj;

/** §5 case 2-3: a completed turn, the work standing in for one line. */
export const Collapsed: Story = {
	render: () => (
		<Frame
			transcript={finishedTurn([CALL_A, CALL_B])}
			caption="A finished turn — the question, two calls, the answer."
		/>
	),
};

/**
 * The same turn after the reader's press: the bar IS the toggle, and the rows
 * it stood in for are mounted again with their own folds intact. Pressed
 * through the bar's own trigger (`press:` on this story's sweep row) rather
 * than pre-opened, because the question is whether that control opens it.
 */
export const Expanded: Story = {
	render: () => (
		<Frame
			transcript={finishedTurn([CALL_A, CALL_B])}
			caption="The same turn, opened by the reader's press."
		/>
	),
};

/**
 * §5 case 5: the steer is part of the run it interrupted.
 *
 * Changed by the completion-visibility invariant (V3: a `user` row is never
 * hidden by a collapsed span). Before it, one `Steered` bar hid the reader's
 * second message; now that message stays visible in place with a bar on each
 * side and no bar is labelled `Steered`. The committed `steering` before/after
 * frames under `docs/evidence/chat-turn-collapse*` predate this and are stale.
 */
export const Steering: Story = {
	render: () => (
		<Frame
			transcript={steeredTurn()}
			caption="A turn steered mid-run — the second question stays visible where it arrived, with a bar of work on each side."
		/>
	),
};

/** §5 case 6: interrupted, answer painted; the bar states no outcome. */
export const Interrupted: Story = {
	render: () => (
		<Frame
			transcript={interruptedTurn()}
			caption="A turn the reader stopped — the answer keeps its own caption; the bar does not restate it."
		/>
	),
};

/** §5 case 4: one genuine error, one control away. */
export const Failed: Story = {
	render: () => (
		<Frame
			transcript={failedTurn()}
			caption="A turn with one failed call — no tally on the bar; the red row keeps the state, one press away."
		/>
	),
};

/** §5 case 9: the count clause at its long form. */
export const LongRun: Story = {
	render: () => (
		<Frame
			transcript={finishedTurn(LONG_CALLS)}
			caption="A long turn — twelve calls between the question and the answer."
		/>
	),
};

/** The reload state: durable rows, no live frames, the same span. */
export const Restored: Story = {
	render: () => (
		<Frame
			transcript={restoredTurn()}
			caption="The same turn read from history — durable rows, no live frames."
		/>
	),
};

/** The control: a turn in flight renders as it always did. */
export const Running: Story = {
	render: () => (
		<Frame
			transcript={runningTurn()}
			caption="A turn still in flight — nothing condenses while it runs."
			waiting={true}
		/>
	),
};

/**
 * §5 case 3, named by design round 1 (D4a): narration only, no calls.
 *
 * Changed by the completion-visibility invariant (V1): the narration (`n1`)
 * and the answer (`a1`) are both closes of a response cycle, so both stay
 * visible and this cell now renders NO bar - there is no span left to condense.
 * The committed `narration` before/after frames under
 * `docs/evidence/chat-turn-collapse*` show the old one-bar screen and are stale.
 * The shape that still folds a narration-only span (a commentary close that is
 * not the run's last) is covered by `scripts/turn-collapse-model.test.mjs`.
 */
export const Narration: Story = {
	render: () => (
		<Frame
			transcript={narrationTurn()}
			caption="Narration between the question and the answer — no calls, so there is nothing to condense: both stay visible and no bar is drawn."
		/>
	),
};

/** §11-R4, named by design round 1 (D4b): a pinned statement in the span. */
export const Pinned: Story = {
	render: () => (
		<Frame
			transcript={pinnedTurn()}
			caption="A completion marker among the call rows — a pinned statement the collapse keeps in its own place."
		/>
	),
};

/**
 * THE OPERATOR'S CELL (2026-09-29): the condensation's spacing report. The
 * caption names the state only, so the frame reads as true on the pre-fix half
 * of the pair as well.
 */
export const PinnedCompaction: Story = {
	render: () => (
		<Frame
			transcript={compactedTurn()}
			caption="The memory statement among the call rows — the pinned row the collapsed bar keeps below its rule."
		/>
	),
};

/**
 * SECOND ROUND'S CELL (operator report, 2026-09-29): the incident reason under
 * the bar, behind its compaction. The caption names the state only, so the
 * frame reads as true on the pre-fix half of the pair as well.
 */
export const PinnedIncident: Story = {
	render: () => (
		<Frame
			transcript={incidentTurn()}
			caption="A turn that died after its compaction — the memory statement and the incident reason among the call rows."
		/>
	),
};

/**
 * D3's cell: the turn parks on the reader's gate, so nothing condenses.
 *
 * The gate is a real `PendingDesktopGate`; the question CARD itself docks
 * above the composer outside this frame (the live set's parked capture shows
 * it), and what this cell pins is the transcript's half of the same moment:
 * no bar while the turn waits.
 */
/**
 * ISSUE #5'S FRAMES: peer and wake receipts inside a completed turn -
 * collapsed here, pressed open by the capture table's second row, so the
 * design round judges the reveal of the receipts the narrowed pins hide.
 */
export const Receipts: Story = {
	render: () => (
		<Frame
			transcript={receiptsTurn()}
			caption="Peer and wake receipts among the call rows — receipts the collapsed bar now stands in for."
		/>
	),
};

export const Parked: Story = {
	render: () => (
		<Frame
			transcript={parkedTurn()}
			caption="A turn parked on an approval — the gate holds it, so nothing condenses."
			gate={PARKED_GATE}
		/>
	),
};

/**
 * THE PICTURES UNDER THE COLLAPSED BAR (operator report, 2026-09-29).
 *
 * The turned condensation answers the report's second half: a completed span
 * whose calls produced pictures keeps them visible - a thumbnail strip under
 * the bar's own line, drawn from the hidden rows' images while those rows are
 * unmounted, press-to-open through the same `ImageLightbox` every picture in
 * the app uses. The after half of the pair is this cell on this tree; the
 * before half is the same cell on the base, where the bar carries metadata
 * only and the pictures are one press away.
 */
export const Images: Story = {
	render: () => (
		<Frame
			transcript={finishedTurn(IMAGE_CALLS)}
			caption="A finished turn whose calls produced three pictures — the condensed span."
		/>
	),
};

/**
 * The overflow case, on a frame: eight pictures cost one capped row of four
 * tiles and the `+4` control (named `4 more images`), the same strip the group fold draws.
 * The capture's press row is the control's one-press reveal (U8): the bar opens
 * onto its sole group, whose strip shows the whole set.
 *
 * The caption describes the RELATIONSHIP rather than the state, because ONE
 * caption sits above both cells: the collapsed frame shows the control and the
 * press frame shows what it reaches (design round 3: the state-bound wording
 * read stale over the eight-tile cell).
 */
export const ImagesMany: Story = {
	render: () => (
		<Frame
			transcript={finishedTurn(MANY_IMAGE_CALLS)}
			caption="A span that produced eight pictures — the count control whose press reaches the whole set."
		/>
	),
};

/**
 * THE COMPLETION-VISIBILITY CELL: a fulsome completion, a wake, a short reply -
 * both completions on screen, the work between them condensed (see
 * `completionsBothVisibleTurn` for the row-by-row fixture). The caption is
 * fixture-level so it reads true on the pre-change tree too, where the fulsome
 * close is inside the bar.
 */
export const CompletionsBothVisible: Story = {
	render: () => (
		<Frame
			transcript={completionsBothVisibleTurn()}
			caption="A long run that answered, was woken, and replied again — the first completion, the wake, and the short reply."
		/>
	),
};

/**
 * THE REPORTER'S TURN IN BOTH MODES (design review round 1, D1): the pair that
 * is not allowed to match. The caption is fixture-level, so it reads true on the
 * `by-turn` half too — it names the turn, not what the frame does with it.
 */
export const SubstanceThenAddendum: Story = {
	render: () => (
		<Frame
			transcript={substanceThenAddendumTurn()}
			caption="A turn whose substance went out as prose mid-work — the prose, the two calls around it, and the addendum as the last message."
		/>
	),
};

/**
 * THE JITTER FRAME, WAKE HALF (see `midCycleTurn` for the row-by-row fixture).
 * Captured while the wake's cycle is still running, so the settled bar over the
 * first 88 calls and the whole of `A1` are both on screen beside it - the state
 * the operator's report is about. The caption is fixture-level, so it reads true
 * on the pre-change tree too, where the same rows paint expanded.
 */
export const WakeMidCycle: Story = {
	render: () => (
		<Frame
			transcript={midCycleTurn("wake")}
			caption="A turn that answered, was woken, and is running its next cycle — the first completion, the wake, and that cycle in flight as one live trace row over its three calls."
			waiting={true}
		/>
	),
};

/**
 * THE JITTER FRAME, PEER HALF: the same instant, with a peer message where the
 * wake was - the operator's own reproduction ("if a peer message or job completes
 * and the agent goes into thinking"). A peer receipt is a different hidden row
 * reaching the same rule, so the pair is what says the fix is not wake-specific.
 */
export const PeerMidCycle: Story = {
	render: () => (
		<Frame
			transcript={midCycleTurn("peer")}
			caption="The same turn, re-opened by a peer message instead — the first completion, the receipt, and the new cycle in flight as one live trace row over its three calls."
			waiting={true}
		/>
	),
};

/**
 * THE OPERATOR'S FRESH CONVERSATION (the shape the run-closure predicate change
 * is about, 2026-09-30).
 *
 * WHY THIS CELL EXISTS. The defect the predicate change fixes is only visible on
 * a conversation that has just started: the transcript's FIRST row is a harness
 * statement, not a `user` row, and `walkTurns` used to open a head-cut run on it
 * whose `openingUserIndex` was null - so the reader's own first message arrived
 * with `closed()` false, was absorbed as a STEER, and disappeared inside the very
 * first bar under the label `Steered`. The operator's report was exactly this:
 * "my initial message ended up condensed, which is unexpected". A frame is the
 * evidence for a row that was hidden and a label that was wrong, and no shipped
 * story rendered this shape (design's own finding, agent review round 1's frame
 * prerequisite), which is why the capture could not exist until this cell did.
 *
 * THE ROW IS THE ONE THE OPERATOR SAW: `session_mcp_unavailable` at level `info`
 * (`transcript-reducer.ts`'s `customRow`), the harness's MCP verdict - a
 * statement that paints and is NOT a boundary, which is why the vocabulary clause
 * alone cannot fix this shape and `nothingHasRunYet` is the clause that has to
 * (`scripts/turn-partition-predicate.test.mjs`, shape (b)).
 *
 * BUILT THROUGH THE LIVE DOOR, because that is the door a fresh conversation's
 * prefix row comes through: a harness custom has no live event of its own - the
 * `applyEvent` switch has no `custom` arm - so it arrives as a `history_delta`
 * row, the same projection `applyHistoryPage` paints (`payload.kind` is derived
 * from `custom_type` there). The reader's message and the answer then arrive as
 * ordinary live frames, stamped from the same frozen instant as every other cell
 * so the frames stay byte-reproducible.
 *
 * WHAT THE PAIR DIFFERS BY (the capture is deferred - see the PR's evidence
 * section: the disk floor aborted the sweep at 4.4 GiB free against 8 GiB). The
 * before half is this same cell on the pre-change tree, where the statement, the
 * message and the call fold into ONE bar that says `Steered` and hides the
 * reader's own sentence; after the change the statement stands on its own (an
 * empty preamble never condenses) and the reader's turn keeps its own bar over
 * its own work.
 */
const MCP_WARNING =
	"[session warning] MCP server 'minerva-qa' is unavailable: its tools are gone for now.\nReason: /mcp reauth minerva-qa — sign-in expired\nIts tools are not callable until the user restores it, and the agent should not retry them in a loop.";

const FRESH_ANSWER =
	"It is unavailable until you run the reauth command, so I will work without it.";

const freshConversationTurn = (): TranscriptState => {
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{
			type: "history_delta",
			messages: [
				{
					id: "w1",
					custom_type: "session_mcp_unavailable",
					details: { text: MCP_WARNING },
				},
			],
		},
		TS,
	);
	state = applyEvent(
		state,
		{ type: "message_start", message: userMessage("u1", QUESTION) },
		TS + 1_000,
	);
	state = runCalls(state, [CALL_B], TS + 3_000);
	state = applyEvent(
		state,
		{ type: "message_start", message: assistantMessage("a1", "") },
		TS + 9_000,
	);
	return applyEvent(
		state,
		{ type: "message_end", message: assistantMessage("a1", FRESH_ANSWER) },
		TS + 10_000,
	);
};

/**
 * The cell itself. `caption` names the fixture rather than the claim, per this
 * file's rule, so it reads true on both halves of the deferred pair.
 */
export const FreshConversation: Story = {
	render: () => (
		<Frame
			transcript={freshConversationTurn()}
			caption="A fresh conversation — the harness's MCP warning above the reader's own first message and a short answer."
		/>
	),
};
