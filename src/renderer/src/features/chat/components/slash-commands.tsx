/**
 * Slash command completion for the composer: the command-word phase AND the
 * argument phase, in one listbox.
 *
 * The command list comes from the backend's shared registry over the desktop
 * control plane (`commands.list`) — never a second React-side vocabulary. The
 * popup floats ABOVE the composer in a bounded list with its own scroll, so
 * opening it never shifts the layout under the user's hands. The textarea keeps
 * DOM focus throughout; arrows move an `aria-activedescendant` marker,
 * Enter/Tab complete (never send), Escape closes the popup leaving the draft
 * untouched, and an IME composition in flight is never interrupted.
 *
 * WHAT CHANGED AND WHY, since the two phases are one state machine:
 *
 *   - Detection is caret-aware and inline (`slash-token.ts`), so a command typed
 *     into a sentence opens the list and a later `/` inside an engaged command's
 *     argument does not.
 *   - Ranking is the TUI's scorer (`slash-rank.ts`), so `/lgt` finds `/logout`,
 *     and the row label is the alias that matched — the row a user highlights is
 *     the string Enter writes.
 *   - Completing a word inserts a trailing space, ALWAYS. That is what the TUI
 *     does (`command_picker.py:completion_for`, COMMAND mode) and it is what
 *     makes `/model ` reachable at all: the shared registry's own `arguments`
 *     field says `none` for `model` (it states what the TUI's keyboard offers),
 *     so keying the space off it left the caret inside the word and the argument
 *     phase unreachable. The registry's `arguments` therefore stays authoritative
 *     for ONE thing on this surface: the row hint that describes it.
 *   - The argument list is declared by `picker-registry`'s `inline` field, which
 *     names the host route a registry `destination` resolves to. There is
 *     deliberately no second flag for "does the space open a list".
 *   - Esc latches per PHASE and per token, so a caret move that stays inside one
 *     phase does not reopen a list the user just dismissed
 *     (`editor.py:_sync_picker_if_phase_changed`).
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	desktopKeys,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { cn } from "@shared/lib/utils";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { themes } from "@shared/themes";
import { useQuery } from "@tanstack/react-query";
import type { FC, KeyboardEvent } from "react";
import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { useEntities } from "../pickers/destination-pickers";
import {
	DESTINATIONS,
	type InlineArgumentSource,
	inlineArgumentFor,
} from "../pickers/picker-registry";
import {
	type ArgumentRow,
	type ArgumentSource,
	argumentRows,
} from "./slash-argument-rows";
import {
	argumentEmptyCopy,
	candidateKey,
	chosenByHandSurvives,
	clickFooter,
	commandChoiceUnambiguous,
	commandLabels,
	enterFooter,
	phaseLabel,
	pointerPickRuns,
	rowId,
	sharedCommandPrefix,
	slashDestructive,
	slashKeyIntent,
	slashRunAllowed,
} from "./slash-contract";
import { commandSuggestions, matchChoices } from "./slash-rank";
import {
	caretPhase,
	replaceSpan,
	slashArgumentContext,
	slashContext,
} from "./slash-token";

export type SlashCommandMeta = {
	name: string;
	description: string;
	aliases: string[];
	arguments: "none" | "optional" | "required";
	echo: boolean;
	consumes_prompt: boolean;
	destination: string;
	execution: "owner" | "native";
};

const MAX_VISIBLE_ROWS = 6;

/**
 * The popup's row pitch, in px: `py-2` (16) plus the `text-body-sm` line box
 * (20). Named because the row region's max-height is a whole multiple of it, so
 * the list never RESTS on a half-row slice — a 2px thumb already says "more
 * content", and a sliced glyph at the top edge reads as a clipping bug rather
 * than as a scroller (round 1 N1).
 */
const ROW_PITCH = 36;

/**
 * Any whitespace. Top-level so the "a name is one word" check below builds no
 * regex per keystroke; the popup re-renders on every character.
 */
const WHITESPACE = /\s/;

/** One row of the listbox. Both phases share one geometry and one
 *  `aria-activedescendant` contract, so they also share one row shape. */
export type CompletionRow =
	/**
	 * A command-word row. `label` is the NAME OR ALIAS that matched — the string
	 * the row shows and the string the completion writes, so the highlight
	 * cannot describe something Enter will not do.
	 */
	| { kind: "command"; command: SlashCommandMeta; label: string }
	| { kind: "argument"; row: ArgumentRow };

/**
 * The registry row a typed word names, primary or alias.
 *
 * One resolver, shared with `slash-dispatch` so the planner and the dispatcher
 * cannot disagree about which spelling of a command is a command.
 */
