import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

// The join between the backend's search answer and the list a user sees. Pure
// and synchronous, so it is exercised here in memory rather than through a
// browser: this is deterministic state evidence about which rows a query keeps,
// in what order, and which ones need to say why they are there.
const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/chat-search";\n' +
			// The contract's own bound, re-exported through the SAME bundle rather
			// than a second import: the rule's default argument IS this constant, and
			// a test that hard-coded 256 would keep passing while the constant it is
			// supposed to follow moved.
			'export { SESSION_SEARCH_MAX_CHARS } from "./src/shared/desktop-contract";',
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
	chatCountAnnouncement,
	lostRowsToStaleAnswer,
	rowTrailingStatement,
	effectiveSearchQuery,
	searchAnswerIsClipped,
	searchQueryExceedsLimit,
	SESSION_RANK_NAME,
	SESSION_RANK_ID,
	SESSION_RANK_BODY,
	SESSION_RANK_SOFT,
	SESSION_RANK_LABEL,
	SESSION_SEARCH_MAX_CHARS,
	matchesLabel,
	searchChats,
	hitsAnswerQuery,
} = module;

const row = (session_id, title, { agent = null, team = null } = {}) => ({
	session_id,
	title,
	binding: { agent, team },
});

const hit = (
	id,
	rank,
	body_match = false,
	name = "name",
	pinned = undefined,
) => ({
	id,
	name,
	mtime: 1,
	forked: false,
	rank,
	body_match,
	...(pinned === undefined ? {} : { pinned }),
});

test("the client's own pin fact outranks the cached answer on a hit the catalogue does not carry", () => {
	// A conversation past the catalogue page reaches this panel only as a hit, and the answer
	// is what the SEARCH last saw - so after a press the row it draws would report the state
	// the press already applied, and the next press would re-send it (QA round 2, Qr2-1).
	const rows = [row("aaaaaaaaaaaa", "One")];
	const cached = [
		hit("bbbbbbbbbbbb", SESSION_RANK_NAME, false, "Sweep 001", false),
	];

	const asAnswered = searchChats(rows, "Sweep 001", cached);
	assert.deepEqual(
		asAnswered.rows.map((item) => [item.session_id, item.pinned]),
		[["bbbbbbbbbbbb", false]],
	);

	// The fact wins, in both directions: it is what the control renders and what a press
	// inverts, so a press made after a pin sends `false` rather than the applied `true`.
	const pinned = searchChats(rows, "Sweep 001", cached, { bbbbbbbbbbbb: true });
	assert.deepEqual(
		pinned.rows.map((item) => [item.session_id, item.pinned]),
		[["bbbbbbbbbbbb", true]],
	);
	const unpinned = searchChats(rows, "Sweep 001", cached, {
		bbbbbbbbbbbb: false,
	});
	assert.deepEqual(
		unpinned.rows.map((item) => [item.session_id, item.pinned]),
		[["bbbbbbbbbbbb", false]],
	);

	// A hit the backend does not describe, with no fact, is still no claim: the sidebar reads
	// the absence as "unknown" and withholds the control (QA round 1, Q1).
	const silent = searchChats(rows, "Sweep 001", [
		hit("bbbbbbbbbbbb", SESSION_RANK_NAME, false, "Sweep 001"),
	]);
	assert.equal("pinned" in silent.rows[0], false);
});

test("an empty query is not a search", () => {
	const rows = [row("aaaaaaaaaaaa", "One"), row("bbbbbbbbbbbb", "Two")];
	const outcome = searchChats(rows, "", [
		hit("aaaaaaaaaaaa", SESSION_RANK_BODY),
	]);

	// Every row, in the order the catalogue had them: a blank box is a list, not
	// a filter, and a leftover answer must not narrow it.
	assert.deepEqual(outcome.rows, rows);
	assert.equal(outcome.conversationMatches.size, 0);
});

