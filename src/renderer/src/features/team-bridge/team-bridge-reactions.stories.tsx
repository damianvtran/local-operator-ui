import { t } from "@shared/i18n";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "@storybook/test";
import { useState } from "react";
import type { TeamBridgeMessage } from "../../../../shared/team-bridge-contract";
import { QUICK_EMOJI } from "./team-bridge-emoji-model";
import { TeamBridgeEmojiPicker } from "./team-bridge-emoji-picker";
import { TeamBridgeMessageList } from "./team-bridge-message-list";
import { TeamBridgeReactions } from "./team-bridge-reactions";
import { TeamBridgeThreadPaneView } from "./team-bridge-thread-pane";

const meta = {
	title: "Team Bridge/Reactions",
	component: TeamBridgeReactions,
	parameters: { layout: "centered" },
	decorators: [
		(Story) => (
			<div className="group/message relative w-[480px] max-w-full bg-canvas p-6 text-ink">
				<Story />
			</div>
		),
	],
	args: {
		conversationId: "bcv_example1",
		messageId: "bcmsg_example1",
		accountId: "story-account",
		tenantId: "tnt_1",
		reactions: [
			{
				emoji: "👍",
				count: 4,
				reacted_by_me: true,
				sample_labels: ["Ada", "Bea", "Cleo"],
			},
		],
		toggle: async (_conversation, message, emoji, active) => ({
			message_id: message,
			reactions: active
				? [{ emoji, count: 1, reacted_by_me: true, sample_labels: ["You"] }]
				: [],
		}),
	},
} satisfies Meta<typeof TeamBridgeReactions>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Populated: Story = {};
export const Empty: Story = { args: { reactions: [] } };
export const ManyReactionsWrap: Story = {
	args: {
		reactions: [...QUICK_EMOJI, "🚀", "💯", "🤝", "🥳", "🧑🏻‍❤️‍💋‍🧑🏼"].map(
			(emoji, index) => ({
				emoji,
				count: index + 1,
				reacted_by_me: index % 3 === 0,
				sample_labels: ["Ada", "Bea", "Cleo"],
			}),
		),
	},
};
export const RefusedRollback: Story = {
	args: {
		toggle: async () => {
			await new Promise((resolve) => setTimeout(resolve, 500));
			throw new Error("reaction_limit");
		},
	},
};
export const Pending: Story = {
	args: {
		toggle: async () => {
			await new Promise((resolve) => setTimeout(resolve, 2500));
			return { message_id: "bcmsg_example1", reactions: [] };
		},
	},
};
export const Picker: Story = {
	render: () => {
		const [selected, setSelected] = useState("");
		return (
			<>
				<TeamBridgeEmojiPicker
					accountId="story-account"
					onSelect={setSelected}
					onClose={() => {}}
				/>
				<output>{selected}</output>
			</>
		);
	},
};

/** Permanent design-regression boards: no temporary story edits are needed for the reviewed
 * 720px viewport, empty-message rhythm, unsupported glyph or keyboard interaction. */
