/**
 * The transcript's copy surfaces, in the states a still frame has to show.
 *
 * WHY PLAY FUNCTIONS, UNLIKE `message-actions.stories.tsx`. The states in this
 * set ARE interactions: a context menu is only open after a right-click, a
 * selection toolbar only exists after a highlight, and the gutter control is
 * only visible while its message holds focus or hover. The capture rig drives
 * real pointer/keyboard gestures where it can, but a context menu closes on the
 * pointer leaving the item, so the frame has to be taken with the story's own
 * play step holding it open. The play step is the product's own event
 * (`fireEvent.contextMenu` / a real selection + `mouseup`), never a CSS class
 * pretending to be the state.
 *
 * FIXTURES ARE DELIBERATELY SMALL. One turn with a reader message, an
 * intermediate settled answer, a ledger run and a closing answer is enough to
 * photograph every new surface without re-rendering the larger sets'
 * fixtures.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { fireEvent, waitFor } from "@storybook/test";
import { useRef } from "react";
import type { DesktopHistoryPage } from "../../../../../shared/desktop-session-contract";
import { CanonicalTranscript } from "./canonical-transcript";
import {
	EMPTY_TRANSCRIPT,
	type TranscriptRecord,
	type TranscriptState,
	applyHistoryPage,
} from "./transcript-reducer";

const TS = 1_760_000_000_000;
const CONVERSATION = "story-conversation";

const NARRATION =
	"I will read the half-written table first, then answer the row question from what the source actually sends.";

const ANSWER = [
	"The row is not malformed, it is absent: the source writes an empty string where the schema's `not null` assumes a value.",
	"",
	"- **Coerce at the boundary.** Map `''` to `NULL` in the extract step.",
	"- **Relax the constraint.** A default of `''` accepts the file as it is.",
].join("\n");

const user = (id: string, text: string): TranscriptRecord => ({
	kind: "user",
	id,
	ts: TS,
	text,
	images: [],
});

const answer = (id: string, text: string, ts: number): TranscriptRecord => ({
	kind: "assistant",
	id,
	ts,
	text,
	streaming: false,
	complete: true,
	stopReason: null,
	error: false,
});

const transcriptOf = (records: TranscriptRecord[]): TranscriptState =>
	({
		records,
		index: new Map(records.map((entry, position) => [entry.id, position])),
	}) as TranscriptState;

/** The before-frame's turn: one question, an intermediate answer, the closing one. */
const MULTI_ANSWER = transcriptOf([
	user("u1", "Is the March import finished?"),
	answer("a1", NARRATION, TS + 2_000),
	answer("a2", ANSWER, TS + 60_000),
]);

/**
 * A turn whose ledger run folds: the reader message, three calls, the answer.
 * Built through the durable path because the fold's span and the turn bar are
 * derived from that page, not from a hand-built record list.
 */
const foldedTurn = (): TranscriptState => {
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
				content: [{ text: "Is the March import finished?" }],
			}),
			entry("t1", S + 2, {
				kind: "message",
				role: "tool",
				tool_call_id: "c1",
				tool_name: "read",
				content: [{ type: "text", text: "src/invoices/query.ts\n" }],
				provider_payload: { duration_s: 0.4, details: {} },
			}),
			entry("t2", S + 6, {
				kind: "message",
				role: "tool",
				tool_call_id: "c2",
				tool_name: "bash",
				content: [{ type: "text", text: "tests 40\npass 40\n" }],
				provider_payload: { duration_s: 12.5, details: {} },
			}),
			entry("t3", S + 9, {
				kind: "message",
				role: "tool",
				tool_call_id: "c3",
				tool_name: "bash",
				content: [{ type: "text", text: "build 12s\n" }],
				provider_payload: { duration_s: 12.1, details: {} },
			}),
			entry("a1", S + 70, {
				kind: "message",
				role: "assistant",
				content: [{ text: ANSWER }],
				stop_reason: "stop",
			}),
		],
		has_more: false,
		cursor_missing: false,
	});
};