test("a conversation match is admitted, ordered by relevance, and says why", () => {
	const rows = [
		row("aaaaaaaaaaaa", "Unrelated opener", { agent: "coder" }),
		row("bbbbbbbbbbbb", "Retention sweep design", { agent: "coder" }),
		row("cccccccccccc", "Something else entirely", { agent: "coder" }),
	];
	// Newest first, and the newest row matches only on its conversation.
	const outcome = searchChats(rows, "retention", [
		hit("aaaaaaaaaaaa", SESSION_RANK_BODY, true),
		hit("bbbbbbbbbbbb", SESSION_RANK_NAME),
	]);

	assert.deepEqual(
		outcome.rows.map((entry) => entry.session_id),
		// The name tier outranks the body tier, whichever is newer.
		["bbbbbbbbbbbb", "aaaaaaaaaaaa"],
	);
	assert.deepEqual([...outcome.conversationMatches], ["aaaaaaaaaaaa"]);
});

test("a row nothing matched is dropped", () => {
	const rows = [row("aaaaaaaaaaaa", "One"), row("bbbbbbbbbbbb", "Two")];
	const outcome = searchChats(rows, "zzz", [
		hit("aaaaaaaaaaaa", SESSION_RANK_SOFT, true),
	]);

	assert.deepEqual(
		outcome.rows.map((entry) => entry.session_id),
		["aaaaaaaaaaaa"],
	);
});

test("an agent or team name is a label hit, at the name tier", () => {
	const rows = [
		row("aaaaaaaaaaaa", "Some chat", { agent: "architect" }),
		row("bbbbbbbbbbbb", "architect notes", { agent: "coder" }),
		row("cccccccccccc", "Unrelated", { agent: "coder", team: "release-pod" }),
	];
	// No backend answer at all: the sidebar still finds chats by what it shows.
	const outcome = searchChats(rows, "architect", null);

	assert.deepEqual(
		outcome.rows.map((entry) => entry.session_id),
		["aaaaaaaaaaaa", "bbbbbbbbbbbb"],
	);
	assert.equal(SESSION_RANK_LABEL, SESSION_RANK_NAME);
	assert.equal(outcome.conversationMatches.size, 0);
	assert.ok(matchesLabel(rows[2], "release-pod"));
});

test("the conversation marker comes from the answer, never from a local label hit", () => {
	const rows = [row("aaaaaaaaaaaa", "Some chat", { agent: "architect" })];

	// A local label hit is a hit on something already visible: no marker.
	assert.equal(
		searchChats(rows, "architect", null).conversationMatches.size,
		0,
	);

	// The backend says the row came up on its conversation, and the query is not
	// in anything the row shows: mark it, because nothing visible explains why it
	// is in the results.
	assert.deepEqual(
		[
			...searchChats(rows, "classifer", [
				hit("aaaaaaaaaaaa", SESSION_RANK_BODY, true),
			]).conversationMatches,
		],
		["aaaaaaaaaaaa"],
	);

	// The backend says the row's own NAME explained it: no marker, even though
	// the answer carried a hit.
	assert.equal(
		searchChats(rows, "some", [hit("aaaaaaaaaaaa", SESSION_RANK_NAME, false)])
			.conversationMatches.size,
		0,
	);
});

test("rows of equal relevance keep the catalogue's order", () => {
	const rows = [
		row("aaaaaaaaaaaa", "retention one"),
		row("bbbbbbbbbbbb", "retention two"),
		row("cccccccccccc", "retention three"),
	];
	const outcome = searchChats(rows, "retention", [
		hit("cccccccccccc", SESSION_RANK_NAME),
		hit("bbbbbbbbbbbb", SESSION_RANK_NAME),
		hit("aaaaaaaaaaaa", SESSION_RANK_NAME),
	]);

	// Stable: the scores tie, so the input order (newest first) survives rather
	// than the order the hits happened to arrive in.
	assert.deepEqual(
		outcome.rows.map((entry) => entry.session_id),
		["aaaaaaaaaaaa", "bbbbbbbbbbbb", "cccccccccccc"],
	);
});

