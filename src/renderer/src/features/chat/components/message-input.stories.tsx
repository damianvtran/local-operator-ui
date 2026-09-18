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
const CLEARED_NOTICE = /Removed LOP_SECRET_[A-Z0-9]+ from this message/;

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
		const clear =
			await within(canvasElement).findByLabelText("Remove credential");
		await userEvent.click(clear);
		await screen.findByText(CLEARED_NOTICE);
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
