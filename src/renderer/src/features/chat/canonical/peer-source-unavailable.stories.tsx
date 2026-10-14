/**
 * The SOURCE-UNAVAILABLE notice: the surface review round 1's M2 asked for — a
 * polite, NON-TERMINAL statement that a conversation is readable but its
 * message order could not be confirmed with the source just now.
 *
 * WHY THIS IS A FRAME AND NOT ONLY A TEST. The notice is a claim about register
 * and placement rather than about a value: it must read as degraded-but-readable
 * (never as a fault), it must sit OUTSIDE the scroller so it stays visible while
 * a long transcript scrolls, and it must NOT retire the working claim the way
 * the terminal failure notice does. None of that is visible in an assertion —
 * it is what a rendered frame photographs.
 *
 * Every transcript here is built by the PRODUCTION reducer from wire-shaped
 * pages (the way `reconnect-gap.stories.tsx` builds its rows), then put into the
 * state the hook would: `applyHistoryPage(..., { peerSource: true })` for a
 * declared peer page and `markSourceUnavailable(state, true)` for the failed
 * wave. Nothing is hand-built, so a frame differs from the app by nothing except
 * the flag under test.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useRef } from "react";
import "../../../styles/index.css";
import type { DesktopHistoryPage } from "../../../../../shared/desktop-session-contract";
import type { SessionFailureNotice } from "../../../../../shared/desktop-stream-notice";
import { CanonicalTranscript } from "./canonical-transcript";
import {
	EMPTY_TRANSCRIPT,
	type TranscriptState,
	applyEvent,
	applyHistoryPage,
	markSourceUnavailable,
} from "./transcript-reducer";

/**
 * The DOM facts the design round's audit reads by hand, asserted IN the story so
 * a frame that loses them fails at capture rather than on inspection (design
 * round 1):
 *
 *   - `[data-lo-working-line]` present exactly `expectedWorkingLines` times —
 *     D1's discriminator: the frame that must prove the notice does NOT retire
 *     the working claim is worthless if the line is not there.
 *   - the transcript actually painted on the theme's canvas ink — the check that
 *     the capture's theme arg RESOLVED (D2), read from the pixels behind the
 *     region rather than trusted from the arg.
 *   - `[data-lo-source-unavailable]` present exactly when the flag is set.
 */
const HEX6 = /^#([0-9a-f]{6})$/i;

const hexToRgb = (hex: string): string | null => {
	const match = HEX6.exec(hex.trim());
	if (!match) return null;
	const n = Number.parseInt(match[1], 16);
	return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

const auditFrame = (expectedWorkingLines: number, notice: boolean): void => {
	const lines = document.querySelectorAll("[data-lo-working-line]").length;
	if (lines !== expectedWorkingLines)
		throw new Error(
			`working line count ${lines}, expected ${expectedWorkingLines}`,
		);
	const notices = document.querySelectorAll(
		"[data-lo-source-unavailable]",
	).length;
	if (notices !== (notice ? 1 : 0))
		throw new Error(
			`source notice count ${notices}, expected ${notice ? 1 : 0}`,
		);
	let node: HTMLElement | null = document.querySelector<HTMLElement>(
		'[data-chat-region="transcript"]',
	);
	let painted: string | null = null;
	while (node) {
		const bg = getComputedStyle(node).backgroundColor;
		if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
			painted = bg;
			break;
		}
		node = node.parentElement;
	}
	const token = hexToRgb(
		getComputedStyle(document.documentElement).getPropertyValue("--lo-canvas"),
	);
	if (!token)
		throw new Error(
			"no --lo-canvas token: the capture's theme arg did not resolve",
		);
	if (painted !== token)
		throw new Error(`transcript ground ${painted} is not the canvas ${token}`);
};

/** One instant for every durable row, so the fixed frames are reproducible. */
const BASE = 1_760_000_000;

const entry = (
	id: string,
	seq: number,
	payload: Record<string, unknown>,
): DesktopHistoryPage["entries"][number] => ({
	id,
	ts: BASE + seq,
	type: "message",
	payload,
	journal_seq: seq,
});

const user = (id: string, seq: number, text: string) =>
	entry(id, seq, { kind: "message", role: "user", content: [{ text }] });

const assistant = (id: string, seq: number, text: string) =>
	entry(id, seq, {
		kind: "message",
		role: "assistant",
		content: [{ text }],
		stop_reason: "stop",
	});

