/**
 * The run-details surface, in the states `docs/run-details.md` § 6.3 names.
 *
 * These render the REAL `ChatHeader` — the production component, with its own
 * cluster, its own button sizes and its own gates — inside a realistic chat
 * column: a `surface` ground, the header bar, and a little transcript beneath it.
 * The popover is Radix's own portal, opened by clicking the real button, so what
 * is photographed is the product rather than a reproduction of it.
 *
 * ## Why these stories CLICK rather than pass `defaultOpen`
 *
 * The trigger has a `defaultOpen` prop, and it is the right way to photograph a
 * panel from a capture rig: it seeds the open state and the failure
 * acknowledgement together, with no reliance on a click landing. But the frames
 * here are of the HEADER, and the header's seam carries `runDetails` and nothing
 * else (`chat-header.tsx`), so there is no path from a story to the trigger's
 * prop through the real component. Opening by clicking is the path a user takes,
 * and `data-capture-pending` holds the shutter until the panel is genuinely in
 * the DOM — the same handshake `chat-trace--conversation-reasoning-open` uses,
 * and for the same reason: a frame of the closed state is indistinguishable from
 * a frame of the open one in a directory listing.
 *
 * `Settled` and `HeaderTrigger` are a matched pair: same ground, same viewport,
 * different fixture. The run-details button is present in one and absent in the
 * other, which is § 3.3's rule — settled work alone does not raise the trigger —
 * photographed rather than asserted.
 */

import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import { type ReactNode, useEffect } from "react";
import "../../../../styles/index.css";
import type { Message } from "../../types/message";
import { ChatHeader } from "../chat-header";
import { MessageItem } from "../message-item";
import { TraceGroup, TraceLine } from "../trace";
import { deriveRunDetails } from "./run-detail-model";
import * as fixtures from "./run-details.fixtures";

const at = (iso: string) => new Date(iso);

const userMessage: Message = {
	id: "rd-user-1",
	role: "user",
	timestamp: at("2026-03-14T10:21:07Z"),
	execution_type: "user_input",
	conversation_id: "run-details",
	message:
		"Which customers still owe money this month, and what are the totals? Treat anything not marked paid as outstanding.",
};

const assistantMessage: Message = {
	id: "rd-assistant-1",
	role: "assistant",
	timestamp: at("2026-03-14T10:25:02Z"),
	execution_type: "response",
	task_classification: "continue",
	conversation_id: "run-details",
	is_complete: true,
	message:
		"Two customers are still outstanding. I am re-checking the pending rows against the ledger before I total them — two of them need a decision.",
};

/**
 * The transcript ground: real messages and real trace lines, quiet enough that
 * the header stays the subject and dense enough that the frame is a picture of a
 * conversation rather than of a background colour.
 */
const TranscriptGround = () => (
	<div className="flex min-h-0 flex-1 flex-col gap-5 overflow-hidden px-4 py-5">
		<MessageItem
			message={userMessage}
			conversationId="run-details"
			isLastMessage={false}
			isTurnStart={true}
			isSmallView={false}
		/>
		<TraceGroup>
			<TraceLine action="READ" filePath="invoices/march.csv" />
			<TraceLine action="CODE" narration="Totalling the unpaid rows" />
		</TraceGroup>
		<MessageItem
			message={assistantMessage}
			conversationId="run-details"
			isLastMessage={false}
			isTurnStart={true}
			isSmallView={false}
		/>
		{/*
		 * Three more rows than the short viewports show.
		 *
		 * The two tall frames (820px, chosen because the panel's `min(60vh,
		 * 480px)` ceiling is what they are judged at) put a 480px panel on an
		 * 820px page, and a transcript that stops after two rows leaves the
		 * lower third of those frames as bare ground — evidence about a layout
		 * nobody uses. The extra rows are clipped out of the short frames, which
		 * is what `overflow-hidden` is there for.
		 */}
		<TraceGroup>
			<TraceLine action="EDIT" filePath="reports/unpaid-march.md" />
			<TraceLine action="WRITE" filePath="reports/unpaid-march.md" />
			<TraceLine
				action="DELEGATE"
				narration="Asking a verifier to re-check the totals"
			/>
		</TraceGroup>
	</div>
);

/**
 * The chat column: the app's own ground (`surface`), the app's own header, and
 * the transcript beneath it. `onOpenOptions` is supplied so the canvas button is
 * in frame beside the trigger — § 3.2's cluster is the placement being judged.
 */