test("a tie is broken by recency, including for a row the client cannot place", () => {
	// `(tier, recency)` is the documented order, and a synthesized hit has no
	// position in the input array to inherit — appending it made "newest first"
	// false for exactly the rows the search added (review round 2, R12).
	const rows = [
		{ session_id: "aaaaaaaaaaaa", title: "Local, older", updated_at: 100 },
	];
	const withTime = (id, mtime) => ({ ...hit(id, SESSION_RANK_SOFT), mtime });
	const outcome = searchChats(rows, "release-pod", [
		withTime("dddddddddddd", 300),
		withTime("aaaaaaaaaaaa", 100),
		withTime("bbbbbbbbbbbb", 200),
	]);

	// The local row's own recency (100) sorts it below the two wire rows, whose
	// mtimes come from the catalogue the backend read.
	assert.deepEqual(
		outcome.rows.map((entry) => entry.session_id),
		["dddddddddddd", "bbbbbbbbbbbb", "aaaaaaaaaaaa"],
	);
	assert.deepEqual([...outcome.synthesized].sort(), [
		"bbbbbbbbbbbb",
		"dddddddddddd",
	]);
});

test("a search is case-insensitive and ignores surrounding space", () => {
	const rows = [row("aaaaaaaaaaaa", "Retention Sweep Design")];
	assert.equal(searchChats(rows, "  RETENTION  ", null).rows.length, 1);
});

test("only the answer to the query in the box is used", () => {
	const answer = {
		query: "retention",
		sessions: [hit("aaaaaaaaaaaa", SESSION_RANK_NAME)],
	};

	assert.equal(hitsAnswerQuery(answer, "retention"), true);
	assert.equal(hitsAnswerQuery(answer, "  retention  "), true);
	// EXACT, and nothing looser. A prefix answer is the same search over an
	// EARLIER question, and a short one is a LARGER question rather than a
	// smaller one: what is cached for `a` every session containing the letter,
	// which is a superset of the answer to `architect`. Accepting it under
	// `architect` puts rows in the list the box's own search would not return,
	// each marked as a conversation match, and `keepPreviousData` re-serves it
	// for as long as the new answer is in flight (review round 2, R10). The
	// panel names that window instead of filling it with stale hits.
	assert.equal(hitsAnswerQuery(answer, "retention sweep"), false);
	assert.equal(hitsAnswerQuery(answer, "kubernetes"), false);
	assert.equal(hitsAnswerQuery(answer, "retentio"), false);
	assert.equal(hitsAnswerQuery(undefined, "retention"), false);
	assert.equal(hitsAnswerQuery(answer, "   "), false);
});

test("a hit for a session this client does not list is rendered, not dropped", () => {
	// The backend scans the WHOLE store; the catalogue this sidebar renders is a
	// page of it. Iterating the local rows alone would re-impose the client's cap
	// on a search that deliberately has none, and report the dropped match as
	// "no matches" — the one failure the user cannot detect (review round 1, R1).
	const outcome = searchChats([], "retention", [
		hit("dddddddddddd", SESSION_RANK_BODY, true, "Retention sweep notes"),
	]);

	assert.equal(outcome.rows.length, 1);
	assert.equal(outcome.rows[0].session_id, "dddddddddddd");
	assert.equal(outcome.rows[0].title, "Retention sweep notes");
	assert.deepEqual([...outcome.conversationMatches], ["dddddddddddd"]);

	// A hit for a row that IS listed uses that row (its title, its binding, its
	// status), never a second copy built from the wire fields.
	const listed = searchChats(
		[row("aaaaaaaaaaaa", "Local title", { agent: "coder" })],
		"retention",
		[hit("aaaaaaaaaaaa", SESSION_RANK_NAME, false, "Stale server title")],
	);
	assert.equal(listed.rows.length, 1);
	assert.equal(listed.rows[0].title, "Local title");
});

test("a synthesized hit carries the pin state when the backend describes it, and not otherwise", () => {
	/*
	 * A search hit is asked of the WHOLE store, so a pinned conversation outside the
	 * client's page arrives as a hit with no local row to compare against. Without
	 * the pin state, that row lands under `Previous chats` with an unfilled glyph and
	 * no `Pinned chats` section at all - the panel under-reporting the backend's own
	 * set, which is the failure the design forbids (QA round 1, Q1).
	 *
	 * The absent half is the same rule seen from the other side: a backend that does
	 * not describe the pin state leaves the field out, and the row must then carry NO
	 * key rather than `undefined` - "an absent key is not a claim" - because the
	 * sidebar reads the absence as unknown and withholds the control (review round 1,
	 * m1). Asserted as the KEY's absence, since `row.pinned === undefined` cannot tell
	 * the two apart and the sidebar's gate is what reads it.
	 */
	const described = searchChats([], "retention", [
		{
			...hit("dddddddddddd", SESSION_RANK_BODY, false, "Retention sweep notes"),
			pinned: true,
		},
	]);
	assert.equal(described.rows[0].pinned, true);

	const unpinned = searchChats([], "retention", [
		{
			...hit("eeeeeeeeeeee", SESSION_RANK_BODY, false, "Retention sweep notes"),
			pinned: false,
		},
	]);
	assert.equal(unpinned.rows[0].pinned, false);

	const undescribed = searchChats([], "retention", [
		hit("ffffffffffff", SESSION_RANK_BODY, false, "Retention sweep notes"),
	]);
	assert.equal(
		Object.hasOwn(undescribed.rows[0], "pinned"),
		false,
		"a hit whose backend does not describe the pin state must not claim one",
	);
});

