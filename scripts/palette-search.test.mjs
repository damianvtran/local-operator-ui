import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The command palette's search: what a query means, which rows it admits, and
 * in what order. Pure and synchronous, so it is exercised here in memory rather
 * than through a browser — this is deterministic state evidence about scopes,
 * ranking and the caps, which is the part of the palette a screenshot cannot
 * show.
 */
const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/command-palette/palette-search";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const module = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	buildActionItems,
	buildChatItem,
	buildNavigationItems,
	buildPanelItems,
	buildSettingKeyItems,
	buildSettingsSectionItems,
	AGENT_ROSTER_SEED,
	COMMAND_SCOPE_SEED,
	CONVERSATION_SWITCHER_SEED,
	matchQuality,
	normalizeText,
	paletteEmptyStateCopy,
	PALETTE_GROUP_ORDER,
	PALETTE_SECTION_TITLES,
	parsePaletteQuery,
	RECENTS_PIN_CAP,
	SCOPE_LEGEND,
	searchPalette,
	SOFT_TIER,
	TOTAL_CAP,
} = module;

/*
 * The source-anchor patterns, at module scope: a regex literal in a test body is
 * recompiled per call, and this file's other anchors are read the same way. The
 * anchor tests scan `use-palette-sources.ts` because the React hook it carries
 * cannot be mounted here.
 */
const RECENTS_JOIN_CALL =
	/chatRecentsOfRow\(\s*row,\s*conversationRecents,\s*displayedSessionId,\s*archiveEnabled,\s*archiveFacts,?\s*\)/;
/* The facts are read from the store, and are an input of the `chatItems` memo:
 * without the dependency the memo would not rebuild when an archive press settles
 * its fact, which is the whole of agent review round 2's R2-1. */
const ARCHIVE_FACTS_SELECTOR =
	/const archiveFacts = useCanonicalSessionsStore\(\s*\(state\) => state\.archiveFacts,?\s*\);/;
const ARCHIVE_FACTS_MEMO_DEPENDENCY =
	/archiveEnabled,\s*archiveFacts,?\s*\]\);/;
const ARCHIVE_CAPABILITY_GATE =
	/desktopFeatureEnabled\(\s*capabilities\.data,\s*"session_archive",\s*\)/;
const RECENTS_FIELDS_FROM_HELPER =
	/recentRank: recents\.recentRank,\s*current: recents\.current,\s*archived: recents\.archived,/;

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const PAGES = [
	{ id: "chat", name: "Chat", path: "/chat", icon: "chat" },
	{ id: "agents", name: "My agents", path: "/agents", icon: "agents" },
	{ id: "schedules", name: "Schedules", path: "/schedules", icon: "schedules" },
	{ id: "settings", name: "Settings", path: "/settings", icon: "settings" },
];

const SECTIONS = [
	{ id: "general", label: "General settings" },
	{ id: "appearance", label: "Appearance" },
];

const ACTIONS = [
	{
		id: "new-chat",
		name: "New chat",
		icon: "new-chat",
		keywords: ["start chat"],
		verb: "Start",
		command: "new-chat",
		featured: true,
	},
	{
		id: "clear-conversation",
		name: "Clear conversation",
		icon: "trash",
		keywords: ["delete chat", "clear history"],
		verb: "Clear",
		command: "clear-conversation",
		destructive: true,
		featured: true,
	},
];

const REGISTRY = [
	{
		key: "web_search.enabled",
		label: "Web search",
		section: "Tools",
		help: "Let the agent search the web.",
	},
	{
		key: "request_timeout",
		label: "Request timeout",
		section: "Requests",
		help: "Seconds before a request is abandoned.",
	},
];

const chat = (id, title, preview = "") =>
	buildChatItem({
		session_id: id,
		title,
		preview,
		binding: { agent: null, team: null },
	});

const items = [
	...buildNavigationItems(PAGES),
	...buildActionItems(ACTIONS),
	...buildSettingsSectionItems(SECTIONS),
	...buildSettingKeyItems(REGISTRY),
	chat("s1", "Retention analysis"),
	chat("s2", "Architect review"),
];

const groups = (outcome) => outcome.sections.map((section) => section.group);
const names = (outcome) =>
	outcome.sections.flatMap((section) =>
		section.items.map((match) => match.item.name),
	);
const find = (outcome, name) =>
	outcome.sections
		.flatMap((section) => section.items)
		.find((match) => match.item.name === name);

/* ------------------------------------------------------------------ *
 * Reading a query
 * ------------------------------------------------------------------ */

test("a scope glyph is read as a scope only at the start of the query", () => {
	assert.deepEqual(parsePaletteQuery("#retention"), {
		scope: "chat",
		terms: "retention",
	});
	assert.deepEqual(parsePaletteQuery(">settings"), {
		scope: "command",
		terms: "settings",
	});
	assert.deepEqual(parsePaletteQuery("@ada"), { scope: "agent", terms: "ada" });
	assert.deepEqual(parsePaletteQuery(",theme"), {
		scope: "setting",
		terms: "theme",
	});
	// A glyph in the middle is a character the user typed, not a scope.
	assert.deepEqual(parsePaletteQuery("retention #2"), {
		scope: null,
		terms: "retention #2",
	});
});

test("a scope word is read as a scope only as the first token, and only with terms after it", () => {
	assert.deepEqual(parsePaletteQuery("chats retention"), {
		scope: "chat",
		terms: "retention",
	});
	/*
	 * The mirror case, which is why the rule is positional rather than a filter:
	 * a user looking for a setting ABOUT settings means the word as a term.
	 */
	assert.deepEqual(parsePaletteQuery("theme settings"), {
		scope: null,
		terms: "theme settings",
	});
	/*
	 * And the case that decides the "and only with terms after it" half: `chat`
	 * on its own is the most obvious thing anyone would type into this palette,
	 * and eating it as a scope would answer it with an empty list.
	 */
	assert.deepEqual(parsePaletteQuery("chat"), { scope: null, terms: "chat" });
	assert.deepEqual(parsePaletteQuery("commands"), {
		scope: null,
		terms: "commands",
	});
	assert.deepEqual(parsePaletteQuery("commands settings"), {
		scope: "command",
		terms: "settings",
	});
});

test("an empty query has no scope and no terms", () => {
	assert.deepEqual(parsePaletteQuery("   "), { scope: null, terms: "" });
	assert.deepEqual(parsePaletteQuery("#"), { scope: "chat", terms: "" });
});

test("the legend teaches every glyph the parser accepts", () => {
	for (const entry of SCOPE_LEGEND) {
		assert.deepEqual(
			parsePaletteQuery(`${entry.glyph}term`).scope,
			entry.scope,
			`${entry.glyph} is taught but not parsed`,
		);
	}
});

/* ------------------------------------------------------------------ *
 * Matching
 * ------------------------------------------------------------------ */

test("normalising folds case, diacritics and separators", () => {
	assert.equal(normalizeText("Web_Search.Enabled"), "web search enabled");
	assert.equal(normalizeText("  Café  "), "cafe");
});

