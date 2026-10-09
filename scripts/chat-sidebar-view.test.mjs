/**
 * The sidebar's view: the page ladder, the three invariants the operator asked
 * for, the grouping, and the section show/hide + reorder the popover drives.
 *
 *     node --test scripts/chat-sidebar-view.test.mjs
 *
 * WHY THIS FILE EXISTS, in the operator's own words (2026-09-25): "show the
 * latest 10 (sorting active to the top) and then have a 'Load 10 more', starts
 * with 10, then 25, then 50, and then user can click to load more, search should
 * still be able to search and find, and the currently viewed session should
 * always be visible in there". Each of those three clauses is a test below that
 * FAILS when the rule is broken - which is the point: a pagination contract
 * asserted only by the shape of the control is a contract nobody is holding.
 *
 * The rules live in `chat-sidebar-view.ts` rather than in the sidebar's JSX for
 * the reason `chat-list-sections.ts` states in full: the sidebar cannot be
 * rendered by this repository's `node:test` suite, so a decision written as a
 * JSX condition is a decision no test can reach.
 *
 * WHAT IT CANNOT SAY: that the band, the popover and the section headers LOOK
 * right. Those are pixels and they were the rig's job (`--scene sidebar-sections`
 * on the built app, and the frames it wrote); that scene was retired with the
 * split's removal (agent review round 1, R2/Q3), so frames of this surface come
 * from whoever next runs a capture pass over the merged panel.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The storage shim the store needs to load in node at all: zustand's `persist`
 * writes through `localStorage` on every `setState`, which node lacks (the same
 * shim `chat-sidebar-sections.test.mjs` and `console-pane.test.mjs` carry). It
 * is also the instrument for the persistence case below - the store writes into
 * it, and a fresh parse reads it the way a launch does.
 *
 * THE KEY IS DISCOVERED, NOT SPELLED: the test finds the entry whose parsed
 * state carries `chatSidebarView`. Hard-coding the storage key would make this
 * file a second place a rename has to land, and the reader of this assertion
 * does not care what the key is - only that the store wrote one and that what
 * it wrote is the view the popover had just set.
 */
const memory = new Map();
globalThis.localStorage = {
	getItem: (key) => (memory.has(key) ? memory.get(key) : null),
	setItem: (key, value) => void memory.set(key, String(value)),
	removeItem: (key) => void memory.delete(key),
	clear: () => memory.clear(),
	key: (index) => [...memory.keys()][index] ?? null,
	get length() {
		return memory.size;
	},
};

const ROOT = process.cwd();
const SIDEBAR = "src/renderer/src/features/chat/components/chat-sidebar.tsx";

/*
 * THE WIRING PATTERN the section-press source read below matches: the transition
 * called, with `Boolean(query)` among its arguments (the forced-open input M1's
 * fix turns on). A top-level constant rather than an inline literal because
 * biome's `useTopLevelRegex` asks for it and this file carries no such warning.
 */
const SECTION_PRESS_WIRING = /toggleSectionDisclosure\([^)]*Boolean\(query\)/;

/*
 * ROUND 2'S PATTERNS (UX round 1's U1-U5 and N1; design round 1's D1-D3), top-level
 * constants for the same reason `SECTION_PRESS_WIRING` is one - biome's
 * `useTopLevelRegex` - and each named after the claim it carries so a test below
 * reads as the finding it answers rather than as a pattern.
 */
/** The grown heading's two channels and the one sentence behind both (U1/D1). */
const GROWN_HINT_TITLE = /title=\{grownHint \?\? undefined\}/;
const GROWN_HINT_DESCRIBED_BY =
	/aria-describedby=\{grownHint \? sectionGrownHintId\(key\) : undefined\}/;
const GROWN_HINT_PREDICATE =
	/const grownHint = sectionIsGrown\(sectionCaps\[key\]\)/;
const GROWN_HINT_ELEMENT =
	/<span id=\{sectionGrownHintId\(key\)\} className="sr-only">/;
/**
 * The section foot's walk stamp, ANCHORED TO A LINE OF ITS OWN: the comment above
 * the attribute names `[data-chat-row]` while explaining why the foot joins the
 * walk, so an unanchored pattern would be satisfied by the prose and would keep
 * passing after the attribute itself was deleted (measured: dropping the attribute
 * left this test green until the anchor was added).
 */
const FOOT_WALK_STAMP = /^[ \t]*data-chat-row[ \t]*$/m;
const FOOT_NAME = /aria-label=\{footName\}/;
const FOOT_FOCUS_RECORD = /sectionFootFocusRef\.current = \{ key, at: cap \}/;
/** The focus effect: the list it reads, its target, its fallback, its one action (U3/D3). */
const FOCUS_READS_ROWS = /querySelectorAll<HTMLElement>\("\[data-entity\]"\)/;
const FOCUS_TARGET_ROW =
	/revealed\?\.querySelector<HTMLElement>\("\[data-chat-row\]"\)/;
const FOCUS_HEADING_FALLBACK = /heading \?\?/;
const FOCUS_APPLIES = /target\?\.focus\(\)/;
/**
 * The field's gate is the MODULE's own question, asked once (U2). A WIRING pin only: the
 * rule's BEHAVIOUR is driven below rather than matched here, because round 3 showed a
 * source-string pin cannot see a gate that keeps its text but not its meaning - the
 * round-2 form passed this pattern while being inert in the state U2 measured.
 */
const ROSTER_FIELD_WIRED =
	/const rosterFilterShown = rosterFieldShown\(\s*isOpen\("agents", true\),\s*query,\s*rosterFilter,\s*ownAgents\.length,\s*\)/;
/** The copy contract on the hint itself (U1/D1). */
const HINT_NAMES_GESTURE = /collapse/i;
const HINT_NAMES_COST = /reopen/i;
const HINT_SENTENCE_CASE = /^[A-Z]/;
const HINT_ID_KEYED = /agents/;

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/chat/chat-sidebar-view";',
			'export * from "./src/renderer/src/features/chat/chat-list-sections";',
			/*
			 * The roster's own module joins for the PIN field's cases: the stored
			 * `pinnedAgents` list is written by `togglePinnedAgent` and parsed a
			 * field down from it, so the round trip below would be asserting one
			 * half of a contract the other half spells.
			 */
			'export * from "./src/renderer/src/features/chat/chat-sidebar-agents";',
			/*
			 * The store joins the bundle for the PERSISTENCE case, and for one
			 * reason: the view the popover writes is a persisted field, so the
			 * claim "this setting survives a relaunch" is a claim about the
			 * store's own round trip and not about the sidebar's markup.
			 */
			'export { useUiPreferencesStore, persistedUiPreferences } from "./src/renderer/src/shared/store/ui-preferences-store";',
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
	CHAT_PAGE_START,
	CHAT_PAGE_STEP,
	CHAT_PAGE_STEPS,
	DEFAULT_SIDEBAR_VIEW,
	ENTITY_SECTIONS,
	SIDEBAR_SECTIONS,
	SIDEBAR_SECTION_LABEL,
	isEntitySection,
	isSectionShown,
	canMoveSection,
	moveSection,
	pageLimit,
	pageMoreLabel,
	pageOrder,
	pageRows,
	parseSidebarView,
	groupRows,
	sectionRows,
	shownSections,
	toggleSection,
	persistedUiPreferences,
	useUiPreferencesStore,
	isActiveRow,
	entityRows,
	entityMore,
	raiseSectionCap,
	rosterFieldShown,
	releaseSectionCap,
	SIDEBAR_SECTION_ROWS,
	toggleSectionDisclosure,
	entityQueryAdmits,
	entitySectionGap,
	ENTITY_SECTION_GAP,
	ENTITY_SECTION_GAP_COLLAPSED,
	SECTION_GROWN_HINT,
	sectionGrownHintId,
	sectionIsGrown,
	sectionMoreLabel,
	sectionMoreName,
	CHAT_LIST_SECTIONS,
	PINNED_AGENTS_MAX,
	togglePinnedAgent,
} = await import(
	`data:text/javascript;base64,${Buffer.from(
		bundle.outputFiles[0].text,
	).toString("base64")}`
);

/** One catalogue row, with only the fields these rules read. */
const row = (id, at, code) => ({
	session_id: id,
	title: id,
	updated_at: at,
	status: code ? { code } : undefined,
});

const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);
const SECONDS = (hoursAgo) => (NOW - hoursAgo * 3_600_000) / 1000;

/*
 * THE LADDER IS THE CONTRACT, and it is spelled out here rather than derived:
 * "starts with 10, then 25, then 50, and then user can click to load more". The
 * increment past 50 is 50 - a doubling ladder past the third rung would put a
 * metric ton of rows behind one press, and a smaller one would make the last
 * press barely move, so the ladder is flat from its third rung on. Stated
 * because it is the one number the operator's sentence leaves to the
 * implementer.
 */
test("the page ladder is 10, then 25, then 50, then +50 a press", () => {
	assert.equal(pageLimit(0), 10, "a column nobody has paged loads 10");
	assert.equal(pageLimit(1), 25);
	assert.equal(pageLimit(2), 50);
	assert.equal(pageLimit(3), 100);
	assert.equal(pageLimit(4), 150);
	assert.equal(pageLimit(9), 50 + (9 - 2) * CHAT_PAGE_STEP);
	assert.deepEqual([...CHAT_PAGE_STEPS], [25, 50]);
	assert.equal(CHAT_PAGE_START, 10);
	assert.equal(pageLimit(-1), 10, "a negative counter is the first page");
	assert.equal(pageLimit(2.7), 50, "a fractional counter floors");
});

