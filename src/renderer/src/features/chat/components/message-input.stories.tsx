import { cn } from "@shared/lib/utils";
import type { Meta, StoryObj } from "@storybook/react";
import { interruptNotice } from "../interrupt-turn";
import type { Message } from "../types/message";
import type { DirectoryWritePath } from "./directory-indicator";
import { MessageInput } from "./message-input";

/*
 * THE COMPOSER'S OWN STATES, which had no committed surface at all.
 *
 * Design round 2's D3: this change adds a sentence to the app - the busy
 * placeholder "Waiting for the agent" - and both citations for it were
 * unusable (one cited from `/tmp`, which does not survive the round it is
 * cited in; the other was the rung's own layout box, containing no composer).
 * The transcript's side of the same claim has frames in `Chat/Tool rows`;
 * this is the other half, at the SAME 1024 width so the two can be read
 * together.
 *
 * WHAT EACH FRAME IS FOR, since three of the four differ only in one string:
 *
 * - `Idle` is the control: nothing pending, "Ask me for help".
 * - `AwaitingReply` is the window this change makes visible - a send admitted
 *   and nothing painted yet. The placeholder is the composer's half of the
 *   transcript's wait line, and the box stays LIVE (typing during the wait
 *   steers the turn), which is why the frame is of the whole composer and not
 *   of a disabled control.
 * - `AwaitingReplyTransportDown` is the state design round 2's D5 is about,
 *   AFTER the fix: the pane above it has withdrawn the wait line for a dead
 *   transport, and the derivation the composer now shares with that line
 *   withdraws the hint with it. The frame reading "Ask me for help" here is
 *   the evidence - before this round the same state said "Waiting for the
 *   agent", which was the claim the transcript had just stopped making.
 * - `AwaitingAnswer` is UX round 2's U8: a question is pending and this box is
 *   where it is answered, so the box names that instead of inviting a message
 *   that Enter would refuse.
 *
 * `isLoading` is passed `false` throughout and that is deliberate: on the
 * canonical path `currentJobId` is null, so the composer's own `Agent is busy`
 * branch is unreachable there and every wait state is expressed through the
 * placeholders above. Passing `true` here would photograph a branch the
 * canonical pane cannot be in.
 */
/*
 * The desktop bridge, installed at MODULE SCOPE rather than from a wrapper or a
 * decorator.
 *
 * The composer reaches the bridge from a passive effect on mount (the platform
 * it renders the send chord for, and the native dialog behind attach), and
 * Storybook's preview mocks `window.api` rather than `window.electron` - so
 * without this the story throws and never prepares. A wrapper component cannot
 * do it: React runs a CHILD's effects before its parent's, so a mock installed by
 * the frame around `MessageInput` arrives one commit too late (measured:
 * "Cannot read properties of undefined (reading 'ipcRenderer')" out of
 * `commitHookEffectListMount`). The stand-in answers exactly those two channels
 * and nothing else; `window.electron` is a renderer global that only the app's
 * preload writes, so there is no other owner to restore it for.
 */
window.electron = {
	...(window.electron ?? {}),
	ipcRenderer: {
		...(window.electron?.ipcRenderer ?? {}),
		on: () => () => {},
		removeListener: () => window.electron.ipcRenderer,
		send: () => {},
		invoke: async (channel: string) =>
			channel === "get-platform-info"
				? { platform: "darwin" }
				: { canceled: true, filePaths: [] },
	},
} as typeof window.electron;

/*
 * The pane's own sentinel, the same one-row stand-in `chat-content.tsx` hands the
 * band as `CANONICAL_NONEMPTY`. The band's only question is whether anything is
 * painted ABOVE the composer, and on the canonical path while a send is admitted
 * the answer is yes - the transcript holds the echo - so the greeting and its
 * suggestion chips must not appear. A story passing `[]` photographs "What can I
 * help you with today?" over a conversation that has already started, which is
 * the claim this whole change removes.
 */
/**
 * The write path the chip needs to be EDITABLE - the same shape the chip's own
 * story file uses, and a no-op because this frame is about the row's geometry
 * rather than about a move (design review round 2, D13).
 */
