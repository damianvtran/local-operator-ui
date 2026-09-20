import {
	desktopFeatureEnabled,
	desktopKeys,
} from "@shared/api/local-operator/desktop-hooks";
import { cn } from "@shared/lib/utils";
import { useConversationInputStore } from "@shared/store/conversation-input-store";
/*
 * The composer's slash syntax highlight, in the SHIPPED composer, in twelve themes.
 *
 * WHAT THIS IS: the repository's own `MessageInput`, rendered in the repository's
 * own Storybook preview, with ONE stand-in — `window.api.desktop`, the transport
 * that reaches a backend. It answers the ops the composer's slash surface reads
 * (`capabilities`, `commands.list`, `commands.entities`) with the REAL registry
 * dumped from the core runtime's `command_catalogue()` (`local-operator` at
 * `efd48c10a`), so the tinted runs come from the shipped builder over the shipped
 * registry rather than from a story-local vocabulary.
 *
 * The DRAFTS are seeded into the store the composer reads its draft from
 * (`conversation-input-store`, the same path a restored draft takes), so a frame
 * is the app rendering a draft rather than a value poked into the DOM after the
 * fact — which matters here, because the highlight is derived from the draft the
 * component holds.
 *
 * WHAT IT IS NOT: a live-app run. There is no backend, so the roster the NAME run
 * is checked against comes from the fixture below; the driver scene
 * (`scripts/renderer-driver.mjs --scene composer`) is where the geometry is
 * measured with numbers.
 */
import type { Meta, StoryObj } from "@storybook/react";
import { screen, userEvent } from "@storybook/test";
import { useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState } from "react";
import type { Message } from "../types/message";
import { MessageInput } from "./message-input";
import type { SlashDispatchOutcome } from "./slash-dispatch";
import type { SlashCommandInvocation } from "./slash-submit";

/* ------------------------------------------------------------------ fixtures */

/**
 * The shared registry, dumped from `command_catalogue()` — the same rows the
 * desktop receives, including the six `consumes_prompt` commands (`/fork`,
 * `/goal`, `/loop`, `/btw`, `/team`, `/agent`) the highlight rule turns on.
 */
const COMMANDS = [
	{
		name: "help",
		description: "List all commands",
		aliases: [],
		arguments: "none",
		echo: false,
		consumes_prompt: false,
		destination: "commands",
		execution: "native",
	},
	{
		name: "exit",
		description: "Quit the app",
		aliases: ["quit"],
		arguments: "none",
		echo: false,
		consumes_prompt: false,
		destination: "window.close",
		execution: "native",
	},
	{
		name: "clear",
		description: "Clear the transcript (history is untouched)",
		aliases: [],
		arguments: "none",
		echo: false,
		consumes_prompt: false,
		destination: "transcript.clear",
		execution: "native",
	},
	{
		name: "copy",
		description: "Copy an agent message or code block",
		aliases: [],
		arguments: "none",
		echo: false,
		consumes_prompt: false,
		destination: "transcript.copy",
		execution: "native",
	},
	{
		name: "new",
		description: "Start a new conversation",
		aliases: [],
		arguments: "none",
		echo: false,
		consumes_prompt: false,
		destination: "sessions.new",
		execution: "native",
	},
	{
		name: "reload",
		description: "Relaunch this conversation on the current install",
		aliases: [],
		arguments: "none",
		echo: false,
		consumes_prompt: false,
		destination: "sessions.reload",
		execution: "native",
	},
	{
		name: "update",
		description: "Install the latest version from PyPI and relaunch",
		aliases: [],
		arguments: "none",
		echo: false,
		consumes_prompt: false,
		destination: "updates",
		execution: "native",
	},
	{
		name: "resume",
		description: "Pick a past conversation to resume, or resume one (id)",
		aliases: ["recall"],
		arguments: "none",
		echo: false,
		consumes_prompt: false,
		destination: "sessions.resume",
		execution: "native",
	},
	{
		name: "move",
		description: "Change this session's working directory",
		aliases: [],
		arguments: "optional",
		echo: false,
		consumes_prompt: false,
		destination: "session.move",
		execution: "native",
	},
	{
		name: "rename",
		description: "Name this conversation, or /title --refresh",
		aliases: ["title"],
		arguments: "optional",
		echo: false,
		consumes_prompt: false,
		destination: "session.rename",
		execution: "owner",
	},
	{
		name: "fork",
		description:
			"Branch this chat; --switch here, --window elsewhere; <message> starts work",
		aliases: [],
		arguments: "none",
		echo: true,
		consumes_prompt: true,
		destination: "session.fork",
		execution: "native",
	},
	{
		name: "model",
		description: "Switch model; /model default saves it for new sessions",
		aliases: ["models"],
		arguments: "none",
		echo: false,
		consumes_prompt: false,
		destination: "session.model",
		execution: "owner",
	},
	{
		name: "effort",
		description: "Show or set reasoning effort (shift+tab cycles)",
		aliases: [],
		arguments: "optional",
		echo: false,
		consumes_prompt: false,
		destination: "session.effort",
		execution: "owner",
	},
	{
		name: "fast",
		description: "Toggle faster output at premium pricing",
		aliases: [],
		arguments: "optional",
		echo: false,
		consumes_prompt: false,
		destination: "session.fast",
		execution: "owner",
	},
	{
		name: "theme",
		description: "Switch color theme; arrows preview live",
		aliases: ["themes"],
		arguments: "optional",
		echo: false,
		consumes_prompt: false,
		destination: "appearance",
		execution: "native",
	},
	{
		name: "provider",
		description: "List providers and their login/usage state",
		aliases: [],
		arguments: "none",
		echo: false,
		consumes_prompt: false,
		destination: "providers",
		execution: "native",
	},
	{
		name: "settings",
		description: "Change every setting on one page",
		aliases: ["config"],
		arguments: "none",
		echo: false,
		consumes_prompt: false,
		destination: "settings",
		execution: "native",
	},
	{
		name: "sidebar",
		description: "Show or hide active and recent conversations",
		aliases: [],
		arguments: "none",
		echo: false,
		consumes_prompt: false,
		destination: "sessions.sidebar",
		execution: "native",
	},
	{
		name: "search",
		description: "Configure web search providers and load balancing",
		aliases: [],
		arguments: "none",
		echo: false,
		consumes_prompt: false,
		destination: "settings.search",
		execution: "native",
	},
	{
		name: "accounts",
		description: "List stored credentials",
		aliases: [],
		arguments: "none",
		echo: false,
		consumes_prompt: false,
		destination: "accounts",
		execution: "native",
	},
	{
		name: "failovers",
		description: "Show the model failover cascade and what is serving",
		aliases: [],
		arguments: "none",
		echo: false,
		consumes_prompt: false,
		destination: "session.failovers",
		execution: "native",
	},
	{
		name: "usage",
		description: "Show provider usage quota",
		aliases: [],
		arguments: "none",
		echo: false,
		consumes_prompt: false,
		destination: "usage",
		execution: "native",
	},
	{
		name: "context",
		description: "Show prompt, tool-schema and message token usage",
		aliases: [],
		arguments: "none",
		echo: false,
		consumes_prompt: false,
		destination: "session.context",
		execution: "owner",
	},
	{
		name: "session",
		description: "Current-session usage, cost and request diagnostics",
		aliases: [],
		arguments: "none",
		echo: false,
		consumes_prompt: false,
		destination: "session.diagnostics",
		execution: "native",
	},
	{
		name: "analytics",
		description: "Aggregated token-consumption analytics across all sessions",
		aliases: [],
		arguments: "optional",
		echo: false,
		consumes_prompt: false,
		destination: "analytics",
		execution: "native",
	},
	{
		name: "goal",
		description: "Set the goal and start work; show or clear it",
		aliases: [],
		arguments: "none",
		echo: true,
		consumes_prompt: true,
		destination: "session.goal",
		execution: "owner",
	},
	{
		name: "loop",
		description:
			"Loop toward a goal: /loop <goal text>, /loop <n>, or /loop stop to cancel",
		aliases: [],
		arguments: "none",
		echo: false,
		consumes_prompt: true,
		destination: "session.loop",
		execution: "owner",
	},
	{
		name: "btw",
		description: "Ask a side question off the record (esc closes it)",
		aliases: [],
		arguments: "none",
		echo: false,
		consumes_prompt: true,
		destination: "session.aside",
		execution: "native",
	},
	{
		name: "compact",
		description: "Compact the context now",
		aliases: [],
		arguments: "none",
		echo: false,
		consumes_prompt: false,
		destination: "session.compact",
		execution: "owner",
	},
	{
		name: "stop",
		description:
			"End this session, another by name/pid, or all \u2014 /resume reopens it",
		aliases: [],
		arguments: "optional",
		echo: false,
		consumes_prompt: false,
		destination: "sessions.stop",
		execution: "native",
	},
	{
		name: "approvals",
		description: "Show or set tool approval mode; add default to keep it",
		aliases: [],
		arguments: "optional",
		echo: false,
		consumes_prompt: false,
		destination: "session.approvals",
		execution: "owner",
	},
	{
		name: "skills",
		description: "List loaded skills",
		aliases: [],
		arguments: "none",
		echo: false,
		consumes_prompt: false,
		destination: "skills",
		execution: "native",
	},
	{
		name: "mcp",
		description: "List MCP servers; add/remove one, or manage an OAuth grant",
		aliases: [],
		arguments: "optional",
		echo: false,
		consumes_prompt: false,
		destination: "mcp",
		execution: "native",
	},
	{
		name: "login",
		description: "Authenticate a provider",
		aliases: [],
		arguments: "required",
		echo: false,
		consumes_prompt: false,
		destination: "auth.login",
		execution: "native",
	},
	{
		name: "logout",
		description: "Remove stored provider credentials",
		aliases: [],
		arguments: "required",
		echo: false,
		consumes_prompt: false,
		destination: "auth.logout",
		execution: "native",
	},
	{
		name: "credential",
		description: "Type or paste a secret after a space; masked",
		aliases: ["cred"],
		arguments: "optional",
		echo: false,
		consumes_prompt: false,
		destination: "session.credential",
		execution: "native",
	},
	{
		name: "team",
		description:
			"List teams, chart a team's org, or send a request to a team's manager",
		aliases: ["teams"],
		arguments: "optional",
		echo: false,
		consumes_prompt: true,
		destination: "session.team",
		execution: "owner",
	},
	{
		name: "agent",
		description: "List agents, or speak to this session as one",
		aliases: ["agents"],
		arguments: "optional",
		echo: false,
		consumes_prompt: true,
		destination: "session.agent",
		execution: "owner",
	},
] as const;