test("the foot control names the next page, bounded by what is left", () => {
	assert.equal(pageMoreLabel(0, 100), "Show 15 more chats");
	assert.equal(pageMoreLabel(1, 100), "Show 25 more chats");
	assert.equal(pageMoreLabel(2, 4), "Show 4 more chats");
	assert.equal(pageMoreLabel(2, 1), "Show 1 more chat");
	assert.equal(pageMoreLabel(2, 0), "Show 0 more chats");
});

/*
 * INVARIANT 1 - the conversation being VIEWED is on screen.
 *
 * The failure this pins is the one a page-bound list always produces: the
 * reader opens a conversation, comes back to the list, and their own chat is
 * not in it - because the row the app is displaying sits at position 300 and
 * the page stopped at 10.
 */
/*
 * THE EXPANDED GROUP'S OWN BOUND (operator, 2026-09-27): "there's far too many
 * team/agent messages shown on screen at once when expanded, can you have max 10
 * at first sorted by most recent/active then click to load more".
 *
 * The chats list has been bounded by the ladder since it shipped; the rows INSIDE
 * an expanded team or agent were not, which is what his screenshot shows. These
 * four tests are the requests's four load-bearing clauses, one each, so that
 * breaking any of them reddens a named claim rather than a picture.
 */
test("an expanded group draws the ladder's prefix, in the order it is given", () => {
	const rows = Array.from({ length: 41 }, (_, index) =>
		row(`s${index}`, SECONDS(index + 1)),
	);
	const page = entityRows(rows, { loads: 0 });
	assert.equal(
		page.rows.length,
		10,
		"ten rows first, whatever the group holds",
	);
	assert.equal(page.held, 41);
	assert.equal(page.hidden, 31);
	assert.deepEqual(
		page.rows.map((entry) => entry.session_id),
		rows.slice(0, 10).map((entry) => entry.session_id),
		"the bound takes a PREFIX of the order it is handed, and re-sorts nothing",
	);
	assert.equal(page.lifted, false);
	/*
	 * AND THE LADDER IS THE CHATS LIST'S, not a second set of numbers: 10, then
	 * 25, then 50, then fifty more a press. A group is that list one level down.
	 */
	for (const [loads, expected] of [
		[0, 10],
		[1, 25],
		[2, 50],
		[3, 100],
	]) {
		assert.equal(
			entityRows(rows, { loads }).rows.length,
			Math.min(expected, 41),
			`rung ${loads} draws ${expected}`,
		);
	}
	assert.equal(
		entityRows(rows, { loads: 9 }).hidden,
		0,
		"a rung past the group's size withholds nothing",
	);
});

test("the bound never hides live work: a running row is out of the quota", () => {
	const quiet = Array.from({ length: 41 }, (_, index) =>
		row(`s${index}`, SECONDS(index + 1)),
	);
	const rows = [...quiet];
	rows[40] = row("s40", SECONDS(41), "busy");
	const page = entityRows(rows, { loads: 0 });
	assert.equal(
		page.rows.some((entry) => entry.session_id === "s40"),
		true,
		"a turn in flight at position 40 is drawn, not withheld",
	);
	assert.equal(
		page.rows.findIndex((entry) => entry.session_id === "s40"),
		// Ten drawn rows, then the running one wherever it sits in the order the
		// caller arranged (this fixture hands `entityRows` the catalogue's own, and
		// the component hands it `pageOrder`'s).
		10,
		"and it is drawn IN PLACE: the exemption adds a row, it does not move one",
	);
	assert.equal(page.rows.length, 11, "one extra row, not a re-sort");
	/*
	 * The exemption is the RUNNING section's own predicate rather than a second
	 * list of status codes, so the two cannot drift: `approval` and `wedged` are
	 * as live as `busy` here because they are live there.
	 */
	for (const code of ["busy", "delegating", "approval", "answer", "wedged"]) {
		const only = entityRows(
			[...quiet.slice(0, 40), row("live", SECONDS(41), code)],
			{ loads: 0 },
		);
		assert.equal(
			only.rows.some((entry) => entry.session_id === "live"),
			true,
			`a ${code} row is never withheld`,
		);
	}
	assert.equal(
		entityRows([...quiet.slice(0, 40), row("cold", SECONDS(41))], {
			loads: 0,
		}).rows.some((entry) => entry.session_id === "cold"),
		false,
		"while the same row with no live state IS withheld",
	);
});

test("a query is never bounded: the bound cannot hide a hit", () => {
	const rows = Array.from({ length: 41 }, (_, index) =>
		row(`s${index}`, SECONDS(index + 1)),
	);
	const page = entityRows(rows, { loads: 0, searching: true });
	assert.equal(page.rows.length, 41, "every match the query produced is drawn");
	assert.equal(page.hidden, 0);
	assert.equal(page.lifted, false);
});

test("the viewed conversation is lifted when the bound withheld it", () => {
	const rows = Array.from({ length: 41 }, (_, index) =>
		row(`s${index}`, SECONDS(index + 1)),
	);
	const page = entityRows(rows, { loads: 0, currentId: "s34" });
	assert.equal(page.lifted, true);
	assert.equal(page.rows[0].session_id, "s34", "it leads the group");
	assert.equal(page.rows.length, 11, "one row is added, not forty");
	assert.equal(
		new Set(page.rows.map((entry) => entry.session_id)).size,
		page.rows.length,
		"no row is drawn twice",
	);
	assert.deepEqual(
		page.rows.slice(1).map((entry) => entry.session_id),
		rows.slice(0, 10).map((entry) => entry.session_id),
		"the sort behind it is untouched",
	);
	assert.equal(page.hidden, 30, "the lifted row is not also counted as hidden");
	/*
	 * AND A VIEWED ROW THE BOUND ALREADY DRAWS IS NOT MOVED: the lift is a remedy
	 * for one situation, and applying it unconditionally would reorder a group the
	 * reader is looking at for no reason at all.
	 */
	const inside = entityRows(rows, { loads: 0, currentId: "s3" });
	assert.equal(inside.lifted, false);
	assert.deepEqual(
		inside.rows.map((entry) => entry.session_id),
		rows.slice(0, 10).map((entry) => entry.session_id),
	);
	/*
	 * A CONVERSATION THIS GROUP DOES NOT HOLD IS NOT ADOPTED. Another team's session
	 * being the viewed one must not put a row under this team.
	 */
	const elsewhere = entityRows(rows, { loads: 0, currentId: "other-team" });
	assert.equal(elsewhere.lifted, false);
	assert.equal(elsewhere.rows.length, 10);
});

/*
 * THE COUNT AND THE DISCLOSURE AGREE (the brief's fourth clause): the badge states
 * what the group HOLDS, so a reader under `41` looking at ten rows could not tell
 * ten-of-forty-one from all-of-forty-one until the control said so.
 */
test("the group's foot names the next page AND the position it is drawn from", () => {
	const foot = entityMore({ add: 15, drawn: 10, total: 41 });
	assert.equal(foot.label, "Show 15 more chats · 10 of 41");
	/* The name contains the visible label whole (round 1, U4): same ` · `, not a comma. */
	assert.equal(foot.aria, "Show 15 more chats · 10 of 41 shown");
	/* A press that adds one row counts it, for `pageMoreLabel`'s reason. */
	assert.equal(
		entityMore({ add: 1, drawn: 40, total: 41 }).label,
		"Show 1 more chat · 40 of 41",
	);
	/*
	 * And it drops the position when the reader is already looking at everything,
	 * which is what keeps the control from contradicting the badge beside it.
	 */
	assert.equal(
		entityMore({ add: 15, drawn: 41, total: 41 }).label,
		"Show 15 more chats",
	);
	/* Nothing withheld and no cursor: no control, so `10 of 10` is never printed. */
	assert.equal(entityMore({ add: 0, drawn: 10, total: 10 }), null);
});

/*
 * A COLLAPSED SECTION IS COMPACT AGAIN (issue #765). `Show more` raised one
 * section's cap and nothing brought it back down: collapse, re-expand, and the
 * grown list was still on screen until a relaunch. The rules now live in the
 * view module as the two edges of one state machine, and the cycle is asserted
 * here rather than described, because the failure was a MISSING EDGE in a
 * transition no test could reach from the JSX.
 */
test("closing a section releases its raised cap back to the shipped one", () => {
	/* The ladder, one rung per press: `agents` goes 8 -> 16 -> 24. */
	let caps = {};
	caps = raiseSectionCap(caps, "agents");
	assert.equal(caps.agents, SIDEBAR_SECTION_ROWS * 2);
	caps = raiseSectionCap(caps, "agents");
	assert.equal(caps.agents, SIDEBAR_SECTION_ROWS * 3);

	/* The collapse. */
	caps = releaseSectionCap(caps, "agents");
	assert.equal(
		caps.agents ?? SIDEBAR_SECTION_ROWS,
		SIDEBAR_SECTION_ROWS,
		"a re-expand after a collapse must draw the shipped compact form",
	);
	/*
	 * The entry must be GONE, not merely unreachable: a stored `16` is exactly the
	 * grown list #765 is about, and `cappedRows` would read it on the next expand.
	 */
	assert.ok(
		!("agents" in caps),
		"the reset stored a number instead of removing the key",
	);
});

