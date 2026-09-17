import { cn } from "@shared/lib/utils";
import type { Meta, StoryObj } from "@storybook/react";
import { within } from "@storybook/test";
import { userEvent } from "@storybook/test";
import type { FC } from "react";
import {
	BrowserConversationMark,
	type BrowserConversationMarkProps,
} from "./browser-conversation-mark";

/**
 * The conversation mark, in every state the sidebar can put it in (design R2).
 *
 * WHY A STORY RATHER THAN A FRAME OF THE LIVE ROUTE. Two of the mark's states need a
 * running agent leg and a live approval request, and the fourth (loading) needs a tab
 * mid-navigation — the live run that carries them is
 * `scripts/browser-chrome-proof.mjs` and the driver scene `browser-mark`, which is where
 * the FLOW is measured. This file is where the GRAMMAR is judged: which glyphs, which
 * count, which words, and whether the badge sits on the mark's corner rather than across
 * the glyph it belongs to.
 *
 * THE ROW-CONTEXT SPECIMEN AT THE END IS THE ONE THAT MATTERS MOST, because the mark is
 * never seen alone: it sits in a row that paints its own ground, and the question "does
 * the mark read on `surface` and on `sunken`" cannot be answered by a frame of the mark
 * on a blank page.
 */

const summary = (
	overrides: Partial<{
		tabCount: number;
		loadingCount: number;
		failedCount: number;
		pendingApprovals: number;
	}> = {},
) => ({
	tabCount: 0,
	loadingCount: 0,
	failedCount: 0,
	pendingApprovals: 0,
	...overrides,
});

/**
 * The mark in the only place it is ever seen: a conversation's row.
 *
 * EVERY STORY RENDERS THROUGH THIS, and for two reasons. The first is the design's: a
 * frame of a 24px control on a blank page answers no question a reviewer has, because the
 * row's ground and the neighbouring row are the things that decide whether the mark reads
 * — `surface` at rest, `sunken` when the row is current, `elevated` under the pointer.
 * The second is mechanical and was measured: the capture harness refuses a story whose DOM
 * is too thin to be a drawn surface (`storyDrew`'s element floor), and a lone control
 * trips it — the first run of this file failed with "the element floor rejected it".
 *
 * The row strings are the sidebar's own (`h-8`, `gap-1`, `rounded-md`, `px-1` from
 * `chat-sidebar.tsx`), so the frames are about the product's geometry.
 */
const Row: FC<
	BrowserConversationMarkProps & {
		current?: boolean;
		/** The row's one trailing statement, in the sidebar's own markup: a second slot the
		 * title shares the row with, which is the case the reserved slot has to justify
		 * itself in (design R2's cost note, D8). */
		trailing?: string;
		/** The row as the base tree drew it, with no mark at all. Only the slot-cost pair
		 * uses it: it is the BEFORE half of the before/after the reserved slot is judged
		 * on. */
		withoutMark?: boolean;
		/** Drop the ledger row above, for the pair whose subject is the browser row. */
		compact?: boolean;
	}
> = ({ current, trailing, withoutMark, compact, ...mark }) => (
	<nav aria-label="Chats" className="flex w-64 flex-col gap-0.5 bg-surface p-1">
		{!compact && (
			<div className="flex h-8 items-center gap-1 rounded-md">
				<button
					type="button"
					className="flex h-8 min-w-0 grow items-center gap-1 rounded-md px-1 text-left text-body-sm leading-5 hover:bg-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
				>
					<span className="min-w-0 flex-1 truncate">
						Reconcile the supplier ledger
					</span>
				</button>
			</div>
		)}
		<div
			data-slot={withoutMark ? "without" : "with"}
			className={cn(
				"flex h-8 items-center gap-1 rounded-md",
				current && "bg-sunken",
			)}
		>
			<button
				type="button"
				className={cn(
					"flex h-8 min-w-0 grow items-center gap-1 rounded-md px-1 text-left text-body-sm leading-5",
					current ? "hover:bg-sunken" : "hover:bg-elevated",
				)}
			>
				<span className="min-w-0 flex-1 truncate">
					{current ? "Quarterly reports (current)" : "Quarterly reports"}
				</span>
				{trailing && (
					<span className="ml-1 shrink-0 text-meta text-ink-muted">
						{trailing}
					</span>
				)}
			</button>
			{/* THE MARK'S OWN `current` IS PASSED, not left to its default: a mark on the
			    selected row must not paint its hover fill over that row's ground, and the
			    story is where that pair is photographed (review round 1, A7). */}
			{!withoutMark && <BrowserConversationMark {...mark} current={current} />}
		</div>
	</nav>
);