export const ShortWindowPicker: Story = {
	parameters: {
		viewport: {
			defaultViewport: "reactionShort",
			viewports: {
				reactionShort: {
					name: "Reaction short window",
					styles: { width: "800px", height: "720px" },
					type: "desktop",
				},
			},
		},
	},
	args: { defaultOpen: true },
	render: (args) => (
		<div className="relative flex h-[560px] items-end">
			<TeamBridgeReactions {...args} />
		</div>
	),
};
export const EmptyTimeline: Story = {
	render: () => (
		<TeamBridgeMessageList
			labelFor={() => "Ada"}
			reactionContext={{ accountId: "story-account", tenantId: "tnt_1" }}
			messages={Array.from({ length: 8 }, (_, index) => ({
				id: `bcmsg_story${index}`,
				conversation_id: "bcv_example1",
				seq: index + 1,
				sender: {
					account_id: "ada",
					kind: "human" as const,
					display_label: "Ada",
				},
				body: "A short status update.",
				origin: "human" as const,
				created_at: new Date(Date.UTC(2026, 9, 21, 12, index)).toISOString(),
			}))}
		/>
	),
};
export const UnsupportedGlyphSearch: Story = {
	render: () => (
		<TeamBridgeEmojiPicker
			accountId="story-account"
			initialQuery="cracking face"
			onSelect={() => {}}
			onClose={() => {}}
		/>
	),
};
export const BusyPicker: Story = {
	render: () => (
		<TeamBridgeEmojiPicker
			accountId="story-account"
			disabled
			onSelect={() => {}}
			onClose={() => {}}
		/>
	),
};
export const KeyboardNavigation: Story = {
	...Picker,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const input = canvas.getByRole("textbox", {
			name: t("ui.teamBridge.reactions.search"),
		});
		await userEvent.click(input);
		await userEvent.type(input, "thumbs up");
		await userEvent.keyboard("{ArrowDown}{ArrowRight}{Enter}");
		await waitFor(() =>
			expect(canvasElement.querySelector("output")).toHaveTextContent("👍🏻"),
		);
	},
};
export const EscapeReturnsFocus: Story = {
	args: { defaultOpen: true },
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		await waitFor(() =>
			expect(
				body.getByRole("textbox", {
					name: t("ui.teamBridge.reactions.search"),
				}),
			).toBeVisible(),
		);
		await userEvent.keyboard("{Escape}");
		await waitFor(() =>
			expect(
				within(canvasElement).getByRole("button", {
					name: t("ui.teamBridge.reactions.add"),
				}),
			).toHaveFocus(),
		);
	},
};

/*
 * THE MESSAGE TOOLBAR BOARD (stack-integration finding: #1304's reply tool and
 * #1308's reaction pill both sat top-right on the row and overlapped). One row
 * carrying everything that competes for the row's space - reaction chips, a
 * thread summary, a long first line - with the single toolbar forced visible,
 * beside the thread pane, whose rows offer react and more but never reply.
 *
 * `attachments` rides the contract's passthrough: this branch does not render
 * it, and #1314 (attachments) does, so the same fixture shows thumbnails once
 * the stack lands. The play function measures what the design rule promises:
 * the toolbar's rect intersects no other content in its row, and every button
 * is at least 24x24.
 */
const toolbarRoot: TeamBridgeMessage = {
	id: "bcmsg_toolbar01",
	conversation_id: "bcv_example1",
	seq: 1,
	sender: { account_id: "ada", kind: "human", display_label: "Ada" },
	body: "Shipping the conversation flow today. The first line is deliberately long so it reaches the toolbar's edge and has to wrap around it rather than run under it.",
	origin: "human",
	created_at: new Date(Date.UTC(2026, 9, 21, 12, 0)).toISOString(),
	reactions: [
		{
			emoji: "👍",
			count: 3,
			reacted_by_me: true,
			sample_labels: ["You", "Bea", "Cleo"],
		},
		{ emoji: "🚀", count: 1, reacted_by_me: false, sample_labels: ["Bea"] },
	],
	reply_count: 2,
	reply_participants: ["Bea", "Cleo"],
	last_reply_at: new Date(Date.UTC(2026, 9, 21, 12, 30)).toISOString(),
	attachments: [
		{
			id: "batt_story01",
			mime: "image/png",
			size: 48213,
			width: 640,
			height: 400,
		},
	],
};
const toolbarReply: TeamBridgeMessage = {
	...toolbarRoot,
	id: "bcmsg_toolbar02",
	seq: 2,
	sender: { account_id: "bea", kind: "agent", display_label: "Bea's agent" },
	body: "Claimed. Evidence will follow in this thread.",
	origin: "agent",
	thread_root_id: toolbarRoot.id,
	reactions: [
		{ emoji: "👀", count: 1, reacted_by_me: false, sample_labels: ["Ada"] },
	],
	reply_count: undefined,
	reply_participants: undefined,
	last_reply_at: undefined,
	attachments: undefined,
};
const storyReactionContext = { accountId: "story-account", tenantId: "tnt_1" };