/*
 * THE PARTIAL RUNG (issue #765's second half). A press reveals the rows that
 * EXIST - `hidden` counts them, so a 10-row section under the shipped cap shows
 * `Show 2 more` and lands on a cap of 16, a number no row count would reach by
 * subtracting a page. The reset must not care: the invariant is "a collapsed
 * section is compact", not "a collapsed section is one step shorter".
 */
test("a reset lands on the shipped cap after a partial rung", () => {
	const rows = 10;
	let caps = raiseSectionCap({}, "teams");
	assert.equal(caps.teams, SIDEBAR_SECTION_ROWS * 2);
	assert.equal(
		rows - SIDEBAR_SECTION_ROWS,
		2,
		"the fixture: the press revealed fewer rows than a page",
	);
	assert.ok(
		caps.teams > rows,
		"the fixture: the raised cap outran the rows it was capping",
	);

	caps = releaseSectionCap(caps, "teams");
	assert.equal(caps.teams ?? SIDEBAR_SECTION_ROWS, SIDEBAR_SECTION_ROWS);
	assert.ok(
		rows - (caps.teams ?? SIDEBAR_SECTION_ROWS) > 0,
		"the re-expanded section is cap-bound again, so the foot is drawn again",
	);
});

/*
 * AND THE CLIMB STARTS OVER. A press after a reset is a FRESH rung from the
 * shipped cap, never a resume of the grown value: a reader who had reached 24,
 * collapsed, and re-expanded would otherwise be one press from 32 with nothing
 * on screen explaining the number.
 */
test("a press after a reset climbs from the shipped cap, not from the grown one", () => {
	const rows = 20;
	let caps = raiseSectionCap(raiseSectionCap({}, "agents"), "agents");
	caps = releaseSectionCap(caps, "agents");

	const firstDraw = Math.min(rows, caps.agents ?? SIDEBAR_SECTION_ROWS);
	assert.equal(firstDraw, SIDEBAR_SECTION_ROWS);
	assert.ok(rows - firstDraw > 0, "the foot is offered again after the reset");

	const again = raiseSectionCap(caps, "agents");
	assert.equal(again.agents, SIDEBAR_SECTION_ROWS * 2);
	assert.equal(rows - again.agents, rows - SIDEBAR_SECTION_ROWS * 2);
	assert.equal(again.agents, firstDraw + SIDEBAR_SECTION_ROWS);
});

/*
 * KEYED, LIKE THE MAP ITSELF: closing Teams must not shrink a widened Agents,
 * which is the reason `sectionCaps` is keyed at all (the operator's note in
 * `chat-sidebar.tsx`: "a reader who wants the eleventh agent does not also open
 * the eleventh team").
 */
test("releasing one section's cap leaves the other section's alone", () => {
	const caps = raiseSectionCap(raiseSectionCap({}, "agents"), "teams");
	assert.deepEqual(caps, {
		agents: SIDEBAR_SECTION_ROWS * 2,
		teams: SIDEBAR_SECTION_ROWS * 2,
	});
	const after = releaseSectionCap(caps, "agents");
	assert.deepEqual(after, { teams: SIDEBAR_SECTION_ROWS * 2 });
	assert.equal(after.agents ?? SIDEBAR_SECTION_ROWS, SIDEBAR_SECTION_ROWS);
	assert.equal(
		caps.agents,
		SIDEBAR_SECTION_ROWS * 2,
		"the release mutated the map it was handed",
	);
});

/*
 * A CLOSE OF A SECTION NOBODY WIDENED IS NOT A STATE CHANGE. React re-renders on
 * identity, and a reader collapses sections constantly, so returning a fresh `{}`
 * here would re-render the whole column for a close that changed nothing.
 */
test("closing a section nobody widened returns the same map", () => {
	const caps = {};
	assert.equal(releaseSectionCap(caps, "agents"), caps);
});

/*
 * THE CAP IS MOMENT STATE, NOT A PREFERENCE. The design note on `sectionCaps`
 * says why (a cap remembered from June would make the column permanently
 * longer); this asserts the other half - the persisted view a relaunch reads
 * carries no cap field for it to come back through.
 */
test("the persisted view carries no section cap", () => {
	const view = parseSidebarView(
		persistedUiPreferences(useUiPreferencesStore.getState()).chatSidebarView,
	);
	assert.ok(!("sectionCaps" in view));
	assert.ok(!("caps" in view));
});

/*
 * AND THE CLOSE EDGE IS DRIVEN, NOT GREPPED (agent review round 1, m1). The
 * transition now covers BOTH maps, so the case the round-1 substring could not
 * see - a press on a section a LIST QUERY force-draws (`query || isOpen(...)` in
 * the component) - is asserted here by driving it, on the slice `cappedRows`
 * applies (`caps[key] ?? SIDEBAR_SECTION_ROWS`), because "nothing narrows" is a
 * claim about the drawn count and not about the map.
 *
 * THE DEFECT THIS PINS (round 1's M1, QA round 1's QA-F1): the round-1 shape
 * released the raised cap on that press too, dropping the drawn rows back to
 * `SIDEBAR_SECTION_ROWS` under a reader whose section never went away.
 */
test("a press on a query-forced-open section leaves the drawn rows alone", () => {
	const rows = 24;
	const caps = raiseSectionCap(raiseSectionCap({}, "agents"), "agents");
	assert.equal(caps.agents, SIDEBAR_SECTION_ROWS * 3);

	const pressed = toggleSectionDisclosure({}, caps, "agents", true, true);
	assert.equal(
		pressed.caps,
		caps,
		"the press released the cap of a section the query keeps drawn",
	);
	assert.equal(
		Math.min(rows, pressed.caps.agents ?? SIDEBAR_SECTION_ROWS),
		SIDEBAR_SECTION_ROWS * 3,
		"a section the query force-draws narrowed under the reader",
	);
	/*
	 * The DISCLOSURE is still written under a query, which is pre-existing
	 * behaviour this fix deliberately leaves alone (round 1 scoped it out): the
	 * press keeps its own meaning once the query is cleared.
	 */
	assert.equal(pressed.expanded.agents, false);

	/* And a forced-open press on a section nobody widened is a true no-op. */
	const untouched = {};
	assert.equal(
		toggleSectionDisclosure({}, untouched, "teams", true, true).caps,
		untouched,
		"a forced-open press on an untouched section rebuilt the caps map",
	);
});

/*
 * AND THE GATE IS NOT A BLANKET AMNITY: with no query in force the same press is
 * #765's own case, and the release must still happen. Without this, the guard
 * above could be satisfied by deleting the release altogether.
 */
test("a press that really closes the section still releases its cap", () => {
	const caps = raiseSectionCap(raiseSectionCap({}, "teams"), "teams");
	const pressed = toggleSectionDisclosure(
		{ teams: true },
		caps,
		"teams",
		true,
		false,
	);
	assert.equal(pressed.expanded.teams, false);
	assert.ok(
		!("teams" in pressed.caps),
		"a real close stopped releasing the raised cap, so #765 is back",
	);
	assert.equal(
		pressed.caps.teams ?? SIDEBAR_SECTION_ROWS,
		SIDEBAR_SECTION_ROWS,
	);
});

/* An OPENING press is not a close either, query or no query. */
test("a press that opens a section never releases a cap", () => {
	const caps = raiseSectionCap({}, "agents");
	const pressed = toggleSectionDisclosure(
		{ agents: false },
		caps,
		"agents",
		false,
		false,
	);
	assert.equal(pressed.expanded.agents, true);
	assert.equal(
		pressed.caps,
		caps,
		"an open narrowed the section under the reader",
	);
});

/*
 * AND THE COMPONENT ROUTES BOTH MAPS THROUGH THAT ONE TRANSITION. The rules above
 * are driven; the WIRING is still read, because the component cannot be rendered
 * here - and the read now adds what the round-1 substring could not: the press
 * must hand the transition the forced-open input (`Boolean(query)`, the same
 * truthiness the row draw uses), and the component must carry no SECOND spelling
 * of the release edge. A read that only looked for the call would pass while an
 * inline `releaseSectionCap` sat beside it - the drift the hoist exists to
 * prevent (agent review round 1, m1).
 */
test("the section press routes through the one disclosure transition", () => {
	const source = readFileSync(SIDEBAR, "utf8");
	assert.match(
		source,
		SECTION_PRESS_WIRING,
		"the press does not route through the transition with the query's forced-open input, so a query-forced close releases the cap again (M1)",
	);
	assert.ok(
		!source.includes("releaseSectionCap("),
		"a second, inline spelling of the cap release lives in the component; the rule belongs to the transition",
	);
});

/*
 * THE COLLAPSED SECTION'S GAP (operator, 2026-09-27): "shrink the gap between
 * agents and teams headers when agents is collapsed, there's an extra gap wasting
 * space there". Measured on the panel at 360px, the gap between the two headings
 * is 16.0px with `Agents` collapsed AND 16.0px with it expanded - one shared
 * `space-y-4` that does not know whether there are rows for it to separate. So
 * the fix is a conditional value; a smaller constant would tighten the expanded
 * case, where the rhythm is doing real work.
 */