test("a row the query visibly explains is not marked as a conversation match", () => {
	// The backend suppresses `body_match` for a row its own name answered, and
	// the marker has to apply the same rule to the LOCAL half: a row admitted
	// because its title or agent contains the query is explained by what is on
	// screen, so `· in conversation` beside it would claim the conversation is
	// why it is here (review round 1, R4).
	const rows = [row("aaaaaaaaaaaa", "Retention notes", { agent: "coder" })];

	assert.equal(
		searchChats(rows, "retention", [
			hit("aaaaaaaaaaaa", SESSION_RANK_BODY, true),
		]).conversationMatches.size,
		0,
	);
	// Same row, a query its visible text does NOT contain: the conversation is
	// the only reason it is on screen, so it is marked.
	assert.deepEqual(
		[
			...searchChats(rows, "sweep interval", [
				hit("aaaaaaaaaaaa", SESSION_RANK_BODY, true),
			]).conversationMatches,
		],
		["aaaaaaaaaaaa"],
	);
});

test("the tiers are ordered the way the backend's are", () => {
	assert.deepEqual(
		[SESSION_RANK_NAME, SESSION_RANK_ID, SESSION_RANK_BODY, SESSION_RANK_SOFT],
		[0, 1, 2, 3],
	);
});

test("the in-flight explanation fires on the collapse, not on emptiness", () => {
	// Round 3's R17: the line was gated on an EMPTY list, which is the one state
	// where nothing has visibly changed, and it stayed silent in the state it was
	// written for — the box moving past the answer in hand, so the list falls back
	// to local matches and the conversation matches it was showing disappear.
	const rows = [
		row("aaaaaaaaaaaa", "Retention sweep notes"),
		row("bbbbbbbbbbbb", "Refactor the loader"),
	];
	// The answer for `retention` is in hand: name match + body match.
	const previous = searchChats(rows, "retention", [
		hit("aaaaaaaaaaaa", SESSION_RANK_NAME),
		hit("bbbbbbbbbbbb", SESSION_RANK_BODY, true),
	]);
	// The box has moved on by one character (`retention s`); its answer has not
	// arrived, so the list falls back to what matches locally — the name row
	// survives, the conversation match does not.
	const collapsed = searchChats(rows, "retention s", null);

	assert.equal(previous.rows.length, 2);
	assert.equal(collapsed.rows.length, 1);
	assert.equal(
		lostRowsToStaleAnswer(previous.rows.length, collapsed.rows.length),
		true,
	);

	// Nothing was lost: a list that grew, or one that is unchanged, says nothing.
	assert.equal(lostRowsToStaleAnswer(1, 1), false);
	assert.equal(lostRowsToStaleAnswer(1, 2), false);
	// No answer in hand at all (the first keystroke of a word) is not a collapse
	// either: there is nothing to have lost.
	assert.equal(lostRowsToStaleAnswer(0, 1), false);
});