export function resolveCommand(
	commands: readonly SlashCommandMeta[],
	word: string,
): SlashCommandMeta | undefined {
	const wanted = word.toLowerCase();
	return (
		commands.find((command) => command.name.toLowerCase() === wanted) ??
		commands.find((command) =>
			command.aliases.some((alias) => alias.toLowerCase() === wanted),
		)
	);
}

/**
 * Names (primaries AND aliases) of every command whose destination carries an
 * inline argument list, and the subset whose list opens before a name is typed.
 *
 * Derived from the `inline` field rather than from a second list of command
 * names, so a new registry row fails in one place (`picker-registry.tsx` states
 * why the table is keyed by destination).
 */
function argumentVocabulary(commands: readonly SlashCommandMeta[]): {
	words: string[];
	nameList: Set<string>;
} {
	const words: string[] = [];
	const nameList = new Set<string>();
	for (const command of commands) {
		const inline = inlineArgumentFor(command.destination);
		if (!inline) continue;
		for (const name of [command.name, ...command.aliases]) {
			const lower = name.toLowerCase();
			words.push(lower);
			if (inline.nameThenMessage) nameList.add(lower);
		}
	}
	return { words, nameList };
}

export type SlashArgumentListState = {
	/** Rows for the argument list, shaped by `slash-argument-rows`. */
	rows: ArgumentRow[];
	loading: boolean;
	/** Set when the list could not be read at all (a 5xx or a transport drop). */
	error: string | null;
	/** No live session, so no entity source can answer. */
	needsSession: boolean;
};

export type SlashCompletionState = {
	phase: "command" | "argument" | null;
	open: boolean;
	active: number;
	matches: CompletionRow[];
	listId: string;
	/** The `aria-activedescendant` the textarea should point at, or null. */
	activeDescendantId: string | null;
	/** The command word whose argument list is up, when in the argument phase. */
	argumentCommand: string | null;
	/** The inline disposition of that command. Presence is the whole of
	 *  "completing its word opens a list". */
	inline: InlineArgumentSource | undefined;
	/** The argument text typed so far, for the ambiguity gate. */
	argumentQuery: string;
	/**
	 * The COMMAND word typed so far, without its slash.
	 *
	 * The command phase's mirror of `argumentQuery`, and added for the same reason
	 * the two footers read the same inputs the router does: Enter's meaning in the
	 * command phase is decided by comparing this word against the active row's
	 * label, so the popup cannot state it without holding it.
	 */
	commandQuery: string;
	/** The argument list's own loading/error/empty state. */
	argumentList: SlashArgumentListState;
	close(): void;
	setActive(index: number): void;
	/** Move the marker WITHOUT marking the choice as hand-made: a hover is not
	 *  the explicit move the ambiguity gate is answered by. */
	setActiveHover(index: number): void;
	/** True once an arrow key has moved the marker in this list. */
	chosenByHand: boolean;
	isLoading: boolean;
	available: boolean;
	commands: SlashCommandMeta[];
	/** Registry-derived vocabularies the submit planner needs. */
	commandNames: ReadonlySet<string>;
	promptCommands: ReadonlySet<string>;
	nameListCommands: ReadonlySet<string>;
	/** The words whose argument phase is live, for the completion span lookup. */
	argumentWords: readonly string[];
	/** Whether the slash feature is on at all. */
	enabled: boolean;
};

/**
 * The argument list's data source.
 *
 * The entity-backed sources reuse the picker dialogs' own `useEntities` query —
 * same key, same path mapper — so the composer and the dialog cannot end up
 * showing different rungs for the same command (the round-1 U3 rule the
 * session-status strip's effort chip already follows). `/theme` is the one
 * renderer-local source: it reads the same `@shared/themes` table its dialog
 * reads, so there is no second theme vocabulary.
 */