/*
 * ROUND 2 - THE RESET'S NAME AND THE FOOT'S CONTRACT (UX round 1's U1, U3, U4,
 * U5 and N1; design round 1's D1, D2 and D3).
 *
 * Every one of those findings sits on a surface this suite cannot render (the
 * file's header says why), so each is pinned in one of the two shapes the rest of
 * this file uses: the COPY and the STATE QUESTION are pure logic and are driven
 * directly (`SECTION_GROWN_HINT`, `sectionIsGrown`, `sectionMoreLabel`,
 * `sectionMoreName`, `sectionGrownHintId`), and the WIRING - which element
 * carries the sentence, which record the press leaves behind, where the focus
 * effect sends the reader - is read out of the source, SCOPED to the block that
 * holds it so a match somewhere else in this file cannot stand in for the claim.
 */
test("the grown section's hint names both halves of the reset", () => {
	assert.match(
		SECTION_GROWN_HINT,
		HINT_NAMES_GESTURE,
		"the hint does not name the gesture that puts the cap back (U1/D1)",
	);
	assert.match(
		SECTION_GROWN_HINT,
		HINT_NAMES_COST,
		"the hint does not name the inverse cost, so it promises the raised rows back across a collapse",
	);
	assert.match(
		SECTION_GROWN_HINT,
		HINT_SENTENCE_CASE,
		"the hint is not sentence case (D1's least-chrome remedy is copy, so its voice is the remedy)",
	);
	assert.ok(
		!SECTION_GROWN_HINT.includes(". "),
		"the hint is more than one sentence; a control's description is one",
	);
});

test("the grown question is the draw's own question", () => {
	assert.equal(
		sectionIsGrown(undefined),
		false,
		"a section nobody raised is not grown",
	);
	assert.equal(
		sectionIsGrown(SIDEBAR_SECTION_ROWS),
		false,
		"an entry at the shipped count IS the shipped list, not a raise",
	);
	assert.equal(
		sectionIsGrown(SIDEBAR_SECTION_ROWS + 1),
		true,
		"one row past the shipped cap is grown",
	);
	/*
	 * And it agrees with the state machine's own edges, which is the claim that
	 * matters: the heading can only say "grown" in a state `cappedRows` also draws
	 * past the cap, because one raise makes it grown and the close edge that
	 * `releaseSectionCap` performs takes it back.
	 */
	const raised = raiseSectionCap({}, "agents");
	assert.equal(sectionIsGrown(raised.agents), true);
	assert.equal(
		sectionIsGrown(releaseSectionCap(raised, "agents").agents),
		false,
		"a released cap still reads as grown, so the heading would name a raise that is gone",
	);
});

test("the section foot's name carries its section, and its label heads that name", () => {
	assert.equal(sectionMoreLabel(1), "Show 1 more");
	assert.equal(sectionMoreLabel(4), "Show 4 more");
	assert.equal(sectionMoreName(1, "agents"), "Show 1 more agents");
	assert.equal(sectionMoreName(4, "teams"), "Show 4 more teams");
	/*
	 * The visible label is the HEAD of the accessible name, so the two cannot
	 * describe different remainders - the defect N1 measured was not a wrong name
	 * but NO name, which left two sections' feet announcing the same bare label.
	 */
	for (const hidden of [1, 4, 26]) {
		assert.ok(
			sectionMoreName(hidden, "agents").startsWith(sectionMoreLabel(hidden)),
			"the name and the label disagree about the remainder",
		);
	}
});

test("the grown hint's id is keyed, so two sections cannot describe each other", () => {
	assert.notEqual(sectionGrownHintId("agents"), sectionGrownHintId("teams"));
	assert.match(sectionGrownHintId("agents"), HINT_ID_KEYED);
});

test("a grown heading carries the reset on both channels, from one sentence", () => {
	const source = readFileSync(SIDEBAR, "utf8");
	assert.match(
		source,
		GROWN_HINT_TITLE,
		"the grown heading has no pointer channel for the reset (U1/D1)",
	);
	assert.match(
		source,
		GROWN_HINT_DESCRIBED_BY,
		"the grown heading describes itself to no screen reader (U1/D1)",
	);
	assert.match(
		source,
		GROWN_HINT_PREDICATE,
		"the hint is not read from the same map `cappedRows` slices rows with",
	);
	assert.match(
		source,
		GROWN_HINT_ELEMENT,
		"no element carries the sentence the heading points at",
	);
	assert.ok(
		!source.includes("Collapse to restore the compact list"),
		"the sentence is spelled in the component as well as in the view module; one copy is the rule",
	);
});

test("the section foot is named, joins the arrow walk, and leaves a focus record", () => {
	const source = readFileSync(SIDEBAR, "utf8");
	const at = source.indexOf("data-sidebar-section-more={key}");
	assert.ok(at !== -1, "the section foot's stamp is gone");
	const foot = source.slice(at, source.indexOf("</button>", at));
	assert.match(
		foot,
		FOOT_WALK_STAMP,
		"the section foot is not a stop of the arrow walk, unlike the group foot below it (U4)",
	);
	assert.match(
		foot,
		FOOT_NAME,
		"the foot still announces a bare remainder with no section (N1)",
	);
	assert.match(
		foot,
		FOOT_FOCUS_RECORD,
		"the press leaves no record of the rows it just revealed (U3/D3)",
	);
});

test("the foot's focus goes to the row the press revealed, never the body", () => {
	const source = readFileSync(SIDEBAR, "utf8");
	const at = source.indexOf("const pending = sectionFootFocusRef.current");
	assert.ok(at !== -1, "nothing reads the section foot's focus record (U3/D3)");
	const effect = source.slice(at, source.indexOf("}, [sectionCaps]);", at));
	assert.match(
		effect,
		FOCUS_READS_ROWS,
		"the effect does not read the list `cappedRows` slices, so an expanded row's sessions would be counted as revealed rows",
	);
	assert.match(
		effect,
		FOCUS_TARGET_ROW,
		"the revealed row's own control is not the target",
	);
	assert.match(
		effect,
		FOCUS_HEADING_FALLBACK,
		"no fallback to the section's own heading, so a vanished row drops the reader to the body",
	);
	assert.match(effect, FOCUS_APPLIES);
	assert.ok(
		!source.includes("document.body.focus("),
		"a press sends focus to the document body",
	);
});

/*
 * U2, DRIVEN RATHER THAN READ (agent review round 3's R3-1, QA round 3's Q3-2). The
 * round-2 pin was a source-string match on the gate, and it stayed green for a gate
 * that kept its text while being inert in the state the finding measured. This test
 * drives the two halves that make the state - the field's own predicate
 * (`rosterFieldShown`) and the heading press (`toggleSectionDisclosure`) - and asks the
 * predicate again of the state the press left behind. It is RED on the pre-fix gate and
 * on the round-2 narrower form, GREEN on the body's own gate (both measured).
 */
test("a heading press under a list query keeps the roster's filter field drawn", () => {
	/*
	 * THE PRESS, SPELLED AS THE COMPONENT SPELLS IT (chat-sidebar.tsx:1751): the
	 * disclosure and the cap move together, `forcedOpen` is `Boolean(query)`, and
	 * `isOpen` is `expanded[key] ?? initial` with the section's own initial (`true`).
	 */
	const press = (state) => {
		const next = toggleSectionDisclosure(
			{ agents: state.isOpen },
			{ agents: state.cap ?? SIDEBAR_SECTION_ROWS },
			"agents",
			true,
			Boolean(state.query),
		);
		return {
			isOpen: next.expanded.agents ?? true,
			query: state.query,
			rosterFilter: state.rosterFilter,
			rosterLength: state.rosterLength,
			caps: next.caps,
		};
	};
	const drawn = (state) =>
		rosterFieldShown(
			state.isOpen,
			state.query,
			state.rosterFilter,
			state.rosterLength,
		);

	/*
	 * THE REPRO ITSELF: a LIST query in force, NO section filter, the roster
	 * cap-bound (twelve agents against the eight-row cap). The section body still
	 * draws under the query, so its own control must survive the press.
	 */
	const listQueryOnly = {
		isOpen: true,
		query: "b",
		rosterFilter: "",
		rosterLength: 12,
	};
	assert.equal(
		drawn(listQueryOnly),
		true,
		"the repro's precondition: the field is drawn before the press",
	);
	const afterListQueryPress = press(listQueryOnly);
	assert.equal(
		afterListQueryPress.isOpen,
		false,
		"the press did not write the disclosure close it is documented to write",
	);
	assert.equal(
		drawn(afterListQueryPress),
		true,
		"the heading press removed the field under a list query with no section filter (U2)",
	);
	/*
	 * AND THE PRESS IS STILL THE DOCUMENTED NO-OP ON THE RAISE: `forcedOpen` is the
	 * query, so the release edge does not fire and the drawn rows do not change.
	 */
	assert.equal(
		afterListQueryPress.caps.agents,
		SIDEBAR_SECTION_ROWS,
		"a press under a query released the raised cap it must leave alone",
	);

	/*
	 * THE SECOND HALF IS UNTOUCHED - a query over a SHORT roster draws nothing, so
	 * the field is still the reader's and a query alone opens no surface.
	 */
	assert.equal(
		drawn({ isOpen: false, query: "b", rosterFilter: "", rosterLength: 4 }),
		false,
		"a query alone now opens a field over a short roster",
	);
	/*
	 * AND THE CASE THE NARROWER FORM ALREADY COVERED still holds: a reader with their
	 * OWN filter applied keeps the field through the press.
	 */
	assert.equal(
		drawn(
			press({ isOpen: true, query: "b", rosterFilter: "er", rosterLength: 12 }),
		),
		true,
	);

	/*
	 * THE CONTROL: with NO list query the press really does close the section (the
	 * design re-check's third row - 4 rows to 0, `aria-expanded` false), so the field
	 * leaving with the list it filters is correct. This is the case the gate must NOT
	 * spare.
	 */
	assert.equal(
		drawn(
			press({ isOpen: true, query: "", rosterFilter: "er", rosterLength: 12 }),
		),
		false,
		"a press that genuinely closes the section kept a field for a list that is gone",
	);
});

