/**
 * The composer's slash popup, in every phase and state it can be in.
 *
 * Why this file exists: the popup grew a second PHASE. It used to render one
 * list of commands; it now renders either the command list or a command's
 * argument list, with a model row carrying a window and a price pair in a
 * trailing machine-voice column. Every one of those states is a claim about
 * pixels that is awkward to reach live — a cold owner answers an empty `effort`
 * list, a meta-route has no price pair at all, a narrow composer has to shed the
 * numbers — so they are photographed here instead of argued about.
 *
 * WHAT IS RENDERED. The PRODUCTION `SlashSuggestionsPopup`, given the state
 * shape the real `useSlashCompletion` produces. Only the two things a Storybook
 * cannot have are stood in for:
 *
 *   - the state, because it comes from a React Query against the desktop
 *     control plane (the fixtures below are the exact rows
 *     `commands.entities` sends, shaped by the PRODUCTION `argumentRows` and
 *     ranked by the PRODUCTION `matchCommands` / `matchChoices`, so these frames
 *     are evidence about a shape the backend really sends rather than a
 *     hand-written list that happens to look right);
 *   - the composer box the popup anchors to, because the popup is
 *     `absolute bottom-full` and would otherwise position against the story
 *     root. The harness below is that box: `relative`, the same width rules, a
 *     stand-in for the textarea, and nothing else. The popup is a SIBLING of the
 *     bound, never inside it — the tree the `canonical-chat.test.mjs` clipping
 *     guard defends.
 *
 * What to look for, since these frames are the design review:
 *
 *   - One geometry across both phases: the command row and the argument row share
 *     a left rail, an ink hierarchy and one `aria-activedescendant` contract.
 *   - The active row is a `bg-accent-wash` wash, never a lift, a scale or a
 *     shadow — the popup's own `shadow-lg` is the only elevation here, and it is
 *     the one legitimate kind because the popup leaves the flow.
 *   - The detail column is machine voice: monospace-adjacent numbers, right of
 *     the prose, and it SHEDS FIRST when the box narrows, before the name is
 *     truncated. A number cut in half is worse than no number.
 *   - Sentence case everywhere; the only symbols are the ones the data has
 *     (`free`, `usage-based`, the current-row mark).
 */

import type { Meta, StoryObj } from "@storybook/react";
import type { FC } from "react";
import "../../../styles/index.css";
import { type ArgumentRow, argumentRows } from "./slash-argument-rows";
import {
	type CompletionRow,
	type SlashCommandMeta,
	type SlashCompletionState,
	SlashSuggestionsPopup,
} from "./slash-commands";
import { matchChoices, matchCommands } from "./slash-rank";

/* ---------------------------------------------------------------- fixtures */

/**
 * Registry rows, REAL-SHAPED: the field names and types `GET /v1/desktop/commands`
 * sends (`desktop_commands.py:command_catalogue`).
 */
const COMMANDS: SlashCommandMeta[] = [
	{
		name: "team",
		description: "Attach a team for this session",
		aliases: ["teams"],
		arguments: "optional",
		echo: false,
		consumes_prompt: true,
		destination: "session.team",
		execution: "owner",
	},
	{
		name: "model",
		description: "Show or set the session model",
		aliases: ["models"],
		arguments: "none",
		echo: false,
		consumes_prompt: false,
		destination: "session.model",
		execution: "owner",
	},
	{
		name: "agent",
		description: "Attach a role or specialist for this session",
		aliases: ["agents"],
		arguments: "optional",
		echo: false,
		consumes_prompt: true,
		destination: "session.agent",
		execution: "owner",
	},
	{
		name: "move",
		description: "Move the session to another working directory",
		aliases: [],
		arguments: "optional",
		echo: true,
		consumes_prompt: false,
		destination: "session.cwd",
		execution: "native",
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
		name: "markdown",
		description: "Render the transcript as markdown",
		aliases: [],
		arguments: "none",
		echo: true,
		consumes_prompt: false,
		destination: "transcript.markdown",
		execution: "native",
	},
	{
		name: "usage",
		description: "Provider quota and spend",
		aliases: [],
		arguments: "none",
		echo: false,
		consumes_prompt: false,
		destination: "usage",
		execution: "owner",
	},
	{
		name: "logout",
		description: "Sign out of a provider",
		aliases: [],
		arguments: "optional",
		echo: true,
		consumes_prompt: false,
		destination: "auth.logout",
		execution: "native",
	},
];

