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
 * The chat column: the app's own page ground (`canvas`), the app's own header,
 * and the transcript beneath it. `onOpenOptions` is supplied so the canvas button
 * is in frame beside the trigger — § 3.2's cluster is the placement being judged.
 *
 * **`h-screen`, not `h-full`.** The preview frame above this story is
 * `min-h-screen`, whose height is AUTO — so a percentage height against it
 * resolves to auto and this column was CONTENT-height (428px in every one of the
 * eighteen frames). The panel opens from y51 to y530, so its floor and its
 * shadow sat below the column's own box, on the preview frame's ground rather
 * than on the column the panel is supposed to be over: a seam through the middle
 * of the panel that is invisible today only because the story and the frame both
 * paint `canvas`. The moment either ground moves it reappears as a horizontal
 * step, and the elevation the frames certify would be measured against the wrong
 * plane — the same class of defect the `bg-canvas` change above fixed. `100vh`
 * is the definite height the app's own shell gives this column, so the story
 * states it rather than inheriting it from a coincidence (design round 4, D2).
 *
 * **`bg-canvas`, not `bg-surface`.** #113 gave the working surface the PAGE
 * ground so the list panel could step from it; the popover opens over the
 * working column, which is `canvas`, so that is what has to be under it for the
 * frame's ground to be the app's. Painting `surface` here made every committed
 * frame certify the panel's elevation against a plane the app no longer paints
 * under this popover — and made the geometry notes call that plane "canvas"
 * while measuring `surface`. The change moves the panel FURTHER from its ground,
 * not closer: see the measured falloff in
 * `docs/evidence/run-details/README.md`.
 */
const ChatColumn = ({
	details,
}: { details: ReturnType<typeof deriveRunDetails> }) => (
	<div className="flex h-screen flex-col overflow-hidden bg-canvas">
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
 * The unseen failure and nothing else — every child settled, every to-do closed
 * — photographed OPEN.
 *
 * The only reason the trigger is on screen here is a failure nobody has read
 * (`§3.3`), which makes this the frame for the acknowledgement path: opening the
 * panel records the failure as seen in the same commit that shows it, and the
 * panel has to survive that (`§6.3`). It is the regression frame for D1 — against
 * a trigger gated on `hasRunDetails` alone, this story renders no panel at all.
 *
 * The failure carries the full exception line, so the frame also shows D4's
 * second line: monospace, `ink-muted`, wrapped to two lines so the identifier
 * `'ledger/q1.csv'` survives instead of being truncated away.
 */
export const FailureUnseen: Story = {
	render: () => (
		<OpenPanel details={deriveRunDetails(fixtures.failureUnseen())} />
	),
	decorators: [withCanvasClosed],
};

/**
 * Nine children over a fifteen-item plan: both overflow disclosures, and the
 * panel's own `min(60vh, 480px)` ceiling doing its job — the list scrolls inside
 * the panel rather than growing past the viewport.
 *
 * Its children are deliberately NOT in wire order (see the fixture): this is the
 * frame where the overflow slice is visible, so it is also the frame where a
 * slice that ties by array index instead of by the children's own clocks picks
 * different rows. Six show and three are disclosed; the settled row that
 * survives is the NEWEST settled child, and the tally sheds whole segments down
 * to the states that are actually on screen (`§4.1`).
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
