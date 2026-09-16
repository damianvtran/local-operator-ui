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
import type { DesktopCommandMetadata } from "../../../../../shared/desktop-control-contract";
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
	activeRowRuns,
	argumentEmptyCopy,
	candidateKey,
	chosenByHandSurvives,
	clickFooter,
	commandChoiceUnambiguous,
	commandLabels,
	enterFooter,
	phaseLabel,
	pickArmsCommand,
	rowId,
	sharedCommandPrefix,
	slashDestructive,
	slashKeyIntent,
	slashRunAllowed,
} from "./slash-contract";
import { firstContentLine } from "./slash-highlight";
import { commandSuggestions, matchChoices } from "./slash-rank";
/*
 * Imported, not redeclared: the planner owns the words and the destination
 * set (`slash-submit.ts`), and its test suite executes them. A component file
 * cannot be bundled by that harness, so a second DEFINITION here would be a
 * second answer to "which words arm by pick" — the drift this change is closing.
 * They are not re-exported either: the planner's own module is the one route to
 * them, and a second public path with no caller is only a place for the next
 * reader to look (review N1).
 */
import {
	type ArgumentShapeRow,
	type ArmingCatalogueRow,
	argumentShapeVocabulary,
	armedOnlyVocabulary,
	wirelessArgumentShapes,
} from "./slash-submit";
import {
	caretPhase,
	replaceSpan,
	slashArgumentContext,
	slashContext,
	slashTokenSpan,
} from "./slash-token";

/**
 * A row of the shared registry, exactly as the desktop control plane reports it.
 *
 * The renderer does not re-declare this shape: it IS the wire row
 * (`src/shared/desktop-control-contract.ts`), so a field the backend starts
 * sending cannot be silently dropped here — the addition lands on the composer
 * as a compile error about a type it already names, which is the cheapest place
 * to notice a new registry fact. `prefixes_text` (below) is the field that
 * arrived this way.
 */
export type SlashCommandMeta = DesktopCommandMetadata;

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
 * The vocabulary the planner treats as "this command consumes its trailing
 * text" — the names whose argument the command OWNS.
 *
 * ONE derivation, from the registry row's `prefixes_text` when the backend
 * carries it, because that is the same fact the messages endpoint's admission
 * test reads (`whole_draft_command` in `slash_commands.py`): `/model gpt-5` is
 * a control on both hosts rather than a control there and a message here. On a
 * backend that predates the field, no row carries it and the renderer falls
 * back to the union it has always derived — `consumes_prompt` (the free-text
 * half, added by the caller) with the inline argument lists below (the value
 * half) — so the wire field is additive in practice, not a version gate.
 *
 * The fallback is PER ROW and not all-or-nothing: a row the backend
 * labelled uses that label, and only a row that carries nothing is read from
 * the renderer's own derivation. An older backend carries no label anywhere,
 * so the whole set is today's derivation and nothing changes; a backend that
 * carries one is answering a question the renderer had been guessing at, and a
 * `false` there is a fact rather than an absence.
 */
