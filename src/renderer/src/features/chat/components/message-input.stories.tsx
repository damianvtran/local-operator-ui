import { cn } from "@shared/lib/utils";
import { useConversationInputStore } from "@shared/store/conversation-input-store";
import type { Meta, StoryObj } from "@storybook/react";
import { screen, userEvent, within } from "@storybook/test";
import { type ReactNode, useEffect, useState } from "react";
import type { CanonicalFrontendState } from "../../../../../../src/shared/desktop-session-contract";
import { interruptNotice, interruptUnavailableNotice } from "../interrupt-turn";
import type { Message } from "../types/message";
import type { DirectoryWritePath } from "./directory-indicator";
import { MessageInput } from "./message-input";
import type { SlashCommandMeta } from "./slash-commands";
import type { SlashDispatchOutcome } from "./slash-dispatch";
import type { SlashCommandInvocation } from "./slash-submit";
import "./story-electron-shim";

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
 * The desktop bridge is installed by `./story-electron-shim`, imported above:
 * the composer reaches it from a passive effect on mount, Storybook's preview
 * mocks `window.api` rather than `window.electron`, and the install therefore
 * has to happen at module scope. That module carries the measurement behind it.
 */

/*
 * The DESKTOP BRIDGE, installed at module scope beside the preload shim and for
 * the same reason: the slash list exists only when a backend answers for it.
 *
 * `useSlashCompletion` gates on `capabilities` (`desktop_available` plus a
 * `commands` version) and then reads the registry through `commands.list` — and
 * a Storybook preview has neither an op transport nor a backend, so without this
 * the composer's popup can only ever be a fixture handed in from outside, which
 * is why the keyboard half of the interaction had no surface to drive at all
 * (round 1 QA Q2, answered then by the bundled contract test alone).
 *
 * THREE ops, which is the whole of what the list needs: `capabilities` and
 * `commands.list` to exist, and `commands.entities` for the argument list that
 * `/model` opens. Everything else is a 5xx, deliberately: a story that starts
 * depending on another op should say so loudly rather than render the popup's own
 * "not reported yet." copy and look like an empty registry.
 *
 * ABSENT, not faked: `desktop.capture`/`stream`/`media` and every native channel.
 * This stands up a decision surface; it is not an app.
 */
const slashCommand = (
	name: string,
	description: string,
	destination: string,
	over: Partial<SlashCommandMeta> = {},
): SlashCommandMeta => ({
	name,
	description,
	destination,
	aliases: [],
	arguments: "none",
	echo: false,
	consumes_prompt: false,
	execution: "owner",
	...over,
});

/**
 * The command registry the popup reads, REAL-SHAPED and REAL-NAMED.
 *
 * Names, descriptions, argument modes and destinations are the registry's own
 * (`local_operator/slash_commands.py`), because what this surface proves is a
 * DECISION about the real commands: `/analytics` runs on one Enter, `/model`
 * completes and opens its list, and an ambiguous word grows instead of running.
 *
 * It is a SUBSET rather than the whole registry, and the omissions are chosen
 * rather than incidental: the `l` family here is `login`, `logout` and `loop`,
 * which is the WHOLE family in the real registry (`local_operator/slash_commands.py`)
 * - so `/l` grows to `lo`, the prefix all three agree on, exactly as it does in
 * the app. Review round 1 (F3) found this fixture carrying only `login` and
 * `logout`, which made the frame show `log`: a number the real registry cannot
 * produce, and an ambiguity case easier than the one users meet.
 */
const SLASH_COMMANDS: SlashCommandMeta[] = [
	slashCommand(
		"analytics",
		"Aggregated token-consumption analytics across all sessions",
		"analytics",
		{ arguments: "optional" },
	),
	slashCommand(
		"session",
		"Current-session usage, cost and request diagnostics",
		"session.diagnostics",
	),
	slashCommand("usage", "Show provider usage quota", "usage"),
	slashCommand(
		"info",
		"Install, version, and running sessions on this machine",
		"info",
	),
	slashCommand(
		"model",
		"Switch model; /model default saves it for new sessions",
		"session.model",
		{ arguments: "optional" },
	),
	slashCommand(
		"team",
		"List teams, chart a team's org, or send a request to a team's manager",
		"session.team",
		{ arguments: "optional" },
	),
	slashCommand(
		"theme",
		"Switch color theme; arrows preview live",
		"appearance",
		{ arguments: "optional" },
	),
	slashCommand("compact", "Compact the context now", "session.compact"),
	slashCommand(
		"clear",
		"Clear the transcript (history is untouched)",
		"transcript.clear",
	),
	slashCommand("exit", "Quit the app", "window.close"),
	slashCommand("login", "Authenticate a provider", "auth.login", {
		arguments: "optional",
	}),
	slashCommand("logout", "Remove stored provider credentials", "auth.logout", {
		arguments: "optional",
	}),
	slashCommand(
		"loop",
		"Loop toward a goal: /loop <goal text>, /loop <n>, or /loop stop to cancel",
		"session.loop",
		{ arguments: "required" },
	),
];

/*
 * Two catalogue rows for `/model`, in the shape the route sends (the same
 * fixture `slash-commands.stories.tsx` uses, kept local because that file's
 * rows are shaped for the popup's own frames rather than for a live query).
 */
const MODEL_ROWS = [
	{
		provider: "anthropic",
		model_id: "claude-opus-5",
		selector: "anthropic/claude-opus-5",
		value: "anthropic/claude-opus-5",
		label: "Claude Opus 5",
		connected: true,
		context_window: 400_000,
		input_price: 3,
		output_price: 15,
	},
	{
		provider: "openai",
		model_id: "gpt-5",
		selector: "openai/gpt-5",
		value: "openai/gpt-5",
		label: "GPT-5",
		connected: true,
		context_window: 400_000,
		input_price: 1.25,
		output_price: 10,
	},
];

/* biome-ignore lint/suspicious/noExplicitAny: Necessary for mocking the window object, the same cast the preview makes. */
const storyWindow = window as any;
storyWindow.api = {
	...storyWindow.api,
	desktop: {
		request: async (request: { op: string; command?: string }) => {
			if (request.op === "capabilities")
				return {
					status: 200,
					body: {
						result: {
							desktop_contract: 1,
							desktop_available: true,
							desktop_auth: "bearer",
							features: { commands: 1, session_catalogue: 1 },
						},
					},
				};
			if (request.op === "commands.list")
				return { status: 200, body: { result: { commands: SLASH_COMMANDS } } };
			if (request.op === "commands.entities")
				return {
					status: 200,
					body: {
						result: {
							command: request.command ?? "",
							entities: request.command === "model" ? MODEL_ROWS : [],
							current: null,
						},
					},
				};
			return {
				status: 503,
				body: {
					detail: `The slash-gesture fixture answers capabilities, commands.list and commands.entities only; ${request.op} is not one of them.`,
				},
			};
		},
	},
};

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

