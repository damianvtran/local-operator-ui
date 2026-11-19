import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/**
 * The desktop community surface's rules (RFC v2.4 §5.1-§5.5; frames D1-D7, D20)
 * and its thirteen desktop ops, executed through esbuild so the test runs the
 * SAME TypeScript the renderer bundles (the house pattern of
 * `team-bridge-org-defaults.test.mjs`).
 *
 * WHAT IS PINNED, AND WHY.
 * - D1: the community join survives every billing state (signed-out excepted),
 *   an outage is a retryable plan-check failure and never "no plan", existing
 *   Team access is never covered, and the checkout URL names the SELECTED org.
 * - D7: a draft is cleared ONLY on publish; every other outcome keeps it, and
 *   each wire refusal maps to its own sender-only phase with its facts.
 * - Timeline: pages merge by id (highest revision wins) in `seq` order, so an
 *   event refetch under loaded older pages cannot duplicate or reorder rows.
 * - Events invalidate exactly the reads they name.
 * - The op table: every daemon member route is reachable with its method and
 *   path, ids cannot reshape a URL, and the owner receipt rides the query.
 */
const bundle = await build({
	stdin: {
		contents: [
			`export * from "./src/renderer/src/features/community/community-model";`,
			`export { communityFailure } from "./src/renderer/src/shared/api/local-operator/community-api";`,
			`export { DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api";`,
			`export { paletteShortcutIntent } from "./src/renderer/src/features/command-palette/palette-shortcut";`,
			`export { desktopEndpoint, desktopRequestSchema, desktopRequestDeadlineMs, desktopRequestByteBudget, COMMUNITY_OPS } from "./src/shared/desktop-contract";`,
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	mainFields: ["module", "main"],
	write: false,
	logLevel: "silent",
	tsconfig: "tsconfig.app.json",
});
const m = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const subscribe = (tenantId) =>
	`https://console.example/checkout?tenant=${tenantId}`;
const noPlan = (overrides = {}) =>
	m.communityNoPlanView({
		signedIn: true,
		privateAccess: "no_team_plan",
		trialOffer: "eligible",
		communityAccess: "joinable",
		selectedTenantId: "tnt_robotics",
		selectedOrgName: "Tran Robotics",
		subscribeUrl: subscribe,
		trialStartEnabled: true,
		...overrides,
	});

/* ------------------------------------------------------------------ D1 */

test("D1: signed out offers sign-in only", () => {
	assert.deepEqual(noPlan({ signedIn: false }), { kind: "signed_out" });
});

test("D1/M3: memberships showing a Team plan under the plan-required gate draw the shipped panel plus the join, never a blank canvas", () => {
	assert.deepEqual(noPlan({ privateAccess: "available" }), {
		kind: "plan_panel",
		community: "joinable",
	});
});

test("m5: the trial hold keeps the shipped upgrade panel, never trial copy, and always offers the join", () => {
	for (const privateAccess of [
		"available",
		"no_org",
		"no_team_plan",
		"other_unavailable",
		"unknown",
	])
		for (const trialOffer of ["eligible", "checkout_open", "reconciling"]) {
			const view = noPlan({
				trialStartEnabled: false,
				privateAccess,
				trialOffer,
				communityAccess: "joined",
			});
			assert.deepEqual(
				view,
				{ kind: "plan_panel", community: "joined" },
				JSON.stringify({ privateAccess, trialOffer }),
			);
		}
	// Signed out still answers sign-in only.
	assert.equal(
		noPlan({ trialStartEnabled: false, signedIn: false }).kind,
		"signed_out",
	);
});

test("m3: a pending list read is checking and a failed one is retryable - neither is 'unavailable'", () => {
	const access = (over) =>
		m.communityAccessFrom({
			pending: false,
			failure: null,
			joined: 0,
			featured: 0,
			...over,
		});
	assert.equal(access({ pending: true }), "checking");
	assert.equal(access({ failure: "unreachable" }), "failed");
	assert.equal(access({ failure: "error" }), "failed");
	// A real off is not retryable.
	assert.equal(access({ failure: "disabled" }), "unavailable");
	assert.equal(access({}), "unavailable");
	assert.equal(access({ featured: 1 }), "joinable");
	assert.equal(access({ joined: 1, featured: 1 }), "joined");
});

test("D1: an outage is a retryable plan check, never a commercial claim, and keeps the join", () => {
	for (const input of [
		{ privateAccess: "other_unavailable" },
		{ trialOffer: "unknown" },
	]) {
		const view = noPlan(input);
		assert.equal(view.kind, "plan_check_failed");
		assert.equal(view.community, "joinable");
	}
});

test("D1: pending reads are a placeholder, not a premature 'no plan'", () => {
	assert.equal(noPlan({ privateAccess: "unknown" }).kind, "checking");
	assert.equal(noPlan({ signedIn: "unknown" }).kind, "checking");
});

test("D1: each trial_offer arm, with the community join beside every one", () => {
	const cases = [
		[{ privateAccess: "no_org" }, "create_org"],
		[{ trialOffer: "owner_required" }, "ask_owner"],
		[{ trialOffer: "eligible" }, "start"],
		[{ trialOffer: "checkout_open" }, "resume"],
		[{ trialOffer: "reconciling" }, "reconciling"],
		[{ trialOffer: "ineligible" }, null],
	];
	for (const [input, kind] of cases) {
		const view = noPlan({ ...input, communityAccess: "joined" });
		assert.equal(view.kind, "offer", JSON.stringify(input));
		assert.equal(view.trial?.kind ?? null, kind, JSON.stringify(input));
		// "billing failures never disable community join"
		assert.equal(view.community, "joined");
	}
});

test("D1: the checkout is pinned to the selected org, never the Console default", () => {
	const view = noPlan();
	assert.equal(view.trial.kind, "start");
	assert.equal(view.trial.tenantId, "tnt_robotics");
	assert.equal(view.trial.url, subscribe("tnt_robotics"));
	// No org selected: no checkout at all rather than an unpinned one.
	assert.equal(noPlan({ selectedTenantId: null }).trial, null);
});

test("D1 inputs: memberships map onto private_access and pick the home org", () => {
	const row = (extra) => ({
		tenant_id: "t1",
		role: "owner",
		status: "active",
		...extra,
	});
	assert.equal(
		m.privateAccessFromMemberships({
			pending: true,
			failed: false,
			memberships: null,
		}).access,
		"unknown",
	);
	assert.equal(
		m.privateAccessFromMemberships({
			pending: false,
			failed: true,
			memberships: null,
		}).access,
		"other_unavailable",
	);
	assert.equal(
		m.privateAccessFromMemberships({
			pending: false,
			failed: false,
			memberships: [row({ status: "pending" })],
		}).access,
		"no_org",
	);
	assert.equal(
		m.privateAccessFromMemberships({
			pending: false,
			failed: false,
			memberships: [row({ plan: { status: "past_due" } })],
		}).access,
		"available",
	);
	const picked = m.privateAccessFromMemberships({
		pending: false,
		failed: false,
		memberships: [
			row({ tenant_id: "a" }),
			row({ tenant_id: "home", is_home: true }),
		],
	});
	assert.equal(picked.access, "no_team_plan");
	assert.equal(picked.selected.tenant_id, "home");
});

test("D1 inputs: trial_offer follows eligibility, else the role", () => {
	const owner = { tenant_id: "t", role: "owner", status: "active" };
	const member = { ...owner, role: "member" };
	const offer = (eligibility, selected) =>
		m.trialOfferFrom({ eligibility, selected });
	assert.equal(offer({ eligible: true, reason: null }, owner), "eligible");
	assert.equal(
		offer({ eligible: true, reason: null }, member),
		"owner_required",
	);
	assert.equal(
		offer({ eligible: false, reason: "not_owner" }, owner),
		"owner_required",
	);
	assert.equal(
		offer({ eligible: false, reason: "trial_used" }, owner),
		"ineligible",
	);
	// Unreadable eligibility: the Console decides at checkout for an owner.
	assert.equal(offer(null, owner), "eligible");
	assert.equal(offer(null, member), "owner_required");
});

/* ---------------------------------------------------------- channels */

const channel = (name, extra = {}) => ({
	id: `ch_${name}`,
	name,
	visibility: "public",
	member: true,
	...extra,
});

test("rail: launch channels first in RFC order, private rooms apart, unjoined and archived out", () => {
	const rows = [
		channel("tui-themes", { member: false }),
		channel("show-and-tell"),
		channel("help", { unread: 3 }),
		channel("beta-testers", { visibility: "private" }),
		channel("general"),
		channel("old", { archived: true }),
		channel("welcome-and-rules", { locked: true }),
		channel("zeta"),
	];
	const rail = m.railChannels(rows);
	assert.deepEqual(
		rail.channels.map((c) => c.name),
		["welcome-and-rules", "general", "help", "show-and-tell", "zeta"],
	);
	assert.deepEqual(
		rail.private.map((c) => c.name),
		["beta-testers"],
	);
	assert.equal(m.landingChannel(rows).name, "welcome-and-rules");
	// Unread counts only joined channels.
	assert.equal(
		m.communityUnreadTotal([
			...rows,
			channel("x", { member: false, unread: 9 }),
		]),
		3,
	);
});

test("posting and audience: #welcome-and-rules is staff-only, a read-only community stops all posts", () => {
	const welcome = channel("welcome-and-rules", { locked: true });
	assert.equal(m.postingState(welcome, "active"), "locked");
	assert.equal(
		m.postingState(channel("general"), "read_only"),
		"community_read_only",
	);
	assert.equal(
		m.postingState(channel("old", { archived: true }), "active"),
		"archived",
	);
	assert.equal(m.postingState(channel("general"), "active"), "open");
	assert.equal(m.composerAudience(welcome).kind, "all_members_staff_post");
	assert.equal(m.composerAudience(channel("general")).kind, "all_members");
	assert.equal(
		m.composerAudience(channel("b", { visibility: "private" })).kind,
		"private_channel",
	);
});

test("browse: chips and search; a private room you are not in is never listed", () => {
	const rows = [
		channel("general", { purpose: "Say hi" }),
		channel("mcp-servers", { member: false, purpose: "Building MCP servers" }),
		channel("beta-testers", { visibility: "private" }),
		channel("secret", { visibility: "private", member: false }),
	];
	const names = (filter, q) =>
		m.browseChannels(rows, filter, q).map((c) => c.name);
	assert.deepEqual(names("all"), ["general", "beta-testers", "mcp-servers"]);
	assert.deepEqual(names("not_joined"), ["mcp-servers"]);
	assert.deepEqual(names("private"), ["beta-testers"]);
	assert.deepEqual(names("all", "mcp"), ["mcp-servers"]);
	assert.deepEqual(names("all", "say HI"), ["general"]);
});

/* ---------------------------------------------------------- timeline */

const msg = (id, seq, extra = {}) => ({
	id,
	conversation_id: "c",
	seq,
	author: { kind: "human", display_name: "A", public_id: "p1" },
	created_at: "2026-11-18T10:00:00Z",
	text: id,
	...extra,
});

test("history: overlapping pages merge by id, highest revision wins, seq order", () => {
	const newest = {
		items: [msg("m3", 3), msg("m2", 2, { revision: 2, text: "edited" })],
	};
	const older = { items: [msg("m2", 2, { revision: 1 }), msg("m1", 1)] };
	const merged = m.mergeHistory([newest, older]);
	assert.deepEqual(
		merged.map((x) => x.id),
		["m1", "m2", "m3"],
	);
	assert.equal(merged[1].text, "edited");
	const withReply = [...merged, msg("r1", 4, { thread_root_id: "m1" })];
	assert.deepEqual(
		m.timelineMessages(withReply).map((x) => x.id),
		["m1", "m2", "m3"],
	);
	assert.deepEqual(
		m.threadReplies(withReply, "m1").map((x) => x.id),
		["r1"],
	);
});

test("reactions toggle optimistically and report add/remove", () => {
	const base = msg("m", 1, {
		reactions: [{ emoji: "+1", count: 2, mine: false }],
	});
	const added = m.toggleReaction(base, "+1");
	assert.equal(added.remove, false);
	assert.deepEqual(added.reactions, [{ emoji: "+1", count: 3, mine: true }]);
	const removed = m.toggleReaction(
		{ ...base, reactions: added.reactions },
		"+1",
	);
	assert.equal(removed.remove, true);
	assert.deepEqual(removed.reactions, [{ emoji: "+1", count: 2, mine: false }]);
	const last = m.toggleReaction(
		msg("n", 1, { reactions: [{ emoji: "x", count: 1, mine: true }] }),
		"x",
	);
	assert.deepEqual(last.reactions, []);
});

/* --------------------------------------------------------- D7 outcomes */

const outcome = (state, extra = {}) => ({
	idempotency_key: "k".repeat(20),
	state,
	...extra,
});

test("D7: the draft is cleared only on publish", () => {
	assert.deepEqual(
		m.phaseAfterSubmission(outcome("published", { message_id: "m" })),
		{
			phase: { kind: "idle" },
			clearDraft: true,
		},
	);
	for (const state of ["checking", "cancelled", "expired"])
		assert.equal(
			m.phaseAfterSubmission(outcome(state)).clearDraft,
			false,
			state,
		);
	const refused = m.phaseAfterSubmission(
		outcome("refused", {
			refusal: {
				status: "refused",
				category: "spam_or_promotion",
				reference: "MOD-7Q2M-91XD",
			},
		}),
	);
	assert.equal(refused.clearDraft, false);
	assert.deepEqual(refused.phase, {
		kind: "refused",
		category: "spam_or_promotion",
		reference: "MOD-7Q2M-91XD",
	});
	// A refused state without its facts is an error, never a made-up category.
	assert.equal(m.phaseAfterSubmission(outcome("refused")).phase.kind, "error");
});

const refusal = (status, detail) =>
	new m.DesktopControlError(
		status,
		"x",
		undefined,
		detail?.code,
		undefined,
		detail,
	);

test("D7: wire refusals map to their own sender-only phase with their facts", () => {
	const now = 1_000_000;
	const phase = (status, detail) =>
		m.phaseAfterFailure(m.communityFailure(refusal(status, detail)), now);
	assert.deepEqual(
		phase(422, {
			code: "refused",
			category: "harassment_or_abuse",
			reference: "MOD-AAAA-BBBB",
		}),
		{
			kind: "refused",
			category: "harassment_or_abuse",
			reference: "MOD-AAAA-BBBB",
		},
	);
	assert.deepEqual(
		phase(429, {
			code: "rate_limited",
			retry_after: 40,
			scope: "account_burst",
		}),
		{
			kind: "rate_limited",
			until: now + 40_000,
			scope: "account_burst",
		},
	);
	assert.equal(
		phase(503, { code: "moderation_unavailable", retry_after: null }).kind,
		"moderation_unavailable",
	);
	assert.equal(
		phase(409, { code: "images_unavailable" }).kind,
		"images_unavailable",
	);
	assert.deepEqual(
		phase(409, { code: "guidelines_changed", guidelines_version: "2026-12" }),
		{
			kind: "guidelines_changed",
			version: "2026-12",
		},
	);
	assert.equal(phase(413, { code: "payload_too_large" }).kind, "too_large");
	assert.equal(
		m.phaseAfterFailure(
			m.communityFailure(new m.DesktopControlError(null, "down")),
			now,
		).kind,
		"offline",
	);
	// An unknown category or a malformed reference is not shown as a refusal.
	assert.equal(
		phase(422, {
			code: "refused",
			category: "politics",
			reference: "MOD-AAAA-BBBB",
		}).kind,
		"error",
	);
	assert.equal(
		phase(422, {
			code: "refused",
			category: "spam_or_promotion",
			reference: "nope",
		}).kind,
		"error",
	);
	// A limit with no usable wait still blocks (the 60 s burst window).
	assert.equal(phase(429, { code: "rate_limited" }).until, now + 60_000);
});

test("D7: sending is blocked while checking and while a limit runs", () => {
	const limited = { kind: "rate_limited", until: 10_500, scope: null };
	assert.equal(m.secondsLeft(limited, 0), 11);
	assert.equal(m.canSend(limited, 0, "hi"), false);
	assert.equal(m.canSend(limited, 10_500, "hi"), true);
	assert.equal(
		m.canSend({ kind: "checking", key: "k", cancelling: false }, 0, "hi"),
		false,
	);
	assert.equal(m.canSend({ kind: "idle" }, 0, "   "), false);
	assert.equal(m.canSend({ kind: "moderation_unavailable" }, 0, "hi"), true);
});

/* --------------------------------------------------------------- events */

test("events invalidate exactly what they name", () => {
	const work = m.invalidationsFor({
		events: [
			{ type: "conversation_changed", conversation_id: "c1" },
			{ type: "conversation_changed", conversation_id: "c1" },
			{ type: "request_changed" },
		],
	});
	assert.deepEqual(work, {
		community: false,
		channels: false,
		conversations: ["c1"],
	});
	assert.deepEqual(
		m.invalidationsFor({ events: [{ type: "unread_changed" }] }),
		{
			community: false,
			channels: true,
			conversations: [],
		},
	);
	assert.deepEqual(
		m.invalidationsFor({ events: [{ type: "membership_changed" }] }),
		{
			community: true,
			channels: true,
			conversations: [],
		},
	);
	assert.deepEqual(
		[0, 1, 2, 3, 6, 10].map((n) => m.eventsBackoffMs(n)),
		[0, 1000, 2000, 4000, 30_000, 30_000],
	);
});

test("images: type, size and count are refused before anything is read; names are generated", () => {
	const limits = { maxBytes: 5 * 1024 * 1024, maxImages: 4 };
	assert.equal(
		m.imageRejection({ type: "image/gif", size: 1 }, 0, limits),
		"type",
	);
	assert.equal(
		m.imageRejection(
			{ type: "image/png", size: limits.maxBytes + 1 },
			0,
			limits,
		),
		"size",
	);
	assert.equal(
		m.imageRejection({ type: "image/png", size: 1 }, 4, limits),
		"count",
	);
	assert.equal(
		m.imageRejection({ type: "image/webp", size: 1 }, 3, limits),
		null,
	);
	assert.equal(m.attachmentName(0, "image/jpeg"), "image-1.jpg");
	assert.equal(m.attachmentName(2, "image/png"), "image-3.png");
});

/* ------------------------------------------------------------- the ops */

const ACCOUNT = "acct_1";
const C = "/v1/desktop/community/communities/local-operator";

test("ops: the thirteen daemon member routes, method and path, owner receipt in the query", () => {
	const q = `?expected_account_id=${ACCOUNT}`;
	const rows = [
		[
			{ op: "community.communities.list" },
			"GET",
			`/v1/desktop/community/communities${q}`,
		],
		[
			{ op: "community.bootstrap", community_id: "local-operator" },
			"GET",
			`${C}/bootstrap${q}`,
		],
		[
			{
				op: "community.join",
				community_id: "local-operator",
				guidelines_version: "2026-11",
				accept_guidelines: true,
			},
			"POST",
			`${C}/join${q}`,
		],
		[
			{ op: "community.leave", community_id: "local-operator" },
			"POST",
			`${C}/leave${q}`,
		],
		[
			{
				op: "community.channels",
				community_id: "local-operator",
				q: "mcp",
				filter: "joined",
			},
			"GET",
			`${C}/channels${q}&q=mcp&filter=joined`,
		],
		[
			{
				op: "community.history",
				community_id: "local-operator",
				conversation_id: "ch_1",
				cursor: "abc",
			},
			"GET",
			`${C}/conversations/ch_1/messages${q}&cursor=abc`,
		],
		[
			{
				op: "community.submit",
				community_id: "local-operator",
				conversation_id: "ch_1",
				text: "hi",
				idempotency_key: "lo_0123456789abcdef",
			},
			"POST",
			`${C}/conversations/ch_1/messages${q}`,
		],
		[
			{
				op: "community.submission.status",
				community_id: "local-operator",
				idempotency_key: "lo_0123456789abcdef",
			},
			"GET",
			`${C}/submissions/lo_0123456789abcdef${q}`,
		],
		[
			{
				op: "community.submission.cancel",
				community_id: "local-operator",
				idempotency_key: "lo_0123456789abcdef",
			},
			"POST",
			`${C}/submissions/lo_0123456789abcdef/cancel${q}`,
		],
		[
			{
				op: "community.edit",
				community_id: "local-operator",
				message_id: "m_1",
				text: "x",
			},
			"POST",
			`${C}/messages/m_1/edit${q}`,
		],
		[
			{
				op: "community.delete",
				community_id: "local-operator",
				message_id: "m_1",
			},
			"DELETE",
			`${C}/messages/m_1${q}`,
		],
		[
			{
				op: "community.react",
				community_id: "local-operator",
				message_id: "m_1",
				emoji: "+1",
			},
			"POST",
			`${C}/messages/m_1/reactions${q}`,
		],
		[
			{ op: "community.events", community_id: "local-operator", after: "e1" },
			"GET",
			`${C}/events${q}&after=e1`,
		],
	];
	assert.equal(rows.length, m.COMMUNITY_OPS.length);
	for (const [request, method, path] of rows) {
		const full = { ...request, expected_account_id: ACCOUNT };
		m.desktopRequestSchema.parse(full);
		const endpoint = m.desktopEndpoint(full);
		assert.equal(endpoint.method, method, request.op);
		assert.equal(endpoint.path, path, request.op);
	}
});

test("ops: bodies carry only the daemon's strict fields; join is an explicit acceptance", () => {
	const submit = m.desktopEndpoint({
		op: "community.submit",
		community_id: "local-operator",
		conversation_id: "ch_1",
		text: "hi",
		thread_root_id: "m_0",
		idempotency_key: "lo_0123456789abcdef",
		expected_account_id: ACCOUNT,
	});
	assert.deepEqual(submit.body, {
		text: "hi",
		images: [],
		thread_root_id: "m_0",
		idempotency_key: "lo_0123456789abcdef",
	});
	assert.throws(() =>
		m.desktopRequestSchema.parse({
			op: "community.join",
			community_id: "local-operator",
			guidelines_version: "2026-11",
			accept_guidelines: false,
		}),
	);
});

test("ops: an id cannot reshape the URL and the grammar matches the daemon's", () => {
	const bad = [
		{ op: "community.bootstrap", community_id: "../admin" },
		{ op: "community.bootstrap", community_id: "LO" },
		{
			op: "community.history",
			community_id: "local-operator",
			conversation_id: "a/b",
		},
		{
			op: "community.delete",
			community_id: "local-operator",
			message_id: "m?x=1",
		},
		{
			op: "community.submission.status",
			community_id: "local-operator",
			idempotency_key: "short",
		},
		{
			op: "community.submit",
			community_id: "local-operator",
			conversation_id: "c",
			text: "x".repeat(4001),
		},
	];
	for (const request of bad)
		assert.throws(
			() => m.desktopRequestSchema.parse(request),
			JSON.stringify(request).slice(0, 80),
		);
	// A crafted cursor is one encoded query value.
	const crafted = m.desktopEndpoint({
		op: "community.history",
		community_id: "local-operator",
		conversation_id: "c",
		cursor: "x&expected_account_id=other",
	});
	assert.equal(
		crafted.path,
		`${C}/conversations/c/messages?cursor=x%26expected_account_id%3Dother`,
	);
});

test("ops: submit, edit and the long poll sit above the daemon's own bounds", () => {
	// Daemon: REQUEST_TIMEOUT_S = 30 (moderation in-request), EVENTS_TIMEOUT_S = 35.
	for (const op of ["community.submit", "community.edit", "community.events"])
		assert.ok(m.desktopRequestDeadlineMs(op) > 35_000, op);
	assert.equal(m.desktopRequestDeadlineMs("community.channels"), 20_000);
	// Four images at the daemon's base64 ceiling fit the submit budget.
	const perImage = 4 * Math.ceil((5 * 1024 * 1024) / 3);
	assert.ok(
		m.desktopRequestByteBudget("community.submit") >= 4 * perImage + 16_000,
	);
});

test("M1: only a call that ended without a hub answer leaves its attempt live", () => {
	const fail = (error) => m.attemptMayBeLive(m.communityFailure(error));
	assert.equal(fail(new m.DesktopControlError(null, "deadline")), true);
	assert.equal(
		fail(refusal(502, { code: "community_unreachable" })),
		true,
		"daemon 502: the hub may have it",
	);
	for (const detail of [
		{
			code: "refused",
			category: "spam_or_promotion",
			reference: "MOD-AB12-CD34",
		},
		{ code: "rate_limited", retry_after: 30 },
		{ code: "moderation_unavailable" },
		{ code: "guidelines_changed", guidelines_version: "v2" },
		{ code: "payload_too_large" },
		{ code: "account_mismatch" },
	])
		assert.equal(fail(refusal(409, detail)), false, detail.code);
	const draft = {
		text: "a",
		images: [{ content_type: "image/png", data_base64: "AA" }],
	};
	assert.equal(
		m.sameDraftBytes(draft, { ...draft, images: [...draft.images] }),
		true,
	);
	assert.equal(m.sameDraftBytes(draft, { ...draft, text: "b" }), false);
	assert.equal(m.sameDraftBytes(draft, { ...draft, images: [] }), false);
});

test("M2: stale guidelines block sending; only the composer that hit the 409 keeps its box", () => {
	const now = 1_000_000;
	assert.equal(
		m.canSend({ kind: "guidelines_changed", version: "v2" }, now, "hi"),
		false,
	);
	assert.equal(
		m.guidelinesNeedReaccept({
			guidelines: { version: "v2" },
			membership: { guidelines_version: "v1" },
		}),
		true,
	);
	assert.equal(
		m.guidelinesNeedReaccept({
			guidelines: { version: "v2" },
			membership: { guidelines_version: "v2" },
		}),
		false,
	);
	assert.equal(
		m.guidelinesNeedReaccept({
			guidelines: { version: "v2" },
			membership: null,
		}),
		false,
		"a non-member joins; there is nothing to re-accept",
	);
	const idle = { kind: "idle" };
	const hit = { kind: "guidelines_changed", version: "v2" };
	assert.equal(m.postingFor("open", true, idle), "guidelines_changed");
	assert.equal(m.postingFor("open", true, hit), "open");
	assert.equal(m.postingFor("open", false, idle), "open");
	// A channel closed anyway keeps its own reason.
	assert.equal(m.postingFor("locked", true, idle), "locked");
});

test("m4: own messages survive a reload through the learned, per-account public id", () => {
	const values = new Map();
	const storage = {
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, value),
	};
	const message = (id, publicId, kind = "human") => ({
		id,
		conversation_id: "c",
		seq: 1,
		created_at: "2026-11-18T00:00:00Z",
		author: { kind, display_name: "x", public_id: publicId },
	});
	const loaded = [message("m1", "pub_other"), message("m2", "pub_me")];
	assert.equal(m.learnSelfPublicId(loaded, new Set(["m2"])), "pub_me");
	assert.equal(m.learnSelfPublicId(loaded, new Set()), null);
	m.writeSelfPublicId(storage, "acct_a", "com_1", "pub_me");
	// "Reload": a fresh read from storage, no session ids.
	const self = m.readSelfPublicId(storage, "acct_a", "com_1");
	assert.equal(self, "pub_me");
	assert.equal(m.isOwnMessage(message("m9", "pub_me"), self), true);
	assert.equal(m.isOwnMessage(message("m8", "pub_other"), self), false);
	// Another account, or another community, is someone else.
	assert.equal(m.readSelfPublicId(storage, "acct_b", "com_1"), null);
	assert.equal(m.readSelfPublicId(storage, "acct_a", "com_2"), null);
	assert.equal(m.readSelfPublicId(storage, undefined, "com_1"), null);
	// A corrupt entry is no answer, never a throw.
	values.set(m.COMMUNITY_SELF_KEY, "{not json");
	assert.equal(m.readSelfPublicId(storage, "acct_a", "com_1"), null);
});

test("M4: Browse is Cmd/Ctrl+Shift+K, which the global palette never claims", () => {
	const press = (over) => ({
		key: "k",
		metaKey: false,
		ctrlKey: false,
		altKey: false,
		shiftKey: false,
		repeat: false,
		defaultPrevented: false,
		...over,
	});
	for (const mod of [{ metaKey: true }, { ctrlKey: true }]) {
		const browse = press({ ...mod, shiftKey: true, key: "K" });
		assert.equal(m.isCommunityBrowsePress(browse), true);
		assert.equal(m.paletteShortcutIntent(browse), null, "no double dialog");
		const palette = press(mod);
		assert.equal(
			m.isCommunityBrowsePress(palette),
			false,
			"Cmd+K stays the palette's",
		);
		assert.equal(m.paletteShortcutIntent(palette), "chats");
	}
	assert.equal(
		m.isCommunityBrowsePress(
			press({ metaKey: true, shiftKey: true, repeat: true }),
		),
		false,
	);
	assert.equal(
		m.isCommunityBrowsePress(
			press({ metaKey: true, shiftKey: true, defaultPrevented: true }),
		),
		false,
	);
	assert.equal(
		m.isCommunityBrowsePress(
			press({ metaKey: true, shiftKey: true, altKey: true }),
		),
		false,
	);
	assert.equal(m.COMMUNITY_BROWSE_CHORD, "primary+shift+k");
});