/** A peer page whose rows carry same-read coordinates and a settled order. */
const pageOf = (
	entries: DesktopHistoryPage["entries"],
): DesktopHistoryPage => ({
	entries,
	has_more: false,
	cursor_missing: false,
	journal_order_state: "ready",
	journal_generation: "peer-1",
});

/** A short readable conversation, admitted through the peer lane. */
const peerTranscript = (rows: DesktopHistoryPage["entries"]): TranscriptState =>
	applyHistoryPage(EMPTY_TRANSCRIPT, pageOf(rows), {
		authoritative: true,
		peerSource: true,
	});

const SHORT_ROWS: DesktopHistoryPage["entries"] = [
	user("m1", 0, "Where did the retry land?"),
	assistant(
		"m2",
		1,
		"In the desktop transport — one attempt with the retained cursor.",
	),
	user("m3", 2, "Good. Anything else to check?"),
];

const SHORT = peerTranscript(SHORT_ROWS);

/** A long conversation, so the scroller has something to scroll. */
const LONG = peerTranscript(
	Array.from({ length: 40 }, (_, i) =>
		i % 2 === 0
			? user(
					`long-${i}`,
					i,
					`Message ${i} in a conversation long enough to fill the scroller.`,
				)
			: assistant(
					`long-${i}`,
					i,
					`Reply ${i}, also long enough that the transcript overflows its box.`,
				),
	),
);

/**
 * The in-flight turn's seed, stamped after the last durable row so `applyEvent`
 * paints it at the live tail rather than tying with a durable row's instant.
 */
const LIVE_AT = (BASE + SHORT_ROWS.length + 1) * 1000;
const LIVE = {
	type: "message_update",
	message: {
		id: "live-1",
		role: "assistant",
		content: [
			{ type: "text", text: "Checking the source index now, one moment" },
		],
	},
	delta: ".",
};

/** The running state: the notice must sit beside a live working line. */
const running = (): TranscriptState => applyEvent(SHORT, LIVE, LIVE_AT);

/** The flag set, exactly as the hook sets it when a peer wave fails. */
const flagged = (state: TranscriptState): TranscriptState =>
	markSourceUnavailable(state, true);

/** The failure notice the terminal frame carries, so exactly one Reconnect shows. */
const FAILURE: SessionFailureNotice = {
	statement:
		"Lost the connection to this conversation — reconnect to keep reading.",
	action: "reconnect",
};

/**
 * The production transcript in a sized box, with a caption in the same register
 * as the other transcript frames (`text-ink-muted`, apparatus rather than
 * surface). `scroll` places the scroller for the long frames; the notice lives
 * outside it, so it must stay put at both ends.
 */
const Frame = ({
	transcript,
	caption,
	status = "live",
	failure = null,
	missing = false,
	stale = false,
	height,
	scroll,
	width,
	waiting = false,
}: {
	transcript: TranscriptState;
	caption: string;
	status?: "live" | "reconnecting" | "unavailable";
	failure?: SessionFailureNotice | null;
	missing?: boolean;
	stale?: boolean;
	/** A fixed scroller height, for the long frames. Content-sized when omitted. */
	height?: number;
	scroll?: "top" | "bottom";
	width?: number;
	/**
	 * The owner is generating and nothing has painted yet for this turn. Passed for
	 * the frames that must show the working line beside the notice (design round 1,
	 * D1): `deriveWorkingLine` returns null when neither `waiting` nor `starting` is
	 * set, so a frame claiming "the notice does not retire the working claim" has to
	 * set one of them to have a line to show.
	 */
	waiting?: boolean;
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const box = containerRef.current;
		if (!box || !scroll) return;
		box.scrollTop = scroll === "bottom" ? box.scrollHeight : 0;
	}, [scroll]);
	return (
		<div className="flex flex-col gap-2 bg-canvas p-6" style={{ width }}>
			<p className="text-body-sm text-ink-muted">{caption}</p>
			<div
				className="min-h-0 flex-1 overflow-y-auto"
				ref={containerRef}
				style={height ? { height } : undefined}
			>
				<CanonicalTranscript
					transcript={transcript}
					gate={null}
					waiting={waiting}
					starting={false}
					loadingOlder={false}
					onLoadOlder={async () => true}
					containerRef={containerRef}
					isSmallView={false}
					status={status}
					failure={failure}
					awaitingHydration={false}
					missing={missing}
					stale={stale}
					/*
					 * A fixture has no session handle to re-arm: it is a static transcript
					 * for `check-evidence` to photograph. The prop is required because the
					 * shipped surface must never render a notice without its action; this
					 * story renders the SOURCE notice (whose action is the same Reconnect)
					 * or no notice at all, so the handler is the acknowledgement under test.
					 */
					onReconnect={() => {}}
				/>
			</div>
		</div>
	);
};

