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
			'export * from "./src/renderer/src/features/chat/chat-search";',
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
	SESSION_RANK_NAME,
	SESSION_RANK_ID,
	SESSION_RANK_BODY,
	SESSION_RANK_SOFT,
	SESSION_RANK_LABEL,
	matchesLabel,
	searchChats,
	hitsAnswerQuery,
} = module;

const row = (session_id, title, { agent = null, team = null } = {}) => ({
	session_id,
	title,
	binding: { agent, team },
});

const hit = (id, rank, body_match = false, name = "name") => ({
	id,
	name,
	mtime: 1,
	forked: false,
	rank,
	body_match,
});

test("an empty query is not a search", () => {
	const rows = [row("aaaaaaaaaaaa", "One"), row("bbbbbbbbbbbb", "Two")];
	const outcome = searchChats(rows, "", [hit("aaaaaaaaaaaa", SESSION_RANK_BODY)]);

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
	const outcome = searchChats(rows, "zzz", [hit("aaaaaaaaaaaa", SESSION_RANK_SOFT, true)]);

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
	assert.equal(searchChats(rows, "architect", null).conversationMatches.size, 0);

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

test("a search is case-insensitive and ignores surrounding space", () => {
	const rows = [row("aaaaaaaaaaaa", "Retention Sweep Design")];
	assert.equal(searchChats(rows, "  RETENTION  ", null).rows.length, 1);
});

test("only the answer to the query in the box is used", () => {
	const answer = { query: "retention", sessions: [hit("aaaaaaaaaaaa", SESSION_RANK_NAME)] };

	assert.equal(hitsAnswerQuery(answer, "retention"), true);
	assert.equal(hitsAnswerQuery(answer, "  retention  "), true);
	// The box has moved on by a keystroke while this answer was in flight. The
	// answer is the same search over a prefix of what is now in the box, so it
	// stays usable: refusing it would collapse the list to name matches on every
	// keystroke and re-expand, a flicker that reads as a bug (review round 1, R2).
	assert.equal(hitsAnswerQuery(answer, "retention sweep"), true);
	// A DIFFERENT question is still refused — select-all and retype must never
	// leave the previous query's hits filtering the new one.
	assert.equal(hitsAnswerQuery(answer, "kubernetes"), false);
	// And so is an answer for a LONGER query, which is what backspacing leaves
	// behind: it says nothing about the shorter thing now in the box.
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

test("a row the query visibly explains is not marked as a conversation match", () => {
	// The backend suppresses `body_match` for a row its own name answered, and
	// the marker has to apply the same rule to the LOCAL half: a row admitted
	// because its title or agent contains the query is explained by what is on
	// screen, so `· in conversation` beside it would claim the conversation is
	// why it is here (review round 1, R4).
	const rows = [row("aaaaaaaaaaaa", "Retention notes", { agent: "coder" })];

	assert.equal(
		searchChats(rows, "retention", [hit("aaaaaaaaaaaa", SESSION_RANK_BODY, true)])
			.conversationMatches.size,
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