test("a row shows ONE trailing statement, in priority order", () => {
	// The cap is the fix for round 5's D19: CSS was being asked to arbitrate
	// between two claims whose relative importance it cannot know, and three
	// layouts in a row failed in opposite directions. The rule decides here, so
	// the flex algorithm never has to.
	const show = (input) => rowTrailingStatement(input);
	const base = {
		marked: false,
		unstarted: false,
		nested: false,
		binding: "coder",
		agentOpened: false,
	};

	assert.equal(show(base), "binding");
	// A nested row inherits its identity from the parent.
	assert.equal(show({ ...base, nested: true }), "none");
	// A draft that never carried a message has more to say than its binding.
	assert.equal(show({ ...base, unstarted: true }), "not_sent");
	assert.equal(
		show({ ...base, unstarted: true, binding: "" }),
		"not_sent",
		"a state is not conditional on the row having a binding",
	);
	// The search mark outranks both, and it is the ONLY case a marked row draws.
	assert.equal(show({ ...base, marked: true }), "conversation");
	assert.equal(
		show({ ...base, marked: true, unstarted: true }),
		"conversation",
	);
	assert.equal(show({ ...base, marked: true, nested: true }), "conversation");

	/*
	 * The agent-opened fact, which is the newest claim in the rule and the one
	 * with a surprise in it: it OUTRANKS the binding while the two claims above
	 * it are untouched. The pairing is the interesting half - both answer "who",
	 * and an agent-opened session is bound to the agent that opened it, so the
	 * binding is the half a reader can infer and the provenance is the half only
	 * the row can say (the 2026-09-18 incident).
	 */
	assert.equal(show({ ...base, agentOpened: true }), "agent_opened");
	assert.equal(
		show({ ...base, agentOpened: true, binding: "" }),
		"agent_opened",
		"the claim is the wire's presence flag, not the binding beside it",
	);
	// Provenance is the row's OWN, unlike identity: a nested row still states it.
	assert.equal(
		show({ ...base, agentOpened: true, nested: true }),
		"agent_opened",
	);
	// And the two claims above it keep their precedence over it.
	assert.equal(
		show({ ...base, agentOpened: true, unstarted: true }),
		"not_sent",
	);
	assert.equal(
		show({ ...base, agentOpened: true, marked: true }),
		"conversation",
	);

	// The property that matters: whatever the input, the answer is exactly one of
	// the five literals — never undefined, never a list. The return type is what
	// enforces "at most one" today, so this loop is here to catch a future
	// refactor that widens it (returning an array of statements would pass every
	// assertion above and fail here), not to re-assert the type.
	const allowed = [
		"conversation",
		"not_sent",
		"agent_opened",
		"binding",
		"none",
	];
	for (const marked of [false, true])
		for (const unstarted of [false, true])
			for (const nested of [false, true])
				for (const binding of ["", "coder"])
					for (const agentOpened of [false, true])
						assert.ok(
							allowed.includes(
								show({ marked, unstarted, nested, binding, agentOpened }),
							),
							`${JSON.stringify({ marked, unstarted, nested, binding, agentOpened })} produced something outside the five literals`,
						);
});

/*
 * The two decisions the panel makes about a query and an answer BEFORE it draws
 * anything, both added in QA round 1 and both pure for the same reason: they are
 * claims about what the panel may say, and a claim is exactly the kind of thing
 * that should be falsifiable without a browser.
 */
test("an over-long query is refused by the surface, on the number the contract bounds", () => {
	// The bound ITSELF is accepted. A rule that refused it would be off by one
	// against the schema it is standing in for, and 256 characters is a legal
	// request (`scripts/desktop-contract.test.mjs` asserts the schema accepts it).
	assert.equal(
		searchQueryExceedsLimit("a".repeat(SESSION_SEARCH_MAX_CHARS)),
		false,
		"the contract's bound is legal, so the rule must be `>` and not `>=`",
	);
	assert.equal(
		searchQueryExceedsLimit("a".repeat(SESSION_SEARCH_MAX_CHARS + 1)),
		true,
	);

	// Measured on the TRIMMED box, because the trimmed box is what is sent
	// (`useChatSearch` debounces `query.trim()`) and what the schema validates.
	// 256 characters plus padding is a request the transport would have carried,
	// so refusing it would be a refusal about a string nobody was going to send.
	assert.equal(
		searchQueryExceedsLimit(`${"a".repeat(SESSION_SEARCH_MAX_CHARS)}   `),
		false,
	);

	// Nothing to refuse, and nothing to say about it.
	assert.equal(searchQueryExceedsLimit(""), false);
	assert.equal(searchQueryExceedsLimit("   "), false);
	assert.equal(searchQueryExceedsLimit("retention"), false);

	// The default argument must BE the contract's constant rather than a copy of
	// its value: the number appears in the notice's copy, so a second literal
	// here is a sentence that can state a bound the request does not have.
	assert.equal(
		searchQueryExceedsLimit(
			"a".repeat(SESSION_SEARCH_MAX_CHARS + 1),
			SESSION_SEARCH_MAX_CHARS,
		),
		true,
	);
});