const ChatColumn = ({
	details,
}: { details: ReturnType<typeof deriveRunDetails> }) => (
	<div className="flex h-full flex-col overflow-hidden bg-surface">
		<ChatHeader
			agentName="Core"
			description="Invoices workspace · on this machine"
			onOpenOptions={() => undefined}
			runDetails={details}
		/>
		<TranscriptGround />
	</div>
);

/**
 * Open the panel through the real button and hold the capture rig's shutter
 * until it is there.
 *
 * The poll is on the panel's own hook rather than on a timeout, because the
 * portal mounts a frame after the click and a fixed sleep is a race that would
 * only ever be won by luck — and a frame of the wrong state passes every guard
 * the rig has.
 */
const OpenPanel = ({
	details,
}: {
	details: ReturnType<typeof deriveRunDetails>;
}) => {
	useEffect(() => {
		const button = document.querySelector<HTMLButtonElement>(
			"[data-run-details-trigger]",
		);
		if (!button) return;
		document.documentElement.dataset.capturePending = "1";
		button.click();
		const poll = window.setInterval(() => {
			if (!document.querySelector("[data-run-details-panel]")) return;
			window.clearInterval(poll);
			document.documentElement.removeAttribute("data-capture-pending");
		}, 40);
		return () => {
			window.clearInterval(poll);
			document.documentElement.removeAttribute("data-capture-pending");
		};
	}, []);
	return <ChatColumn details={details} />;
};

/**
 * The canvas is closed in every one of these frames, which is what § 3.3's
 * visibility rule requires of the trigger. Set explicitly rather than assumed:
 * the preference is persisted, so a viewer who opened the canvas in another
 * story would otherwise find this surface missing for a reason nothing on screen
 * explains.
 */
const withCanvasClosed = (Story: () => ReactNode) => {
	useEffect(() => {
		useUiPreferencesStore.setState({ isCanvasOpen: false });
	}, []);
	return <Story />;
};

const meta: Meta = {
	title: "Chat/Run details",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** Both sections, in flight, plus a label long enough to truncate. */
export const BothInFlight: Story = {
	render: () => (
		<OpenPanel details={deriveRunDetails(fixtures.bothInFlight())} />
	),
	decorators: [withCanvasClosed],
};

/** One section: children at work, one of them queued behind the capacity gate. */
export const SubagentsOnly: Story = {
	render: () => (
		<OpenPanel details={deriveRunDetails(fixtures.subagentsOnly())} />
	),
	decorators: [withCanvasClosed],
};

/** One section: the plan alone, with every item state in one plan. */
export const TodosOnly: Story = {
	render: () => <OpenPanel details={deriveRunDetails(fixtures.todosOnly())} />,
	decorators: [withCanvasClosed],
};

/**
 * A failure beside a flat, single-phase plan — the back-compat path where a
 * simple plan grows no header it does not need, and where the only colour the
 * panel spends is the cross on the failed row.
 */
export const Failure: Story = {
	render: () => <OpenPanel details={deriveRunDetails(fixtures.failure())} />,
	decorators: [withCanvasClosed],
};

/**
 * Nine children over a fourteen-item plan: both overflow disclosures, and the
 * panel's own `min(60vh, 480px)` ceiling doing its job — the list scrolls inside
 * the panel rather than growing past the viewport.
 */
export const Crowded: Story = {
	render: () => <OpenPanel details={deriveRunDetails(fixtures.crowded())} />,
	decorators: [withCanvasClosed],
};

/**
 * Everything settled and nothing unseen, so § 3.3 takes the button away: a
 * finished roster is history, and history lives in the transcript. This frame
 * and `HeaderTrigger` differ only in their fixture.
 */
export const Settled: Story = {
	render: () => <ChatColumn details={deriveRunDetails(fixtures.settled())} />,
	decorators: [withCanvasClosed],
};

/** The header with work in flight and the panel closed — the button is the subject. */
export const HeaderTrigger: Story = {
	render: () => (
		<ChatColumn details={deriveRunDetails(fixtures.headerTrigger())} />
	),
	decorators: [withCanvasClosed],
};

/** The unseen failure: a `danger` dot, and a tooltip that leads with the failure. */
export const HeaderTriggerFailed: Story = {
	render: () => (
		<ChatColumn details={deriveRunDetails(fixtures.headerTriggerFailed())} />
	),
	decorators: [withCanvasClosed],
};
