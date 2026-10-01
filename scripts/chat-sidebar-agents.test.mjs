/**
 * The Agents roster's rules: the filter, the order, the pin and the usage join.
 *
 *     node --test scripts/chat-sidebar-agents.test.mjs
 *
 * WHY THIS FILE EXISTS (issue #663): the Agents section is the only path to a
 * standalone agent, and a roster that grows turns "one disclosure per agent,
 * scanned by hand" into friction. The three additions - a roster filter, a pin
 * held at the top, and most-recently-used ordering - are DECISIONS, and the
 * decisions live in `chat-sidebar-agents.ts` rather than in the sidebar's JSX
 * for the reason `chat-list-sections.ts` states in full: the sidebar cannot be
 * rendered by this repository's `node:test` suite, so a rule written as a JSX
 * condition is a rule no test can reach. Each test below FAILS when its rule is
 * broken, which is the point of driving the module instead of describing it.
 *
 * WHAT IT CANNOT SAY: that the field, the pin and the order LOOK right. That is
 * the frames' job (`docs/evidence/chat-sidebar-agents/`, and the story's own
 * scenes).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const ROOT = process.cwd();

/*
 * No zustand and no `localStorage` shim: unlike the view suite next door, these
 * two modules import the store nowhere at runtime - the canonical row and the
 * `SidebarView` they read are `import type`s, erased before esbuild ever sees
 * them - so the bundle is pure and loads in node as-is.
 */
const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/chat/chat-sidebar-agents";',
			'export * from "./src/renderer/src/features/chat/chat-sidebar-view";',
		].join("\n"),
		resolveDir: ROOT,
		loader: "ts",
	},
	alias: {
		"@features": `${ROOT}/src/renderer/src/features`,
		"@shared": `${ROOT}/src/renderer/src/shared`,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});

const {
	PINNED_AGENTS_MAX,
	agentRecencyMs,
	filterAgentRows,
	orderAgentRows,
	togglePinnedAgent,
	parseSidebarView,
	DEFAULT_SIDEBAR_VIEW,
} = await import(
	`data:text/javascript;base64,${Buffer.from(
		bundle.outputFiles[0].text,
	).toString("base64")}`
);

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

/** One roster row, with only the fields the rules read. */
const row = (name, over = {}) => ({ id: name, name, ...over });

/** One canonical session row, with only the fields the join reads. */
const session = (agent, at, over = {}) => ({
	session_id: `${agent}-${at}`,
	updated_at: at,
	binding: { agent, team: null },
	...over,
});

/* ------------------------------------------------------------------ *
 * The filter
 * ------------------------------------------------------------------ */

test("the filter matches the name case-insensitively, as a substring", () => {
	const rows = [row("coder"), row("Reviewer"), row("architect")];
	assert.deepEqual(
		filterAgentRows(rows, "REV").map((entry) => entry.name),
		["Reviewer"],
	);
	assert.deepEqual(
		filterAgentRows(rows, "ect").map((entry) => entry.name),
		["architect"],
		"a substring, not a prefix",
	);
});

test("the filter matches a tag, and a blank query admits every row", () => {
	const rows = [
		row("coder"),
		row("bug-intake", { tags: ["triage", "intake"] }),
	];
	assert.deepEqual(
		filterAgentRows(rows, "tri").map((entry) => entry.name),
		["bug-intake"],
	);
	assert.deepEqual(filterAgentRows(rows, ""), rows);
	assert.deepEqual(
		filterAgentRows(rows, "   "),
		rows,
		"a whitespace-only query says nothing and narrows nothing",
	);
	assert.deepEqual(filterAgentRows(rows, "zzz"), []);
});

test("the filter returns a fresh list and preserves the order given", () => {
	const rows = [row("b"), row("a"), row("ab")];
	const admitted = filterAgentRows(rows, "a");
	assert.deepEqual(
		admitted.map((entry) => entry.name),
		["a", "ab"],
		"the roster's own order is the filter's order",
	);
	assert.notEqual(admitted, rows, "the input array is not handed back");
});

/* ------------------------------------------------------------------ *
 * The order
 * ------------------------------------------------------------------ */

/** The order's `recency` input, from a plain `{ name: ms }` table. */
const times = (table) => (entry) => table[entry.name] ?? null;

test("pinned rows come first, and the rest by recency, most recent first", () => {
	const rows = [row("a"), row("b"), row("c")];
	const ordered = orderAgentRows(rows, {
		pinned: ["c"],
		recency: times({ a: 100, b: 300, c: 200 }),
	});
	assert.deepEqual(
		ordered.map((entry) => entry.name),
		["c", "b", "a"],
		"the pin outranks recency; below it, b is more recent than a",
	);
});

test("recency ties keep the order given, in both bands", () => {
	const rows = [row("a"), row("b"), row("c"), row("d")];
	const ordered = orderAgentRows(rows, {
		pinned: ["c", "d"],
		recency: times({ a: 100, b: 100, c: 100, d: 100 }),
	});
	assert.deepEqual(
		ordered.map((entry) => entry.name),
		["c", "d", "a", "b"],
		"neither band reorders its equal-timed rows",
	);
});

test("never-used rows sit last within their band, in the order given", () => {
	const rows = [
		row("never-1"),
		row("used-100"),
		row("never-2"),
		row("used-300"),
	];
	const ordered = orderAgentRows(rows, {
		pinned: [],
		recency: times({ "used-100": 100, "used-300": 300 }),
	});
	assert.deepEqual(
		ordered.map((entry) => entry.name),
		["used-300", "used-100", "never-1", "never-2"],
		"a row with no time can never outrank one with a time",
	);
});