/*
 * The race QA round 1's Q1 left open, and the reason the rule above is only half
 * the decision (review round 7, R37).
 *
 * The box and the debounced box disagree for one debounce, and the gate used to
 * read one while the request carried the other: the reviewer rendered the
 * shipped hook over a spied transport and watched the wire carry `q` lengths
 * [257, 256] — the 257 sent AFTER the box had been shortened to 256, because the
 * gate opened on the box while the debounced value was still the over-limit
 * string. That request is refused by the contract's own schema and arrives as the
 * "conversation search is unavailable" notice with a Retry that cannot succeed,
 * which is the state Q1 was filed to make unreachable.
 *
 * These cases are the two orderings plus the states on either side of them, and
 * they are asserted against the rule the hook actually resolves with, so a future
 * change that reads the box in the gate fails here rather than on the wire.
 */
test("the query acted on is the one the gate approved, not the box for one debounce", () => {
	const max = SESSION_SEARCH_MAX_CHARS;
	const long = "a".repeat(max + 1);
	const legal = "a".repeat(max);

	// The R37 case: the box is back inside the limit while the debounced value is
	// still the over-limit string. Following the box here is what stops an
	// over-limit `q` from being sent, and it is also what lets the notice go the
	// moment the user shortens their query — the states the two halves of Q1 and
	// R37 are about, and they are the same decision.
	assert.equal(effectiveSearchQuery(legal, long), legal);
	assert.equal(
		searchQueryExceedsLimit(effectiveSearchQuery(legal, long)),
		false,
		"nothing may be sent that the contract would refuse",
	);

	// The other ordering: the box has just gone over while the debounced value is
	// still legal. The debounced value stands, because it IS what the gate approved
	// and what the request will carry — a legal 256-character search, not an
	// eagerly-refused 257-character one. Its own two cases above are what the
	// notice is shown for, one debounce later, when the box's text settles.
	assert.equal(effectiveSearchQuery(long, legal), legal);

	// Both over: the settled string stands and is refused, which is the only state
	// the notice speaks in. Following the box would say the same thing here, so the
	// case is asserted to pin the one that does NOT depend on the debounce.
	assert.equal(effectiveSearchQuery(long, long), long);
	assert.equal(searchQueryExceedsLimit(effectiveSearchQuery(long, long)), true);

	// Both legal: the settled string, so the box cannot pre-empt the debounce and
	// turn a fast typist into one request per keystroke.
	assert.equal(effectiveSearchQuery("retention", "reten"), "reten");
	assert.equal(effectiveSearchQuery("retention", "retention"), "retention");

	// A box cleared while the debounced value is still over-limit: nothing to ask
	// and nothing to explain.
	assert.equal(effectiveSearchQuery("", long), "");
	assert.equal(effectiveSearchQuery("   ", long), "");

	// Measured on the trimmed pair, like the rule it stands on: padding does not
	// make a legal query over-limit, and it must not survive as the string sent.
	assert.equal(effectiveSearchQuery(`${legal}   `, long), legal);
	assert.equal(effectiveSearchQuery(long, `${legal}   `), legal);

	// The invariant the two halves of Q1/R37 share, over every combination of
	// inside/outside on both inputs: a string the contract would refuse is only
	// ever the one the surface has ALREADY refused, so no request can carry one.
	for (const box of ["", legal, long, "retention"])
		for (const settled of ["", legal, long, "reten"])
			assert.equal(
				searchQueryExceedsLimit(effectiveSearchQuery(box, settled)),
				searchQueryExceedsLimit(box) && searchQueryExceedsLimit(settled),
				`${JSON.stringify({ box: box.length, settled: settled.length })} must refuse only what the notice can explain`,
			);
});

