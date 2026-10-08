/**
 * The command palette's search: what a query means, which rows it admits, and
 * in what order they are offered.
 *
 * Pure and synchronous, with no React and no imports at all, so it is exercised
 * in memory by `scripts/palette-search.test.mjs` rather than through a browser.
 * That is the same split `features/chat/chat-search.ts` makes for the sidebar,
 * and for the same reason: "what matches" is the one part of a search surface
 * that can be pinned exactly, and the part most likely to be silently wrong.
 *
 * ## Three ideas, and why each exists
 *
 * 1. **A query has a SCOPE and some TERMS.** Typing `#retention` asks the chat
 *    store, `@ada` the agents, `,theme` the settings. A leading glyph (or one of
 *    a few words: `chat`, `agent`, `setting`, `command`) narrows which sources
 *    answer at all — which is both what a user means and what keeps the palette
 *    from spending a backend scan on a question it cannot answer.
 * 2. **Matching is tiered, not boolean.** A token that equals a word beats one
 *    that prefixes it, which beats a substring, which beats a subsequence. The
 *    tiers are what make "soft" search useful instead of noisy: `arch` finds
 *    `Architect`, and `rtn` still finds `Retention analysis` — lower in the
 *    list, and marked as the loose match it is.
 * 3. **Groups are ranked by their best row, and each group is capped.** A flat
 *    best-first list of ninety items is unreadable and a fixed section order
 *    buries the answer; ranking groups by relevance and showing a handful in
 *    each gives the reader the shape of the answer as well as its head. This is
 *    the layout Linear's and Raycast's palettes converge on.
 *
 * ## What is deliberately NOT here
 *
 * The rows themselves. Navigation, actions, the settings rail, the backend
 * settings registry, agents and conversations are assembled by
 * `use-palette-sources.ts`, which owns the React and the network. This module
 * only knows how to read a query and order a list, which is what makes it
 * testable without a DOM.
 */

/**
 * Which source a query is aimed at.
 *
 * `command` covers the things a user DOES (actions) and the places they GO
 * (pages), because both are "the app's own vocabulary" and neither is an
 * entity with its own store to search.
 */
export type PaletteScope = "command" | "chat" | "agent" | "setting";

/**
 * A rendered section of the list. Groups are the unit of both the heading and
 * the cap, so this is the list's structure rather than a tag on a row.
 */
export type PaletteGroup =
	| "navigation"
	| "chats"
	| "agents"
	/**
	 * Teams are the agent roster's second entity class (issue #849) and a group of
	 * their own rather than rows inside `agents`, because a section heading is the
	 * cheapest way to keep a same-named agent and team apart without spending the
	 * row's one `hint` slot on it — and because the two are fetched from different
	 * catalogues, so a group each is also what the caps can be tuned against.
	 */
	| "teams"
	| "actions"
	| "panels"
	| "settings";

/**
 * A glyph name rather than a component.
 *
 * The view maps these to lucide elements; this module stays free of JSX so the
 * ranking can be tested in Node. A component here would drag React into the one
 * part of the feature that has no business needing it.
 */
export type PaletteIconName =
	| "chat"
	| "agents"
	| "team"
	| "projects"
	| "hub"
	| "network"
	| "schedules"
	| "browser"
	| "settings"
	| "theme"
	| "account"
	| "integrations"
	| "providers"
	| "backend"
	| "updates"
	| "plus"
	| "new-chat"
	| "trash"
	| "canvas-open"
	| "canvas-close"
	| "slider"
	| "conversation"
	| "info"
	| "usage"
	| "session"
	| "analytics";

/** The finer kind, which decides the Enter label and the text match weights. */
export type PaletteItemKind =
	| "page"
	| "action"
	| "panel"
	| "chat"
	| "agent"
	/** A team row (issue #849). Distinct from `agent` so the unscoped list can tell
	 * a same-named pair apart by more than the section heading they sit under. */
	| "team"
	| "settings-section"
	| "setting";

/**
 * What running a row does, as data.
 *
 * The view owns the handlers; a row that carried a closure could not be built
 * by a pure module, and every one of these three is a different mechanism
 * (router navigation, the sessions store, a component action) that the view
 * already has the hooks for.
 */
export type PaletteTarget =
	| { type: "path"; path: string }
	| { type: "session"; sessionId: string }
	| {
			type: "command";
			command:
				| "create-agent"
				| "connect-provider"
				| "new-chat"
				| "clear-conversation"
				| "toggle-canvas";
	  }
	/**
	 * A panel, named by its picker destination.
	 *
	 * `/info`, `/usage`, `/analytics` and `/session` are destinations rather than
	 * routes — a route would need its own deep-link, Esc and back/forward story
	 * for a modal — so the palette asks for one instead of opening it (see
	 * `panel-presentation-store.ts`). WHICH host answers depends on the
	 * destination: the chat pane presents all four whenever it is mounted, and the
	 * shell's `panel-outlet.tsx` presents the three machine panels on the routes
	 * the pane does not own, which is why the palette no longer routes to chat for
	 * them.
	 */
	| { type: "panel"; destination: string }
	/**
	 * Stage a chat with an agent or a team, as data (issues #844, #849).
	 *
	 * This is the DRAFT DOOR, and it is a target type rather than a `path` on
	 * purpose: an agent or team row does not open an address, it stages the same
	 * `draft:<kind>:<name>` row the sidebar's "New chat with <name>" produces and
	 * then goes to `/chat`. The view owns the handler (`stageDraft({ kind, name })`
	 * then `navigate("/chat")`) because this module stays import-free.
	 *
	 * `name` is the SLUG the wire and the sidebar address a binding by
	 * (`ChatTarget`, `profile-hooks.ts`), never the display label — a row may read
	 * "Delivery crew" while the draft it stages is keyed `draft:team:delivery-crew`,
	 * and the two must agree with the sidebar's rows or the same team would get two
	 * drafts.
	 */
	| { type: "draft"; kind: "agent" | "team"; name: string };