test("a pinned never-used row still outranks an unpinned used one", () => {
	const rows = [row("used"), row("quiet")];
	const ordered = orderAgentRows(rows, {
		pinned: ["quiet"],
		recency: times({ used: 500 }),
	});
	assert.deepEqual(
		ordered.map((entry) => entry.name),
		["quiet", "used"],
		"the pin is the reader's explicit act; sinking it below recency would make the reader re-aim at it",
	);
});

test("pinned rows order among themselves by recency", () => {
	const rows = [row("a"), row("b"), row("c")];
	const ordered = orderAgentRows(rows, {
		pinned: ["a", "c"],
		recency: times({ a: 100, c: 900, b: 400 }),
	});
	assert.deepEqual(
		ordered.map((entry) => entry.name),
		["c", "a", "b"],
		"the pinned band is ordered like the rest, just first",
	);
});

test("a pin naming a row the roster does not hold is inert", () => {
	const rows = [row("a"), row("b")];
	const ordered = orderAgentRows(rows, {
		pinned: ["ghost"],
		recency: times({}),
	});
	assert.deepEqual(
		ordered.map((entry) => entry.name),
		["a", "b"],
	);
});

test("an empty roster orders to an empty list", () => {
	assert.deepEqual(
		orderAgentRows([], { pinned: ["a"], recency: () => null }),
		[],
	);
});

/* ------------------------------------------------------------------ *
 * The pin
 * ------------------------------------------------------------------ */

test("a pin press round-trips: in when it was out, out when it was in", () => {
	const pinned = togglePinnedAgent(DEFAULT_SIDEBAR_VIEW, "release-captain");
	assert.deepEqual(pinned.pinnedAgents, ["release-captain"]);
	const unpinned = togglePinnedAgent(pinned, "release-captain");
	assert.deepEqual(unpinned.pinnedAgents, []);
	assert.deepEqual(
		DEFAULT_SIDEBAR_VIEW.pinnedAgents,
		[],
		"the press does not mutate the view it was handed",
	);
});

test("the pin count is bounded at 64, and the oldest press is the one that goes", () => {
	let view = DEFAULT_SIDEBAR_VIEW;
	for (let index = 0; index < PINNED_AGENTS_MAX; index += 1)
		view = togglePinnedAgent(view, `agent-${index}`);
	assert.equal(view.pinnedAgents.length, PINNED_AGENTS_MAX);
	const overflowed = togglePinnedAgent(view, "one-more");
	assert.equal(overflowed.pinnedAgents.length, PINNED_AGENTS_MAX);
	assert.equal(
		overflowed.pinnedAgents[0],
		"agent-1",
		"the newest press is kept and the oldest drops",
	);
	assert.equal(overflowed.pinnedAgents.at(-1), "one-more");
});

test("a stored pins list is sanitized field-wise: strings only, deduped, bounded", () => {
	const stored = parseSidebarView({
		pinnedAgents: [
			"kept",
			7,
			null,
			"kept",
			{ id: "object" },
			"second",
			"",
			...Array.from({ length: 80 }, (_, index) => `agent-${index}`),
		],
	});
	assert.deepEqual(
		stored.pinnedAgents.slice(0, 2),
		["kept", "second"],
		"non-strings and empties are dropped, duplicates collapse, first occurrence wins",
	);
	assert.equal(stored.pinnedAgents.length, PINNED_AGENTS_MAX);
	assert.ok(
		!stored.pinnedAgents.includes(""),
		"an empty string can never name a row",
	);
});

test("a stored blob without the field parses to no pins", () => {
	assert.deepEqual(parseSidebarView({}).pinnedAgents, []);
	assert.deepEqual(DEFAULT_SIDEBAR_VIEW.pinnedAgents, []);
	assert.deepEqual(
		parseSidebarView({ pinnedAgents: "kept" }).pinnedAgents,
		[],
		"a non-array degrades to none rather than taking the view down",
	);
});

/* ------------------------------------------------------------------ *
 * The usage join
 * ------------------------------------------------------------------ */

test("recency is the newest time across the agent's own sessions", () => {
	const rows = [
		session("coder", 100),
		session("coder", 300),
		session("coder", 200),
	];
	assert.equal(agentRecencyMs(rows, "coder"), 300_000);
});

test("a team-bound session belongs to the team's group and never to the agent's", () => {
	const rows = [
		session("coder", 100),
		session("coder", 900, {
			binding: { agent: "coder", team: "release-crew" },
		}),
	];
	assert.equal(
		agentRecencyMs(rows, "coder"),
		100_000,
		"the row carrying a team is excluded before the name is read",
	);
});

test("sessions with no usable time contribute nothing", () => {
	const rows = [
		session("coder", null),
		session("coder", Number.NaN),
		{
			session_id: "unbound",
			updated_at: 900,
			binding: { agent: null, team: null },
		},
	];
	assert.equal(agentRecencyMs(rows, "coder"), null);
	assert.equal(
		agentRecencyMs([], "coder"),
		null,
		"an empty list is never-used",
	);
	assert.equal(
		agentRecencyMs([session("other", 900)], "coder"),
		null,
		"another agent's sessions do not count",
	);
});