test("the field's gate is the module's question, asked once", () => {
	const source = readFileSync(SIDEBAR, "utf8");
	assert.match(
		source,
		ROSTER_FIELD_WIRED,
		"the field is no longer drawn by `rosterFieldShown`, so the component's rule can drift from the tested one (U2)",
	);
});

test("the gap below a section is conditional on whether that section drew rows", () => {
	assert.equal(entitySectionGap(true), ENTITY_SECTION_GAP);
	assert.equal(entitySectionGap(false), ENTITY_SECTION_GAP_COLLAPSED);
	assert.notEqual(
		ENTITY_SECTION_GAP_COLLAPSED,
		ENTITY_SECTION_GAP,
		"a single smaller constant is exactly the fix this refuses",
	);
	/*
	 * Tailwind's own 4px step, so "tighter" is a number rather than a claim: the
	 * collapsed gap is strictly smaller than the section rhythm it replaces.
	 */
	const px = (cls) => Number(/(\d+)/.exec(cls)?.[1] ?? Number.NaN) * 4;
	assert.ok(px(ENTITY_SECTION_GAP_COLLAPSED) < px(ENTITY_SECTION_GAP));
	/*
	 * AND IT IS THE SAME WHATEVER THE COLLAPSED SECTION HOLDS - the argument is one
	 * boolean, so an empty section and a section holding forty rows cannot space
	 * differently. That is the case a per-count rule gets wrong.
	 */
	assert.equal(entitySectionGap(false), entitySectionGap(false));
});

/*
 * AN ENTITY'S QUERY GATE, hoisted into the module so the row and the roster
 * filter's empty sentence cannot drift (issue #663, UX round 1's U1): a list
 * query admits an entity when its NAME carries the query, or when it still has
 * rows to draw.
 */
test("an entity survives the list query by its name or by the rows it holds", () => {
	assert.equal(
		entityQueryAdmits("builder", 0, ""),
		true,
		"an empty query admits everything",
	);
	assert.equal(
		entityQueryAdmits("builder", 0, "build"),
		true,
		"the name carries the query",
	);
	assert.equal(
		entityQueryAdmits("builder", 2, "scout"),
		true,
		"rows survive even when the name does not",
	);
	assert.equal(
		entityQueryAdmits("builder", 0, "scout"),
		false,
		"no name hit and no rows is the drop",
	);
	assert.equal(
		entityQueryAdmits("Patch-Reviewer", 0, "patch"),
		true,
		"the comparison is case-insensitive on both sides",
	);
	assert.equal(
		entityQueryAdmits("patch-reviewer", 0, "reviewer"),
		true,
		"a substring, not a prefix",
	);
});

test("invariant 1: the viewed conversation is on screen past the page's end", () => {
	const rows = Array.from({ length: 60 }, (_, index) =>
		row(`s${index}`, SECONDS(index + 1)),
	);
	const page = pageRows(rows, { limit: 10, currentId: "s42" });
	assert.equal(page.rows.length, 11, "the viewed row joins the page");
	assert.equal(page.rows[0].session_id, "s42", "and leads it");
	assert.equal(page.lifted, true);
	assert.equal(
		new Set(page.rows.map((entry) => entry.session_id)).size,
		page.rows.length,
		"no row is drawn twice",
	);
	assert.deepEqual(
		page.rows.slice(1).map((entry) => entry.session_id),
		rows.slice(0, 10).map((entry) => entry.session_id),
		"the page behind it is unchanged",
	);
});

test("invariant 1: a viewed conversation inside the page is not lifted", () => {
	const rows = Array.from({ length: 60 }, (_, index) =>
		row(`s${index}`, SECONDS(index + 1)),
	);
	const page = pageRows(rows, { limit: 25, currentId: "s3" });
	assert.equal(page.lifted, false);
	assert.equal(page.rows.length, 25);
	assert.equal(page.rows[3].session_id, "s3");
});

/*
 * INVARIANT 2 - a search looks at everything, not at the loaded page.
 *
 * The search itself is the backend's (`chat-search.ts` joins its answer to the
 * rows on screen), and the page is what makes this hard: a match at position
 * 300 of 400 conversations is a row the page would never have loaded. Under a
 * query the limit does not apply, which is the only reading of "search should
 * still be able to search and find" that can find it.
 */
test("invariant 2: a search reaches past the page and reveals an unloaded match", () => {
	const rows = Array.from({ length: 60 }, (_, index) =>
		row(`s${index}`, SECONDS(index + 1)),
	);
	const hidden = rows[42];
	const paged = pageRows(rows, { limit: 10, currentId: null });
	assert.equal(
		paged.rows.some((entry) => entry.session_id === hidden.session_id),
		false,
		"without a query the match is outside the page",
	);
	const searched = pageRows(rows, {
		limit: 10,
		currentId: null,
		searching: true,
	});
	assert.equal(searched.rows.length, 60);
	assert.equal(
		searched.rows.some((entry) => entry.session_id === hidden.session_id),
		true,
		"a query admits every row the search matched",
	);
	assert.equal(searched.lifted, false, "nothing needs lifting while searching");
});

/*
 * INVARIANT 3 - the rows READ in the order their time labels imply, which
 * REPLACED "the active rows sit above the rest without inverting recency" on
 * 2026-10-08 at the operator's instruction. The old shape lifted running rows
 * and left everything else in the catalogue's arrival order - which is CREATION
 * order (`session/catalog.py` ranks `(tier, wake band, -created_at, id)`) - so a
 * conversation created days ago and answered an hour ago printed `1h` under
 * rows that printed `6d`. The three tests below are the reversal's three
 * clauses: the lift, the clock beneath it, and the running rows' own key.
 */
test("invariant 3: running rows lead, and every row below them is newest-first", () => {
	const rows = [
		row("today", SECONDS(1)),
		row("older", SECONDS(100)),
		row("busy", SECONDS(200), "busy"),
		row("yesterday", SECONDS(30)),
		row("answer", SECONDS(300), "answer"),
	];
	const ordered = pageOrder(rows, "active-first", "active");
	assert.deepEqual(
		ordered.map((entry) => entry.session_id),
		["answer", "busy", "today", "yesterday", "older"],
		/*
		 * THE NEEDS-YOU ROW IS THE LIFT'S FIRST BAND - `answer` reads older than
		 * `busy` on the activity clock (300h against 200h) and still leads it, because
		 * a turn stopped on the reader is the one thing they must act on. Below the
		 * lift the clock runs: today 1h, yesterday 30h, older 100h.
		 */
		"the lift leads, then the basis's clock decides",
	);
	assert.equal(isActiveRow(rows[2]), true);
	assert.equal(isActiveRow(rows[0]), false);
});

test("invariant 3: an explicit recency order does not lift, and keys running rows by their own clock", () => {
	const rows = [
		row("a", SECONDS(1)),
		row("busy", SECONDS(200), "busy"),
		row("b", SECONDS(2)),
	];
	/*
	 * `recent` is ONE order over every row: no lift at all. The running row is
	 * still keyed by `runningOrderMs` rather than by its activity - with no
	 * `last_user_at` and no `created_at` in this fixture it has NO key, which sorts
	 * it last, and that is the rule rather than an artifact: a running row is
	 * never re-sorted by a response landing.
	 */
	assert.deepEqual(
		pageOrder(rows, "recent", "active").map((entry) => entry.session_id),
		["a", "b", "busy"],
		"no lift, the clock decides, and a keyless running row sorts last",
	);
	// With a last USER message the running row takes its place in the same order -
	// this is the operator's "send a more recent message and it pops to the top".
	const withMessage = [
		row("a", SECONDS(1)),
		{ ...row("busy", SECONDS(200), "busy"), last_user_at: SECONDS(0.1) },
		row("b", SECONDS(2)),
	];
	assert.deepEqual(
		pageOrder(withMessage, "recent", "active").map((entry) => entry.session_id),
		["busy", "a", "b"],
	);
});

test("the page is cut from the ARRANGED list, never the other way round", () => {
	// Three active rows out of order among six, and the page below a limit that
	// cuts in the middle of the active block: every active row is still drawn.
	const rows = [
		row("a", SECONDS(1)),
		row("busy1", SECONDS(50), "busy"),
		row("b", SECONDS(2)),
		row("busy2", SECONDS(51), "delegating"),
		row("c", SECONDS(3)),
		row("busy3", SECONDS(52), "wedged"),
	];
	const page = pageRows(pageOrder(rows, "active-first", "active"), {
		limit: 10,
		currentId: null,
	});
	assert.deepEqual(
		page.rows.slice(0, 3).map((entry) => entry.session_id),
		["busy1", "busy2", "busy3"],
	);
});