const Frame = ({
	state,
	width = 1024,
}: {
	state: TranscriptState;
	width?: number;
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	return (
		<div className="flex flex-col bg-canvas" style={{ width, height: 620 }}>
			<div className="flex min-h-0 grow flex-col px-4 pt-4">
				<CanonicalTranscript
					transcript={state}
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
					onReconnect={() => {}}
					conversationId={CONVERSATION}
				/>
			</div>
		</div>
	);
};

/** The row the play steps address, by the only id a frame can trust. */
const row = (canvasElement: HTMLElement, id: string) => {
	const node = canvasElement.querySelector<HTMLElement>(
		`[data-record-id="${id}"]`,
	);
	if (node === null) throw new Error(`row ${id} is not on screen`);
	return node;
};

/** Select the first text node inside `root` and dispatch the real mouseup. */
const selectText = async (root: HTMLElement) => {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const text = walker.nextNode();
	if (text === null) throw new Error("the fixture has no text node");
	const range = document.createRange();
	range.selectNodeContents(text);
	const selection = window.getSelection();
	if (selection === null) throw new Error("the browser exposes no selection");
	selection.removeAllRanges();
	selection.addRange(range);
	document.dispatchEvent(
		new MouseEvent("mouseup", { bubbles: true, cancelable: true }),
	);
	await waitFor(() => {
		if (document.querySelector("[data-lo-quote-toolkit]") === null) {
			throw new Error("the selection strip did not mount");
		}
	});
};

const meta: Meta = {
	title: "Chat/Canonical transcript copy",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** The resting multi-answer turn: no action line under the intermediate prose. */
export const Resting: Story = {
	render: () => <Frame state={MULTI_ANSWER} />,
};

/** Right-click on a prose line: the menu opens over that line's own text. */
export const ContextMenuOnProse: Story = {
	render: () => <Frame state={MULTI_ANSWER} />,
	play: async ({ canvasElement }) => {
		const prose =
			row(canvasElement, "a1").querySelector(".lo-markdown") ??
			row(canvasElement, "a1");
		fireEvent.contextMenu(prose, { clientX: 120, clientY: 120 });
		await waitFor(() => {
			if (document.querySelector("[data-lo-copy-menu]") === null) {
				throw new Error("the context menu did not open");
			}
		});
	},
};

/** Right-click on a ledger call, after the reader has opened its two folds. */
export const ContextMenuOnToolRow: Story = {
	render: () => <Frame state={foldedTurn()} />,
	play: async ({ canvasElement }) => {
		const bar = canvasElement.querySelector<HTMLElement>(
			'[data-turn-summary] button[aria-expanded="false"]',
		);
		if (bar !== null) fireEvent.click(bar);
		await waitFor(() => {
			if (canvasElement.querySelector("[data-fold-ids]") === null) {
				throw new Error("the ledger fold did not mount");
			}
		});
		const foldTrigger = canvasElement.querySelector<HTMLElement>(
			'[data-fold-ids] button[aria-expanded="false"]',
		);
		if (foldTrigger !== null) fireEvent.click(foldTrigger);
		await waitFor(() => {
			if (canvasElement.querySelector('[data-record-kind="tool"]') === null) {
				throw new Error("the tool row did not mount");
			}
		});
		const toolRow = canvasElement.querySelector('[data-record-kind="tool"]');
		if (toolRow === null) throw new Error("the tool row did not mount");
		fireEvent.contextMenu(toolRow, { clientX: 120, clientY: 160 });
		await waitFor(() => {
			if (document.querySelector("[data-lo-copy-menu]") === null) {
				throw new Error("the context menu did not open");
			}
		});
	},
};

/** The reader's own message holding focus: its gutter control is revealed. */
export const FocusedGutter: Story = {
	render: () => <Frame state={MULTI_ANSWER} />,
	play: async ({ canvasElement }) => {
		row(canvasElement, "u1").focus();
	},
};

/** A partial selection: ONE strip carries Quote, Copy and Speak over it. */
export const SelectionToolbar: Story = {
	render: () => <Frame state={MULTI_ANSWER} />,
	play: async ({ canvasElement }) => {
		const prose = row(canvasElement, "a2").querySelector(".lo-markdown");
		if (prose === null) throw new Error("the closing answer has no prose");
		const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT);
		const text = walker.nextNode();
		if (text === null) throw new Error("the answer has no text node");
		const range = document.createRange();
		range.selectNodeContents(text);
		const selection = window.getSelection();
		if (selection === null) throw new Error("the browser exposes no selection");
		selection.removeAllRanges();
		selection.addRange(range);
		document.dispatchEvent(
			new MouseEvent("mouseup", { bubbles: true, cancelable: true }),
		);
		await waitFor(() => {
			if (document.querySelector("[data-lo-quote-toolkit]") === null) {
				throw new Error("the selection strip did not mount");
			}
		});
		await waitFor(() => {
			if (document.querySelector("[data-lo-selection-toolbar]") !== null) {
				throw new Error("a second selection strip is painted");
			}
		});
	},
};

/**
 * A selection on the intermediate response WHILE its own gutter is up.
 *
 * This is the collision state round-2 review named: the response row's Copy
 * overlay and the selection strip both want the same outer-gutter seat. The
 * row is focused first so its gutter would be interactive, then the highlight
 * is made; the frame must show one strip and an inert/aria-hidden gutter.
 */
export const SelectionToolbarResponseFocused: Story = {
	render: () => <Frame state={MULTI_ANSWER} />,
	play: async ({ canvasElement }) => {
		const response = row(canvasElement, "a1");
		response.focus();
		const prose = response.querySelector(".lo-markdown") ?? response;
		await selectText(prose as HTMLElement);
		await waitFor(() => {
			if (document.querySelector("[data-lo-quote-toolkit]") === null) {
				throw new Error("the selection strip did not mount");
			}
		});
		await waitFor(() => {
			const gutter = response.querySelector("[data-lo-gutter-actions]");
			if (gutter === null) return;
			if (
				!gutter.hasAttribute("inert") ||
				gutter.getAttribute("aria-hidden") !== "true"
			) {
				throw new Error("the response gutter is still interactive");
			}
		});
	},
};

/**
 * A selection at the TOP edge: no room above it, so the strip must flip BELOW.
 *
 * A LONG transcript is needed to make the edge real: the pane is scrolled so
 * the selected line sits at the scroller's top, under the 16px padding, where
 * the 32px strip plus its gap cannot fit above. The short fixture always has
 * room above (and would prove only the other direction).
 */
const LONG_TOP_EDGE = transcriptOf(
	Array.from({ length: 8 }, (_, index) => [
		user(`u${index}`, `Question ${index + 1}`),
		answer(
			`a${index}`,
			`Answer ${index + 1}: ${NARRATION}`,
			TS + index * 2_000 + 1_000,
		),
	]).flat(),
);

export const SelectionToolbarTopEdge: Story = {
	render: () => <Frame state={LONG_TOP_EDGE} />,
	play: async ({ canvasElement }) => {
		const prose = row(canvasElement, "a0").querySelector(".lo-markdown");
		if (prose === null) throw new Error("the opening answer has no prose");
		prose.scrollIntoView({ block: "start" });
		await selectText(prose as HTMLElement);
	},
};

/** A narrow pane: no outer gutter, so the strip flips above the selection. */
export const SelectionToolbarNarrow: Story = {
	render: () => <Frame state={MULTI_ANSWER} width={480} />,
	play: async ({ canvasElement }) => {
		const prose = row(canvasElement, "a2").querySelector(".lo-markdown");
		if (prose === null) throw new Error("the closing answer has no prose");
		await selectText(prose as HTMLElement);
	},
};

/** A user selection: Copy and Speak, with no Quote action. */
export const SelectionToolbarUser: Story = {
	render: () => <Frame state={MULTI_ANSWER} />,
	play: async ({ canvasElement }) => {
		const bubble = row(canvasElement, "u1").querySelector("[data-glass-block]");
		if (bubble === null) throw new Error("the user bubble is not on screen");
		await selectText(bubble as HTMLElement);
		if (document.querySelector('button[aria-label="Quote"]') !== null) {
			throw new Error("a user selection offered Quote");
		}
	},
};
