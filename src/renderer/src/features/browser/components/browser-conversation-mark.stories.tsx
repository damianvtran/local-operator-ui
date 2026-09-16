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
const Row: FC<BrowserConversationMarkProps & { current?: boolean }> = ({
	current,
	...mark
}) => (
	<nav aria-label="Chats" className="flex w-64 flex-col gap-0.5 bg-surface p-1">
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
		<div
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
			</button>
			<BrowserConversationMark {...mark} />
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
 * THE SIDEBAR DOES NOT DRAW THIS ONE (`chat-sidebar.tsx`'s `browserMarkFor` returns null
 * when both counts are zero), so this frame is the mark's own floor rather than a row a
 * user meets: a conversation with nothing to say gets no control, which is the rule the
 * strip's pinned control follows too. It is here because the component has to answer the
 * question, and its answer — no badge, no count, one sentence — is what makes the
 * "nothing to say" case in the sidebar consistent with it.
 */
export const NothingOpen: Story = {
	args: { summary: summary() },
	render: (args) => <Row {...args} />,
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