test("match tiers are ordered exact, prefix, substring, subsequence", () => {
	assert.equal(matchQuality("chat", "chat"), "exact");
	assert.equal(matchQuality("my agents", "age"), "prefix");
	assert.equal(matchQuality("retention", "tention"), "substring");
	assert.equal(matchQuality("retention analysis", "rta"), "subsequence");
	assert.equal(matchQuality("retention", "zzz"), null);
	// Below three characters there is no loose tier: a two-letter subsequence
	// matches almost every row, which is noise rather than softness.
	assert.equal(matchQuality("retention", "rt"), null);
});

/* ------------------------------------------------------------------ *
 * The browse layout
 * ------------------------------------------------------------------ */

test("an empty query browses, in group order, and leaves the registry out", () => {
	const outcome = searchPalette({ items, raw: "" });
	assert.deepEqual(groups(outcome), ["navigation", "actions", "settings"]);
	assert.deepEqual(names(outcome), [
		"Chat",
		"My agents",
		"Schedules",
		"Settings",
		"New chat",
		"Clear conversation",
		"General settings",
		"Appearance",
	]);
	/*
	 * The registry's keys are searchable but not browsable: seventy rows in the
	 * default list would bury everything else, and a key is only ever wanted by
	 * name.
	 */
	assert.equal(find(outcome, "Web search"), undefined);
});

test("the browse order is the constant the view renders from", () => {
	const outcome = searchPalette({ items, raw: "" });
	const rank = (group) => PALETTE_GROUP_ORDER.indexOf(group);
	const ranks = groups(outcome).map(rank);
	assert.deepEqual(
		ranks,
		[...ranks].sort((a, b) => a - b),
	);
});

test("clipped means the list dropped rows, not that a cap was consulted", () => {
	/*
	 * What the footer's "showing the best N of M" is built from, in the two states
	 * round 1 (R-3) got wrong: the flag was set by any branch that touched a cap,
	 * so a list that fitted exactly printed "showing the best 48 of 48".
	 */
	const fits = searchPalette({ items, raw: "" });
	assert.equal(
		fits.clipped,
		false,
		`everything fits: ${names(fits).join(", ")}`,
	);

	/*
	 * The exact fit itself: a scoped query whose two groups fill `TOTAL_CAP`
	 * precisely, twenty-four rows each. Every cap is consulted on the way and not
	 * one row is dropped, which is the case the old flag misreported.
	 */
	const pages = Array.from({ length: 24 }, (_, index) => ({
		id: `page-${index}`,
		name: `Retention page ${index}`,
		path: `/page-${index}`,
		icon: "chat",
	}));
	const commands = Array.from({ length: 24 }, (_, index) => ({
		id: `bulk-${index}`,
		name: `Retention action ${index}`,
		icon: "plus",
		keywords: [],
		command: "new-chat",
		verb: "Run",
	}));
	/*
	 * A query WITH terms, not a bare scope: a bare glyph browses, and the browse
	 * layout shows only featured rows. `>` puts both groups in the scope, whose
	 * cap is twenty-four each.
	 */
	const exactly = searchPalette({
		items: [...buildNavigationItems(pages), ...buildActionItems(commands)],
		raw: ">retention",
	});
	assert.equal(names(exactly).length, TOTAL_CAP);
	assert.equal(
		exactly.clipped,
		false,
		"nothing was dropped, so nothing is clipped",
	);

	// One row past the total is reported rather than silently missing.
	const doubled = [
		...pages,
		{
			id: "page-extra",
			name: "Retention page extra",
			path: "/page-x",
			icon: "chat",
		},
	];
	const over = searchPalette({
		items: [...buildNavigationItems(doubled), ...buildActionItems(commands)],
		raw: ">retention",
	});
	assert.equal(names(over).length, TOTAL_CAP);
	assert.equal(over.clipped, true);

	/*
	 * A group cap that bites with room left in the total: twelve matching actions
	 * against a group cap of six. A query rather than the browse list, because
	 * actions are browsable only when they are `featured`.
	 */
	const many = searchPalette({
		items: buildActionItems(
			Array.from({ length: 12 }, (_, index) => ({
				id: `many-${index}`,
				name: `Many action ${index}`,
				icon: "plus",
				keywords: [],
				command: "new-chat",
				verb: "Run",
			})),
		),
		raw: "many",
	});
	assert.equal(names(many).length, 6);
	assert.equal(many.clipped, true);
});

/* ------------------------------------------------------------------ *
 * The Unread pin (issue #760)
 * ------------------------------------------------------------------ */

/*
 * The pin's rows carry the two facts the app's source sets and the composition
 * reads: `featured` (what the browse layout draws — the app marks every chat
 * row so on an empty query) and `unread` (the store's `unreadMarkKind` answer,
 * decided at the source), with `order` as the catalogue's newest-first rank.
 */
const unreadChat = (id, title, order) => ({
	...chat(id, title),
	featured: true,
	unread: true,
	order,
});
const listedChat = (id, title, order) => ({
	...chat(id, title),
	featured: true,
	order,
});

test("the switcher pins an Unread section at the top, and its rows do not repeat below (issue #760)", () => {
	const outcome = searchPalette({
		items: [
			unreadChat("u1", "Retention follow-up", 0),
			listedChat("c1", "Architect review", 1),
			unreadChat("u2", "Weekly sync", 2),
		],
		raw: CONVERSATION_SWITCHER_SEED,
	});
	assert.equal(PALETTE_SECTION_TITLES.unread, "Unread");
	assert.deepEqual(groups(outcome), ["unread", "chats"]);
	/*
	 * The unread rows lead, in catalogue order; the chats tier keeps the rows
	 * the pin did not take. A row drawn twice — once pinned, once ranked —
	 * would be a duplicate id in the list and a second stop for one
	 * conversation, which is the failure this shape rules out.
	 */
	assert.deepEqual(names(outcome), [
		"Retention follow-up",
		"Weekly sync",
		"Architect review",
	]);
	assert.equal(outcome.clipped, false);
});

test("the pin orders unseen rows the way the chats tier does: catalogue order, newest first", () => {
	const outcome = searchPalette({
		items: [
			unreadChat("u-old", "Oldest", 2),
			unreadChat("u-new", "Newest", 0),
			unreadChat("u-mid", "Newer", 1),
		],
		raw: CONVERSATION_SWITCHER_SEED,
	});
	assert.deepEqual(
		outcome.sections[0].items.map((match) => match.item.name),
		["Newest", "Newer", "Oldest"],
	);
});

test("no unread rows means the switcher's browse list is the one it always was", () => {
	const outcome = searchPalette({
		items: [listedChat("c1", "Alpha", 0), listedChat("c2", "Beta", 1)],
		raw: CONVERSATION_SWITCHER_SEED,
	});
	assert.deepEqual(groups(outcome), ["chats"]);
	assert.deepEqual(names(outcome), ["Alpha", "Beta"]);
});