function useArgumentRows(
	source: ArgumentSource | undefined,
	sessionId: string | undefined,
	activeTeam: unknown,
	activeAgent: unknown,
	enabled: boolean,
): SlashArgumentListState {
	const themeName = useUiPreferencesStore((state) => state.themeName);
	// Hooks cannot be called conditionally, so the entity query always runs and
	// is merely DISABLED for the renderer-local source.
	const entitySource = source && source !== "theme" ? source : "model";
	const entities = useEntities(
		sessionId ?? "",
		entitySource,
		undefined,
		enabled && Boolean(source) && source !== "theme" && Boolean(sessionId),
	);
	const localThemes = useMemo(
		() =>
			Object.values(themes).map((theme) => ({
				value: theme.id,
				name: theme.name,
				description: theme.description,
			})),
		[],
	);

	/*
	 * The row's `current`. For the profile commands it is the canonical
	 * session's active profile, NOT the response's `current` — that field is the
	 * resolved org chart / profile detail and belongs to the dialog's detail
	 * pane (`desktop_catalogues.py:283-300`), so reading it here would mark
	 * every row current on a response that happens to carry a chart. For the
	 * value commands it really is the live setting and comes from the entities
	 * payload's own `current`.
	 */
	const current =
		source === "team"
			? activeTeam
			: source === "agent"
				? activeAgent
				: source === "theme"
					? themeName
					: entities.data?.current;

	return useMemo(() => {
		if (!source) {
			return { rows: [], loading: false, error: null, needsSession: false };
		}
		if (source === "theme") {
			return {
				rows: argumentRows("theme", localThemes, current),
				loading: false,
				error: null,
				needsSession: false,
			};
		}
		if (!sessionId) {
			// No session, no entity source. Called out rather than rendered as an
			// empty list, because "not reported yet" would be a lie about a
			// command that was never asked.
			return { rows: [], loading: false, error: null, needsSession: true };
		}
		return {
			rows: argumentRows(source, entities.data?.entities ?? [], current),
			loading: entities.isLoading,
			error: entities.isError
				? "The list could not be loaded. Try again."
				: null,
			needsSession: false,
		};
	}, [
		source,
		localThemes,
		entities.data,
		entities.isLoading,
		entities.isError,
		current,
		sessionId,
	]);
}

export type SlashCompletionArgs = {
	inputValue: string;
	selectionStart: number;
	/** The live canonical session id, or undefined for a draft. */
	sessionId?: string;
	/** The session's active profile, for the roster lists' current marker. */
	activeProfile?: { team?: unknown; agent?: unknown };
};