const MOVING_CWD: DirectoryWritePath = {
	kind: "move",
	commit: async () => ({
		kind: "settled",
		receipt: {
			cwd: "/Users/you/Downloads",
			label: "~/Downloads",
			outcome: "cold",
			will_wait: false,
		},
		sentence: "moved to ~/Downloads",
	}),
};

const NONEMPTY: Message[] = [
	{ id: "canonical", role: "system", timestamp: new Date(0) },
];

const Frame = ({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) => (
	<div
		className={cn("flex flex-col gap-3 bg-canvas p-6")}
		style={{ width: 1024 }}
	>
		<span className={cn("font-mono text-ink-dim text-mono-sm")}>{label}</span>
		{children}
	</div>
);

const meta: Meta = {
	title: "Chat/Message input",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** Nothing pending: the sentence the other three are read against. */
export const Idle: Story = {
	render: () => (
		<Frame label="idle">
			<MessageInput
				isLoading={false}
				messages={NONEMPTY}
				conversationId="story"
				onSendMessage={async () => true}
			/>
		</Frame>
	),
};

/** A send admitted, nothing painted: the composer's half of the wait line. */
export const AwaitingReply: Story = {
	render: () => (
		<Frame label="awaiting reply (a send is admitted, nothing painted yet)">
			<MessageInput
				isLoading={false}
				messages={NONEMPTY}
				conversationId="story"
				awaitingReply={true}
				onSendMessage={async () => true}
			/>
		</Frame>
	),
};

/** The transport is down: the shared derivation yields the hint, as it does here. */
export const AwaitingReplyTransportDown: Story = {
	render: () => (
		<Frame label="awaiting reply, transport down (the hint yields with the line)">
			<MessageInput
				isLoading={false}
				messages={NONEMPTY}
				conversationId="story"
				// The derivation's answer in this state: `unavailable` retires the
				// claim in the transcript, so the composer's hint is false for the
				// same reason and is not passed at all.
				awaitingReply={false}
				onSendMessage={async () => true}
			/>
		</Frame>
	),
};

/** A question is pending: this box is where it is answered. */
export const AwaitingAnswer: Story = {
	render: () => (
		<Frame label="a question is pending">
			<MessageInput
				isLoading={false}
				messages={NONEMPTY}
				conversationId="story"
				awaitingAnswer={true}
				onSendMessage={async () => true}
			/>
		</Frame>
	),
};

/**
 * A conversation this machine no longer has (M6): the composer refuses input and
 * says WHY, rather than naming a turn nobody is running.
 *
 * The ONE story this branch contributes to a set main now owns. The gone state is
 * this change's — `unavailable` folds into `isInputDisabled`, and before the fix
 * the only text in the composer over a vanished conversation read "Agent is busy",
 * which is the false statement the transcript's own gone state was already fixed
 * for (design round 1, D3). The colour step is the branding contract's: a disabled
 * control changes COLOUR, never opacity.
 *
 * The other states this branch used to carry here (`Busy`, a second `Idle`) are
 * NOT re-added. Main's own header states the rule they broke: `isLoading` is false
 * throughout this set on purpose, because `currentJobId` is null on the canonical
 * path and the "Agent is busy" branch is unreachable there — a frame of it would
 * photograph a state no user can be in.
 */
export const ConversationGone: Story = {
	render: () => (
		<Frame label="conversation gone (M6): refuses input, and says which state">
			<MessageInput
				isLoading={false}
				messages={NONEMPTY}
				conversationId="story"
				unavailable={true}
				onSendMessage={async () => true}
			/>
		</Frame>
	),
};

/**
 * The composed row WITH a live cwd chip in it, at the composer's own width and at
 * the width its container queries call the floor (design review round 2, D13).
 *
 * Why this story exists. Round 1's D7 asked for "a stable width OR render the
 * composed row once", and the fixed path column answered the first half; the
 * second half was still the one state nobody had photographed, so the chip's
 * pairing with the readings cluster in a real row was geometry rather than a
 * frame. `Idle` above cannot show it: without a known directory the chip does
 * not mount at all (`cwdToShow !== undefined` is the gate).
 *
 * The two widths are in ONE frame on purpose. The chip's wide and floor variants
 * are behind `@min-[620px]/chatcol` / `@max-[240px]/chatcol`, so each row carries
 * its own `@container/chatcol` - the named container the queries resolve against
 * - and a reader sees the pair, and the fact that the row's own layout does not
 * change between them, in one picture. Only props differ from `Idle`; no product
 * code is involved.
 */
export const CwdChipInRow: Story = {
	render: () => (
		<div className={cn("flex flex-col gap-6 bg-canvas p-4")}>
			{[1024, 240].map((width) => (
				<div key={width} className={cn("flex flex-col gap-2")}>
					<span className={cn("font-mono text-ink-dim text-mono-sm")}>
						{`composed row with a live cwd chip, ${width}px chat column`}
					</span>
					<div className={cn("@container/chatcol")} style={{ width }}>
						<MessageInput
							isLoading={false}
							messages={NONEMPTY}
							conversationId="story"
							cwd="/Users/you/src/project"
							cwdWritePath={MOVING_CWD}
							onSendMessage={async () => true}
						/>
					</div>
				</div>
			))}
		</div>
	),
};

/*
 * THE INTERRUPT'S OWN SURFACE: the control, its absence, and what a press that
 * left work behind says.
 *
 * Three frames rather than one, because the change has three states a reader
 * has to be able to tell apart and two of them are silent:
 *
 * - `StopControlWhileStreaming` is the affordance itself, on the same
 *   `/chatcol` measure the cwd chip's row uses. It is the frame the reported
 *   bug was about: this control used to post a catalogue command whose answer
 *   was a presentation form, so it looked identical to this and stopped
 *   nothing.
 * - `StopControlWithoutCapability` is the fail-closed state. The backend
 *   advertises no `session_interrupt`, so no control is rendered AT ALL - the
 *   rejected alternatives were a fallback to `/stop` (which ends the session
 *   this control does not promise to end) and today's silent no-op (which is
 *   the lie being removed). Read against the frame above it, the difference is
 *   the whole point of the pair.
 * - `InterruptLeftWorkRunning` is the only one that speaks, and it is the copy
 *   the shipped function produces rather than a transcription of it: a stopped
 *   turn with nothing under it renders NOTHING (the notification bridge's own
 *   exclusion of the `interrupted` kind), so the sentence exists only where
 *   there is work the user cannot see the end of.
 */
const STOPPED_WITH_WORK_LEFT = interruptNotice({
	status: "interrupted",
	receipt: "stopping this turn",
	children_running: 2,
	background_jobs: 1,
	replayed: false,
});

export const StopControlWhileStreaming: Story = {
	render: () => (
		<Frame label="streaming, with session_interrupt negotiated: the control is offered">
			<div className={cn("@container/chatcol")} style={{ width: 1024 }}>
				<MessageInput
					isLoading={false}
					messages={NONEMPTY}
					conversationId="story"
					canonicalStop={{ active: true, onStop: () => {} }}
					onSendMessage={async () => true}
				/>
			</div>
		</Frame>
	),
};

export const StopControlWithoutCapability: Story = {
	render: () => (
		<Frame label="streaming, backend without session_interrupt: no control is rendered">
			<div className={cn("@container/chatcol")} style={{ width: 1024 }}>
				<MessageInput
					isLoading={false}
					messages={NONEMPTY}
					conversationId="story"
					onSendMessage={async () => true}
				/>
			</div>
		</Frame>
	),
};

export const InterruptLeftWorkRunning: Story = {
	render: () => (
		<Frame label="stopped, with children and background jobs still running">
			<div className={cn("@container/chatcol")} style={{ width: 1024 }}>
				<MessageInput
					isLoading={false}
					messages={NONEMPTY}
					conversationId="story"
					interruptNotice={STOPPED_WITH_WORK_LEFT}
					onSendMessage={async () => true}
				/>
			</div>
		</Frame>
	),
};
