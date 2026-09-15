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
	| "hub"
	| "schedules"
	| "browser"
	| "settings"
	| "theme"
	| "account"
	| "integrations"
	| "providers"
	| "backend"
	| "credentials"
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
				| "new-chat"
				| "clear-conversation"
				| "toggle-canvas";
	  }
	/**
	 * A panel the CHAT PANE has to present, named by its picker destination.
	 *
	 * `/info`, `/usage`, `/analytics` and `/session` are destinations rather than
	 * routes — the adapters need the live pane's session handle, command catalogue
	 * and rebind path — so the palette asks for one instead of opening it (see
	 * `chat-panel-request-store.ts`).
	 */
	| { type: "panel"; destination: string };

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
	 * "API credentials") and people search with the words they use for the
	 * thing ("dark mode", "api key").
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

export type PaletteSection = { group: PaletteGroup; items: PaletteMatch[] };

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
	agent: ["agents"],
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
	{ glyph: "@", scope: "agent", label: "Agents" },
	{ glyph: ",", scope: "setting", label: "Settings" },
];

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
	actions: "Actions",
	panels: "Panels",
	settings: "Settings",
};

/**
 * The alias spellings each group answers to, which is also how a scope word
 * like "pages" or "commands" is resolved to the group a query wants.
 */
export const PALETTE_GROUP_LABELS: Record<PaletteGroup, string[]> = {
	navigation: ["Go to", "Pages", "Navigation", "Tab"],
	chats: ["Chats", "Conversations", "Chat"],
	agents: ["Agents", "Bots"],
	actions: ["Actions", "Commands"],
	panels: ["Panels", "Panels and reports", "Views"],
	settings: ["Settings", "Preferences"],
};

/** The browse layout's order: where you can go, then what you have, then what you can do. */
export const PALETTE_GROUP_ORDER: PaletteGroup[] = [
	"navigation",
	"chats",
	"agents",
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
const BROWSE_CAP: Record<PaletteGroup, number> = {
	navigation: 6,
	chats: 5,
	agents: 5,
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
 *   capped per group. This is the list that answers "what is in here", so the
 *   registry's seventy settings keys are deliberately not in it — a browse list
 *   of everything is a browse list of nothing.
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
		let clipped = false;
		for (const group of PALETTE_GROUP_ORDER) {
			if (allowed && !allowed.includes(group)) continue;
			const featured = pool
				.filter((item) => item.group === group && item.featured)
				.sort(byOrder);
			if (featured.length === 0) continue;
			const cap = BROWSE_CAP[group];
			total += featured.length;
			if (featured.length > cap) clipped = true;
			sections.push({
				group,
				items: featured.slice(0, cap).map((item) => ({
					item,
					score: 0,
					soft: item.tier === SOFT_TIER,
				})),
			});
		}
		return { sections, scope, terms: "", total, clipped };
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
	let clipped = false;
	for (const [group, matches] of ordered) {
		matches.sort((a, b) => b.score - a.score || byOrder(a.item, b.item));
		const cap = capFor(group);
		const room = Math.max(0, Math.min(cap, TOTAL_CAP - rendered));
		if (matches.length > room) clipped = true;
		if (room === 0) continue;
		sections.push({ group, items: matches.slice(0, room) });
		rendered += sections[sections.length - 1].items.length;
		if (rendered >= TOTAL_CAP) clipped = true;
	}

	return { sections, scope, terms, total, clipped };
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
		keywords: [
			"models",
			"llm",
			"openai",
			"anthropic",
			"google",
			"ollama",
			"model provider",
			"api provider",
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
	credentials: {
		icon: "credentials",
		keywords: ["api key", "api keys", "keys", "tokens", "secrets", "env"],
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
			hint: "Settings section",
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
 * Not `featured`: these are things a user asks for BY NAME ("usage", "info"),
 * and a browse list that also listed every reading the app can draw would be a
 * list of everything, which is a list of nothing. The gates live at the call
 * site (`use-palette-sources.ts`), because whether a panel can be opened is a
 * fact about the pane on screen, not about the row.
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
 */
export function buildChatItem(row: {
	session_id: string;
	title?: string | null;
	binding?: { agent: string | null; team: string | null } | null;
}): PaletteItem {
	const binding = row.binding?.team || row.binding?.agent || "";
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