test("a typed query drops the pin; the row is found by search as always", () => {
	const outcome = searchPalette({
		items: [
			unreadChat("u1", "Retention follow-up", 0),
			listedChat("c1", "Architect review", 1),
		],
		raw: "#retention",
	});
	assert.ok(!groups(outcome).includes("unread"));
	assert.deepEqual(names(outcome), ["Retention follow-up"]);
});

test("the pin is the switcher's alone; the un-scoped browse is untouched", () => {
	/*
	 * Issue #760 leaves "switcher only, or both gestures" to design, and this
	 * pins the state the PR ships so the widening is a decision rather than a
	 * silent drift: an unread row still browses under Cmd/Ctrl+K, in its chats
	 * tier, with no Unread section above it.
	 */
	const outcome = searchPalette({
		items: [
			unreadChat("u1", "Retention follow-up", 0),
			listedChat("c1", "Alpha", 1),
		],
		raw: "",
	});
	assert.deepEqual(groups(outcome), ["chats"]);
	assert.deepEqual(names(outcome), ["Retention follow-up", "Alpha"]);
});

test("the pin draws from the same budget as the tiers, so rendered never passes TOTAL_CAP", () => {
	const items = [
		...Array.from({ length: 60 }, (_, index) =>
			unreadChat(
				`u${index}`,
				`Unread ${String(index).padStart(2, "0")}`,
				index,
			),
		),
		...Array.from({ length: 10 }, (_, index) =>
			listedChat(`c${index}`, `Listed ${index}`, 60 + index),
		),
	];
	const outcome = searchPalette({ items, raw: CONVERSATION_SWITCHER_SEED });
	const rendered = outcome.sections.reduce(
		(count, section) => count + section.items.length,
		0,
	);
	assert.equal(rendered, TOTAL_CAP);
	assert.ok(rendered <= TOTAL_CAP);
	/*
	 * `total` still counts every row the composition considered — the 60 unread
	 * and the 10 listed — so `clipped` ("the list dropped rows") is a true
	 * statement over the whole list, not just the tiers' share of it.
	 */
	assert.equal(outcome.total, 70);
	assert.equal(outcome.clipped, true);
	// The pin takes the whole budget here, so no tier can render.
	assert.deepEqual(groups(outcome), ["unread"]);
});

test("the tiers subtract what the pin drew instead of bypassing the cap", () => {
	const items = [
		...Array.from({ length: 46 }, (_, index) =>
			unreadChat(
				`u${index}`,
				`Unread ${String(index).padStart(2, "0")}`,
				index,
			),
		),
		...Array.from({ length: 10 }, (_, index) =>
			listedChat(`c${index}`, `Listed ${index}`, 46 + index),
		),
	];
	const outcome = searchPalette({ items, raw: CONVERSATION_SWITCHER_SEED });
	assert.deepEqual(groups(outcome), ["unread", "chats"]);
	assert.equal(outcome.sections[0].items.length, 46);
	// The chats tier's cap is five, but the running budget has two rows left.
	assert.equal(outcome.sections[1].items.length, 2);
	assert.deepEqual(
		outcome.sections[1].items.map((match) => match.item.name),
		["Listed 0", "Listed 1"],
	);
	assert.equal(
		outcome.sections.reduce(
			(count, section) => count + section.items.length,
			0,
		),
		TOTAL_CAP,
	);
	assert.equal(outcome.total, 56);
	assert.equal(outcome.clipped, true);
});

test("with everything shown, clipped stays false — it is not 'a cap was consulted'", () => {
	const outcome = searchPalette({
		items: [
			unreadChat("u1", "Alpha", 0),
			unreadChat("u2", "Beta", 1),
			listedChat("c1", "Gamma", 2),
		],
		raw: CONVERSATION_SWITCHER_SEED,
	});
	assert.equal(
		outcome.sections.reduce(
			(count, section) => count + section.items.length,
			0,
		),
		3,
	);
	assert.equal(outcome.total, 3);
	assert.equal(outcome.clipped, false);
});

/* ------------------------------------------------------------------ *
 * The Recents pin
 * ------------------------------------------------------------------ */

/*
 * A visited row carries `recentRank` (its index in the visited ring, 0 the most
 * recent) and, for the conversation on screen, `current` - both decided at the
 * source (`use-palette-sources.ts`) because this module is import-free. `order`
 * stays the catalogue's newest-first rank, so a rank and an order can disagree,
 * which is the point of the pin: it is ordered by VISIT, not by activity.
 */
const visitedChat = (id, title, order, recentRank, extra = {}) => ({
	...listedChat(id, title, order),
	recentRank,
	...extra,
});

test("the switcher pins Recents directly beneath Unread, above the Chats tier", () => {
	const outcome = searchPalette({
		items: [
			unreadChat("u1", "Unread one", 0),
			visitedChat("r1", "Visited one", 1, 0),
			listedChat("c1", "Never visited", 2),
		],
		raw: CONVERSATION_SWITCHER_SEED,
	});
	assert.equal(PALETTE_SECTION_TITLES.recents, "Recents");
	assert.deepEqual(groups(outcome), ["unread", "recents", "chats"]);
	assert.deepEqual(names(outcome), [
		"Unread one",
		"Visited one",
		"Never visited",
	]);
	assert.equal(outcome.clipped, false);
});

test("Recents follows the visited ring, not the catalogue's recency", () => {
	const outcome = searchPalette({
		items: [
			// Newest by activity, but visited longest ago.
			visitedChat("r-old", "Visited longest ago", 0, 2),
			visitedChat("r-new", "Visited last", 1, 0),
			visitedChat("r-mid", "Visited before that", 2, 1),
		],
		raw: CONVERSATION_SWITCHER_SEED,
	});
	assert.deepEqual(
		outcome.sections[0].items.map((match) => match.item.name),
		["Visited last", "Visited before that", "Visited longest ago"],
	);
});

test("no row appears twice across Unread, Recents and Chats", () => {
	const outcome = searchPalette({
		items: [
			// Unread AND visited: it lives in the Unread pin only.
			unreadChat("both", "Unread and visited", 0),
			visitedChat("r1", "Visited", 1, 1),
			listedChat("c1", "Plain", 2),
		].map((item) =>
			item.id === "chat-both" ? { ...item, recentRank: 0 } : item,
		),
		raw: CONVERSATION_SWITCHER_SEED,
	});
	const ids = outcome.sections.flatMap((section) =>
		section.items.map((match) => match.item.id),
	);
	assert.equal(new Set(ids).size, ids.length);
	assert.deepEqual(
		outcome.sections.map((section) => [
			section.group,
			section.items.map((match) => match.item.name),
		]),
		[
			["unread", ["Unread and visited"]],
			["recents", ["Visited"]],
			["chats", ["Plain"]],
		],
	);
});

test("the conversation on screen is left out of Recents, so the first row is the previous one", () => {
	const outcome = searchPalette({
		items: [
			visitedChat("here", "On screen", 0, 0, { current: true }),
			visitedChat("prev", "Previous", 1, 1),
		],
		raw: CONVERSATION_SWITCHER_SEED,
	});
	assert.deepEqual(groups(outcome), ["recents", "chats"]);
	assert.deepEqual(
		outcome.sections[0].items.map((match) => match.item.name),
		["Previous"],
	);
	// It is not lost: it is an ordinary row of the Chats tier.
	assert.deepEqual(
		outcome.sections[1].items.map((match) => match.item.name),
		["On screen"],
	);
});