/** The roster the `commands.entities` stub answers `/team`'s list with. */
const TEAM_ENTITIES = [
	{
		name: "frontend-guild",
		value: "frontend-guild",
		description: "Owns the desktop surfaces",
	},
	{
		name: "ops",
		value: "ops",
		description: "Runs the deployments",
	},
];

(function installDesktopFixture() {
	const api =
		(window as unknown as { api?: Record<string, unknown> }).api ?? {};
	(window as unknown as { api: Record<string, unknown> }).api = api;
	api.backend = {
		getStatus: async () => ({ state: "attached", url: "http://127.0.0.1:9/" }),
	};
	api.desktop = {
		request: async (request: { op: string; command?: string }) => {
			if (request.op === "capabilities") {
				return {
					status: 200,
					body: {
						result: {
							desktop_contract: 1,
							desktop_available: true,
							desktop_auth: "bearer",
							features: { commands: 2, catalogues: 1, sessions: 1 },
						},
					},
				};
			}
			if (request.op === "commands.list") {
				return { status: 200, body: { result: { commands: COMMANDS } } };
			}
			if (request.op === "commands.entities") {
				return {
					status: 200,
					body: { result: { entities: TEAM_ENTITIES, current: "" } },
				};
			}
			if (request.op === "config.get") {
				return {
					status: 200,
					body: {
						result: { version: "1", metadata: {}, values: { hosting: "" } },
					},
				};
			}
			if (request.op === "credentials.list") {
				return { status: 200, body: { result: { keys: [] } } };
			}
			return { status: 200, body: { result: {} } };
		},
	};
})();

/*
 * The desktop bridge, installed at MODULE SCOPE for the same reason the
 * component's own story does it (see `message-input.stories.tsx`): the composer
 * reaches `window.electron.ipcRenderer` from a passive effect on mount and
 * Storybook's preview mocks `window.api` rather than `window.electron`.
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

/* ------------------------------------------------------------------- harness */

/**
 * One conversation id PER COMPOSER, and the reason is not tidiness: every
 * composer subscribes to its own draft key in `conversation-input-store`, so two
 * boxes sharing one key are two components writing each other's value — the
 * geometry story mounts three, and the first version of this harness seeded them
 * all under one id (measured: the store write landed on the wrong boxes and a
 * two-line draft rendered as an empty single-row field, with React warning that a
 * component was updated while another rendered). The ids are stable strings so a
 * re-render re-seeds the same key.
 */
/**
 * The y term of a computed `transform`, in px, and 0 for `none`.
 *
 * The mirror's window is kept on the textarea's by writing `translateY(-scrollTop)`
 * straight to the node, so that term is the value under test: `matrix(a, b, c, d,
 * tx, ty)` keeps it last, and `translateY(y)` — which Chromium resolves to a matrix
 * for any non-`none` value — has it first.
 */
function readTranslateY(element: HTMLElement): number {
	const transform = getComputedStyle(element).transform;
	if (!transform || transform === "none") return 0;
	const parts = transform
		.slice(transform.indexOf("(") + 1, transform.lastIndexOf(")"))
		.split(",");
	return Number.parseFloat(parts.length >= 6 ? parts[5] : parts[0]) || 0;
}

/**
 * The transparent-caret reading the settled pass refuses, as a named constant: a
 * literal at the call site is what the linter's `useTopLevelRegex` rule flags, and
 * the reason the pass refuses is easier to read beside the guard anyway.
 */
const TRANSPARENT = /^rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/;

/**
 * How many times the settled pass may be re-taken when it reads a transparent
 * caret under a rendered mirror (see the guard in `GeometryProbe`). Three attempts
 * over ~450ms is far longer than the theme-CSS race that produces the reading, and
 * short enough that a genuine defect fails the capture instead of hanging it.
 */
const MAX_SETTLE_RETRIES = 3;

const conversationIdFor = (label: string) => `slash-highlight-${label}`;

const NONEMPTY: Message[] = [
	{ id: "canonical", role: "system", timestamp: new Date(0) },
];

const EMPTY_INPUT = {
	currentInput: "",
	submittedMessages: [] as string[],
	currentHistoryIndex: null,
	replies: [],
	attachments: [],
};

/**
 * THE HARNESS'S OWN DISPATCHER — half of the capability the tint is gated on.
 *
 * The highlight's gate asks the mount's planner whether Enter would run the word,
 * and this composer's planner needs the feature ON *and* somewhere to hand the
 * command (`slash.available && Boolean(onSlashCommand)`). The bridge below
 * advertises the `commands` feature; this is the other half. Without it the gate
 * is correct and the answer for every harness draft is "send" — nothing paints,
 * which is why the component briefly took an `enabled` override instead and, in
 * doing so, let the paint and Enter answer from different capabilities (code
 * review round 1 MAJOR 1). A harness that wants to photograph the tint therefore
 * has to BE a mount that would run the command: it supplies a dispatcher.
 *
 * It RECORDS rather than runs — the dialog a command opens is the dispatcher's
 * path, which this surface does not render — and it answers `consumed`, the same
 * outcome and the same recorder idiom as the composer's own gesture harness
 * (`message-input.stories.tsx`). No play function in this file presses Enter, so
 * the record is never read; it exists so the prop is a real dispatcher rather
 * than a function that would lie if it were called.
 */
const dispatchedInHarness: SlashCommandInvocation[] = [];
const harnessDispatch = async (
	invocation: SlashCommandInvocation,
): Promise<SlashDispatchOutcome> => {
	dispatchedInHarness.push(invocation);
	return "consumed";
};

/**
 * The composer with a draft in it, seeded the way the app seeds one.
 *
 * The store write happens in the PARENT's render, before `MessageInput` mounts,
 * and that ordering is the whole mechanism: `use-message-input` seeds its local
 * value from the store on mount, so a write afterwards would need the store's
 * external-write path to notice it. Nothing is mounted that subscribes to this
 * key at this point, so the write notifies nobody mid-render.
 */