const commandRows = (query: string): CompletionRow[] =>
	(query === ""
		? COMMANDS.map((command) => ({ name: command.name, command }))
		: matchCommands(query, COMMANDS)
	).map(({ name, command }) => ({ kind: "command", command, label: name }));

/** A long list, for the scrolled state. */
const MANY_COMMANDS: SlashCommandMeta[] = [
	...COMMANDS,
	...Array.from({ length: 26 }, (_, index) => ({
		name: `plug-${String.fromCharCode(97 + index)}`,
		description: `Plugin command ${String.fromCharCode(65 + index)}`,
		aliases: [],
		arguments: "none" as const,
		echo: false,
		consumes_prompt: false,
		destination: "commands",
		execution: "owner" as const,
	})),
];

/**
 * A model catalogue row, REAL-SHAPED: `dataclasses.asdict(CatalogueEntry)`
 * (`providers/controller.py:100-140`) plus the route's own `value`, which is
 * what `command-entities?command=model` sends.
 */
const modelRow = (over: Record<string, unknown> = {}) => ({
	provider: "anthropic",
	model_id: "claude-opus-5",
	selector: "anthropic/claude-opus-5",
	value: "anthropic/claude-opus-5",
	label: "Claude Opus 5",
	connected: true,
	context_window: 400_000,
	input_price: 3,
	output_price: 15,
	default_context_window: 200_000,
	max_context_window: 400_000,
	aggregated: false,
	routed: false,
	...over,
});

const MODELS = [
	modelRow(),
	modelRow({
		provider: "anthropic",
		model_id: "claude-haiku-5",
		selector: "anthropic/claude-haiku-5",
		value: "anthropic/claude-haiku-5",
		label: "Claude Haiku 5",
		context_window: 200_000,
		input_price: 0.075,
		output_price: 0.3,
	}),
	modelRow({
		provider: "openrouter",
		model_id: "auto",
		selector: "openrouter/auto",
		value: "openrouter/auto",
		label: "Auto Router",
		context_window: 1_048_576,
		input_price: -1,
		output_price: -1,
		routed: true,
		aggregated: true,
	}),
	modelRow({
		provider: "local",
		model_id: "llama-tiny",
		selector: "local/llama-tiny",
		value: "local/llama-tiny",
		label: "Llama Tiny",
		context_window: 128_000,
		input_price: 0,
		output_price: 0,
	}),
	modelRow({
		provider: "anthropic",
		model_id: "claude-opus-4-5-2025-11-01",
		selector: "anthropic/claude-opus-4-5-2025-11-01",
		value: "anthropic/claude-opus-4-5-2025-11-01",
		label: "Claude Opus 4.5 (2025-11-01)",
		context_window: 200_000,
		input_price: 18.75,
		output_price: 15,
	}),
	modelRow({
		provider: "openai",
		model_id: "gpt-noprice",
		selector: "openai/gpt-noprice",
		value: "openai/gpt-noprice",
		label: "GPT, no quote",
		context_window: -1,
		input_price: -1,
		output_price: -1,
		connected: false,
	}),
];

/** Team rows, REAL-SHAPED: `Team.model_dump(mode="json")` plus `value`. */
const TEAMS = [
	{
		id: "t1",
		name: "delivery",
		value: "delivery",
		description: "Ships the release",
	},
	{
		id: "t2",
		name: "frontend-guild",
		value: "frontend-guild",
		description: "Owns the web surface",
	},
	{
		id: "t3",
		name: "research",
		value: "research",
		description: "Reads before it writes",
	},
	{
		id: "t4",
		name: "reviewers",
		value: "reviewers",
		description: "Reviews every diff",
	},
	{ id: "t5", name: "ops", value: "ops", description: "Keeps the lights on" },
	{
		id: "t6",
		name: "design",
		value: "design",
		description: "Owns the rendered frame",
	},
];

