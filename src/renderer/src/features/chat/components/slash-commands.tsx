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

import { retryDesktopQuery } from "@shared/api/local-operator/backend-error";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import type { DesktopProvider } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	desktopKeys,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import {
	fetchMcpCatalog,
	mcpCatalogKeys,
	mcpTransportCwd,
	mcpTransportSession,
} from "@shared/api/local-operator/mcp-catalog";
import type {
	ReusableProfile,
	ReusableTeam,
} from "@shared/api/local-operator/profile-hooks";
import { useOptionalQueryClient } from "@shared/hooks/use-optional-query-client";
import { cn } from "@shared/lib/utils";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
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
import type { CanonicalModel } from "../../../../../shared/desktop-session-contract";
import { archiveDestinationApplies } from "../chat-archived";
import {
	type StoredAccount,
	useEntities,
} from "../pickers/destination-pickers";
import { connectProviderForSelector } from "../pickers/model-catalogue-listing";
import {
	DESTINATIONS,
	type InlineArgumentSource,
	destinationNeedsSession,
	inlineArgumentFor,
} from "../pickers/picker-registry";
import {
	type FastModeState,
	fastModeState,
} from "../session-status/session-model";
import {
	type ArgumentActionRow,
	type ArgumentRow,
	type ArgumentSource,
	FLAG_LIST_SOURCES,
	MCP_EMPTY_SLOT_COPY,
	argumentRows,
	effectiveInlineArgument,
	flagTokenDraws,
	flagTokenSelects,
	isRendererLocalSource,
	isSessionlessBackendSource,
	mcpInServerSlot,
	modelDefaultActionRow,
	shouldRunArgumentAction,
	showsUnmatchedList,
} from "./slash-argument-rows";
import {
	type PickDestination,
	activeRowRuns,
	argumentEmptyCopy,
	candidateKey,
	chosenByHandSurvives,
	clickFooter,
	commandChoiceUnambiguous,
	commandLabels,
	commandRowSlot,
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
import {
	type ArgumentShapeRow,
	type ArmingCatalogueRow,
	argumentShapeVocabulary,
	armedOnlyVocabulary,
	prefixingVocabulary,
} from "./slash-submit";
import {
	SEPARATOR,
	SEPARATOR_RUN,
	caretPhase,
	pyTrim,
	replaceSpan,
	slashArgumentContext,
	slashContext,
	slashTokenSpan,
} from "./slash-token";

/*
 * Imported, not redeclared: the planner owns the words and the destination
 * set (`slash-submit.ts`), and its test suite executes them. A component file
 * cannot be bundled by that harness, so a second DEFINITION here would be a
 * second answer to "which words arm by pick" — the drift this change is closing.
 * They are not re-exported either: the planner's own module is the one route to
 * them, and a second public path with no caller is only a place for the next
 * reader to look (review N1).
 */

export type SlashCommandMeta = {
	name: string;
	description: string;
	aliases: string[];
	arguments: "none" | "optional" | "required";
	echo: boolean;
	consumes_prompt: boolean;
	/*
	 * The endpoint's own admission vocabulary, optional and additive — see the
	 * contract's `DesktopCommandMetadata`, which is where the wire declares them.
	 * Read here rather than only there because this is the row type the catalogue
	 * query is read as, so the fields have to survive the fetch to reach the
	 * planner that answers with them.
	 */
	prefixes_text?: boolean;
	argument_shape?: "none" | "word" | "provider" | "subcommand" | "any";
	argument_words?: string[];
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

/*
 * NO CLASS OF ITS OWN: every separator question in this file reads the one
 * `slash-token.ts` spells out — Python's set, which is what the TUI's
 * `ch.isspace()` is and what the endpoint splits on. A second class here was the
 * fifth instance of the same bug (round 4, F4-1): the popup asked the word of
 * `/team<U+0085>ops review` as `team<U+0085>ops` while the planner asked `team`,
 * so which row completed and which command ran came from two rules. The
 * top-level-hoisting reason the old constant carried is now `slash-token.ts`'s.
 */

/** One row of the listbox. Both phases share one geometry and one
 *  `aria-activedescendant` contract, so they also share one row shape. */
export type CompletionRow =
	/**
	 * A command-word row. `label` is the NAME OR ALIAS that matched — the string
	 * the row shows and the string the completion writes, so the highlight
	 * cannot describe something Enter will not do.
	 */
	| {
			kind: "command";
			command: SlashCommandMeta;
			label: string;
			/**
			 * The live state a command's right-edge slot shows, or `null`/absent for
			 * no slot: `/fast`'s `on`/`off`, attached by the hook from the spec in
			 * force. Every other row leaves it off, and `commandRowSlot`
			 * (`slash-contract.ts`) is the one reader.
			 */
			fastState?: FastModeState;
	  }
	| { kind: "argument"; row: ArgumentRow }
	| { kind: "action"; row: ArgumentActionRow };

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
 *
 * It reads the RAW table, without the capability resolution the hook applies to
 * every list it opens: the vocabulary's jobs are completion spans and the
 * planner's word set, and whether a list actually opens is decided downstream
 * (`useSlashCompletion`'s effective inline). Filtering here would need the
 * capability answer a module function cannot hold, for a difference no surface
 * can see — a word this names on a backend that lacks the list simply opens
 * nothing, exactly as it did before the row existed.
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
	/**
	 * A more specific empty state than `argumentEmptyCopy`'s generic sentences,
	 * when the source can name the fact: the `/mcp` server slot with nothing
	 * eligible (empty BY DESIGN, not unreported — U2), or a `/logout` query
	 * naming a provider with no stored credential (U4). Set from the query or
	 * the slot, read only in the empty state; it wins over both generic lines.
	 */
	emptyCopy?: string;
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
	 *  "completing its word opens a list".
	 *
	 *  It is the EFFECTIVE disposition: `effectiveInlineArgument` has already
	 *  dropped a list the backend does not license, so every reader — the two
	 *  footers and the pick gate, here and in `message-input.tsx` — reads one
	 *  answer for a feature-absent backend. */
	inline: InlineArgumentSource | undefined;
	/**
	 * The destination entry a pick of the ACTIVE command row routes through —
	 * `DESTINATIONS` with the same capability resolution applied to its inline
	 * list, so `pointerPickRuns` cannot flip a command row to completes-only on
	 * a backend that never had the list. Returned for every kind of
	 * destination; only picker entries carry an inline at all.
	 */
	effectiveEntry(destination: string | undefined): PickDestination | undefined;
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
	 * Whether this pane can address a session — the dispatcher's question, read
	 * from the caller. The arming lines decline to promise a run where it is
	 * false, because that promise is one keystroke ahead of the refusal
	 * (design D3 / UX U1).
	 */
	paneHasSession: boolean;
	/**
	 * The inline-argument half of the planner's `takesArgument` vocabulary:
	 * names (primaries and aliases) of commands whose destination carries an
	 * argument list (`argumentVocabulary` above). Set rather than the array the
	 * completion spans use, because the planner asks it a membership question per
	 * keystroke and a scan of the array would be a second copy of the same set.
	 */
	valueArgumentCommands: ReadonlySet<string>;
	/**
	 * The declaration half of the planner's argument vocabulary: names (primaries
	 * and aliases) whose registry entry says `arguments` is `optional` or
	 * `required`, read off the same `SlashCommandMeta` the planner is handed.
	 *
	 * It exists because the other two sets are narrower than the field they were
	 * standing in for: `/stop`, `/fast` and `/move` declare an argument and carry
	 * neither a prompt nor a list, and `/login`/`/logout` carry their lists only
	 * while the backend licenses them (`provider_catalogue`) — so a union of the
	 * other two read those whole-draft forms as prose (review round 1, R1).
	 */
	argumentCommands: ReadonlySet<string>;
	/**
	 * The wire's own `argument_shape` / `argument_words`, keyed by primary and
	 * alias, and the `prefixes_text` half of the same publication.
	 *
	 * THE AUTHORITY THE THREE SETS ABOVE APPROXIMATE. They are derived from the same
	 * catalogue rows the popup renders, so a row can neither be in the registry and
	 * missing here nor the reverse. A row that publishes no shape is absent from the
	 * map on purpose — that is a backend older than the field, and
	 * `argumentShapeVocabulary` states why a default would be worse than the
	 * fallback it would replace.
	 */
	argumentShapes: ReadonlyMap<string, ArgumentShapeRow>;
	prefixingCommands: ReadonlySet<string>;
	nameListCommands: ReadonlySet<string>;
	/**
	 * Lower-cased roster names the list's own query holds, for the syntax
	 * highlight's NAME run (`slash-highlight.ts`).
	 *
	 * The SAME query the argument list reads (`useEntities`), so a name tinted
	 * here is a name the list would have offered; it is enabled from the draft's
	 * leading command word rather than always, so a composer showing ordinary
	 * prose asks the backend for nothing.
	 */
	nameChoices: ReadonlySet<string>;
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
 * session-status strip's effort chip already follows). The renderer-local
 * sources (`RENDERER_LOCAL_SOURCES`) ask the backend for nothing: `/theme` reads
 * the same `@shared/themes` table its dialog reads, and `title-refresh` is a
 * fixed spelling list. Both are answered from a local read and reported as
 * loaded, because "nothing to ask" must not render as "not reported yet".
 *
 * The SESSIONLESS sources (`SESSIONLESS_BACKEND_SOURCES`) fetch the three
 * sessionless routes — the LoginPicker's and LogoutPicker's own reads, and the
 * MCP catalog Settings > Integrations owns — under the SAME query keys, so an
 * existing invalidation (a sign-in, a removed account, an MCP control) reaches
 * the composer's list and one cache entry serves both surfaces.
 * `needsSession: false` on all three: none of these routes is scoped to a
 * conversation, which is the point of the category — a draft pane can answer
 * them without a session to ask.
 *
 * The three queries are declared UNCONDITIONALLY (hooks cannot be called
 * conditionally) and merely DISABLED while their source is not the active one.
 * They do not re-ask the capability question: a backend that does not advertise
 * the source's feature never resolves `source` at all (`effectiveInlineArgument`
 * upstream), and a second gate here would be a second answer.
 */
function useArgumentRows(
	source: ArgumentSource | undefined,
	sessionId: string | undefined,
	/*
	 * The pane's working directory and the typed argument text — the two inputs
	 * the sessionless sources add. `cwd` keys the MCP catalog read (its key is
	 * `(cwd, sessionId)` exactly as the controls' `setQueryData` writes it), and
	 * the argument text is what the `mcp` slot split reads (`/mcp ` offers the
	 * verbs, `/mcp login ` their servers).
	 */
	cwd: string | undefined,
	argument: string,
	activeTeam: unknown,
	activeAgent: unknown,
	enabled: boolean,
): SlashArgumentListState {
	const themeName = useUiPreferencesStore((state) => state.themeName);
	const { client, provided } = useOptionalQueryClient();
	// Hooks cannot be called conditionally, so the entity query always runs and
	// is merely DISABLED for a renderer-local or sessionless source — the entity
	// route is session-bound, and a sessionless id reaching it would ask the
	// wrong route for a list it does not serve.
	const local = isRendererLocalSource(source);
	const sessionless = isSessionlessBackendSource(source);
	const entitySource = source && !local && !sessionless ? source : "model";
	const entities = useEntities(
		sessionId ?? "",
		entitySource,
		undefined,
		enabled && Boolean(source) && !local && !sessionless && Boolean(sessionId),
	);
	/*
	 * THE DRAFT PANE'S ROSTER READS (issue #780). On a pane with no session the
	 * team/agent sources answer from the sessionless roster routes — the same
	 * reads the sidebar and the Agents page make, under the SAME keys, so one
	 * cache entry serves every surface and an authoring revision invalidates
	 * them together — and a pick STAGES the draft's identity instead of
	 * addressing a session the pane does not have (`message-input.tsx`'s pick
	 * path; `slash-dispatch.ts`'s `!sessionId` branch). Keyed to the two sources
	 * rather than to a second list of command names: the source IS the list.
	 *
	 * RESTATED, rather than reached through `useTeams`/`useProfiles`, because the
	 * hooks mount a plain `useQuery` and take no client — this composer is
	 * reachable in documents without a `QueryClientProvider` (the mini view),
	 * where the fallback client must not fetch and the call has to pass the one
	 * from `useOptionalQueryClient` instead. Their key, queryFn, `staleTime` and
	 * `retry` are copied in the hooks' own spelling so the two share one cache
	 * entry and cannot drift apart (review round 1, n3); the authoring-revision
	 * refresh rides the sidebar's mounts of the hooks on every chat page.
	 */
	const draftRosterSource =
		!sessionId && (source === "team" || source === "agent")
			? source
			: undefined;
	const draftTeams = useQuery(
		{
			queryKey: ["desktop", "teams"],
			queryFn: () =>
				desktopResult<{ teams: ReusableTeam[] }>({ op: "teams.list" }).then(
					(result) => result.teams,
				),
			enabled: enabled && provided && draftRosterSource === "team",
			staleTime: 10_000,
			retry: retryDesktopQuery,
		},
		client,
	);
	const draftProfiles = useQuery(
		{
			queryKey: ["desktop", "profiles"],
			queryFn: () =>
				desktopResult<{ profiles: ReusableProfile[] }>({
					op: "profiles.list",
				}).then((result) => result.profiles),
			enabled: enabled && provided && draftRosterSource === "agent",
			staleTime: 10_000,
			retry: retryDesktopQuery,
		},
		client,
	);
	/*
	 * The LoginPicker's own read, restated rather than reached through
	 * `useDesktopProviders` because that hook mounts a plain `useQuery`: this
	 * composer is reachable in documents without a `QueryClientProvider` (the
	 * mini view), where the fallback client must not fetch
	 * (`useOptionalQueryClient`). Same key, same fetch, same options, so one
	 * cache entry serves both surfaces. Enabled for `/logout` (`provider-accounts`)
	 * as well since round 1 (U4/D5): that list joins the census for the brand it
	 * names a provider by and the aliases it finds one with — the accounts route
	 * carries neither, and a second name for one provider is a second answer.
	 */
	const providers = useQuery(
		{
			queryKey: desktopKeys.providers,
			queryFn: () =>
				desktopResult<{ providers: DesktopProvider[] }>({
					op: "providers.list",
				}).then((result) => result.providers ?? []),
			enabled:
				enabled &&
				provided &&
				(source === "providers" || source === "provider-accounts"),
			staleTime: 30_000,
			retry: retryDesktopQuery,
		},
		client,
	);
	/* The LogoutPicker's query, same key and same shape, under the fallback client. */
	const accounts = useQuery(
		{
			queryKey: desktopKeys.accounts,
			queryFn: () =>
				desktopResult<{ accounts: StoredAccount[] }>({
					op: "accounts.list",
				}).then((result) => result.accounts ?? []),
			enabled: enabled && provided && source === "provider-accounts",
		},
		client,
	);
	/*
	 * The sessionless catalog read, under the integrations page's own key and
	 * fetch — `(cwd, sessionId)` is what makes the overlay answer a live status
	 * where one exists and degrade silently where one does not. Same freshness
	 * window as that page's read; no polling, because a composer list is not a
	 * status surface.
	 *
	 * THE TWO VALUES ARE COERCED FIRST (round 1, QA Q-1): the pane's `cwd` is a
	 * display token ("~") and a draft pane's session is a synthetic key
	 * ("draft:<uuid>"), and the op schema refuses both BEFORE the wire — the
	 * live app's read 422'd and `/mcp` drew an empty list while every
	 * fixture-staged run passed. Coerced ONCE here so the query key and the
	 * payload are the same two values, and so the key cannot hold a cache entry
	 * for a document that can never be fetched beside the one Settings reads for
	 * the same home.
	 */
	const mcpWireCwd = mcpTransportCwd(cwd);
	const mcpWireSession = mcpTransportSession(sessionId);
	const mcp = useQuery(
		{
			queryKey: mcpCatalogKeys.catalog(mcpWireCwd, mcpWireSession),
			queryFn: () => fetchMcpCatalog(mcpWireCwd, mcpWireSession),
			enabled: enabled && provided && source === "mcp",
			staleTime: 10_000,
		},
		client,
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
		if (source === "title-refresh") {
			/*
			 * No entities and no `current`: this source's rows are a fixed vocabulary
			 * (`TITLE_REFRESH_ROWS`), so there is nothing to load and nothing that
			 * could be selected. `loading: false` is load-bearing — the empty state
			 * prints "Loading…" ahead of every other cause, so a list that is not
			 * waiting on anything must not say it is.
			 */
			return {
				rows: argumentRows("title-refresh", [], null),
				loading: false,
				error: null,
				needsSession: false,
			};
		}
		if (source === "providers") {
			return {
				rows: argumentRows("providers", providers.data ?? [], null),
				loading: providers.isLoading,
				error: providers.isError
					? "The list could not be loaded. Try again."
					: null,
				needsSession: false,
			};
		}
		if (source === "provider-accounts") {
			const rows = argumentRows(
				"provider-accounts",
				accounts.data ?? [],
				null,
				{
					providers: providers.data,
				},
			);
			/*
			 * U4's second half: `/logout deepseek` said "No matches. Enter runs the
			 * command." for a provider the CENSUS knows and the accounts route cannot
			 * answer, because an env key is not a store row. The honest sentence is a
			 * fact about this provider, not about the matcher: let the census say
			 * whether the typed word names one of its rows with nothing stored.
			 * `matchChoices` is the same matcher the LIST itself uses, so "names"
			 * means what it means everywhere else — subsequence and aliases included.
			 *
			 * The copy is set from the QUERY alone — `rows` here is the whole
			 * filtered-ready list, and whether the query leaves any MATCH is the
			 * popup's answer, not this branch's: the sentence replaces "No matches"
			 * in the states where that sentence would be shown, and is invisible in
			 * every state where a row is drawn.
			 */
			let emptyCopy: string | undefined;
			if (argument.trim() && providers.data) {
				/*
				 * Match on the SHAPED rows (brand names and aliases, exactly what
				 * `/login` matches on) and carry the count beside them: the shaped row
				 * is an `ArgumentRow`, which deliberately has no count field.
				 */
				const storedById = new Map(
					providers.data.map((row) => [row.id, row.stored_credentials ?? 0]),
				);
				const named = matchChoices(
					argument,
					argumentRows("providers", providers.data, null),
				)[0]?.choice.value;
				if (named && (storedById.get(named) ?? 0) <= 0) {
					emptyCopy = "No stored credential to remove.";
				}
			}
			return {
				rows,
				emptyCopy,
				/*
				 * Both reads are this list's data: the accounts route answers its rows,
				 * and the census join answers the names, aliases and the "nothing
				 * stored" fact the empty state uses — so the honest "Loading…" covers
				 * whichever of the two is still in flight, not just the first.
				 */
				loading: accounts.isLoading || providers.isLoading,
				error: accounts.isError
					? "The list could not be loaded. Try again."
					: null,
				needsSession: false,
			};
		}
		if (source === "mcp") {
			const rows = argumentRows("mcp", mcp.data?.servers ?? [], null, {
				argument,
				verbs: mcp.data?.verbs,
			});
			return {
				rows,
				/*
				 * U2: the SERVER slot with nothing eligible is empty by design — `list`
				 * and `add` offer no server at all, an unknown verb names no list, and a
				 * verb whose filter matches nothing has simply nothing eligible. The
				 * generic "Not reported yet" claimed the route never answered; this says
				 * what is actually true and keeps the route sentence.
				 */
				emptyCopy:
					rows.length === 0 && mcpInServerSlot(argument)
						? MCP_EMPTY_SLOT_COPY
						: undefined,
				loading: mcp.isLoading,
				error: mcp.isError ? "The list could not be loaded. Try again." : null,
				needsSession: false,
			};
		}
		if (draftRosterSource) {
			/*
			 * THE DRAFT ROSTER (issue #780): the sessionless read answers this
			 * list, and it is explicitly NOT a needs-session state — a pick here
			 * is honourable (it stages the draft's identity), which is the whole
			 * point of the route.
			 *
			 * U2's rule for the EMPTY state (design round 1, D2; review round 3,
			 * F1): a loaded roster with NO rows is a fact about the workspace, and
			 * "No teams are registered." is the sentence the dialog's own
			 * `emptyText` uses for it — while the generic "Not reported yet"
			 * claimed the route never answered. The copy is GUARDED on the roster
			 * being empty because `argumentEmptyCopy` reads `emptyCopy` AHEAD of
			 * its matcher arm: set unconditionally, it would answer a query that
			 * merely matched nothing (`/team zz` against a workspace that HAS
			 * teams) with the false "No teams are registered." — the very class
			 * the U2/U4 copy fixes exist to remove. `rows` is the WHOLE roster
			 * (`argumentRows` maps `list.data` 1:1 here; the query filter is
			 * applied later in `argumentMatches`), which is what makes the
			 * emptiness test the honest one — the `/mcp` arm's own guard.
			 */
			const list = draftRosterSource === "team" ? draftTeams : draftProfiles;
			const rows = argumentRows(draftRosterSource, list.data ?? [], current);
			return {
				rows,
				emptyCopy:
					rows.length === 0
						? draftRosterSource === "team"
							? "No teams are registered."
							: "No profiles found."
						: undefined,
				loading: list.isLoading,
				error: list.isError ? "The list could not be loaded. Try again." : null,
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
		providers.data,
		providers.isLoading,
		providers.isError,
		accounts.data,
		accounts.isLoading,
		accounts.isError,
		mcp.data,
		mcp.isLoading,
		mcp.isError,
		argument,
		current,
		sessionId,
		draftRosterSource,
		draftTeams,
		draftProfiles,
	]);
}

export type SlashCompletionArgs = {
	inputValue: string;
	selectionStart: number;
	/** The live canonical session id, or undefined for a draft. */
	sessionId?: string;
	/*
	 * The pane's working directory, passed through to the sessionless MCP
	 * catalog read — its query key is `(cwd, sessionId)` and the document it
	 * answers depends on both (`mcp-catalog.ts`). Absent on a pane with none.
	 */
	cwd?: string;
	/** The session's active profile, for the roster lists' current marker. */
	activeProfile?: { team?: unknown; agent?: unknown };
	/** The active session model, used only to describe `/model default`. */
	activeModel?: { provider?: unknown; model_id?: unknown } | null;
	/**
	 * The spec in force for this session (`effective_model ?? selected_model`
	 * from the canonical snapshot) — which is where a command row's live state
	 * comes from: `/fast`'s right-edge slot mirrors the dial the command would
	 * flip. The chip's own path additionally considers a PENDING selection
	 * (`session-model.ts` `bandReadings`), so inside an unconfirmed switch the
	 * two describe different specs — each truthful — and outside it they read
	 * the same fields. Deliberately NOT `activeModel` above: that one is
	 * NARROWED to provider/model_id at the call site (it feeds the `/model
	 * default` action row), and the fast flags would vanish with the narrowing.
	 */
	activeSpec?: CanonicalModel | null;
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
	cwd,
	activeProfile,
	activeModel,
	activeSpec,
	paneHasSession = false,
}: SlashCompletionArgs): SlashCompletionState {
	const capabilities = useDesktopCapabilities();
	const enabled = desktopFeatureEnabled(capabilities.data, "commands");
	/*
	 * Whether this backend can archive at all, and what THIS conversation's archive
	 * state is - the two inputs `archiveDestinationApplies` needs when the command
	 * rows are built below.
	 *
	 * Read here rather than passed in as a flag because the two rows it filters are
	 * the palette's own: the composer knows the draft, the store knows the
	 * conversation, and this hook already reaches for the capability for `enabled`.
	 * `undefined` (no row for this id) is a real answer and means UNKNOWN - see the
	 * rule for why `/archive` survives it and `/unarchive` does not.
	 */
	const archiveEnabled = desktopFeatureEnabled(
		capabilities.data,
		"session_archive",
	);
	const openArchived = useCanonicalSessionsStore((state) =>
		sessionId
			? (state.archiveFacts[sessionId]?.archived ??
				state.sessions.find((row) => row.session_id === sessionId)?.archived)
			: undefined,
	);
	const listId = useId();
	const { client, provided } = useOptionalQueryClient();
	const query = useQuery(
		{
			queryKey: desktopKeys.commands,
			queryFn: () =>
				desktopResult<{ commands: SlashCommandMeta[] }>({
					op: "commands.list",
				}).then((result) => result.commands),
			/*
			 * `provided &&`: this hook is reached by the shared composer in documents
			 * that mount no `QueryClientProvider` (the mini view), where the fallback
			 * client must not fetch (see `useOptionalQueryClient`). `enabled` already
			 * folds the capability; the provider is the second half of "can this
			 * surface ask at all", and the empty registry either way leaves the popup
			 * rendering nothing.
			 */
			enabled: enabled && provided,
			staleTime: 300_000,
		},
		client,
	);

	const registry = useMemo(() => query.data ?? [], [query.data]);
	const vocabulary = useMemo(() => argumentVocabulary(registry), [registry]);
	/*
	 * `argumentWords` lives in completion state because the ARGUMENT spans need a
	 * list; the planner needs membership in it, and building the Set here rather
	 * than per keystroke keeps one derivation of "which commands take a value"
	 * (`argumentVocabulary`) with two shapes for two consumers.
	 */
	const valueArgumentCommands = useMemo(
		() => new Set(vocabulary.words),
		[vocabulary],
	);
	/*
	 * The registry's own declaration, which is the only vocabulary `/login` and
	 * its peers appear in: `arguments !== "none"`. Derived from the same
	 * `SlashCommandMeta` list the completion rows render, so a new registry entry
	 * cannot be in one and not the other.
	 */
	const argumentCommands = useMemo(() => {
		const names = new Set<string>();
		for (const command of registry) {
			if (command.arguments === "none") continue;
			names.add(command.name.toLowerCase());
			for (const alias of command.aliases) names.add(alias.toLowerCase());
		}
		return names;
	}, [registry]);
	/*
	 * The wire's own vocabulary, read off the SAME rows — and deliberately an
	 * ADDITION beside the three derivations above rather than a replacement for
	 * them: the planner needs the fallback for a backend that predates these
	 * fields, so both are carried and the planner states which one is the
	 * authority.
	 */
	const argumentShapes = useMemo(
		() => argumentShapeVocabulary(registry),
		[registry],
	);
	const prefixingCommands = useMemo(
		() => prefixingVocabulary(registry),
		[registry],
	);
	const commandNames = useMemo(() => {
		const names = new Set<string>();
		for (const command of registry) {
			names.add(command.name.toLowerCase());
			for (const alias of command.aliases) names.add(alias.toLowerCase());
		}
		return names;
	}, [registry]);
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
	 * The command word is read off the draft's FIRST CONTENT LINE rather than
	 * through the caret-anchored `slashArgumentContext`: the highlight keeps
	 * painting the name after the caret has moved on into the instruction set,
	 * and a caret-anchored derivation would stop answering the moment it did.
	 * `/team`'s `chart` subcommand is excluded by the BUILDER (it is a reserved
	 * first argument), not here: this is a snapshot of the roster, and the rule
	 * that reads it is `slash-highlight.ts`.
	 */
	const rosterCommand = useMemo((): ArgumentSource | null => {
		const line = firstContentLine(inputValue);
		if (line === null) return null;
		const text = inputValue.slice(line.start, line.end);
		if (!text.startsWith("/")) return null;
		const word = text.slice(1).split(SEPARATOR_RUN)[0]?.toLowerCase() ?? "";
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
		/*
		 * A LITERAL SPACE, deliberately: this is the TUI's own `partition(" ")` on the
		 * inline argument — the same partition `slash-token.ts`'s argument context
		 * draws — and it answers "the argument's first word", not the separator the
		 * command's own tokens are cut on.
		 */
		return line.split(" ")[0]?.toLowerCase() ?? null;
	}, [argumentContext, inputValue]);

	const inline = useMemo(() => {
		if (!argumentWord) return undefined;
		const spec = resolveCommand(registry, argumentWord);
		return spec ? inlineArgumentFor(spec.destination) : undefined;
	}, [argumentWord, registry]);

	/*
	 * THE EFFECTIVE INLINE — the one resolution every reader below, and the pick
	 * gate in `message-input.tsx` through this hook's returned state, shares:
	 * the declaration above, minus a list the backend does not license
	 * (`effectiveInlineArgument`). A feature-absent backend therefore cannot
	 * have the fetch ask for rows, a footer promise a list, or the gate run a
	 * pick whose list does not exist — all four read this one answer.
	 */
	const effectiveInline = useMemo(
		() => effectiveInlineArgument(inline, capabilities.data),
		[inline, capabilities.data],
	);
	/*
	 * The same resolution for a COMMAND row's destination: the entry a pick
	 * routes through, with its inline list dropped when unlicensed — which is
	 * what keeps `/login`'s pick running its picker on a backend without
	 * `provider_catalogue`, exactly as it does today.
	 */
	const effectiveEntry = useCallback(
		(destination: string | undefined) => {
			const entry = destination ? DESTINATIONS[destination] : undefined;
			if (!entry || entry.kind !== "picker") return entry;
			const resolved = effectiveInlineArgument(entry.inline, capabilities.data);
			return resolved === entry.inline ? entry : { ...entry, inline: resolved };
		},
		[capabilities.data],
	);

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
		return (
			pyTrim(replaceSpan(inputValue, span.start, span.end, "").text) !== ""
		);
	}, [inputValue, selectionStart, commandNames]);

	const commandMatches = useMemo(() => {
		if (!commandContext) return [];
		/*
		 * A bare `/` shows the WHOLE command list in registry order; a short query
		 * keeps only its prefix matches when it has any. Both rules live in
		 * `commandSuggestions` (the TUI's `command_suggestions`), so the picker and
		 * the matcher cannot answer `/` or `/m` differently (round 1 R3).
		 */
		const ranked = commandSuggestions(commandContext.query, registry);
		/*
		 * THE ARCHIVE PAIR IS FILTERED ON THE OPEN CONVERSATION'S OWN STATE, and this
		 * is the only place a catalogue row is filtered at all. The catalogue is
		 * STATIC - the backend advertises `/archive` and `/unarchive` for every
		 * conversation because it does not know which one this pane has open - so
		 * offering both would show a pair of opposites for one state, one of which
		 * does nothing. `archiveDestinationApplies` is the one rule (state plus
		 * capability); a typed word the filter hides still reaches the dispatcher and
		 * is refused WITH A REASON there, which is why this filter is a preference
		 * about what to offer rather than the enforcement point.
		 */
		const fastState = fastModeState(activeSpec);
		return ranked
			.filter(({ command }) =>
				archiveDestinationApplies(
					command.destination,
					openArchived,
					archiveEnabled,
				),
			)
			.map(
				({ name, command }) =>
					({
						kind: "command",
						command,
						label: name,
						/*
						 * Only the dial row carries a right-edge state; every other command
						 * row keeps `fastState` off and `commandRowSlot` paints no slot for it
						 * (the operator's `value?` class fix).
						 */
						fastState:
							command.destination === "session.fast" ? fastState : undefined,
					}) as CompletionRow,
			);
	}, [commandContext, registry, openArchived, archiveEnabled, activeSpec]);

	const argumentList = useArgumentRows(
		effectiveInline?.source,
		sessionId,
		cwd,
		argumentContext?.value ?? "",
		activeProfile?.team,
		activeProfile?.agent,
		enabled,
	);

	const argumentMatches = useMemo(() => {
		if (!effectiveInline || !argumentContext) return [];
		/*
		 * `default` is a direct machine-setting operation, not a model catalogue
		 * entry. It replaces the catalogue matches so fuzzy survivors can never
		 * take index zero and switch the model when the user intended the action.
		 */
		if (effectiveInline.source === "model") {
			const action = modelDefaultActionRow(
				argumentContext.value,
				activeModel,
				argumentContext.value === "default" &&
					argumentContext.end === inputValue.length,
				paneHasSession,
			);
			if (action) return [{ kind: "action" as const, row: action }];
		}
		return matchChoices(argumentContext.value, argumentList.rows).map(
			({ choice }) => ({ kind: "argument" as const, row: choice }),
		);
	}, [
		effectiveInline,
		argumentContext,
		argumentList.rows,
		activeModel,
		inputValue,
		paneHasSession,
	]);

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
		effectiveInline?.nameThenMessage === true &&
		argumentContext !== null &&
		SEPARATOR.test(argumentContext.value);
	const phase: SlashCompletionState["phase"] =
		purePhase === "argument"
			? effectiveInline && !nameComplete
				? "argument"
				: null
			: purePhase === "command" && commandMatches.length > 0
				? "command"
				: null;

	/*
	 * A FLAG list draws on its OWN shape rule, not on the matcher's reach.
	 *
	 * `purePhase === "argument"` is true the moment the word-terminating space is
	 * typed, and for a catalogue source that is exactly right: the empty argument
	 * OPENS the list because "show me everything" is a sensible thing to ask of a
	 * set of things, and an unmatched query still shows the honest empty sentence.
	 * A flag list has one row, so a list drawn without the user having named a flag
	 * is a list that has already chosen — and Enter's single-survivor arm would then
	 * complete `/rename ` to `--refresh`, making the naming FORM (the bare
	 * command's presentation) unreachable by the gesture that opens it. Measured on
	 * the real component before this rule existed.
	 *
	 * WHAT `flagTokenDraws` ADDS OVER THE FIRST VERSION, and why it is not merely
	 * `matches.length`: the empty query must draw nothing (the FORM case above), and
	 * a WHITESPACE-CONTAINING argument must draw nothing (a TITLE —
	 * `/rename quarterly review` names the conversation, and nothing may be drawn
	 * over the sentence). Those two were the first version's whole guard, and they
	 * were not enough: `-fresh` is one token with no space and is a SUBSEQUENCE of
	 * `--refresh`, so the matcher reached it, the row drew, and Enter ran a refresh
	 * over the user's typed title. The draw rule is therefore a PREFIX test against
	 * the source's own vocabulary — the spellings the row exists to be found by —
	 * so a title-shaped token cannot draw the row at all, whoever's mistake reaches
	 * it. Every other source keeps its behaviour exactly.
	 */
	const flagDraw = flagTokenDraws(
		effectiveInline?.source,
		argumentContext?.value ?? "",
	);
	const phaseWithFlagList =
		phase === "argument" &&
		!showsUnmatchedList(effectiveInline?.source) &&
		!flagDraw
			? null
			: phase;

	const matches: CompletionRow[] =
		phaseWithFlagList === "argument" ? argumentMatches : commandMatches;
	const eligible = enabled && phaseWithFlagList !== null;
	const visible =
		eligible && (matches.length > 0 || phaseWithFlagList === "argument");

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
		phaseWithFlagList === "argument"
			? (argumentContext?.value ?? "")
			: (commandContext?.query ?? "");
	const phaseKey =
		phaseWithFlagList === null
			? null
			: phaseWithFlagList === "argument"
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
		phase: phaseWithFlagList,
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
		inline: effectiveInline,
		effectiveEntry,
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
		isLoading: enabled && query.isLoading,
		available: enabled,
		commands: registry,
		commandNames,
		promptCommands,
		armedOnlyCommands,
		valueArgumentCommands,
		argumentCommands,
		argumentShapes,
		prefixingCommands,
		nameListCommands: vocabulary.nameList,
		nameChoices,
		argumentWords: vocabulary.words,
		enabled,
	};
}