const Draft = ({
	label,
	draft,
	unavailable = false,
	narrowTo,
}: {
	label: string;
	draft: string;
	unavailable?: boolean;
	/**
	 * Narrow the composer's own box to this CSS width, by its tour tag — the same
	 * handle the driver scene narrows for its 360px probe.
	 *
	 * HERE rather than in the probe that first needed it, because the boundary case
	 * is a STATE a frame should show on its own (`clipped-boundary`) as well as a
	 * readback in the geometry panel, and two copies of a width write is how one of
	 * them ends up measuring a column the other one sets.
	 *
	 * WHY A WIDTH AT ALL. The clipped case QA round 1 Q1 measured is a 78-character
	 * draft against a 782px column: 780.67px of advance at the textarea's own
	 * metrics, 782.77px with the command run a real weight heavier. The defect lives
	 * in that 2.1px window — the same draft is one row at BOTH weights on a wider
	 * column — so a frame or a guard that has to be able to FAIL when the weight
	 * comes back has to reproduce the column as well as the draft.
	 */
	narrowTo?: number;
}) => {
	const conversationId = conversationIdFor(label);
	const boxRef = useRef<HTMLDivElement | null>(null);
	useLayoutEffect(() => {
		if (narrowTo === undefined) return;
		const target = boxRef.current?.querySelector(
			'[data-tour-tag="chat-input-textarea"]',
		) as HTMLElement | null;
		if (!target) {
			throw new Error(
				"the narrow harness found no composer box to size; its frame would show the full-width column and the boundary case it exists for would go unmeasured",
			);
		}
		target.style.width = `${narrowTo}px`;
	}, [narrowTo]);
	useConversationInputStore.setState((state) => ({
		inputByConversation: {
			...state.inputByConversation,
			[conversationId]: {
				...(state.inputByConversation[conversationId] ?? EMPTY_INPUT),
				currentInput: draft,
			},
		},
	}));
	return (
		<div ref={boxRef} className={cn("contents")}>
			<MessageInput
				isLoading={false}
				messages={NONEMPTY}
				conversationId={conversationId}
				/*
				 * A session's props, so the slash surface treats this pane as live and
				 * the roster query is enabled — which is what the NAME run reads. The
				 * frontend snapshot is null because none of these frames is about the
				 * status strip.
				 */
				sessionStatus={{ frontend: null, onCommand: () => {} }}
				unavailable={unavailable}
				onSendMessage={async () => true}
				onSlashCommand={harnessDispatch}
			/>
		</div>
	);
};

/**
 * The composer with a draft TYPED into it, for the states whose tint depends on
 * where the caret is.
 *
 * WHY THIS STILL EXISTS BESIDE `Draft`, AND WHAT CHANGED. `planForDraft` reads the
 * token AT the caret, so a draft merely SEEDED into the store used to leave the
 * composer's caret at offset 0 — a position no token claims — and Enter would send
 * it as a message. That was true when this block was written and is NOT true at
 * this head: the composer now seeds a restored draft's caret through its own
 * caret machinery (the `pendingCaret` + `setCaret` pair), so a seeded draft reads
 * as its own leading line again, exactly as the typed copy does.
 *
 * Measured rather than argued (design round 5): the RESTORED frame
 * (`seeded-name-instruction`) is pixel-identical to the typed one — whole-frame AE
 * 0 against it — and the falsifier arm, the same story with the seed disabled,
 * paints nothing (AE 2543). So this harness is kept for the states whose tint
 * depends on a caret the test drives itself, and the restored path has its own
 * story beside it rather than being inferred from this one.
 */
const TypedDraft = ({ label }: { label: string }) => {
	const conversationId = conversationIdFor(label);
	const queryClient = useQueryClient();
	useLayoutEffect(() => {
		queryClient.setQueryData(desktopKeys.commands, COMMANDS);
		for (const command of ["team", "agent"]) {
			queryClient.setQueryData(
				["desktop", "entities", conversationId, command, ""],
				{ entities: TEAM_ENTITIES, current: "" },
			);
		}
	}, [queryClient, conversationId]);
	return (
		<MessageInput
			isLoading={false}
			messages={NONEMPTY}
			conversationId={conversationId}
			sessionStatus={{ frontend: null, onCommand: () => {} }}
			onSendMessage={async () => true}
			onSlashCommand={harnessDispatch}
		/>
	);
};

/**
 * PROBE HARNESS (design round 5, not for commit): the restored draft with the
 * roster query seeded, so the seeded path and the typed path can be compared on
 * one build.
 *
 * `TypedDraft` types the draft and deliberately does NOT seed the store; `Draft`
 * seeds the store and does NOT seed the roster query. The state design round 1's
 * D1 was about needs BOTH, which is why it needs this third harness rather than
 * either of the two.
 */
const SeededDraft = ({ label, draft }: { label: string; draft: string }) => {
	const conversationId = conversationIdFor(label);
	const queryClient = useQueryClient();
	useLayoutEffect(() => {
		queryClient.setQueryData(desktopKeys.commands, COMMANDS);
		for (const command of ["team", "agent"]) {
			queryClient.setQueryData(
				["desktop", "entities", conversationId, command, ""],
				{ entities: TEAM_ENTITIES, current: "" },
			);
		}
	}, [queryClient, conversationId]);
	return <Draft label={label} draft={draft} />;
};

const Frame = ({
	label,
	width = 900,
	children,
}: {
	label: string;
	width?: number;
	children: React.ReactNode;
}) => (
	/*
	 * `pt-24` because the slash popup renders `bottom-full` ABOVE the composer: in
	 * a canvas anchored at the top the list would be clipped off the frame, so the
	 * room it needs is part of the harness rather than of the component.
	 */
	<div
		className={cn("flex flex-col gap-3 bg-canvas px-6 pt-24 pb-6")}
		style={{ width }}
	>
		<span className={cn("font-mono text-ink-dim text-mono-sm")}>{label}</span>
		{children}
	</div>
);