export type PaletteItem = {
	/** Stable across renders and unique in the list; also the row's DOM id. */
	id: string;
	kind: PaletteItemKind;
	group: PaletteGroup;
	name: string;
	/**
	 * Dim text after the name, for rows whose name alone is ambiguous — two
	 * agents produce two rows with the same name, and a conversation matched on
	 * its body has to say so.
	 */
	hint?: string;
	icon: PaletteIconName;
	/**
	 * Words a user might type instead of the name. This is where the palette's
	 * "semantic" half lives: the app's own vocabulary is terse ("Appearance",
	 * "Backend settings") and people search with the words they use for the
	 * thing ("dark mode", "api key", "temperature"). Removing a surface must not
	 * remove its vocabulary: when the plain-text credentials section went, its
	 * "api key"/"keys"/"tokens" aliases moved onto the Providers row that now
	 * owns that door, rather than being deleted with the section.
	 */
	keywords?: string[];
	/** Lower-weight haystack: help text, previews, descriptions. */
	soft?: string;
	/**
	 * The backend's relevance tier for a conversation (`SESSION_RANK_*`), which
	 * outranks the local text match: a row the store knows BY CONTENT is a
	 * better answer than one whose title merely contains the letters.
	 */
	tier?: number;
	/**
	 * What Enter does, when the kind's default verb is too loose for the row.
	 * Actions name their own verb (Create, Clear, Toggle) because "Run" on a
	 * row that deletes a conversation says nothing about what it will do.
	 */
	verb?: string;
	target: PaletteTarget;
	/** Order within a group when two rows score identically. */
	order?: number;
	/** Offered in the browse layout (no query), as opposed to only on a search. */
	featured?: boolean;
	/**
	 * The row's read state — the fact the sidebar draws as its unread mark.
	 * Decided at the source by the store's own predicate (`unreadMarkKind`,
	 * `use-palette-sources.ts`) and carried as data because this module is
	 * deliberately import-free; the browse layout's Unread pin is its only
	 * reader (issue #760).
	 */
	unread?: boolean;
	/**
	 * The row's place in the visited ring (`conversationRecents`), 0 being the
	 * conversation visited most recently. Set at the source, for the same reason
	 * `unread` is: this module is deliberately import-free, so the ring's data
	 * travels on the item and the browse layout's Recents pin is its only reader.
	 * Absent when the conversation is not in the ring - a fresh install, or one
	 * not visited lately - which is what keeps the section from drawing at all.
	 */
	recentRank?: number;
	/**
	 * True on the row for the conversation the app is displaying right now.
	 * Decided at the source (the shell's own displayed-session rule) and carried
	 * as data for the same import-free reason. The Recents pin reads it to leave
	 * that row out: you are already in it, and without it the first Recents row
	 * would always be the screen you are looking at instead of the one you left.
	 */
	current?: boolean;
	/**
	 * True on a conversation the archive store holds out of the default lists -
	 * the row's OWN `archived` fact, and only when this backend advertises
	 * `session_archive`. Decided at the source with the sidebar's own predicate
	 * (`visibleRows`, `chat-archived.ts`, called rather than restated) for the same
	 * import-free reason as `unread`/`recentRank`, and read by exactly one caller:
	 * the Recents pin leaves these rows out, so an archived conversation is not
	 * claimed by the pin (QA round 1, Q-1). The browse pool below still offers
	 * them - pre-existing on both trees - which is why this is a field on the row
	 * rather than a filter on the pool.
	 */
	archived?: boolean;
	/** Rendered in the danger role; the one row that destroys something. */
	destructive?: boolean;
};

/** One admitted row and the evidence for its position. */
export type PaletteMatch = {
	item: PaletteItem;
	score: number;
	/**
	 * True when the row was admitted by the loosest tier (a subsequence, or the
	 * backend's own soft rank). Surfaced because a matched row whose name shares
	 * no visible substring with the query reads as a bug unless it is marked.
	 */
	soft: boolean;
};

/**
 * A section's key: one of the source groups, or one of the two pinned sections
 * the chats switcher draws above them - `unread` (issue #760) and `recents`.
 * Each is a section about one fact rather than a source of its own, so they are
 * SECTION keys and deliberately not members of `PaletteGroup`.
 */
export type PaletteSectionKey = PaletteGroup | "unread" | "recents";

export type PaletteSection = {
	group: PaletteSectionKey;
	items: PaletteMatch[];
};

export type PaletteSearchOutcome = {
	sections: PaletteSection[];
	/** The scope the query asked for, or null when it named none. */
	scope: PaletteScope | null;
	/** The query with its scope removed — what is left to match on. */
	terms: string;
	/** Matches before the caps were applied, so a caption can say "showing N of M". */
	total: number;
	/** Whether the caps dropped rows that matched. */
	clipped: boolean;
};

/**
 * What the browse list's own catalogue is doing, as the panel must say it:
 * the request is out, the question is answerable and the answer is zero, or
 * the rows are on screen.
 */
export type PaletteCatalogueState = "loading" | "empty" | "loaded";

/**
 * What the empty state says, per the state it is actually in (design round 2,
 * D2/U4).
 *
 * A pure table rather than a JSX branch, for the reason `chat-list-sections.ts`
 * states in full: this component cannot be rendered by `node:test`, so a
 * sentence written as a JSX condition is a sentence no test can reach. The
 * inputs are exactly the readings the panel has.
 *
 * THE THREE FIXES THIS TABLE EXISTS FOR:
 *
 * - **A scope is a promise about what its list contains.** Inside the chats
 *   scope the old copy offered "an agent by name, a setting, or a page such as
 *   Schedules" — three of its four nouns outside the door the user just chose.
 *   A scoped view speaks about its own source.
 * - **"No conversations yet" is a claim about the user's account, so it may
 *   not be made while the catalogue request is still out.** A cold open lands
 *   in this branch before the fetch answers, and the old copy flashed at a
 *   user with forty chats on every first Cmd/Ctrl+P after launch. The chats
 *   scope reads the catalogue's own state first and says loading until the
 *   question is answerable (`catalogue` in `PaletteChatState`).
 * - **The prefix advice has to fit what is on screen.** "Narrow the search
 *   with a prefix below" is wrong inside a scope: the prefix is already
 *   applied, and the way back to everything is BACKSPACING it — so that is
 *   what the scoped line teaches. The unscoped line keeps the old advice,
 *   which is true there.
 */
export type PaletteEmptyCopy = {
	/** The first line: the state named. */
	line: string;
	/** The second line: what to do next, or null when there is nothing useful to say. */
	hint: string | null;
};

