import assert from "node:assert/strict";
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
	matchQuality,
	normalizeText,
	PALETTE_GROUP_ORDER,
	parsePaletteQuery,
	SCOPE_LEGEND,
	searchPalette,
	SOFT_TIER,
	TOTAL_CAP,
} = module;

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
	{ id: "credentials", label: "API credentials" },
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
		"API credentials",
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

	// An agents scope admits the agent group and nothing else; this fixture has
	// no agents, so it is empty rather than falling back to everything.
	assert.deepEqual(groups(searchPalette({ items, raw: "@ada" })), []);
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

test("a panel row names the destination the chat pane presents", () => {
	const [row] = buildPanelItems(PANELS);
	/*
	 * The name of a PICKER DESTINATION, not a route: these panels live in the
	 * chat pane's presentation slot, which is why the palette asks for one
	 * instead of navigating to it.
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