export function useSlashCompletion({
	inputValue,
	selectionStart,
	sessionId,
	activeProfile,
}: SlashCompletionArgs): SlashCompletionState {
	const capabilities = useDesktopCapabilities();
	const enabled = desktopFeatureEnabled(capabilities.data, "commands");
	const listId = useId();
	const query = useQuery({
		queryKey: desktopKeys.commands,
		queryFn: () =>
			desktopResult<{ commands: SlashCommandMeta[] }>({
				op: "commands.list",
			}).then((result) => result.commands),
		enabled,
		staleTime: 300_000,
	});

	const registry = useMemo(() => query.data ?? [], [query.data]);
	const vocabulary = useMemo(() => argumentVocabulary(registry), [registry]);
	const commandNames = useMemo(() => {
		const names = new Set<string>();
		for (const command of registry) {
			names.add(command.name.toLowerCase());
			for (const alias of command.aliases) names.add(alias.toLowerCase());
		}
		return names;
	}, [registry]);
	const promptCommands = useMemo(() => {
		const names = new Set<string>();
		for (const command of registry) {
			if (!command.consumes_prompt) continue;
			names.add(command.name.toLowerCase());
			for (const alias of command.aliases) names.add(alias.toLowerCase());
		}
		return names;
	}, [registry]);

	// The caret's phase decides which list is up, and the two are mutually
	// exclusive by construction (`slash-token.ts:caretPhase` asserts the order).
	const commandContext = useMemo(
		() => slashContext(inputValue, selectionStart, commandNames),
		[inputValue, selectionStart, commandNames],
	);
	const argumentContext = useMemo(
		() =>
			vocabulary.words.length > 0
				? slashArgumentContext(
						inputValue,
						vocabulary.words,
						selectionStart,
						commandNames,
					)
				: null,
		[inputValue, selectionStart, vocabulary, commandNames],
	);
	const argumentWord = useMemo(() => {
		if (!argumentContext) return null;
		const line = inputValue
			.slice(argumentContext.tokenStart + 1)
			.split("\n")[0];
		return line.split(" ")[0]?.toLowerCase() ?? null;
	}, [argumentContext, inputValue]);

	const inline = useMemo(() => {
		if (!argumentWord) return undefined;
		const spec = resolveCommand(registry, argumentWord);
		return spec ? inlineArgumentFor(spec.destination) : undefined;
	}, [argumentWord, registry]);

	const commandMatches = useMemo(() => {
		if (!commandContext) return [];
		/*
		 * A bare `/` shows the WHOLE command list in registry order; a short query
		 * keeps only its prefix matches when it has any. Both rules live in
		 * `commandSuggestions` (the TUI's `command_suggestions`), so the picker and
		 * the matcher cannot answer `/` or `/m` differently (round 1 R3).
		 */
		const ranked = commandSuggestions(commandContext.query, registry);
		return ranked.map(
			({ name, command }) =>
				({ kind: "command", command, label: name }) as CompletionRow,
		);
	}, [commandContext, registry]);

	const argumentList = useArgumentRows(
		inline?.source,
		sessionId,
		activeProfile?.team,
		activeProfile?.agent,
		enabled,
	);

	const argumentMatches = useMemo(
		() =>
			inline && argumentContext
				? matchChoices(argumentContext.value, argumentList.rows).map(
						({ choice }) =>
							({ kind: "argument", row: choice }) as CompletionRow,
					)
				: [],
		[inline, argumentContext, argumentList.rows],
	);

	/*
	 * The caret's phase, from the ONE function that defines it, so the two lists
	 * cannot both be up and the production rule is the rule the tokenizer's own
	 * tests pin. The command phase additionally needs a non-empty list to open at
	 * all (today's behaviour: a query that matches nothing shows nothing), while
	 * the argument phase must open on an EMPTY list because its empty state is a
	 * SENTENCE the user needs — "not reported yet" is the `effort` cold-owner
	 * case, and a different fact from "this model has none".
	 */
	const purePhase = caretPhase(
		inputValue,
		selectionStart,
		commandNames,
		vocabulary.words,
	);
	/*
	 * A NAME+message list ends at the name. The trailing space a completed pick
	 * inserts is the terminator (`editor.py:_complete_name_argument`), so from
	 * the first whitespace in the argument on, the caret is in the free-text
	 * tail and no list is offered — otherwise the pick left the roster sheet
	 * open over the message the user was writing, reporting a query that matched
	 * nothing as "the roster was never reported" (round 1 UX U4). A name is one
	 * word, so whitespace is exactly the signal.
	 */
	const nameComplete =
		inline?.nameThenMessage === true &&
		argumentContext !== null &&
		WHITESPACE.test(argumentContext.value);
	const phase: SlashCompletionState["phase"] =
		purePhase === "argument"
			? inline && !nameComplete
				? "argument"
				: null
			: purePhase === "command" && commandMatches.length > 0
				? "command"
				: null;

	const matches = phase === "argument" ? argumentMatches : commandMatches;
	const eligible = enabled && phase !== null;
	const visible = eligible && (matches.length > 0 || phase === "argument");

	const [state, setState] = useState({ open: false, active: 0 });
	const [chosenByHand, setChosenByHand] = useState(false);
	/*
	 * Esc latches PER PHASE AND PER TOKEN.
	 *
	 * Without it the list reopened on the very next keystroke, because the
	 * re-derivation runs on every render: a user who dismissed the roster with
	 * Escape could not type a word into their own message without the list
	 * coming back. Cleared only when the phase or the token changes, which is
	 * the TUI's `_sync_picker_if_phase_changed` rule.
	 */
	const dismissedPhase = useRef<string | null>(null);
	/*
	 * What the list is showing: which list (phase + token start) and what has
	 * been typed into it. Esc latches on this whole key, which is the TUI's own
	 * rule — `command_picker.py:_apply` retires `_dismissed_query` as soon as the
	 * QUERY changes ("the token changed, so Esc's 'not now' has expired") — so a
	 * user who dismissed a list and kept typing gets it back, while a caret move
	 * that stays inside one phase does not (`_sync_picker_if_phase_changed`).
	 */
	const queryText =
		phase === "argument"
			? (argumentContext?.value ?? "")
			: (commandContext?.query ?? "");
	const phaseKey =
		phase === null
			? null
			: phase === "argument"
				? `argument:${argumentContext?.tokenStart ?? -1}:${queryText}`
				: `command:${commandContext?.start ?? -1}:${queryText}`;
	const lastPhaseKey = useRef<string | null>(null);
	/*
	 * The candidate SET, by rendered row id. The TUI retires an explicit arrow
	 * choice when the candidate set changes (`command_picker.py:1728`: "the row
	 * the user arrowed onto is gone"), and carrying the latch across a new list
	 * is how one arrow press let Enter RUN a fuzzy survivor the user never moved
	 * to (round 1 R1). Criterion 10's "hand-moved" means moved onto THIS row in
	 * THIS list.
	 */
	const matchKey = candidateKey(matches);
	const lastMatchKey = useRef<string>(matchKey);

	useEffect(() => {
		if (phaseKey !== dismissedPhase.current) dismissedPhase.current = null;
		const changed = lastPhaseKey.current !== phaseKey;
		lastPhaseKey.current = phaseKey;
		// A different candidate set re-arms the ambiguity gate.
		if (!chosenByHandSurvives(lastMatchKey.current, matchKey)) {
			lastMatchKey.current = matchKey;
			setChosenByHand(false);
		}
		setState((current) => {
			// Esc latches: while this phase and token are the dismissed ones the
			// list stays closed, which is what stops it reopening on the very next
			// keystroke the user is typing into their own message. Without the
			// second clause the latch was recorded but never consulted, so Escape
			// only held until the next render changed a dependency (round 1 UX U5).
			if (!visible || dismissedPhase.current === phaseKey) {
				return current.open ? { ...current, open: false } : current;
			}
			return {
				// A new phase or token moves the marker back to the top; typing
				// more letters inside one phase CLAMPS it, so the marker does not
				// jump off a row the user is looking at.
				open: true,
				active: changed
					? 0
					: Math.min(current.active, Math.max(matches.length - 1, 0)),
			};
		});
	}, [visible, phaseKey, matches.length, matchKey]);

	const close = useCallback(() => {
		dismissedPhase.current = phaseKey;
		setState((current) => ({ ...current, open: false }));
	}, [phaseKey]);

	const setActive = useCallback((index: number) => {
		setChosenByHand(true);
		setState((current) => ({ ...current, active: index }));
	}, []);

	// A pointer entering a row moves the marker but does NOT count as the
	// explicit move the ambiguity gate is answered by: the pointer passes over
	// rows on its way somewhere else, and treating that as a choice would let
	// Enter run a fuzzy survivor on a hover the user never meant.
	const setActiveHover = useCallback((index: number) => {
		setState((current) => ({ ...current, active: index }));
	}, []);

	return {
		phase,
		open: state.open && visible,
		active: state.active,
		matches,
		listId,
		activeDescendantId:
			state.open && visible && matches[state.active]
				? `${listId}-${rowId(matches[state.active])}`
				: null,
		argumentCommand: argumentWord,
		inline,
		argumentQuery: argumentContext?.value ?? "",
		commandQuery: commandContext?.query ?? "",
		argumentList,
		close,
		setActive,
		setActiveHover,
		chosenByHand,
		isLoading: enabled && query.isLoading,
		available: enabled,
		commands: registry,
		commandNames,
		promptCommands,
		nameListCommands: vocabulary.nameList,
		argumentWords: vocabulary.words,
		enabled,
	};
}