export function paletteEmptyStateCopy(input: {
	scope: PaletteScope | null;
	/** Whether terms remain after the scope was read off. */
	hasTerms: boolean;
	/** The query with the scope removed, for the no-matches line. */
	terms: string;
	/** A conversations search request is out and unanswered. */
	awaiting: boolean;
	/** The browse list's catalogue, read only for the chats scope's no-terms state. */
	catalogue: PaletteCatalogueState;
}): PaletteEmptyCopy {
	const { scope, hasTerms, terms, awaiting, catalogue } = input;
	/*
	 * The request is out: the one thing that can be said without guessing is
	 * what is being done. No hint — advice to "try another word" is advice
	 * about an answer nobody has seen yet.
	 */
	if (awaiting) return { line: "Searching conversations…", hint: null };
	if (scope === "chat" && !hasTerms) {
		return catalogue === "loading"
			? { line: "Loading conversations…", hint: null }
			: {
					line: "No conversations yet",
					hint: "Start a chat and it will show up here.",
				};
	}
	if (hasTerms) {
		const glyph = SCOPE_LEGEND.find((entry) => entry.scope === scope)?.glyph;
		return {
			line: `No matches for “${terms}”`,
			hint: glyph
				? `Try another word, or backspace ${glyph} to search everything.`
				: "Try another word, or narrow the search with a prefix below.",
		};
	}
	return {
		line: "Nothing to show yet",
		/*
		 * "an agent or team by name": the `@` scope draws a roster of BOTH since
		 * issue #849, so naming only the agent would under-describe the list this
		 * line is the empty state of. The line stays scope-blind (it is the same
		 * sentence under `>`, `#` and `,`) - this is the roster's own addition, not
		 * the gate-aware copy UX U2 records as owed.
		 */
		hint: "Search for a chat, an agent or team by name, a setting, or a page such as Schedules.",
	};
}

/* ------------------------------------------------------------------ *
 * Scope vocabulary
 * ------------------------------------------------------------------ */

/**
 * The glyphs, one per scope.
 *
 * `>` for commands and pages is VS Code's, which is the convention most people
 * have in their fingers already. `#` for conversations is Slack's. `@` for
 * agents is every chat product's mention. `,` for settings is VS Code's
 * settings prefix, and deliberately NOT `/`: this app already gives `/` a
 * meaning in the composer (its slash-command menu), and a palette where `/`
 * means settings would teach two answers to one gesture.
 */
export const SCOPE_PREFIXES: Record<string, PaletteScope> = {
	">": "command",
	"#": "chat",
	"@": "agent",
	",": "setting",
};

/**
 * The same scopes as words, for a user who never learns the glyphs.
 *
 * Two rules, and both come from the same fact — a word is also a thing a user
 * might be looking FOR:
 *
 * - **Only the first token**, so `theme settings` searches for a row that says
 *   both words while `settings theme` looks inside settings. That asymmetry is
 *   the whole reason a scope is spelled as a prefix.
 * - **Only when something follows it.** `chat` on its own is a search for
 *   "chat" — the page, the conversations, the action — and a rule that ate it as
 *   a scope would leave the user staring at an empty list for the most obvious
 *   query in the app. A glyph carries no such ambiguity, which is why a bare `#`
 *   IS a scope.
 */
const SCOPE_WORDS: Record<string, PaletteScope> = {
	command: "command",
	commands: "command",
	action: "command",
	actions: "command",
	page: "command",
	pages: "command",
	go: "command",
	chat: "chat",
	chats: "chat",
	conversation: "chat",
	conversations: "chat",
	session: "chat",
	sessions: "chat",
	agent: "agent",
	agents: "agent",
	bot: "agent",
	bots: "agent",
	/*
	 * The team words scope to the AGENT scope rather than to a scope of their own
	 * (issue #849): teams are the roster's second entity class, the legend teaches
	 * one glyph for both, and a `team`-only scope would be a fifth prefix for an
	 * entity class that already lives beside its sibling.
	 */
	team: "agent",
	teams: "agent",
	setting: "setting",
	settings: "setting",
	preference: "setting",
	preferences: "setting",
	config: "setting",
};

/** Which groups a scope admits. `null` (no scope) admits every group. */
const SCOPE_GROUPS: Record<PaletteScope, PaletteGroup[]> = {
	// A panel is opened BY A COMMAND, and the palette keeps it in the command
	// scope: `>usage` is how a user asks for one by its own word.
	command: ["navigation", "actions", "panels"],
	chat: ["chats"],
	// The agent scope admits the team group beside the roster (issue #849): `@` is
	// "the things I can start a chat with by name", and teams are half of that.
	agent: ["agents", "teams"],
	setting: ["settings"],
};

/** The legend the palette itself renders, in the order the glyphs are taught. */
export const SCOPE_LEGEND: {
	glyph: string;
	scope: PaletteScope;
	label: string;
}[] = [
	{ glyph: ">", scope: "command", label: "Commands and pages" },
	{ glyph: "#", scope: "chat", label: "Chats" },
	{ glyph: "@", scope: "agent", label: "Agents and teams" },
	{ glyph: ",", scope: "setting", label: "Settings" },
];

/**
 * The query the Cmd/Ctrl+K door opens the palette with (issue #850; the seed
 * itself dates to #659, when it belonged to Cmd/Ctrl+P): the conversations
 * scope, seeded, so that chord is a conversation quick switcher rather than a
 * second copy of the palette's browse list. The browse list under it is
 * conversation rows and a term searches chats the way the sidebar does.
 *
 * THE DOOR MOVED, THE SEED DID NOT (issue #850): `#` used to be what Cmd/Ctrl+P
 * wrote and is now what Cmd/Ctrl+K writes, because the two chords swapped views
 * — K opens chats, P opens everything. Nothing about the seed changed with it:
 * it is still the glyph the chat scope IS, and the door that writes it is
 * `paletteDoorOutcome`'s (`palette-shortcut.ts`), which reads each door's view
 * off its seed through `parsePaletteQuery` rather than repeating the mapping.
 *
 * Spelled as the glyph the scope IS rather than as a mode flag: the field then
 * shows the reader why the list is conversations, and backspacing it widens
 * the surface back to everything instead of trapping the gesture in a state it
 * cannot leave. `scripts/palette-search.test.mjs` pins the binding - the seed
 * parses to the chat scope - so the constant can never drift from the table
 * above it.
 */
export const CONVERSATION_SWITCHER_SEED = "#";

/**
 * The query the sidebar's `Open agent…` control opens the palette with (issue
 * #663): the agents scope, so a roster of any length is two keystrokes away
 * from the chat column rather than a scan of disclosures.
 *
 * The same spelling rule as the switcher seed above - the glyph the scope IS,
 * so the field shows the reader why the list is agents and backspacing it
 * widens the surface again - and the same reason to live here: the seed is a
 * claim about `parsePaletteQuery`'s own table, and
 * `scripts/palette-search.test.mjs` pins it so it cannot drift from the table
 * it reads. Unlike the switcher, this seed arrives from a pressure on a band
 * control rather than a chord; the control opens and then writes it (see the
 * call site), so an already-open palette moves to the agents view rather than
 * toggling shut.
 */
export const AGENT_ROSTER_SEED = "@";

/**
 * The query the Cmd/Ctrl+Shift+P door opens the palette with (issue #850): the
 * command scope, so the third chord is "show me what the app can do" rather
 * than a third copy of the palette's browse list.
 *
 * The same spelling rule as the two seeds above — the glyph the scope IS — and
 * the same reason to live here: it is a claim about `parsePaletteQuery`'s own
 * table, and `scripts/palette-search.test.mjs` pins it so the constant can never
 * drift from the scope it names. `paletteDoorOutcome` (in `palette-shortcut.ts`)
 * reads each door's scope off its seed through that same parser rather than
 * repeating the mapping here, so there is one place a door's view is decided.
 */
