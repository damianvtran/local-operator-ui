import { useConversationInputStore } from "@shared/store/conversation-input-store";
import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useRef } from "react";
import { MessageInput } from "../components/message-input";
import type { Message } from "../types/message";
import "../components/story-electron-shim";
import { CanonicalTranscript } from "./canonical-transcript";
import type { TranscriptRecord, TranscriptState } from "./transcript-reducer";

/*
 * The quote affordance, on the production transcript and beside the production
 * composer.
 *
 * WHY A STORY AND NOT ONLY A LIVE RUN. The claims here are about the wiring
 * between three shipped pieces - the row's control, the conversation input
 * store, and the composer's own `ReplyPreview` above it - and that wiring is a
 * property of the components rather than of one session's data. A live run
 * proves it too, but only on whatever transcript that run happened to open; a
 * story holds the same claim still, in every palette, from the diff alone.
 *
 * WHAT A `play` FUNCTION CAN AND CANNOT DRIVE HERE. `play` cannot produce a
 * real drag: `userEvent` dispatches synthetic pointer events, and a synthetic
 * mousedown does not make the browser build a selection. So the stories that
 * need a highlight to press the control build one through the DOM's own
 * `Selection` API (`highlightRow`), which is a real selection object read back
 * by the shipped component - the control only appears if the component agrees a
 * highlight exists, so a frame from these stories is still a statement about
 * the gate. What they cannot show is that a READER'S GESTURE raises it: the
 * mouse path (drag, double-click, shift+click) and the keyboard path
 * (shift+arrows) are driven by the evidence rig with real
 * `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`
 * (`scripts/capture-evidence.mjs`'s `select` option, over this same story set),
 * which is the dispatch that exercises the path under test. The resting frames
 * these stories produce on their own - and the hovered one the rig takes with
 * its own pointer - are the half that shows the operator's first ask: a turn
 * under the pointer with nothing highlighted shows nothing at all.
 */

const conversationId = "story";

const reply = (text: string) => `<reply-to>${text}</reply-to>`;

const record = (
	id: string,
	kind: "user" | "assistant",
	text: string,
): TranscriptRecord =>
	kind === "user"
		? { kind, id, ts: 1_760_000_000_000, text, images: [] }
		: {
				kind,
				id,
				ts: 1_760_000_000_001,
				text,
				reasoning: "",
				streaming: false,
				stopReason: null,
				error: false,
				complete: true,
			};

function transcriptOf(records: TranscriptRecord[]): TranscriptState {
	return {
		records,
		index: new Map(records.map((entry, position) => [entry.id, position])),
	} as TranscriptState;
}

/** The pane's own sentinel, as `chat-content.tsx` hands it one. */
const NONEMPTY: Message[] = [
	{ id: "canonical", role: "system", timestamp: new Date(0) },
];

/**
 * A multi-paragraph answer, as a turn body actually is.
 *
 * The SHAPE is the point of this fixture. The quote path deliberately does not
 * truncate, so a quoted turn is routinely several paragraphs, and the scan that
 * takes the markup back out has to cross a newline to find the block. A
 * single-line fixture exercises the one shape that worked while the scan was
 * broken, which is why the frames built on one could not fail on the defect.
 */
const ANSWER = [
	"Because that row's `tenant_id` was null, and the new column is `not null`.",
	"",
	"The other four hundred rows were fine.",
].join("\n");

/**
 * A conversation that already contains a quoted turn and an answer to it.
 *
 * The user row's `text` is the payload `buildSendPayload` assembles at the send
 * boundary - `<reply-to>` markup and the words, one string - because that is
 * what the transcript is handed and what the row has to render as a quote. The
 * quote it carries is `ANSWER`, so the frame is built from the multi-line case
 * rather than from the one-line case that used to stand in for it.
 */
const CONVERSATION: TranscriptRecord[] = [
	record("u1", "user", `${reply(ANSWER)}\nWhy did it fail there?`),
	record(
		"a1",
		"assistant",
		`${ANSWER}\n\nSo the answer is the same for the rest of them.`,
	),
];