/** The same row with the caret on the mark, reached the way a keyboard reaches it. */
const FocusedRow: FC<BrowserConversationMarkProps> = (mark) => (
	<Row {...mark} current />
);

const meta = {
	title: "Browser/Conversation mark",
	component: BrowserConversationMark,
	args: {
		sessionId: "session-reports",
		name: "Quarterly reports",
		onOpen: () => {},
	},
} satisfies Meta<typeof BrowserConversationMark>;
export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Nothing open and nothing waiting: a bare Globe.
 *
 * THE SIDEBAR DRAWS THIS ONE NOW, and that is the whole of review round 1's D2/A4. It
 * used to be the mark's own floor — a state `chat-sidebar.tsx`'s `browserMarkFor`
 * returned `null` for, which left the sidebar without a browser entry point until a
 * conversation already had one, i.e. exactly where it is least needed. The design's R2 is
 * titled "a corner affordance on every conversation row" and its state table's first row
 * is this one: `Globe`, `text-ink-dim`, and the label `Open the browser for "Reports"`.
 * The frame is therefore a row a user MEETS rather than a component's own floor.
 */
export const NothingOpen: Story = {
	args: { summary: summary() },
	render: (args) => <Row {...args} />,
};

/**
 * The QUIETEST STATE beside a row's trailing statement, and beside the current row's
 * ground (review round 1, D8).
 *
 * WHY THIS STORY EXISTS: the design justifies the reserved slot with a cost — "28px of a
 * 280px sidebar for every title" — and until this frame no story combined a mark with
 * any of the statements a row already spends its width on (`· Not sent yet`, `· binding`,
 * `· in conversation`). The reviewer could only do arithmetic from two frames that never
 * appear together. The state is one draft away from any row that has a browser open, so
 * it is photographed rather than argued: the mark, the statement and the title are in one
 * row at the sidebar's own 256px.
 */
export const TrailingStatement: Story = {
	args: { summary: summary({ tabCount: 1 }) },
	render: (args) => <Row {...args} trailing="· Not sent yet" />,
};

/** Open tabs, no approvals: the count is the mark's own text. */
export const HasTabs: Story = {
	args: { summary: summary({ tabCount: 3 }) },
	render: (args) => <Row {...args} />,
};

/**
 * A tab mid-navigation: the glyph swaps to the app's spinner rather than gaining a
 * fourth mark, and the label says so. Both are the same fact in its live state.
 */
export const Loading: Story = {
	args: { summary: summary({ tabCount: 2, loadingCount: 1 }) },
	render: (args) => <Row {...args} />,
};

/** One approval: the badge, with the exact number, which is what the label reads. */
export const OneApproval: Story = {
	args: { summary: summary({ tabCount: 2, pendingApprovals: 1 }) },
	render: (args) => <Row {...args} />,
};

/** Three approvals: still one digit, and the badge is the same size it was at one. */
export const ThreeApprovals: Story = {
	args: { summary: summary({ tabCount: 1, pendingApprovals: 3 }) },
	render: (args) => <Row {...args} />,
};

/**
 * TEN, which is the case the cap exists for: the badge is right-anchored, so a third
 * digit would walk back over the Globe. `9+` is the header badge's own grammar, and the
 * exact number stays in the label and the tooltip.
 */
export const ManyApprovals: Story = {
	args: { summary: summary({ tabCount: 4, pendingApprovals: 12 }) },
	render: (args) => <Row {...args} />,
};