export const COMMAND_SCOPE_SEED = ">";

/**
 * Read a raw query into its scope and its terms.
 *
 * The glyph form is only recognised at the very start (it is a prefix), and the
 * word form only as the first token, so a query that merely CONTAINS the word
 * "chat" still searches everything for it — which is what a user typing
 * "retention chat" means.
 */
export function parsePaletteQuery(raw: string): {
	scope: PaletteScope | null;
	terms: string;
} {
	const trimmed = raw.trim();
	if (!trimmed) return { scope: null, terms: "" };
	/*
	 * `>` and `#` are never search terms, so a glyph scopes the query even on its
	 * own: `#` is "show me my chats", which is a legitimate thing to ask a palette
	 * without typing anything else.
	 */
	const glyph = SCOPE_PREFIXES[trimmed[0]];
	if (glyph) return { scope: glyph, terms: trimmed.slice(1).trim() };
	const [first, ...rest] = trimmed.split(WHITESPACE_RUN);
	const word = rest.length > 0 ? SCOPE_WORDS[normalizeText(first)] : undefined;
	if (word) return { scope: word, terms: rest.join(" ").trim() };
	return { scope: null, terms: trimmed };
}

/* ------------------------------------------------------------------ *
 * Matching
 * ------------------------------------------------------------------ */

/**
 * Strip diacritics and case, then reduce every run of non-alphanumerics to one
 * space.
 *
 * The separator fold is the same one the settings registry search already
 * applies (`web_search.enabled` → `web search enabled`), because a user typing
 * "web search" must find a key spelled with underscores. Normalising here means
 * the scoring never has to know about either spelling.
 */
/**
 * Folding's two patterns, hoisted.
 *
 * They run per keystroke over every row's fields, which is exactly the case
 * Biome's `useTopLevelRegex` is written for: a literal in a function body is a
 * new object on every call, and this function is called thousands of times for
 * one keystroke's worth of rows.
 */
const COMBINING_MARKS = /\p{M}/gu;
const NOT_ALPHANUMERIC = /[^a-z0-9]+/g;
const WHITESPACE_RUN = /\s+/;

/**
 * Strip diacritics and case, then reduce every run of non-alphanumerics to one
 * space.
 *
 * The separator fold is the same one the settings registry search already
 * applies (`web_search.enabled` → `web search enabled`), because a user typing
 * "web search" must find a key spelled with underscores. Normalising here means
 * the scoring never has to know about either spelling.
 */
export function normalizeText(value: string): string {
	return (
		value
			.normalize("NFD")
			/*
			 * `\p{M}` — the Unicode "mark" property, which is every combining mark rather
			 * than one range of them — so a decomposed `é` folds to `e`. `u`, because
			 * property escapes require it, and an alternation of literal marks is what a
			 * character class of them would have been anyway (Biome's
			 * `noMisleadingCharacterClass` is right to refuse the class: a range of marks
			 * reads as "match a character AND its mark", which is not what this does).
			 */
			.replace(COMBINING_MARKS, "")
			.toLowerCase()
			.replace(NOT_ALPHANUMERIC, " ")
			.trim()
	);
}

export function tokenize(value: string): string[] {
	const normalized = normalizeText(value);
	return normalized ? normalized.split(" ") : [];
}

/**
 * The tiers, best first, and what each is worth.
 *
 * `exact` is a whole word, `prefix` a word's beginning (`arch` → `Architect`),
 * `substring` a match inside a word (`tention` → `Retention`), `subsequence`
 * the letters in order with gaps (`rta` → `Retention analysis`). The gap
 * between `substring` and `subsequence` is deliberately wide: the first is
 * something a person can see in the row, and the second is a guess.
 */
const QUALITY = {
	exact: 1,
	prefix: 0.9,
	substring: 0.55,
	subsequence: 0.3,
} as const;

type Quality = keyof typeof QUALITY;

/**
 * How well one token matches one haystack.
 *
 * Returns null for no match at all. The haystack is matched whole rather than
 * word-by-word for the substring tier (so `web search` matches across the space
 * in `web search enabled`), and word-by-word for the two better tiers.
 */
export function matchQuality(haystack: string, token: string): Quality | null {
	if (!haystack || !token) return null;
	if (haystack === token) return "exact";
	const words = haystack.split(" ");
	for (const word of words) {
		if (word === token) return "exact";
	}
	for (const word of words) {
		if (word.startsWith(token)) return "prefix";
	}
	if (haystack.includes(token)) return "substring";
	/*
	 * The loose tier exists for partial recall ("rtn" → "Retention analysis")
	 * and is refused below three characters: a one- or two-letter subsequence
	 * matches nearly every row in the list, so it would not be softness, it
	 * would be noise wearing softness as a costume.
	 */
	if (token.length < 3) return null;
	let cursor = 0;
	for (const char of haystack) {
		if (char === token[cursor]) cursor += 1;
		if (cursor === token.length) return "subsequence";
	}
	return null;
}

/**
 * Field weights. The name is what the user reads; the keywords are the words
 * they use for it; the soft haystack is context that should only admit a row
 * that nothing else answered.
 */
const FIELD_WEIGHT = {
	name: 1,
	keywords: 0.85,
	hint: 0.5,
	group: 0.4,
	soft: 0.3,
} as const;

/** One row's fields, pre-normalised. Built once per list, not per keystroke. */
type Haystacks = {
	name: string;
	keywords: string;
	hint: string;
	group: string[];
	soft: string;
};

export function haystacksFor(item: PaletteItem): Haystacks {
	return {
		name: normalizeText(item.name),
		keywords: (item.keywords ?? []).map(normalizeText).join(" ").trim(),
		hint: normalizeText(item.hint ?? ""),
		group: PALETTE_GROUP_LABELS[item.group].map(normalizeText),
		soft: normalizeText(item.soft ?? ""),
	};
}

/**
 * Score one row against the query's tokens, or refuse it.
 *
 * Every token must match somewhere: an AND across tokens is what makes a
 * multi-word query narrowing rather than broadening, which is the behaviour a
 * two-word search has to have to be worth typing. The score is the mean of the
 * tokens' best field scores, so a row is not rewarded for being long.
 */