test("grouping by agent names the unbound rows rather than dropping them", () => {
	const rows = [
		{ ...row("one", SECONDS(1)), binding: { agent: "docs-writer" } },
		{ ...row("two", SECONDS(2)), binding: { agent: "docs-writer" } },
		{ ...row("three", SECONDS(3)), binding: { team: "chat-redesign" } },
		row("four", SECONDS(4)),
	];
	const groups = groupRows(rows, "agent");
	assert.deepEqual(
		groups.map((entry) => entry.label),
		["docs-writer", "chat-redesign", "Ungrouped"],
	);
	assert.equal(groups[0].rows.length, 2);
	assert.equal(groups[2].rows.length, 1, "an unbound row is still a row");
	// Flat is one group with no label; the component draws no header for it, and
	// the empty label is how it knows.
	const flat = groupRows(rows, "flat");
	assert.equal(flat.length, 1);
	assert.equal(flat[0].rows.length, 4);
	assert.equal(flat[0].label, "");
});

test("the section grouping is the list's own, not a second partition", () => {
	const rows = [row("x", SECONDS(1)), row("busy", SECONDS(9), "busy")];
	assert.equal(
		groupRows(rows, "section"),
		null,
		"the section arrangement is `chat-list-sections.ts`'s, and this returns nothing rather than a second copy of it",
	);
	// The arrangement the null defers to, driven through the module that owns it,
	// so the deferral is a fact about the shipped code and not about a stub.
	const sectioned = sectionRows(rows, NOW, "active");
	assert.deepEqual(
		sectioned.running.map((entry) => entry.session_id),
		["busy"],
	);
	assert.deepEqual(
		sectioned.today.map((entry) => entry.session_id),
		["x"],
	);
});

test("every chat-list section has a place in the view's canonical order", () => {
	// A section added to `chat-list-sections.ts` without a place here would be
	// drawn by nothing and switchable by nothing, which is the silent half of a
	// missing feature: the rows would simply stop appearing.
	for (const key of CHAT_LIST_SECTIONS) {
		assert.ok(
			SIDEBAR_SECTIONS.includes(key),
			`${key} is a chat-list section with no key in SIDEBAR_SECTIONS`,
		);
		assert.ok(SIDEBAR_SECTION_LABEL[key], `${key} has no label`);
		assert.equal(isEntitySection(key), false);
	}
	assert.equal(SIDEBAR_SECTIONS[0], "pinned");
	assert.deepEqual(
		ENTITY_SECTIONS.slice(),
		["agents", "teams"],
		"the two entity sections are the ones the AGENTS/TEAMS region draws",
	);
});

test("hiding a section is reversible and never empties the column", () => {
	const hidden = toggleSection(DEFAULT_SIDEBAR_VIEW, "week");
	assert.equal(isSectionShown(hidden, "week"), false);
	assert.equal(shownSections(hidden).length, SIDEBAR_SECTIONS.length - 1);
	const restored = toggleSection(hidden, "week");
	assert.deepEqual(restored.hidden, []);
	for (const key of SIDEBAR_SECTIONS) {
		assert.equal(isSectionShown(restored, key), true);
	}
});

test("reordering moves the section the reader can see, past a hidden one", () => {
	const view = {
		...DEFAULT_SIDEBAR_VIEW,
		hidden: ["week"],
	};
	const moved = moveSection(view, "older", -1);
	assert.deepEqual(
		shownSections(moved),
		["pinned", "running", "older", "today", "agents", "teams"],
		"older rose past today, because this week's section is not on screen",
	);
	assert.equal(
		new Set(moved.order).size,
		SIDEBAR_SECTIONS.length,
		"the order is still a permutation of every section",
	);
});

test("reordering at an end is a no-op rather than a wrap", () => {
	const first = moveSection(DEFAULT_SIDEBAR_VIEW, "pinned", -1);
	assert.deepEqual(first.order, DEFAULT_SIDEBAR_VIEW.order);
	const last = moveSection(DEFAULT_SIDEBAR_VIEW, "teams", 1);
	assert.deepEqual(last.order, DEFAULT_SIDEBAR_VIEW.order);
	const unknown = moveSection(DEFAULT_SIDEBAR_VIEW, "nope", 1);
	assert.deepEqual(unknown.order, DEFAULT_SIDEBAR_VIEW.order);
});

test("a stored view is normalised, never trusted", () => {
	const parsed = parseSidebarView({
		hidden: ["week", "week", "nonsense", 7],
		order: ["teams", "nonsense", "agents", "teams"],
		groupBy: "agent",
		orderBy: "recent",
		loads: 3.9,
	});
	assert.deepEqual(parsed.hidden, ["week"], "duplicates and non-sections drop");
	assert.deepEqual(
		parsed.order.slice(0, 2),
		["teams", "agents"],
		"the stored order leads",
	);
	assert.deepEqual(
		parsed.order.slice().sort(),
		SIDEBAR_SECTIONS.slice().sort(),
		"and the sections it forgot are appended",
	);
	assert.equal(parsed.groupBy, "agent");
	assert.equal(parsed.orderBy, "recent");
	assert.equal(parsed.loads, 3);
});

test("an unreadable or tampered view draws the column nobody has configured", () => {
	assert.deepEqual(parseSidebarView(null), DEFAULT_SIDEBAR_VIEW);
	assert.deepEqual(parseSidebarView("week"), DEFAULT_SIDEBAR_VIEW);
	assert.deepEqual(
		parseSidebarView({
			groupBy: "workspace",
			orderBy: "manual",
			hidden: "week",
		}),
		DEFAULT_SIDEBAR_VIEW,
		"an unknown option falls back on its own axis rather than dropping the view",
	);
	assert.equal(parseSidebarView({ loads: -3 }).loads, 0);
	assert.equal(parseSidebarView({ loads: Number.NaN }).loads, 0);
	assert.equal(
		parseSidebarView({ loads: Number.POSITIVE_INFINITY }).loads,
		0,
		"an infinite page is refused rather than clamped to a row count",
	);
	/*
	 * R13 (review round 3): a FINITE absurd counter used to pass through, and the
	 * ladder's own arithmetic then overflowed into `Infinity - Infinity` - the foot
	 * control printed `Show NaN more chats`. Clamped to the store's own 500-row page
	 * cap, which is the largest read this list can honestly ask for.
	 */
	assert.equal(
		parseSidebarView({ loads: 1e9 }).loads,
		500,
		"a tampered click counter is clamped to the store's page cap",
	);
	assert.equal(parseSidebarView({ loads: 1e308 }).loads, 500);
	assert.equal(
		pageMoreLabel(parseSidebarView({ loads: 1e308 }).loads, 40),
		"Show 40 more chats",
		"and the foot it feeds names a count rather than `NaN` (the R13 symptom)",
	);
	assert.deepEqual(DEFAULT_SIDEBAR_VIEW.hidden, []);
	assert.equal(DEFAULT_SIDEBAR_VIEW.groupBy, "section");
	assert.equal(DEFAULT_SIDEBAR_VIEW.basis, "active");
	assert.equal(DEFAULT_SIDEBAR_VIEW.orderBy, "active-first");
	assert.equal(DEFAULT_SIDEBAR_VIEW.loads, 0);
});

/*
 * THE PINNED ROSTER'S STORED LIST (issue #663), parsed on its own axis like
 * every other field: a blob from before the field existed yields no pins, and a
 * tampered one degrades per ENTRY - non-strings and empties dropped, duplicates
 * collapsed, the count clamped to `PINNED_AGENTS_MAX` - rather than taking the
 * view down with it. The keys are opaque HERE (the roster they name is not
 * loaded at parse time), so a pin that names no row survives and is inert:
 * that is the difference between a preference that has outlived an agent and a
 * defect.
 */
test("a stored view without pins parses to none, and a tampered list degrades field-wise", () => {
	assert.deepEqual(
		parseSidebarView({}).pinnedAgents,
		[],
		"a blob from before the field existed means no pins",
	);
	assert.deepEqual(parseSidebarView({ pinnedAgents: "kept" }).pinnedAgents, []);
	assert.deepEqual(
		parseSidebarView({ pinnedAgents: ["kept", 7, null, "kept", "second", ""] })
			.pinnedAgents,
		["kept", "second"],
		"strings only, deduped, empties dropped",
	);
	const many = Array.from({ length: 80 }, (_, index) => `agent-${index}`);
	assert.equal(
		parseSidebarView({ pinnedAgents: many }).pinnedAgents.length,
		PINNED_AGENTS_MAX,
		"the count is clamped rather than trusted",
	);
	assert.deepEqual(DEFAULT_SIDEBAR_VIEW.pinnedAgents, []);
});

test("the time basis parses like the other two choices: stored, validated, defaulted", () => {
	assert.equal(parseSidebarView({ basis: "created" }).basis, "created");
	assert.equal(
		parseSidebarView({ basis: "modified" }).basis,
		"active",
		"a basis this build cannot name falls back to the default rather than emptying the field",
	);
	assert.equal(parseSidebarView({ basis: 7 }).basis, "active");
});