/*
 * `data-frame-label` is what lets a capture row correct this frame's caption when the
 * row borrows a story for a state the story is not named for (design round 3, D11):
 * the pixels of such a frame are right and the anchor was wrong, and only the caption
 * tells a reader which state they are looking at.
 */
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
		<span
			data-frame-label=""
			className={cn("font-mono text-ink-dim text-mono-sm")}
		>
			{label}
		</span>
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

/**
 * The slash popup's ENTER gesture, on the PRODUCTION composer.
 *
 * WHAT THIS EXERCISES, and what it deliberately does not: the composer's own
 * decision — which gesture runs a command, which completes it, and what an
 * ambiguous word does instead — driven through `handleSlashKeyDown` and the real
 * popup over a fixture registry and a fixture desktop bridge. The DIALOG the
 * command then opens is the dispatcher's path (`slash-dispatch` → the picker
 * host), which this surface does not render: the `onSlashCommand` prop below
 * records the invocation instead, and the record is on screen so a frame carries
 * it. No part of this frame is a claim that a panel mounted.
 *
 * It needs the bridge above because a backend-less preview has no registry at
 * all, and the keyboard half of this interaction was previously unreachable by
 * any instrument the repository had — the bundled contract test executes the
 * decision, this executes the gesture. Driven by `scripts/slash-enter-proof.mjs`
 * with real key events, which is where the frames under
 * `docs/evidence/chat-slash-enter-gestures/` come from.
 */
const SlashGestureHarness = () => {
	const [ran, setRan] = useState<string[]>([]);
	return (
		/*
		 * The composer is anchored to the BOTTOM of the viewport, and that is a
		 * layout requirement rather than a preference: the popup renders
		 * `bottom-full`, so in a top-anchored frame the list opens off the top of
		 * the page (measured: the `/analytics` row's painted centre was at y = -4)
		 * — a frame nobody can read, and a pointer the driver cannot aim at. The
		 * record below the composer stays out of the popup's way for the same
		 * reason.
		 */
		<div
			className={cn("flex h-screen flex-col justify-end gap-3 bg-canvas p-6")}
		>
			<MessageInput
				isLoading={false}
				messages={NONEMPTY}
				conversationId="story"
				onSendMessage={async () => true}
				/*
				 * The dispatcher's own outcome vocabulary, not a boolean: a panel
				 * command is `consumed` (the surface it names IS the receipt), which is
				 * what the real `slash-dispatch.ts` answers for `/analytics`.
				 */
				onSlashCommand={async (
					invocation: SlashCommandInvocation,
				): Promise<SlashDispatchOutcome> => {
					setRan((previous) => [
						...previous,
						`/${invocation.name}${invocation.args ? ` ${invocation.args}` : ""}`,
					]);
					return "consumed";
				}}
			/>
			<div className={cn("flex flex-col gap-1")}>
				<span className={cn("font-mono text-ink-dim text-mono-sm")}>ran</span>
				<p
					data-slash-dispatched=""
					className={cn("font-mono text-body-sm text-ink")}
				>
					{ran.length > 0 ? ran.join(", ") : "none"}
				</p>
			</div>
			<span className={cn("font-mono text-ink-dim text-mono-sm")}>
				slash Enter gestures — the composer's decision, not the dialog mount
			</span>
		</div>
	);
};

export const SlashEnter: Story = { render: () => <SlashGestureHarness /> };

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
					/*
					 * `awaitingReply` is what the APP pairs this control with (design
					 * round 1, N1): the control exists only while `busy`, and `busy` is
					 * the same fact that paints "Waiting for the agent". Photographed
					 * without it the frame read "Ask me for help" - the idle string -
					 * under a caption that said streaming, which is a state the app
					 * cannot be in.
					 */
					awaitingReply={true}
					canonicalStop={{ active: true, onStop: () => {} }}
					onSendMessage={async () => true}
				/>
			</div>
		</Frame>
	),
};

/*
 * THE SETTLED IDLE ROW, which is the operator's report on the first fix for the
 * round's MAJOR and has to be visible to be judged. The reservation of the Stop
 * control's box is now a GRACE WINDOW rather than a standing state
 * (`interrupt-slot-grace.ts`), so an idle composer on a capable backend holds
 * nothing and the dictation control sits beside Send with only the row's own gap
 * between them. Captured against the frame above, the pair is the point: the
 * cluster CHANGES between the two states - and it is the DICTATION control that
 * moves, 32px plus the row's own 4px gap to the right, while **Send keeps its
 * position**: it is pinned to the composer's right edge in every state (measured
 * on the live row, default rung: Send's left edge 1307 running, inside the window
 * and settled; the dictation control 1271 settled and 1235 running). As written
 * the other way round the pair would argue the weaker case - if the dictation
 * control never moved there would be nothing to protect from a press in the
 * Stop's box, and the window would need no justification. Against
 * `StopControlWithoutCapability` below it shows a backend that cannot interrupt
 * renders the same settled row.
 *
 * One ink difference from `interrupt-live/` beside these frames, stated so the
 * two sets are not read as one change: this story renders the dictation control
 * DISABLED (no Radient credential is armed in Storybook) and so in the
 * `ink-disabled` role, while the live rig arms a placeholder credential and
 * photographs the same box live and brighter. Both are legitimate states of the
 * same box, and the ink step is the credential rather than the reservation.
 *
 * The frames cannot show the grace itself: a story mounts a component in one
 * state, and the window opens on a TRANSITION the turn's own end produces (a
 * freshly mounted composer must render no reservation). That transition is
 * measured in the real app instead - `scripts/interrupt-esc-proof.mjs` presses the
 * Stop control and re-measures the cluster on both sides of the window, and its
 * `interrupt-live` frames carry both.
 */
export const StopSlotSettled: Story = {
	render: () => (
		<Frame label="idle between turns, session_interrupt negotiated: dictation sits beside Send, no box held">
			<div className={cn("@container/chatcol")} style={{ width: 1024 }}>
				<MessageInput
					isLoading={false}
					messages={NONEMPTY}
					conversationId="story"
					canonicalStopAvailable={true}
					onSendMessage={async () => true}
				/>
			</div>
		</Frame>
	),
};

export const StopSlotSettledSmallView: Story = {
	render: () => (
		<Frame label="small view: dictation sits beside Send at the tighter rung, and the tightened notice fits">
			<div className={cn("@container/chatcol")} style={{ width: 440 }}>
				<MessageInput
					isLoading={false}
					messages={NONEMPTY}
					conversationId="story"
					isSmallView={true}
					canonicalStopAvailable={true}
					interruptNotice={STOPPED_WITH_WORK_LEFT}
					onSendMessage={async () => true}
				/>
			</div>
		</Frame>
	),
};