/**
 * The same conversation with enough above it to overflow the pane.
 *
 * The frame the FLIP is judged from: a highlight on the oldest turn of a
 * scrolled transcript sits at the pane's own top edge, where there is no room
 * above it, so the control has to go below the highlight instead. Four turns of
 * two paragraphs is more than the pane holds at the height these stories ask
 * for, which is what makes the scroll - and therefore the flip - reachable at
 * all: on a two-turn fixture every row is on screen and the state cannot be
 * produced however the rig drives it.
 */
const TALL_CONVERSATION: TranscriptRecord[] = [
	record("u1", "user", "The migration failed on the second row. Why?"),
	record(
		"a1",
		"assistant",
		`${ANSWER}\n\nSo the answer is the same for the rest.`,
	),
	record("u2", "user", "And what about the four hundred after it?"),
	record("a2", "assistant", `They were fine.\n\n${ANSWER}`),
	record("u3", "user", "Did the backfill keep the old ids?"),
	record("a3", "assistant", `It did.\n\n${ANSWER}`),
];

/**
 * Clear the staged chips before every story.
 *
 * The conversation input store is `persist`ed, so a story that left chips
 * behind would hand the next one a composer with a quote already in it, and the
 * frame would show a state the story did not produce.
 */
function useCleanReplies() {
	useEffect(() => {
		useConversationInputStore.getState().clearReplies(conversationId);
	}, []);
}

/**
 * The transcript pane at a height that makes its OWN scroller the scrolling
 * element.
 *
 * `height` is the transcript pane's box, not the story's: the composer below it
 * is a sibling, and the pane takes the rest of the column. That matters for
 * more than tidiness. The pane's scroller is the element the control is clamped
 * inside (`quote-anchor.ts`), and a wrapper that scrolled INSTEAD of it would
 * leave the clamp asking a box as tall as its own content - the story would
 * then photograph a clamp that the app never applies.
 */
const Frame = ({
	records,
	height = 620,
}: {
	records: TranscriptRecord[];
	height?: number;
}) => {
	useCleanReplies();
	const containerRef = useRef<HTMLDivElement>(null);
	return (
		<div className="flex flex-col bg-canvas" style={{ width: 1024, height }}>
			<div className="flex min-h-0 grow flex-col px-4 pt-4">
				<CanonicalTranscript
					transcript={transcriptOf(records)}
					frontend={null}
					gate={null}
					waiting={false}
					starting={false}
					loadingOlder={false}
					onLoadOlder={async () => true}
					containerRef={containerRef}
					isSmallView={false}
					status="live"
					failure={null}
					awaitingHydration={false}
					/*
					 * The same identity the composer below reads its replies by. The two
					 * are one value in the app (`chat-content.tsx` hands both of them its
					 * local `conversationId` const), and a story that gave them different
					 * ones would photograph a Quote press that goes nowhere.
					 */
					conversationId={conversationId}
					onReconnect={() => {}}
				/>
			</div>
			<div className="shrink-0 p-4 pt-0">
				<MessageInput
					isLoading={false}
					messages={NONEMPTY}
					conversationId={conversationId}
					onSendMessage={async () => true}
				/>
			</div>
		</div>
	);
};

const rowOf = (rowId: string) =>
	document.querySelector(`[data-record-id="${rowId}"]`);

/** The row's text nodes in document order, as one string with offsets. */
function rowText(row: Element) {
	const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
	const nodes: { node: Text; start: number; end: number }[] = [];
	let at = 0;
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const text = node as Text;
		nodes.push({ node: text, start: at, end: at + text.data.length });
		at += text.data.length;
	}
	return { nodes, length: at };
}

function pointAt(row: Element, offset: number) {
	const { nodes } = rowText(row);
	for (const entry of nodes) {
		if (offset <= entry.end) {
			return { node: entry.node, offset: offset - entry.start };
		}
	}
	const last = nodes[nodes.length - 1];
	return { node: last.node, offset: last.node.data.length };
}

/**
 * Highlight characters `[from, to)` of a row, the way a `play` function has to.
 *
 * A REAL `Selection` object built through the DOM's own API, from the row's
 * live text nodes - so it is the same thing the shipped component reads back
 * out of `window.getSelection()`, and the control appears only if the component
 * agrees it is a highlight of ITS turn. What it is not is a gesture: see this
 * file's header for why the mouse and keyboard paths are the rig's, not a
 * `play` function's.
 */