test("an archived row in the ring is not claimed by the Recents pin (QA round 1, Q-1)", () => {
	/*
	 * The pin reads the row's OWN `archived` fact, set at the source with the
	 * sidebar's `visibleRows` rule (`chatRecentsOfRow`). The row CAN be in the
	 * browse pool - the join's empty-query arm applies no archive filter, which is
	 * pre-existing on both trees - so without this the pin claimed the very
	 * conversation the reader had just archived away (the base tree drew it under
	 * Chats; the ring keeping its id is by design, the pin drawing it is not).
	 */
	const outcome = searchPalette({
		items: [
			visitedChat("r-arch", "Archived visit", 0, 0, { archived: true }),
			visitedChat("r-live", "Live visit", 1, 1),
		],
		raw: CONVERSATION_SWITCHER_SEED,
	});
	assert.deepEqual(groups(outcome), ["recents", "chats"]);
	assert.deepEqual(
		outcome.sections[0].items.map((match) => match.item.name),
		["Live visit"],
	);
	// Not claimed - and not dropped either: it is an ordinary row of the Chats
	// tier, exactly what `current` does with the conversation on screen.
	assert.deepEqual(
		outcome.sections[1].items.map((match) => match.item.name),
		["Archived visit"],
	);
});

test("a row whose archived fact is false, or absent, is still claimed by Recents", () => {
	/*
	 * The predicate is `archived !== true`, not "has an `archived` field": a live
	 * row that states the fact false, and a row that says nothing about it, are both
	 * eligible - the same "absence is not a claim" rule the join applies to every
	 * other fact it reads.
	 */
	const outcome = searchPalette({
		items: [
			visitedChat("r-false", "Stated live", 0, 0, { archived: false }),
			visitedChat("r-silent", "Silent", 1, 1),
		],
		raw: CONVERSATION_SWITCHER_SEED,
	});
	assert.deepEqual(groups(outcome), ["recents"]);
	assert.deepEqual(
		outcome.sections[0].items.map((match) => match.item.name),
		["Stated live", "Silent"],
	);
});

test("Recents shows at most five rows, and the rest stay in the Chats tier exactly once", () => {
	assert.equal(RECENTS_PIN_CAP, 5);
	const outcome = searchPalette({
		items: Array.from({ length: 8 }, (_, index) =>
			visitedChat(`r${index}`, `Visited ${index}`, index, index),
		),
		raw: CONVERSATION_SWITCHER_SEED,
	});
	assert.deepEqual(groups(outcome), ["recents", "chats"]);
	assert.deepEqual(
		outcome.sections[0].items.map((match) => match.item.name),
		["Visited 0", "Visited 1", "Visited 2", "Visited 3", "Visited 4"],
	);
	// The pin claims only its five; the other three browse in their own tier.
	assert.deepEqual(
		outcome.sections[1].items.map((match) => match.item.name),
		["Visited 5", "Visited 6", "Visited 7"],
	);
	assert.equal(outcome.total, 8);
	assert.equal(outcome.clipped, false);
});

test("Recents is absent, with no empty heading, when no row carries a rank", () => {
	const outcome = searchPalette({
		items: [listedChat("c1", "Alpha", 0), listedChat("c2", "Beta", 1)],
		raw: CONVERSATION_SWITCHER_SEED,
	});
	assert.deepEqual(groups(outcome), ["chats"]);
	assert.deepEqual(names(outcome), ["Alpha", "Beta"]);
});

test("Recents is absent when the only ranked row is the one on screen", () => {
	const outcome = searchPalette({
		items: [
			visitedChat("here", "On screen", 0, 0, { current: true }),
			listedChat("c1", "Beta", 1),
		],
		raw: CONVERSATION_SWITCHER_SEED,
	});
	assert.deepEqual(groups(outcome), ["chats"]);
});

test("a typed query drops Recents, and the row is found by search as always", () => {
	const outcome = searchPalette({
		items: [visitedChat("r1", "Retention follow-up", 0, 0)],
		raw: "#retention",
	});
	assert.ok(!groups(outcome).includes("recents"));
	assert.deepEqual(names(outcome), ["Retention follow-up"]);
});

test("Recents is the switcher's alone; the un-scoped browse is untouched", () => {
	const outcome = searchPalette({
		items: [visitedChat("r1", "Visited", 0, 0), listedChat("c1", "Plain", 1)],
		raw: "",
	});
	assert.ok(!groups(outcome).includes("recents"));
	assert.deepEqual(names(outcome), ["Visited", "Plain"]);
});

test("Recents draws from the same budget as Unread and the tiers, with honest accounting", () => {
	const outcome = searchPalette({
		items: [
			...Array.from({ length: 46 }, (_, index) =>
				unreadChat(`u${index}`, `Unread ${index}`, index),
			),
			...Array.from({ length: 5 }, (_, index) =>
				visitedChat(`r${index}`, `Visited ${index}`, 46 + index, index),
			),
			...Array.from({ length: 4 }, (_, index) =>
				listedChat(`c${index}`, `Listed ${index}`, 51 + index),
			),
		],
		raw: CONVERSATION_SWITCHER_SEED,
	});
	// 46 unread leave two rows of budget: Recents gets them, the Chats tier none.
	assert.deepEqual(groups(outcome), ["unread", "recents"]);
	assert.deepEqual(
		outcome.sections[1].items.map((match) => match.item.name),
		["Visited 0", "Visited 1"],
	);
	assert.equal(
		outcome.sections.reduce(
			(count, section) => count + section.items.length,
			0,
		),
		TOTAL_CAP,
	);
	// 46 + 5 claimed by the pins + 4 left for the tier: every row considered.
	assert.equal(outcome.total, 55);
	assert.equal(outcome.clipped, true);
	// A claimed-but-undrawn Recents row does not reappear as a Chats duplicate.
	const ids = outcome.sections.flatMap((section) =>
		section.items.map((match) => match.item.id),
	);
	assert.equal(new Set(ids).size, ids.length);
});

test("a full Unread pin leaves Recents nothing to draw, and its rows are not duplicated below", () => {
	const outcome = searchPalette({
		items: [
			...Array.from({ length: 48 }, (_, index) =>
				unreadChat(`u${index}`, `Unread ${index}`, index),
			),
			visitedChat("r0", "Visited 0", 48, 0),
			listedChat("c0", "Listed 0", 49),
		],
		raw: CONVERSATION_SWITCHER_SEED,
	});
	assert.deepEqual(groups(outcome), ["unread"]);
	assert.equal(outcome.total, 50);
	assert.equal(outcome.clipped, true);
});

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