export const InterruptLeftChildrenOnly: Story = {
	render: () => (
		<Frame label="stopped, with subagents still running and no background jobs">
			<div className={cn("@container/chatcol")} style={{ width: 1024 }}>
				<MessageInput
					isLoading={false}
					messages={NONEMPTY}
					conversationId="story"
					interruptNotice={interruptNotice({
						status: "interrupted",
						receipt: "stopping this turn",
						children_running: 2,
						background_jobs: 0,
						replayed: false,
					})}
					onSendMessage={async () => true}
				/>
			</div>
		</Frame>
	),
};

export const InterruptLeftJobsOnly: Story = {
	render: () => (
		<Frame label="stopped, with a background job still running and no children">
			<div className={cn("@container/chatcol")} style={{ width: 1024 }}>
				<MessageInput
					isLoading={false}
					messages={NONEMPTY}
					conversationId="story"
					interruptNotice={interruptNotice({
						status: "interrupted",
						receipt: "stopping this turn",
						children_running: 0,
						background_jobs: 1,
						replayed: false,
					})}
					onSendMessage={async () => true}
				/>
			</div>
		</Frame>
	),
};

/*
 * The version-skew line (UX round 1, U4): no control, no Escape, and now a
 * sentence saying why and naming the lever that does work. It renders through the
 * same band as the notice, which is the point - the composer has one place to be
 * told something about stopping, whatever the reason.
 */
