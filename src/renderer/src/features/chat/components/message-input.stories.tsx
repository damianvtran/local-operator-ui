import { cn } from "@shared/lib/utils";
import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import type { Message } from "../types/message";
import type { DirectoryWritePath } from "./directory-indicator";
import { MessageInput } from "./message-input";
import type { SlashCommandMeta } from "./slash-commands";
import type { SlashDispatchOutcome } from "./slash-dispatch";
import type { SlashCommandInvocation } from "./slash-submit";

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
 * rather than incidental: `login` and `logout` are the whole `l` family here, so
 * `/l` has exactly two candidates and its common prefix is `log` — the growth
 * case — where a fixture carrying `loop` too would share only `lo` and grow
 * nothing.
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
 * `docs/evidence/slash-enter-live/` come from.
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