/** Everything at once: tabs, one loading, approvals waiting. */
export const Everything: Story = {
	args: {
		summary: summary({
			tabCount: 5,
			loadingCount: 1,
			failedCount: 1,
			pendingApprovals: 2,
		}),
	},
	render: (args) => <Row {...args} />,
};

/**
 * The mark with the caret on it. `focus-visible` is the app's own ring and it has to be
 * visible on both grounds, which the row specimen below shows.
 */
export const Focused: Story = {
	args: { summary: summary({ tabCount: 3, pendingApprovals: 1 }) },
	render: (args) => <FocusedRow {...args} />,
	play: async ({ canvasElement }) => {
		// A KEYBOARD focus paints the ring; a pointer press does not, which is the
		// distinction `focus-visible` is for. Reached by Tab from the row's own button, so
		// the frame shows the ring the product would actually paint rather than one forced
		// with `focus()`.
		const canvas = within(canvasElement);
		const [rowButton] = await canvas.findAllByRole("button");
		rowButton?.focus();
		await userEvent.tab();
		await userEvent.tab();
	},
};

/**
 * THE ROW-CONTEXT SPECIMEN, on both grounds a row can paint: the resting `surface` and
 * the current row's `sunken`.
 *
 * WHY BOTH. The mark is a 24px control inside a row that owns the current-state ground,
 * so "the badge is legible" is a claim about a `nav`-grounded panel and a recessed row at
 * once — and the badge's ring is the worst case, because it paints `canvas` on whatever
 * the row's ground is. The row shapes here are the sidebar's own strings (`h-8`, `gap-1`,
 * `rounded-md`, `px-1`), so the frame is about the product's geometry rather than about a
 * story-only arrangement.
 */
/**
 * THE TWO-GROUND PAIR, in one frame: the mark on a resting row and on the current one.
 *
 * The current row's ground is the recessed step (`sunken`) rather than the raised one, so
 * the mark's own hover fill (`elevated`) and the badge's `canvas` ring are read against
 * the opposite side of the panel's ground here — which is the pair a reader needs, and the
 * one thing a single-row frame cannot show.
 */
export const OnBothGrounds: Story = {
	args: {
		summary: summary({ tabCount: 4, loadingCount: 1, pendingApprovals: 2 }),
	},
	render: (args) => (
		<>
			<Row {...args} />
			<Row {...args} current />
		</>
	),
};

/**
 * THE RESERVED SLOT, MEASURED: the same row twice, on a tree that reserves it and on one
 * that does not (review round 1, D2/A4 — "check the reserved slot against the title width
 * in a before/after pair and report the title cost in pixels").
 *
 * The upper row is the base tree's shape (no mark, no slot reserved), the lower is this
 * branch's. The caption is measured from `getBoundingClientRect` in the story's own `play`
 * rather than typed, so the number in the frame is the number the two rows measured — the
 * same discipline `scripts/chat-alignment-geometry.mjs` uses for the transcript's edges,
 * applied to the one claim a still could otherwise only assert.
 */
export const SlotCost: Story = {
	args: { summary: summary({ tabCount: 3 }) },
	render: (args) => (
		<>
			<Row {...args} withoutMark compact />
			<Row {...args} compact />
			<div className="px-1 pt-1 text-meta text-ink-dim" data-slot-cost>
				measuring…
			</div>
		</>
	),
	play: async ({ canvasElement }) => {
		const titleWidth = (which: string): number | null => {
			const span = canvasElement.querySelector(
				`[data-slot="${which}"] span.min-w-0`,
			);
			return span
				? Math.round(span.getBoundingClientRect().width * 10) / 10
				: null;
		};
		const before = titleWidth("without");
		const after = titleWidth("with");
		const caption = canvasElement.querySelector("[data-slot-cost]");
		if (caption && before !== null && after !== null) {
			caption.textContent = `title ${before}px without the mark, ${after}px with it: the reserved slot costs ${Math.round((before - after) * 10) / 10}px`;
		}
	},
};