test("groups are ordered by their best row, not by the browse order", () => {
	const action = buildActionItems([
		{
			id: "retention-report",
			name: "Retention settings",
			icon: "plus",
			keywords: [],
			verb: "Run",
			command: "create-agent",
		},
	])[0];
	/*
	 * A row nothing but its own help text answers: the weakest way into the list,
	 * so its group has to come last however the groups are ordered by name.
	 */
	const softSetting = buildSettingKeyItems([
		{
			key: "retention_log",
			label: "Notes",
			section: "Tools",
			help: "Keeps a retention log.",
		},
	])[0];
	const outcome = searchPalette({
		items: [action, softSetting, chat("s1", "Retention")],
		raw: "retention",
	});
	/*
	 * The name IS the query, which is the strongest answer there is; the action's
	 * name merely starts with it; the registry row only mentions it in its help.
	 * The group order (chats, actions, settings) is therefore SCORE order, which
	 * happens to differ from `PALETTE_GROUP_ORDER`, and that difference is the
	 * point: the answer to the question leads the list.
	 */
	assert.deepEqual(groups(outcome), ["chats", "actions", "settings"]);
});

test("every token has to match, so a second word narrows", () => {
	const broad = searchPalette({ items, raw: "web" });
	assert.ok(names(broad).includes("Web search"));
	const narrow = searchPalette({ items, raw: "web enabled" });
	assert.deepEqual(names(narrow), ["Web search"]);
});

test("a soft match is admitted and marked", () => {
	const outcome = searchPalette({ items, raw: "rta" });
	const match = find(outcome, "Retention analysis");
	assert.ok(match, "a subsequence match is still an answer");
	assert.equal(match.soft, true, "and it says so");
});

test("a scope narrows which sources answer at all", () => {
	const chats = searchPalette({ items, raw: "#retention" });
	assert.deepEqual(groups(chats), ["chats"]);

	const commands = searchPalette({ items, raw: ">set" });
	// The command scope admits destinations and actions, so the settings GROUP is
	// not allowed to answer even though its rows mention the word.
	assert.deepEqual(groups(commands), ["navigation"]);
	assert.deepEqual(names(commands), ["Settings"]);

	const settings = searchPalette({ items, raw: ",settings" });
	assert.deepEqual(groups(settings), ["settings"]);

	// An agents scope admits the agent and team groups and nothing else; this
	// fixture has neither, so it is empty rather than falling back to everything.
	assert.deepEqual(groups(searchPalette({ items, raw: "@ada" })), []);
});

test("the conversation switcher's seed opens on the chats scope", () => {
	/*
	 * `Cmd/Ctrl+K` opens the palette with `CONVERSATION_SWITCHER_SEED` (issue
	 * #850 moved it there from Cmd/Ctrl+P, which now opens EVERYTHING), so this
	 * pins what the seed MEANS rather than which chord writes it: the chat scope
	 * with no terms, i.e. the conversations source and nothing else. A drift in
	 * either direction is silent - the door would become a second copy of the
	 * palette's browse list, or a scope that admits rows from groups the switcher
	 * has no answer for.
	 */
	assert.equal(CONVERSATION_SWITCHER_SEED, "#");
	assert.deepEqual(parsePaletteQuery(CONVERSATION_SWITCHER_SEED), {
		scope: "chat",
		terms: "",
	});
	/*
	 * At the list level that is the conversations source alone. The fixture's
	 * chat rows are made `featured` here because the browse layout is built
	 * from featured rows and the app's own source marks them so when no terms
	 * are present (`use-palette-sources.ts`) - a story the fixture has no
	 * reason to relitigate.
	 */
	const outcome = searchPalette({
		items: items.map((item) =>
			item.group === "chats" ? { ...item, featured: true } : item,
		),
		raw: CONVERSATION_SWITCHER_SEED,
	});
	assert.deepEqual(groups(outcome), ["chats"]);
	assert.ok(
		names(outcome).length > 0,
		"the scope shows conversations, not nothing",
	);
});

/*
 * THE AGENT JUMP'S SEED (issue #663): the chat sidebar's band control opens the
 * palette with `AGENT_ROSTER_SEED`, so this pins what that seed MEANS for the
 * same reason the switcher's own test above pins its label: a drift in the
 * glyph or the table is silent, and the control would stop being the roster's
 * door without a single test going red.
 */
test("the sidebar's agent jump seed opens on the agents scope", () => {
	assert.equal(AGENT_ROSTER_SEED, "@");
	assert.deepEqual(parsePaletteQuery(AGENT_ROSTER_SEED), {
		scope: "agent",
		terms: "",
	});
	/*
	 * At the list level that is the agents group and nothing else: the fixture
	 * gains one agent row, shaped the way the app's own source builds them
	 * (`use-palette-sources.ts`), and the outcome must be the agents group
	 * drawing that row. The plain `@ada` case above already proves the
	 * negative half - an agents scope cannot fall back to another group.
	 */
	const outcome = searchPalette({
		items: [
			...items,
			{
				id: "agent-chat-ledger-auditor",
				kind: "agent",
				group: "agents",
				name: "ledger-auditor",
				hint: "Agent chat",
				icon: "agents",
				// Featured for the reason the switcher's own rows are, one test up:
				// with no terms the palette draws the BROWSE layout, which is built
				// from featured rows, and the app's source marks its agent chat rows
				// exactly so when the query is empty (`use-palette-sources.ts`).
				featured: true,
				/*
				 * Shaped the way the app builds it since issue #844: the agent row's target
				 * is the DRAFT door, not `/chat/<id>` - that path had no non-session
				 * fallback in the store, so it always landed on the legacy-link notice.
				 */
				target: { type: "draft", kind: "agent", name: "ledger-auditor" },
			},
		],
		raw: AGENT_ROSTER_SEED,
	});
	assert.deepEqual(groups(outcome), ["agents"]);
	assert.ok(
		names(outcome).includes("ledger-auditor"),
		"the scope shows the roster, not nothing",
	);
});

test("the commands seed opens on the command scope", () => {
	/*
	 * `Cmd/Ctrl+Shift+P` opens the palette with `COMMAND_SCOPE_SEED` (issue #850),
	 * the THIRD door. Pinned the same way its two siblings are: what the seed
	 * MEANS, not where it is spelled. The commands door is "show me what the app
	 * can do", so a drift to any other glyph would make it a third copy of a door
	 * that already exists.
	 */
	assert.equal(COMMAND_SCOPE_SEED, ">");
	assert.deepEqual(parsePaletteQuery(COMMAND_SCOPE_SEED), {
		scope: "command",
		terms: "",
	});
});