const meta: Meta = {
	title: "Chat/Slash highlight",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** A recognised command word, alone: the tint on structure, nothing else. */
export const CommandAlone: Story = {
	name: "command-alone",
	render: () => (
		<Frame label="command-alone — a whole-draft command word">
			<Draft label="command-alone" draft="/compact" />
		</Frame>
	),
};

/**
 * A start command: the word, the ROSTER NAME, and the instruction in prose.
 *
 * ONE CONTENT LINE, and that is the state this host's planner produces a tint in
 * (see the neighbouring story for the multi-line shape and why it paints
 * nothing). It is the design's headline: `/team` takes the command ink, the
 * resolved name takes the name ink, and the instruction — which is what the
 * command will NOT send as message text — stays prose.
 */
export const StartNameInstruction: Story = {
	name: "start-name-instruction",
	/*
	 * THE DRAFT IS TYPED, and the caret is why (see `TypedDraft`). A click and an
	 * `End` were tried first and are NOT enough: the composer's caret is its own
	 * state, updated from the field's change and select events, and a programmatic
	 * selection left that state at 0 while the DOM showed the caret at the end —
	 * so the frame photographed a plan (`send`) its own pixels disagreed with.
	 */
	play: async () => {
		/*
		 * `clear` first, because a play function is not guaranteed to run once:
		 * observed on this harness, the typed draft arrived TWICE at the caret
		 * ("/team frontend-guild review the queue/team frontend-guild review the
		 * queue"), which is a frame of no state the app can be in. Clearing makes
		 * the gesture idempotent: whatever the field holds, the play leaves it
		 * holding the draft.
		 */
		const field = await screen.findByLabelText("Message");
		await userEvent.clear(field);
		await userEvent.type(field, "/team frontend-guild review the queue");
	},
	render: () => (
		<Frame label="start-name-instruction — /team <name> <instruction>">
			<TypedDraft label="start-name-instruction" />
		</Frame>
	),
};

/**
 * PROBE HARNESS (design round 5, not for commit): the SAME draft as
 * `start-name-instruction`, restored from the store instead of typed — no
 * keystroke, no caret write, no gesture of any kind.
 */
export const SeededNameInstruction: Story = {
	name: "seeded-name-instruction",
	render: () => (
		<Frame label="seeded-name-instruction — the same draft, restored rather than typed">
			<SeededDraft
				label="seeded-name-instruction"
				draft="/team frontend-guild review the queue"
			/>
		</Frame>
	),
};

/**
 * The same command with its instruction spanning lines: **the runs ARE painted**,
 * and the frame exists to show that as well as the tint it produces.
 *
 * THIS STORY'S CLAIM WAS THE INVERSE UNTIL THE LEADING-LINE RULE LANDED, and the
 * correction is the record of what changed rather than a tidy-up. The run rule has
 * always computed both runs for this draft (`command` `/team` and the name after
 * it), and what used to withhold them was the PLAN: with the caret at the end of
 * the draft, `planSlashSubmission` answered `send`, so the tint followed Enter and
 * painted nothing, and the frame documented that as the honest picture of a draft
 * Enter would post as a message.
 *
 * It no longer does. With no token at the caret the planner now reads the LEADING
 * line, and only for a word the endpoint says owns its tail whatever it says —
 * `/team` is one, which is exactly the case this story depicts — so the plan for
 * this draft is `reassemble`: the runs paint, and Enter stages the draft as one
 * line for the user to read before running it. The `argumentShape` vocabulary is
 * what says so; with no wire at all the free-text half of the registry answers
 * instead, so an older backend reaches the same plan here.
 *
 * THE FRAMES BESIDE THIS STORY WERE RE-SHOT, and they now show what this docblock
 * says. `docs/evidence/chat-slash-highlight/name-instruction-multiline/` was first
 * captured while the planner still answered `send` for this draft, so those stills
 * depicted the interaction this change removed; the round that closed the deferral
 * re-took all twelve themes from this tree
 * (`node scripts/capture-evidence.mjs <origin> --only=name-instruction-multiline
 * --allow-backend`), which is the one state this change repaints. The manifest
 * records that run itself rather than the sentence that used to stand here:
 * `captureOrigin.wireVocabularyReShoot`, the `partialCapture` fields that moved
 * with it, and the two tree stamps that name the tree the frames came from. A
 * still that contradicts the story it sits under is the defect class this
 * paragraph exists to keep visible, so if this rule moves again, the frames move
 * with it.
 */
export const NameInstructionMultiline: Story = {
	name: "name-instruction-multiline",
	/*
	 * Typed, so the caret ends where a user's would: at the end of the draft, in
	 * the instruction. That is the state the plan reads, and the one this frame is
	 * about — and the state the leading-line rule exists for.
	 */
	play: async () => {
		const field = await screen.findByLabelText("Message");
		await userEvent.clear(field);
		await userEvent.type(
			field,
			"/team frontend-guild review the queue\nand then send it on to the reviewer",
		);
	},
	render: () => (
		<Frame label="name-instruction-multiline — the caret is in the instruction, so Enter stages this draft on one line and the tint follows it">
			<TypedDraft label="name-instruction-multiline" />
		</Frame>
	),
};

/**
 * A word that names no command, with the list closed: inert text, dimmed.
 *
 * The BARE word, and that is the rule rather than the state that was convenient:
 * `unknown` means "inert text that WILL be sent", and a line of the form
 * `/teem fix this` is neither sent nor run — the dispatcher answers "unknown
 * command" and keeps the draft, so the tint would claim something the app does
 * not do (design round 1 D6). With text after it the word takes plain prose ink.
 */
export const UnknownWord: Story = {
	name: "unknown-word",
	render: () => (
		<Frame label="unknown-word — /teem, the command list closed">
			<Draft label="unknown-word" draft="/teem" />
		</Frame>
	),
};

/** The same word while the list is still choosing: no tint at all. */
export const UnknownWordPicking: Story = {
	name: "unknown-word-picking",
	render: () => (
		// Taller, because the open list is what makes the frame: it renders above
		// the composer, and a frame that clips it cannot show the suppression it is
		// evidence for.
		<Frame
			label="unknown-word-picking — the list is open, so the word is in progress, not wrong"
			width={900}
		>
			<Draft label="unknown-word-picking" draft="/tea" />
		</Frame>
	),
};

/** The operator's own draft: prose that merely OPENS with a command word. */
export const ProseLeadingCommandWord: Story = {
	name: "prose-leading-command-word",
	render: () => (
		<Frame label="prose-leading-command-word — the reported draft">
			<Draft
				label="prose-leading-command-word"
				draft={
					"/mcp logout seems to cause a crash on the TUI,\ncan you review and fix that issue,\nreplicate it and then fix and test end to end"
				}
			/>
		</Frame>
	),
};

/** A slash token inside a sentence: punctuation, so nothing is painted. */
export const MidSentenceToken: Story = {
	name: "mid-sentence-token",
	render: () => (
		<Frame label="mid-sentence-token — fix this /usage">
			<Draft label="mid-sentence-token" draft="fix this /usage" />
		</Frame>
	),
};

/**
 * The disabled composer with a draft, and the empty one with its placeholder.
 *
 * Two boxes in one frame because they are the two ends of the same rule: the
 * disabled state STEPS COLOUR rather than fading (`branding.md`), and the empty
 * state is the placeholder the textarea draws itself — neither of which the
 * other frames can show, since both need the composer to be in a state the
 * highlight is not.
 */
export const DisabledAndPlaceholder: Story = {
	name: "disabled-and-placeholder",
	render: () => (
		<Frame label="disabled-and-placeholder — a disabled composer holding a command, and an empty one">
			<div className={cn("flex flex-col gap-6")}>
				<Draft label="disabled" draft="/compact" unavailable={true} />
				<Draft label="placeholder" draft="" />
			</div>
		</Frame>
	),
};

export const ClippedBoundary: Story = {
	name: "clipped-boundary",
	render: () => (
		<Frame
			label="clipped-boundary — the 78-character draft QA round 1 Q1 measured, at that report's own 782px column: both layers are one row, so the whole draft is visible"
			width={900}
		>
			<Draft
				label="clipped-boundary"
				narrowTo={832}
				draft={`/agent coder ${"w".repeat(65)}`}
			/>
		</Frame>
	),
};

/**
 * The same readback `scripts/renderer-driver.mjs --scene composer` writes, in the
 * one environment that HAS a command vocabulary.
 *
 * WHY IT IS HERE AND NOT IN THE DRIVER: a driver run without `--backend` has no
 * backend by design (it asserts the app holds no connection to the operator's), so
 * the chat pane renders its unreachable-backend state and mounts no composer at
 * all — measured, and the driver scene records that rather than reporting an empty
 * pass. (With `--backend` the composer DOES mount once that backend has a session
 * — QA round 1 Q2 — and the driver scene measures it there.) The highlight's
 * vocabulary comes from `commands.list`, so the mirror can only be measured where
 * that op answers: here, with the fixture above.
 *
 * WHY THE NUMBERS ARE IN THE FRAME: a still shows a tint NEAR a word and only the
 * numbers say whether it is ON it. `mirror/textarea` (client widths), `font`,
 * `rows` and `run top` are the four ways the two layers can drift, and the
 * console line carries the same object for a reader with the page open
 * (`[slash-highlight-geometry]`).
 */
const GeometryProbe = ({
	label,
	draft,
	forceScrollbar = false,
	scrollTopPx,
	narrowTo,
}: {
	label: string;
	draft: string;
	/**
	 * Force a CLASSIC scrollbar onto the field, which is the state the mirror's
	 * right-padding correction exists for. macOS overlay scrollbars measure a 0px
	 * gutter, so on this machine the correction is otherwise a no-op and its
	 * arithmetic goes unmeasured; the platform setting is not something a harness
	 * should toggle machine-wide, so the probe states what it did instead.
	 */
	forceScrollbar?: boolean;
	/**
	 * Park the box at this scroll offset before the settled pass, for the probes
	 * whose draft is tall enough to scroll.
	 *
	 * WHY IT IS WRITTEN RATHER THAN PRODUCED BY THE CARET. The composer scrolls its
	 * own caret into view, so a tall draft is already scrolled when the probe mounts
	 * — and for the draft this matters for (a command with a long instruction, one
	 * logical line that soft-wraps) the caret sits at the END, i.e. the box shows the
	 * last rows and the tinted first row is out of view. A frame can show the tint or
	 * the scroll, not both, so the probe nudges the box back up: `scrollTop > 0` with
	 * the run's own row still visible, which is the state a scrollbar drag lands in
	 * and the one where the two layers' windows have to agree (code review round 1
	 * MINOR 1 — the sync was implemented and measured nowhere).
	 *
	 * The write is a SCROLL GESTURE, not a caret move: it fires the textarea's own
	 * `scroll` event, which is what the mirror's writer listens for, and the settled
	 * pass runs two frames later so the transform under measurement is the one that
	 * event produced rather than the one before it.
	 */
	scrollTopPx?: number;
	/**
	 * Narrow the composer's own box to this CSS width before measuring, for the probe
	 * that has to sit at a WRAP BOUNDARY.
	 *
	 * WHY A WIDTH RATHER THAN A LONGER DRAFT. The clipped case QA round 1 Q1 measured
	 * is a 78-character draft against a 782px column: 780.67px of advance at the
	 * textarea's own metrics, 782.77px with the run a real weight heavier. The defect
	 * exists only in that 2.1px window — the same draft is one row at BOTH weights on
	 * a wider column — so a probe that wants to be able to FAIL when the weight comes
	 * back has to reproduce the column as well as the draft. `narrowTo` is the box's
	 * width; the frame reports the resulting content box so the two numbers can be
	 * compared with QA's rather than assumed to match.
	 */
	narrowTo?: number;
}) => {
	const conversationId = conversationIdFor(label);
	const queryClient = useQueryClient();
	const boxRef = useRef<HTMLDivElement | null>(null);

	const [rows, setRows] = useState<Record<string, string>>({});
	/*
	 * THE VOCABULARY IS SEEDED BEFORE THE FIRST MEASURE — see the note inside the
	 * measure effect for why this exists at all; the dependency is the setter rather
	 * than the client so the effect cannot re-run on every render.
	 */
	useLayoutEffect(() => {
		queryClient.setQueryData(desktopKeys.commands, COMMANDS);
		/*
		 * AND THE ROSTER, which the `name` run reads (`useEntities`), for the same
		 * reason one round later: it resolves over the API fixture after first paint,
		 * so the first measure saw a run set its own pixels did not paint — three of
		 * twelve frames printed `run fontWeights command=600` beside a visible green
		 * name run (design round 3 D9). Seeded, every pass describes one state.
		 */
		for (const command of ["team", "agent"]) {
			queryClient.setQueryData(
				["desktop", "entities", conversationId, command, ""],
				{ entities: TEAM_ENTITIES, current: "" },
			);
		}
	}, [queryClient, conversationId]);
	/*
	 * The deps below are RE-MEASURE TRIGGERS rather than values read in the body —
	 * the same convention the composer's own autosize effect states: `draft` is what
	 * the probe measures and `scrollTopPx` is the offset it parks. The capability row
	 * is read from the query cache at measure time, deliberately: it is the value the
	 * composer's own gate reads, so re-rendering on it is not what this effect needs.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: deps are re-measure triggers, not values read in the body
	useLayoutEffect(() => {
		const box = boxRef.current;
		if (!box) return;
		/** The first pass's readback, so a later pass can be compared to it. */
		let settled = "";
		/** Bounded re-tries of the settled pass, for the caret race above. */
		let settleRetries = 0;
		/**
		 * The scroll parity's OWN retry budget, because the two races are unrelated and
		 * the shared counter was a trap: the caret race can spend the whole budget
		 * before the scroll pass ever runs, and the parity guard then THROWS on its
		 * first look — a capture failing for a reason that has nothing to do with the
		 * window it asserts. Measured on this file's own `scrolled-parity` row, which
		 * threw `scrollTop 12px, translateY 0.00px` on a cold load: the transform had
		 * not been written yet, not been written wrongly.
		 */
		let scrollRetries = 0;
		/*
		 * THE GUTTER IS FORCED BEFORE THE FIRST MEASURE, and the ordering is the point:
		 * the injection used to run in the same tick as the measurement, so the settled
		 * pass read `scrollbar gutter 0px` and `paddingRight 8px vs 8px` in all twelve
		 * frames (design round 3 D10, review round 3 MAJOR-2) — the pair the round-2
		 * prose quoted was the value the injection WOULD produce, not one any frame
		 * carried, and the correction it exists to measure never ran. It now applies
		 * synchronously below, before the rAF pair schedules anything.
		 *
		 * A classic scrollbar needs BOTH: `overflow-y: scroll` reserves the track, and
		 * an explicit `::-webkit-scrollbar` width stops Chromium from drawing one of the
		 * OS's overlay scrollbars, which measure a 0px gutter however they are asked
		 * for (measured on this machine: `overflow-y: scroll` alone still reported 0).
		 * That is the platform setting's rendering, produced without touching the
		 * operator's system preferences.
		 */
		const measure = (pass: "settled" | "confirm-400ms" | "confirm-1500ms") => {
			const textarea = box.querySelector("textarea");
			if (!textarea) return;
			/*
			 * THE SCROLL GESTURE, applied INSIDE the settled pass and verified there.
			 *
			 * Writing it once before the first pass is not enough, and this harness
			 * measured why: the composer autosizes the field in its own layout effect, so
			 * an offset written a frame early is clamped away when the box it was written
			 * against changes height — the 7-row draft here read `scrollTop 0px` with the
			 * write in place. The pass therefore moves the box itself and RETRIES when it
			 * had to, which is also what gives the mirror's writer (on the textarea's own
			 * `scroll` event) the frame it needs to land in before the transform is read.
			 */
			if (
				pass === "settled" &&
				scrollTopPx !== undefined &&
				textarea.scrollHeight > textarea.clientHeight &&
				Math.abs(textarea.scrollTop - scrollTopPx) > 0.5
			) {
				textarea.scrollTop = scrollTopPx;
				/*
				 * AND THE SIGNAL THE WRITER LISTENS FOR, delivered explicitly. The mirror's
				 * writer runs on the textarea's own `scroll` event, which the platform
				 * dispatches asynchronously and may coalesce away when an offset is written
				 * twice inside one frame — so a pass that read the transform immediately after
				 * the write could see the PREVIOUS scroll's value and redden a guard about a
				 * window that was merely a frame behind. Dispatching the event the app already
				 * handles makes the measurement a question about the app's answer (does the
				 * window follow the box?) rather than about the event loop's timing, and the
				 * assertion is unchanged: a transform that still disagrees with `scrollTop`
				 * after the retries fails the capture.
				 */
				textarea.dispatchEvent(new Event("scroll"));
				if (settleRetries < MAX_SETTLE_RETRIES) {
					settleRetries += 1;
					setTimeout(() => measure("settled"), 150);
					return;
				}
			}
			const t = getComputedStyle(textarea);
			const lineHeight = Number.parseFloat(t.lineHeight);
			/*
			 * TWO NODES, and the probe reads them apart because the defect class it now
			 * guards lives exactly in their difference (QA round 2 Q1):
			 * `[data-composer-mirror]` is the CLIP WINDOW — the box the textarea's own
			 * viewport is — and `[data-composer-mirror-paint]` is the GLYPH LAYER,
			 * which is what the scroll transform moves. Reading the transform off the
			 * clip box, or the text metrics off the glyph layer, was each half of the
			 * old one-node reading and neither can tell a displaced window from a
			 * correct one.
			 */
			const mirror = box.querySelector<HTMLElement>("[data-composer-mirror]");
			const paint = box.querySelector<HTMLElement>(
				"[data-composer-mirror-paint]",
			);
			const entry: Record<string, string> = {
				// WHICH PASS this frame carries. The story measures three times because
				// the composer's vocabulary arrives over a promise, and a frame whose
				// numbers come from an earlier pass than its pixels is a frame that
				// contradicts itself (design round 2 D2: two of the twelve printed
				// `run unknown` beside pixels painting the command run).
				pass,
				draft: JSON.stringify(draft),
				// The box's OWN value, so a frame's numbers and its pixels are the
				// same state rather than two claims about it.
				"textarea value": JSON.stringify(textarea.value),
				keys: Object.keys(
					useConversationInputStore.getState().inputByConversation,
				).join(","),
				"textarea color": t.color,
				/*
				 * THE CAPABILITY THE FRAME PAINTS UNDER, read from the same cache the
				 * composer's gate reads (`useDesktopCapabilities` -> `desktopKeys.capabilities`
				 * -> `desktopFeatureEnabled`). It is a row here because it is the half of the
				 * gate the frames used to take for granted: the highlight once asked the
				 * planner with `enabled: true` so a dispatcher-less harness would still paint
				 * (code review round 1 MAJOR 1), and this row is what makes the real value
				 * visible beside every readback.
				 */
				"commands capability": String(
					desktopFeatureEnabled(
						queryClient.getQueryData(desktopKeys.capabilities),
						"commands",
					),
				),
				"textarea caret": t.caretColor,
				"mirror rendered": String(Boolean(mirror)),
				// The glyph layer, apart from the window: a frame with one and not the
				// other is a mirror that cannot both clip and paint, and the rows below
				// would be reading the wrong box either way.
				"mirror paint rendered": String(Boolean(paint)),
				"textarea clientWidth": `${textarea.clientWidth}px`,
				/*
				 * The column the wrap is measured against: the client box less its own
				 * padding and any scrollbar gutter. Reported because the boundary probe's whole
				 * premise is a specific number of pixels (`narrowTo`), and a probe that measured
				 * a column it did not state would be claiming a case it had not reproduced.
				 */
				"textarea content width": `${textarea.clientWidth - Number.parseFloat(t.paddingLeft) - Number.parseFloat(t.paddingRight) - (textarea.offsetWidth - textarea.clientWidth)}px`,
				"scrollbar gutter": `${textarea.offsetWidth - textarea.clientWidth}px`,
				"textarea rows": String(
					Math.round(
						(textarea.scrollHeight -
							Number.parseFloat(t.paddingTop) -
							Number.parseFloat(t.paddingBottom)) /
							lineHeight,
					),
				),
				/*
				 * THE TWO HEIGHTS, because they are the whole of QA round 1 Q1: the
				 * textarea's layout is the one the caret, the selection and
				 * click-positioning live on, the mirror is the layer that PAINTS the
				 * draft, and a mirror that wraps one character earlier puts its tail
				 * behind its own `overflow: hidden` — measured there as 65 of 78 typed
				 * characters invisible. Read raw as well as in rows, so a frame carries
				 * the pair the divergence was found in (34px vs 55px).
				 */
				"textarea scrollHeight": `${textarea.scrollHeight}px`,
				"textarea scrollTop": `${textarea.scrollTop}px`,
				font: t.font,
			};
			if (mirror && paint) {
				const m = getComputedStyle(paint);
				const box0 = paint.getBoundingClientRect();
				const clip = mirror.getBoundingClientRect();
				const field = textarea.getBoundingClientRect();
				entry["mirror clientWidth"] = `${paint.clientWidth}px`;
				entry["fonts equal"] = String(m.font === t.font);
				/*
				 * THE WEIGHT CHANNEL, as numbers. It is the whole of obsidian's
				 * separation (its `info` IS its `ink` IS its `accent`, so the command run
				 * is distinguished by the weight step alone — the pinned case in
				 * `palette-contract.ts`), and a still cannot show it.
				 *
				 * READ AS `fontWeight` PLUS `textStroke`, because the step is PAINTED
				 * rather than laid out: `font-weight` moves the advances, so the mirror
				 * wrapped where the textarea did not and clipped the user's text (QA
				 * round 1 Q1), and the run now takes a 0.5px stroke instead — the design
				 * round's own measurement (a 4px stem against prose's 3px at dsf 2) in a
				 * channel that changes no advance. The pair is what a frame has to carry
				 * for the claim to be readable: `fontWeight 400` beside a non-zero stroke
				 * is the fix, and `fontWeight 600` here would be the defect returning.
				 */
				entry["run fontWeight+stroke"] =
					[...paint.querySelectorAll<HTMLElement>("[data-slash-run]")]
						.map((el) => {
							const s = getComputedStyle(el);
							return `${el.dataset.slashRun}=${s.fontWeight}+${s.webkitTextStrokeWidth || "0px"}`;
						})
						.join(",") || "none";
				entry["prose fontWeight+stroke"] =
					`${m.fontWeight}+${m.webkitTextStrokeWidth || "0px"}`;
				entry["mirror rows"] = String(
					Math.round(
						(paint.scrollHeight -
							Number.parseFloat(m.paddingTop) -
							Number.parseFloat(m.paddingBottom)) /
							Number.parseFloat(m.lineHeight),
					),
				);
				entry["mirror scrollHeight"] = `${paint.scrollHeight}px`;
				/*
				 * THE PARITY CLAIM ITSELF, in the terms QA round 1 measured it: the mirror's
				 * content height against the textarea's. A mirror even one row taller is a
				 * mirror wrapping a character the textarea did not, and its own
				 * `overflow: hidden` then hides the tail of what the user typed — so the
				 * settled pass THROWS on it rather than printing a number nobody reads
				 * (below, beside the caret guard, for the same reason).
				 */
				entry["scrollHeight parity"] =
					paint.scrollHeight === textarea.scrollHeight
						? `${paint.scrollHeight}px == ${textarea.scrollHeight}px`
						: `${paint.scrollHeight}px vs ${textarea.scrollHeight}px MISMATCH`;
				entry["paddingRight (mirror vs textarea+gutter)"] =
					`${Number.parseFloat(m.paddingRight)}px vs ${Number.parseFloat(t.paddingRight) + (textarea.offsetWidth - textarea.clientWidth)}px`;
				/*
				 * THE SCROLLED HALF OF THE SAME CLAIM (code review round 1 MINOR 1). The two
				 * layers show the same window of the draft because the mirror is shifted by
				 * `translateY(-scrollTop)` on the textarea's own `scroll` event, and that was
				 * implemented and measured NOWHERE: the probes never scrolled, and the one
				 * reader in the repo was the deferred driver scene. Read on every probe,
				 * because a box the composer scrolled to its caret is a scrolled box even
				 * when nobody asked for an offset — the failure it rules out is a tint frozen
				 * by whole lines while its own glyphs keep moving.
				 */
				const translateY = readTranslateY(paint);
				entry["mirror translateY"] =
					`${paint.style.transform || "none"} / ${translateY.toFixed(2)}px vs -${textarea.scrollTop}px expected`;
				entry["scroll parity"] =
					Math.abs(translateY + textarea.scrollTop) <= 0.5
						? `${textarea.scrollTop}px scrolled, the two windows in step`
						: `MISMATCH: scrollTop ${textarea.scrollTop}px, translateY ${translateY.toFixed(2)}px`;
				/*
				 * WHICH BOX CLIPS WHAT IS PAINTED (QA round 2 Q1), as two rows because the
				 * defect needed both halves visible at once: the clip window's own top against
				 * the field's (`0px` — the window IS the field's viewport), and the glyph
				 * layer's top against the clip window's (the transform, i.e. the paint moving
				 * INSIDE a static window). One node cannot satisfy the first row and the
				 * second at once, which is what made the old reading — the transform's value
				 * alone, on the clipping node — green through a 30px displacement.
				 */
				const clipOffset = clip.top - field.top;
				entry["clip box vs field"] =
					Math.abs(clipOffset) <= 0.5
						? "0px offset, the window is the field's own"
						: `MISMATCH: the clip box sits ${clipOffset.toFixed(2)}px off the field`;
				entry["paint box vs clip box"] =
					`${(box0.top - clip.top).toFixed(2)}px vs ${(-textarea.scrollTop).toFixed(2)}px expected`;
				let before = "";
				/*
				 * The reference the runs are measured AGAINST: the mirror's own first
				 * line of text, read as a Range. `paddingTop` alone is the wrong baseline
				 * and this is the measurement that showed it — an inline element's rect is
				 * its FONT's content box, which sits half a leading below the line box
				 * (measured: 8.50px against a 6px paddingTop, for a 14px font on a 21.7px
				 * line), so comparing a run to `paddingTop` would report a 2.5px "drift"
				 * that is only how inline boxes are measured. The question is whether the
				 * tint sits ON THE LINE IT NAMES, and the mirror's own first line box is
				 * the honest origin for that.
				 */
				const range = document.createRange();
				range.selectNodeContents(paint);
				const firstLineTop =
					(range.getClientRects()[0]?.top ?? box0.top) - box0.top;
				entry["first line top"] = `${firstLineTop.toFixed(2)}px`;
				for (const node of paint.childNodes) {
					if (node.nodeType === Node.ELEMENT_NODE) {
						const el = node as HTMLElement;
						if (el.dataset.slashRun) {
							const rect = el.getBoundingClientRect();
							const newlines = before.split("\n").length - 1;
							const expected =
								firstLineTop + newlines * Number.parseFloat(m.lineHeight);
							entry[`run ${el.dataset.slashRun} "${el.textContent}" top`] =
								`${(rect.top - box0.top).toFixed(2)}px vs ${expected.toFixed(2)}px expected`;
							/*
							 * THE RUN'S ROW IS DELIBERATELY TRANSFORM-INVARIANT (it compares the run
							 * to the mirror's own first line, and the two move together), so the
							 * SCROLLED half of the parity claim is measured once per mirror below
							 * instead: the mirror's `translateY` against the textarea's scroll
							 * position (code review round 1 MINOR 1).
							 */
						}
					}
					before += node.textContent ?? "";
				}
				/*
				 * THE SYNC MECHANISM, read off the DOM rather than predicted: the mirror is
				 * shifted by its own `translateY(-scrollTop)`, written on the textarea's
				 * `scroll` event (`composer-highlight.tsx`). A transform one frame stale
				 * freezes the tinted word while its glyphs keep moving, by whole lines — the
				 * failure the claim "the two layers show the same window" rules out and the
				 * only one of the two layers can produce.
				 *
				 * The inline declaration is compared as written (`-Npx`) and the computed
				 * matrix's `f` term as resolved, because the claim is about both: the writer
				 * is what runs per scroll frame, the matrix is what the compositor lays out.
				 */
				const transform = paint.style.transform;
				const matrix = getComputedStyle(paint).transform;
				const translated =
					matrix === "none"
						? 0
						: Number.parseFloat(matrix.split(",")[5] ?? "0");
				entry["mirror translateY"] =
					`${transform || "none"} / ${translated.toFixed(2)}px vs -${textarea.scrollTop}px expected`;
			}
			/*
			 * The FRAME carries the first pass, and a later pass only WARNS.
			 *
			 * The capture takes its shutter as soon as the story is drawn, so the
			 * reading a frame carries has to be true by then: the vocabulary and the
			 * roster are both seeded before the first measure precisely so that it is,
			 * and the later passes exist to CONFIRM it rather than to supersede it. The
			 * warning names both readings, because a disagreement here is not a matter
			 * of taste — it means the composed app was not the state the numbers
			 * describe, which is what round 2 and round 3 both caught: the `name` run
			 * was absent from pass 1 in monokai, neon and synth — the three frames that
			 * carried no `run name` row at all while obsidian, dune and
			 * localOperatorLight each carried two (design round 3 D9's own table) —
			 * because the roster resolves over the API fixture after first paint. Those
			 * frames printed `run fontWeights command=600` while their own pixels
			 * painted a green name. Nothing here can make that visible; the warning
			 * can.
			 */
			/*
			 * A TRANSPARENT CARET UNDER A RENDERED MIRROR IS NOT A STATE THE APP RESTS
			 * IN, and a frame frozen on it describes a moment nothing on screen shows.
			 * Design round 4 (`D14`) found exactly that in `geometry/radient.webp`: the
			 * settled readback reported `textarea caret rgba(0, 0, 0, 0)` beside
			 * `mirror rendered true` while the frame's own pixels were radient's, i.e.
			 * the theme had landed and the caret had not — and the designer could not
			 * reproduce it live (16/16 fresh readbacks, plus a poll over four seconds).
			 * A warning cannot catch that; the frame is already written by then. So the
			 * settled pass RE-TRIES a bounded number of times and then THROWS, which
			 * fails the capture rather than shipping the reading.
			 */
			const caret = entry["textarea caret"] ?? "";
			if (
				pass === "settled" &&
				entry["mirror rendered"] === "true" &&
				TRANSPARENT.test(caret)
			) {
				if (settleRetries < MAX_SETTLE_RETRIES) {
					settleRetries += 1;
					setTimeout(() => measure("settled"), 150);
					return;
				}
				throw new Error(
					`geometry readback: the caret is transparent (${caret}) while the mirror rendered "${draft}" - a state the composer never rests in, so the frame would describe a moment nothing on screen shows (design round 4 D14)`,
				);
			}
			/*
			 * AND THE SCROLLED WINDOW IS PART OF THAT SAME CLAIM, failing the capture for the
			 * same reason a wrap mismatch does: the mirror is the only layer that paints the
			 * draft, so a transform that has not kept up with the box's scroll shows a
			 * frame in which the tint sits beside its own glyphs, displaced by whole lines
			 * (code review round 1 MINOR 1). A bounded re-try first, because the writer runs
			 * on the textarea's `scroll` event and the probe's own offset is written just
			 * before the first pass is scheduled.
			 */
			if (
				pass === "settled" &&
				entry["mirror rendered"] === "true" &&
				entry["scroll parity"]?.startsWith("MISMATCH") &&
				(entry["textarea scrollTop"] ?? "0px") !== "0px"
			) {
				if (scrollRetries < MAX_SETTLE_RETRIES) {
					scrollRetries += 1;
					setTimeout(() => measure("settled"), 150);
					return;
				}
				throw new Error(
					`geometry readback: ${entry["scroll parity"]} for ${JSON.stringify(draft)} - the mirror's window has to be the textarea's, or the frame shows the tint displaced against its own glyphs (code review round 1 MINOR 1)`,
				);
			}
			/*
			 * AND THE WINDOW THAT CLIPS HAS TO BE THE FIELD'S OWN (QA round 2 Q1), a
			 * different assertion from the parity above and the one the old gate lacked: a
			 * window displaced by the scroll still satisfies `translateY == -scrollTop`
			 * and still measures equal content heights, because the transform is correct
			 * and insufficient — it moved the CLIP with the paint, so the field's bottom
			 * line was never painted and the mirror painted above the composer's top
			 * edge. Measured on the one-node head at `scrollTop 30`: 52 characters outside
			 * the clip box and a caret character with no text on it. The window is a box,
			 * so the assertion is geometric, and a displaced window fails the capture
			 * rather than shipping a frame of the user's own line missing.
			 */
			if (
				pass === "settled" &&
				entry["mirror rendered"] === "true" &&
				entry["clip box vs field"]?.startsWith("MISMATCH")
			) {
				throw new Error(
					`geometry readback: ${entry["clip box vs field"]} for ${JSON.stringify(draft)} - the layer that clips must be the field's own viewport, or the scroll transform moves the clip window with the paint and the caret's line is never painted (QA round 2 Q1)`,
				);
			}
			/*
			 * AND A MIRROR THAT WRAPS WHERE THE TEXTAREA DOES NOT IS NOT A FRAME EITHER, for
			 * the harder reason: the mirror is the layer that PAINTS the draft, the
			 * textarea's glyphs are transparent, and the mirror's own `overflow: hidden`
			 * cuts off whatever it wrapped onto a line it cannot show. Measured on this
			 * branch before the fix (QA round 1 Q1): `/agent coder ` + 65 characters is one
			 * row at the textarea's own metrics and two at the mirror's, and the frame showed
			 * `/agent coder` alone with 65 typed characters invisible behind it. A frame set
			 * whose numbers say `MISMATCH` would be shipping that state as evidence that the
			 * highlight works, so the settled pass fails the capture instead.
			 */
			if (
				pass === "settled" &&
				entry["mirror rendered"] === "true" &&
				entry["scrollHeight parity"]?.includes("MISMATCH")
			) {
				throw new Error(
					`geometry readback: the mirror's content height is ${entry["mirror scrollHeight"]} against the textarea's ${entry["textarea scrollHeight"]} for ${JSON.stringify(draft)} - the mirror paints every glyph, so a mirror that wraps a character earlier hides the tail of the draft behind its own overflow (QA round 1 Q1)`,
				);
			}

			if (pass === "settled") {
				settled = JSON.stringify({ ...entry, pass: undefined });
				setRows(entry);
			} else if (JSON.stringify({ ...entry, pass: undefined }) !== settled) {
				console.warn(
					`[slash-highlight-geometry] ${pass} differs from the settled readback (the frame carries the settled one): ${JSON.stringify({ draft, entry })}`,
				);
			}
			// The same object on the console, so the numbers can be read out of a
			// headless page as well as off the frame.
			console.log(
				`[slash-highlight-geometry] ${JSON.stringify({ draft, entry })}`,
			);
			/*
			 * And a ONE-LINE digest beside it, because the object above is long enough
			 * that a log reader truncates the rows that matter. This is the parity claim
			 * in four numbers: the two content heights, the two row counts, and the mirror's
			 * window against the box's scroll position.
			 */
			console.log(
				`[slash-highlight-parity] ${JSON.stringify({
					label: entry.draft,
					heights: entry["scrollHeight parity"],
					rows: `mirror ${entry["mirror rows"] ?? "-"} vs textarea ${entry["textarea rows"]}`,
					scroll: entry["scroll parity"] ?? "no mirror",
				})}`,
			);
		};
		/*
		 * Measured THREE TIMES, and the repeats are a CONFIRMATION rather than a
		 * ladder: the first pass is the settled one because both fixtures the surface
		 * reads are seeded before it — `commands.list` (the vocabulary) and
		 * `commands.entities` (the roster, which is what the `name` run needs and what
		 * round 3's D9 caught missing: three of twelve frames printed no name run while
		 * their own pixels painted one). The later passes exist so a reading that comes
		 * out differently can say so instead of being frozen silently; they are logged
		 * with their pass name so the timing stays visible.
		 */
		/*
		 * THE VOCABULARY IS SEEDED BEFORE THE FIRST MEASURE.
		 *
		 * The composer's command registry normally arrives over a promise, which is why
		 * this story measures more than once — and why two of the twelve frames in the
		 * round-2 set printed `run unknown "/compact"` beside pixels painting the command
		 * run, and `mirror rendered false` beside a panel that visibly paints runs
		 * (design round 2 D2). A frame whose numbers describe a different pass than its
		 * own pixels proves nothing about either. Seeding the same fixture the msw
		 * handler serves makes every pass the settled one; the `pass` field on each
		 * readback records which pass a frame carries anyway.
		 */
		const timers: ReturnType<typeof setTimeout>[] = [];
		const raf = requestAnimationFrame(() =>
			requestAnimationFrame(() => {
				/*
				 * The FIRST pass is the settled one, because both fixtures are seeded
				 * before it; the later passes CONFIRM it. The frame keeps the settled
				 * readback and a later pass that differs only WARNS with both readings
				 * (above) — it never replaces what the frame shows.
				 */
				measure("settled");
				timers.push(setTimeout(() => measure("confirm-400ms"), 400));
				timers.push(setTimeout(() => measure("confirm-1500ms"), 1500));
			}),
		);
		return () => {
			cancelAnimationFrame(raf);
			for (const timer of timers) clearTimeout(timer);
		};
		/*
		 * No `forceScrollbar` here: the gutter is a stylesheet rule on the wrapper now,
		 * not something this effect writes, so the only inputs the measurement has are
		 * the draft and the fixtures seeded above.
		 */
	}, [draft, scrollTopPx]);
	return (
		<div
			ref={boxRef}
			className={cn("flex flex-col gap-2")}
			/*
			 * A rule rather than an imperative write, so it is in the document from the
			 * first layout instead of racing the measurement (the earlier effect ran in
			 * the same tick as the probe and produced `gutter 0px` in every frame).
			 * It is still an ASK: this platform draws overlay scrollbars the rule does
			 * not replace, so the frames honestly read `0px` — see the note on the probe
			 * below, which states the correction is inert here rather than quoting the
			 * value the injection would have produced (design round 3 D10).
			 */
			data-force-scrollbar={forceScrollbar ? "" : undefined}
		>
			{forceScrollbar ? (
				<style>{`[data-force-scrollbar] textarea { overflow-y: scroll; }
[data-force-scrollbar] textarea::-webkit-scrollbar { width: 15px; }
[data-force-scrollbar] textarea::-webkit-scrollbar-thumb { background: rgb(120,120,120); }`}</style>
			) : null}
			<Draft label={label} draft={draft} narrowTo={narrowTo} />
			<dl
				className={cn(
					"grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-ink-dim text-mono-sm",
				)}
			>
				{Object.entries(rows).map(([key, value]) => (
					<div key={key} className={cn("contents")}>
						<dt>{key}</dt>
						<dd className={cn("truncate text-ink-muted")}>{value}</dd>
					</div>
				))}
			</dl>
		</div>
	);
};

