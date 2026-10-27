import assert from "node:assert/strict";
import { readFileSync, unlinkSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * Agent channel/group invitations (D5), exercised through the SHIPPED modules.
 *
 * WHY THIS EXISTS. An agent added to a conversation stays `invited` until its
 * OWNER accepts (agent-server `Consent`); before this surface nothing called
 * the consent op and nothing said an invitation was waiting. The claims pinned
 * here are the ones a reviewer cannot see in a still:
 *
 *  - which rows count as "your agent is invited" (built-ins, archived rows,
 *    another owner's agent and an already-active agent do not);
 *  - the rail adds NO row when nothing is waiting, and a quiet count when it is;
 *  - the wire request names the owner, the org and the pinned participation
 *    version, and accepting never touches the agent's notification register;
 *  - the optimistic answer and its exact rollback across every cached page;
 *  - an answered row stays where it was (no jitter) and each coded refusal
 *    maps to its own sentence, with retry offered only where a retry can help.
 *
 * Assertions are on booleans and strings (rendered markup text, request
 * fields, cache values), never on DOM nodes. The bundle is a real temp module
 * so the components and this test share ONE React instance (sibling pattern:
 * `team-bridge-channels.test.mjs`, including its chat-sidebar stub).
 */

const chatSidebarSource = readFileSync(
	`${process.cwd()}/src/renderer/src/features/chat/components/chat-sidebar.tsx`,
	"utf8",
);
const rowCurrentLiteral = chatSidebarSource.match(
	/export const rowCurrent =\s*("[^"]+")/,
)?.[1];
if (!rowCurrentLiteral)
	throw new Error("rowCurrent literal not found in chat-sidebar.tsx");
const CHAT_SIDEBAR = /chat\/components\/chat-sidebar$/;
const ANY = /.*/;
const chatSidebarStub = {
	name: "chat-sidebar-stub",
	setup(pluginBuild) {
		pluginBuild.onResolve({ filter: CHAT_SIDEBAR }, () => ({
			path: "chat-sidebar-stub",
			namespace: "stub",
		}));
		pluginBuild.onLoad({ filter: ANY, namespace: "stub" }, () => ({
			contents: `export const rowCurrent = ${rowCurrentLiteral};`,
			loader: "js",
		}));
	},
};

const ROOT = process.cwd();
const bundle = await build({
	stdin: {
		contents: `
			export { TeamBridgePageView } from "./src/renderer/src/features/team-bridge/team-bridge-page";
			export * from "./src/renderer/src/features/team-bridge/team-bridge-invitations";
			export * from "./src/renderer/src/features/team-bridge/team-bridge-invitations-model";
			export { invitationAnswerMutationOptions, teamBridgeKeys } from "./src/renderer/src/features/team-bridge/use-team-bridge";
			export { TeamBridgeApi } from "./src/renderer/src/shared/api/local-operator/team-bridge-api";
		`,
		resolveDir: ROOT,
		sourcefile: "team-bridge-invitations.mjs",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	jsx: "automatic",
	loader: { ".css": "empty" },
	plugins: [chatSidebarStub],
	alias: {
		"@shared": `${ROOT}/src/renderer/src/shared`,
		"@features": `${ROOT}/src/renderer/src/features`,
	},
	write: false,
});
const modulePath = new URL(
	`./_team-bridge-invitations-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(modulePath, bundle.outputFiles[0].text);
process.on("exit", () => {
	try {
		unlinkSync(modulePath.pathname);
	} catch {
		// already gone
	}
});

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { QueryClient } = await import("@tanstack/react-query");
const ui = await import(modulePath.href);

const SELF = "acct_self";
/* The v1 participation statement, verbatim. Changing it needs a new version. */
const CONSENT_V1 =
	"Accepting lets your agent read and post in this conversation from now on. It is woken only when someone @-mentions it.";
const human = (accountId, label, patch = {}) => ({
	account_id: accountId,
	kind: "human",
	display_label: label,
	role: "member",
	state: "active",
	...patch,
});
const agent = (accountId, label, state = "invited", patch = {}) => ({
	account_id: accountId,
	kind: "agent",
	display_label: label,
	role: "member",
	state,
	...patch,
});
const conversation = (patch = {}) => ({
	id: "bcv_1",
	tenant_id: "tnt_1",
	kind: "channel",
	name: "launch-room",
	visibility: "private",
	agent_capable: true,
	status: "open",
	created_by: "acct_ada",
	last_message_at: "2026-10-27T10:00:00Z",
	latest_seq: 4,
	members: [
		human("acct_ada", "Ada", { role: "owner" }),
		human(SELF, "Damian"),
		agent(SELF, "Robo Damian"),
	],
	last_read_seq: 0,
	unread_count: 0,
	muted: false,
	...patch,
});

test("only the reader's own invited agent in an open, ordinary conversation counts", () => {
	const rows = [
		conversation(),
		// Built-in: the hub refuses consent there.
		conversation({ id: "bcv_builtin", builtin: "agents" }),
		// Archived: nothing to join.
		conversation({ id: "bcv_archived", status: "archived" }),
		// Someone else's agent is theirs to answer.
		conversation({
			id: "bcv_other",
			members: [human(SELF, "Damian"), agent("acct_ben", "Ben's agent")],
		}),
		// Already active: not pending.
		conversation({
			id: "bcv_active",
			members: [human(SELF, "Damian"), agent(SELF, "Robo Damian", "active")],
		}),
		// A group, created by the reader.
		conversation({
			id: "bcv_group",
			kind: "group",
			name: "",
			created_by: SELF,
			members: [
				human(SELF, "Damian", { role: "owner" }),
				human("acct_bea", "Bea"),
				agent(SELF, "Robo Damian"),
			],
		}),
	];
	const pending = ui.pendingAgentInvitations(rows, SELF);
	assert.deepEqual(
		pending.map((row) => row.conversationId),
		["bcv_1", "bcv_group"],
	);
	assert.equal(pending[0].conversationName, "launch-room");
	assert.equal(pending[0].agentName, "Robo Damian");
	assert.equal(pending[0].key, "tnt_1|bcv_1");
	assert.deepEqual(ui.pendingAgentInvitations(rows, undefined), []);
});

test("the who-line names only what the server says", () => {
	const [created] = ui.pendingAgentInvitations([conversation()], SELF);
	assert.equal(
		ui.invitationInviterLine(created.inviter),
		"Conversation created by Ada",
	);
	// A served `invited_by` is the inviter, and wins over the creator.
	const [added] = ui.pendingAgentInvitations(
		[
			conversation({
				members: [
					human("acct_ada", "Ada", { role: "owner" }),
					human("acct_bea", "Bea"),
					agent(SELF, "Robo Damian", "invited", { invited_by: "acct_bea" }),
				],
			}),
		],
		SELF,
	);
	assert.equal(ui.invitationInviterLine(added.inviter), "Added by Bea");
	const [mine] = ui.pendingAgentInvitations(
		[conversation({ created_by: SELF })],
		SELF,
	);
	assert.equal(
		ui.invitationInviterLine(mine.inviter),
		"Conversation created by you",
	);
	// An id that resolves to no human member is not printed.
	const [unknown] = ui.pendingAgentInvitations(
		[conversation({ created_by: "acct_gone" })],
		SELF,
	);
	assert.equal(ui.invitationInviterLine(unknown.inviter), null);
});

const viewProps = (patch = {}) => ({
	selfAccountId: SELF,
	conversations: [],
	target: null,
	messages: [],
	organizations: [
		{ tenantId: "tnt_1", name: "Minerva", role: "owner", unread: 0 },
	],
	scope: "tnt_1",
	totalUnread: 0,
	listState: "ready",
	messageState: "idle",
	onTarget: () => {},
	onSend: () => {},
	onNewChannel: () => {},
	onRetry: () => {},
	onScopeChange: () => {},
	onJoin: () => {},
	onNotifyChange: () => {},
	...patch,
});

test("the rail adds no row when nothing waits, and a quiet count when it does", () => {
	const none = renderToStaticMarkup(
		createElement(ui.TeamBridgePageView, viewProps()),
	);
	assert.equal(none.includes(">Invitations<"), false);
	assert.equal(none.includes("invitations waiting"), false);

	const two = renderToStaticMarkup(
		createElement(
			ui.TeamBridgePageView,
			viewProps({
				conversations: [
					conversation(),
					conversation({ id: "bcv_2", name: "ops" }),
				],
			}),
		),
	);
	assert.equal(two.includes(">Invitations<"), true);
	assert.equal(
		two.includes('aria-label="2 invitations waiting for you"'),
		true,
	);
});

const invitation = (patch = {}) => ({
	key: "tnt_1|bcv_1",
	conversationId: "bcv_1",
	tenantId: "tnt_1",
	conversationKind: "channel",
	conversationName: "launch-room",
	agentName: "Robo Damian",
	inviter: { role: "created", name: "Ada", self: false },
	...patch,
});

const renderView = (patch = {}) =>
	renderToStaticMarkup(
		createElement(ui.TeamBridgeInvitationsView, {
			invitations: [],
			listState: "ready",
			onAnswer: () => {},
			...patch,
		}),
	);

test("the view states the consent, the row, and each outcome honestly", () => {
	const empty = renderView();
	assert.equal(
		empty.includes("No invitations are waiting for your agent."),
		true,
	);
	// The consent statement renders, and points at no control the app lacks.
	assert.equal(empty.includes(CONSENT_V1), true);
	assert.equal(CONSENT_V1.includes("All"), false);
	assert.equal(CONSENT_V1.includes("muted"), false);
	assert.equal(CONSENT_V1.includes("read and post"), true);

	const one = renderView({ invitations: [invitation()] });
	assert.equal(one.includes("launch-room"), true);
	assert.equal(
		one.includes("Robo Damian was invited to this conversation"),
		true,
	);
	assert.equal(one.includes("Conversation created by Ada"), true);
	assert.equal(one.includes(">Accept<"), true);
	assert.equal(one.includes(">Decline<"), true);

	const accepting = renderView({
		invitations: [invitation()],
		rowStates: {
			"tnt_1|bcv_1": { phase: "pending", decision: "accept" },
		},
	});
	assert.equal(accepting.includes("Accepting…"), true);
	assert.equal(accepting.includes('aria-busy="true"'), true);
	// Both labels share one cell (fixed width), and in flight the buttons are
	// inert but keep their own face: aria-disabled, never the disabled face.
	assert.equal(accepting.includes(">Accept<"), true);
	assert.equal(accepting.includes('aria-disabled="true"'), true);
	assert.equal(accepting.includes('disabled=""'), false);
	const readOnly = renderView({ invitations: [invitation()], readOnly: true });
	assert.equal(readOnly.includes('disabled=""'), true);
	assert.equal(readOnly.includes("invitations can’t be answered here"), true);

	const done = renderView({
		invitations: [invitation()],
		rowStates: { "tnt_1|bcv_1": { phase: "done", decision: "accept" } },
	});
	assert.equal(
		done.includes(
			"Accepted. Robo Damian is woken only when someone @-mentions it.",
		),
		true,
	);
	const declined = renderView({
		invitations: [invitation()],
		rowStates: { "tnt_1|bcv_1": { phase: "done", decision: "decline" } },
	});
	// Neutral: true even if the agent had already joined from another device.
	assert.equal(declined.includes("Declined for Robo Damian."), true);
	assert.equal(declined.includes("not added"), false);
	assert.equal(done.includes(">Accept<"), false);

	const loadFailed = renderView({ listState: "error" });
	assert.equal(loadFailed.includes("Invitations could not be loaded."), true);
});

test("each coded refusal has its own sentence; retry only where it can help", () => {
	const kind = (status, code) =>
		ui.invitationFailureKind(Object.assign(new Error("x"), { status, code }));
	assert.equal(kind(403, "agent_not_permitted"), "agent_unavailable");
	assert.equal(kind(409, "invalid_transition"), "already_answered");
	const ruled = (rule) =>
		ui.invitationFailureKind(
			Object.assign(new Error("x"), {
				status: 409,
				code: "invalid_transition",
				detail: { code: "invalid_transition", details: { rule } },
			}),
		);
	assert.equal(ruled("not_invited"), "already_answered");
	assert.equal(ruled("builtin"), "gone");
	assert.equal(kind(404, "member_not_found"), "gone");
	assert.equal(kind(404, "conversation_not_found"), "gone");
	assert.equal(kind(409, "consent_version_unknown"), "outdated");
	assert.equal(kind(403, "bridge_not_available"), "not_available");
	assert.equal(kind(401, "bridge_signin_required"), "sign_in");
	assert.equal(kind(null, undefined), "unreachable");
	// R2: a coded status-null failure (a deadline) may have been applied.
	assert.equal(kind(null, "deadline_exceeded"), "unconfirmed");
	assert.equal(kind(null, "desktop_foreground_required"), "unconfirmed");
	// R7: a runtime without the owner guard needs an update, not a retry.
	assert.equal(
		ui.invitationFailureKind(
			Object.assign(new Error("Team Bridge runtime owner guard unavailable"), {
				code: "team_bridge_owner_guard_unavailable",
			}),
		),
		"outdated",
	);
	assert.equal(kind(500, "store_failure"), "unconfirmed");
	assert.equal(ui.invitationFailureKind(new Error("plain")), "unconfirmed");

	const kinds = [
		"agent_unavailable",
		"already_answered",
		"gone",
		"outdated",
		"not_available",
		"sign_in",
		"unreachable",
		"unconfirmed",
	];
	const sentences = kinds.map((k) => ui.invitationFailureCopy(k));
	assert.equal(new Set(sentences).size, kinds.length);
	assert.equal(
		sentences.every((s) => typeof s === "string" && s.length > 0),
		true,
	);
	assert.equal(ui.invitationRetryable("agent_unavailable"), true);
	assert.equal(ui.invitationRetryable("unreachable"), true);
	assert.equal(ui.invitationRetryable("already_answered"), false);
	assert.equal(ui.invitationRetryable("outdated"), false);

	const refused = renderView({
		invitations: [invitation()],
		rowStates: { "tnt_1|bcv_1": { phase: "failed", kind: "already_answered" } },
	});
	assert.equal(
		refused.includes("This invitation was already answered elsewhere."),
		true,
	);
	assert.equal(refused.includes(">Accept<"), false);
	// D2: the failure sentence lives IN the action slot (one min-h-8 row), so a
	// refusal neither grows the card nor leaves an empty band under it.
	const slot = (html) => html.split('class="flex min-h-8')[1] ?? "";
	assert.equal(slot(refused).includes("already answered elsewhere"), true);
	const retryable = renderView({
		invitations: [invitation()],
		rowStates: {
			"tnt_1|bcv_1": { phase: "failed", kind: "agent_unavailable" },
		},
	});
	const retrySlot = slot(retryable);
	assert.equal(retrySlot.includes(">Accept<"), true);
	assert.equal(retrySlot.includes("Your agent can’t join from here"), true);
});

test("the consent text is pinned to the participation version it is consent to", () => {
	/*
	 * R1. Editing this English text without minting a new participation
	 * version (and key) is exactly what this test must catch: the hub records
	 * an accept as consent to `bridge_agent_participation_v1`.
	 */
	assert.equal(
		ui.TEAM_BRIDGE_AGENT_PARTICIPATION_VERSION,
		"bridge_agent_participation_v1",
	);
	assert.equal(
		ui.TEAM_BRIDGE_AGENT_PARTICIPATION_CONSENT_KEY,
		"ui.teamBridge.invitations.consent.bridge_agent_participation_v1",
	);
	const en = JSON.parse(
		readFileSync(`${ROOT}/src/i18n/catalogues/en/ui.teamBridge.json`, "utf8"),
	);
	assert.equal(en[ui.TEAM_BRIDGE_AGENT_PARTICIPATION_CONSENT_KEY], CONSENT_V1);
	assert.equal("ui.teamBridge.invitations.consent" in en, false);
});

test("the rail entry holds still while the pointer is over the rail", () => {
	// N1: appearing or leaving would move the list under a pending click.
	assert.equal(ui.railInvitationsEntryShown(false, true, true), false);
	assert.equal(ui.railInvitationsEntryShown(true, false, true), true);
	assert.equal(ui.railInvitationsEntryShown(false, true, false), true);
	assert.equal(ui.railInvitationsEntryShown(true, false, false), false);
});

test("an answered row keeps its place; new rows append; foreign removals drop", () => {
	const a = invitation({ key: "a" });
	const b = invitation({ key: "b" });
	const c = invitation({ key: "c" });
	const keys = (rows) => rows.map((row) => row.key).join(",");
	// `a` was answered here and left the pending set: it stays first.
	assert.equal(
		keys(ui.stableInvitationRows([a, b], [b], new Set(["a"]))),
		"a,b",
	);
	// `b` left without being answered here (another device): it drops.
	assert.equal(keys(ui.stableInvitationRows([a, b], [a], new Set())), "a");
	// A new invitation appends, never reorders what is shown.
	assert.equal(
		keys(ui.stableInvitationRows([a, b], [c, b], new Set(["a"]))),
		"a,b,c",
	);
});

test("the answer is sent as the owner, patched optimistically, and rolled back exactly", async () => {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const row = conversation({ notify: "mute", muted: true });
	const sibling = conversation({ id: "bcv_2", name: "ops" });
	const page = { conversations: [row, sibling], has_more: true };
	const orgKey = ui.teamBridgeKeys.conversations("tnt_1", SELF);
	const allKey = ui.teamBridgeKeys.conversations("all", SELF);
	client.setQueryData(["radient-user", "user"], { account: { id: SELF } });
	client.setQueryData(ui.teamBridgeKeys.statusFor(SELF), {
		account_id: SELF,
		state: "ready",
		local: { enabled: true },
		read_only: false,
	});
	client.setQueryData(orgKey, structuredClone(page));
	client.setQueryData(allKey, structuredClone(page));
	client.invalidateQueries = async () => {};

	// The real transport, with the IPC bridge recorded rather than mocked away.
	const requests = [];
	globalThis.window = {
		api: {
			desktop: {
				request: async (request) => {
					requests.push(request);
					if (request.op === "capabilities")
						return {
							ok: true,
							status: 200,
							body: {
								result: {
									features: { team_bridge_conversation_owner_guard: 1 },
								},
							},
						};
					return { ok: true, status: 200, body: { result: row } };
				},
			},
		},
	};

	const options = ui.invitationAnswerMutationOptions(client);
	const variables = {
		conversationId: "bcv_1",
		tenantId: "tnt_1",
		decision: "accept",
	};
	const context = await options.onMutate(variables);
	const selfAgent = (key) =>
		client
			.getQueryData(key)
			.conversations[0].members.find(
				(member) => member.kind === "agent" && member.account_id === SELF,
			);
	assert.equal(selfAgent(orgKey).state, "active");
	assert.equal(selfAgent(allKey).state, "active");
	// Accepting must NOT unmute: the conversation and member registers are untouched.
	assert.equal(client.getQueryData(orgKey).conversations[0].notify, "mute");
	assert.equal(client.getQueryData(orgKey).conversations[0].muted, true);
	assert.equal(selfAgent(orgKey).notify, undefined);
	assert.equal(client.getQueryData(orgKey).has_more, true);
	// Only the answered row leaves the pending set; its sibling still waits.
	assert.equal(
		ui
			.pendingAgentInvitations(client.getQueryData(orgKey).conversations, SELF)
			.map((invitation) => invitation.conversationId)
			.join(","),
		"bcv_2",
	);

	options.onError(new Error("refused"), variables, context);
	assert.deepEqual(client.getQueryData(orgKey), page);
	assert.deepEqual(client.getQueryData(allKey), page);
	assert.equal(context, undefined);

	const answered = await options.mutationFn(variables);
	assert.equal(answered.id, "bcv_1");
	const consent = requests.find(
		(request) => request.op === "team_bridge.conversations.consent",
	);
	assert.equal(Boolean(consent), true);
	assert.equal(consent.account_id, SELF);
	assert.equal(consent.expected_account_id, SELF);
	assert.equal(consent.tenant_id, "tnt_1");
	assert.equal(consent.conversation_id, "bcv_1");
	assert.equal(consent.decision, "accept");
	assert.equal(consent.consent_version, "bridge_agent_participation_v1");
	assert.equal("notify" in consent, false);

	const declined = ui.withAgentInvitationAnswer(
		page,
		{ conversationId: "bcv_1", tenantId: "tnt_1" },
		SELF,
		"decline",
	);
	assert.equal(
		declined.conversations[0].members.find((m) => m.kind === "agent").state,
		"removed",
	);
	// Another org's same id is a different conversation.
	const otherOrg = ui.withAgentInvitationAnswer(
		page,
		{ conversationId: "bcv_1", tenantId: "tnt_other" },
		SELF,
		"accept",
	);
	assert.deepEqual(otherOrg, page);
	client.clear();
	globalThis.window = undefined;
});

test("a runtime without the owner guard answers outdated, through the real transport (R7)", async () => {
	globalThis.window = {
		api: {
			desktop: {
				request: async () => ({
					ok: true,
					status: 200,
					body: { result: { features: {} } },
				}),
			},
		},
	};
	const error = await ui.TeamBridgeApi.answerAgentInvitation({
		conversationId: "bcv_1",
		accountId: SELF,
		tenantId: "tnt_1",
		decision: "accept",
		consentVersion: "bridge_agent_participation_v1",
	}).catch((caught) => caught);
	assert.equal(error instanceof Error, true);
	assert.equal(ui.invitationFailureKind(error), "outdated");
	assert.equal(ui.invitationRetryable(ui.invitationFailureKind(error)), false);
	globalThis.window = undefined;
});

test("two interleaved refusals both roll back to invited (R3)", async () => {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const a = conversation({ id: "bcv_a" });
	const b = conversation({ id: "bcv_b" });
	const page = { conversations: [a, b], has_more: false };
	const orgKey = ui.teamBridgeKeys.conversations("tnt_1", SELF);
	const allKey = ui.teamBridgeKeys.conversations("all", SELF);
	client.setQueryData(["radient-user", "user"], { account: { id: SELF } });
	client.setQueryData(ui.teamBridgeKeys.statusFor(SELF), {
		account_id: SELF,
		state: "ready",
		local: { enabled: true },
		read_only: false,
	});
	client.setQueryData(orgKey, structuredClone(page));
	client.setQueryData(allKey, structuredClone(page));
	client.invalidateQueries = async () => {};
	const options = ui.invitationAnswerMutationOptions(client);
	const answerA = {
		conversationId: "bcv_a",
		tenantId: "tnt_1",
		decision: "accept",
	};
	const answerB = {
		conversationId: "bcv_b",
		tenantId: "tnt_1",
		decision: "decline",
	};
	const pending = (key) =>
		ui
			.pendingAgentInvitations(client.getQueryData(key).conversations, SELF)
			.map((row) => row.conversationId)
			.join(",");

	// Start A, start B, then A is refused, then B is refused: the order that
	// left A "joined" under whole-page snapshot restores.
	const ctxA = await options.onMutate(answerA);
	const ctxB = await options.onMutate(answerB);
	assert.equal(pending(orgKey), "");
	options.onError(new Error("agent_not_permitted"), answerA, ctxA);
	assert.equal(pending(orgKey), "bcv_a");
	options.onError(new Error("agent_not_permitted"), answerB, ctxB);
	assert.equal(pending(orgKey), "bcv_a,bcv_b");
	assert.equal(pending(allKey), "bcv_a,bcv_b");
	assert.deepEqual(client.getQueryData(orgKey), page);

	// Reverse order, and one success between: only the refused row reverts.
	await options.onMutate(answerA);
	const ctxB2 = await options.onMutate(answerB);
	options.onError(new Error("refused"), answerB, ctxB2);
	assert.equal(pending(orgKey), "bcv_b");
	const stateOf = (id) =>
		client
			.getQueryData(orgKey)
			.conversations.find((row) => row.id === id)
			.members.find((m) => m.kind === "agent" && m.account_id === SELF).state;
	assert.equal(stateOf("bcv_a"), "active");
	assert.equal(stateOf("bcv_b"), "invited");
	client.clear();
});