export function scoreHaystacks(
	haystacks: Haystacks,
	tokens: string[],
): { score: number; soft: boolean } | null {
	if (tokens.length === 0) return { score: 0, soft: false };
	let total = 0;
	let soft = false;
	for (const token of tokens) {
		let best = 0;
		let bestQuality: Quality | null = null;
		const consider = (value: string, weight: number) => {
			const quality = matchQuality(value, token);
			if (!quality) return;
			const score = QUALITY[quality] * weight;
			if (score > best) {
				best = score;
				bestQuality = quality;
			}
		};
		consider(haystacks.name, FIELD_WEIGHT.name);
		consider(haystacks.keywords, FIELD_WEIGHT.keywords);
		consider(haystacks.hint, FIELD_WEIGHT.hint);
		for (const group of haystacks.group) consider(group, FIELD_WEIGHT.group);
		consider(haystacks.soft, FIELD_WEIGHT.soft);
		if (!bestQuality) return null;
		if (bestQuality === "subsequence") soft = true;
		total += best;
	}
	return { score: total / tokens.length, soft };
}

/**
 * The score a conversation's backend rank is worth.
 *
 * The tiers mirror `local_operator.session.session_search`'s `RANK_*`
 * constants and the sidebar's own ordering: a name match is the best possible
 * answer, an id match is nearly as good, a body match is real but weaker, and a
 * soft match is a guess. Added rather than compared, because the local text
 * score and the backend tier are two measurements of the same row and a row
 * with both should beat a row with either.
 */
const TIER_BONUS: Record<number, number> = {
	0: 0.5,
	1: 0.35,
	2: 0.12,
	3: -0.05,
};

/**
 * The score a row gets when the STORE is the only thing that matched it.
 *
 * A conversation whose body mentions the query has no evidence of it in the
 * renderer at all — its title is something else and the catalogue's preview is
 * a tail, not the whole conversation — so without this path the one answer the
 * store exists to give would be refused for having nothing local to prove
 * itself with. It sits deliberately between the two local tiers: above a
 * subsequence guess (0.3), below a name match (1.0), because "the store knows
 * this word is inside it" is a real answer and a weaker one than the query
 * being the row's own name.
 */
const TIER_ONLY_BASE = 0.55;

/** The backend's soft tier, which marks its row the way a loose text match is. */
export const SOFT_TIER = 3;

export function scoreItem(
	item: PaletteItem,
	haystacks: Haystacks,
	tokens: string[],
): PaletteMatch | null {
	const matched = scoreHaystacks(haystacks, tokens);
	const tierBonus = item.tier === undefined ? 0 : (TIER_BONUS[item.tier] ?? 0);
	if (!matched) {
		// No local field matched. The only thing that can still admit this row is a
		// source outside the renderer saying it did.
		if (item.tier === undefined) return null;
		return {
			item,
			score: TIER_ONLY_BASE + tierBonus,
			soft: item.tier === SOFT_TIER,
		};
	}
	/*
	 * Whole-query bonuses, on top of the per-token mean: a row whose name IS the
	 * query, and a row whose name begins with it, are both better answers than a
	 * row that merely contains the words. Without these, "chat" ranks "Clear
	 * conversation" and "Chat" identically, and the palette's first row stops
	 * being predictable.
	 */
	const query = tokens.join(" ");
	let bonus = 0;
	if (haystacks.name === query) bonus += 0.3;
	else if (
		haystacks.name.startsWith(`${query} `) ||
		haystacks.name.startsWith(query)
	)
		bonus += 0.15;
	return {
		item,
		score: matched.score + tierBonus + bonus,
		soft: matched.soft || item.tier === SOFT_TIER,
	};
}

/* ------------------------------------------------------------------ *
 * Presentation constants
 * ------------------------------------------------------------------ */

/**
 * The heading each group renders under.
 *
 * Sentence case, and the same words the rest of the app uses: the rail calls
 * its list "Chat" and "Settings", so a palette that said "Conversations" and
 * "Preferences" would be teaching a second name for each.
 */
export const PALETTE_GROUP_TITLES: Record<PaletteGroup, string> = {
	navigation: "Go to",
	chats: "Chats",
	agents: "Agents",
	teams: "Teams",
	actions: "Actions",
	panels: "Panels",
	settings: "Settings",
};

/**
 * The section headings, keyed as sections are: the groups' own table above,
 * plus the pinned section's. Composed rather than re-spelled, so a group's
 * rename moves one table and the view cannot drift from it.
 */
export const PALETTE_SECTION_TITLES: Record<PaletteSectionKey, string> = {
	...PALETTE_GROUP_TITLES,
	unread: "Unread",
	recents: "Recents",
};

/**
 * The alias spellings each group answers to, which is also how a scope word
 * like "pages" or "commands" is resolved to the group a query wants.
 */
export const PALETTE_GROUP_LABELS: Record<PaletteGroup, string[]> = {
	navigation: ["Go to", "Pages", "Navigation", "Tab"],
	chats: ["Chats", "Conversations", "Chat"],
	agents: ["Agents", "Bots"],
	// The team words are also the scope's own words (`SCOPE_WORDS`), so typing
	// "team" scopes to the roster and then matches this group's haystack - the
	// same one-fact-one-derivation the other groups carry.
	teams: ["Teams", "Team"],
	actions: ["Actions", "Commands"],
	panels: ["Panels", "Panels and reports", "Views"],
	settings: ["Settings", "Preferences"],
};

/** The browse layout's order: where you can go, then what you have, then what you can do. */
export const PALETTE_GROUP_ORDER: PaletteGroup[] = [
	"navigation",
	"chats",
	"agents",
	"teams",
	"actions",
	"panels",
	"settings",
];

/**
 * Caps.
 *
 * A group cap keeps one source from drowning the others; the total cap keeps
 * the list's own rendering bounded (every row is a real DOM node and the
 * palette is redrawn on each keystroke, so an unbounded list is a latency
 * budget nobody agreed to). The scope cap is what makes `#retention` useful:
 * when the user has SAID which source they mean, that source gets the room.
 */
const GROUP_CAP = 6;
const SCOPED_GROUP_CAP = 24;
export const TOTAL_CAP = 48;
/**
 * How many rows the switcher's Recents pin shows.
 *
 * Five, because the pin is a shortcut to the conversations you were just in and it
 * sits between the Unread pin and the Chats tier, whose own browse cap is also five
 * (`BROWSE_CAP.chats`). It is NOT a number chosen to fit beside the Chats tier:
 * five is ACCEPTED TO COST some of it. The list box is 384px, and with even one
 * unread row the pin's five rows push most of the Chats tier below the fold on
 * open (design round 1, D1 measured it: 1 unread + 5 Recents + 5 Chats leaves about
 * 1.8 of the Chats rows visible). The fold fade and the scrollbar cue the rest -
 * every row stays reachable by down-arrow or by scrolling - and a smaller cap was
 * the alternative, rejected because a pin of two or three would be routinely short
 * of the conversations the ring remembers. The ring remembers more
 * (`CONVERSATION_RECENTS_LIMIT`, twenty) so that the pin stays full when some of
 * what it remembers is on screen, unread, gone or archived.
 */