type SlashSuggestionsPopupProps = {
	state: SlashCompletionState;
	onPick: (row: CompletionRow, disposition: { run: boolean }) => void;
};

/** Detail-column visibility threshold, in the popup's own width.
 *
 * The popup spans the composer, so the width to design against is the
 * COMPOSER's, not the window's — a container query asks exactly that question.
 * Below this the numbers run is dropped and the name is what remains: two
 * columns of metadata in a narrow box leaves nothing for the identity, which is
 * the part being chosen. The name truncates FIRST, because a number cut in half
 * is worse than no number at all. */
const NUMBERS_MIN = "@min-[24rem]/slash:inline";

export const SlashSuggestionsPopup: FC<SlashSuggestionsPopupProps> = ({
	state,
	onPick,
}) => {
	const listId = state.listId;
	const activeRef = useRef<HTMLLIElement | null>(null);

	// Keep the active row in view without scrolling the page or transcript.
	// state.active is a trigger (the ref is read, not the state), so the
	// exhaustive-deps rule's complaint is suppressed the way the composer
	// textarea's re-measure effect already does.
	// biome-ignore lint/correctness/useExhaustiveDependencies: trigger, not a read
	useEffect(() => {
		activeRef.current?.scrollIntoView({ block: "nearest" });
	}, [state.active]);

	if (!state.open) return null;

	const argument = state.phase === "argument";
	const activeRow = state.matches[state.active];
	const activeArgument = activeRow?.kind === "argument" ? activeRow.row : null;
	const activeCommand = activeRow?.kind === "command" ? activeRow : null;
	/*
	 * Whether a click on the active row RUNS it, from the one function that
	 * decides it. A command row's answer is its DESTINATION's (`pointerPickRuns`,
	 * the same rule `message-input.tsx` acts on), an argument row's is its own
	 * list's `runs` — the two kinds answer from different places on purpose, and
	 * reading either off the row's rendered hint column is exactly the defect
	 * U10 measured.
	 */
	const pickRuns = activeCommand
		? pointerPickRuns(
				activeCommand.command.destination,
				DESTINATIONS[activeCommand.command.destination],
			)
		: (state.inline?.runs ?? false);
	/*
	 * The footer names what Enter does in the state the user is looking at. The
	 * four meanings of Enter (complete, complete-and-wait, run, stage) are real
	 * state, and a user who looked away for one keystroke had no way to tell
	 * which one was next; the gate that decides run-vs-complete is invisible too
	 * (round 1 UX U2). Staging is announced by its own note instead — it happens
	 * on a composer Enter with the list already closed.
	 *
	 * Both phases answer from the SAME decision the router reads, so the line
	 * cannot promise a gesture the key does not perform: the argument phase's
	 * `slashRunAllowed`, the command phase's `commandChoiceUnambiguous`. Its `runs`
	 * is `pickRuns` for the same reason — those are the two halves of what Enter
	 * does to a command row (may it run, and does its destination).
	 */
	const footer = enterFooter({
		phase: argument ? "argument" : "command",
		command: state.argumentCommand,
		label: activeCommand?.label ?? "",
		nameThenMessage: state.inline?.nameThenMessage ?? false,
		runs: pickRuns,
		value: activeArgument?.value ?? "",
		matched: Boolean(activeRow),
		unambiguous: activeArgument
			? slashRunAllowed({
					argumentQuery: state.argumentQuery,
					value: activeArgument.value,
					total: state.matches.length,
					destructive: slashDestructive(
						state.argumentCommand,
						activeArgument.alert,
					),
					chosenByHand: state.chosenByHand,
				})
			: activeCommand
				? commandChoiceUnambiguous({
						query: state.commandQuery,
						label: activeCommand.label,
						total: state.matches.length,
						chosenByHand: state.chosenByHand,
					})
				: false,
		/*
		 * The ambiguous line's two inputs: the word typed and the prefix the
		 * candidates share. The SAME `sharedCommandPrefix` the router extends to, so
		 * the copy cannot claim a growth the key will not make (it is a no-op when
		 * the word is already the prefix, and when the candidates share nothing).
		 */
		query: state.commandQuery,
		prefix: sharedCommandPrefix(commandLabels(state.matches)),
	});
	const click = clickFooter({
		phase: argument ? "argument" : "command",
		command: state.argumentCommand,
		label: activeRow?.kind === "command" ? activeRow.label : "",
		nameThenMessage: state.inline?.nameThenMessage ?? false,
		runs: pickRuns,
		value: activeArgument?.value ?? "",
		matched: Boolean(activeRow),
	});

	return (
		/* biome-ignore lint/a11y/useFocusableInteractive: the textarea keeps focus; the listbox is reached through aria-activedescendant, so it is not in the tab order. */
		<div
			id={listId}
			// biome-ignore lint/a11y/useFocusableInteractive: the textarea keeps focus; the listbox is reached through aria-activedescendant, so it is not in the tab order.
			// biome-ignore lint/a11y/useSemanticElements: a type-to-filter combobox cannot be a native <select>.
			role="listbox"
			aria-label={argument ? "Command arguments" : "Slash commands"}
			className={cn(
				"@container/slash absolute bottom-full left-0 right-0 z-20 mb-1",
				// `overflow-hidden`, not `overflow-y-auto`: the SCROLL belongs to the
				// row region below, so the label and the footer stay put and the
				// region's height can be a whole multiple of the row pitch.
				"overflow-hidden rounded-md border border-control bg-elevated",
				"shadow-lg",
			)}
		>
			{/*
			 * The phase label. Both phases rendered one box with one geometry, so
			 * the only cues that the list changed MEANING were a vanished `/` and a
			 * vanished hint column — and the meaning is what decides what Enter does
			 * (round 1 D3 / UX U3). One word, sentence case, an existing role.
			 */}
			<div className="border-b border-hairline px-3 py-1 text-meta text-ink-dim">
				{phaseLabel(argument ? "argument" : "command", state.inline?.source)}
			</div>
			{/*
			 * The row region owns the scroller, and its max-height is a whole number
			 * of ROW_PITCH: a list that rests on a half-row slice reads as a clipped
			 * glyph rather than as "there is more", which the 2px thumb already
			 * says (round 1 N1).
			 */}
			<div
				className="overflow-y-auto"
				style={{ maxHeight: `${MAX_VISIBLE_ROWS * ROW_PITCH}px` }}
			>
				{state.matches.length === 0 ? (
					<div className="px-3 py-2 text-body-sm text-ink-muted">
						{argument
							? argumentEmptyCopy(state.argumentList)
							: "No commands match."}
					</div>
				) : (
					<ul>
						{state.matches.map((row, index) => (
							/* biome-ignore lint/a11y/useFocusableInteractive: focus stays in the composer textarea; the active option is announced through aria-activedescendant. */
							/* biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard is handled on the textarea, not on the option — arrows, Enter and Escape are the composer's, and the click below is the pointer's own gesture on the row the marker is on. */
							<li
								key={rowId(row)}
								id={`${listId}-${rowId(row)}`}
								ref={index === state.active ? activeRef : null}
								// biome-ignore lint/a11y/useFocusableInteractive: focus stays in the composer textarea; the active option is announced through aria-activedescendant.
								// biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: a combobox option cannot be a native <option> here.
								// biome-ignore lint/a11y/useSemanticElements: a type-to-filter combobox option cannot be a native <option>.
								role="option"
								aria-selected={index === state.active}
								aria-current={
									row.kind === "argument" && row.row.current
										? "true"
										: undefined
								}
								className={cn(
									"relative flex cursor-default items-baseline gap-3 px-3 py-2",
									index === state.active
										? cn(
												"bg-accent-wash",
												// The row Enter will APPLY was carried by hue alone — the
												// wash measures 1.000:1 against its own ground in `dune`
												// and 1.017-1.046:1 in four more themes, and the `●`
												// cannot take the job because it means "current". A 2px
												// accent bar on the leading edge is a second,
												// non-luminance signal that costs no layout (round 1
												// D6).
												"before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent",
											)
										: "bg-transparent",
								)}
								onMouseDown={(event) => {
									// Focus, not the pick. Preventing the default here keeps the
									// textarea's caret and draft position, which a focus change to
									// the row would drop before the handler could read them.
									event.preventDefault();
								}}
								onClick={() => {
									// A COMPLETED click, not pointer-down: a press the user
									// aborts by dragging off the row must not act, and the acting
									// set includes destinations that leave the chat (U11).
									// A click names one exact row with a pointer, which is not the
									// guess the keyboard's ambiguity gate protects against — so a
									// pointer pick of a runnable row runs it (`editor.py:8040`).
									onPick(row, { run: true });
								}}
								onMouseEnter={() => state.setActiveHover(index)}
							>
								{row.kind === "command"
									? commandRowContent(row)
									: argumentRowContent(row)}
							</li>
						))}
					</ul>
				)}
			</div>
			{(footer || click) && (
				/*
				 * One bordered strip, two lines: Enter's meaning on the first, the
				 * pointer's on the second. Both are read off the same active row, so
				 * the pair cannot describe two different rows, and the pointer line is
				 * ABSENT whenever there is no row to act on (an empty argument list).
				 */
				<div className="border-t border-hairline px-3 py-1 text-meta text-ink-dim">
					{footer ? <p>{footer}</p> : null}
					{click ? <p>{click}</p> : null}
				</div>
			)}
		</div>
	);
};

