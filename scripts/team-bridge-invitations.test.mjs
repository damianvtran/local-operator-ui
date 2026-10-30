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
			export { agentNotifyMutationOptions, invitationAnswerMutationOptions, teamBridgeKeys } from "./src/renderer/src/features/team-bridge/use-team-bridge";
			export { TeamBridgeApi } from "./src/renderer/src/shared/api/local-operator/team-bridge-api";
			export { ownAgentMenuState } from "./src/renderer/src/features/team-bridge/team-bridge-model";
		`,
		resolveDir: ROOT,
		sourcefile: "team-bridge-invitations.mjs",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	/*
	 * ONLY THE PACKAGES THE SUITE ITSELF IMPORTS STAY EXTERNAL. `packages:
	 * "external"` left the whole bare-import graph to node's ESM resolver, and the
	 * shared composer's chain reaches `@mui/material/styles` - a DIRECTORY import,
	 * which Node refuses ("Cannot find module .../styles"). Bundling everything the
	 * suite does not itself import keeps one React (the real identity check) while
	 * letting the app's own dependency graph resolve the way the app's bundler does.
	 */
	external: [
		"@tanstack/react-query",
		"react",
		"react-dom",
		"react-dom/server",
		"react/jsx-runtime",
	],
	jsx: "automatic",
	// Vite's `import.meta.env` is read at IMPORT time by the app's config loader,
	// which the shared composer's chain pulls in (`load-config.ts`): bundling for
	// node leaves it undefined and the module throws before a single assertion runs
	// (`browser-chrome.test.mjs` records the same trap). The URL is dead on purpose.
	define: { "import.meta.env": "__viteEnv" },
	/*
	 * BOTH SHIMS THE APP'S BUNDLER GIVES THE SAME MODULES. `__viteEnv` is Vite's
	 * `import.meta.env`; `require` is what a CJS dependency inside an ESM bundle
	 * needs (the composer's graph keeps one), resolved from THIS file the way the
	 * app resolves it. `agents-composer-mount.test.mjs` states the same recipe.
	 */
	banner: {
		js: 'const __viteEnv = {}; import { createRequire as __loCreateRequire } from "node:module"; const require = __loCreateRequire(import.meta.url);',
	},
	// The page mounts the SHARED composer now, which pulls the brand mark (.png).
	// Bundling it keeps these DOM/state probes on the real component tree; a
	// `dataurl` rather than a file keeps the harness asset-free.
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
		".ttf": "empty",
		".woff": "empty",
		".woff2": "empty",
		".eot": "empty",
	},
	plugins: [chatSidebarStub],
	alias: {
		"@shared": `${ROOT}/src/renderer/src/shared`,
		"@features": `${ROOT}/src/renderer/src/features`,
		// The shared composer imports the brand mark through this alias; it stayed
		// external under `packages: "external"`, so the first suite to bundle the
		// composer is the first to need it resolved.
		"@assets": `${ROOT}/src/renderer/src/assets`,
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
/* The v1 participation statement, verbatim: the record earlier consents agreed to. */
const CONSENT_V1 =
	"Accepting lets your agent read and post in this conversation from now on. It is woken only when someone @-mentions it.";
/* The v2 statement (wake-on-every-message), verbatim. Changing it needs a new version. */
const CONSENT_V2 =
	"Accepting lets your agent read and post in this conversation from now on. It sees every message and decides whether to reply; an @-mention means it should reply. You can change how often it wakes, or mute it, from the conversation’s ⋯ menu.";
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
	// The v2 consent statement renders (v1 no longer does), and points only at
	// controls the app has: the conversation ⋯ menu's "Wake your agent for" levels.
	assert.equal(empty.includes(CONSENT_V2), true);
	assert.equal(empty.includes(CONSENT_V1), false);
	assert.equal(CONSENT_V2.includes("All"), false);
	assert.equal(CONSENT_V2.includes("muted"), false);
	assert.equal(CONSENT_V2.includes("read and post"), true);
	assert.equal(CONSENT_V2.includes("sees every message"), true);

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
	// D9: the working button says "working", not "forbidden".
	assert.equal(accepting.includes("cursor-progress"), true);
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
			"Accepted. Robo Damian now sees every message here and replies when it’s relevant or @-mentioned. Change this from the conversation’s ⋯ menu.",
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

	// A missing name must not inject a capitalized fallback into either outcome.
	const unnamed = invitation({ agentName: null });
	const unnamedLine = renderView({ invitations: [unnamed] });
	// ...but agent_line starts with {agent}, so the fallback opens the sentence.
	assert.equal(
		unnamedLine.includes(">Your agent was invited to this conversation<"),
		true,
	);
	assert.equal(unnamedLine.includes("your agent was invited"), false);
	const unnamedAccepted = renderView({
		invitations: [unnamed],
		rowStates: { "tnt_1|bcv_1": { phase: "done", decision: "accept" } },
	});
	assert.equal(
		unnamedAccepted.includes(
			"Accepted. Your agent now sees every message here and replies when it’s relevant or @-mentioned. Change this from the conversation’s ⋯ menu.",
		),
		true,
	);
	const unnamedDeclined = renderView({
		invitations: [unnamed],
		rowStates: { "tnt_1|bcv_1": { phase: "done", decision: "decline" } },
	});
	assert.equal(unnamedDeclined.includes("Declined for your agent."), true);
	assert.equal(unnamedDeclined.includes("Declined for Your agent."), false);
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
		"runtime_outdated",
	);
	assert.equal(kind(500, "store_failure"), "unconfirmed");
	assert.equal(ui.invitationFailureKind(new Error("plain")), "unconfirmed");

	const kinds = [
		"agent_unavailable",
		"already_answered",
		"gone",
		"outdated",
		"runtime_outdated",
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
	assert.equal(ui.invitationRetryable("runtime_outdated"), false);
	assert.equal(
		ui
			.invitationFailureCopy("runtime_outdated")
			.includes("Update Local Operator"),
		true,
	);
	// M3: the runtime case must not say the app version is too old "any more".
	assert.equal(
		ui.invitationFailureCopy("runtime_outdated").includes("any more"),
		false,
	);

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
	// D8: the failure line truncates instead of wrapping, and the whole reason
	// is one hover/focus away.
	assert.equal(retryable.includes('role="alert"'), true);
	assert.equal(retryable.includes("truncate text-sm text-danger"), true);
	assert.equal(
		retryable.includes(
			`title="${ui.invitationFailureCopy("agent_unavailable")}"`,
		),
		true,
	);
	const retrySlot = slot(retryable);
	assert.equal(retrySlot.includes(">Accept<"), true);
	assert.equal(retrySlot.includes("Your agent can’t join from here"), true);
});

test("the consent text is pinned to the participation version it is consent to", () => {
	/*
	 * R1. Editing this English text without minting a new participation
	 * version (and key) is exactly what this test must catch: the hub records
	 * an accept as consent to the version it names, now
	 * `bridge_agent_participation_v2` (wake-on-every-message). v1's text stays
	 * in the catalogue, unchanged, as the record of what earlier accepts agreed
	 * to: a later edit to it would rewrite history, so it is pinned too.
	 */
	assert.equal(
		ui.TEAM_BRIDGE_AGENT_PARTICIPATION_VERSION,
		"bridge_agent_participation_v2",
	);
	assert.equal(
		ui.TEAM_BRIDGE_AGENT_PARTICIPATION_CONSENT_KEY,
		"ui.teamBridge.invitations.consent.bridge_agent_participation_v2",
	);
	const en = JSON.parse(
		readFileSync(`${ROOT}/src/i18n/catalogues/en/ui.teamBridge.json`, "utf8"),
	);
	assert.equal(en[ui.TEAM_BRIDGE_AGENT_PARTICIPATION_CONSENT_KEY], CONSENT_V2);
	assert.equal(
		en["ui.teamBridge.invitations.consent.bridge_agent_participation_v1"],
		CONSENT_V1,
	);
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
	const invalidations = [];
	client.invalidateQueries = async (filters) => {
		invalidations.push(filters);
	};

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

	// M1: the settle after a REFUSAL re-reads the list, so a row answered
	// elsewhere shows the server's state rather than the rolled-back guess.
	invalidations.length = 0;
	await options.onSettled(
		undefined,
		new Error("agent_not_permitted"),
		variables,
	);
	assert.equal(invalidations.length, 1);
	assert.deepEqual(
		invalidations[0].queryKey,
		ui.teamBridgeKeys.conversationsPrefix,
	);
	assert.equal(typeof invalidations[0].predicate, "function");
	assert.equal(invalidations[0].predicate({ queryKey: [...orgKey] }), true);
	assert.equal(
		invalidations[0].predicate({
			queryKey: ui.teamBridgeKeys.conversations("tnt_1", "acct_other"),
		}),
		false,
	);

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
	assert.equal(consent.consent_version, "bridge_agent_participation_v2");
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
		consentVersion: "bridge_agent_participation_v2",
	}).catch((caught) => caught);
	assert.equal(error instanceof Error, true);
	assert.equal(ui.invitationFailureKind(error), "runtime_outdated");
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

test("the agent's wake level is sent as the owner to agent-notify, patched optimistically, and rolled back", async () => {
	/*
	 * Wake-on-every-message: the owner narrows their OWN agent's level from the
	 * conversation menu. The op names the conversation and level, never an
	 * endpoint (the runtime resolves it), and carries the owner receipt.
	 */
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const row = conversation({
		members: [
			human("acct_ada", "Ada", { role: "owner" }),
			human(SELF, "Damian"),
			agent(SELF, "Robo Damian", "active", { notify: "all" }),
		],
	});
	const page = { conversations: [row], has_more: false };
	const orgKey = ui.teamBridgeKeys.conversations("tnt_1", SELF);
	client.setQueryData(["radient-user", "user"], { account: { id: SELF } });
	client.setQueryData(ui.teamBridgeKeys.statusFor(SELF), {
		account_id: SELF,
		state: "ready",
		local: { enabled: true },
		read_only: false,
	});
	client.setQueryData(orgKey, structuredClone(page));
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
	const options = ui.agentNotifyMutationOptions(client, {
		conversationId: "bcv_1",
		tenantId: "tnt_1",
	});
	const variables = {
		conversationId: "bcv_1",
		tenantId: "tnt_1",
		notify: "mention",
	};
	const context = await options.onMutate(variables);
	const selfAgent = () =>
		client
			.getQueryData(orgKey)
			.conversations[0].members.find(
				(member) => member.kind === "agent" && member.account_id === SELF,
			);
	assert.equal(selfAgent().notify, "mention");
	// The reader's own banner level is a different row and does not move.
	assert.equal(client.getQueryData(orgKey).conversations[0].muted, false);

	await options.mutationFn(variables);
	const write = requests.find(
		(request) => request.op === "team_bridge.conversations.agent_notify",
	);
	assert.deepEqual(write, {
		op: "team_bridge.conversations.agent_notify",
		expected_account_id: SELF,
		tenant_id: "tnt_1",
		conversation_id: "bcv_1",
		notify: "mention",
	});

	options.onError(new Error("refused"), variables, context);
	assert.deepEqual(client.getQueryData(orgKey), page);
	client.clear();
	globalThis.window = undefined;
});

/*
 * R1-1: THE CHECKED ROW MUST SURVIVE A SETTLED WRITE ON HUB-SHAPED DATA.
 *
 * The hub projects `notify` onto the caller's own agent row; the write's answer
 * carries it as well. Seeds below are what the hub serves: the list row and the
 * answer differ only in whether that field is present, so the test proves the
 * cache takes the SERVED value from the answer (not the optimistic guess), keeps
 * the reader's own banner register, and checks nothing when the server names no
 * level.
 */
test("the agent-notify answer's served level is folded into the cache; no served level checks nothing", async () => {
	const listRow = (agentPatch) =>
		conversation({
			notify: "all",
			muted: false,
			members: [
				human(SELF, "Damian"),
				agent(SELF, "Robo Damian", "active", agentPatch),
			],
		});
	const run = async ({ listed, answered, chosen }) => {
		const client = new QueryClient({
			defaultOptions: {
				queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
			},
		});
		const orgKey = ui.teamBridgeKeys.conversations("tnt_1", SELF);
		client.setQueryData(["radient-user", "user"], { account: { id: SELF } });
		client.setQueryData(ui.teamBridgeKeys.statusFor(SELF), {
			account_id: SELF,
			state: "ready",
			local: { enabled: true },
			read_only: false,
		});
		client.setQueryData(orgKey, {
			conversations: [listRow(listed)],
			has_more: false,
		});
		// The settle-time list re-read is a separate claim; the fold is under test.
		client.invalidateQueries = async () => {};
		const options = ui.agentNotifyMutationOptions(client, {
			conversationId: "bcv_1",
			tenantId: "tnt_1",
		});
		const variables = {
			conversationId: "bcv_1",
			tenantId: "tnt_1",
			notify: chosen,
		};
		const context = await options.onMutate(variables);
		// The answer is the AGENT's view: its own `notify`/`muted` are not the reader's.
		const answer = {
			...listRow(answered),
			notify: "mute",
			muted: true,
		};
		options.onSuccess(answer, variables, context);
		await options.onSettled(answer, null, variables, context);
		const cached = client.getQueryData(orgKey).conversations[0];
		client.clear();
		return cached;
	};
	// Served level in the answer: it lands, whatever the optimistic guess was.
	const served = await run({
		listed: { notify: "all" },
		answered: { notify: "mention" },
		chosen: "mute",
	});
	assert.deepEqual(ui.ownAgentMenuState(served, SELF), { notify: "mention" });
	assert.equal(served.notify, "all");
	assert.equal(served.muted, false);
	// A hub row with no level on the agent: menu checks nothing before the write...
	assert.deepEqual(ui.ownAgentMenuState(listRow({}), SELF), { notify: null });
	// ...and an answer with no level leaves the optimistic pick, never invents one.
	const unserved = await run({ listed: {}, answered: {}, chosen: "mention" });
	assert.deepEqual(ui.ownAgentMenuState(unserved, SELF), { notify: "mention" });
});

/*
 * R1-4: writes to ONE conversation are serialised by a scope keyed on owner,
 * tenant and conversation; another conversation gets another queue, and a
 * write naming a conversation other than the one the queue serves is refused
 * before any cache patch.
 */
test("agent-notify writes are serialised per conversation", async () => {
	const client = new QueryClient();
	client.setQueryData(["radient-user", "user"], { account: { id: SELF } });
	const a = ui.agentNotifyMutationOptions(client, {
		conversationId: "bcv_1",
		tenantId: "tnt_1",
	});
	const again = ui.agentNotifyMutationOptions(client, {
		conversationId: "bcv_1",
		tenantId: "tnt_1",
	});
	const b = ui.agentNotifyMutationOptions(client, {
		conversationId: "bcv_2",
		tenantId: "tnt_1",
	});
	assert.equal(typeof a.scope?.id, "string");
	assert.equal(a.scope.id, again.scope.id);
	assert.notEqual(a.scope.id, b.scope.id);
	assert.equal(a.scope.id.includes(SELF), true);
	await assert.rejects(
		a.onMutate({ conversationId: "bcv_2", tenantId: "tnt_1", notify: "mute" }),
		/target changed/,
	);
	/* The query client really queues them: the second does not start until the
	   first settles. */
	let release;
	const order = [];
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const fake = (name, wait) => ({
		scope: a.scope,
		mutationFn: async () => {
			order.push(`${name}:start`);
			await wait;
			order.push(`${name}:end`);
		},
	});
	const cache = client.getMutationCache();
	const first = cache.build(client, fake("A", gate)).execute();
	const second = cache.build(client, fake("B", Promise.resolve())).execute();
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.deepEqual(order, ["A:start"]);
	release();
	await Promise.all([first, second]);
	assert.deepEqual(order, ["A:start", "A:end", "B:start", "B:end"]);
	client.clear();
});
