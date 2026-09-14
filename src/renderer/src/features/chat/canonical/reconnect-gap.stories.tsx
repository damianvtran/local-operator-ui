/**
 * The transcript after a reader returns from another conversation: the rows
 * that were written while they were away, before and after the reconcile that
 * fetches them.
 *
 * WHY THIS IS A STORY BESIDE THE TEST. `scripts/reconnect-page-gap.test.mjs`
 * asserts which ids are in the transcript; a frame is the only thing that shows
 * the SEAM. The fix merges a snapshot's page with a durable tail, and the
 * failure mode a merge can introduce lives at that join — a duplicated row, a
 * row out of order, a row painted under the wrong neighbour — none of which an
 * id-set assertion would catch.
 *
 * Both transcripts below are built by the PRODUCTION reducer from wire-shaped
 * frames, the way `tool-row.stories.tsx` builds its rows, so the two frames
 * differ by the fix's own effect and nothing else:
 *
 *   - `Gap` is the transcript the client ended up with: the snapshot's page
 *     (which stops at the steering row, because the page is read through the
 *     cursor the steer refreshed) plus the live seed. The two rows written
 *     between the steer and the return are absent, so the conversation jumps
 *     from the steer straight to the live tail.
 *   - `Restored` is the same transcript once `reconcileTail` has merged the
 *     durable tail — and it is built the way that walk merges it, page by page,
 *     not as one hand-made page, because the join between two pages is the
 *     thing a frame can catch and an id-set assertion cannot.
 *   - `RestoredRunning` is the state the report is about: the reader returns
 *     while the turn is still running, so the frame also carries the working
 *     line, the running call it names, one restored call that failed, and the
 *     transport notice.
 *
 * The backend cannot close this on its own: the in-flight conversation's own
 * rows are simply not durable yet, so no cursor or page bound can carry them —
 * which is why this guard ships on the client.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useRef } from "react";
import "../../../styles/index.css";
import type { DesktopHistoryPage } from "../../../../../shared/desktop-session-contract";
import { CanonicalTranscript } from "./canonical-transcript";
import {
	EMPTY_TRANSCRIPT,
	type TranscriptState,
	applyEvent,
	applyHistoryPage,
} from "./transcript-reducer";

/** One instant for every row, so the frames are byte-reproducible. */
const TS = 1_760_000_000_000;

/**
 * When the live seed paints, one minute after the conversation's last durable
 * row — the live clock's own relationship to it.
 *
 * Not cosmetic, and the first draft of this story got it wrong: `applyEvent`
 * stamps a live record with the clock it is given, and `applyHistoryPage`
 * orders by timestamp with ties broken by the position a record already had. A
 * seed stamped at the FIRST durable row's own instant therefore ties with it,
 * and the order the reader sees then depends on whether the pages were applied
 * before or after the seed — which is exactly the kind of ordering the frame is
 * supposed to be evidence about rather than a victim of.
 */
const LIVE_AT = TS + 60_000;

/** A durable entry as the backend's `exclude_defaults` encoder writes one. */
const entry = (
	id: string,
	ts: number,
	payload: Record<string, unknown>,
): DesktopHistoryPage["entries"][number] => ({
	id,
	ts,
	type: "message",
	payload,
});

const user = (id: string, ts: number, text: string) =>
	entry(id, ts, { kind: "message", role: "user", content: [{ text }] });

const assistant = (
	id: string,
	ts: number,
	text: string,
	calls: {
		id: string;
		name: string;
		arguments: Record<string, unknown>;
	}[] = [],
) =>
	entry(id, ts, {
		kind: "message",
		role: "assistant",
		content: [{ text }],
		stop_reason: calls.length ? "toolUse" : "stop",
		// The arguments live on the ASSISTANT row, never on the tool result:
		// `applyHistoryPage` carries them across pages through `argsByCall`, and
		// a story that put them on the tool row would paint a transcript the
		// backend cannot produce.
		...(calls.length ? { tool_calls: calls } : {}),
	});

const tool = (
	id: string,
	ts: number,
	callId: string,
	toolName: string,
	output: string,
	isError = false,
) =>
	entry(id, ts, {
		kind: "message",
		role: "tool",
		tool_call_id: callId,
		tool_name: toolName,
		content: [{ text: output }],
		provider_payload: { duration_s: 0.42 },
		...(isError ? { is_error: true } : {}),
	});

/* The two calls the away-window made: the `grep` the restored pair follows, and
   a `bash` that failed, which only the running frame carries (so the pair the
   design round reviewed keeps exactly the rows it reviewed). */
type ToolCall = {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
};