function commandRowContent(row: Extract<CompletionRow, { kind: "command" }>) {
	const { command, label } = row;
	return (
		<>
			<span className="shrink-0 font-mono text-body-sm text-ink">/{label}</span>
			{command.aliases.length > 0 && (
				<span className="shrink-0 text-meta text-ink-dim">
					{command.aliases
						.filter((alias) => alias !== label)
						.map((alias) => `/${alias}`)
						.join(" ")}
				</span>
			)}
			<span className="min-w-0 flex-1 truncate text-body-sm text-ink-muted">
				{command.description}
			</span>
			{command.arguments !== "none" && (
				<span className="shrink-0 text-meta text-ink-dim">
					{command.arguments === "required" ? "needs a value" : "value?"}
				</span>
			)}
		</>
	);
}

function argumentRowContent(row: Extract<CompletionRow, { kind: "argument" }>) {
	const value = row.row;
	return (
		<>
			{/*
			 * The current-row marker is the TUI's own (`model_picker.py:_CURRENT_MARK`),
			 * kept as a glyph rather than a colour step so it survives a theme swap
			 * and does not read as a second selection. The SLOT is always rendered,
			 * fixed width, so the marker can never move the name or the description
			 * column: it used to sit in the row's text flow and indent the marked row
			 * by ~24px in all twelve themes (round 1 D1). `title` names it, because
			 * the glyph is the only thing distinguishing "current" from "the row Enter
			 * would apply" (round 1 N2); screen readers get the same fact from
			 * `aria-current` on the row.
			 */}
			<span
				aria-hidden="true"
				title={value.current ? "Current" : undefined}
				className="w-2.5 shrink-0 text-center font-mono text-body-sm text-ink"
			>
				{value.current ? "●" : ""}
			</span>
			<span className="min-w-0 shrink truncate font-mono text-body-sm text-ink">
				{value.name}
			</span>
			{value.description && (
				<span className="min-w-0 flex-1 truncate text-body-sm text-ink-muted">
					{value.description}
				</span>
			)}
			{value.detail && (
				/* The numbers run sheds FIRST under pressure: the identity is what is
				   being chosen, so it keeps its cells and the detail column steps
				   aside rather than truncating a price or a window. `font-mono` because
				   the detail sits BESIDE a monospace name and DESIGN §7-E calls the
				   numbers machine voice; in the prose face the 18-character
				   `200k · $0.075/0.3` measured NARROWER than the 16-character
				   `1m · usage-based`, which no monospace face can produce (round 1
				   D4).
				 */
				<span
					className={cn(
						"hidden shrink-0 font-mono text-meta",
						NUMBERS_MIN,
						value.alert ? "text-danger" : "text-ink-dim",
					)}
				>
					{value.detail}
				</span>
			)}
		</>
	);
}