export const RECENTS_PIN_CAP = 5;
const BROWSE_CAP: Record<PaletteGroup, number> = {
	navigation: 6,
	chats: 5,
	agents: 5,
	teams: 5,
	actions: 5,
	panels: 5,
	settings: 8,
};

/* ------------------------------------------------------------------ *
 * The search
 * ------------------------------------------------------------------ */

export type PaletteSearchInput = {
	items: PaletteItem[];
	raw: string;
};

/**
 * The list for a query: which groups, in what order, with which rows.
 *
 * Two layouts, decided by whether the query carries terms:
 *
 * - **Browse** (no terms): each group's featured rows, in `PALETTE_GROUP_ORDER`,
 *   capped per group — and, under the switcher's chats scope, the unread
 *   conversations pinned above them as their own section (issue #760). This is
 *   the list that answers "what is in here", so the registry's seventy settings
 *   keys are deliberately not in it — a browse list of everything is a browse
 *   list of nothing.
 * - **Search**: per-row scores, groups ordered by their best row, each group
 *   capped. A scope narrows the groups allowed to answer at all.
 */
export function searchPalette({
	items,
	raw,
}: PaletteSearchInput): PaletteSearchOutcome {
	const { scope, terms } = parsePaletteQuery(raw);
	const allowed = scope ? SCOPE_GROUPS[scope] : null;
	const tokens = tokenize(terms);

	// Pre-normalise once per list, not once per comparison: the haystacks are a
	// function of the item, and normalising is the expensive half of matching.
	const pool = items.filter((item) => !allowed || allowed.includes(item.group));

	if (tokens.length === 0) {
		const sections: PaletteSection[] = [];
		let total = 0;
		let rendered = 0;
		/*
		 * THE UNREAD PIN (issue #760): the conversations waiting on a read, first,
		 * because the browse list's own promise is "the rows the sidebar would"
		 * and the sidebar draws a mark on exactly these. `unread` is decided at
		 * the source by the store's own predicate (`unreadMarkKind`,
		 * `use-palette-sources.ts`) — this module only reads the flag, because it
		 * stays import-free.
		 *
		 * SWITCHER-ONLY, deliberately: the gate is the `#` seed's scope, the door
		 * that exists for finding a conversation. Widening the pin to the
		 * un-scoped Cmd/Ctrl+P browse is loosening this condition and leaving the
		 * accounting below untouched — the open design question #760 records.
		 *
		 * The pin draws from the SAME `rendered` budget as every section below it
		 * rather than sitting outside `TOTAL_CAP`: the rows it takes are rows the
		 * tiers no longer offer, and `clipped` still answers "did the list drop
		 * rows" — the property the footer's "showing N of M" is built on.
		 */
		const pinnedIds = new Set<string>();
		if (scope === "chat") {
			const unread = pool
				.filter(
					(item) =>
						item.group === "chats" && item.unread === true && item.featured,
				)
				/*
				 * The same order the Chats tier below draws in — the catalogue's
				 * newest-first, which the items already carry as `order` — so the pin
				 * and the tier cannot disagree about recency (issue #760).
				 */
				.sort(byOrder);
			if (unread.length > 0) {
				total += unread.length;
				const room = Math.max(0, Math.min(unread.length, TOTAL_CAP - rendered));
				if (room > 0) {
					const shown = unread.slice(0, room);
					sections.push({
						group: "unread",
						items: shown.map((item) => ({
							item,
							score: 0,
							soft: item.tier === SOFT_TIER,
						})),
					});
					rendered += shown.length;
				}
				/*
				 * Every unread row belongs to the pin, drawn or not: a row the budget
				 * could not show must not reappear below under the chats tier as a
				 * second copy of itself, and the rows that did not fit are exactly
				 * what the false side of `clipped` must not hide.
				 */
				for (const item of unread) pinnedIds.add(item.id);
			}
			/*
			 * THE RECENTS PIN: the conversations visited lately, directly beneath
			 * Unread, so getting back to one is a single keystroke. `recentRank` is
			 * the row's index in the visited ring, set at the source (this module
			 * stays import-free).
			 *
			 * WHICH ROWS. Featured chat rows that carry a rank, minus two kinds:
			 * - unread rows, which already sit in the Unread pin above - a row never
			 *   appears twice, and `pinnedIds` holds them by now;
			 * - the conversation on screen, because the reader is already in it. It
			 *   is what makes the first Recents row "the previous conversation"
			 *   (the Alt-Tab behaviour);
			 * - archived rows, which the row carries as `archived` under `visibleRows`'
			 *   rule (`chat-archived.ts`): the pin does not claim one (QA round 1,
			 *   Q-1). The pin is the ONLY thing that changes here - the browse pool
			 *   below still offers an archived conversation, which is pre-existing on
			 *   both trees and recorded as deferred - and leaving a row to the tier
			 *   below is already this pin's shape, because `current` does exactly that.
			 * A ring entry with no catalogue row (deleted, forgotten) never reaches
			 * here: rows are derived from live catalogue items, so nothing is
			 * resurrected. An empty ring, or no eligible row, draws no section and no
			 * heading, and the list is exactly what it was.
			 *
			 * SAME BUDGET, SAME ACCOUNTING as the Unread pin: `total` counts the
			 * pin's whole claim, the drawn rows come out of the running `rendered`
			 * budget, and every row the pin claims - drawn within its five or not -
			 * goes into `pinnedIds`, so it cannot reappear under the Chats tier as a
			 * second copy. SWITCHER-ONLY for the reason the Unread pin is: the gate is
			 * the `#` seed's scope, and the un-scoped Cmd/Ctrl+P browse is unchanged.
			 */
			const recents = pool
				.filter(
					(item) =>
						item.group === "chats" &&
						item.featured &&
						item.recentRank !== undefined &&
						item.current !== true &&
						item.archived !== true &&
						!pinnedIds.has(item.id),
				)
				.sort(
					(a, b) => (a.recentRank ?? 0) - (b.recentRank ?? 0) || byOrder(a, b),
				);
			if (recents.length > 0) {
				const claimed = recents.slice(0, RECENTS_PIN_CAP);
				total += claimed.length;
				const room = Math.max(0, TOTAL_CAP - rendered);
				if (room > 0) {
					const shown = claimed.slice(0, room);
					sections.push({
						group: "recents",
						items: shown.map((item) => ({
							item,
							score: 0,
							soft: item.tier === SOFT_TIER,
						})),
					});
					rendered += shown.length;
				}
				for (const item of claimed) pinnedIds.add(item.id);
			}
		}
		for (const group of PALETTE_GROUP_ORDER) {
			if (allowed && !allowed.includes(group)) continue;
			const featured = pool
				.filter(
					(item) =>
						item.group === group && item.featured && !pinnedIds.has(item.id),
				)
				.sort(byOrder);
			if (featured.length === 0) continue;
			total += featured.length;
			const cap = BROWSE_CAP[group];
			const room = Math.max(0, Math.min(cap, TOTAL_CAP - rendered));
			if (room === 0) continue;
			const items = featured.slice(0, room).map((item) => ({
				item,
				score: 0,
				soft: item.tier === SOFT_TIER,
			}));
			sections.push({ group, items });
			rendered += items.length;
		}
		/*
		 * `clipped` is a statement about the LIST, so it is read off the list
		 * rather than set by any branch that happened to touch a cap: with an
		 * exact fit every cap test passes, and the footer printed "showing the
		 * best 48 of 48" — a sentence that contradicts itself, produced by a flag
		 * that meant "a cap was consulted" (round 1, R-3). Same rule as the
		 * search branch below, now over the one running budget both layouts draw
		 * from.
		 */
		return { sections, scope, terms: "", total, clipped: rendered < total };
	}

	const byGroup = new Map<PaletteGroup, PaletteMatch[]>();
	let total = 0;
	for (const item of pool) {
		const haystacks = haystacksFor(item);
		const match = scoreItem(item, haystacks, tokens);
		if (!match) continue;
		total += 1;
		const bucket = byGroup.get(item.group);
		if (bucket) bucket.push(match);
		else byGroup.set(item.group, [match]);
	}

	const capFor = (group: PaletteGroup) =>
		scope && SCOPE_GROUPS[scope].includes(group) ? SCOPED_GROUP_CAP : GROUP_CAP;

	/*
	 * Groups are ordered by their best row, then by the browse order, so the
	 * answer to the question leads the list and the sections below it are still
	 * in a stable, explainable order rather than in score noise.
	 */
	const ordered = [...byGroup.entries()].sort((a, b) => {
		const best = bestScore(b[1]) - bestScore(a[1]);
		if (best !== 0) return best;
		return (
			PALETTE_GROUP_ORDER.indexOf(a[0]) - PALETTE_GROUP_ORDER.indexOf(b[0])
		);
	});

	const sections: PaletteSection[] = [];
	let rendered = 0;
	for (const [group, matches] of ordered) {
		matches.sort((a, b) => b.score - a.score || byOrder(a.item, b.item));
		const cap = capFor(group);
		const room = Math.max(0, Math.min(cap, TOTAL_CAP - rendered));
		if (room === 0) continue;
		sections.push({ group, items: matches.slice(0, room) });
		rendered += sections[sections.length - 1].items.length;
		if (rendered >= TOTAL_CAP) break;
	}
	/*
	 * `clipped` is a statement about the LIST, so it is read off the list rather
	 * than set by any branch that happened to touch a cap: with an exact fit every
	 * cap test passes, and the footer printed "showing the best 48 of 48" — a
	 * sentence that contradicts itself, produced by a flag that meant "a cap was
	 * consulted" (round 1, R-3).
	 */
	return { sections, scope, terms, total, clipped: rendered < total };
}