test("a count is a floor only when the answer came back full", () => {
	assert.equal(searchAnswerIsClipped(3, 100), false);
	assert.equal(searchAnswerIsClipped(99, 100), false);

	// Exactly the cap is the case that matters: the answer carries no truncation
	// flag, so a full page is indistinguishable from a clipped one and the
	// honest reading of it is the floor. `>=` is the whole finding (QA round 1,
	// Q3 — 100 on screen against 115 in the store).
	assert.equal(searchAnswerIsClipped(100, 100), true);
	assert.equal(searchAnswerIsClipped(115, 100), true);

	// No limit in hand means no claim can be made from the answer, so the panel
	// must not invent one: `limit` is optional on the wire even though this
	// client always asks for it.
	assert.equal(searchAnswerIsClipped(5, undefined), false);
	assert.equal(searchAnswerIsClipped(5, 0), false);
	assert.equal(searchAnswerIsClipped(0, 100), false);
});

test("the count badge announces its claim once, in every state", async () => {
	// Rest: the number is "what you have". It must be SPOKEN, because the digits
	// themselves are behind `aria-hidden` in the caller — the state that lost its
	// totals entirely when the sentence was gated on a query (D25).
	assert.equal(chatCountAnnouncement(6, false, false), " 6");
	assert.equal(chatCountAnnouncement(1, false, false), " 1");
	assert.equal(chatCountAnnouncement(0, false, false), " 0");

	// Under a query the same number becomes "what matched", which is the only
	// part the query changes (D5).
	assert.equal(chatCountAnnouncement(3, true, false), " 3 matching");

	// A clipped answer is the third claim: the number is a floor, not a total.
	assert.equal(
		chatCountAnnouncement(100, true, true),
		" At least 100 matching",
	);
	// `clipped` can only come from a query, but the announcement must not depend
	// on that: a clipped badge is never spoken as a plain total.
	assert.equal(
		chatCountAnnouncement(100, false, true),
		" At least 100 matching",
	);

	// And the invariant the two a11y findings were both about: whichever state,
	// the sentence carries the number exactly once, with no glyphs repeated as
	// words. `100+` followed by "or more matching" is what a screen reader heard
	// before D23.
	for (const [count, query, clipped] of [
		[6, false, false],
		[1, true, false],
		[100, true, true],
	]) {
		const spoken = chatCountAnnouncement(count, query, clipped);
		assert.equal(spoken.split(String(count)).length - 1, 1, spoken);
		assert.ok(!/\bor more\b/.test(spoken), spoken);
		assert.ok(!/\+\s*or more/.test(spoken), spoken);
	}
});

/*
 * ARCHIVING, at the join.
 *
 * The catalogue route takes `include_archived` (default false, asked for by this
 * app); the search route takes it too (the sidebar's own control). What this
 * module owns is the third thing: what a HIT may contribute, and which state a
 * synthesized row should draw, given that an answer in hand may predate the press
 * the user just made.
 *
 * The two cases that cannot be reached by reading either the wire or the control:
 *
 *   - A hit the answer carries as archived is NOT admitted while the control is
 *     off. Two states collapse into this one assertion: the user has just turned
 *     the control off while the previous answer (asked for WITH the flag) is
 *     still served - the answers to one query text echo the same `query`, so
 *     `hitsAnswerQuery` cannot tell them apart - and the user has just archived
 *     this very conversation, whose row is rebuilt from the cached hit on every
 *     render. Without the line, the rows the control just hid sit there for the
 *     length of a request and then vanish, which reads as a filter that sometimes
 *     does not work.
 *   - The client's own FACT outranks the hit, in both directions. A press writes
 *     the backend and then reads back the state the search last saw, so the
 *     control could never invert what it cannot see.
 */
const archivedHit = (id, archived, name = "name") => ({
	id,
	name,
	mtime: 1,
	forked: false,
	rank: SESSION_RANK_NAME,
	body_match: false,
	archived,
});
const live = { include: false, facts: {} };

test("an archived hit is withheld while the control is off, whatever the answer says", () => {
	const outcome = searchChats(
		[],
		"quarterly",
		[archivedHit("aaaaaaaaaaaa", true), archivedHit("bbbbbbbbbbbb", false)],
		live,
	);
	assert.deepEqual(
		outcome.rows.map((entry) => entry.session_id),
		["bbbbbbbbbbbb"],
		"only the live hit is drawn",
	);
	assert.equal(outcome.synthesized.has("aaaaaaaaaaaa"), false);
});