/**
 * Keyboard handler for the composer textarea while the popup is open.
 * Returns true when the event was consumed. IME composition (`isComposing`)
 * always passes through: stealing Enter mid-composition breaks CJK input.
 *
 * Enter means four different things here, and which one is decided by the phase
 * and the ambiguity gate — the TUI's own split (`editor.py:_resolve_argument`,
 * `:8060-8115`):
 *
 *   - command phase, Tab: complete the word, replace the token span, open the
 *     argument list when the destination has one; never submit.
 *   - command phase, Enter: the same completion, PLUS a run when the choice is
 *     unambiguous. An ambiguous query grows the word to the matches' common
 *     prefix instead and leaves the list open.
 *   - argument phase, NAME+message command: fill the name and a space, close the
 *     list, never submit. For these "a name is chosen" is not "run it", it is
 *     "ready for the message" (`editor.py:NAME_ARGUMENT_COMMANDS`).
 *   - argument phase, Tab: complete the value only, so the matcher keeps
 *     matching and the user can keep typing.
 *   - argument phase, Enter: complete, then run only when the choice is
 *     unambiguous. Anything else completes and waits for a second Enter, which
 *     is what keeps a fuzzy match one keystroke away from a credential delete.
 */
export function handleSlashKeyDown(
	event: KeyboardEvent<HTMLTextAreaElement>,
	state: SlashCompletionState,
	onPick: (row: CompletionRow, disposition: { run: boolean }) => void,
	onExtend: (word: string) => void,
): boolean {
	/*
	 * The decision itself is `slashKeyIntent`, which is pure and bundled by
	 * `scripts/slash-contract.test.mjs` — the browser harness cannot dispatch key
	 * events, so the routing and the ambiguity gate have to be exercised as the
	 * code that ships or they are not exercised at all (round 1 QA Q2). This
	 * adapter only turns the intent into state changes.
	 */
	const intent = slashKeyIntent({
		key: event.key,
		composing: event.nativeEvent.isComposing,
		open: state.open,
		active: state.active,
		matches: state.matches,
		argumentQuery: state.argumentQuery,
		commandQuery: state.commandQuery,
		argumentCommand: state.argumentCommand,
		nameThenMessage: state.inline?.nameThenMessage ?? false,
		runs: state.inline?.runs ?? false,
		chosenByHand: state.chosenByHand,
	});
	switch (intent.kind) {
		case "move":
			state.setActive(intent.index);
			return true;
		case "apply": {
			const row = state.matches[intent.index];
			if (!row) return false;
			onPick(row, { run: intent.run });
			return true;
		}
		case "extend":
			/*
			 * The ambiguous Enter. The draft is rewritten to the common prefix and the
			 * list is LEFT OPEN — no pick, no close — which is the whole difference
			 * between this and a completion (`_extend_to_common_prefix`).
			 */
			onExtend(intent.prefix);
			return true;
		case "close":
			// Closes the popup and latches the phase; the draft is untouched.
			state.close();
			return true;
		default:
			return false;
	}
}