/**
 * Theme rows, shaped like the `@shared/themes` table `/theme`'s dialog reads
 * (`{ value, name, description }`): the inline list is renderer-local, so its
 * fixture is the table itself rather than a backend payload.
 */
const THEMES = [
	{
		value: "localOperatorDark",
		name: "Local Operator Dark",
		description: "The brand dark palette",
	},
	{
		value: "localOperatorLight",
		name: "Local Operator Light",
		description: "The brand light palette",
	},
	{ value: "dracula", name: "Dracula", description: "The classic dark theme" },
	{ value: "dune", name: "Dune", description: "Warm sand ground" },
	{
		value: "obsidian",
		name: "Obsidian",
		description: "Near-black ground",
	},
];

const argumentRowsFor = (
	source: "model" | "team" | "agent" | "effort" | "approvals" | "theme",
	entities: readonly unknown[],
	current: unknown,
	query = "",
): CompletionRow[] =>
	matchChoices(query, argumentRows(source, entities, current)).map(
		({ choice }) => ({ kind: "argument", row: choice as ArgumentRow }),
	);

/* ------------------------------------------------------------- harness */

/** No-ops: the popup is presentational, and these frames do not interact. */
const noop = () => {};
const noopIndex = (_index: number) => {};

const state = (over: Partial<SlashCompletionState>): SlashCompletionState => ({
	phase: "command",
	open: true,
	active: 0,
	matches: [],
	listId: "slash-story",
	activeDescendantId: null,
	argumentCommand: null,
	inline: undefined,
	argumentQuery: "",
	argumentList: { rows: [], loading: false, error: null, needsSession: false },
	close: noop,
	setActive: noopIndex,
	setActiveHover: noopIndex,
	chosenByHand: false,
	isLoading: false,
	available: true,
	commands: COMMANDS,
	commandNames: new Set(),
	promptCommands: new Set(),
	nameListCommands: new Set(),
	argumentWords: [],
	enabled: true,
	...over,
});

type BoxProps = {
	/** The composer's width. The popup spans it, so this is the width the
	 *  numbers-shed rule is measured against. */
	width: number;
	/** What the textarea holds, so the frame shows the draft the list is about. */
	draft?: string;
	children: React.ReactNode;
};

/**
 * The composer box the popup anchors to: `relative`, a stand-in for the
 * textarea, and the popup as a SIBLING of everything else — never wrapped.
 *
 * The frame pushes the box to the bottom so the popup, which renders
 * `bottom-full`, has the space above it that it occupies live.
 */
const ComposerBox: FC<BoxProps> = ({ width, draft = "", children }) => (
	<div className="relative" style={{ width }}>
		{children}
		<div className="flex h-11 items-center border border-control bg-surface px-3 font-mono text-body-sm text-ink">
			{draft}
		</div>
	</div>
);

/**
 * One composer in a frame of its own: the box pushed to the bottom of the
 * viewport, so the popup has above it exactly the room it has live.
 */
const Box: FC<BoxProps> = ({ width, draft = "", children }) => (
	<div className="flex h-screen items-end justify-center bg-surface p-6">
		<ComposerBox width={width} draft={draft}>
			{children}
		</ComposerBox>
	</div>
);

/**
 * One case inside a board: a composer plus the room its popup needs ABOVE it.
 *
 * The popup is `absolute bottom-full`, so a stacked case's popup would render
 * on top of the case above it if the row were only as tall as the box. The row
 * therefore reserves the popup's own height, computed from the row count the
 * case renders — which is why a board's cases are declared with their row count
 * rather than left to the flexbox to work out.
 */
