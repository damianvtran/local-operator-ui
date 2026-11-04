import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * TEAM BRIDGE @-MENTIONS: THE PURE HALF.
 *
 * `mentions/matcher.ts` decides when the popover opens and what it offers;
 * `mentions/tokens.ts` keeps the picked mentions as a range map over the plain
 * draft and turns them into the wire `mentions[]` (local-operator #3204's
 * `MentionIn`: `{kind, account_id, endpoint_id?}`). Both are pure, so they are
 * bundled from source and executed here; nothing about layout is claimed.
 */
const bundle = await build({
	stdin: {
		contents: `
			export * from "./src/renderer/src/features/team-bridge/mentions/matcher";
			export * from "./src/renderer/src/features/team-bridge/mentions/tokens";
			export * from "./src/renderer/src/features/team-bridge/mentions/message-mentions";
			export { buildMentionCandidates } from "./src/renderer/src/features/team-bridge/mentions/candidates";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const m = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const people = [
	{
		kind: "human",
		accountId: "a_ben",
		label: "Ben Tran",
		member: true,
		bridgeOff: false,
	},
	{
		kind: "human",
		accountId: "a_sherman",
		label: "Sherman Tsui",
		member: false,
		bridgeOff: false,
	},
	{
		kind: "human",
		accountId: "a_ada",
		label: "Ada Lovelace",
		member: true,
		bridgeOff: false,
	},
	{
		kind: "human",
		accountId: "a_tara",
		label: "Tara Bentley",
		member: false,
		bridgeOff: true,
	},
	{
		kind: "agent",
		accountId: "a_ben",
		endpointId: "bep_aida",
		label: "Aida (Ben Tran)",
		aliases: ["Ben Tran"],
		member: true,
		bridgeOff: false,
	},
	{
		kind: "agent",
		accountId: "a_sherman",
		endpointId: "bep_cos",
		label: "Sherman Tsui’s chief of staff",
		member: false,
		bridgeOff: false,
	},
];

test("boundary: @ opens at the start, after whitespace or punctuation, never inside an email", () => {
	assert.deepEqual(m.findMentionQuery("@be", 3), {
		start: 0,
		end: 3,
		query: "be",
	});
	assert.deepEqual(m.findMentionQuery("hi @be", 6), {
		start: 3,
		end: 6,
		query: "be",
	});
	assert.deepEqual(m.findMentionQuery("(@be", 4), {
		start: 1,
		end: 4,
		query: "be",
	});
	assert.equal(m.findMentionQuery("ben@minerva", 11), null);
	assert.equal(m.findMentionQuery("mail a.b@x", 10), null);
	assert.equal(
		m.findMentionQuery("@ ben", 5),
		null,
		"a space right after @ is prose",
	);
	assert.equal(
		m.findMentionQuery("@ben\nhi", 7),
		null,
		"a newline ends the query",
	);
	assert.deepEqual(m.findMentionQuery("hi @", 4), {
		start: 3,
		end: 4,
		query: "",
	});
	assert.deepEqual(m.findMentionQuery("@Ben Tr", 7), {
		start: 0,
		end: 7,
		query: "Ben Tr",
	});
});

test("tiers: full-name prefix, then word prefix, then substring, then fuzzy", () => {
	assert.equal(m.matchTier("ben", { label: "Ben Tran" }), 0);
	assert.equal(m.matchTier("tran", { label: "Ben Tran" }), 1);
	assert.equal(m.matchTier("en tr", { label: "Ben Tran" }), 2);
	assert.equal(m.matchTier("btn", { label: "Ben Tran" }), 3);
	assert.equal(m.matchTier("zzz", { label: "Ben Tran" }), null);
	assert.equal(
		m.matchTier("bt", { label: "Ben Tran" }),
		null,
		"no fuzzy below three letters",
	);
	assert.equal(
		m.matchTier("ben", { label: "Aida (Ben Tran)" }),
		1,
		"agent label words are searchable",
	);
	assert.equal(
		m.matchTier("chief", { label: "Sherman Tsui’s chief of staff" }),
		1,
	);
	assert.equal(
		m.matchTier("élo", { label: "Elodie" }),
		0,
		"accent-insensitive",
	);
});

test("ranking: members before the org, humans before agents, tiers inside a group", () => {
	const { sections, flat } = m.rankMentionCandidates("ben", people);
	assert.deepEqual(
		sections.map((s) => s.id),
		["member-human", "member-agent", "org-human"],
	);
	assert.deepEqual(
		flat.map((c) => `${c.kind}:${c.label}`),
		["human:Ben Tran", "agent:Aida (Ben Tran)", "human:Tara Bentley"],
	);
	const all = m.rankMentionCandidates("", people);
	assert.deepEqual(
		all.sections.map((s) => s.id),
		["member-human", "member-agent", "org-human", "org-agent"],
	);
	assert.deepEqual(
		all.sections[0].rows.map((c) => c.label),
		["Ben Tran", "Ada Lovelace"],
		"ties keep directory order",
	);
	assert.equal(m.rankMentionCandidates("qqq", people).flat.length, 0);
});

test("ranking: a word-prefix in the members section never outranks section order", () => {
	const { flat } = m.rankMentionCandidates("t", people);
	assert.equal(flat[0].label, "Ben Tran", "member human first even at tier 1");
	assert.ok(
		flat.findIndex((c) => c.label === "Tara Bentley") >
			flat.findIndex((c) => c.label === "Aida (Ben Tran)"),
	);
});

const ben = people[0];
const aida = people[4];

test("insert: replaces @query with @Label + space and records the token", () => {
	const r = m.insertMention("hi @be", [], { start: 3, end: 6 }, ben);
	assert.equal(r.text, "hi @Ben Tran ");
	assert.equal(r.caret, 13);
	assert.deepEqual(r.tokens, [
		{
			start: 3,
			end: 12,
			kind: "human",
			accountId: "a_ben",
			label: "Ben Tran",
			notify: true,
		},
	]);
	const again = m.insertMention("@be there", [], { start: 0, end: 3 }, ben);
	assert.equal(
		again.text,
		"@Ben Tran there",
		"no doubled space before existing whitespace",
	);
});

test("rebase: edits before shift tokens, edits inside drop them, edits after keep them", () => {
	const { text, tokens } = m.insertMention(
		"x @a",
		[],
		{ start: 2, end: 4 },
		ben,
	);
	// "x @Ben Tran "
	const shifted = m.rebaseTokens(text, `yy${text}`, tokens);
	assert.equal(shifted[0].start, 4);
	const inside = m.rebaseTokens(text, text.replace("Ben", "Bon"), tokens);
	assert.deepEqual(inside, [], "a half-edited name is plain text again");
	const appended = m.rebaseTokens(text, `${text}ok`, tokens);
	assert.equal(appended[0].start, 2);
	const cleared = m.rebaseTokens(text, "", tokens);
	assert.deepEqual(cleared, []);
});

test("backspace and delete remove a token as ONE unit", () => {
	const { text, tokens } = m.insertMention(
		"hi @b",
		[],
		{ start: 3, end: 5 },
		ben,
	);
	// "hi @Ben Tran " ; token [3,12)
	const back = m.deleteAcrossToken(
		text,
		tokens,
		{ start: 12, end: 12 },
		"Backspace",
	);
	assert.equal(back.text, "hi  ");
	assert.equal(back.caret, 3);
	assert.deepEqual(back.tokens, []);
	const del = m.deleteAcrossToken(text, tokens, { start: 3, end: 3 }, "Delete");
	assert.equal(del.text, "hi  ");
	assert.equal(
		m.deleteAcrossToken(text, tokens, { start: 13, end: 13 }, "Backspace"),
		null,
		"outside a token the native edit runs",
	);
	assert.equal(
		m.deleteAcrossToken(text, tokens, { start: 3, end: 3 }, "Backspace"),
		null,
		"backspace before the @ is not into the token",
	);
	const widened = m.deleteAcrossToken(
		text,
		tokens,
		{ start: 1, end: 6 },
		"Backspace",
	);
	assert.equal(
		widened.text,
		"h ",
		"a selection over half a pill takes the whole pill",
	);
});

test("caret never rests inside a token", () => {
	const tokens = [
		{
			start: 3,
			end: 12,
			kind: "human",
			accountId: "a",
			label: "Ben Tran",
			notify: true,
		},
	];
	assert.equal(m.clampCaret(tokens, 6, "forward"), 12);
	assert.equal(m.clampCaret(tokens, 6, "backward"), 3);
	assert.equal(m.clampCaret(tokens, 3, "forward"), 3);
	assert.equal(m.clampCaret(tokens, 12, "backward"), 12);
});

test("serializer: only ACTIVE members are sent, whatever the token says (R1-01)", () => {
	const tokens = [
		{
			start: 0,
			end: 9,
			kind: "human",
			accountId: "a_ben",
			label: "Ben Tran",
			notify: true,
		},
		{
			start: 10,
			end: 23,
			kind: "human",
			accountId: "a_sherman",
			label: "Sherman Tsui",
			notify: true,
		},
	];
	assert.deepEqual(m.serializeMentions(tokens, new Set(["human:a_ben"])), [
		{ kind: "human", account_id: "a_ben" },
	]);
});

test("serializer: contract shape, dedupe, silent tokens and unaddressable agents left out", () => {
	let s = m.insertMention("@b", [], { start: 0, end: 2 }, ben);
	s = m.insertMention(
		`${s.text}@a`,
		s.tokens,
		{ start: s.text.length, end: s.text.length + 2 },
		aida,
	);
	s = m.insertMention(
		`${s.text}@b`,
		s.tokens,
		{ start: s.text.length, end: s.text.length + 2 },
		ben,
	);
	s = m.insertMention(
		`${s.text}@s`,
		s.tokens,
		{ start: s.text.length, end: s.text.length + 2 },
		people[1],
		false,
	);
	assert.equal(s.text, "@Ben Tran @Aida (Ben Tran) @Ben Tran @Sherman Tsui ");
	assert.deepEqual(m.serializeMentions(s.tokens), [
		{ kind: "human", account_id: "a_ben" },
		{ kind: "agent", account_id: "a_ben", endpoint_id: "bep_aida" },
	]);
	assert.deepEqual(
		m.serializeMentions([
			{
				start: 0,
				end: 1,
				kind: "agent",
				accountId: "x",
				label: "",
				notify: true,
			},
		]),
		[],
	);
});

test("segments: overlay runs reproduce the text exactly", () => {
	const s = m.insertMention("hi @b!", [], { start: 3, end: 5 }, ben);
	const segs = m.segmentText(s.text, s.tokens);
	assert.equal(segs.map((x) => x.text).join(""), s.text);
	assert.deepEqual(
		segs.map((x) => x.kind),
		["text", "token", "text"],
	);
});

const roster = [
	{ kind: "human", accountId: "a_ben", label: "Ben Tran" },
	{ kind: "human", accountId: "a_bent", label: "Ben" },
	{ kind: "agent", accountId: "a_ben", label: "Aida (Ben Tran)" },
];
const self = { accountId: "a_me", label: "Damian Tran" };

test("message mentions: the hub's mentions[] is authoritative when present", () => {
	const spec = m.messageMentionSpec({
		body: "@Ben Tran and @Damian Tran, see @Ben",
		mentions: [
			{ kind: "human", account_id: "a_ben" },
			{ kind: "human", account_id: "a_me" },
		],
		candidates: roster,
		self,
	});
	assert.equal(spec.source, "message");
	assert.deepEqual(spec.runs, [
		{ label: "Ben Tran", viewer: false },
		{ label: "Damian Tran", viewer: true },
	]);
	const channel = m.messageMentionSpec({
		body: "@here hi",
		mentions: [{ kind: "channel" }],
		candidates: roster,
		self,
	});
	assert.deepEqual(
		channel.runs,
		[{ label: "here", viewer: false }],
		"only the word present (R1-06)",
	);
	const prose = m.messageMentionSpec({
		body: "@ben tran said hi",
		mentions: undefined,
		candidates: roster,
		self,
	});
	assert.equal(
		prose,
		null,
		"the fallback is case-sensitive on the display name (R1-06)",
	);
});

test("message mentions: without mentions[] fall back to @Name over members and directory", () => {
	const spec = m.messageMentionSpec({
		body: "ping @Damian Tran and @Ben Tran",
		mentions: undefined,
		candidates: roster,
		self,
	});
	assert.equal(spec.source, "fallback");
	assert.deepEqual(
		spec.runs.map((r) => [r.label, r.viewer]),
		[
			["Ben Tran", false],
			["Ben", false],
			["Damian Tran", false],
		],
	);
	assert.equal(
		m.messageMentionSpec({
			body: "no names",
			mentions: undefined,
			candidates: roster,
			self,
		}),
		null,
	);
});

test("split: longest label wins, word ends respected, emails untouched", () => {
	const runs = [
		{ label: "Ben", viewer: false },
		{ label: "Ben Tran", viewer: true },
	];
	assert.deepEqual(m.splitMentions("hi @Ben Tran!", runs), [
		{ kind: "text", text: "hi " },
		{ kind: "mention", text: "@Ben Tran", viewer: true },
		{ kind: "text", text: "!" },
	]);
	assert.deepEqual(m.splitMentions("@Benjamin", runs), [
		{ kind: "text", text: "@Benjamin" },
	]);
	assert.deepEqual(m.splitMentions("x@Ben", runs), [
		{ kind: "text", text: "x@Ben" },
	]);
});

// Names are presentation, not identity; neither fallback nor a namesake may
// acquire the warning treatment. Agent and human wire rows use the same ID rule.
test("viewer identity requires an authoritative account id for humans and agents", () => {
	const candidates = [
		...roster,
		{ kind: "human", accountId: "a_namesake", label: self.label },
		{ kind: "agent", accountId: self.accountId, label: "My agent" },
	];
	for (const kind of ["human", "agent"]) {
		const label = kind === "human" ? self.label : "My agent";
		const spec = m.messageMentionSpec({
			body: `@${label}`,
			mentions: [{ kind, account_id: self.accountId }],
			candidates,
			self,
		});
		assert.equal(spec.runs[0].viewer, true);
	}
	const namesake = m.messageMentionSpec({
		body: `@${self.label}`,
		mentions: [{ kind: "human", account_id: "a_namesake" }],
		candidates,
		self,
	});
	assert.equal(namesake.runs[0].viewer, false);
	const fallback = m.messageMentionSpec({
		body: `@${self.label} @My agent`,
		mentions: undefined,
		candidates,
		self,
	});
	assert.ok(fallback.runs.every((run) => run.viewer === false));
});

test("members the directory does not list are offered by their stored NAME, never a legacy composed label", () => {
	// Review m1 on #1643: the fallback loop used the raw `display_label`, so a
	// legacy "Ben Tran (Ben Tran)" reached the popover row and the notice
	// sentence verbatim, and the "Member" placeholder was offered as a name.
	const member = (account_id, kind, display_label) => ({
		account_id,
		kind,
		display_label,
		role: "member",
		state: "active",
	});
	const rows = m.buildMentionCandidates({
		conversation: {
			members: [
				member("a_self", "human", "Damian"),
				member("a_ana", "human", "Ana"),
				member("a_ben", "agent", "Ben Tran (Ben Tran)"),
				member("a_sam", "agent", "Juno (Sam)"),
				member("a_old", "human", "Member"),
			],
		},
		people: [],
		selfAccountId: "a_self",
		chiefLabels: {
			named: (agent, person) => `${agent} (${person})`,
			unnamed: (person) => `${person}’s chief of staff`,
		},
		agentRole: "Chief of staff",
	});
	// "Ben Tran (Ben Tran)" is Ben's UNNAMED agent, still a mention target
	// (review m2-r2 on #1643); only "Member" names nobody.
	assert.deepEqual(
		rows.map((row) => [row.kind, row.label]),
		[
			["human", "Ana"],
			["agent", "Ben Tran’s chief of staff"],
			["agent", "Juno (Sam)"],
		],
	);
});

/*
 * THE VIEWER IN THE FALLBACK (operator report 2026-11-03). Most messages carry
 * no `mentions[]`, so the name path must still mark the reader's own mention,
 * but only through the label the provider resolved from the authenticated
 * account (`labelUnique`), and never when anyone else could own the name.
 */
const uniqueSelf = { ...self, labelUnique: true };

test("viewer: a wire mentions[] row for the reader is the viewer treatment (a)", () => {
	const spec = m.messageMentionSpec({
		body: "@Damian Tran ping",
		mentions: [{ kind: "human", account_id: "a_me" }],
		candidates: roster,
		self: uniqueSelf,
	});
	assert.deepEqual(spec.runs, [{ label: "Damian Tran", viewer: true }]);
});

test("viewer: the fallback marks the reader's own unique label, others stay other (b, d)", () => {
	const spec = m.messageMentionSpec({
		body: "@Damian Tran and @Ben Tran, see this",
		mentions: undefined,
		candidates: roster,
		self: uniqueSelf,
	});
	assert.equal(spec.source, "fallback");
	assert.deepEqual(
		spec.runs.map((r) => [r.label, r.viewer]),
		[
			["Ben Tran", false],
			["Ben", false],
			["Damian Tran", true],
		],
	);
});

test("viewer: the fallback never marks a label someone else also carries (c)", () => {
	// The provider found no namesake, but a candidate of this conversation has one.
	const namesakeCandidate = m.messageMentionSpec({
		body: "@Damian Tran ping",
		mentions: undefined,
		candidates: [
			...roster,
			{ kind: "human", accountId: "a_twin", label: "Damian Tran" },
		],
		self: uniqueSelf,
	});
	assert.ok(namesakeCandidate.runs.every((run) => run.viewer === false));
	// An agent whose composed label equals the reader's is still not the reader.
	const namesakeAgent = m.messageMentionSpec({
		body: "@Damian Tran ping",
		mentions: undefined,
		candidates: [
			...roster,
			{ kind: "agent", accountId: "a_twin", label: "Damian Tran" },
		],
		self: uniqueSelf,
	});
	assert.ok(namesakeAgent.runs.every((run) => run.viewer === false));
	// The provider saw a namesake in the directory or the member list.
	const notUnique = m.messageMentionSpec({
		body: "@Damian Tran ping",
		mentions: undefined,
		candidates: roster,
		self: { ...self, labelUnique: false },
	});
	assert.equal(notUnique.runs[0].viewer, false);
});

test("viewer: candidate namesakes compare by name key; the reader's own rows never block (M1, M2)", () => {
	for (const twin of ["damian tran", "Damian  Tran"]) {
		const spec = m.messageMentionSpec({
			body: "@Damian Tran ping",
			mentions: undefined,
			candidates: [
				...roster,
				{ kind: "human", accountId: "a_twin", label: twin },
			],
			self: uniqueSelf,
		});
		assert.deepEqual(spec.runs, [{ label: "Damian Tran", viewer: false }]);
	}
	const ownAgent = m.messageMentionSpec({
		body: "@Damian Tran ping",
		mentions: undefined,
		candidates: [
			...roster,
			{ kind: "agent", accountId: self.accountId, label: "Damian Tran" },
		],
		self: uniqueSelf,
	});
	assert.ok(ownAgent.runs.some((r) => r.viewer === true));
});

test("viewer: the reader's own agent follows the wire-id rule only (f)", () => {
	const candidates = [
		...roster,
		{ kind: "agent", accountId: self.accountId, label: "Aida (Damian Tran)" },
	];
	const wire = m.messageMentionSpec({
		body: "@Aida (Damian Tran) go",
		mentions: [{ kind: "agent", account_id: self.accountId }],
		candidates,
		self: uniqueSelf,
	});
	assert.deepEqual(wire.runs, [{ label: "Aida (Damian Tran)", viewer: true }]);
	const fallback = m.messageMentionSpec({
		body: "@Aida (Damian Tran) go",
		mentions: undefined,
		candidates,
		self: uniqueSelf,
	});
	assert.deepEqual(fallback.runs, [
		{ label: "Aida (Damian Tran)", viewer: false },
	]);
});

test("viewer: an identity with no label highlights nothing on the wire path", () => {
	assert.equal(
		m.messageMentionSpec({
			body: "@ hello",
			mentions: [{ kind: "human", account_id: "a_me" }],
			candidates: [],
			self: { accountId: "a_me", label: "", labelUnique: false },
		}),
		null,
	);
});