/**
 * The numbers, in the environment that can produce them: a whole-draft command,
 * a start command whose instruction spans lines, and a draft that paints nothing.
 */
export const Geometry: Story = {
	name: "geometry",
	render: () => (
		<Frame
			label="geometry — mirror/textarea parity, run geometry and the scrollbar gutter, read from the live DOM under this theme"
			width={1000}
		>
			<div className={cn("flex flex-col gap-8")}>
				<GeometryProbe label="geometry-command" draft="/compact" />
				{/*
				 * The NAME run across a WRAP, in the shape the two layers most easily
				 * disagree about: a command with a long instruction, one logical line, soft
				 * wrapped past the field's own `max-h-28`. The caret is at the end of the
				 * draft (a seeded draft's caret, `message-input.tsx`), which is a plan of
				 * `whole` here and therefore paints both runs, and the box has scrolled the
				 * caret into view — so the probe nudges it back up one line, which is where
				 * the tint is in the frame AND the scroll is non-zero (`scrollTopPx`).
				 *
				 * The earlier draft here was a two-line `/team` instruction, which main's
				 * planner sends (the multi-line shape) and which therefore painted nothing
				 * at ANY caret — the divergence the state stories declare
				 * (`name-instruction-multiline`, design round 1 D2) — so the wrapped-run
				 * geometry was being read off a panel with no runs in it.
				 */}
				<GeometryProbe
					label="geometry-name"
					scrollTopPx={12}
					draft={
						"/team frontend-guild review every file in this queue, note which of the failing cases are flaky and which are deterministic, summarise the crash reports from the TUI in the order they were filed and say which of them share a cause, call out the two wrappers that disagree about the line they paint and say which one of them is right, then hand the whole summary to the reviewer together with the commands that reproduce each of the failing cases, the backend version each of those commands was taken against, and the theme that was active at the time, so that nothing is lost in the handover and the next reader can start where this one left off without asking a question about what came before it or which of the two wrappers was telling the truth, and keep the instruction short enough that the box scrolls only a little rather than to its end"
					}
				/>
				<GeometryProbe label="geometry-prose" draft="fix this /usage" />
				{/*
				 * THE CLIPPED CASE ITSELF, at the width and length QA round 1 Q1 measured
				 * it: `\/agent coder ` + 65 characters is 78 characters, and 780.67px of
				 * advance at the textarea's own metrics against a 782px column. With the
				 * command run one real weight step heavier the mirror's line came to
				 * 782.77px, wrapped, and hid those 65 characters behind its own `overflow:
				 * hidden`. It is the probe the parity guard was written for: `1 row` against
				 * `1 row` here, and a capture that throws on `MISMATCH` rather than shipping
				 * a frame of it.
				 */}
				<GeometryProbe
					label="geometry-clipped"
					narrowTo={832}
					draft={`/agent coder ${"w".repeat(65)}`}
				/>
				{/*
				 * The scrollbar case: a wrapped NAME-list draft, which is the only kind of
				 * multi-line draft the run rule paints (the multi-line kill exempts it),
				 * under a probe that ASKS for a classic scrollbar.
				 *
				 * Measured, and stated rather than implied: the platform does not give one.
				 * Every head measured (`9a28eb0c6` through this one) reads `scrollbar gutter
				 * 0px` and `paddingRight 8px vs 8px` with `textarea clientWidth` equal to
				 * the mirror's, so the right-padding correction — `paddingRight = the
				 * textarea's + its gutter` — is INERT here: macOS draws overlay scrollbars
				 * that the injected `::-webkit-scrollbar` width does not replace, and the
				 * frames agree with the readback rather than with the intent (design round
				 * 3 D10, review round 3 MAJOR-2). What the panel does measure is the mirror
				 * and the textarea agreeing on a wrapped draft's row count and on each
				 * run's y, which is the half of D2 that does not depend on a gutter.
				 */}
				<GeometryProbe
					label="geometry-scrollbar"
					forceScrollbar={true}
					draft={
						"/team frontend-guild please summarise the failing tests in the TUI crash report, note which of them are flaky, and then stop. Then do it again for the desktop composer and the terminal editor, and tell me which of the two wrappers disagrees about the line it paints.\nand then send it on to the reviewer"
					}
				/>
			</div>
		</Frame>
	),
};