function prefixingVocabulary(
	commands: readonly SlashCommandMeta[],
	inlineWords: readonly string[],
): Set<string> {
	const inline = new Set(inlineWords);
	const words = new Set<string>();
	for (const command of commands) {
		const names = [command.name, ...command.aliases].map((name) =>
			name.toLowerCase(),
		);
		const prefixing =
			typeof command.prefixes_text === "boolean"
				? command.prefixes_text
				: names.some((name) => inline.has(name));
		if (!prefixing) continue;
		for (const name of names) words.add(name);
	}
	return words;
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
	/** Words the planner must not hoist and only a PICK may arm. */
	armedOnlyCommands: ReadonlySet<string>;
	/**
	 * Whether text survives the caret's LINE: the draft a pick of an armed row
	 * would HOIST (stage with the surviving text as its argument). Read off the
	 * draft by `useSlashCompletion`, which has the text and the caret.
	 */
	hoists: boolean;
	/**
	 * Whether the word OPENS the draft — nothing but whitespace before the command
	 * token on its line. This is the fact the planner turns on (`opensDraft` in
	 * `slash-submit.ts`) and therefore the fact the popup's staging sentences must
	 * turn on too: a token inside a sentence is completed by the key, never run and
	 * never staged (design D5, UX U3).
	 */
	opensDraft: boolean;
	/**
	 * Whether this pane can address a session — the dispatcher's question, read
	 * from the caller. The arming lines decline to promise a run where it is
	 * false, because that promise is one keystroke ahead of the refusal
	 * (design D3 / UX U1).
	 */
	paneHasSession: boolean;
	/** The `prefixes_text` half, or the inline argument lists on an older
	 *  backend (`prefixingVocabulary`). */
	prefixingCommands: ReadonlySet<string>;
	/** Per-word `argument_shape`/`argument_words`, empty on an older backend. */
	argumentShapes: ReadonlyMap<string, ArgumentShapeRow>;
	/** The same question answered from what an older backend DOES send — the
	 *  wire's `arguments` mode and the inline argument lists
	 *  (`wirelessArgumentShapes`). */
	wirelessShapes: ReadonlyMap<string, ArgumentShapeRow>;
	nameListCommands: ReadonlySet<string>;
	/** The words whose argument phase is live, for the completion span lookup. */
	argumentWords: readonly string[];
	/**
	 * Lower-cased team/agent names the roster list's own query holds, for the
	 * syntax highlight's NAME run (`slash-highlight.ts`).
	 *
	 * The SAME query the list reads (`useEntities`), so a name tinted here is a
	 * name the list would have offered; it is enabled from the draft's leading
	 * command word rather than always, so a composer showing ordinary prose asks
	 * the backend for nothing.
	 */
	nameChoices: ReadonlySet<string>;
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
	/*
	 * Whether this pane can ADDRESS a session, which is the difference between a
	 * query that failed and a query that was never asked (UX round 1 U7).
	 */
	paneHasSession: boolean,
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
		/*
		 * A FAILED query on a pane that cannot address a session is not "try
		 * again": nothing was asked (the request the user saw on screen was never
		 * sent) and a retry cannot succeed until the conversation exists. The
		 * component owns the right sentence for that state and this is what reaches
		 * it (UX round 1 U7 — the retry hint stood over a list the app had not
		 * asked for, and Enter then consumed the draft).
		 */
		if (entities.isError && !paneHasSession) {
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
		paneHasSession,
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
	/**
	 * Whether the pane this composer sits on can address a SESSION — the
	 * dispatcher's own question, passed down from the page that builds it.
	 *
	 * It is not `sessionId` above. That one is the id the entity LISTS query with,
	 * and on a real New-chat pane it holds the PANE's identity while no command can
	 * run there at all; this one is the answer the popup's arming line and the
	 * staged note both have to give (UX U1 / design D3).
	 */
	paneHasSession?: boolean;
};

export function useSlashCompletion({
	inputValue,
	selectionStart,
	sessionId,
	activeProfile,
	paneHasSession = false,
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
	const prefixingCommands = useMemo(
		() => prefixingVocabulary(registry, vocabulary.words),
		[registry, vocabulary],
	);
	/*
	 * The roster snapshot for the highlight's NAME run, and the ONE place the
	 * composer reads a name list.
	 *
	 * `useEntities` is keyed by session and command, so when the roster list is
	 * open after `/team ` this IS the list's own cache entry rather than a second
	 * request; the gate below only decides whether a composer that is not showing
	 * a name-list draft asks for it at all. Reading the names from the same
	 * `argumentRows` shaping the list renders is what keeps "a name the highlight
	 * tinted" and "a name the list offered" the same statement.
	 *
	 * `/team`'s `chart` subcommand is excluded by the BUILDER (it is a reserved
	 * first argument), not here: this is a snapshot of the roster, and the
	 * tokenizer of the rule is the highlight module.
	 */
	const rosterCommand = useMemo((): ArgumentSource | null => {
		const line = firstContentLine(inputValue);
		if (line === null) return null;
		const text = inputValue.slice(line.start, line.end);
		if (!text.startsWith("/")) return null;
		const word = text.slice(1).split(WHITESPACE)[0]?.toLowerCase() ?? "";
		if (!vocabulary.nameList.has(word)) return null;
		const spec = resolveCommand(registry, word);
		const inline = spec ? inlineArgumentFor(spec.destination) : undefined;
		return inline?.nameThenMessage ? inline.source : null;
	}, [inputValue, vocabulary, registry]);
	const rosterEntities = useEntities(
		sessionId ?? "",
		rosterCommand && rosterCommand !== "theme" ? rosterCommand : "agent",
		undefined,
		enabled &&
			Boolean(sessionId) &&
			Boolean(rosterCommand) &&
			rosterCommand !== "theme",
	);
	const nameChoices = useMemo(() => {
		if (!rosterCommand || rosterCommand === "theme") return new Set<string>();
		return new Set(
			argumentRows(
				rosterCommand,
				rosterEntities.data?.entities ?? [],
				undefined,
			).map((row) => row.value.toLowerCase()),
		);
	}, [rosterCommand, rosterEntities.data]);
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
	/*
	 * Derived like the two sets above, and from the registry rather than from a
	 * name written here: the arming vocabulary moves with the catalogue, so a
	 * backend that renamed the command or gave it another alias cannot leave the
	 * planner hoisting a word the pick no longer arms. The derivation itself is
	 * `armedOnlyVocabulary` in `slash-submit.ts`, where the planner that consumes
	 * it lives and where the test harness can execute it.
	 */
	const armedOnlyCommands = useMemo(
		() => armedOnlyVocabulary(registry as ArmingCatalogueRow[]),
		[registry],
	);
	/*
	 * The argument SHAPES, derived the same way and from the same rows. Absent on
	 * an older backend, which is why the planner falls back to the vocabulary sets
	 * above rather than defaulting a missing shape to `any`: a default would make
	 * every older backend's rows accept arbitrary text.
	 */
	const argumentShapes = useMemo(
		() => argumentShapeVocabulary(registry),
		[registry],
	);
	/*
	 * And the fallback the SAME rows imply when the wire publishes no shape: the
	 * released backend (`features.commands: 1`) is that pairing, and answering it
	 * with "no text is ever an argument" stopped `/mcp logout` and `/login openai`
	 * from running at all (QA Q1, measured against `main`). Derived from the same
	 * two facts the popup already has — the wire's `arguments` mode and the inline
	 * argument lists `vocabulary` is built from — so there is still one
	 * vocabulary, not a second list of command names.
	 */
	const wirelessShapes = useMemo(
		() => wirelessArgumentShapes(registry, new Set(vocabulary.words)),
		[registry, vocabulary.words],
	);

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

	/*
	 * Whether a pick of the active row would HOIST this draft: text that survives
	 * the caret's token, so the command moves to the front with that text as its
	 * argument (`planSlashArming`) instead of the pick only completing its word.
	 *
	 * It is a fact about the DRAFT, which is why it is derived here rather than in
	 * the row: a bare `/goal` completes, and the same word inside a sentence is the
	 * case the arming's copy and the keyboard gate both have to see. The span it
	 * removes is the same one the pick's own plan removes (`slashTokenSpan` on the
	 * completed line), trimmed the same way, so the two cannot disagree about
	 * whether there is a draft to keep.
	 */
	const hoists = useMemo(() => {
		const span = slashTokenSpan(inputValue, selectionStart, commandNames);
		if (!span) return false;
		return replaceSpan(inputValue, span.start, span.end, "").text.trim() !== "";
	}, [inputValue, selectionStart, commandNames]);
	/*
	 * And whether that same word OPENS the line it sits on. Read off the token's own
	 * start (`commandContext`), which is the span the key acts on, so a word typed
	 * after a sentence is not "the line's command" for either layer.
	 */
	const opensDraft = useMemo(
		() =>
			commandContext !== null &&
			inputValue.slice(0, commandContext.start).trim() === "",
		[inputValue, commandContext],
	);

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
		paneHasSession,
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
		paneHasSession,
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
		/*
		 * The arming's third input, read off the DRAFT rather than the row: whether
		 * text survives the caret's word, i.e. whether an armed row's pick would
		 * hoist this draft instead of only completing its word. The popup's routing
		 * (`slashKeyIntent`) and its copy (`enterFooter`/`clickFooter`) both read it,
		 * so neither can describe the other's gesture.
		 */
		hoists,
		opensDraft,
		isLoading: enabled && query.isLoading,
		available: enabled,
		commands: registry,
		commandNames,
		promptCommands,
		armedOnlyCommands,
		prefixingCommands,
		argumentShapes,
		wirelessShapes,
		nameListCommands: vocabulary.nameList,
		nameChoices,
		argumentWords: vocabulary.words,
		enabled,
	};
}

type SlashSuggestionsPopupProps = {
	state: SlashCompletionState;
	onPick: (
		row: CompletionRow,
		disposition: { run: boolean; chosenByHand: boolean },
	) => void;
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
	/*
	 * The active row's ROUTE, read ONCE because BOTH lines of copy below are read
	 * from it: whether a pick of this row RUNS it rather than opening a list. A
	 * command row's answer is its DESTINATION's (`pointerPickRuns`, the same rule
	 * `message-input.tsx` acts on), an argument row's is its own list's `runs` —
	 * the two kinds answer from different places on purpose, and reading either
	 * off the row's rendered hint column is exactly the defect U10 measured.
	 *
	 * `activeRowRuns` owns the derivation rather than this component, because the
	 * Enter line took `state.inline?.runs` here instead and the command phase
	 * structurally cannot produce it — so the free-text row's line was
	 * unreachable in every state the popup can be in, and the app printed the
	 * fallback while the copy table said otherwise (review F2 / QA Q3-1).
	 */
	const pickRuns = activeRowRuns({
		destination:
			activeRow?.kind === "command" ? activeRow.command.destination : undefined,
		entry:
			activeRow?.kind === "command"
				? DESTINATIONS[activeRow.command.destination]
				: undefined,
		inlineRuns: state.inline?.runs ?? false,
	});
	const footer = enterFooter({
		phase: argument ? "argument" : "command",
		command: state.argumentCommand,
		label: activeCommand?.label ?? "",
		nameThenMessage: state.inline?.nameThenMessage ?? false,
		runs: pickRuns,
		/*
		 * Whether this row's completion OPENS a list, asked of the registry table the
		 * composer itself reads (`inlineArgumentFor`) rather than of a second list of
		 * command names. It separates the two `runs: false` command states the copy
		 * has to word differently (UX round 1, U4): `/model` completes and opens its
		 * list, `/clear` completes and is run by the NEXT Enter.
		 */
		opensList: Boolean(
			activeCommand && inlineArgumentFor(activeCommand.command.destination),
		),
		value: activeArgument?.value ?? "",
		matched: Boolean(activeRow),
		/*
		 * The arming's own two inputs, read off the row's ROUTE (`pickArmsCommand`)
		 * and off the draft (`state.hoists`) rather than written as a command name:
		 * this line described "Enter completes the command." for the one row whose
		 * Enter hoists and stages, and it stayed green because the test that pinned
		 * it never asked the pick what it does (review F2 / QA Q5).
		 */
		arms:
			activeRow?.kind === "command"
				? pickArmsCommand(
						activeRow,
						state.armedOnlyCommands,
						state.chosenByHand,
					)
				: false,
		// The row's own `consumes_prompt`: the free-text rows reassemble on a pick
		// instead of running, which is what their two lines have to say (UX U2/U3).
		takesDraft:
			activeRow?.kind === "command" ? activeRow.command.consumes_prompt : false,
		// The armed row's destination, so the promise this line makes about the
		// next Enter is the note's own sentence rather than a second one (design D4).
		destination:
			activeRow?.kind === "command" ? activeRow.command.destination : undefined,
		paneHasSession: state.paneHasSession,
		hoists: state.hoists,
		opening: state.opensDraft,
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
		// A click on an armed row STAGES; `pointerPickRuns` still answers `true` for
		// the goal destination, so this line cannot promise a run on the row whose
		// pick hoists the draft (UX U2 / design D1).
		arms:
			activeRow?.kind === "command"
				? pickArmsCommand(
						activeRow,
						state.armedOnlyCommands,
						state.chosenByHand,
					)
				: false,
		takesDraft:
			activeRow?.kind === "command" ? activeRow.command.consumes_prompt : false,
		hoists: state.hoists,
		opening: state.opensDraft,
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
									onPick(row, { run: true, chosenByHand: true });
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
	onPick: (
		row: CompletionRow,
		disposition: { run: boolean; chosenByHand: boolean },
	) => void,
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
			/*
			 * A key that MOVED the marker is the choice; one that clamped back onto
			 * the row it was already on is not. Latching the gate on the second kind
			 * armed the goal row after an Up on the first row — the marker had not
			 * moved, nothing on screen had changed, and Enter then hoisted and staged
			 * the sentence (review F2). Moving without latching is what the pointer's
			 * own hover does, so the no-op takes that route.
			 */
			if (intent.moved) state.setActive(intent.index);
			else state.setActiveHover(intent.index);
			return true;
		case "apply": {
			const row = state.matches[intent.index];
			if (!row) return false;
			onPick(row, { run: intent.run, chosenByHand: intent.chosenByHand });
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
 * The write a PICK performs on the draft lives in `slash-completion.ts`.
 *
 * It moved there so the pick's write and the arming plan can be exercised
 * together by the node harness — `completionFor`'s output IS the input
 * `planSlashArming` reads, and the multi-line draft whose staged line did not run
 * (review F1 / QA Q4) was invisible to a suite that hand-built the string the
 * pick writes (review F7). A component file cannot be bundled there: it imports
 * React, the desktop hooks and the whole picker registry.
 *
 * `extensionFor` lived here and was MOVED to `slash-contract.ts` in round 1: it
 * is a pure function of the draft, the caret and the word span, which is exactly
 * the contract module's remit, and it is what lets
 * `scripts/slash-contract.test.mjs` bundle and execute the shipped splice rather
 * than trusting it by eye. Find it there.
 */