async function highlightRow(rowId: string, from = 0, to = 60) {
	const row = rowOf(rowId);
	if (!row) throw new Error(`no row ${rowId}`);
	const range = document.createRange();
	const start = pointAt(row, from);
	const end = pointAt(row, to);
	range.setStart(start.node, start.offset);
	range.setEnd(end.node, end.offset);
	const selection = window.getSelection();
	if (!selection) throw new Error("no Selection API in this browser");
	selection.removeAllRanges();
	selection.addRange(range);
	// Belt and braces: a programmatic selection does fire `selectionchange` in
	// Chromium, and the component's gate reads the selection itself rather than
	// trusting the event, so a dispatched one only removes the wait for it.
	document.dispatchEvent(new Event("selectionchange"));
	await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
}

/**
 * Press the row's own Quote control, the way a reader does.
 *
 * The button rather than the store action, for the reason `canonical-notice`
 * clicks its disclosure trigger: a story that wrote `addReply` directly would
 * keep passing after the control stopped reaching the store, which is the one
 * thing these frames exist to check.
 *
 * IT HIGHLIGHTS FIRST, and it throws if no control appears, because the control
 * is now raised by a highlight and a missing one would otherwise be a silently
 * empty frame. A story that pressed a control which was not there would pass
 * against a component that had stopped staging anything.
 *
 * IT DELIBERATELY DOES NOT CLEAR FIRST (design round 1, D1; QA round 1, Q4).
 * It used to call `clearReplies` before every press, which meant the second
 * press wiped the first chip and `TwoQuotesStaged` rendered ONE chip reading
 * the second row's words - the exact opposite of what its docstring claimed to
 * prove, and a frame that would have stayed green through a regression making
 * the second press replace the first. The mount-time `useCleanReplies` on
 * `Frame` is what keeps story order from leaking; within a story, presses must
 * append the way the product does.
 */
function pressQuote(rowId: string, from = 0, to = 60) {
	return async () => {
		await highlightRow(rowId, from, to);
		const control = rowOf(rowId)?.querySelector(
			"[data-lo-quote-toolkit] button",
		);
		if (!control) {
			throw new Error(`no quote control appeared on row ${rowId}`);
		}
		(control as HTMLButtonElement).click();
	};
}

const meta: Meta = {
	title: "Chat/Canonical quote",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/**
 * A turn that was SENT as a reply, rendered from its own payload.
 *
 * This is the frame the raw-markup defect fails, and the fixture is built to
 * earn that: the quoted turn below is multi-paragraph, so the scan has to cross
 * a newline to find the block. While the scan was not dotall, `parseReplies`
 * matched nothing here and this row painted `<reply-to>...</reply-to>` as
 * literal text at reading weight - the single-line quote this story used to
 * carry could not fail that way, which is exactly why it did not catch it.
 * After the fix the tags are transport again: the block above the question is
 * the same recessed `ReplyPreview` the composer stages.
 */
export const SentTurnQuote: Story = {
	render: () => <Frame records={CONVERSATION} />,
};

/**
 * The same conversation with the assistant row quoted.
 *
 * `play` highlights that row and presses its Quote control, so the frame shows
 * what the reader sees next: the highlighted part staged above the composer,
 * with the remove affordance beside it.
 */
export const StagedQuote: Story = {
	render: () => <Frame records={CONVERSATION} />,
	play: async () => pressQuote("a1", 0, 52)(),
};

/**
 * Two quotes staged from two rows: the list stacks, and each is its own chip.
 *
 * Driven through the row controls as well, so the second press is proven to
 * append rather than replace - which is a claim this story could not previously
 * make, because its own `pressQuote` cleared the list before each press and the
 * frame showed the second row's words alone.
 */
export const TwoQuotesStaged: Story = {
	render: () => <Frame records={CONVERSATION} />,
	play: async () => {
		await pressQuote("a1", 0, 52)();
		await pressQuote("u1", 0, 52)();
	},
};

/**
 * The tall conversation, for the state a short one cannot produce: a highlight
 * on the pane's own top edge.
 *
 * Nothing is highlighted here. The rig scrolls the oldest turn to the top of
 * the pane and drags across it, which is the frame the flip is judged from -
 * see this file's header for why that gesture is the rig's rather than a
 * `play` function's.
 */
export const ScrolledToOldestTurn: Story = {
	render: () => <Frame records={TALL_CONVERSATION} height={520} />,
};