/**
 * The buffer and caret that accepting a row produces. Pure, so the popup and
 * the apply path cannot disagree about what a pick writes.
 *
 * Command rows: replace the word token with `/<label> ` — the trailing space is
 * load-bearing, not cosmetic (it terminates the word, closing this list, and for
 * a list-taking command opens the argument phase). Argument rows: replace the
 * ARGUMENT span only, leaving the command word intact; the name-list commands
 * (`/team`, `/agent`) add their own terminating space, which is what closes the
 * list and opens the free-text tail (`editor.py:_complete_name_argument`). The
 * enum-tail commands add NO space, or the matcher would stop matching and Tab
 * would appear to fill the field and abandon it in one keystroke.
 */
export function completionFor(
	draft: string,
	caret: number,
	row: CompletionRow,
	commands: ReadonlySet<string>,
	argumentWords: readonly string[],
	nameThenMessage: boolean,
): { text: string; caret: number } | null {
	if (row.kind === "command") {
		const word = slashContext(draft, caret, commands);
		if (!word) return null;
		return replaceSpan(draft, word.start, word.end, `/${row.label} `);
	}
	const argument = slashArgumentContext(draft, argumentWords, caret, commands);
	if (!argument) return null;
	const suffix = nameThenMessage ? " " : "";
	return {
		text: `${draft.slice(0, argument.start)}${row.row.value}${suffix}${draft.slice(argument.end)}`,
		caret: argument.start + row.row.value.length + suffix.length,
	};
}

/*
 * `extensionFor` lived here and was MOVED to `slash-contract.ts` in review round
 * 1: it is a pure function of the draft, the caret and the word span, which is
 * exactly the contract module's remit, and it is what lets
 * `scripts/slash-contract.test.mjs` bundle and execute the shipped splice rather
 * than trusting it by eye. Find it there.
 */