type SlashSuggestionsPopupProps = {
	state: SlashCompletionState;
	onPick: (row: CompletionRow, disposition: { run: boolean }) => void;
	onActionPick?: (row: ArgumentActionRow) => void;
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
	onActionPick,
}) => {
	const listId = state.listId;
	const activeRef = useRef<HTMLLIElement | null>(null);
	/*
	 * THE POINTER'S LAST RECORDED POSITION (round 2, U2.1).
	 *
	 * A pick re-lays the popup out under a stationary cursor, and the browser
	 * fires `mouseenter` on whatever row the new layout puts there — for a
	 * `/mcp` verb pick that could be the THIRD server row, so the first Enter
	 * filled a row the user never pointed at. A hover only COUNTS as a move
	 * when the coordinates actually change: the click records its own point
	 * here, and an enter at the same point is the re-layout, not the user.
	 */
	const lastPointer = useRef<{ x: number; y: number } | null>(null);

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
	const activeAction = activeRow?.kind === "action" ? activeRow.row : null;
	const activeCommand = activeRow?.kind === "command" ? activeRow : null;
	/*
	 * THE PROVIDER A PICK ON THIS ROW CONNECTS (UX round 2, U4): the inline
	 * `/model` list's rows the wire says cannot run, where the pick opens the
	 * Connect flow instead of submitting — the interception in
	 * `message-input.tsx`, which reads the SAME resolver over the SAME table
	 * (`argumentList.rows`, the list a submit resolves against). Read here so
	 * both footer lines promise the connect rather than a run it will not
	 * perform, and read once so the two lines cannot describe two rows.
	 *
	 * Only a pick that RUNS is interceptable, so this can only be non-null on a
	 * `pickRuns` row; other sources never publish `connected`, and here a row
	 * without an explicit false resolves null exactly as it does at the submit.
	 */
	const activeConnectProvider = activeArgument
		? connectProviderForSelector(state.argumentList.rows, activeArgument.value)
		: null;
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
	/*
	 * The active COMMAND row's destination, read ONCE because three things below are
	 * about this same row: which line of copy its pick answers to, what the promise
	 * names, and whether the pane clause qualifies that promise. Asking the row
	 * three times is how the three come to describe different rows.
	 */
	const activeDestination =
		activeRow?.kind === "command" ? activeRow.command.destination : undefined;
	/*
	 * The EFFECTIVE entry for that destination — `DESTINATIONS` with the inline
	 * resolved against the capability answer — is what both readers below route
	 * through, read once so the pick's route and the footer's description cannot
	 * come from different tables.
	 */
	const activeEntry = state.effectiveEntry(activeDestination);
	const pickRuns = activeRowRuns({
		destination: activeDestination,
		entry: activeEntry,
		inlineRuns: state.inline?.runs ?? false,
	});
	const footer = activeAction
		? {
				text: activeAction.disabled
					? "A current model is needed to set a default."
					: "Enter sets the current model as the default for new sessions.",
				key: activeAction.disabled ? null : "Enter",
			}
		: enterFooter({
				phase: argument ? "argument" : "command",
				command: state.argumentCommand,
				label: activeCommand?.label ?? "",
				nameThenMessage: state.inline?.nameThenMessage ?? false,
				runs: pickRuns,
				/*
				 * Whether this row's completion OPENS a list — asked of the SAME effective
				 * entry the pick routes through (`activeEntry`), never of a second table,
				 * so the copy and the gesture cannot disagree about the same row. It
				 * separates the two `runs: false` command states the copy has to word
				 * differently (UX round 1, U4): `/model` completes and opens its list,
				 * `/clear` completes and is run by the NEXT Enter.
				 */
				opensList: Boolean(
					activeEntry?.kind === "picker" && activeEntry.inline !== undefined,
				),
				value: activeArgument?.value ?? "",
				matched: Boolean(activeRow),
				connect: activeConnectProvider,
				/*
				 * The filled state on a `runs: false` source: the row's value is ALREADY
				 * what the box holds, so this Enter writes nothing and only closes the
				 * list — the line has to say so rather than promise a completion that
				 * will not change a character (round 1, U3). Read off `argumentQuery`
				 * (the same value the router's gate reads) and the active row's value.
				 */
				complete:
					activeArgument !== null &&
					state.argumentQuery === activeArgument.value,
				/*
				 * The arming's own two inputs, read off the row's ROUTE (`pickArmsCommand`)
				 * and off the draft (`state.hoists`) rather than written as a command name:
				 * this line described "Enter completes the command." for the one row whose
				 * Enter hoists and stages, and it stayed green because the test that pinned
				 * it never asked the pick what it does (review F2 / QA Q5).
				 */
				arms:
					activeRow?.kind === "command"
						? pickArmsCommand(activeRow, state.armedOnlyCommands)
						: false,
				// The row's own `consumes_prompt`: the free-text rows reassemble on a pick
				// instead of running, which is what their two lines have to say (UX U2/U3).
				takesDraft:
					activeRow?.kind === "command"
						? activeRow.command.consumes_prompt
						: false,
				// The armed row's destination, so the promise this line makes about the
				// next Enter is the note's own sentence rather than a second one (design D4).
				destination: activeDestination,
				/*
				 * The pane clause, folded with the destination exactly as the staged note
				 * folds it (`message-input.tsx`): the dispatcher refuses a destination that
				 * needs a conversation, and a MACHINE panel (`/info`, `/usage`, `/analytics`)
				 * does not — it runs on a sessionless pane. Passing the raw bit here left the
				 * footer the only surface still promising "this pane needs an open
				 * conversation" for a command that then runs, which is the disagreement § 3.1
				 * centralised the predicate to prevent; it was unreachable only because no
				 * machine panel currently declares a staging route (code review round 1, m3).
				 * The predicate is the table's, so this line and the dispatcher cannot
				 * disagree.
				 */
				paneHasSession: destinationNeedsSession(activeDestination)
					? state.paneHasSession
					: true,
				hoists: state.hoists,
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
							/*
							 * A FLAG list's row acts on a whole-token vocabulary test rather than on
							 * the matcher's reach (`slashRunAllowed`'s `selectsFlag`). `undefined`
							 * for every catalogue list, which is what keeps `/model`, `/theme` and
							 * the rest byte-identical.
							 */
							selectsFlag: FLAG_LIST_SOURCES.has(
								state.inline?.source as ArgumentSource,
							)
								? (query: string) =>
										flagTokenSelects(state.inline?.source, query)
								: undefined,
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
				? pickArmsCommand(activeRow, state.armedOnlyCommands)
				: false,
		takesDraft:
			activeRow?.kind === "command" ? activeRow.command.consumes_prompt : false,
		hoists: state.hoists,
		actionClickText: activeAction?.clickText,
		value: activeArgument?.value ?? "",
		matched: Boolean(activeRow),
		connect: activeConnectProvider,
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
				{phaseLabel(
					argument ? "argument" : "command",
					state.inline?.source,
					/*
					 * The typed argument, for the one per-SLOT label: `/mcp`'s verb list is
					 * drawn under "Commands" and only the server slot says "Servers"
					 * (round 1, D6/U7). Every other source ignores it.
					 */
					state.argumentQuery,
				)}
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
								aria-disabled={
									row.kind === "action" ? row.row.disabled : undefined
								}
								aria-current={
									row.kind === "argument" && row.row.current
										? "true"
										: undefined
								}
								/*
								 * No cursor class, on purpose: the row is `role="option"`, so the
								 * base layer gives it the pointer, and an explicit utility would
								 * also beat that layer's disabled arm for the `aria-disabled` row.
								 */
								className={cn(
									"relative flex items-baseline gap-3 px-3 py-2",
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
								onClick={(event) => {
									/*
									 * The pick's own coordinates, recorded BEFORE it acts: the re-layout it
									 * causes must not count as a pointer move onto whatever row lands
									 * under the cursor (round 2, U2.1).
									 */
									lastPointer.current = {
										x: event.clientX,
										y: event.clientY,
									};
									// A COMPLETED click, not pointer-down: a press the user
									// aborts by dragging off the row must not act, and the acting
									// set includes destinations that leave the chat (U11).
									// A click names one exact row with a pointer, which is not the
									// guess the keyboard's ambiguity gate protects against — so a
									// pointer pick of a runnable row runs it (`editor.py:8040`).
									if (row.kind === "action") {
										if (shouldRunArgumentAction(row.row, true)) {
											if (onActionPick) onActionPick(row.row);
											else onPick(row, { run: true });
										}
										return;
									}
									onPick(row, { run: true });
								}}
								onMouseEnter={(event) => {
									const point = { x: event.clientX, y: event.clientY };
									const last = lastPointer.current;
									lastPointer.current = point;
									/* The re-layout under a still pointer — not a move. */
									if (last && last.x === point.x && last.y === point.y) return;
									state.setActiveHover(index);
								}}
							>
								{row.kind === "command"
									? commandRowContent(row)
									: row.kind === "action"
										? actionRowContent(row.row)
										: argumentRowContent(row, state.inline?.source)}
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
					{footer ? (
						<p>{typeof footer === "string" ? footer : footer.text}</p>
					) : null}
					{click ? <p>{click}</p> : null}
				</div>
			)}
		</div>
	);
};

function commandRowContent(row: Extract<CompletionRow, { kind: "command" }>) {
	const { command, label, fastState } = row;
	/*
	 * THE DANGER ROLE ON THE COMMAND'S OWN WORD, which is the ink `/delete` is
	 * marked with in this host: a bare command row carries no argument row and
	 * therefore no `alert`, so `slashDestructive`'s command-word arm (the arm that
	 * already makes `/logout`'s pick deliberate) is also what paints it. Asked once
	 * here so the palette and the run gate cannot disagree about which words are
	 * destructive - the same reason the function exists at all.
	 */
	const destructive = slashDestructive(command.name, undefined);
	/*
	 * THE RIGHT-EDGE SLOT, from the one decision (`commandRowSlot`,
	 * `slash-contract.ts`): a REQUIRED command says what it needs, the dial row
	 * (`/fast`) shows its live state, and every optional or parameterless row
	 * shows NOTHING - the operator report was that `/fast` trailed a literal
	 * "value?", and the placeholder is gone from the class rather than renamed
	 * for one command. The slot shares the row's meta register; the WORDS carry
	 * the state, which is what a metadata column may spend on a fact.
	 */
	const slot = commandRowSlot(command, fastState);
	return (
		<>
			<span
				className={cn(
					"shrink-0 font-mono text-body-sm",
					destructive ? "text-danger" : "text-ink",
				)}
			>
				/{label}
			</span>
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
			{slot !== null && (
				<span className="shrink-0 text-meta text-ink-dim">{slot}</span>
			)}
		</>
	);
}

function actionRowContent(row: ArgumentActionRow) {
	return (
		<>
			<span
				className={cn("shrink-0 font-medium", row.disabled && "text-ink-muted")}
			>
				{row.name}
			</span>
			<span className="min-w-0 flex-1 truncate text-ink-muted">
				{row.description}
			</span>
			<span className="shrink-0 text-meta text-ink-dim">Action</span>
		</>
	);
}

function argumentRowContent(
	row: Extract<CompletionRow, { kind: "argument" }>,
	/*
	 * The active source, for the ONE presentation rule that is per-source: a
	 * `/mcp <verb> <server>` row's detail is a config PATH, and the row reads
	 * worse than unreadable when the NAME truncates first (`remove p…` for every
	 * server — round 1, D2). The name keeps a floor there and the path gives way
	 * instead; every other source keeps the numbers-shed-first rule below.
	 */
	source: ArgumentSource | undefined,
) {
	const value = row.row;
	const mcp = source === "mcp";
	return (
		<>
			{/*
			 * The current-row marker is the TUI's own (`model_picker.py:_CURRENT_MARK`),
			 * kept as a glyph rather than a colour step so it survives a theme swap
			 * and does not read as a second selection. The SLOT is always rendered,
			 * fixed width, so the marker can never move the name or the description
			 * column: it used to sit in the row's text flow and indent the marked row
			 * by ~24px in every theme (round 1 D1). `title` names it, because
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
			<span
				className={cn(
					"min-w-0 shrink truncate text-body-sm text-ink",
					/*
					 * The human face for a label, the machine face for a slug (design
					 * round 1, D3): monospace is machine voice, and once a team row
					 * shows its label this span carries prose — the slug it addresses
					 * by rides the adjacent token below instead.
					 */
					!value.slug && "font-mono",
					/*
					 * The floor is what makes D2 hold: the name may shrink from its own
					 * width down to 24ch, and the PATH detail below absorbs the rest, so
					 * the server is identifiable before its path is. Twenty-four, not
					 * twelve (round 2, D2.1): the compound name carries the VERB's own 7ch
					 * prefix ("remove "), so 12ch guaranteed ~5 characters of the server
					 * and near-twin names still collapsed at ordinary composer width;
					 * 24ch leaves ~17 for the name, which is where the path has already
					 * begun ellipsising. The base owns `min-w-0`; this later
					 * `min-w-[24ch]` wins through twMerge for `/mcp` rows only.
					 */
					mcp && "min-w-[24ch]",
					/*
					 * THE DANGER CUE LIVES ON THE NAME, not on the detail (round 1, D3/
					 * D4/U5): a `/logout` row and a destructive `/mcp` row show exactly
					 * which thing the gesture would destroy, and the cue survives the
					 * narrow widths where the detail column is shed (`hidden` below the
					 * 24rem container), which is where the safety information used to
					 * disappear entirely. Verb rows carry it too — `remove`/`logout`/
					 * `reauth` used to look identical to `list`/`add`/`login` until a
					 * second keystroke.
					 */
					value.alert ? "text-danger" : "text-ink",
				)}
			>
				{value.name}
			</span>
			{value.slug && (
				/*
				 * THE SLUG BESIDE THE LABEL (design round 1, D2): the string every
				 * surface addresses the team by (`/team <slug>`) and the one a
				 * pick WRITES, drawn while the choice is being made rather than
				 * discovered in the composer. Quiet and monospace because it IS
				 * machine voice — the key, not prose.
				 */
				<span className="shrink-0 font-mono text-ink-dim text-mono-sm">
					{value.slug}
				</span>
			)}
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

				   `ml-auto` keeps a fixed RIGHT edge on every row: `flex-1` on the
				   description used to be the only thing absorbing the slack, so a row
				   without one put its state straight after the name while its
				   neighbours right-aligned theirs — the same word in two columns, and
				   a `needs login` scan had to read every row's middle (round 1, D1).

				   INK-DIM ON EVERY ROW, alerts included (round 1, D4): the danger
				   role moved to the name spans above, because with the whole row red
				   red stopped discriminating — and on `/mcp remove` rows it tinted a
				   FILE PATH, which reads as an error about the file rather than as
				   "removing this deletes it from that file".

				   `min-w-0 shrink truncate` for the `/mcp` compound rows is D2's
				   other half: this is the column that gives way under the name's
				   floor, so the path is the thing that ellipsises.
				 */
				<span
					className={cn(
						"ml-auto hidden font-mono text-meta",
						NUMBERS_MIN,
						mcp ? "min-w-0 shrink truncate" : "shrink-0",
						"text-ink-dim",
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
		/*
		 * The flag list's own whole-token test, bound to the ACTIVE list's source, so
		 * the keyboard's run decision is the same question the footer answers and the
		 * same one the click path asks (`handleSlashPick`). `undefined` for every
		 * catalogue list.
		 */
		selectsFlag: FLAG_LIST_SOURCES.has(state.inline?.source as ArgumentSource)
			? (query: string) => flagTokenSelects(state.inline?.source, query)
			: undefined,
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