/*
 * The overlap check measures what a reader sees, not element boxes. The
 * toolbar's ground deliberately overhangs the body's first-line BOX by about
 * 3px (it sits in the line's half-leading: the 28px bar is centred on a 21.7px
 * line) while clearing the glyphs by 2.5px, so a box-against-box test reports
 * an overlap that is the design (design round 3, D11). Text nodes are measured
 * through a Range, which returns the glyph boxes; every other element (images,
 * chips, buttons, the time) is compared by its own box, because those have no
 * half-leading to hide in.
 */
const glyphRects = (node: HTMLElement): DOMRect[] => {
	const rects: DOMRect[] = [];
	const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
	for (let text = walker.nextNode(); text; text = walker.nextNode()) {
		if (!text.textContent?.trim()) continue;
		const range = document.createRange();
		range.selectNodeContents(text);
		rects.push(...Array.from(range.getClientRects()));
	}
	return rects;
};
const assertToolbarClear = async (canvasElement: HTMLElement) => {
	for (const toolbar of canvasElement.querySelectorAll<HTMLElement>(
		'[role="toolbar"]',
	)) {
		const box = toolbar.getBoundingClientRect();
		const row = toolbar.closest("li");
		const others = [
			...(row?.querySelectorAll<HTMLElement>(
				"p, li li, pre, img, button, [data-reaction-layout], time",
			) ?? []),
		].filter((node) => !toolbar.contains(node));
		for (const node of others) {
			const rects =
				node.tagName === "P" || node.tagName === "PRE"
					? glyphRects(node)
					: [node.getBoundingClientRect()];
			for (const r of rects) {
				const overlaps =
					r.width > 0 &&
					r.height > 0 &&
					r.left < box.right &&
					r.right > box.left &&
					r.top < box.bottom &&
					r.bottom > box.top;
				await expect(
					overlaps,
					`toolbar overlaps ${node.outerHTML.slice(0, 80)}`,
				).toBe(false);
			}
		}
		for (const button of toolbar.querySelectorAll("button")) {
			const r = button.getBoundingClientRect();
			await expect(r.width).toBeGreaterThanOrEqual(24);
			await expect(r.height).toBeGreaterThanOrEqual(24);
		}
	}
};

export const MessageToolbar: Story = {
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="flex h-[640px] bg-surface text-ink">
				<Story />
			</div>
		),
	],
	render: () => (
		<>
			<div className="min-w-0 flex-1">
				<TeamBridgeMessageList
					labelFor={(sender) => sender.display_label}
					reactionContext={storyReactionContext}
					onReply={() => {}}
					forceToolbar
					messages={[toolbarRoot]}
				/>
			</div>
			<div className="h-full w-[26rem] shrink-0">
				<TeamBridgeThreadPaneView
					root={toolbarRoot}
					replies={[toolbarReply]}
					state="ready"
					labelFor={(sender) => sender.display_label}
					onClose={() => {}}
					onRetry={() => {}}
					onSend={async () => {}}
					reactionContext={storyReactionContext}
					forceToolbar
				/>
			</div>
		</>
	),
	play: async ({ canvasElement }) => {
		await assertToolbarClear(canvasElement);
		const pane = canvasElement.querySelector("aside");
		await expect(
			within(pane as HTMLElement).queryByRole("button", {
				name: t("ui.teamBridge.replies.action"),
			}),
		).toBeNull();
	},
};

/** The keyboard path, unforced: Tab from the row reaches the toolbar, which the
 * row's `:focus-within` reveals; ArrowRight walks to reply. */