test("a reorder pair is offered only where a press can land (D1)", () => {
	/*
	 * The defect this pins, measured on the operator's panel: Pinned draws first
	 * whatever the stored order says, and the entity region draws in fixed source
	 * order, so a pair on either moved the stored order and the popover while the
	 * column it describes stood still. The pair is drawn on the chat sections
	 * alone, and enabled only when the adjacent SHOWN section in that direction is
	 * another chat section.
	 */
	for (const key of ["pinned", "agents", "teams"]) {
		assert.equal(
			canMoveSection(DEFAULT_SIDEBAR_VIEW, key, -1),
			false,
			`${key} must offer no up`,
		);
		assert.equal(
			canMoveSection(DEFAULT_SIDEBAR_VIEW, key, 1),
			false,
			`${key} must offer no down`,
		);
	}
	// The default order's interior chat neighbours: running/down, today/both, week/up.
	assert.equal(canMoveSection(DEFAULT_SIDEBAR_VIEW, "running", 1), true);
	assert.equal(canMoveSection(DEFAULT_SIDEBAR_VIEW, "today", -1), true);
	assert.equal(canMoveSection(DEFAULT_SIDEBAR_VIEW, "today", 1), true);
	assert.equal(canMoveSection(DEFAULT_SIDEBAR_VIEW, "week", -1), true);
	// The edges: Pinned above running, the entity region below Older.
	assert.equal(canMoveSection(DEFAULT_SIDEBAR_VIEW, "running", -1), false);
	assert.equal(canMoveSection(DEFAULT_SIDEBAR_VIEW, "older", 1), false);
});

test("an empty section cannot move, and nothing moves against one (round 1's m1/U1)", () => {
	/*
	 * THE DEFECT THIS PINS, driven end to end in round 1: with a store whose only
	 * row sits in Today, `This week` is shown but draws no rows (an empty chat
	 * section contributes no label), and `Move Today down` was enabled - pressing
	 * it rewrote the stored order and the panel's own list while the column the
	 * reader was watching stood still. The mirror is an empty SOURCE: pressing an
	 * empty section's own arrow at a drawn neighbour is equally invisible, because
	 * the section being moved contributed nothing to the drawn sequence either
	 * way. So the predicate asks BOTH ends - the section being moved and the
	 * adjacent shown section in that direction must both draw - and with no
	 * predicate (a caller with no rows to point at) the geometric rule stands.
	 */
	const draws = (drawn) => (key) => drawn.includes(key);
	assert.equal(
		canMoveSection(
			DEFAULT_SIDEBAR_VIEW,
			"today",
			1,
			draws(["running", "today"]),
		),
		false,
		"today cannot move against an empty week",
	);
	assert.equal(
		canMoveSection(
			DEFAULT_SIDEBAR_VIEW,
			"running",
			1,
			draws(["today", "week"]),
		),
		false,
		"an empty section cannot move at all",
	);
	assert.equal(
		canMoveSection(
			DEFAULT_SIDEBAR_VIEW,
			"today",
			1,
			draws(["running", "today", "week"]),
		),
		true,
		"both ends drawn: the press is real",
	);
	assert.equal(
		canMoveSection(DEFAULT_SIDEBAR_VIEW, "today", 1),
		true,
		"no predicate: the geometric rule alone",
	);
});

test("a hidden section cannot move, and a hidden neighbour makes a new one adjacent", () => {
	const hidden = toggleSection(DEFAULT_SIDEBAR_VIEW, "today");
	assert.equal(
		canMoveSection(hidden, "today", -1),
		false,
		"a section that is not drawn has no up",
	);
	// With today hidden, running's shown down-neighbour is week - still a chat section.
	assert.equal(canMoveSection(hidden, "running", 1), true);
	const shuffled = {
		...DEFAULT_SIDEBAR_VIEW,
		order: ["pinned", "running", "agents", "today", "week", "older", "teams"],
	};
	assert.equal(
		canMoveSection(shuffled, "today", -1),
		false,
		"its shown up-neighbour is an entity row",
	);
	assert.equal(canMoveSection(shuffled, "today", 1), true);
});

test("the component draws the band's controls and the popover's four groups", () => {
	// The markup assertions this suite can make about a component it cannot
	// render: the three icon-only buttons exist, each is named for a screen
	// reader, and each of the popover's groups is drawn. A control that lost its
	// `aria-label` would be an unlabelled button, and that is a real regression
	// rather than a style question - so it is pinned here beside the menu's
	// presence, which is the part a driver frame cannot read.
	//
	// TWO FILES, because the band and the panel are two: the band is drawn by the
	// sidebar (which cannot be rendered here) and the panel by
	// `chat-sidebar-view-menu.tsx` (which can, and is what the design round's
	// story renders). Asserting both from one place is what keeps a control from
	// being deleted from one half without this file noticing.
	const source = readFileSync(SIDEBAR, "utf8");
	const menu = readFileSync(
		"src/renderer/src/features/chat/components/chat-sidebar-view-menu.tsx",
		"utf8",
	);
	for (const hook of [
		"data-sidebar-band",
		"data-sidebar-view-options",
		"data-sidebar-create",
		"data-sidebar-page-more",
		"data-sidebar-open-agent",
	]) {
		assert.ok(source.includes(hook), `${hook} is not drawn`);
	}
	for (const label of ["Group by", "Time basis", "Order by", "Sections"]) {
		assert.ok(
			menu.includes(`"${label}"`) || menu.includes(`>${label}<`),
			`the view popover draws no ${label} group`,
		);
	}
	for (const hook of [
		"data-sidebar-view-choice",
		"data-sidebar-view-basis",
		"data-sidebar-view-section",
		"data-sidebar-view-move",
	]) {
		assert.ok(menu.includes(hook), `${hook} is not drawn`);
	}
	assert.ok(
		menu.includes("basis: option.key"),
		"the Time basis rows do not write the view's basis on press",
	);
	assert.ok(
		source.includes('navigate("/agents?create=agent")') &&
			source.includes('navigate("/agents?create=team")'),
		"the create menu is not wired to the two existing authoring flows",
	);
	assert.ok(
		source.includes('aria-label="Search chats and agents"'),
		"the band's search control has no accessible name",
	);
	assert.ok(
		source.includes('aria-label="Open agent…"'),
		"the band's agent jump has no accessible name",
	);
});

/*
 * THE AGENT JUMP'S SEED (issue #663): the band control opens the palette and
 * writes the agents-scope seed, in that order.
 *
 * WHAT THIS FILE CAN SAY about it: the two writes exist at the control's own
 * anchor and in the order the store's shapes want - `openCommandPalette`
 * raises the flag and does not touch the query, and the seed is written after
 * it, so both land in the one commit the palette's open-time sync reads. What
 * the seed MEANS is `palette-search.ts`'s table and is pinned in
 * `scripts/palette-search.test.mjs`; that the palette then renders seeded is
 * the story's frame and QA's walk.
 */
test("the band's agent jump opens the palette and seeds it to the agent scope", () => {
	const source = readFileSync(SIDEBAR, "utf8");
	const at = source.indexOf("data-sidebar-open-agent");
	assert.notEqual(at, -1, "the band's Open agent… control is gone");
	const control = source.slice(at, at + 1_800);
	assert.ok(
		control.includes("openCommandPalette()") &&
			control.includes("setCommandPaletteQuery(AGENT_ROSTER_SEED)"),
		"the control no longer opens the palette seeded to the agents scope",
	);
	assert.ok(
		control.indexOf("openCommandPalette()") <
			control.indexOf("setCommandPaletteQuery("),
		"the order fails: `openCommandPalette()` must come before `setCommandPaletteQuery(...)`, so both writes land in the one commit the palette's open-time sync reads",
	);
});

/*
 * THE ROSTER FILTER'S LIFECYCLE (issue #663, remediation round 1): the filter
 * may narrow the section only while its FIELD is drawn. Design round 1 (D2),
 * the agent review (B3) and the UX walk (U3) filed one defect three ways - a
 * stored filter outliving its field (collapse Agents and type in the list
 * search, which force-opens the rows; or let the roster shrink to the cap) and
 * silently narrowing a list whose control was not on screen.
 *
 * WHAT THIS FILE CAN SAY about a component it cannot render: the gate and the
 * branch are ONE expression each way - `rosterFilterShown` (the field's own
 * render gate) is what the rows branch reads, and the field's gate answers
 * "cap-bound OR filter applied", so the pair cannot come apart. The behaviour
 * the pair produces is the story set's frames and QA's walk.
 */
test("the roster filter narrows only while its field is drawn", () => {
	const source = readFileSync(SIDEBAR, "utf8");
	/*
	 * THE CAP TERM NOW LIVES IN THE MODULE (the gate's own file), because the rule was
	 * hoisted so it could be driven rather than read (U2). Read it where it lives.
	 */
	assert.ok(
		readFileSync(
			"src/renderer/src/features/chat/chat-sidebar-view.ts",
			"utf8",
		).includes(
			'(rosterLength > SIDEBAR_SECTION_ROWS || rosterFilter.trim() !== "")',
		),
		"the field's gate no longer keeps a filter's own field alive",
	);
	assert.ok(
		source.includes("rosterFilterShown && rosterFilter.trim()"),
		"the rows branch narrows on the filter alone, so a stored filter can outlive its field",
	);
	assert.ok(
		source.includes("data-roster-filter"),
		"the roster field has no stable hook for the keyboard walk",
	);
});