function bestScore(matches: PaletteMatch[]): number {
	let best = Number.NEGATIVE_INFINITY;
	for (const match of matches) if (match.score > best) best = match.score;
	return best;
}

/** Definition order for static rows, recency for conversations. */
function byOrder(a: PaletteItem, b: PaletteItem): number {
	return (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id);
}

/* ------------------------------------------------------------------ *
 * Static rows
 * ------------------------------------------------------------------ */

/**
 * What the settings rail's ids mean to a search.
 *
 * Keyed by id rather than by position or label so a renamed label keeps its
 * keywords, and deliberately EXHAUSTIVE-OPTIONAL: an id with no entry here
 * still renders and still matches on its own label, it just has no aliases.
 * That is the difference between a new settings section being unsearchable and
 * being unsearchable-by-alias, and only the second is acceptable.
 */
const SETTINGS_META: Record<
	string,
	{ icon: PaletteIconName; keywords: string[] }
> = {
	general: {
		icon: "settings",
		keywords: ["basics", "startup", "launch", "language", "profile", "user"],
	},
	appearance: {
		icon: "theme",
		keywords: [
			"theme",
			"dark mode",
			"light mode",
			"colours",
			"colors",
			"font",
			"zoom",
			"palette",
		],
	},
	radient: {
		icon: "account",
		keywords: [
			"account",
			"login",
			"sign in",
			"credits",
			"billing",
			"plan",
			"usage",
		],
	},
	integrations: {
		icon: "integrations",
		keywords: ["slack", "google", "notion", "connections", "mcp", "apps"],
	},
	providers: {
		icon: "providers",
		/*
		 * The API-key vocabulary lives HERE now that the plain-text credentials
		 * section is gone (its palette row was this app's only owner of "api key",
		 * "keys", "tokens"). Deleting the SECTION was deliberate; deleting the
		 * SYNONYM SET was collateral — the Providers grid's own rows read "Sign in or
		 * API key" and carry an API-key tab, so it is the surface those words name.
		 * Users search the words they use, not the words the app renamed a surface to.
		 */
		keywords: [
			"models",
			"llm",
			"openai",
			"anthropic",
			"google",
			"ollama",
			"model provider",
			"api provider",
			"api key",
			"api keys",
			"keys",
			"tokens",
			"credentials",
		],
	},
	backend: {
		icon: "backend",
		keywords: [
			"server",
			"advanced",
			"registry",
			"daemon",
			"web search",
			"temperature",
		],
	},
	updates: {
		icon: "updates",
		keywords: ["upgrade", "version", "release", "changelog", "auto update"],
	},
};

/**
 * The destinations, in the rail's own order.
 *
 * `featured` on all of them: "go somewhere" is the most common thing a palette
 * is opened for, so the browse list leads with them.
 */
export function buildNavigationItems(
	pages: {
		id: string;
		name: string;
		path: string;
		icon: PaletteIconName;
		keywords?: string[];
	}[],
): PaletteItem[] {
	return pages.map((page, index) => ({
		id: `page-${page.id}`,
		kind: "page" as const,
		group: "navigation" as const,
		name: page.name,
		icon: page.icon,
		keywords: page.keywords,
		target: { type: "path" as const, path: page.path },
		order: index,
		featured: true,
	}));
}

