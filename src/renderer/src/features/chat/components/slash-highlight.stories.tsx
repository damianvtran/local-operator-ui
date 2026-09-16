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
import { useLayoutEffect, useRef, useState } from "react";
import type { Message } from "../types/message";
import { MessageInput } from "./message-input";

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
}: {
	label: string;
	draft: string;
	unavailable?: boolean;
}) => {
	const conversationId = conversationIdFor(label);
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
		/>
	);
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

/** A start command: the word, the ROSTER NAME, and the instruction in prose. */
export const StartNameInstruction: Story = {
	name: "start-name-instruction",
	render: () => (
		<Frame label="start-name-instruction — /team <name> <instruction spanning lines>">
			<Draft
				label="start-name-instruction"
				draft={
					"/team frontend-guild review the queue\nand then send it on to the reviewer"
				}
			/>
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

/**
 * The same readback `scripts/renderer-driver.mjs --scene composer` writes, in the
 * one environment that HAS a command vocabulary.
 *
 * WHY IT IS HERE AND NOT IN THE DRIVER: a driver run has no backend by design
 * (it asserts the app holds no connection to the operator's), so the chat pane
 * renders its unreachable-backend state and mounts no composer at all — measured,
 * and the driver scene records that rather than reporting an empty pass. The
 * highlight's vocabulary comes from `commands.list`, so the mirror can only be
 * measured where that op answers: here, with the fixture above.
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
}) => {
	const boxRef = useRef<HTMLDivElement | null>(null);
	const [rows, setRows] = useState<Record<string, string>>({});
	useLayoutEffect(() => {
		const box = boxRef.current;
		if (!box) return;
		const measure = () => {
			const textarea = box.querySelector("textarea");
			if (!textarea) return;
			const t = getComputedStyle(textarea);
			const lineHeight = Number.parseFloat(t.lineHeight);
			const mirror = box.querySelector<HTMLElement>("[data-composer-mirror]");
			const entry: Record<string, string> = {
				draft: JSON.stringify(draft),
				// The box's OWN value, so a frame's numbers and its pixels are the
				// same state rather than two claims about it.
				"textarea value": JSON.stringify(textarea.value),
				keys: Object.keys(
					useConversationInputStore.getState().inputByConversation,
				).join(","),
				"textarea color": t.color,
				"textarea caret": t.caretColor,
				"mirror rendered": String(Boolean(mirror)),
				"textarea clientWidth": `${textarea.clientWidth}px`,
				"scrollbar gutter": `${textarea.offsetWidth - textarea.clientWidth}px`,
				"textarea rows": String(
					Math.round(
						(textarea.scrollHeight -
							Number.parseFloat(t.paddingTop) -
							Number.parseFloat(t.paddingBottom)) /
							lineHeight,
					),
				),
				font: t.font,
			};
			if (mirror) {
				const m = getComputedStyle(mirror);
				const box0 = mirror.getBoundingClientRect();
				entry["mirror clientWidth"] = `${mirror.clientWidth}px`;
				entry["fonts equal"] = String(m.font === t.font);
				/*
				 * The WEIGHT channel, as a number. It is the whole of obsidian's
				 * separation (its `info` IS its `ink` IS its `accent`, so the command
				 * run is distinguished by the semibold step alone — the pinned case in
				 * `palette-contract.ts`), and a still cannot show it: the design round
				 * asked for the run's and the prose's `fontWeight` beside the tint's
				 * numbers so the claim is read off the frame set rather than argued.
				 */
				entry["run fontWeights"] =
					[...mirror.querySelectorAll<HTMLElement>("[data-slash-run]")]
						.map(
							(el) =>
								`${el.dataset.slashRun}=${getComputedStyle(el).fontWeight}`,
						)
						.join(",") || "none";
				entry["prose fontWeight"] = m.fontWeight;
				entry["mirror rows"] = String(
					Math.round(
						(mirror.scrollHeight -
							Number.parseFloat(m.paddingTop) -
							Number.parseFloat(m.paddingBottom)) /
							Number.parseFloat(m.lineHeight),
					),
				);
				entry["paddingRight (mirror vs textarea+gutter)"] =
					`${Number.parseFloat(m.paddingRight)}px vs ${Number.parseFloat(t.paddingRight) + (textarea.offsetWidth - textarea.clientWidth)}px`;
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
				range.selectNodeContents(mirror);
				const firstLineTop =
					(range.getClientRects()[0]?.top ?? box0.top) - box0.top;
				entry["first line top"] = `${firstLineTop.toFixed(2)}px`;
				for (const node of mirror.childNodes) {
					if (node.nodeType === Node.ELEMENT_NODE) {
						const el = node as HTMLElement;
						if (el.dataset.slashRun) {
							const rect = el.getBoundingClientRect();
							const newlines = before.split("\n").length - 1;
							const expected =
								firstLineTop + newlines * Number.parseFloat(m.lineHeight);
							entry[`run ${el.dataset.slashRun} "${el.textContent}" top`] =
								`${(rect.top - box0.top).toFixed(2)}px vs ${expected.toFixed(2)}px expected`;
						}
					}
					before += node.textContent ?? "";
				}
			}
			setRows(entry);
			// The same object on the console, so the numbers can be read out of a
			// headless page as well as off the frame.
			console.log(
				`[slash-highlight-geometry] ${JSON.stringify({ draft, entry })}`,
			);
		};
		/*
		 * Measured THREE TIMES, and the repeats are not belt-and-braces: the
		 * composer's command vocabulary arrives from the `commands.list` fixture over
		 * a resolved promise, so a reading taken on the second animation frame
		 * measures an app whose registry is still empty — every word reads as
		 * `unknown` (measured: the first pass logged `run unknown "/compact"`). The
		 * later passes are what the frame and the numbers should describe, and
		 * logging all three keeps the timing visible rather than hidden behind the
		 * last one.
		 */
		const timers: ReturnType<typeof setTimeout>[] = [];
		const raf = requestAnimationFrame(() =>
			requestAnimationFrame(() => {
				if (forceScrollbar) {
					const textarea = boxRef.current?.querySelector("textarea");
					if (textarea) {
						/*
						 * A classic scrollbar needs BOTH: `overflow-y: scroll` reserves the
						 * track, and an explicit `::-webkit-scrollbar` width stops Chromium
						 * from drawing one of the OS's overlay scrollbars, which measure a
						 * 0px gutter however they are asked for (measured on this machine:
						 * `overflow-y: scroll` alone still reported 0). This is the
						 * platform setting's rendering, produced without touching the
						 * operator's system preferences.
						 */
						const style = document.createElement("style");
						style.textContent =
							"textarea::-webkit-scrollbar { width: 15px; } textarea::-webkit-scrollbar-thumb { background: rgb(120,120,120); }";
						document.head.appendChild(style);
						textarea.style.overflowY = "scroll";
						window.dispatchEvent(new Event("resize"));
					}
				}
				measure();
				for (const delay of [400, 1500]) {
					timers.push(setTimeout(measure, delay));
				}
			}),
		);
		return () => {
			cancelAnimationFrame(raf);
			for (const timer of timers) clearTimeout(timer);
		};
	}, [draft, forceScrollbar]);
	return (
		<div ref={boxRef} className={cn("flex flex-col gap-2")}>
			<Draft label={label} draft={draft} />
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
				<GeometryProbe
					label="geometry-name"
					draft={
						"/team frontend-guild review the queue\nand then send it on to the reviewer"
					}
				/>
				<GeometryProbe label="geometry-prose" draft="fix this /usage" />
				{/*
				 * The scrollbar case: a command line long enough to wrap several times
				 * with a classic scrollbar forced onto the field, which is the one state
				 * where the mirror's text column is narrower than its box.
				 */}
				<GeometryProbe
					label="geometry-scrollbar"
					forceScrollbar={true}
					draft={
						"/compact please summarise the failing tests in the TUI crash report, note which of them are flaky, and then stop. Then do it again for the desktop composer and the terminal editor, and tell me which of the two wrappers disagrees about the line it paints."
					}
				/>
			</div>
		</Frame>
	),
};
