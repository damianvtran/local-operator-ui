/**
 * Team Bridge approvals: the rules a person relies on when deciding a batch.
 *
 *     node --test scripts/team-bridge-approvals.test.mjs
 *
 * Run from the SHIPPED source: the model is bundled by esbuild in memory, the
 * same pattern `team-bridge-owner-audit-model.test.mjs` uses, so these assert
 * the code the app runs rather than a restatement of it.
 *
 * What each block guards (local-operator #4099, "For the UI slice"):
 * 1. Every route refusal maps to fixed, calm copy - cooldown carries its time,
 *    presence-required points at the cards, a locked refusal names the locked
 *    requests - and the daemon's own sentence is never shown.
 * 2. A row with an unsent earlier decision allows ONLY that word, and a batch
 *    of the other word leaves it out rather than re-wording it.
 * 3. A Touch ID prompt is labelled ours ONLY while our authorize call is in
 *    flight and only for the first prompt carrying our `client_ref`; every
 *    replay of the ref is foreign (S-6 / S-1). A closing frame clears it and a
 *    foreign one leaves a trace; the frame is parsed at the boundary (S-5).
 * 4. A selection never exceeds 50 items, however it is built.
 *
 * WHAT IT DOES NOT PROVE: that the routes answer, or any pixel. Those are the
 * Storybook frames' and the live daemon's job.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: `
			export * from "./src/renderer/src/features/team-bridge/team-bridge-approvals-model";
			export { DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	mainFields: ["module", "main"],
	conditions: ["import"],
	loader: { ".css": "empty" },
	jsx: "automatic",
	write: false,
});
const source = bundle.outputFiles[0].text;
const m = await import(
	`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

// Top-level regexes (biome useTopLevelRegex); each is named by its use below.
const RE_0 = /1 second\b/;
const RE_1 = /7 seconds/;
const RE_2 = /DAEMON SENTENCE/;
const RE_3 = /DAEMON SENTENCE|boom/;
const RE_4 = /Nothing was decided/;
const RE_5 = /Priya and Omar/;
const RE_6 = /^[0-9a-f]{32}$/;
const RE_7 = /card/;
const RE_FEED_DROP = /if \(!nextConnected\) clearAuthorizeNotices\(\);/;
const RE_FEED_APPLY =
	/frame\.type === "team_bridge_authorize"\)[\s\S]{0,40}applyAuthorizeFrame\(frame\.payload, `\$\{frame\.epoch\}:\$\{frame\.seq\}`\)/;
const RE_WAIT = /\bwait\b/i;
const RE_UNCONFIRMED = /couldn't be reached/;

const row = (over = {}) => ({
	message_id: "bcmsg_1",
	thread_id: null,
	created_at: "2026-11-17T10:00:00Z",
	excerpt: "May I deploy the staging build?",
	request: { state: "pending", expires_at: null },
	sender: { account_id: "a1", endpoint_id: null, name: "Priya", email: null },
	ask: { session_id: "s1", ask_id: "k1", status: "open" },
	decidable: true,
	unsent_decision: null,
	...over,
});

const refusal = (code, detail, retryAfterMs) =>
	new m.DesktopControlError(
		code === "operator_prompt_cooldown" || code === "operator_prompt_in_flight"
			? 429
			: 409,
		"DAEMON SENTENCE - never shown",
		undefined,
		code,
		retryAfterMs,
		detail,
	);

// -- 1. refusal mapping -------------------------------------------------------

test("cooldown shows its time from details.retry_after_s", () => {
	const r = m.mapApprovalRefusal(
		refusal("operator_prompt_cooldown", {
			code: "operator_prompt_cooldown",
			details: { retry_after_s: 7 },
		}),
	);
	assert.equal(r.kind, "cooldown");
	assert.equal(r.retryAfterS, 7);
	assert.match(r.message, RE_1);
	assert.match(r.message, RE_4);
});

test("cooldown rounds a fractional wait up and never reads zero", () => {
	const r = m.mapApprovalRefusal(
		refusal("operator_prompt_cooldown", { details: { retry_after_s: 0.2 } }),
	);
	assert.equal(r.retryAfterS, 1);
	assert.match(r.message, RE_0);
});

test("in-flight, dismissed, expired and presence-required each have their own copy", () => {
	const inFlight = m.mapApprovalRefusal(refusal("operator_prompt_in_flight"));
	assert.equal(inFlight.kind, "in_flight");
	const dismissed = m.mapApprovalRefusal(
		refusal("operator_signature_unavailable"),
	);
	assert.equal(dismissed.kind, "dismissed");
	for (const code of [
		"operator_signature_expired",
		"operator_signature_invalid",
		"operator_signature_required",
	])
		assert.equal(m.mapApprovalRefusal(refusal(code)).kind, "expired");
	const presence = m.mapApprovalRefusal(refusal("operator_presence_required"));
	assert.equal(presence.kind, "presence_required");
	assert.match(presence.message, RE_7);
	for (const r of [inFlight, dismissed, presence])
		assert.doesNotMatch(r.message, RE_2);
});

test("earlier_decision_unconfirmed names the locked items and their senders", () => {
	const names = (id) => ({ bcmsg_1: "Priya", bcmsg_2: "Omar" })[id] ?? null;
	const r = m.mapApprovalRefusal(
		refusal("earlier_decision_unconfirmed", {
			details: {
				items: [
					{ message_id: "bcmsg_1", unsent_decision: "approve" },
					{ message_id: "bcmsg_2", unsent_decision: "deny" },
					{ message_id: "bcmsg_x", unsent_decision: "maybe" },
				],
			},
		}),
		names,
	);
	assert.equal(r.kind, "locked");
	assert.deepEqual(
		r.items.map((item) => item.message_id),
		["bcmsg_1", "bcmsg_2"],
	);
	assert.match(r.message, RE_5);
});

test("an unknown code or a non-error reads as a calm generic, never the daemon text", () => {
	for (const error of [
		refusal("bridge_off"),
		new Error("boom"),
		null,
		undefined,
	]) {
		const r = m.mapApprovalRefusal(error);
		assert.equal(r.kind, "other");
		assert.doesNotMatch(r.message, RE_3);
	}
});

// -- 2. unsent-decision locking ------------------------------------------------

test("a locked row offers only its unsent word; a non-decidable row offers none", () => {
	assert.deepEqual(m.allowedWords(row()), ["approve", "deny"]);
	assert.deepEqual(m.allowedWords(row({ unsent_decision: "deny" })), ["deny"]);
	assert.deepEqual(
		m.allowedWords(row({ decidable: false, unsent_decision: "deny" })),
		[],
	);
	assert.equal(
		m.notDecidableReason(row({ decidable: false, ask: null })),
		"no_card",
	);
	assert.equal(
		m.notDecidableReason(
			row({
				decidable: false,
				ask: { session_id: "s", ask_id: "k", status: "snoozed" },
			}),
		),
		"not_open",
	);
	assert.equal(m.notDecidableReason(row()), null);
});

test("a batch never re-words a locked row: it is left out and reported", () => {
	const rows = [
		row({ message_id: "a" }),
		row({ message_id: "b", unsent_decision: "approve" }),
		row({ message_id: "c", decidable: false }),
	];
	const deny = m.buildSelection(rows, new Set(["a", "b", "c"]), "deny");
	assert.deepEqual(deny.items, [{ message_id: "a", decision: "deny" }]);
	assert.deepEqual(
		deny.excluded.map((r) => r.message_id),
		["b", "c"],
	);
	const approve = m.buildSelection(rows, new Set(["a", "b"]), "approve");
	assert.deepEqual(
		approve.items.map((item) => item.message_id),
		["a", "b"],
	);
});

// -- 3. foreign client_ref -----------------------------------------------------

const promptItem = {
	message_id: "a",
	word: "approve",
	sender: "Priya",
	excerpt: "x",
};
const prompt = (authorize_id, client_ref, state = "prompting") => ({
	authorize_id,
	client_ref,
	state,
	items: [promptItem],
});
const noticeById = () =>
	Object.fromEntries(
		m.authorizeNoticesSnapshot().map((n) => [n.authorizeId, n]),
	);
let frameSeq = 0;
const apply = (frame) => m.applyAuthorizeFrame(frame, `t:${++frameSeq}`);

test("a prompt carrying our pending client_ref is ours; any other ref, or none, is foreign", () => {
	m.resetClientRefsForTests();
	m.resetAuthorizeNoticesForTests();
	const ours = m.beginOwnPrompt();
	assert.match(ours, RE_6);
	apply(prompt("p1", ours));
	apply(prompt("p2", "deadbeef"));
	apply({ ...prompt("p3", null), items: [] });
	const byId = noticeById();
	assert.equal(byId.p1.foreign, false);
	assert.equal(byId.p2.foreign, true);
	assert.equal(byId.p3.foreign, true);
	assert.equal(byId.p1.approveCount, 1);
	m.endOwnPrompt(ours);
});

test("S-1: a replayed client_ref is foreign - second prompt, after signed, after the call settled", () => {
	m.resetClientRefsForTests();
	m.resetAuthorizeNoticesForTests();
	const ours = m.beginOwnPrompt();
	apply(prompt("own", ours));
	// (a) another prompt with the same ref while ours is still up.
	apply(prompt("replay_a", ours));
	assert.equal(noticeById().own.foreign, false);
	assert.equal(noticeById().replay_a.foreign, true);
	// (b) our prompt is signed; the call has not answered yet; a replay lands.
	apply(prompt("own", ours, "signed"));
	apply(prompt("replay_b", ours));
	assert.equal(noticeById().replay_b.foreign, true);
	// A repeated delivery of OUR prompting frame keeps its label.
	apply(prompt("own", ours));
	assert.equal(noticeById().own.foreign, false);
	// (c) the call has answered: the ref is retired for good.
	m.endOwnPrompt(ours);
	apply(prompt("replay_c", ours));
	assert.equal(noticeById().replay_c.foreign, true);
});

test("S-1: a ref is ours only while pending - a ref never begun, or ended before its frame, is foreign", () => {
	m.resetClientRefsForTests();
	m.resetAuthorizeNoticesForTests();
	const early = m.beginOwnPrompt();
	m.endOwnPrompt(early);
	apply(prompt("late", early));
	assert.equal(noticeById().late.foreign, true);
});

test("runApprovalFlow: one authorize, one decide, the proof passed through untouched", async () => {
	m.resetClientRefsForTests();
	m.resetAuthorizeNoticesForTests();
	const proof = { challenge: "c".repeat(64), sig: "ab", key_id: "k1" };
	const items = [{ message_id: "a", decision: "approve" }];
	const calls = [];
	let refDuringAuthorize = null;
	const out = await m.runApprovalFlow({
		accountId: "acct_1",
		items,
		authorize: async (account, sent, ref) => {
			calls.push(["authorize", account, sent]);
			refDuringAuthorize = ref;
			// The daemon publishes our prompt while the call is pending.
			apply(prompt("flow_own", ref));
			return { operator_proof: proof };
		},
		decide: async (account, sent, gotProof) => {
			calls.push(["decide", account, sent, gotProof]);
			return [
				{ ...items[0], sent: true, ask_settled: true, status: "approved" },
			];
		},
	});
	assert.equal(out.ok, true);
	assert.deepEqual(
		calls.map((c) => c[0]),
		["authorize", "decide"],
	);
	assert.equal(calls[1][1], "acct_1");
	assert.equal(calls[1][2], items);
	assert.equal(calls[1][3], proof, "the exact proof object, not a copy");
	assert.equal(noticeById().flow_own.foreign, false);
	// After the flow, the same ref is foreign.
	apply(prompt("flow_replay", refDuringAuthorize));
	assert.equal(noticeById().flow_replay.foreign, true);
});

test("runApprovalFlow: a refused authorize never decides and never retries", async () => {
	m.resetClientRefsForTests();
	let authorizes = 0;
	let decides = 0;
	let ref = null;
	const out = await m.runApprovalFlow({
		accountId: "acct_1",
		items: [{ message_id: "a", decision: "deny" }],
		authorize: async (_a, _i, clientRef) => {
			authorizes++;
			ref = clientRef;
			throw refusal("operator_signature_unavailable");
		},
		decide: async () => {
			decides++;
			return [];
		},
	});
	assert.equal(out.ok, false);
	assert.equal(out.stage, "authorize");
	assert.equal(authorizes, 1);
	assert.equal(decides, 0);
	m.resetAuthorizeNoticesForTests();
	apply(prompt("after_refusal", ref));
	assert.equal(noticeById().after_refusal.foreign, true);
	// A failed decide is reported at its stage, once.
	const failed = await m.runApprovalFlow({
		accountId: "acct_1",
		items: [{ message_id: "a", decision: "deny" }],
		authorize: async () => ({ operator_proof: {} }),
		decide: async () => {
			decides++;
			throw new m.DesktopControlError(503, "x");
		},
	});
	assert.equal(failed.stage, "decide");
	assert.equal(decides, 1);
	assert.equal(
		m.mapApprovalRefusal(failed.error, undefined, "decide").kind,
		"unconfirmed",
	);
});

test("S-5: the frame is parsed - an unknown word is kept as unrecognised, a bad frame is dropped", () => {
	m.resetAuthorizeNoticesForTests();
	apply({ ...prompt("w1", null), items: [{ ...promptItem, word: "maybe" }] });
	const n = noticeById().w1;
	assert.equal(n.items[0].word, null);
	assert.equal(n.approveCount, 0);
	assert.equal(n.denyCount, 0);
	apply({ authorize_id: "w2", client_ref: null, state: "exploded", items: [] });
	apply({ authorize_id: 7, state: "prompting" });
	apply(null);
	assert.deepEqual(Object.keys(noticeById()), ["w1"]);
});

test("U7: an ended foreign prompt leaves a dismissible trace; our own leaves none", () => {
	m.resetClientRefsForTests();
	m.resetAuthorizeNoticesForTests();
	const ours = m.beginOwnPrompt();
	apply(prompt("mine", ours));
	apply(prompt("mine", ours, "signed"));
	apply(prompt("theirs", null));
	apply(prompt("theirs", null, "dismissed"));
	const traces = m.foreignPromptTraces();
	assert.equal(traces.length, 1);
	assert.equal(traces[0].authorizeId, "theirs");
	assert.equal(traces[0].ended, "dismissed");
	assert.equal(traces[0].count, 1);
	m.dismissForeignPromptTrace("theirs");
	assert.equal(m.foreignPromptTraces().length, 0);
	m.endOwnPrompt(ours);
});

test("a dropped feed clears every standing notice and leaves no guessed trace", () => {
	m.resetAuthorizeNoticesForTests();
	apply(prompt("d1", null));
	apply(prompt("d2", null));
	let calls = 0;
	const off = m.subscribeAuthorizeNotices(() => calls++);
	m.clearAuthorizeNotices();
	assert.equal(m.authorizeNoticesSnapshot().length, 0);
	assert.equal(m.foreignPromptTraces().length, 0);
	assert.equal(calls, 1);
	off();
});

test("S-7 / R2-01: a feed drop retires every unbound own ref, so no later frame can claim it", () => {
	m.resetClientRefsForTests();
	m.resetAuthorizeNoticesForTests();
	// `bound`: our prompting frame was seen before the drop.
	const bound = m.beginOwnPrompt();
	apply(prompt("seen", bound));
	// `unbound`: our prompting frame was lost while the feed was down.
	const unbound = m.beginOwnPrompt();
	m.clearAuthorizeNotices();
	// After reconnect, the first frame carrying the unbound ref is a replay.
	apply(prompt("replay_after_drop", unbound));
	assert.equal(
		noticeById().replay_after_drop.foreign,
		true,
		"an unbound ref cannot be claimed after a drop",
	);
	// A ref bound before the drop still names its own prompt.
	apply(prompt("seen", bound, "signed"));
	apply(prompt("seen", bound));
	assert.equal(noticeById().seen.foreign, false);
	apply(prompt("replay_bound", bound));
	assert.equal(noticeById().replay_bound.foreign, true);
	// It also holds when the drop finds no notice standing.
	m.resetAuthorizeNoticesForTests();
	const quiet = m.beginOwnPrompt();
	m.clearAuthorizeNotices();
	apply(prompt("replay_quiet", quiet));
	assert.equal(noticeById().replay_quiet.foreign, true);
	m.endOwnPrompt(bound);
	m.endOwnPrompt(unbound);
	m.endOwnPrompt(quiet);
});

test("the feed hook clears notices when the transport drops (wiring)", async () => {
	const { readFile } = await import("node:fs/promises");
	const src = await readFile(
		"src/renderer/src/shared/hooks/use-desktop-feed.ts",
		"utf8",
	);
	assert.match(src, RE_FEED_DROP);
	assert.match(src, RE_FEED_APPLY);
});

test("a closing frame clears its notice; a repeated delivery is applied once", () => {
	m.clearAuthorizeNotices();
	let calls = 0;
	const off = m.subscribeAuthorizeNotices(() => calls++);
	const frame = {
		authorize_id: "p9",
		client_ref: null,
		state: "prompting",
		items: [],
	};
	m.applyAuthorizeFrame(frame, "e:9");
	m.applyAuthorizeFrame(frame, "e:9");
	assert.equal(calls, 1);
	assert.equal(m.authorizeNoticesSnapshot().length, 1);
	for (const state of ["signed", "dismissed", "refused"]) {
		m.applyAuthorizeFrame(frame, `e:p-${state}`);
		m.applyAuthorizeFrame({ ...frame, state }, `e:c-${state}`);
		assert.equal(m.authorizeNoticesSnapshot().length, 0, state);
	}
	off();
});

// -- 4. the 50-item cap ----------------------------------------------------------

test("selection never grows past 50, by toggling, select-all, or a large set", () => {
	assert.equal(m.TEAM_BRIDGE_APPROVAL_BATCH_MAX, 50);
	const rows = Array.from({ length: 60 }, (_, i) =>
		row({ message_id: `m${i}` }),
	);
	const all = m.selectAllDecidable(rows);
	assert.equal(all.next.size, 50);
	assert.equal(all.capped, true);
	const toggled = m.toggleSelected(all.next, "m55");
	assert.equal(toggled.capped, true);
	assert.equal(toggled.next.size, 50);
	assert.equal(m.toggleSelected(all.next, "m0").next.size, 49);
	const built = m.buildSelection(
		rows,
		new Set(rows.map((r) => r.message_id)),
		"approve",
	);
	assert.equal(built.items.length, 50);
	const fewer = m.selectAllDecidable(rows.slice(0, 3));
	assert.equal(fewer.capped, false);
});

test("the waiting label: zero shows nothing, one is singular, many is plural", () => {
	assert.equal(m.requestsWaitingLabel(0), null);
	assert.equal(m.requestsWaitingLabel(1), "1 request waiting");
	assert.equal(m.requestsWaitingLabel(3), "3 requests waiting");
});

test("per-item results read as approved/denied, or say plainly what was not sent", () => {
	const base = {
		message_id: "a",
		decision: "approve",
		sent: true,
		ask_settled: true,
	};
	assert.equal(m.resultLine({ ...base, status: "approved" }).tone, "done");
	assert.equal(m.resultLine({ ...base, status: "denied" }).label, "Denied");
	assert.equal(
		m.resultLine({ ...base, sent: false, error: "no_open_ask" }).tone,
		"not_sent",
	);
	assert.equal(
		m.resultLine({ ...base, error: "request_already_decided" }).tone,
		"done",
	);
	assert.equal(m.resultLine({ ...base, error: "zzz" }).tone, "not_sent");
});

test("Q5: local authority refusals each say what changed", () => {
	const base = {
		message_id: "a",
		decision: "approve",
		sent: false,
		ask_settled: false,
	};
	const labels = new Set();
	for (const error of [
		"not_designated",
		"owner_changed",
		"feature_off",
		"consent_revoked",
	]) {
		const line = m.resultLine({ ...base, error });
		assert.equal(line.tone, "not_sent", error);
		assert.notEqual(line.label, "Not sent", error);
		labels.add(line.label);
	}
	assert.equal(labels.size, 4);
});

test("R1-04 / Q4 / N3: challenge limit, an unconfirmed decide and a dismissal each read accurately", () => {
	const limit = m.mapApprovalRefusal(refusal("operator_challenge_limit"));
	assert.equal(limit.kind, "challenge_limit");
	assert.match(limit.message, RE_4);
	const lost = m.mapApprovalRefusal(
		new m.DesktopControlError(503, "x"),
		undefined,
		"decide",
	);
	assert.equal(lost.kind, "unconfirmed");
	assert.match(lost.message, RE_UNCONFIRMED);
	// The same failure BEFORE Touch ID stays the generic line.
	assert.equal(
		m.mapApprovalRefusal(new m.DesktopControlError(503, "x")).kind,
		"other",
	);
	// A 4xx at decide is not "couldn't be reached".
	assert.equal(
		m.mapApprovalRefusal(
			new m.DesktopControlError(422, "x"),
			undefined,
			"decide",
		).kind,
		"other",
	);
	assert.match(
		m.mapApprovalRefusal(refusal("operator_signature_unavailable")).message,
		RE_WAIT,
	);
});

test("U6: the batch preview counts what each word would actually send", () => {
	const rows = [
		row({ message_id: "a" }),
		row({ message_id: "b", unsent_decision: "approve" }),
		row({ message_id: "c" }),
	];
	const preview = m.selectionPreview(rows, new Set(["a", "b", "c"]));
	assert.deepEqual(preview.approve, { send: 3, left: 0 });
	assert.deepEqual(preview.deny, { send: 2, left: 1 });
});

test("D7: the results summary counts decided and not-sent items", () => {
	const base = {
		message_id: "a",
		decision: "approve",
		sent: true,
		ask_settled: true,
	};
	assert.deepEqual(
		m.resultsSummary([
			{ ...base, status: "approved" },
			{ ...base, error: "answered_on_card" },
			{ ...base, error: "messaging_unavailable" },
		]),
		{ done: 2, notSent: 1 },
	);
});

test("U2: what this machine decided is remembered in memory, bounded, never with a body", () => {
	m.resetDecidedForTests();
	m.rememberDecided("acct_a", "x", {
		sender: "Priya",
		excerpt: "may it deploy?",
		sessionId: "s1",
	});
	assert.deepEqual(Object.keys(m.decidedSnapshot("x")).sort(), [
		"excerpt",
		"sender",
		"sessionId",
	]);
	for (let i = 0; i < 250; i++)
		m.rememberDecided("acct_a", `m${i}`, {
			sender: "S",
			excerpt: null,
			sessionId: null,
		});
	assert.equal(
		m.decidedSnapshot("x"),
		null,
		"the oldest is forgotten past the bound",
	);
	assert.notEqual(m.decidedSnapshot("m249"), null);
});

test("R2-02: the decided excerpts go with the account - switch, sign-out, or a write for another", () => {
	m.resetDecidedForTests();
	const snap = { sender: "Priya", excerpt: "may it deploy?", sessionId: "s1" };
	m.rememberDecided("acct_a", "x", snap);
	m.retainDecidedFor("acct_a");
	assert.notEqual(m.decidedSnapshot("x"), null, "same account keeps it");
	m.retainDecidedFor("acct_b");
	assert.equal(m.decidedSnapshot("x"), null, "an account switch forgets it");
	m.rememberDecided("acct_b", "y", snap);
	m.retainDecidedFor(undefined);
	assert.equal(m.decidedSnapshot("y"), null, "a sign-out forgets it");
	m.rememberDecided("acct_a", "z", snap);
	assert.notEqual(m.decidedSnapshot("z"), null, "an ownerless store adopts");
	m.retainDecidedFor("acct_b");
	m.rememberDecided("acct_b", "w", snap);
	assert.equal(m.decidedSnapshot("z"), null, "the switch forgot A's excerpt");
	assert.notEqual(m.decidedSnapshot("w"), null);
	m.forgetDecided();
	assert.equal(m.decidedSnapshot("w"), null);
});

test("S-8: a decide settling after an account switch never re-seeds the previous account's excerpts", () => {
	m.resetDecidedForTests();
	const snap = { sender: "Priya", excerpt: "may it deploy?", sessionId: "s1" };
	m.retainDecidedFor("acct_a");
	m.rememberDecided("acct_a", "a1", snap);
	// The person switches to B while A's decide is still in flight.
	m.retainDecidedFor("acct_b");
	m.rememberDecided("acct_b", "b1", snap);
	// A's decide settles late, still carrying A's account.
	m.rememberDecided("acct_a", "a2", snap);
	assert.equal(m.decidedSnapshot("a2"), null, "the late A write is dropped");
	assert.equal(m.decidedSnapshot("a1"), null, "A's earlier excerpt stays gone");
	assert.notEqual(
		m.decidedSnapshot("b1"),
		null,
		"B keeps its own excerpt and its ownership",
	);
	m.rememberDecided("acct_b", "b2", snap);
	assert.notEqual(m.decidedSnapshot("b2"), null, "B still writes after it");
});

// -- 5. the wire: the IPC contract refuses what the route would refuse ----------

const contractBundle = await build({
	stdin: {
		contents: `export { desktopRequestSchema, desktopEndpoint, desktopRequestDeadlineMs } from "./src/shared/desktop-contract";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	mainFields: ["module", "main"],
	conditions: ["import"],
	write: false,
});
const c = await import(
	`data:text/javascript;base64,${Buffer.from(contractBundle.outputFiles[0].text).toString("base64")}`
);

test("the selection ops refuse 51 items and a client_ref outside lowercase hex <=32", () => {
	const items = (n) =>
		Array.from({ length: n }, (_, i) => ({
			message_id: `m${i}`,
			decision: "approve",
		}));
	const authorize = (over) => ({
		op: "team_bridge.requests.authorize",
		expected_account_id: "acct_1",
		items: items(1),
		client_ref: "ab12",
		...over,
	});
	assert.equal(
		c.desktopRequestSchema.safeParse(authorize({ items: items(50) })).success,
		true,
	);
	assert.equal(
		c.desktopRequestSchema.safeParse(authorize({ items: items(51) })).success,
		false,
	);
	assert.equal(
		c.desktopRequestSchema.safeParse(authorize({ items: [] })).success,
		false,
	);
	assert.equal(
		c.desktopRequestSchema.safeParse(authorize({ client_ref: "AB12" })).success,
		false,
	);
	assert.equal(
		c.desktopRequestSchema.safeParse(authorize({ client_ref: "a".repeat(33) }))
			.success,
		false,
	);
	assert.equal(
		c.desktopRequestSchema.safeParse(
			authorize({ items: [{ message_id: "m1", decision: "maybe" }] }),
		).success,
		false,
	);
});

test("the tenant guard still applies to every other team_bridge op; only approvals ops are exempt", () => {
	const join = {
		op: "team_bridge.conversations.join",
		expected_account_id: "acct_1",
		conversation_id: "conv_1",
	};
	assert.equal(c.desktopRequestSchema.safeParse(join).success, false);
	assert.equal(
		c.desktopRequestSchema.safeParse({ ...join, tenant_id: "tnt_1" }).success,
		true,
	);
	assert.equal(
		c.desktopRequestSchema.safeParse({
			op: "team_bridge.requests.list",
			expected_account_id: "acct_1",
		}).success,
		true,
	);
});

test("each op reaches its #4099 route, with query values encoded", () => {
	const list = c.desktopEndpoint({
		op: "team_bridge.requests.list",
		expected_account_id: "acct_1",
		after: "c&x=1",
		limit: 100,
	});
	assert.equal(list.method, "GET");
	assert.equal(
		list.path,
		"/v1/desktop/team-bridge/requests?expected_account_id=acct_1&after=c%26x%3D1&limit=100",
	);
	const ledger = c.desktopEndpoint({
		op: "team_bridge.decisions.list",
		expected_account_id: "acct_1",
		role: "made",
	});
	assert.equal(
		ledger.path,
		"/v1/desktop/team-bridge/decisions?expected_account_id=acct_1&role=made",
	);
	const items = [{ message_id: "m1", decision: "deny" }];
	const authorize = c.desktopEndpoint({
		op: "team_bridge.requests.authorize",
		expected_account_id: "acct_1",
		items,
		client_ref: "ab",
	});
	assert.equal(
		authorize.path,
		"/v1/desktop/team-bridge/requests/decide/authorize",
	);
	assert.deepEqual(authorize.body, {
		expected_account_id: "acct_1",
		items,
		client_ref: "ab",
	});
	const proof = { challenge: "0".repeat(64), sig: "ab", key_id: "k" };
	const decide = c.desktopEndpoint({
		op: "team_bridge.requests.decide",
		expected_account_id: "acct_1",
		items,
		operator_proof: proof,
	});
	assert.equal(decide.path, "/v1/desktop/team-bridge/requests/decide");
	assert.deepEqual(decide.body, {
		expected_account_id: "acct_1",
		items,
		operator_proof: proof,
	});
});

test("authorize waits as long as a Touch ID gesture may take, not the 20 s control budget", () => {
	assert.ok(
		c.desktopRequestDeadlineMs("team_bridge.requests.authorize") >= 180_000,
	);
	assert.equal(
		c.desktopRequestDeadlineMs("team_bridge.requests.authorize"),
		c.desktopRequestDeadlineMs("approvals.approve"),
	);
});