test("teams live under the agent scope, and nowhere else (issue #849)", () => {
	/*
	 * Teams are the roster's second entity class, so `@` admits the `teams` group
	 * beside `agents` — and the team WORDS scope to the agent scope rather than to
	 * a fifth prefix. Both halves are pinned here because either one alone would
	 * leave `@delivery` (or the word "team") quietly answering nothing.
	 */
	assert.deepEqual(parsePaletteQuery("@delivery"), {
		scope: "agent",
		terms: "delivery",
	});
	assert.deepEqual(parsePaletteQuery("team delivery"), {
		scope: "agent",
		terms: "delivery",
	});
	assert.deepEqual(parsePaletteQuery("teams"), {
		scope: null,
		terms: "teams",
	});
	/*
	 * The legend teaches ONE glyph for both entity classes, and the label says so:
	 * a reader who met `@` as "agents" must be told teams are under it too, or the
	 * roster's second half is undiscoverable.
	 */
	const agentEntry = SCOPE_LEGEND.find((entry) => entry.scope === "agent");
	assert.ok(agentEntry, "the agent scope is in the legend");
	assert.equal(agentEntry.label, "Agents and teams");
	/*
	 * At the list level: a fixture carrying one agent row and one team row answers
	 * `@` with BOTH groups, which is the whole change — the browse list a teammate
	 * sees and the one an agent's owner sees are the same list.
	 */
	const outcome = searchPalette({
		items: [
			{
				id: "agent-chat-ledger-auditor",
				kind: "agent",
				group: "agents",
				name: "ledger-auditor",
				hint: "Agent chat",
				icon: "agents",
				featured: true,
				target: { type: "draft", kind: "agent", name: "ledger-auditor" },
			},
			{
				id: "team-chat-delivery",
				kind: "team",
				group: "teams",
				// The row READS the display label while the draft is keyed by the slug.
				name: "Delivery crew",
				hint: "Team chat",
				icon: "team",
				keywords: ["delivery"],
				featured: true,
				target: { type: "draft", kind: "team", name: "delivery" },
			},
		],
		raw: AGENT_ROSTER_SEED,
	});
	assert.deepEqual(groups(outcome), ["agents", "teams"]);
	assert.deepEqual(names(outcome), ["ledger-auditor", "Delivery crew"]);
	/*
	 * And the other scopes do NOT admit teams: `#` is conversations and `>` is
	 * commands, so a team row there would be a row the scope has no answer for.
	 */
	assert.ok(
		!groups(searchPalette({ items, raw: "#ledger" })).includes("teams"),
	);
	assert.ok(
		!groups(searchPalette({ items, raw: ">ledger" })).includes("teams"),
	);
});

test("aliases are how the app's vocabulary meets the user's", () => {
	const outcome = searchPalette({ items, raw: "theme" });
	/*
	 * "theme" is not a word anywhere in the settings rail, and the row it has to
	 * find is called Appearance. That is the whole job of the alias table: people
	 * search with the words they use for the thing, not with the app's label for
	 * it.
	 */
	assert.deepEqual(names(outcome), ["Appearance"]);
	assert.ok(
		names(searchPalette({ items, raw: "delete chat" })).includes(
			"Clear conversation",
		),
	);
});

test("the api-key vocabulary survives the credentials section's removal", () => {
	/*
	 * The plain-text credentials section was this app's only owner of the words
	 * "api key", "keys" and "tokens", and deleting the SECTION deleted its alias
	 * row with it — so a user typing "api key" got zero matches for the app's own
	 * API-key surface (design/UX round 1, U3). The vocabulary moved onto the
	 * Providers row, which is the surface those words now name (its rows read
	 * "Sign in or API key" and carry an API-key tab). This test is the guard
	 * that the move happened: it searches the words a user would type and
	 * requires the Providers section to answer.
	 *
	 * The row is built by the SHIPPED builder with the real section list this
	 * change ships (`providers` in the rail), so the aliases are read from the
	 * product's own meta table rather than restated here.
	 */
	const sections = [
		{ id: "general", label: "General settings" },
		{ id: "providers", label: "Providers" },
	];
	const provItems = buildSettingsSectionItems(sections);
	for (const query of ["api key", "api keys", "keys", "tokens"]) {
		assert.ok(
			names(searchPalette({ items: provItems, raw: query })).includes(
				"Providers",
			),
			`the palette's "${query}" finds no Providers row, so the api-key vocabulary lost its home with the credentials section`,
		);
	}
});

test("the registry's own spelling of a key finds its row", () => {
	const outcome = searchPalette({ items, raw: "web_search" });
	assert.deepEqual(names(outcome), ["Web search"]);
});

/* ------------------------------------------------------------------ *
 * Ranking
 * ------------------------------------------------------------------ */

test("a row the STORE matched is admitted even when nothing local does", () => {
	const remote = {
		...chat("s2", "Sprint notes"),
		tier: 2,
		hint: "In conversation",
	};
	const outcome = searchPalette({ items: [remote], raw: "retention" });
	/*
	 * The whole point of searching the store: a conversation whose body mentions
	 * the queue is an answer even though its title and its catalogue preview share
	 * nothing with the query. Nothing in the renderer can see that, so the tier is
	 * what admits it.
	 */
	assert.deepEqual(names(outcome), ["Sprint notes"]);
	assert.equal(find(outcome, "Sprint notes").soft, false);
});

test("a name match outranks a body match, as the sidebar orders them", () => {
	const local = chat("s1", "Retention analysis");
	const remote = { ...chat("s2", "Sprint notes"), tier: 2 };
	const outcome = searchPalette({ items: [local, remote], raw: "retention" });
	/*
	 * Both are real answers, and the order between them is the store's own tier
	 * order rather than this module's invention: a visible name match beats a row
	 * whose content mentioned the word, which is exactly how the sidebar ranks the
	 * same two rows.
	 */
	assert.deepEqual(names(outcome), ["Retention analysis", "Sprint notes"]);
});

test("the backend's soft tier marks its row the way a loose match does", () => {
	const soft = { ...chat("s2", "Sprint notes"), tier: SOFT_TIER };
	const outcome = searchPalette({ items: [soft], raw: "retention" });
	assert.equal(find(outcome, "Sprint notes").soft, true);
});

test("a row with no tier and no local match is refused", () => {
	/*
	 * The default path, and the one that keeps the list honest: nothing about a
	 * conversation's own row admits it on its own — a title that shares no word
	 * with the query and no store answer saying the content does is simply not an
	 * answer.
	 */
	assert.deepEqual(
		searchPalette({ items: [chat("s2", "Sprint notes")], raw: "retention" })
			.sections,
		[],
	);
});

test("a name that IS the query beats one that merely contains it", () => {
	const outcome = searchPalette({
		items: [chat("s1", "Chat"), chat("s2", "Chat with the architect")],
		raw: "chat",
	});
	assert.equal(names(outcome)[0], "Chat");
});

/* ------------------------------------------------------------------ *
 * Caps
 * ------------------------------------------------------------------ */

test("a group is capped, and a scoped query gives that group more room", () => {
	const many = Array.from({ length: 30 }, (_, index) =>
		chat(`s${index}`, `Retention note ${index}`),
	);
	const unscoped = searchPalette({ items: many, raw: "retention" });
	assert.equal(unscoped.sections[0].items.length, 6);
	assert.equal(unscoped.clipped, true);

	const scoped = searchPalette({ items: many, raw: "#retention" });
	assert.ok(
		scoped.sections[0].items.length > 6,
		"a scope is the user saying which source they mean",
	);
});