test("the empty sentence counts the rows that draw, not the matches", () => {
	const source = readFileSync(SIDEBAR, "utf8");
	assert.ok(
		source.includes("drawnFilteredAgents.length > 0"),
		"the sentence still tests the matches, so a list query can blank the section silently",
	);
	assert.ok(
		source.includes("entityQueryAdmits(") &&
			source.includes('scopeRows("agent", row.name).length'),
		"the drawn set is not computed with the row gate's own rule",
	);
});

/*
 * THE PIN CONTROL'S CONTRACT (agent review's B2, UX's U7/U8, design's D7): the
 * label names the SUBJECT and is constant, the state is `aria-pressed`, and the
 * tooltip is the app's own component rather than a native `title`.
 */
test("the pin's label is the subject and the state is aria-pressed", () => {
	const source = readFileSync(SIDEBAR, "utf8");
	const at = source.indexOf("data-agent-pin={pinKey}");
	assert.notEqual(at, -1, "the roster's pin control is gone");
	/*
	 * THE SLICE IS ANCHORED AT THE TOOLTIP, because the absence it asserts
	 * (`title=`) is only meaningful over this control: the slice must start at
	 * the pin's own wrapper, not at an offset that could swallow the name
	 * button's `title` above it (which is deliberate - a truncated name needs
	 * one - and would fail this test for the wrong reason). If the wrapper is
	 * ever dropped, the anchor walks back to some distant Tooltip and the
	 * distance check below fails as "not wrapped", which is the finding.
	 */
	const tooltipAt = source.lastIndexOf("<Tooltip", at);
	assert.ok(
		at - tooltipAt < 600,
		"the pin is not wrapped in the app's own Tooltip",
	);
	const control = source.slice(tooltipAt, at + 900);
	assert.ok(
		control.includes("aria-label={`Pin “${name}”`}"),
		"the pin's label no longer names the agent it pins",
	);
	assert.ok(
		control.includes("aria-pressed={pinnedAgent}"),
		"the pin's state left aria-pressed",
	);
	assert.ok(
		!control.includes("title="),
		"the pin carries a native title again beside the app's Tooltip",
	);
});

/*
 * THE TWO ENTITY SECTIONS OBEY THE POPOVER LIKE EVERY OTHER SECTION.
 *
 * The operator's report (2026-09-27), verbatim: "I unchecked the Agents section
 * from the view settings and that section still seems to be there". The tick
 * went out and the panel's own "1 section hidden" sentence appeared, while the
 * region below kept drawing the row - both halves of one frame disagreeing
 * about one state.
 *
 * WHICH SIDE WAS WRONG, because it decides the shape of the fix: the WRITE
 * reached the store (the panel's tick and its sentence are read from that same
 * `view.hidden`), and the READ half of the region simply never asked. The
 * chats list asked (`drawnSections`), which is why its six sections hid
 * correctly while these two did not - one code path, two callers, one of them
 * missing.
 *
 * THE MODEL HALF is asserted first: an entity key is an ordinary member of
 * `hidden`, survives the store's own parse, and is claimed by the same
 * `isSectionShown` the switch's tick reads.
 */
test("an entity section is hidden by the same field as a chat section", () => {
	const stored = parseSidebarView({ hidden: ["agents"] });
	assert.deepEqual(
		stored.hidden,
		["agents"],
		"a stored entity key is not discarded on the way in",
	);
	assert.equal(isSectionShown(stored, "agents"), false);
	assert.equal(shownSections(stored).includes("agents"), false);
	const restored = toggleSection(stored, "agents");
	assert.equal(isSectionShown(restored, "agents"), true);
});

/*
 * THE COMPONENT HALF, read rather than rendered: the sidebar cannot be mounted
 * by this suite (the module's own header says why), so the gate is asserted
 * where it is written. Each entity heading must sit behind
 * `isSectionShown(view, <key>)` - the call the popover's switch reads - and the
 * assertion is a window AROUND the heading call rather than a substring search
 * of the whole file, so a gate copied elsewhere cannot stand in for this one.
 * It fails on the revision the operator reported: no such gate existed, so the
 * window held no match.
 */
test("the AGENTS/TEAMS region draws each entity row behind the view's own gate", () => {
	const source = readFileSync(SIDEBAR, "utf8");
	for (const key of ENTITY_SECTIONS) {
		/*
		 * A WINDOW AROUND THE CALL, MATCHED TOLERANTLY (agent review round 2, R2-2).
		 * The literal `{heading("agents", ` was a stale pin the moment the call had to
		 * carry the hub heading controls and was broken across lines; the gate it
		 * guards is the `isSectionShown` call beside it, so the anchor is the CALL
		 * (whitespace-tolerant) rather than one spelling of its arguments.
		 */
		const at = source.search(new RegExp(`heading\\(\\s*"${key}"`));
		assert.ok(at > 0, `the ${key} section's heading call is gone`);
		const window = source.slice(Math.max(0, at - 600), at);
		assert.ok(
			window.includes(`isSectionShown(view, "${key}") && (`),
			`${key} is drawn without asking the view, so the popover's switch cannot hide it`,
		);
	}
});

/*
 * THE PINNED ROWS RIDE IN A GROUPED LIST TOO.
 *
 * `Group by` is one of the popover's promises and it is a LAYOUT: switching it
 * must not change which conversations are drawn. Grouping by agent or
 * flattening handed `groupRows` the page alone, and `Pinned` is only drawn
 * under the section arrangement - so every pinned chat disappeared from the
 * column, silently, on a press that claims to rearrange it. Asserted as source
 * because the fix is which array the component passes (the rule itself is
 * `groupRows`'s, and the suite above already pins that it keeps every row it is
 * given).
 */
test("a grouped list is the page plus the pinned rows, never the page alone", () => {
	const source = readFileSync(SIDEBAR, "utf8");
	assert.ok(
		source.includes("groupRows([...pinned, ...pagedRows], view.groupBy)"),
		"the grouped arrangement drops the pinned rows, so grouping acts as a filter",
	);
});

/*
 * PERSISTENCE, per control, and stated apart from whether the control works.
 *
 * A setting that works until the app restarts is a different bug from one that
 * never works, and the popover's controls all ride ONE persisted object
 * (`chatSidebarView`): the module's `toggleSection`/`moveSection` and the two
 * single-choice writes each return a complete next view, the store keeps the
 * whole object, and a launch rehydrates it through `parseSidebarView`. So the
 * instrument is a write of the shape the panel makes, the bytes the persist
 * middleware leaves behind, and a parse of those bytes - the same round trip
 * `chat-sidebar-sections.test.mjs` takes for the dragged height, and the one
 * half of this audit a mounted frame cannot show (Storybook never reloads the
 * page a play function drove).
 */
test("every view setting the popover writes survives a relaunch", () => {
	memory.clear();
	const store = useUiPreferencesStore;
	// One press, per control, in the panel's own spelling.
	const hidden = toggleSection(DEFAULT_SIDEBAR_VIEW, "agents");
	const moved = moveSection(hidden, "today", 1);
	const grouped = { ...moved, groupBy: "flat" };
	const ordered = { ...grouped, orderBy: "recent" };
	// The pin is the roster's own field and rides the same object: one press, in
	// the module's own spelling, so the relaunch below proves it comes back.
	const pinned = togglePinnedAgent(ordered, "release-captain");
	store.getState().setChatSidebarView(pinned);
	// The store is the writer, and the filter the middleware keeps is the one it
	// ships: assert the field is IN the persisted blob rather than assuming it.
	assert.deepEqual(
		persistedUiPreferences(store.getState()).chatSidebarView,
		pinned,
	);
	// The bytes on disk, parsed the way the next launch parses them.
	const key = [...memory.keys()].find((entry) => {
		try {
			return JSON.parse(memory.get(entry)).state?.chatSidebarView !== undefined;
		} catch {
			return false;
		}
	});
	assert.ok(key, "the store wrote a key carrying the sidebar's view");
	const relaunched = parseSidebarView(
		JSON.parse(memory.get(key)).state.chatSidebarView,
	);
	assert.deepEqual(
		relaunched.hidden,
		["agents"],
		"the hidden section came back",
	);
	assert.equal(isSectionShown(relaunched, "agents"), false);
	assert.deepEqual(relaunched.order, ordered.order, "the reorder came back");
	assert.equal(relaunched.groupBy, "flat", "the grouping came back");
	assert.equal(relaunched.orderBy, "recent", "the ordering came back");
	assert.deepEqual(
		relaunched.pinnedAgents,
		["release-captain"],
		"the pin came back",
	);
	// And the one control with a non-default value nothing else writes: the page
	// ladder, whose counter is the only field that can only ever grow.
	store.getState().setChatSidebarView({ ...relaunched, loads: 2 });
	const again = parseSidebarView(
		JSON.parse(memory.get(key)).state.chatSidebarView,
	);
	assert.equal(again.loads, 2, "the page rung came back");
	assert.equal(pageLimit(again.loads), CHAT_PAGE_STEPS[1]);
});
