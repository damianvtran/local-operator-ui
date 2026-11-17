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
 * 3. A Touch ID prompt whose `client_ref` this renderer did not generate is
 *    labelled foreign (the S-6 security control), and a closing frame clears it.
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
const RE_5 = /Priya, Omar/;
const RE_6 = /^[0-9a-f]{32}$/;
const RE_7 = /card/;

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

test("a prompt with our client_ref is ours; any other ref, or none, is foreign", () => {
	m.resetClientRefsForTests();
	m.clearAuthorizeNotices();
	const ours = m.newClientRef();
	assert.match(ours, RE_6);
	const item = {
		message_id: "a",
		word: "approve",
		sender: "Priya",
		excerpt: "x",
	};
	m.applyAuthorizeFrame(
		{ authorize_id: "p1", client_ref: ours, state: "prompting", items: [item] },
		"e:1",
	);
	m.applyAuthorizeFrame(
		{
			authorize_id: "p2",
			client_ref: "deadbeef",
			state: "prompting",
			items: [item],
		},
		"e:2",
	);
	m.applyAuthorizeFrame(
		{ authorize_id: "p3", client_ref: null, state: "prompting", items: [] },
		"e:3",
	);
	const byId = Object.fromEntries(
		m.authorizeNoticesSnapshot().map((n) => [n.authorizeId, n]),
	);
	assert.equal(byId.p1.foreign, false);
	assert.equal(byId.p2.foreign, true);
	assert.equal(byId.p3.foreign, true);
	assert.equal(byId.p1.approveCount, 1);
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

test("the client_ref memory is bounded and forgets the oldest", () => {
	m.resetClientRefsForTests();
	const first = m.newClientRef();
	for (let i = 0; i < 64; i++) m.newClientRef();
	assert.equal(m.isOwnClientRef(first), false);
	assert.equal(m.isOwnClientRef(null), false);
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