/**
 * The SCROLLED composer on its own, so a published frame carries the rows the
 * scroll claims are made in.
 *
 * WHY A ROW RATHER THAN A SIXTH PROBE IN `geometry`: that panel is a viewport
 * shot of a page taller than the window, so only its first probe's readback has
 * ever been in a frame (code review round 2 MINOR 4) — the scrolled rows the PR
 * body quotes (`textarea scrollTop`, `mirror translateY`, `mirror rows` against
 * `textarea rows`) were in NO picture, and the clip-window rows added for QA
 * round 2 Q1 would have joined them there. One probe to a page keeps the whole
 * readback inside the frame, and it is the same draft and the same offset the
 * driver scene's `scrolled` probe writes, so the two rigs' numbers are
 * comparable line for line.
 *
 * The draft is ONE logical line of the shape the run rule PAINTS (`/team` plus
 * its name list; `/compact` with text after it is a draft the planner sends as
 * written and therefore paints nothing — QA round 2 Q4), and it wraps past the
 * field's own `max-h-28`, so the box arrives scrolled to its caret and
 * `scrollTopPx` then asks for less. The offset is one line rather than the
 * maximum, so the tinted first row stays in the frame — which is what makes the
 * clip-window offset visible as a number AND as a picture.
 */
export const ScrolledParity: Story = {
	name: "scrolled-parity",
	/*
	 * `narrowTo` is an ARG rather than a second story, because the two columns QA
	 * round 2 measured the defect at (a wide box, and a box narrow enough to wrap the
	 * same draft many times over) have to be the same page: one probe to a page is
	 * what keeps the whole readback inside the frame, and a copy of the story per
	 * column would be two pages free to drift apart. The sweep declares it with no
	 * args, so the published row is the wide column.
	 */
	args: { narrowTo: undefined },
	/*
	 * The arg is read through a local signature rather than the story's `{}`: this is
	 * the one story in the file that takes a knob, and the alternative is widening
	 * every story's args for one column width.
	 */
	render: (args: { narrowTo?: number }) => (
		<Frame
			label="scrolled-parity — the clip window against the field, and the paint moving inside it (QA round 2 Q1), read from the live DOM under this theme"
			width={1000}
		>
			<GeometryProbe
				label="geometry-scrolled"
				scrollTopPx={12}
				narrowTo={args.narrowTo}
				draft={
					"/team frontend-guild review every file in this queue, note which of the failing cases are flaky and which are deterministic, summarise the crash reports from the TUI in the order they were filed and say which of them share a cause, call out the two wrappers that disagree about the line they paint and say which one of them is right, then hand the whole summary to the reviewer together with the commands that reproduce each of the failing cases, the backend version each of those commands was taken against, and the theme that was active at the time, so that nothing is lost in the handover and the next reader can start where this one left off without asking a question about what came before it or which of the two wrappers was telling the truth, and keep the instruction short enough that the box scrolls only a little rather than to its end"
				}
			/>
		</Frame>
	),
};