/** The settings rail's sections, as destinations. */
export function buildSettingsSectionItems(
	sections: { id: string; label: string }[],
): PaletteItem[] {
	return sections.map((section, index) => {
		const meta = SETTINGS_META[section.id];
		return {
			id: `settings-section-${section.id}`,
			kind: "settings-section" as const,
			group: "settings" as const,
			name: section.label,
			icon: meta?.icon ?? "settings",
			keywords: meta?.keywords,
			/*
			 * No per-row hint, deliberately (design round 1, D3). Every row in this
			 * builder is a settings SECTION and the group heading above them already
			 * says so, so the hint repeated its own heading six times down the list
			 * while costing a third text column on every row. A REGISTRY key keeps
			 * its hint, because there the hint distinguishes: it names the section
			 * the key lives in, which is the one thing the row's name cannot say.
			 */
			target: {
				type: "path" as const,
				path: `/settings?section=${section.id}`,
			},
			order: index,
			featured: true,
		};
	});
}

/**
 * One row per registry key, deep-linked to that key's own row.
 *
 * The link is the settings page's existing `?setting=<key>` target, which
 * reveals the key's section, expands it and focuses the field — so a row here
 * lands the user on the control itself rather than at the top of a long page.
 * Not `featured`: seventy keys in the browse list would bury everything else,
 * and a key is only ever wanted by name.
 */
export function buildSettingKeyItems(
	settings: {
		key: string;
		label: string;
		section: string;
		help?: string;
		kind?: string;
	}[],
): PaletteItem[] {
	return settings.map((setting, index) => ({
		id: `setting-${setting.key}`,
		kind: "setting" as const,
		group: "settings" as const,
		name: setting.label,
		icon: "slider" as const,
		// The key itself is a keyword, so `web_search` finds the row the backend
		// spells that way while the label reads "Web search".
		keywords: [setting.key, setting.kind ?? ""].filter(Boolean),
		soft: setting.help,
		hint: setting.section,
		target: {
			type: "path" as const,
			path: `/settings?setting=${encodeURIComponent(setting.key)}`,
		},
		order: index,
	}));
}

/** An action — something the palette DOES rather than somewhere it goes. */
export function buildActionItems(
	actions: {
		id: string;
		name: string;
		icon: PaletteIconName;
		keywords: string[];
		command: Extract<PaletteTarget, { type: "command" }>["command"];
		destructive?: boolean;
		/** Offered in the browse list. */
		featured?: boolean;
		/** What Enter does, on the active row. */
		verb: string;
	}[],
): PaletteItem[] {
	return actions.map((action, index) => ({
		id: `action-${action.id}`,
		kind: "action" as const,
		group: "actions" as const,
		name: action.name,
		icon: action.icon,
		keywords: action.keywords,
		verb: action.verb,
		target: { type: "command" as const, command: action.command },
		order: index,
		featured: action.featured,
		destructive: action.destructive,
	}));
}

/**
 * A panel the chat pane presents, addressed by picker destination.
 *
 * FEATURED, unlike the registry keys, and the difference is what the two groups
 * are for: a settings key is only ever wanted by name, while a panel is a place a
 * user may not know exists — the rail's own door taught the palette once, and this
 * group is what teaches these four (`/info`, `/usage`, `/analytics`, `/session`).
 * They appear in the browse layout only when the pane can present them, and an
 * empty group renders nothing, so the browse list gains nothing it cannot deliver
 * (UX round 1, U6).
 */
export function buildPanelItems(
	panels: {
		id: string;
		destination: string;
		name: string;
		hint: string;
		icon: PaletteIconName;
		keywords: string[];
	}[],
): PaletteItem[] {
	return panels.map((panel, index) => ({
		id: `panel-${panel.id}`,
		kind: "panel" as const,
		group: "panels" as const,
		name: panel.name,
		hint: panel.hint,
		icon: panel.icon,
		keywords: panel.keywords,
		verb: "Open",
		target: { type: "panel" as const, destination: panel.destination },
		order: index,
		featured: true,
	}));
}

/**
 * A conversation row.
 *
 * Built from the sidebar's own join (`searchChats`) so the palette and the
 * sidebar cannot disagree about which conversations a query matches or which
 * ones need the "in conversation" marker — the palette shows the same rows the
 * sidebar would, which is the point of reusing the backend search rather than
 * inventing a second one here.
 *
 * WHAT IT DOES NOT CARRY, stated here because the sidebar's row learned it this
 * round and a reader of this function is one line from the field (review round 1,
 * m3): the sidebar's slot draws the TEAM an agent-opened workstream serves, and
 * nothing when it serves none (`opened_by` read by `rowTrailingStatement`), while
 * this row always draws the binding — the same string on a team-bound workstream,
 * where the two surfaces agree, and `· <agent>` on a team-less one, where the
 * sidebar's slot is now silent. THE BINDING IS RESOLVED THROUGH `teamNames` (the
 * sidebar's label rule), so a labelled team reads here the way the sidebar's own
 * slots read it; without the map, or for a slug it does not hold, the slug is the
 * string, which is the pre-labels pixel. What this row cannot say, on any of them,
 * is WHO opened the conversation: a workstream an agent opened reads here as any
 * chat bound to its team or agent does, which is the indistinguishability the
 * sidebar's flyout and screen-reader sentence answer where they can. It is
 * DELIBERATE and bounded rather than overlooked: this row has ONE secondary slot
 * (`hint`), the search mark already arbitrates for it below
 * (`use-palette-sources.ts`'s `hint: marked ? …`), and choosing between "why is
 * this row on screen" and "who opened it" is exactly the tradeoff the sidebar
 * settles with a precedence rule and its own width measurements. The palette's
 * row would need that same decision made against its own slot, as its own change
 * on the surface the incident did not name — recorded on the pull request that
 * added the sidebar marker as deferred, not left silent. The field is in hand
 * here (`CanonicalSessionRow`), so the work is a precedence choice rather than a
 * wire change.
 */
export function buildChatItem(
	row: {
		session_id: string;
		title?: string | null;
		binding?: { agent: string | null; team: string | null } | null;
	},
	/*
	 * Team slug -> the name a person reads, when the caller holds the catalogue
	 * (`use-palette-sources.ts` does, gated on the same `team_catalogue`
	 * capability the sidebar gates its own list on). A parameter rather than an
	 * import because this module is deliberately import-free so its test can
	 * bundle it bare; an absent map, or a slug it does not hold, keeps the
	 * string this row drew before labels existed.
	 */
	teamNames?: ReadonlyMap<string, string>,
): PaletteItem {
	const team = row.binding?.team;
	const binding = team
		? (teamNames?.get(team) ?? team)
		: (row.binding?.agent ?? "");
	return {
		id: `chat-${row.session_id}`,
		kind: "chat",
		group: "chats",
		name: row.title?.trim() || "Untitled chat",
		icon: "conversation",
		hint: binding || undefined,
		target: { type: "session", sessionId: row.session_id },
	};
}