const Case: FC<BoxProps & { rows: number }> = ({
	width,
	draft = "",
	rows,
	children,
}) => (
	<div
		className="flex flex-col justify-end"
		style={{ height: `${44 + rows * 36 + 8}px` }}
	>
		<ComposerBox width={width} draft={draft}>
			{children}
		</ComposerBox>
	</div>
);

/**
 * Two or more composer boxes stacked under one caption, for the states whose
 * claim is a COMPARISON: an empty list has three causes and they are different
 * sentences, and "the list closed" only means something next to the list that
 * was open. The repo's other boards (`chat-older-history-slot--every-state`)
 * stack cases the same way, so a frame states its own claim instead of relying
 * on the story name to say what is being compared.
 */
const Board: FC<{ caption: string; children: React.ReactNode }> = ({
	caption,
	children,
}) => (
	<div className="flex h-screen flex-col justify-end gap-2 bg-surface p-6">
		<div className="mx-auto w-[720px] text-meta text-ink-dim">{caption}</div>
		{children}
	</div>
);

const meta: Meta<typeof SlashSuggestionsPopup> = {
	title: "chat-slash-completion",
	component: SlashSuggestionsPopup,
	parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof SlashSuggestionsPopup>;

/* -------------------------------------------------------------- stories */

/** `/` typed: the whole command list, in registry order. */
export const CommandPhase: Story = {
	render: () => (
		<Box width={720} draft="/">
			<SlashSuggestionsPopup
				state={state({ matches: commandRows("") })}
				onPick={noop}
			/>
		</Box>
	),
};

/** `/tea` typed: narrowed to `team`, with the alias row beside it. */
export const CommandPhaseNarrowed: Story = {
	render: () => (
		<Box width={720} draft="/tea">
			<SlashSuggestionsPopup
				state={state({ matches: commandRows("tea") })}
				onPick={noop}
			/>
		</Box>
	),
};

/**
 * A FUZZY query: `/lgt`. No command starts with those letters — the row is a
 * subsequence match on `logout`, which is the behaviour a prefix filter could
 * never produce.
 */
export const CommandPhaseFuzzy: Story = {
	render: () => (
		<Board caption="/lgt — no command starts with those letters; the row is a subsequence match on `logout`.">
			<Box width={720} draft="/lgt">
				<SlashSuggestionsPopup
					state={state({ matches: commandRows("lgt") })}
					onPick={noop}
				/>
			</Box>
		</Board>
	),
};

/** `/team ` typed: the roster, with the session's current team marked. */
export const ArgumentPhaseTeams: Story = {
	render: () => (
		<Box width={720} draft="/team ">
			<SlashSuggestionsPopup
				state={state({
					phase: "argument",
					argumentCommand: "team",
					inline: { source: "team", nameThenMessage: true, runs: false },
					matches: argumentRowsFor("team", TEAMS, "reviewers"),
				})}
				onPick={noop}
			/>
		</Box>
	),
};

/**
 * `/team front` typed: the list narrows as the ARGUMENT, proving the argument
 * phase is what the second keystroke filters rather than the command list.
 */
export const ArgumentPhaseNarrowed: Story = {
	render: () => (
		<Box width={720} draft="/team front">
			<SlashSuggestionsPopup
				state={state({
					phase: "argument",
					argumentCommand: "team",
					inline: { source: "team", nameThenMessage: true, runs: false },
					argumentQuery: "front",
					matches: argumentRowsFor("team", TEAMS, "reviewers", "front"),
				})}
				onPick={noop}
			/>
		</Box>
	),
};

/**
 * `/model ` typed: every row names its provider and carries the context window
 * and the input/output price pair. `free` and `usage-based` are WORDS, a
 * three-significant-figure price keeps its precision, and a row nobody quoted
 * has a blank column rather than a `free` it is not.
 */
export const ArgumentPhaseModels: Story = {
	render: () => (
		<Box width={860} draft="/model ">
			<SlashSuggestionsPopup
				state={state({
					phase: "argument",
					argumentCommand: "model",
					inline: { source: "model", nameThenMessage: false, runs: true },
					matches: argumentRowsFor("model", MODELS, {
						provider: "anthropic",
						model_id: "claude-opus-5",
					}),
				})}
				onPick={noop}
			/>
		</Box>
	),
};

/**
 * The honest empty state. This is the COLD OWNER case: the owner's live spec is
 * unresolved before the first turn, so a model with a full ladder answers `[]`.
 * Reading that as "this model has none" was a defect once, which is why the
 * copy says "not reported yet" and names the route that can still answer.
 */
export const ArgumentPhaseEmpty: Story = {
	render: () => (
		<Board caption="An empty list is not one fact: a cold owner and a draft are different sentences.">
			<Case width={720} draft="/effort " rows={1}>
				<SlashSuggestionsPopup
					state={state({
						phase: "argument",
						argumentCommand: "effort",
						inline: { source: "effort", nameThenMessage: false, runs: true },
						matches: [],
					})}
					onPick={noop}
				/>
			</Case>
			<Case width={720} draft="/team " rows={1}>
				<SlashSuggestionsPopup
					state={state({
						phase: "argument",
						argumentCommand: "team",
						inline: { source: "team", nameThenMessage: true, runs: false },
						argumentList: {
							rows: [],
							loading: false,
							error: null,
							needsSession: true,
						},
						matches: [],
					})}
					onPick={noop}
				/>
			</Case>
		</Board>
	),
};

/**
 * The shed order under pressure: at a narrow composer the numbers run is gone
 * and the name is what remains, truncated BEFORE any number could be cut in
 * half. This is the width the popup spans, not the window's.
 */
export const ArgumentPhaseNarrowComposer: Story = {
	render: () => (
		<Box width={330} draft="/model ">
			<SlashSuggestionsPopup
				state={state({
					phase: "argument",
					argumentCommand: "model",
					inline: { source: "model", nameThenMessage: false, runs: true },
					matches: argumentRowsFor("model", MODELS, null),
				})}
				onPick={noop}
			/>
		</Box>
	),
};

/**
 * The mid-draft frame the whole change is about: a command typed into a
 * sentence, the list open ABOVE the prose, and the draft untouched behind it.
 */
export const InlineMidDraft: Story = {
	render: () => (
		<Box width={720} draft="fix this /team">
			<SlashSuggestionsPopup
				state={state({
					phase: "argument",
					argumentCommand: "team",
					inline: { source: "team", nameThenMessage: true, runs: false },
					matches: argumentRowsFor("team", TEAMS, null),
				})}
				onPick={noop}
			/>
		</Box>
	),
};

/**
 * The state a name-list pick produces: `/team ops ` staged, the caret after the
 * terminating space the completion added, and the list CLOSED — which is what
 * that space is load-bearing for. An enum-tail value must NOT add it, or Tab
 * would appear to fill the field and abandon it in one keystroke.
 */
export const NameListCompleted: Story = {
	render: () => (
		<Board caption="Choosing a name, and what that pick leaves behind: the space terminates the name, so the list closes and the tail becomes free text.">
			<Case width={720} draft="/team ops" rows={1}>
				<SlashSuggestionsPopup
					state={state({
						phase: "argument",
						argumentCommand: "team",
						inline: { source: "team", nameThenMessage: true, runs: false },
						argumentQuery: "ops",
						matches: argumentRowsFor("team", TEAMS, null, "ops"),
					})}
					onPick={noop}
				/>
			</Case>
			<Case width={720} draft="/team ops " rows={0}>
				<SlashSuggestionsPopup
					state={state({ phase: null, open: false, matches: [] })}
					onPick={noop}
				/>
			</Case>
		</Board>
	),
};

/** A long list, scrolled: the popup keeps its own scroll and never grows. */
export const CommandPhaseScrolled: Story = {
	render: () => (
		<Box width={720} draft="/">
			<SlashSuggestionsPopup
				state={state({
					/* Mid-list, so the frame shows the popup's own scroll rather than
					   its top: the effect scrolls the active row into view, which with
					   `block: "nearest"` does nothing while it is already visible. */
					active: 20,
					matches: MANY_COMMANDS.map((command) => ({
						kind: "command" as const,
						command,
						label: command.name,
					})),
				})}
				onPick={noop}
			/>
		</Box>
	),
};

/**
 * `/theme ` — the SIXTH inline source, and the one that is renderer-local.
 *
 * DESIGN §5.3 originally said the set was exactly the five backend entity ids and
 * that `/theme` kept its dialog. Keeping the inline list was the operator's own
 * instruction (round 1 R4), so it is disclosed rather than hidden: the same
 * `@shared/themes` table the dialog reads fills the rows, no second theme
 * vocabulary exists, and this story gives the surface the evidence the other
 * five have. `runs: false` — an unambiguous Enter completes the id and the next
 * Enter runs the command, because the destination is a dialog.
 */
export const ArgumentPhaseThemes: Story = {
	render: () => (
		<Box width={720} draft="/theme ">
			<SlashSuggestionsPopup
				state={state({
					phase: "argument",
					argumentCommand: "theme",
					inline: { source: "theme", nameThenMessage: false, runs: false },
					matches: argumentRowsFor("theme", THEMES, "localOperatorDark"),
				})}
				onPick={noop}
			/>
		</Box>
	),
};

/**
 * The two TRANSIENT states of an argument list, which had no frame at all
 * (round 1 D5). Loading and failure are different facts about the same list and
 * they must not read as "nothing to choose": a failure that looks like an empty
 * roster sends the user to the full picker for an answer that is not there.
 */
export const ArgumentPhaseLoadingAndError: Story = {
	render: () => (
		<Board caption="An argument list that is still loading, and one whose route failed. Different sentences from 'not reported yet'.">
			<Case width={720} draft="/team " rows={1}>
				<SlashSuggestionsPopup
					state={state({
						phase: "argument",
						argumentCommand: "team",
						inline: { source: "team", nameThenMessage: true, runs: false },
						argumentList: {
							rows: [],
							loading: true,
							error: null,
							needsSession: false,
						},
						matches: [],
					})}
					onPick={noop}
				/>
			</Case>
			<Case width={720} draft="/model " rows={1}>
				<SlashSuggestionsPopup
					state={state({
						phase: "argument",
						argumentCommand: "model",
						inline: { source: "model", nameThenMessage: false, runs: true },
						argumentList: {
							rows: [],
							loading: false,
							error: "Could not read the model catalogue.",
							needsSession: false,
						},
						matches: [],
					})}
					onPick={noop}
				/>
			</Case>
		</Board>
	),
};

/**
 * A query that matches nothing while the list HAS rows — the state round 1 UX U4
 * caught reporting "the roster was never reported" about a filter the user had
 * just typed. It is now its own sentence.
 */
export const ArgumentPhaseNoMatch: Story = {
	render: () => (
		<Box width={720} draft="/team zzz">
			<SlashSuggestionsPopup
				state={state({
					phase: "argument",
					argumentCommand: "team",
					inline: { source: "team", nameThenMessage: true, runs: false },
					argumentQuery: "zzz",
					argumentList: {
						rows: argumentRows("team", TEAMS, null) as ArgumentRow[],
						loading: false,
						error: null,
						needsSession: false,
					},
					matches: [],
				})}
				onPick={noop}
			/>
		</Box>
	),
};

/**
 * The truncation HALF of the shed order, which the 720px and 332px frames both
 * missed (round 1 D5): at ~520px the numbers are still shown and the NAME has to
 * give. The question a design round has to answer is whether the identity stays
 * readable when it, and not the numbers, truncates — so the frame is captured at
 * the width where that happens rather than reasoned about.
 */
export const ArgumentPhaseTruncatingName: Story = {
	render: () => (
		<Box width={520} draft="/model ">
			<SlashSuggestionsPopup
				state={state({
					phase: "argument",
					argumentCommand: "model",
					inline: { source: "model", nameThenMessage: false, runs: true },
					matches: argumentRowsFor("model", MODELS, null),
				})}
				onPick={noop}
			/>
		</Box>
	),
};
