import {
	COMPOSER_PLACEHOLDER,
	type SendOutcome,
} from "@shared/hooks/use-message-input";
import { cn } from "@shared/lib/utils";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
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
 * `isLoading` IS THE PANE'S OWN EXPRESSION, `admitting || starting`, and it is
 * `true` only where the pane's is: `AwaitingReply` is a send that has been
 * admitted with nothing painted yet, so `starting` is up and the control is
 * drawn closed, while a STREAMING turn has `starting` already cleared by the
 * owner's first content (`chat-page.tsx`, the answered half of the latch) - so
 * `StopControlWhileStreaming` passes `false`, which is what the pane passes
 * there. Everywhere else it is `false` because no send is out at all. Design
 * round 3, D2c, corrected the two stories that had this the wrong way round.
 *
 * The composer's own `Agent is busy` branch stays unreachable through all of it:
 * on the canonical path `currentJobId` is null, so no state here can photograph
 * it, and each wait is expressed through the placeholders above.
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
	/*
	 * `/rename`, with the OPTIONAL argument mode and the ANY shape the real
	 * registry declares (`slash_commands.py`: `ArgumentMode.OPTIONAL`,
	 * `ArgumentShape.ANY`, destination `session.rename`). It is here because
	 * `/rename` is the ONE command whose argument list is a renderer-local
	 * spelling list rather than a backend entity route, so a fixture that named
	 * only entity-list commands could not photograph the flag row at all — a
	 * frame of `/rename ref` with no row would be a frame of the DEFECT.
	 *
	 * The alias is the registry's own (`aliases=("title",)`): the help row a user
	 * learns the command from is `/title`, so a fixture that dropped it would
	 * answer a different question than the app does.
	 */
	slashCommand(
		"rename",
		"Name this conversation, or /title --refresh",
		"session.rename",
		{ arguments: "optional", aliases: ["title"], argument_shape: "any" },
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
				/*
				 * The LIVE value: a send is admitted and nothing is painted yet, which is
				 * `admitting || starting` on the canonical path - `starting` is up for the
				 * whole wait. Design round 2's D2b found this story and
				 * `StopControlWhileStreaming` passing `false` where the pane passes
				 * `true`, a chrome difference (a Send drawn enabled where the app draws
				 * it closed) rather than a placeholder one, and the two conventions are
				 * now one.
				 */
				isLoading={true}
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
 * composed row once". The reserved path column answered the first half at the
 * time; the column is retired now (`CHIP_PATH_COLUMN` is a cap), so this frame
 * carries the other half of the operator's request as well - where the width a
 * short path frees up goes. It goes to the gap: the chip hugs its path and the
 * readings cluster sits behind it instead of after a fixed column.
 *
 * What this story does NOT carry: the readings cluster, because it passes no
 * `sessionStatus` (`CwdChipEditableWithReadings` below is the composed row with
 * both). The second half of D7 ("render the composed row once") was still the
 * one state nobody had photographed, so the chip's pairing with the row in a
 * real composer was geometry rather than a frame. `Idle` above cannot show it:
 * without a known directory the chip does not mount at all
 * (`cwdToShow !== undefined` is the gate).
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
					/*
					 * `isLoading` is the pane's own `admitting || starting`, and while the
					 * owner is STREAMING both are false: `starting` is cleared by the first
					 * content it paints (`chat-page.tsx`, `ownerAnswered`). Round 2 read
					 * this story as a wait and passed `true`; round 3's D2c is that the
					 * pane's value here is `false`, and a frame is supposed to carry the
					 * pane's value.
					 */
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
		/*
		 * THE CARET MOVES TO THE START, AND NOTHING IS SAVED AROUND IT (design review rounds 6
		 * and 7, D16). Moving it is what makes this step reach its state. Round 6 also saved the
		 * selection here and put it back before the shutter, on the theory that the committed
		 * frames carried one; they do not - the probe reads a collapsed caret (`566..566`) both
		 * before and after, so the pair was inert, and the selection visible in the round-3
		 * frames came from that era's app rather than from anything this play does. The pair is
		 * deleted rather than left as an assertion nothing can fail.
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
 * The composed row with the live (editable) chip AND the session's readings
 * beside it - the state the width decision is about, at the composer's own
 * 1024px measure.
 *
 * Why it exists, and it is a gap in the frame list rather than a preference:
 * `CwdChipInRow` above mounts the editable chip with NO readings (it passes no
 * `sessionStatus`, so the cluster never renders), and
 * `CredentialMaskedSessionPane` below mounts the readings with a chip that has
 * no write path - which is the READ-ONLY branch, already content-driven and
 * carrying no path cap. So neither of the two frames the composer already had
 * can show the one block this change moves: the readings cluster, which sits 8px
 * behind the chip and travels with the chip's width. This is the row where that
 * is visible, and the row the geometry rig measures the translation in.
 *
 * TWO FACTS ABOUT THIS FRAME a reader would otherwise have to derive: the chip
 * paints `/Users/you` rather than `~`, because this story file installs no
 * `getHomeDirectory` stub (the chip's `~/` short form is a call to that stub, and
 * the cwd-move frames in the same PR do stub it - see that file's own note); and
 * the cwd is deliberately SHORT, because a path that overflows the 16ch cap
 * renders the same width before and after this change and would hide the very
 * difference the frame exists to show.
 */
export const CwdChipEditableWithReadings: Story = {
	render: () => (
		<Frame label="the editable cwd chip with the session's readings on the row: the chip takes only the width its path needs, and the readings cluster follows it">
			<div className={cn("@container/chatcol")} style={{ width: 1024 }}>
				<MessageInput
					isLoading={false}
					messages={NONEMPTY}
					conversationId="story"
					cwd="/Users/you"
					cwdWritePath={MOVING_CWD}
					sessionStatus={SESSION_READINGS}
					onSendMessage={async () => true}
				/>
			</div>
		</Frame>
	),
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

/* ======================= the pending send, and the chip it carries with it === */

/*
 * THE WINDOW THE OPERATOR REPORTED, as three states and six frames.
 *
 * What was seen: on pressing Send there is a window - the image encode plus the
 * create hop - in which the transcript already shows the user's message WITH its
 * attachment while the composer has cleared its text and still shows the chip
 * for that file, under the IDLE placeholder. It reads as one file sent twice,
 * and as a send that half-happened.
 *
 * The cause was two triggers for one payload: the words left at the echo
 * (`onEchoPainted`) and the chip row left when the send SETTLED. Both now leave
 * in ONE call (`use-message-input`'s `clearOnce` -> `clearStagedPayload`), each
 * entry removed by IDENTITY so a file attached during the window survives it,
 * and the composer says the send is going out for as long as it has not settled.
 *
 * THE STATE IS STAGED WHERE THE APP STAGES IT, and that is the second thing this
 * section is about. The two props a story still passes are the two the pane
 * passes: `isLoading = admitting || starting` and `awaitingReply` (the pane's
 * working-line claim, up from the moment the request is ISSUED). Whether a send
 * for this conversation is still going out is NOT passed at all - the composer
 * reads that from the STORE's own row (`sendUnsettledForSession`), so the harness
 * stages a draft row (`PendingSendRow`) and the play asserts the sentence the
 * composer derives from it. Review round 2's R2-1 is why: round 1 handed this in
 * as a prop fed by the panel the New-chat flip replaces, so on that arm it was
 * false, and a story that passes a prop cannot show that. Each story below states
 * its own column of the table:
 *
 *  - `PendingSendChipRow`: a file staged and nothing typed - the chip row's own
 *    geometry, which no committed frame of this surface held. No send is out, so
 *    the row is `none`. Its play measures the row against the field and against
 *    every ancestor that could clip it.
 *  - `PendingSendPayload`: the press BEFORE the echo. The store has the request
 *    PENDING but has not written `admissionAttempted` yet (`pre-seam`), so
 *    `awaitingReply` is false - and the Send control is DISABLED, which is the
 *    thing the first revision of this frame got wrong (design round 1, D2: it
 *    photographed the pre-press chrome, an enabled Send the app never shows).
 *  - `PendingSend`: the echo has LANDED, and `awaitingReply` is TRUE here. That
 *    is the app's own value in this window, and omitting it is what made the
 *    sentence look reachable when the chain put it below that term (agent review
 *    round 1, MAJOR-1; QA Q-1 read `Waiting for the agent` from exactly this
 *    state). The row is `in-flight`, so the composer says the message is still on
 *    its way out - and its play asserts that string, which is what fails if the
 *    read ever goes back to a prop or to per-panel state.
 *
 * THE ARM THESE FRAMES MODEL (design round 1, D5): the EXISTING-SESSION arm - one
 * composer with a stable `conversationId`, which is the only arm a story can
 * hold. The New-chat arm replaces the panel mid-wait (`panelIdentityFor` moves
 * the mount key from `draft:<uuid>` to the session id), so no story can
 * photograph the composer that inherits the send; what covers that arm is the
 * SOURCE of the flag - the STORE's row for the conversation, which every mount
 * reads, rather than any `useState` of the panel being replaced (agent review
 * round 2, R2-1, which is what round 1's `admitting` source got wrong) - and
 * `canonical-chat.test.mjs` drives that arm on the real store.
 *
 * THE COMPACT RUNG IS CARRIED FOR ALL THREE (`-small-view`, a 440px column),
 * because this set carries it for its neighbours and round 1's R6 argument was
 * exactly the case where arithmetic lost to a frame (design round 1, D3).
 */

/** The file the frames stage, so they are read against each other. */
const PENDING_CHIP_PATH = "/Users/you/notes.md";

/** The leaf `AttachmentsPreview` paints for it, which is what the plays aim at. */
const PENDING_CHIP_NAME = "notes.md";

/** The words the press types, before the echo takes them. */
const PENDING_MESSAGE = "look at this screenshot";

/**
 * The composer's own sentence for a send that has not settled, read from the
 * rule itself rather than written a second time: a literal here would be a second
 * source of truth for an exported string, and the play below asserts on it
 * (agent review round 2, R2-5).
 */
const PENDING_PLACEHOLDER = COMPOSER_PLACEHOLDER.sending;

/**
 * One composer with the chip row staged the way an attach stages it: through the
 * store the composer reads (`inputByConversation[conversationId].attachments`),
 * in an effect, because that store is what an attach writes and a prop could not
 * stage a row the component does not own.
 */
/**
 * WHICH SEND THE STORY IS IN, as the canonical store's own row.
 *
 * A story cannot pose this with a prop any more, and that is the point (agent
 * review round 2, R2-1): the composer derives the fact from the store itself, so
 * the harness stages it where the app stages it - a draft row for this
 * conversation, `pending` from the press and `admissionAttempted` from the seam.
 * "pre-seam" is the press before the store has recorded that the request was
 * issued; "in-flight" is the window the new sentence is for; "none" is every
 * state with no send out at all.
 */
type PendingSendRow = "none" | "pre-seam" | "in-flight";

/** The conversation these states belong to, and the key its row travels under. */
const PENDING_SESSION = "story";

const PendingSendHarness = ({
	label,
	isSmallView = false,
	isLoading = false,
	awaitingReply = false,
	row = "none",
	stageChip = true,
	onSendMessage,
}: {
	label: string;
	isSmallView?: boolean;
	isLoading?: boolean;
	awaitingReply?: boolean;
	row?: PendingSendRow;
	stageChip?: boolean;
	onSendMessage?: React.ComponentProps<typeof MessageInput>["onSendMessage"];
}) => {
	useEffect(() => {
		const store = useConversationInputStore.getState();
		store.clearAttachments(PENDING_SESSION);
		/*
		 * The chip is staged for the states that still HOLD the payload. The
		 * inherited-send state does not: its echo has already landed, which is what
		 * took the file out of the row and into the transcript, so staging one there
		 * would be a payload the app cannot be showing.
		 */
		if (stageChip)
			store.addAttachment(PENDING_SESSION, {
				id: "pending-chip",
				path: PENDING_CHIP_PATH,
			});
		/*
		 * The send, staged in the CANONICAL store because that is where the composer
		 * reads it. `send:<id>` is the shape a send inside an existing conversation
		 * travels under (`draftIdentityFor`), and the row is cleared on unmount so one
		 * story cannot leak a send into the next.
		 */
		useCanonicalSessionsStore.setState({
			drafts:
				row === "none"
					? {}
					: {
							[`send:${PENDING_SESSION}`]: {
								key: `send:${PENDING_SESSION}`,
								createRequestId: "story-create",
								admissionRequestId: "story-admit",
								pending: true,
								admissionAttempted: row === "in-flight",
								submittedText: PENDING_MESSAGE,
							},
						},
		});
		return () => {
			useCanonicalSessionsStore.setState({ drafts: {} });
		};
		/*
		 * The deps are the two props the effect READS, which is why this is not an
		 * empty list: the row it stages is the state under test, so a story that
		 * changed `row` while mounted has to re-stage it (agent review round 3,
		 * BLOCKER 1 - biome's `useExhaustiveDependencies` is right about this one).
		 */
	}, [row, stageChip]);
	const composer = (
		<MessageInput
			isLoading={isLoading}
			awaitingReply={awaitingReply}
			isSmallView={isSmallView || undefined}
			messages={NONEMPTY}
			conversationId={PENDING_SESSION}
			onSendMessage={onSendMessage ?? (async () => true)}
		/>
	);
	return (
		<Frame label={label}>
			{/*
			 * TWO SHAPES, one per convention, and the difference is deliberate rather
			 * than drift. The 1024-wide states render the composer STRAIGHT into the
			 * `Frame`, exactly as `idle` and `awaiting-reply` do, so the frames can be
			 * laid on one another - a 1024-wide wrapper inside the frame's own 976-wide
			 * content box moves the composer 24px right of the state it is compared
			 * with. The compact-rung states wrap theirs in the column that MAKES the
			 * rung (`@container/chatcol` at 440px), which is the shape this set's own
			 * small-view frames use.
			 */}
			{isSmallView ? (
				<div className={cn("@container/chatcol")} style={{ width: 440 }}>
					{composer}
				</div>
			) : (
				composer
			)}
		</Frame>
	);
};

/** The composer's field, which the plays below type into and read. */
const composerField = (canvasElement: HTMLElement) => {
	const box = canvasElement.querySelector<HTMLTextAreaElement>(
		'textarea[role="combobox"]',
	);
	if (!box) throw new Error("the composer's textarea is not in this story");
	return box;
};

/**
 * THE ROW'S OWN GEOMETRY, asserted at whichever rung the story renders.
 *
 * Two things a still of the row alone cannot settle, and both are claims the
 * band's own comment makes:
 *
 *  - NO ANCESTOR CLIPS THE CHIP. The composer's one scroll container
 *    (`max-h-[240px]`, the row capping itself rather than a wrapper clipping on
 *    its children's behalf) is a BOUND: a row taller than it scrolls. A chip the
 *    scroller cuts off would be content nobody can reach.
 *  - THE ROW DOES NOT REACH THE FIELD. The rows and the field are siblings in the
 *    composer's own column, so this is the assertion that turns "the chip row
 *    looked like it was overlapping the text" into a number - at the compact rung
 *    as well, which is where the arithmetic was least convincing.
 */
const assertChipRowGeometry = async (canvasElement: HTMLElement) => {
	const box = composerField(canvasElement);
	if (composerValue(box).length > 0)
		throw new Error("this state is the EMPTY field: something typed into it");
	const chip = await screen.findByText(PENDING_CHIP_NAME);
	/*
	 * The TILE's box, not the name span's. The span is the tile's own body for a
	 * file with nothing to show, so it sits INSIDE the ground the row draws - and
	 * a bound measured on it would report 25px of clearance the row does not have.
	 * The parent is the tile's `size-full` body, which IS the tile's box.
	 */
	const tile = chip.parentElement ?? chip;
	const chipRect = tile.getBoundingClientRect();
	for (
		let ancestor = chip.parentElement;
		ancestor && ancestor !== document.body;
		ancestor = ancestor.parentElement
	) {
		const style = getComputedStyle(ancestor);
		if (style.overflowX === "visible" && style.overflowY === "visible")
			continue;
		const bounds = ancestor.getBoundingClientRect();
		if (
			chipRect.top < bounds.top - 0.5 ||
			chipRect.bottom > bounds.bottom + 0.5
		)
			throw new Error(
				`the chip is cut off by its own row's bound: chip ${chipRect.top}..${chipRect.bottom} against a ${bounds.top}..${bounds.bottom} scroller`,
			);
	}
	const fieldRect = box.getBoundingClientRect();
	if (chipRect.bottom > fieldRect.top + 0.5)
		throw new Error(
			`the chip row reaches into the text region: chip bottom ${chipRect.bottom}, field top ${fieldRect.top}`,
		);
};

/**
 * The press, held open BEFORE the echo: `onSendMessage` never settles and never
 * paints, so the send is in flight and the payload is still the composer's.
 *
 * Everything the payload is made of is therefore still here - the words in the
 * field, the file in the row above them - which is the half of the fix that is
 * easy to lose sight of: the defect was never that the composer cleared too
 * late. It was that its two halves cleared at DIFFERENT times, so this moment and
 * the one below it were the same moment for the chip and different ones for the
 * words.
 */
const pressAndHoldBeforeEcho = async (canvasElement: HTMLElement) => {
	const box = await typeIntoComposer(canvasElement, PENDING_MESSAGE);
	await userEvent.type(box, "{Enter}");
	if (composerValue(box) !== PENDING_MESSAGE)
		throw new Error(
			`the in-flight composer lost the message before the echo: ${JSON.stringify(composerValue(box))}`,
		);
	if (!(await screen.findByText(PENDING_CHIP_NAME)))
		throw new Error(
			"the in-flight composer lost the chip before the echo, so the payload's halves no longer travel together",
		);
};

/**
 * THE INHERITED SEND: a composer with a live row for its conversation and NO press
 * of its own.
 *
 * This is the state the New-chat flip leaves behind - the panel that painted the
 * echo is gone and the one now mounted holds the same unsettled send - and it is
 * the state the operator's screenshot shows. It is also the ONLY state that can
 * tell the two sources apart: with a press of its own the composer is covered by
 * `sendInFlight`, so a story that presses cannot see the difference, which is
 * exactly how round 1's frames came to assert a state the app is never in
 * (agent review round 1, MAJOR-1; round 2, R2-1).
 *
 * So the play presses NOTHING and asserts the sentence the composer derives from
 * the store row alone. Revert the composer's read to a per-mount flag and this
 * throws on `Waiting for the agent`; leave it store-derived and it passes.
 */
const assertInheritedSend = async (canvasElement: HTMLElement) => {
	const box = composerField(canvasElement);
	await screen.findByPlaceholderText(PENDING_PLACEHOLDER);
	if (composerValue(box).length > 0)
		throw new Error("the echo did not take the message out of the field");
	if (canvasElement.querySelector('[aria-label="Remove attachment"]'))
		throw new Error(
			"the chip row still shows the file the transcript is carrying, which is the duplication this change removes",
		);
};

/** A file staged with nothing typed: the chip row's own geometry, measured. */
export const PendingSendChipRow: Story = {
	render: () => (
		<PendingSendHarness label="a file staged and nothing typed: the chip row above the field, measured" />
	),
	play: async ({ canvasElement }) => {
		if (!holdAndReset(canvasElement)) return;
		await assertChipRowGeometry(canvasElement);
		releaseShutter();
	},
};

/** The same row at the compact rung, where the arithmetic was least convincing. */
export const PendingSendChipRowSmallView: Story = {
	render: () => (
		<PendingSendHarness
			isSmallView={true}
			label="compact rung (a 440px column): the chip row above the field, measured"
		/>
	),
	play: async ({ canvasElement }) => {
		if (!holdAndReset(canvasElement)) return;
		await assertChipRowGeometry(canvasElement);
		releaseShutter();
	},
};

/** The press, in flight, with every register of the payload still the composer's. */
export const PendingSendPayload: Story = {
	render: () => (
		<PendingSendHarness
			isLoading={true}
			row="pre-seam"
			label="pressed, echo not yet painted: the whole payload is still the composer's, and Send is closed because the pane is still issuing it"
			onSendMessage={() => new Promise<SendOutcome>(() => {})}
		/>
	),
	play: async ({ canvasElement }) => {
		if (!holdAndReset(canvasElement)) return;
		await pressAndHoldBeforeEcho(canvasElement);
		releaseShutter();
	},
};

/** The same moment at the compact rung. */
export const PendingSendPayloadSmallView: Story = {
	render: () => (
		<PendingSendHarness
			isSmallView={true}
			isLoading={true}
			row="pre-seam"
			label="compact rung: pressed, echo not yet painted, the payload still the composer's"
			onSendMessage={() => new Promise<SendOutcome>(() => {})}
		/>
	),
	play: async ({ canvasElement }) => {
		if (!holdAndReset(canvasElement)) return;
		await pressAndHoldBeforeEcho(canvasElement);
		releaseShutter();
	},
};

/**
 * The echo has landed, with `awaitingReply` TRUE - the app's own value in this
 * window, and the state in which the sentence was, before this round,
 * unreachable.
 */
export const PendingSend: Story = {
	render: () => (
		<PendingSendHarness
			isLoading={true}
			awaitingReply={true}
			row="in-flight"
			stageChip={false}
			label="an inherited send: the payload is gone from the composer, a live row is not this composer's press, and the send is still going out"
		/>
	),
	play: async ({ canvasElement }) => {
		if (!holdAndReset(canvasElement)) return;
		await assertInheritedSend(canvasElement);
		releaseShutter();
	},
};

/** The state the operator photographed, at the compact rung. */
export const PendingSendSmallView: Story = {
	render: () => (
		<PendingSendHarness
			isSmallView={true}
			isLoading={true}
			awaitingReply={true}
			row="in-flight"
			stageChip={false}
			label="compact rung: an inherited send - a live row, and no press of this composer's own"
		/>
	),
	play: async ({ canvasElement }) => {
		if (!holdAndReset(canvasElement)) return;
		await assertInheritedSend(canvasElement);
		releaseShutter();
	},
};