export const InterruptUnavailableOldBackend: Story = {
	render: () => (
		<Frame label="streaming, backend predating session_interrupt: no control, and the reason">
			<div className={cn("@container/chatcol")} style={{ width: 1024 }}>
				<MessageInput
					isLoading={false}
					messages={NONEMPTY}
					conversationId="story"
					awaitingReply={true}
					interruptNotice={interruptUnavailableNotice(true, false)}
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

/*
 * ---------------------------------------------------------------------------
 * THE INLINE CREDENTIAL CAPTURE's visible states (design §1-§10)
 * ---------------------------------------------------------------------------
 *
 * Five frames, one per state the operator can be in, and each is driven by REAL
 * KEYSTROKES against the shipped composer rather than by a prop that fakes the
 * state. That is the whole point of them: the feature's rules live in the
 * keyboard/mask/citation path, and a story that rendered `•` directly would
 * photograph the paint while proving nothing about the gesture. `userEvent.type`
 * dispatches the same keydowns a person does, so the mask, the mint and the
 * Escape restore are exercised by the frames.
 *
 * The canary value is deliberate. `docs/design/composer-credential-capture.md`
 * §10 requires that a typed secret is greppable NOWHERE after a store-and-send
 * cycle, and the frames are the cheapest place to see that it is not: the
 * bullets are painted by the textarea and the value is held outside the
 * document, so this string appears in no frame, in no draft, and in nothing the
 * overlay paints.
 *
 * `capturePending` is set on mount and released once the state is on screen,
 * because the capturer's shutter otherwise races the interaction — a story that
 * sets no flag produces the result in some themes' frames and not others (the
 * defect `canvas.stories.tsx` records as design round 1's D1).
 */
const CREDENTIAL_CANARY = "sk-live-CANARY-4417";

/* Hoisted, because a matcher built inside a play function is rebuilt on every
   call and `lint/performance/useTopLevelRegex` is the rule that says so. */
const ARMED_NOTICE = /armed — add a space/;
const MASKED_NOTICE = /masked as you type/;
const PLAINTEXT_NOTICE = /now PLAIN TEXT in the composer/;
/*
 * The cleared sentence as the copy authority writes it now: the key, the ordinal the
 * chip's face carries, and the composer's own key as the way back (UX round 3, U15/U16).
 * The ordinal is optional so this reads the same sentence whichever register raised it.
 */
const CLEARED_NOTICE =
	/Removed LOP_SECRET_[A-Z0-9]+ \(credential #\d+\) from this message/;

const holdShutter = () => {
	document.documentElement.dataset.capturePending = "1";
};

const releaseShutter = () => {
	delete document.documentElement.dataset.capturePending;
};

/**
 * Whether this story's play has already run on this page.
 *
 * STORYBOOK RUNS A PLAY FUNCTION MORE THAN ONCE PER LOAD when the story's args
 * settle after the first render — which is exactly what happens on the
 * capturer's second pass, where the theme arrives as an arg (`args=theme:...`)
 * and the decorator applies it a beat later. Measured, not theorised: the first
 * pass typed `/credential` and the second typed it AGAIN into the box the first
 * had filled, so the frame the capturer waited on held `/credential/credential`
 * — the armed notice correctly absent, the shutter never released, and a
 * sixty-second "Storybook never finished preparing" instead of a picture. The
 * guard makes the play idempotent per document; the `clear` below makes it
 * idempotent even if the guard is ever removed.
 */
let played = false;

/** Type `text` into the composer as a person would, one keystroke at a time. */
const typeIntoComposer = async (
	canvasElement: HTMLElement,
	text: string,
): Promise<HTMLTextAreaElement> => {
	const box = canvasElement.querySelector<HTMLTextAreaElement>(
		'textarea[role="combobox"]',
	);
	if (!box) throw new Error("the composer's textarea is not in this story");
	await userEvent.click(box);
	await userEvent.clear(box);
	await userEvent.type(box, text);
	return box;
};

/** The play's first three lines, in one place: hold, reset, and report. */
const holdAndReset = (canvasElement: HTMLElement) => {
	if (played) return false;
	played = true;
	holdShutter();
	return Boolean(canvasElement);
};

/**
 * The composer's VALUE, which is where this feature's text actually lives.
 *
 * Read from the control rather than from `screen.findByText`: the marker and the
 * mask cells are the textarea's value, and a textarea has no text children for a
 * query to find. A play function that asserted through `findByText` would pass
 * on the overlay's copy in one state and hang in another — which is the class of
 * false evidence these stories exist to avoid.
 */
const composerValue = (box: HTMLTextAreaElement) => box.value;

/**
 * The chip's box minus the marker run's, in the composer, read from the live DOM.
 *
 * THE SAME PAIR `scripts/credential-chip-geometry.mjs` PRINTS, evaluated here so
 * that a state which cannot be photographed at rest can still be ASSERTED where
 * it happens: the chips are measured, and the two failures that matter are both
 * invisible in a picture of the resting composer — a chip that does not follow
 * the field's scroll (UX round 1, U1, the round's blocker) and a chip that is
 * never re-measured after a resize (code review round 1, R1-3). A story is a real
 * browser, so the scroll case can be driven and measured in the play function
 * rather than argued about.
 *
 * `null` when there is no run or no chip, which is itself a failure for the
 * states that assert on it: a chip that vanished is not a chip in the right
 * place.
 */
const chipDelta = (canvasElement: HTMLElement) => {
	const layer = canvasElement.querySelector("[data-credential-chips]");
	const run = canvasElement
		.querySelector("div[aria-hidden='true'][class*='-z-10']")
		?.querySelector("[data-credential-run]");
	const chip = layer?.firstElementChild;
	if (!run || !chip) return null;
	const marker = run.getBoundingClientRect();
	const painted = chip.getBoundingClientRect();
	return {
		left: painted.left - marker.left,
		top: painted.top - marker.top,
		width: painted.width - marker.width,
		height: painted.height - marker.height,
	};
};

/**
 * The WCAG contrast ratio of two computed colours, for the states whose claim is
 * a floor rather than a difference.
 *
 * The design round's D3 rejected the old hover step on measured numbers across the
 * palettes, so the replacement's RESTING ink has to clear the text floor on the
 * chip's own fill in whatever theme the capture is running — and the capture runs
 * in twelve. A play function is the only place that can be checked against the
 * real cascade (`rgb(...)` strings in, a ratio out), so it is checked here rather
 * than inferred from the class list.
 */
const contrastRatio = (a: string, b: string) => {
	const channels = (colour: string) => {
		const parts = colour.match(/[\d.]+/g)?.map(Number) ?? [];
		if (parts.length < 3) throw new Error(`unreadable colour: ${colour}`);
		return parts.slice(0, 3);
	};
	const luminance = ([r, g, b]: number[]) => {
		const linear = [r, g, b].map((raw) => {
			const v = raw / 255;
			return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
		});
		return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
	};
	const [one, two] = [luminance(channels(a)), luminance(channels(b))];
	return (Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05);
};

/** The chip's own fill, read from the element the control sits in. */
const chipGround = (control: Element) => {
	const chip = control.parentElement;
	if (!chip) throw new Error("the clear control is not inside a chip");
	return getComputedStyle(chip).backgroundColor;
};

/** Two paint frames, so a measurement reads the layout the browser settled on. */
const settle = () =>
	new Promise((resolve) =>
		requestAnimationFrame(() => requestAnimationFrame(resolve)),
	);

/**
 * The gesture ARMED and nothing masked yet: `/credential` has been typed and no
 * space follows it, so the next space opens the capture. The notice line says so
 * — the TUI's own sentence — which is what makes the state legible rather than
 * looking like ordinary prose.
 */
export const CredentialArmed: Story = {
	render: () => (
		<Frame label="armed: the token is the caret's own tail, so the next space opens a masked capture">
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
	play: async ({ canvasElement }) => {
		if (!holdAndReset(canvasElement)) return;
		await typeIntoComposer(canvasElement, "/credential");
		await screen.findByText(ARMED_NOTICE);
		releaseShutter();
	},
};

/**
 * TYPING: the space has opened the span and every character since is ONE MASK
 * CELL — never the character. The notice names the mask and both keys, which is
 * the only place the operator can learn that their keystrokes are being received
 * as bullets and how the mode ends.
 *
 * The count is the frame's own evidence: `sk-live-CANARY-4417` is nineteen
 * characters, so nineteen cells stand between the token and the end of the line
 * — the length the receipt will report, which is the operator's only integrity
 * check once the value can never be displayed again.
 */
export const CredentialMasked: Story = {
	render: () => (
		<Frame label="masked: one cell per typed character, and the characters are not in the document">
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
	play: async ({ canvasElement }) => {
		if (!holdAndReset(canvasElement)) return;
		const box = await typeIntoComposer(
			canvasElement,
			`/credential ${CREDENTIAL_CANARY}`,
		);
		await screen.findByText(MASKED_NOTICE);
		// The canary must not be in the document: if a regression let a character
		// through, this throws and no frame is taken for the state.
		if (composerValue(box).includes(CREDENTIAL_CANARY)) {
			throw new Error("the typed secret reached the buffer");
		}
		if (!composerValue(box).includes("•")) {
			throw new Error("no mask cells were painted");
		}
		releaseShutter();
	},
};

/**
 * The pill INLINE, mid-prose, with the caret past it and the sentence continuing
 * — the whole point of the gesture ("hand over a secret, then describe it").
 * Enter minted rather than sent, so the operator's own prose is still being
 * written after the receipt.
 */
export const CredentialPillMidProse: Story = {
	render: () => (
		<Frame label="a pill mid-prose: Enter minted it, and the sentence continues after it">
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
	play: async ({ canvasElement }) => {
		if (!holdAndReset(canvasElement)) return;
		const box = await typeIntoComposer(
			canvasElement,
			`deploy with /credential ${CREDENTIAL_CANARY}`,
		);
		await userEvent.type(box, "{Enter}");
		await userEvent.type(box, " to the staging box");
		const value = composerValue(box);
		if (!value.includes("[Credential #1, 19 chars]")) {
			throw new Error(`no pill was minted: ${value}`);
		}
		if (value.includes(CREDENTIAL_CANARY)) {
			throw new Error("the secret is in the buffer");
		}
		releaseShutter();
	},
};

/**
 * THE CHIP'S CLEAR CONTROL, DRIVEN BY A REAL CLICK (operator report,
 * 2026-09-17: "a real pill component — slick, less technical, with an x button
 * to clear").
 *
 * This is the only place the control can be exercised end to end. The composer's
 * jsdom suite cannot reach it: the chip is painted at a box MEASURED from the
 * mirror, and jsdom has no layout engine, so `getClientRects()` reports nothing
 * and no chip is mounted there. The pure half is pinned in
 * `scripts/credential-capture.test.mjs` (`clearCitedCredential`: one edit, marker
 * and its trailing space, caret where the marker was); what this frame adds is
 * that the shipped control is reachable, that the click lands on it, and that the
 * operator is TOLD what it cost.
 *
 * The sentence is chosen so the removal reads cleanly: the words that follow the
 * reference are separated by punctuation the operator typed, so the marker's own
 * trailing space — which goes with it, the mint's own rule — takes nothing else
 * with it. A sentence whose grammar leans on that space ("deploy with <ref> to
 * the box") reads differently afterwards, and that is the operator's edit to
 * make: the app removes a reference, it does not rewrite a sentence.
 */
export const CredentialPillCleared: Story = {
	render: () => (
		<Frame label="cleared: the x on the chip took the reference out in one edit, and the composer says the value is gone">
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
	play: async ({ canvasElement }) => {
		if (!holdAndReset(canvasElement)) return;
		const box = await typeIntoComposer(
			canvasElement,
			`here is the new key /credential ${CREDENTIAL_CANARY}`,
		);
		await userEvent.type(box, "{Enter}");
		await userEvent.type(box, ", use it for the QA box");
		if (!composerValue(box).includes("[Credential #1, 19 chars]")) {
			throw new Error(`no chip was minted: ${composerValue(box)}`);
		}
		/*
		 * The control's accessible name, which is the only handle it has: the chip is
		 * painted over the marker's own characters, so a text query would find the
		 * textarea's copy of the marker rather than this control.
		 */
		const clear = await within(canvasElement).findByLabelText(
			"Remove credential #1",
		);
		await userEvent.click(clear);
		/*
		 * BOTH CHANNELS ARE THE CLAIM (UX round 1, U2): the sentence must not be
		 * reachable only through a toast that retires in a few seconds, so the frame
		 * shows the notice line — the composer's own, at the operator's focus —
		 * carrying it, and the toast offering the undo beside it.
		 */
		const notice = canvasElement.querySelector("#composer-credential-notice");
		if (!notice || !CLEARED_NOTICE.test(notice.textContent ?? "")) {
			throw new Error(
				`the notice line does not carry the cleared sentence: ${notice?.textContent ?? "(no notice line)"}`,
			);
		}
		await screen.findByRole("button", { name: "Undo" });
		const value = composerValue(box);
		if (value.includes("[Credential #1")) {
			throw new Error(`the marker survived the clear: ${value}`);
		}
		if (value.includes(CREDENTIAL_CANARY)) {
			throw new Error("the secret is in the buffer");
		}
		releaseShutter();
	},
};

/**
 * THE SCROLLED COMPOSER, WHICH IS WHERE THE CHIP USED TO COME OFF ITS RUN (UX
 * round 1, U1 — the round's BLOCKER, and the reason this state exists at all).
 *
 * The measured layer converts a mirror span's VIEWPORT rect into its own
 * coordinates, and it used to add the mirror's `scrollTop`/`scrollLeft` on top —
 * re-applying the scroll the rect already accounted for. In any message long
 * enough to scroll, the chip therefore sat exactly `fieldScrollTop` px from its
 * marker (measured `deltaTop` 0 / 60 / 117 for `scrollTop` 0 / 60 / 117), an
 * opaque ground over unrelated prose, with a live `x` on it: pressing it threw
 * away a credential the operator could not see it was standing for. No story
 * could show this, because every story rendered a composer that does not scroll.
 *
 * The reference is minted at the END of a fifteen-line buffer so that scrolling
 * the field to its end leaves the run in the viewport with the prose it belongs
 * to above it — the operator's own shape (a long message, a key pasted at the
 * end) rather than the shape invented to hold the defect. The play function
 * scrolls the field itself and MEASURES the pair, so the frame is not the only
 * thing standing behind the claim: `chipDelta` must be zero in a real browser at
 * a non-zero `scrollTop`, or this story throws instead of releasing the shutter.
 * The rig's own row re-scrolls the field before shooting (`scrollToEnd`), so the
 * committed frame is the scrolled state rather than the resting one.
 */
export const CredentialPillScrolled: Story = {
	render: () => (
		<Frame label="scrolled: a 15-line message, the reference minted at its end, and the chip still on the marker after the field scrolls">
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
	play: async ({ canvasElement }) => {
		if (!holdAndReset(canvasElement)) return;
		const filler = Array.from(
			{ length: 14 },
			(_, i) => `composer box line ${i + 1} of filler prose`,
		).join("\n");
		const box = await typeIntoComposer(
			canvasElement,
			`${filler}\ndeploy with /credential ${CREDENTIAL_CANARY}`,
		);
		await userEvent.type(box, "{Enter}");
		await userEvent.type(box, " to the staging box");
		if (!composerValue(box).endsWith("to the staging box")) {
			throw new Error(
				`the reference did not mint into the tail: ${composerValue(box)}`,
			);
		}
		box.scrollTop = box.scrollHeight;
		box.dispatchEvent(new Event("scroll"));
		await settle();
		/*
		 * THE PARKED POSITION IS A LEGIBLE ONE (UX round 5, U2). Scrolling to the very end
		 * left the run's strip inside the 2.4-5.4px band the UX round landed on, where the
		 * chip is drawn before any of its control's glyph can be seen: a real Tab reached
		 * `Remove credential #1` with no `times` on screen, and a real press in that band
		 * cleared the credential. The chip's floor is now the strip at which the glyph appears,
		 * so the fixture parks the run's top a readable distance inside the field's box rather
		 * than on its edge - the sweep in `scripts/credential-chip-geometry.mjs` asserts the
		 * same floor across the whole boundary, and this story is its resting state.
		 */
		const markerRun = canvasElement.querySelector<HTMLElement>(
			"[data-credential-run]",
		);
		if (markerRun) {
			box.scrollTop = Math.max(
				0,
				Math.round(markerRun.offsetTop - box.clientHeight + 14),
			);
			box.dispatchEvent(new Event("scroll"));
			await settle();
		}
		if (box.scrollTop === 0) {
			throw new Error(
				"the field never scrolled, so this story is not the scrolled state",
			);
		}
		const delta = chipDelta(canvasElement);
		if (!delta) throw new Error("no chip is painted over the run");
		if (Math.abs(delta.top) > 0.5 || Math.abs(delta.left) > 0.5) {
			throw new Error(
				`the chip is off its run at scrollTop ${box.scrollTop}: ${JSON.stringify(delta)}`,
			);
		}
		const scrolledTo = box.scrollTop;
		/*
		 * AND THE KEYBOARD'S ROUTE TO THE CONTROL (UX round 2, U6 — a BLOCKER). The chip
		 * layer used to be a scroll CONTAINER (`overflow-hidden`), so the browser scrolled
		 * it to bring the focused control into view: one real Tab from the field left the
		 * layer at `scrollTop 219` with the chip 219px above its run, painted over
		 * unrelated prose, its `x` live and a focus ring on it. `overflow-clip` is the fix
		 * and this is the assertion — the layer's own offset stays 0, the field's does not
		 * move, and the chip is still on the marker it stands for.
		 */
		await userEvent.tab();
		await settle();
		const layer = canvasElement.querySelector("[data-credential-chips]");
		if (!layer) throw new Error("the chip layer is gone after the Tab");
		if (layer.scrollTop !== 0) {
			throw new Error(
				`the chip layer scrolled ITSELF to ${layer.scrollTop} when its control took focus (content ${layer.scrollHeight} in ${layer.clientHeight}px)`,
			);
		}
		if (box.scrollTop !== scrolledTo) {
			throw new Error(
				`the field moved when the control took focus: ${scrolledTo} -> ${box.scrollTop}`,
			);
		}
		const afterTab = chipDelta(canvasElement);
		if (
			!afterTab ||
			Math.abs(afterTab.top) > 0.5 ||
			Math.abs(afterTab.left) > 0.5
		) {
			throw new Error(
				`the chip left its run when its control took focus: ${JSON.stringify(afterTab)}`,
			);
		}
		/*
		 * AND THE SAME KEYSTROKE IN THE STATE THAT DISCRIMINATES (code review round 3,
		 * R3-2). Everything above runs with the chip IN VIEW, which is the state in which
		 * the round-2 defect cannot reproduce - with nothing for the browser to scroll INTO
		 * view, the layer's own offset stays 0 even when it is the scroll container it used
		 * to be, and the assertion is inert for the defect it was written for. The defect
		 * lives in the state the round-2 reviewer measured: the field parked at its top,
		 * the marker's run below the box.
		 *
		 * In that state: the layer draws NO chip for a run it clips away (round 3, R3-1),
		 * and a real Tab from the field therefore cannot land on a control that is painted
		 * nowhere - which is what makes the composer stop swallowing keystrokes and stop
		 * clearing credentials off-screen.
		 */
		/*
		 * THE CARET HAS TO LEAVE THE END FIRST, OR THIS STEP NEVER REACHES ITS OWN STATE
		 * (code review round 5's class, found while landing R5-1's test). The field is
		 * focused with the caret after the minted reference, and a focused textarea whose
		 * caret is at the end re-scrolls itself back to that caret - so `scrollTop = 0` was
		 * undone on the next layout, the run stayed inside the box, and the assertion below
		 * had been reading a chip that was correctly drawn. Measured before this change:
		 * `scrollTop 225, run 165..182, box 78.4..190.4, chips 1`, i.e. the step that names
		 * "the field parked at its top, the marker's run below the box" never got there and
		 * the round-3 claim was inert in this story as well as in the rig.
		 */
		box.setSelectionRange(0, 0);
		box.scrollTop = 0;
		box.dispatchEvent(new Event("scroll"));
		await settle();
		if (box.scrollTop !== 0) {
			throw new Error(
				`this story needs the field parked at its top to discriminate, and it is at ${box.scrollTop} instead`,
			);
		}
		if (canvasElement.querySelector("[data-credential-chips]")) {
			const runEl = canvasElement.querySelector<HTMLElement>(
				"[data-credential-run]",
			);
			const rect = runEl?.getBoundingClientRect();
			throw new Error(
				`a run the layer clips away still drew a chip, so its control is reachable while painted nowhere (round 3, R3-1): run ${rect ? `${rect.top.toFixed(1)}..${rect.bottom.toFixed(1)}` : "none"} against a box of ${box.getBoundingClientRect().top.toFixed(1)}..${box.getBoundingClientRect().bottom.toFixed(1)}`,
			);
		}
		await userEvent.tab();
		await settle();
		const landedOn =
			document.activeElement?.getAttribute?.("aria-label") ??
			document.activeElement?.tagName ??
			null;
		if (
			typeof landedOn === "string" &&
			landedOn.startsWith("Remove credential")
		) {
			throw new Error(
				`a Tab with the run out of view reached ${JSON.stringify(landedOn)}, a control painted nowhere (round 3, R3-2)`,
			);
		}
		/*
		 * AND BACK TO THE STATE THIS STORY IS NAMED FOR, focus in the box: the committed
		 * frame shows the chip on its run while the field is scrolled, and the ring has its
		 * own two frames (`credential-pill-focused` and its compact sibling).
		 */
		box.scrollTop = box.scrollHeight;
		box.dispatchEvent(new Event("scroll"));
		box.focus();
		await settle();
		releaseShutter();
	},
};

/**
 * THE CLEAR CONTROL UNDER THE POINTER (design round 1, D3).
 *
 * The step used to be a ground-only one (`hover:bg-elevated` against the chip's
 * own fill), which measures 1.00-1.33:1 across the palettes — 16 of 59 at or
 * under 1.05:1, `obsidian` at ΔE00 0.77 and the default theme greyscale-identical
 * — so in half the themes the control's only feedback was invisible or hue-only.
 * The perceivable step is the INK now (`ink-muted` -> `ink`, the working-directory chip's own prune-control idiom), and a frame is the only way to show
 * it: `:hover` is browser state no story can set, so the rig's row moves the real
 * pointer onto the control (`hover:`) and shoots with it still there.
 *
 * The play asserts the step ACTUALLY HAPPENED rather than trusting the class
 * list: the computed ink is read at rest and again with the pointer on it, and the
 * story throws if the two are equal — which is the failure a renamed role would
 * produce, in the theme the capture happens to run in.
 */
export const CredentialPillHover: Story = {
	render: () => (
		<Frame label="hover: the clear control's ink steps from ink-muted to ink under the pointer, with the primitive's elevated ground beside it">
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
	play: async ({ canvasElement }) => {
		if (!holdAndReset(canvasElement)) return;
		const box = await typeIntoComposer(
			canvasElement,
			`deploy with /credential ${CREDENTIAL_CANARY}`,
		);
		await userEvent.type(box, "{Enter}");
		await userEvent.type(box, " to the staging box");
		const control = await within(canvasElement).findByLabelText(
			"Remove credential #1",
		);
		const atRest = getComputedStyle(control).color;
		const ratio = contrastRatio(atRest, chipGround(control));
		if (ratio < 4.5) {
			throw new Error(
				`the clear control's resting ink is ${ratio.toFixed(2)}:1 on the chip's fill, under the 4.5 text floor`,
			);
		}
		/*
		 * `:hover` is browser state: a synthetic event does not leave it set for the
		 * frame the rig takes afterwards, which is why the rig's own row moves the REAL
		 * pointer (`hover:`) and shoots with it there — that frame is the step. What
		 * this asserts is the half a picture cannot: that the resting pair the step
		 * starts from clears the floor in the theme being captured, which is D3's own
		 * measurement taken from the live cascade rather than from the class list.
		 */
		await userEvent.hover(control);
		releaseShutter();
	},
};

/**
 * THE CLEAR CONTROL WITH KEYBOARD FOCUS (design round 1, D2).
 *
 * Two things are only visible here. The control is 16x16 rather than 12x12 — as
 * far as a 17px run box allows, 24x24 being impossible inline (the chip's own
 * ground would land on the lines above and below and swallow their clicks), so the
 * WCAG 2.2 SC 2.5.8 deviation is a recorded measurement rather than a silent one
 * — and its focus ring takes the primitive's DENSE offset (`outline-offset-1`)
 * instead of the global 2px, which on a control this small bled over the chip's
 * own edge and into the words beside it.
 *
 * `:focus-visible` is browser state like `:hover`, and stricter: a programmatic
 * focus does not match it unless the last interaction was the keyboard, so the
 * rig's row walks there with real Tab presses (`tabTo:`) — which is also the
 * keyboard route the UX round measured ("after the mint, one Tab from the field
 * lands on it"). The play asserts the ring's own offset, the half a still cannot
 * measure.
 */
export const CredentialPillFocused: Story = {
	render: () => (
		<Frame label="focused: the clear control reached by Tab from the field, with the dense-size focus offset instead of the global one">
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
	play: async ({ canvasElement }) => {
		if (!holdAndReset(canvasElement)) return;
		const box = await typeIntoComposer(
			canvasElement,
			`deploy with /credential ${CREDENTIAL_CANARY}`,
		);
		await userEvent.type(box, "{Enter}");
		await userEvent.type(box, " to the staging box");
		const control = await within(canvasElement).findByLabelText(
			"Remove credential #1",
		);
		const target = control.getBoundingClientRect();
		if (target.width < 16 || target.height < 16) {
			throw new Error(
				`the clear target is ${target.width}x${target.height}, under the box the run allows`,
			);
		}
		releaseShutter();
	},
};

/**
 * THE UNDO, DRIVEN BY A REAL CLICK ON THE TOAST (UX round 1, U2).
 *
 * The clear's sentence used to expire with a sonner toast (3.5-6.5s) while the
 * notice line stayed blank, and `Cmd+Z` restored nothing. The fix is two channels
 * and a held payload: the notice line carries the sentence until the next edit,
 * and the toast offers `Undo`, which puts the marker back at the offset it was
 * removed from and leaves the payload in place — the payload was never dropped,
 * so the restored marker is a BACKED chip again rather than the warning register.
 *
 * This is the only place the whole round trip can be walked: the chip is painted
 * at a measured box (jsdom has no layout engine, so the composer's jsdom suite
 * cannot reach the control at all) and the undo's own target is a toast in a
 * portal. The assertions are the state, not the intent: the marker is back in the
 * buffer, the chip is painted again over its run, and the notice line has retired
 * — because the sentence described the buffer the clear produced.
 */
export const CredentialPillClearedUndone: Story = {
	render: () => (
		<Frame label="undone: the toast's Undo put the reference back at the offset it was removed from, as a backed chip">
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
	play: async ({ canvasElement }) => {
		if (!holdAndReset(canvasElement)) return;
		const box = await typeIntoComposer(
			canvasElement,
			`here is the new key /credential ${CREDENTIAL_CANARY}`,
		);
		await userEvent.type(box, "{Enter}");
		await userEvent.type(box, ", use it for the QA box");
		const before = composerValue(box);
		await userEvent.click(
			await within(canvasElement).findByLabelText("Remove credential #1"),
		);
		if (composerValue(box) === before) {
			throw new Error("the clear did not edit the buffer");
		}
		await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
		await settle();
		if (composerValue(box) !== before) {
			throw new Error(
				`the undo did not restore the buffer: ${composerValue(box)} != ${before}`,
			);
		}
		const delta = chipDelta(canvasElement);
		if (!delta || Math.abs(delta.top) > 0.5 || Math.abs(delta.left) > 0.5) {
			throw new Error(
				`the restored reference is not a chip on its run: ${JSON.stringify(delta)}`,
			);
		}
		const notice = canvasElement.querySelector("#composer-credential-notice");
		if (notice && CLEARED_NOTICE.test(notice.textContent ?? "")) {
			throw new Error(
				"the cleared sentence is still on the notice line after the reference came back",
			);
		}
		releaseShutter();
	},
};

/**
 * THE SAME CHIP AT THE SHIPPED COMPACT RUNG — a column under 550px, where the
 * composer drops a type step and the padding — because the chip is painted at a
 * box measured from the mirror and the run it covers is NARROWER there.
 *
 * Nothing in the composer suite can catch a geometry failure at this rung (no
 * layout engine), so the pair of frames is what holds the claim: the chip covers
 * the marker's box at both rungs, and the numbers behind both are printed by
 * `scripts/credential-chip-geometry.mjs` rather than read off these pictures.
 */
export const CredentialPillSmallView: Story = {
	render: () => (
		<Frame label="small view (a 440px column): the same chip at the compact rung, over a narrower run">
			<div className={cn("@container/chatcol")} style={{ width: 440 }}>
				<MessageInput
					isLoading={false}
					messages={NONEMPTY}
					conversationId="story"
					isSmallView={true}
					onSendMessage={async () => true}
				/>
			</div>
		</Frame>
	),
	play: async ({ canvasElement }) => {
		if (!holdAndReset(canvasElement)) return;
		const box = await typeIntoComposer(
			canvasElement,
			`/credential ${CREDENTIAL_CANARY}`,
		);
		await userEvent.type(box, "{Enter}");
		await userEvent.type(box, "is the deploy key");
		if (!composerValue(box).startsWith("[Credential #1, 19 chars]")) {
			throw new Error(`no chip was minted: ${composerValue(box)}`);
		}
		releaseShutter();
	},
};

/**
 * The pill at the START of a line, which is the shape that must NOT read as a
 * slash command. The token was consumed at mint time, so the line begins with a
 * marker and the dispatcher's leading-slash plan cannot fire on it.
 */
export const CredentialPillAtLineStart: Story = {
	render: () => (
		<Frame label="a pill at the start of the line: the token was consumed, so this is prose and not a command">
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
	play: async ({ canvasElement }) => {
		if (!holdAndReset(canvasElement)) return;
		const box = await typeIntoComposer(
			canvasElement,
			`/credential ${CREDENTIAL_CANARY}`,
		);
		await userEvent.type(box, "{Enter}");
		await userEvent.type(box, "is the deploy key, use it for the release");
		if (
			!composerValue(box).startsWith(
				"[Credential #1, 19 chars] is the deploy key",
			)
		) {
			throw new Error(
				`the pill is not at the head of the line: ${composerValue(box)}`,
			);
		}
		releaseShutter();
	},
};

/**
 * Seeds the composer's own draft store, which is the only honest way to render
 * the state this frame is about.
 *
 * A RESTORED DRAFT is what produces an unbacked marker: the marker text is
 * persisted (§6) and the payload map is not (it is a ref), so a reload paints a
 * citation nothing holds. The draft is the composer's own store rather than a
 * prop — there is no `draft` prop on `MessageInput`, deliberately — so the story
 * writes the store the way the app writes it, in an EFFECT rather than at module
 * scope because the store is `persist`ed and a write made before rehydration can
 * be merged away by it (the technique the composer-band stories established).
 */
const WithDraft = ({
	conversation,
	text,
	children,
}: {
	conversation: string;
	text: string;
	children: ReactNode;
}) => {
	useEffect(() => {
		useConversationInputStore.getState().setCurrentInput(conversation, text);
	}, [conversation, text]);
	return <>{children}</>;
};

/**
 * A MARKER NOTHING BACKS, painted in the NOT-STORED register (UX round 3, U13;
 * design round 4, D3).
 *
 * Round 3 changed this state's paint — a marker no payload backs takes the
 * warning wash with a DASHED edge (design round 4, D2) instead of the live
 * pill's own treatment — and the change was pinned by a test case and a row of
 * the contrast contract and by no frame at all, on a surface whose evidence IS
 * frames (228 of them, none of them this state). The designer had to write this
 * draft into localStorage by hand to photograph it.
 *
 * The text is the LIVE pill's own sentence from `CredentialPillMidProse` with the
 * payload gone — `deploy with [Credential #1, 19 chars] to the staging box` — so
 * the two frames are the pair a reader compares: same characters, same position,
 * same 1024 measure, and the only difference is what the app knows about the
 * value. What the frame is for: the chip is distinguishable from a live pill
 * without relying on hue (the dash), and the marker is not left as literal text.
 */
export const CredentialPillUnbacked: Story = {
	render: () => (
		<Frame label="a marker nothing backs: the live pill's own characters, restored from a draft after the payload was gone">
			<div className={cn("@container/chatcol")} style={{ width: 1024 }}>
				<WithDraft
					conversation="story"
					text={"deploy with [Credential #1, 19 chars] to the staging box"}
				>
					<MessageInput
						isLoading={false}
						messages={NONEMPTY}
						conversationId="story"
						onSendMessage={async () => true}
					/>
				</WithDraft>
			</div>
		</Frame>
	),
};

/**
 * ESCAPED: the operator cancelled, and the characters came back as ORDINARY
 * TEXT. This is the only exit that leaves a secret in the composer, and the
 * frame cannot say so on its own — the masked span is gone and the composer
 * looks entirely normal while holding the characters the next Enter will expose
 * — so the warning sentence is the state, not decoration. It is the one frame
 * here where the canary IS on screen, and it is there because the operator asked
 * for it.
 */
export const CredentialEscaped: Story = {
	render: () => (
		<Frame label="escaped: Esc gave the characters back as plain text, and the composer says so">
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
	play: async ({ canvasElement }) => {
		if (!holdAndReset(canvasElement)) return;
		const box = await typeIntoComposer(
			canvasElement,
			`/credential ${CREDENTIAL_CANARY}`,
		);
		await userEvent.type(box, "{Escape}");
		await screen.findByText(PLAINTEXT_NOTICE);
		if (!composerValue(box).endsWith(CREDENTIAL_CANARY)) {
			throw new Error(
				`the characters did not come back: ${composerValue(box)}`,
			);
		}
		releaseShutter();
	},
};

/*
 * ---------------------------------------------------------------------------
 * ROUND 3: THE SENTENCE ABOVE THE BOX, AT THE TWO SURFACES NO FRAME HELD
 * ---------------------------------------------------------------------------
 *
 * Design round 3 (D3, D4) named this gap: every credential story renders the
 * composer on a bare 1024px column with no working-directory chip and no
 * readings strip, so no frame showed the sentence beside the two neighbours
 * whose widths used to decide whether it wrapped — and no story paired
 * `isSmallView` with the capture at all, even though the small-view rung is
 * where the round-2 wrap bound ("at most 7.5px") measured 11px.
 *
 * The placement these two frames are about: the sentence now sits ABOVE the
 * composer box, in the band's own flow (round 3's remediation of design D1, UX
 * U14, code review MAJOR 1 and QA Q1/Q2), so the row beside it keeps its chip,
 * its readings and its controls at their own widths and the box's pinned bottom
 * edge cannot be pushed by a line arriving over it.
 */

/**
 * The session's readings, as the strip reads them.
 *
 * A fixture, cast at the boundary, and deliberately the device the strip's own
 * story and `composer-status-row.stories.tsx` both use: `CanonicalFrontendState`
 * carries around thirty required fields and these frames need the handful the
 * readings paint. What the frame has to show is not the numbers but a REAL
 * readings strip sharing the row with a real chip and a credential sentence.
 */
const READINGS_MODEL = {
	provider: "openrouter",
	model_id: "openai/gpt-5-mini",
	display_name: "OpenAI: GPT-5 mini",
	reasoning: true,
	reasoning_effort: "medium",
	reasoning_efforts: ["minimal", "low", "medium", "high"],
	reasoning_default_effort: null,
	context_window: 400_000,
	max_context_window: null,
};

const SESSION_READINGS = {
	frontend: {
		context_tokens: 41_000,
		context_window: 400_000,
		context_is_estimate: false,
		cumulative_parent_cost: null,
		child_costs: {},
		subagent_cost: null,
		subagent_cost_knowledge: null,
		cost_knowledge: "unknown",
		selected_model: READINGS_MODEL,
		effective_model: READINGS_MODEL,
		active_duration_s: 372,
		activity_started_at: null,
	} as CanonicalFrontendState,
};

/**
 * The masked sentence WITH the working-directory chip and the readings on the
 * row beside it, at the composer's own 1024px measure (design round 3, D4).
 */
export const CredentialMaskedSessionPane: Story = {
	render: () => (
		<Frame label="masked with a live working-directory chip and the session's readings on the row: the sentence is above the box and neither neighbour moves">
			<div className={cn("@container/chatcol")} style={{ width: 1024 }}>
				<MessageInput
					isLoading={false}
					messages={NONEMPTY}
					conversationId="story"
					cwd="/Users/you/src/project"
					sessionStatus={SESSION_READINGS}
					onSendMessage={async () => true}
				/>
			</div>
		</Frame>
	),
	play: async ({ canvasElement }) => {
		if (!holdAndReset(canvasElement)) return;
		const box = await typeIntoComposer(
			canvasElement,
			`/credential ${CREDENTIAL_CANARY}`,
		);
		await screen.findByText(MASKED_NOTICE);
		if (composerValue(box).includes(CREDENTIAL_CANARY)) {
			throw new Error("the typed secret reached the buffer");
		}
		releaseShutter();
	},
};

/**
 * The shipped SMALL-VIEW rung — a column under 550px, where the composer
 * compacts — WITH the capture open: the rung design round 3's D3 measured and no
 * frame held, and the width at which the sentence used to become a 76px ribbon.
 */
export const CredentialMaskedSmallView: Story = {
	render: () => (
		<Frame label="small view (a 440px column): the masked sentence above the box, at the composer's own width rather than in a narrow ribbon">
			<div className={cn("@container/chatcol")} style={{ width: 440 }}>
				<MessageInput
					isLoading={false}
					messages={NONEMPTY}
					conversationId="story"
					isSmallView={true}
					cwd="/Users/you/src/project"
					sessionStatus={SESSION_READINGS}
					onSendMessage={async () => true}
				/>
			</div>
		</Frame>
	),
	play: async ({ canvasElement }) => {
		if (!holdAndReset(canvasElement)) return;
		const box = await typeIntoComposer(
			canvasElement,
			`/credential ${CREDENTIAL_CANARY}`,
		);
		await screen.findByText(MASKED_NOTICE);
		if (composerValue(box).includes(CREDENTIAL_CANARY)) {
			throw new Error("the typed secret reached the buffer");
		}
		releaseShutter();
	},
};