const READ_CALL: ToolCall = {
	id: "call-read",
	name: "read",
	arguments: { path: "src/main/desktop-transport.ts" },
};
const GREP_CALL: ToolCall = {
	id: "call-grep",
	name: "grep",
	arguments: { pattern: "after_seq", path: "src/main" },
};
const BASH_CALL: ToolCall = {
	id: "call-bash",
	name: "bash",
	arguments: { command: "pnpm test:desktop" },
};

/**
 * The conversation, in the order it happened, anchored to the instant it is
 * handed.
 *
 * WHY IT IS A PARAMETER. `gap` and `restored` pass `BASE`, a fixed instant, so
 * those frames re-capture byte for byte. The running state passes the capture's
 * own clock: a running row's elapsed counts up to the MACHINE's clock, so a
 * frame pinned to 2025 photographs a call running from then as `100d+` — a
 * fixture artefact, not a state the app can produce. The tool-row stories pin
 * `Date.now()` offsets for the same reason.
 */
const conversationRows = (
	base: number,
	calls: ToolCall[] = [GREP_CALL],
): DesktopHistoryPage["entries"] => [
	user("m1", base, "Check the retry path in the desktop transport."),
	assistant("m2", base + 1, "Reading the transport now.", [READ_CALL]),
	tool("m3", base + 2, "call-read", "read", "…the reconnect handling…"),
	// The steering message. Its own row is durable, and the cursor the steer
	// refresh published is what bounds the snapshot's page.
	user(
		"m4",
		base + 3,
		"Also check what happens when the socket drops mid-turn.",
	),
	// Written while the reader was on another conversation.
	assistant("m5", base + 4, "Checking the reconnect path as well.", calls),
	tool("m6", base + 5, "call-grep", "grep", "desktop-transport.ts:412"),
];

const BASE = 1_760_000_000;
const CONVERSATION = conversationRows(BASE);

const PAGE = CONVERSATION.slice(0, 4);
const ABSENT = CONVERSATION.slice(4);

/** The in-flight turn's seed: the row that arrives after the return. */
const LIVE = {
	type: "message_update",
	message: {
		id: "m7",
		role: "assistant",
		content: [{ type: "text", text: "The reconnect path retries once with " }],
	},
	delta: "the retained receipt cursor.",
};

const pageOf = (
	entries: DesktopHistoryPage["entries"],
): DesktopHistoryPage => ({
	entries,
	has_more: true,
	cursor_missing: false,
});

/**
 * The transcript the reader had before the re-subscribe: the snapshot's page,
 * then the in-flight seed. `applyLiveSeed` is this same `applyEvent` loop plus
 * the generation carry, which paints no row.
 */
const gapTranscript = (): TranscriptState =>
	applyEvent(applyHistoryPage(EMPTY_TRANSCRIPT, pageOf(PAGE)), LIVE, LIVE_AT);

/**
 * The transcript the fix produces, built the way `reconcileTail` builds it:
 * the pages are applied ONE AT A TIME, newest first, exactly as the walk reads
 * them, and the last is the page the tail read already covered.
 *
 * The order is the point, not a detail. The tail read returns the newest page
 * first, which here holds the `grep` RESULT (`m6`) and not the assistant row
 * that carries its arguments — so that row is merged while `argsByCall` cannot
 * label it, and the next page back (`m5`) is what labels it. A page boundary
 * landing between those two rows is precisely the seam this pair exists to
 * photograph, and one `applyHistoryPage([...page, ...absent])` call cannot
 * produce it: that shape never has an unlabelled row to repair.
 */
/*
 * The pages here are one or two ROWS each, where `reconcileLimit` asks the
 * owner for `RECONCILE_TAIL_ENTRIES` (100) and walks back a page at a time. The
 * size is not the claim: the split is a fixture device for making the JOIN
 * visible in a still — the boundary between the tool results and the assistant
 * row that labels them — and a 100-row page would put that boundary off screen.
 */
const walkTranscript = (
	base: DesktopHistoryPage["entries"],
	pages: DesktopHistoryPage["entries"][],
	liveAt: number,
): TranscriptState => {
	let state = applyEvent(
		applyHistoryPage(EMPTY_TRANSCRIPT, pageOf(base)),
		LIVE,
		liveAt,
	);
	for (const page of pages) state = applyHistoryPage(state, pageOf(page));
	return state;
};

/** The walk's pages for the restored state: tail, the page behind it, the absorb. */
const RESTORED_WALK = [[ABSENT[1]], [ABSENT[0]], PAGE];

/**
 * The transcript as the reader sees it, captioned with what is missing.
 *
 * The caption is apparatus, `text-ink-muted` for the reason the older-history
 * slot's captions are: it describes the frame rather than being part of the
 * surface under test.
 */