export const MessageToolbarKeyboard: Story = {
	...MessageToolbar,
	render: () => (
		<div className="min-w-0 flex-1">
			<button type="button" className="sr-only">
				before
			</button>
			<TeamBridgeMessageList
				labelFor={(sender) => sender.display_label}
				reactionContext={storyReactionContext}
				onReply={() => {}}
				messages={[toolbarRoot]}
			/>
		</div>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		/* Scoped to the toolbar: the chips' `+` carries the same "Add reaction"
		   name, so an unscoped query matches two buttons. */
		const toolbar = within(canvas.getByRole("toolbar"));
		canvas.getByRole("button", { name: "before" }).focus();
		await userEvent.tab();
		await expect(
			toolbar.getByRole("button", { name: t("ui.teamBridge.reactions.add") }),
		).toHaveFocus();
		await userEvent.keyboard("{ArrowRight}");
		const reply = toolbar.getByRole("button", {
			name: t("ui.teamBridge.replies.action"),
		});
		await expect(reply).toHaveFocus();
		/* The reveal is the row's `:focus-within` (opacity follows through a
		   transition, which a background tab may not advance), so assert the
		   driver, not the animated value. */
		await expect(reply.closest("li")?.matches(":focus-within")).toBe(true);
		await assertToolbarClear(canvasElement);
	},
};

/** Two frames: the first rAF runs before the paint that follows the commit,
 * the second runs after that paint, so its timestamp bounds "painted". */
const afterPaint = () =>
	new Promise<void>((resolve) =>
		requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
	);

/**
 * THE PICKER AT THE COLUMN'S END EDGE (operator report 2026-10-27). The row
 * sits flush against the viewport's right edge with its toolbar forced on, so
 * the picker opens from a trigger with no room to its end: Radix must shift it
 * back inside (`collisionPadding`). The play function clicks the real react
 * button, then asserts the picker's rect lies within the viewport and that
 * click -> painted is under 200 ms, read from `performance.measure` so the
 * number is in the Performance panel as well as the assertion.
 *
 * Both reaction holds (`shared/team-bridge-notify.ts`) render no toolbar in
 * this build, so the measurement runs only where the surface exists; the
 * board then records that the control is absent instead of failing on it.
 */
export const PickerOpensInsideViewport: Story = {
	...MessageToolbar,
	render: () => (
		<div className="ms-auto w-[min(560px,100%)] min-w-0">
			<TeamBridgeMessageList
				labelFor={(sender) => sender.display_label}
				reactionContext={storyReactionContext}
				forceToolbar
				messages={[toolbarRoot]}
			/>
		</div>
	),
	play: async ({ canvasElement }) => {
		const toolbar = canvasElement.querySelector('[role="toolbar"]');
		if (!toolbar) {
			canvasElement.dataset.pickerMeasured = "held";
			return;
		}
		const trigger = within(toolbar as HTMLElement).getByRole("button", {
			name: t("ui.teamBridge.reactions.add"),
		});
		performance.clearMarks("tb-picker-click");
		performance.mark("tb-picker-click");
		await userEvent.click(trigger);
		const body = canvasElement.ownerDocument.body;
		const picker = await waitFor(
			() => {
				const node = body.querySelector("[data-radix-popper-content-wrapper]");
				if (!(node instanceof HTMLElement)) throw new Error("no picker");
				return node;
			},
			{ interval: 5 },
		);
		await afterPaint();
		performance.mark("tb-picker-painted");
		const { duration } = performance.measure(
			"tb-picker-open",
			"tb-picker-click",
			"tb-picker-painted",
		);
		canvasElement.dataset.pickerMeasured = duration.toFixed(1);
		await expect(duration).toBeLessThan(200);
		const r = picker.getBoundingClientRect();
		const view = canvasElement.ownerDocument.documentElement;
		await expect(r.left).toBeGreaterThanOrEqual(0);
		await expect(r.top).toBeGreaterThanOrEqual(0);
		await expect(r.right).toBeLessThanOrEqual(view.clientWidth);
		await expect(r.bottom).toBeLessThanOrEqual(view.clientHeight);
	},
};