test("the whole list is bounded, whatever the query", () => {
	const many = [
		...Array.from({ length: 40 }, (_, index) =>
			chat(`s${index}`, `Alpha ${index}`),
		),
		...Array.from({ length: 40 }, (_, index) =>
			chat(`t${index}`, `Alpha beta ${index}`),
		),
	];
	const outcome = searchPalette({ items: many, raw: "alpha" });
	const rendered = outcome.sections.reduce(
		(total, section) => total + section.items.length,
		0,
	);
	assert.ok(rendered <= TOTAL_CAP);
	// The cap is reported rather than silent, so the legend can say so.
	assert.equal(outcome.clipped, true);
});

test("total counts what matched, not what was rendered", () => {
	const many = Array.from({ length: 30 }, (_, index) =>
		chat(`s${index}`, `Zeta ${index}`),
	);
	const outcome = searchPalette({ items: many, raw: "zeta" });
	assert.equal(outcome.total, 30);
	assert.equal(outcome.sections[0].items.length, 6);
});

/* ------------------------------------------------------------------ *
 * What a row carries
 * ------------------------------------------------------------------ */

test("a chat row opens its session and says which agent owns it", () => {
	const row = buildChatItem({
		session_id: "abc",
		title: "  Retention  ",
		binding: { agent: "Architect", team: null },
	});
	assert.deepEqual(row.target, { type: "session", sessionId: "abc" });
	assert.equal(row.name, "Retention");
	assert.equal(row.hint, "Architect");
});

test("a labelled team's hint reads as its label; the slug is the fallback", () => {
	/*
	 * The binding hint is human text, so a TEAM resolved through the map the
	 * palette hook builds from the team catalogue reads as its label; a slug
	 * the map does not hold, or a caller with no map at all (the capability is
	 * off, the list is still landing), keeps the pre-labels string. An AGENT
	 * binding never consults the map.
	 */
	const labels = new Map([["lopdev", "Local Operator Dev"]]);
	assert.equal(
		buildChatItem(
			{ session_id: "s1", binding: { agent: null, team: "lopdev" } },
			labels,
		).hint,
		"Local Operator Dev",
	);
	assert.equal(
		buildChatItem(
			{ session_id: "s2", binding: { agent: null, team: "minerva" } },
			labels,
		).hint,
		"minerva",
	);
	assert.equal(
		buildChatItem({
			session_id: "s3",
			binding: { agent: null, team: "lopdev" },
		}).hint,
		"lopdev",
	);
	assert.equal(
		buildChatItem(
			{ session_id: "s4", binding: { agent: "coder", team: null } },
			labels,
		).hint,
		"coder",
	);
});

test("an untitled conversation still has a name", () => {
	assert.equal(
		buildChatItem({ session_id: "abc", title: "  " }).name,
		"Untitled chat",
	);
});

test("a registry row deep-links to its own key", () => {
	const [row] = buildSettingKeyItems([
		{
			key: "web_search.enabled",
			label: "Web search",
			section: "Tools",
			help: "",
		},
	]);
	assert.equal(row.target.type, "path");
	assert.equal(row.target.path, "/settings?setting=web_search.enabled");
	assert.equal(row.hint, "Tools");
});

test("the palette's registry rows are PRESENTED with the desktop's copy (agent review round 1, F4)", () => {
	/*
	 * An anchor, not a driven case: the settings source is a React hook this
	 * harness cannot mount. What CAN be pinned is the call itself - the rows are
	 * folded through `presentSetting` before they are built, the same fold the
	 * settings page's row list and search apply. Without it the palette showed
	 * and searched the registry's terminal copy ("Delegated cleanup", the "↳"
	 * child idiom) while the page showed the desktop's copy, so the two surfaces
	 * disagreed about a setting's own name and the page's search reach (agent
	 * review round 1, F4).
	 */
	const source = readFileSync(
		"src/renderer/src/features/command-palette/use-palette-sources.ts",
		"utf8",
	);
	assert.match(
		source,
		/buildSettingKeyItems\(\s*\(registry\.data\?\.settings \?\? \[\]\)\.map\(presentSetting\)/,
		"the palette's key rows must be presented before they are built",
	);
	assert.match(
		source,
		/import \{ presentSetting \} from "@features\/settings\/backend-setting-copy"/,
		"and the fold must be the settings page's own, not a re-implementation",
	);
});

test("a settings section deep-links to its own section", () => {
	const [row] = buildSettingsSectionItems([
		{ id: "appearance", label: "Appearance" },
	]);
	assert.equal(row.target.path, "/settings?section=appearance");
	// The alias table is keyed by id, so an unknown section still renders and
	// still matches on its own label.
	const [unknown] = buildSettingsSectionItems([
		{ id: "brand-new", label: "Brand new" },
	]);
	assert.equal(unknown.name, "Brand new");
	assert.equal(unknown.icon, "settings");
});

test("an action carries the verb Enter will show", () => {
	const [row] = buildActionItems(ACTIONS);
	assert.equal(row.verb, "Start");
	assert.equal(row.target.command, "new-chat");
});

/* ------------------------------------------------------------------ *
 * Panels
 * ------------------------------------------------------------------ */

const PANELS = [
	{
		id: "info",
		destination: "info",
		name: "Info",
		hint: "App, backend and environment",
		icon: "info",
		keywords: ["about", "version"],
	},
	{
		id: "usage",
		destination: "usage",
		name: "Provider usage",
		hint: "Credits, limits and spend",
		icon: "usage",
		keywords: ["credits", "billing", "limits"],
	},
];

test("a panel row names the destination a HOST presents", () => {
	const [row] = buildPanelItems(PANELS);
	/*
	 * The name of a PICKER DESTINATION, not a route: a panel is presented from a
	 * presentation slot rather than navigated to, which is why the palette asks for
	 * one instead. WHICH slot depends on the destination, and the row says nothing
	 * about that on purpose — a session-scoped panel is the chat pane's, and these
	 * machine panels have a shell host as well (`panel-outlet.tsx`), so the palette
	 * writes the request and moves the route only when the destination needs a pane
	 * to be presented at all (`command-palette.tsx`).
	 */
	assert.deepEqual(row.target, { type: "panel", destination: "info" });
	assert.equal(row.group, "panels");
	assert.equal(row.verb, "Open");
	/*
	 * Featured, so the group is browsable: a panel is a place a user may not know
	 * exists, unlike a registry key, which is only ever wanted by name (UX round 1,
	 * U6). The call site decides whether the rows exist at all.
	 */
	assert.equal(row.featured, true);
});

test("panels answer to the command scope, so >usage finds one", () => {
	const scoped = searchPalette({
		items: [...buildPanelItems(PANELS), ...buildNavigationItems(PAGES)],
		raw: ">usage",
	});
	assert.deepEqual(names(scoped), ["Provider usage"]);
	assert.deepEqual(groups(scoped), ["panels"]);
});

test("a panel is found by what it shows, not only by its name", () => {
	const outcome = searchPalette({
		items: buildPanelItems(PANELS),
		raw: "credits",
	});
	assert.deepEqual(names(outcome), ["Provider usage"]);
});

test("the palette's join is given the same tombstone view the sidebar's is (agent review round 2, R2-2)", () => {
	/*
	 * THE INVARIANT THIS PINS IS THE MODULE'S OWN SENTENCE. `palette-search.ts` says
	 * the palette is "built from the sidebar's own join (`searchChats`) so the palette
	 * and the sidebar cannot disagree about which conversations a query matches", and
	 * the call site broke it in exactly one way: `use-palette-sources.ts` called
	 * `searchChats(sessions, terms, hits)` - no archive view - while the sidebar passes
	 * `archiveView`. A hit for a conversation this window had PERMANENTLY DELETED is
	 * rebuilt by the join into a synthesized row, so the palette offered a clickable
	 * row that opens onto the deleted conversation's notice. The hits come from the
	 * same `useChatSearch` cache (same 30 s key), so the two surfaces disagreed for as
	 * long as that answer lived.
	 *
	 * Read as an anchor rather than driven, because the call site is a React hook and
	 * this repository's harness has no DOM: what can be pinned here without a renderer
	 * is that the argument is passed at all and that it carries the tombstones - the
	 * half that was missing. The join's own behaviour with a `forgotten` set is
	 * asserted in `chat-search.test.mjs`, against the shipped module.
	 */
	const source = readFileSync(
		"src/renderer/src/features/command-palette/use-palette-sources.ts",
		"utf8",
	);
	assert.match(
		source,
		/searchChats\(sessions, terms, hits, \{\}, archiveView\)/,
		"the palette's join must be given the same view the sidebar's is",
	);
	assert.match(source, /forgotten: new Set\(Object\.keys\(forgotten\)\)/);
	assert.match(source, /state\.forgotten\)/);
});