test("the control admits the archived hit, and the row it builds says so", () => {
	const outcome = searchChats(
		[],
		"quarterly",
		[archivedHit("aaaaaaaaaaaa", true)],
		{},
		{ include: true, facts: {} },
	);
	assert.equal(outcome.rows.length, 1);
	/*
	 * The synthesized row CARRIES the state, because two surfaces read it: the
	 * muted marker beside the title, and the control whose press must invert it.
	 * A row that said nothing would offer "Archive" on a conversation that is
	 * already archived.
	 */
	assert.equal(outcome.rows[0].archived, true);
	// And the live case carries the other value rather than nothing, so the two
	// surfaces can tell "live" from "not said".
	const liveOutcome = searchChats(
		[],
		"quarterly",
		[archivedHit("bbbbbbbbbbbb", false)],
		{},
		live,
	);
	assert.equal(liveOutcome.rows[0].archived, false);
});

test("the client's own fact outranks the hit it is rebuilding the row from", () => {
	// Archived a moment ago: the fact says archived, the cached hit still says live.
	const justArchived = searchChats(
		[],
		"quarterly",
		[archivedHit("aaaaaaaaaaaa", false)],
		{},
		{ include: false, facts: { aaaaaaaaaaaa: true } },
	);
	assert.deepEqual(
		justArchived.rows,
		[],
		"the row the user just archived must leave at once, not after a round trip",
	);
	// And the other direction: restored a moment ago, and the hit is the stale half.
	const justRestored = searchChats(
		[],
		"quarterly",
		[archivedHit("aaaaaaaaaaaa", true)],
		{},
		{ include: true, facts: { aaaaaaaaaaaa: false } },
	);
	assert.equal(justRestored.rows.length, 1);
	assert.equal(justRestored.rows[0].archived, false);
});

test("this module never filters the rows it is handed", () => {
	/*
	 * DELIBERATE SPLIT, and it is asserted so it cannot drift. An archived ROW is
	 * the caller's business (`visibleRows` in `chat-archived` partitions it out of
	 * every at-rest list before this module sees it), because a row's state is
	 * already on screen while a hit's is not - and a second filter here would be a
	 * second place to keep in step with the capability gate, which is the one that
	 * has to be fail-closed.
	 */
	const rows = [
		{ session_id: "aaaaaaaaaaaa", title: "Quarterly", archived: true },
	];
	const outcome = searchChats(rows, "quarterly", null, {}, live);
	assert.deepEqual(outcome.rows, rows);
});

test("a conversation this window deleted cannot come back from a cached answer", () => {
	/*
	 * Agent review round 1 (M1), second surface: a search answer is cached per query
	 * for 30 s (`session-search.ts`), and `searchChats` builds a row for every hit it
	 * is handed - so an answer taken just before a delete kept drawing the deleted
	 * conversation for the rest of that window, with no 404 path to correct it. The
	 * join filters against the tombstone for BOTH halves, and the empty-query arm is
	 * filtered too: it is not a filter the user can switch off.
	 */
	const hit = archivedHit("aaaaaaaaaaaa", false, "Doomed");
	const outcome = searchChats(
		[{ session_id: "aaaaaaaaaaaa", title: "Doomed", archived: false }],
		"doomed",
		[hit],
		{},
		{ include: true, facts: {}, forgotten: new Set(["aaaaaaaaaaaa"]) },
	);
	assert.deepEqual(outcome.rows, [], "the local half drops the deleted row");
	assert.deepEqual(
		[...outcome.synthesized],
		[],
		"and the wire half cannot rebuild it from a hit",
	);
	/*
	 * And with an EMPTY query, where the module returns the rows it was handed: the
	 * deleted conversation is gone here too.
	 */
	const empty = searchChats(
		[
			{ session_id: "aaaaaaaaaaaa", title: "Doomed", archived: false },
			{ session_id: "bbbbbbbbbbbb", title: "Kept", archived: false },
		],
		"",
		null,
		{},
		{ include: false, facts: {}, forgotten: new Set(["aaaaaaaaaaaa"]) },
	);
	assert.deepEqual(
		empty.rows.map((entry) => entry.session_id),
		["bbbbbbbbbbbb"],
	);
});