const Frame = ({
	transcript,
	caption,
	waiting = false,
	status = "live",
}: {
	transcript: TranscriptState;
	caption: string;
	/** The owner is generating and nothing has painted yet for this turn. */
	waiting?: boolean;
	status?: "live" | "reconnecting";
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	return (
		// No fixed height: the frame is sized to its content, which is also how
		// the capture sizes its viewport. A taller box than the rows would put a
		// majority-ground frame in the set, and `check-evidence`'s uniformity
		// ceiling exists because a frame that is 99% one colour is not a picture
		// of the app however correct the pixels in the middle are.
		<div className="flex flex-col gap-2 bg-canvas p-6">
			<p className="text-body-sm text-ink-muted">{caption}</p>
			<div className="min-h-0 flex-1 overflow-y-auto" ref={containerRef}>
				<CanonicalTranscript
					transcript={transcript}
					gate={null}
					waiting={waiting}
					// A story cannot admit a send: this frame is about the stream's own
					// states, so the admitted-send rung is not in play here.
					starting={false}
					loadingOlder={false}
					onLoadOlder={async () => true}
					containerRef={containerRef}
					isSmallView={false}
					status={status}
					failure={null}
					/*
					 * A fixture has no session handle to re-arm: it is a static
					 * transcript for `check-evidence` to photograph. The prop is
					 * required because the SHIPPED surface must never render a failure
					 * notice without its action, and this story renders no notice at
					 * all (`failure` is null in every frame here), so this handler is
					 * unreachable rather than a stand-in for one that works.
					 */
					onReconnect={() => {}}
				/>
			</div>
		</div>
	);
};

const meta: Meta = {
	title: "Chat/Reconnect gap",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** The gap: the page's last row is the steer, and the live tail follows it. */
export const Gap: Story = {
	render: () => (
		<Frame
			caption="Before: the snapshot's page ends at the steering row. The assistant and tool rows written while the reader was on another conversation are absent, so the transcript jumps straight to the live tail."
			transcript={gapTranscript()}
		/>
	),
};

/**
 * The same transcript once the reconcile has merged the durable tail — through
 * the walk's own pages, not one page built by hand.
 */
export const Restored: Story = {
	render: () => (
		<Frame
			caption="After: the durable tail is merged in, one page at a time, so the rows between the steer and the return are present — once each, in order, with their labels."
			transcript={walkTranscript(PAGE, RESTORED_WALK, LIVE_AT)}
		/>
	),
};

/**
 * The state the report is actually about: the reader comes back WHILE the turn
 * runs. That is the one place this fix can be got wrong in a way the pair above
 * cannot show — the merge inserts rows above a turn that already has its own
 * liveness element, and a restored call that FAILED has to read as a failure
 * rather than as one more quiet ledger line.
 *
 * So this frame carries three states at once, all of them reachable by the same
 * switch back: the restored stretch with one call that succeeded and one that
 * failed (both labelled off the page BEHIND them — the labelled-after-unlabelled
 * seam), the working line for the turn still generating, the running call it
 * names, and the transport notice a reconnecting reader is looking at.
 */
export const RestoredRunning: Story = {
	render: () => {
		// Anchored to the capture, unlike the two frames above: see
		// `conversationRows`.
		const now = Date.now();
		const base = Math.floor(now / 1000) - 180;
		const rows = conversationRows(base, [GREP_CALL, BASH_CALL]);
		const settled = rows[5];
		const failed = tool(
			"m6b",
			base + 6,
			"call-bash",
			"bash",
			"exit status 1",
			true,
		);
		return (
			<Frame
				waiting
				status="reconnecting"
				caption="The case the report is about: the reader returns while the turn is still running. The restored rows are in place — including one call that failed — and the turn's own liveness line and running call sit below them, not above."
				transcript={applyEvent(
					walkTranscript(
						rows.slice(0, 4),
						// The walk's own reads: the tail, the page behind it, and then
						// the page the snapshot already painted — the one that CONNECTS,
						// which is why the walk stops here rather than at the row bound.
						[[settled, failed], [rows[4]], rows.slice(0, 4)],
						now - 60_000,
					),
					RUNNING_CALL,
					now - 2_000,
				)}
			/>
		);
	},
};

/*
 * The running call the live seed names, one step after the settle above.
 *
 * `args` is the live event's own field name, and getting it wrong is SILENT:
 * `knownArgs` reads `event.args` and falls through to the row, then the session
 * map, so a fixture keyed `arguments` paints the no-details branch — an empty
 * object column and a row box 16px narrower than every other row's, which is a
 * shape a live running call does not produce. The design round caught exactly
 * that in the first version of this frame.
 */
const RUNNING_CALL = {
	type: "tool_execution_start",
	tool_call_id: "call-live",
	tool_name: "bash",
	intent: "re-running the transport suite",
	args: { command: "pnpm test:desktop" },
};