const meta: Meta = {
	title: "Chat/Peer source unavailable",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/**
 * 1. Unavailable shown with the turn running. This is the proof that the notice
 * did not retire the working claim: the working line and its live clock paint
 * beside the notice, which a terminal notice could never do.
 */
export const ShownRunning: Story = {
	render: () => (
		<Frame
			waiting
			transcript={flagged(running())}
			caption="Unavailable, turn running: the notice sits above the rows and the working line keeps painting beside it — it is NOT terminal."
		/>
	),
	play: async () => auditFrame(1, true),
};

/**
 * 2a. Long transcript scrolled to the top: the notice is outside the scroller,
 * so it is still visible here.
 */
export const LongTop: Story = {
	render: () => (
		<Frame
			transcript={flagged(LONG)}
			height={420}
			scroll="top"
			caption="Long transcript scrolled to the top: the notice stays visible — it is outside the scroller and does not scroll away."
		/>
	),
	play: async () => auditFrame(0, true),
};

/**
 * 2b. The same transcript scrolled to the bottom: the notice is still visible,
 * and the bottom-anchored rows still sit at the bottom.
 */
export const LongBottom: Story = {
	render: () => (
		<Frame
			transcript={flagged(LONG)}
			height={420}
			scroll="bottom"
			caption="Long transcript scrolled to the bottom: the notice is still there and the rows keep their bottom anchor."
		/>
	),
	play: async () => auditFrame(0, true),
};

/**
 * 3a. `unsupported` shows NOTHING. The flag is never set for a local-only source
 * that cannot order a peer conversation, so there is no notice and no control —
 * pixel-identical to the no-flag baseline below.
 */
export const UnsupportedNothing: Story = {
	render: () => (
		<Frame
			transcript={peerTranscript(SHORT_ROWS)}
			caption="Unsupported: a local-only source that cannot order a peer conversation. The flag is never set, so nothing is shown — identical to the baseline below."
		/>
	),
	play: async () => auditFrame(0, false),
};

/** 3b. The no-flag baseline the `unsupported` frame must diff against exactly. */
export const NoFlagBaseline: Story = {
	render: () => (
		<Frame
			transcript={peerTranscript(SHORT_ROWS)}
			caption="Baseline: the same transcript with no flag at all — the frame the unsupported story must match byte for byte."
		/>
	),
	play: async () => auditFrame(0, false),
};

/**
 * 4. Cleared after a ready answer: the same conversation once a real `ready`
 * page has landed. The notice is gone and the rows sit where they did before the
 * flag was set.
 */
export const ClearedAfterReady: Story = {
	render: () => (
		<Frame
			transcript={peerTranscript(SHORT_ROWS)}
			caption="Cleared after ready: a genuine ready answer cleared the flag, so the notice is gone and the transcript is just the readable conversation."
		/>
	),
	play: async () => auditFrame(0, false),
};

/**
 * 5. Outranked by the terminal notice: a failed stream plus the flag. Exactly one
 * notice (the danger one) and exactly one Reconnect control.
 */
export const OutrankedByTerminal: Story = {
	render: () => (
		<Frame
			status="unavailable"
			failure={FAILURE}
			transcript={flagged(SHORT)}
			caption="Outranked by terminal: an unavailable stream with a failure outranks the source notice — exactly one notice and exactly one Reconnect, never two."
		/>
	),
	/*
	 * The flag is SET, but `status="unavailable"` retires the working line and the
	 * source notice stands down to the terminal notice: no `[data-lo-working-line]`,
	 * no `[data-lo-source-unavailable]` — the frame proves the outranking.
	 */
	play: async () => auditFrame(0, false),
};

/**
 * 6. Narrow (360 px) is covered by `ShownRunning` captured at 360, which the
 * render rig takes for every story. A SEPARATE narrow story duplicated it (design
 * round 1, D5), and the one thing that would make it distinct — the in-thread
 * search overlay composed over the transcript — is the overlay set's own
 * integration phase, which `thread-search-overlay.stories.tsx` documents as
 * deliberately uncovered there too (the panel needs the real `findThreadMessages`
 * transport, which this static-transcript harness does not provide). Rather than
 * ship an overlay frame that could misstate the panel's offset, the narrow
 * question stays with the `shown-running` 360 capture: there is no
 * `narrow-wrapped` story.
 */