test("the Recents pin's row facts come from the one tested helper, over the sidebar's archive gate (agent review round 1, R1-1; QA round 1, Q-1)", () => {
	/*
	 * The source hook is a React module this node harness cannot mount, so the
	 * half that CAN be pinned is that the seam exists rather than being re-derived
	 * inline: the memo calls `chatRecentsOfRow` - whose in-ring/not, duplicate,
	 * current and archived cases are exercised for real in
	 * `scripts/palette-recents.test.mjs` - and the archive fact is read from the
	 * same capability the sidebar's own list reads.
	 */
	const source = readFileSync(
		"src/renderer/src/features/command-palette/use-palette-sources.ts",
		"utf8",
	);
	assert.match(
		source,
		RECENTS_JOIN_CALL,
		"the row-to-ring join must go through the tested helper, over the archive gate",
	);
	assert.match(
		source,
		ARCHIVE_CAPABILITY_GATE,
		"the archive fact must come from the sidebar's own capability",
	);
	assert.match(source, RECENTS_FIELDS_FROM_HELPER);
	assert.match(
		source,
		ARCHIVE_FACTS_SELECTOR,
		"the answered archive facts must be read from the store, as the sidebar reads them",
	);
	assert.match(
		source,
		ARCHIVE_FACTS_MEMO_DEPENDENCY,
		"the facts must be a dependency of the chatItems memo, or a settled press never rebuilds it",
	);
});

/* ------------------------------------------------------------------ *
 * The empty state's copy table (design round 2, D2/U4)
 * ------------------------------------------------------------------ */

test("the chats scope names conversations, and never claims an empty account while loading", () => {
	/*
	 * The two states that land on the Cmd/Ctrl+P door's empty list. `loading`
	 * is the cold open before the catalogue answers — the one the old copy
	 * spent the frame misstating as "nothing to show" — and `empty` is the
	 * account with no conversations, which may only be claimed once the
	 * request is not out.
	 */
	assert.deepEqual(
		paletteEmptyStateCopy({
			scope: "chat",
			hasTerms: false,
			terms: "",
			awaiting: false,
			catalogue: "loading",
		}),
		{ line: "Loading conversations…", hint: null },
	);
	const empty = {
		line: "No conversations yet",
		hint: "Start a chat and it will show up here.",
	};
	assert.deepEqual(
		paletteEmptyStateCopy({
			scope: "chat",
			hasTerms: false,
			terms: "",
			awaiting: false,
			catalogue: "empty",
		}),
		empty,
	);
	/* `loaded` with no rows is reachable in exactly one way - every stored
	 * conversation hidden by the archive view - and says the same thing as a
	 * truly empty account, because to this surface it is the same thing. */
	assert.deepEqual(
		paletteEmptyStateCopy({
			scope: "chat",
			hasTerms: false,
			terms: "",
			awaiting: false,
			catalogue: "loaded",
		}),
		empty,
	);
});

test("a scoped no-match teaches backspacing the glyph, never the prefix advice", () => {
	const chats = paletteEmptyStateCopy({
		scope: "chat",
		hasTerms: true,
		terms: "retention",
		awaiting: false,
		catalogue: "loaded",
	});
	assert.equal(chats.line, "No matches for “retention”");
	assert.equal(
		chats.hint,
		"Try another word, or backspace # to search everything.",
	);
	/* The glyph is the scope's own, read from the same legend the parser and
	 * the footer use: no second spelling of a prefix. */
	const agents = paletteEmptyStateCopy({
		scope: "agent",
		hasTerms: true,
		terms: "x",
		awaiting: false,
		catalogue: "loaded",
	});
	assert.equal(
		agents.hint,
		"Try another word, or backspace @ to search everything.",
	);
});

test("the unscoped empty state names the roster, and a search in flight says what it is doing", () => {
	assert.deepEqual(
		paletteEmptyStateCopy({
			scope: null,
			hasTerms: true,
			terms: "zzz",
			awaiting: false,
			catalogue: "loaded",
		}),
		{
			line: "No matches for “zzz”",
			hint: "Try another word, or narrow the search with a prefix below.",
		},
	);
	assert.deepEqual(
		paletteEmptyStateCopy({
			scope: null,
			hasTerms: false,
			terms: "",
			awaiting: false,
			catalogue: "loading",
		}),
		{
			line: "Nothing to show yet",
			hint: "Search for a chat, an agent or team by name, a setting, or a page such as Schedules.",
		},
	);
	/* No hint while the request is out: advice to "try another word" is advice
	 * about an answer nobody has seen yet. */
	assert.deepEqual(
		paletteEmptyStateCopy({
			scope: "chat",
			hasTerms: true,
			terms: "retention",
			awaiting: true,
			catalogue: "loaded",
		}),
		{ line: "Searching conversations…", hint: null },
	);
});

test("the panel renders the copy table, not a second set of sentences", () => {
	/*
	 * An anchor rather than a render, for the reason the tombstone cell above
	 * states: the call site is a component this harness cannot mount, so what
	 * can be pinned without a renderer is that the sentences come from the
	 * table (whose cells are asserted above) instead of being re-spelled in
	 * the JSX — the drift that let the old empty state name agents and
	 * settings inside a chats-only scope.
	 */
	const source = readFileSync(
		"src/renderer/src/features/command-palette/components/command-palette.tsx",
		"utf8",
	);
	assert.match(source, /paletteEmptyStateCopy\(\{/);
	assert.match(source, /\{emptyCopy\.line\}/);
	assert.match(source, /\{emptyCopy\.hint !== null &&/);
});
