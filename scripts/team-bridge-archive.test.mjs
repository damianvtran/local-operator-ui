import assert from "node:assert/strict";
import { readFileSync, unlinkSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * ARCHIVE -> VIEW ARCHIVED -> PERMANENT DELETE (agent-server radient-ml/agent-server#219),
 * exercised through the SHIPPED modules.
 *
 * THREE KINDS OF CLAIM, each at the cheapest layer that can actually make it:
 *
 *  - MODEL: who is offered which control. Pure functions, asserted directly.
 *  - OPTIONS: the optimistic archive and its rollback, and the delete's
 *    not-optimistic / not-found-is-success rules. These drive the exact options
 *    object each hook hands to `useMutation` (`onMutate` -> `onError`, `mutationFn`)
 *    against a real QueryClient, as `team-bridge-channels.test.mjs` does for notify;
 *    the hooks are one-line wrappers over them.
 *  - RENDER: what the view draws for an archived channel (banner, no composer),
 *    that an archived row stays out of the rail, and that a plain member gets no
 *    buttons. A server render of the real view; the dialogs and menus are Radix
 *    portals that the sibling suites also leave to the real-browser story capture.
 */

/*
 * THE RAIL'S ONE IMPORT FROM THE CHAT SIDEBAR IS ITS SELECTED-ROW ROLE.
 * `team-bridge-rail.tsx` imports `rowCurrent` from `chat-sidebar.tsx` so the
 * selected person/channel paints the one role every sidebar shares (the
 * selection guard in `scripts/chat-sidebar-selection.test.mjs` asserts that).
 * That module drags MUI and the whole chat tree into a node bundle, which
 * cannot load MUI's directory imports; the stub exports the SAME literal, read
 * from the shipped source, so these tests render the real class string without
 * the chat sidebar's dependency weight.
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
const chatSidebarStub = {
	name: "chat-sidebar-stub",
	setup(pluginBuild) {
		pluginBuild.onResolve(
			{ filter: /chat\/components\/chat-sidebar$/ },
			() => ({
				path: "chat-sidebar-stub",
				namespace: "stub",
			}),
		);
		pluginBuild.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
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
			export { TeamBridgeArchivedChannelsView, TeamBridgeArchivedBanner } from "./src/renderer/src/features/team-bridge/team-bridge-archive";
			export { archiveMutationOptions, unarchiveMutationOptions, deleteMutationOptions, teamBridgeKeys } from "./src/renderer/src/features/team-bridge/use-team-bridge";
			export { canArchiveConversation, canManageArchivedConversation, withoutConversation, withConversationStatus } from "./src/renderer/src/features/team-bridge/team-bridge-model";
		`,
		resolveDir: ROOT,
		sourcefile: "team-bridge-archive.mjs",
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
	`./_team-bridge-archive-${process.pid}.mjs`,
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

const conversation = (patch = {}) => ({
	id: "bcv_1",
	tenant_id: "tnt_1",
	kind: "channel",
	name: "release-proof-0.84.1",
	visibility: "tenant",
	agent_capable: false,
	status: "open",
	created_by: "acct_self",
	last_message_at: "2026-10-19T10:00:00Z",
	latest_seq: 2,
	members: [
		{
			account_id: "acct_self",
			kind: "human",
			display_label: "Damian",
			role: "owner",
			state: "active",
		},
	],
	last_read_seq: 0,
	unread_count: 0,
	muted: false,
	can_administer: true,
	...patch,
});

const viewProps = (patch = {}) => ({
	selfAccountId: "acct_self",
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
	onArchive: () => {},
	onUnarchive: () => {},
	onDelete: async () => {},
	...patch,
});

const archivedRow = (patch = {}) =>
	conversation({
		status: "archived",
		archived_at: "2026-10-26T16:10:00Z",
		archived_by: "acct_ada",
		archived_by_label: "Ada Lovelace",
		...patch,
	});

// ---------------------------------------------------------------- model

test("only a channel the server says the caller may administer offers archive", () => {
	assert.equal(ui.canArchiveConversation(conversation()), true);
	assert.equal(
		ui.canArchiveConversation(conversation({ can_administer: false })),
		false,
		"a plain member is offered nothing",
	);
	assert.equal(
		ui.canArchiveConversation(conversation({ can_administer: undefined })),
		false,
		"a server that predates the field offers nothing rather than a button it may refuse",
	);
	assert.equal(
		ui.canArchiveConversation(conversation({ builtin: "humans" })),
		false,
		"#humans and #agents can never be archived",
	);
	for (const kind of ["dm", "group"])
		assert.equal(ui.canArchiveConversation(conversation({ kind })), false);
	assert.equal(
		ui.canArchiveConversation(archivedRow()),
		false,
		"an archived channel is not archived again",
	);
});

test("unarchive and delete are offered only on an ARCHIVED, non-built-in channel the caller administers", () => {
	assert.equal(ui.canManageArchivedConversation(archivedRow()), true);
	assert.equal(
		ui.canManageArchivedConversation(conversation()),
		false,
		"delete is never offered on an open channel",
	);
	assert.equal(
		ui.canManageArchivedConversation(archivedRow({ can_administer: false })),
		false,
	);
	assert.equal(
		ui.canManageArchivedConversation(archivedRow({ builtin: "agents" })),
		false,
	);
});

test("withoutConversation drops one row, keeps paging, and honours the tenant", () => {
	const page = {
		conversations: [
			conversation({ id: "bcv_1" }),
			conversation({ id: "bcv_1", tenant_id: "tnt_2" }),
			conversation({ id: "bcv_2" }),
		],
		has_more: true,
		next_before: "x",
	};
	const out = ui.withoutConversation(page, "bcv_1", "tnt_1");
	assert.deepEqual(
		out.conversations.map((row) => `${row.tenant_id}/${row.id}`),
		["tnt_2/bcv_1", "tnt_1/bcv_2"],
	);
	assert.equal(out.has_more, true);
	assert.equal(out.next_before, "x");
});

// ------------------------------------------------------- optimistic archive

const seededClient = (page) => {
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
		},
	});
	client.setQueryData(["radient-user", "user"], {
		account: { id: "acct_self" },
	});
	client.setQueryData(ui.teamBridgeKeys.statusFor("acct_self"), {
		account_id: "acct_self",
		state: "ready",
		local: { enabled: true },
		read_only: false,
	});
	const keys = {
		org: ui.teamBridgeKeys.conversations("tnt_1", "acct_self"),
		all: ui.teamBridgeKeys.conversations("all", "acct_self"),
		archived: ui.teamBridgeKeys.archivedConversations("tnt_1", "acct_self"),
	};
	client.setQueryData(keys.org, structuredClone(page));
	client.setQueryData(keys.all, structuredClone(page));
	client.setQueryData(keys.archived, { conversations: [] });
	// The claim under test is the snapshot restore, not the settle-time re-read.
	client.invalidateQueries = async () => {};
	return { client, keys };
};

test("archive removes the row from every cached live page at once, and a refusal restores them exactly", async () => {
	const row = conversation({ id: "bcv_2" });
	const sibling = conversation({ id: "bcv_3", name: "keeps" });
	const page = { conversations: [row, sibling], has_more: true };
	const { client, keys } = seededClient(page);
	const options = ui.archiveMutationOptions(client);
	const variables = { conversationId: "bcv_2", tenantId: "tnt_1" };

	const context = await options.onMutate(variables);
	for (const key of [keys.org, keys.all])
		assert.deepEqual(
			client.getQueryData(key).conversations.map((r) => r.id),
			["bcv_3"],
			"the row left the sidebar before the server answered",
		);
	assert.equal(client.getQueryData(keys.org).has_more, true);

	options.onError(new Error("refused"), variables, context);
	assert.deepEqual(client.getQueryData(keys.org), page);
	assert.deepEqual(client.getQueryData(keys.all), page);
	await options.onSettled();
	client.clear();
});

test("archive does not touch another account's cached pages", async () => {
	const page = { conversations: [conversation({ id: "bcv_2" })] };
	const { client } = seededClient(page);
	const foreign = ui.teamBridgeKeys.conversations("tnt_1", "acct_other");
	client.setQueryData(foreign, structuredClone(page));
	const options = ui.archiveMutationOptions(client);
	await options.onMutate({ conversationId: "bcv_2", tenantId: "tnt_1" });
	assert.equal(client.getQueryData(foreign).conversations.length, 1);
	client.clear();
});

test("unarchive flips the row to open in place and a refusal restores it", async () => {
	const row = archivedRow({ id: "bcv_2" });
	const page = { conversations: [row] };
	const { client, keys } = seededClient(page);
	const options = ui.unarchiveMutationOptions(client);
	const variables = { conversationId: "bcv_2", tenantId: "tnt_1" };
	const context = await options.onMutate(variables);
	assert.equal(client.getQueryData(keys.org).conversations[0].status, "open");
	options.onError(new Error("refused"), variables, context);
	assert.deepEqual(client.getQueryData(keys.org), page);
	client.clear();
});

// ------------------------------------------------------------------ delete

test("delete is NOT optimistic and removes the row only after the server confirms", async () => {
	const options = ui.deleteMutationOptions(new QueryClient());
	assert.equal(
		options.onMutate,
		undefined,
		"a permanent delete must not paint early: it cannot be rolled back",
	);
	const row = archivedRow({ id: "bcv_2" });
	const { client, keys } = seededClient({ conversations: [row] });
	client.setQueryData(keys.archived, { conversations: [row] });
	const live = ui.deleteMutationOptions(client);
	assert.deepEqual(
		client.getQueryData(keys.archived).conversations.map((r) => r.id),
		["bcv_2"],
		"still listed until success",
	);
	live.onSuccess({ deleted: true }, { conversationId: "bcv_2", tenantId: "tnt_1" });
	assert.deepEqual(client.getQueryData(keys.archived).conversations, []);
	client.clear();
});

// ------------------------------------------------------------------ render

test("an archived channel opens read-only: banner names who and when, no composer", () => {
	const row = archivedRow();
	const html = renderToStaticMarkup(
		createElement(
			ui.TeamBridgePageView,
			viewProps({
				conversations: [row],
				target: { type: "conversation", id: row.id },
				messageState: "ready",
			}),
		),
	);
	assert.match(html, /archived by Ada Lovelace/);
	assert.match(html, />Unarchive</);
	assert.match(html, />Delete permanently</);
	assert.match(html, /nobody can post/);
	assert.equal(
		html.includes("<textarea"),
		false,
		"an archived channel has no message box",
	);
});

test("a plain member sees the archived banner but no Unarchive or Delete", () => {
	const row = archivedRow({ can_administer: false });
	const html = renderToStaticMarkup(
		createElement(
			ui.TeamBridgePageView,
			viewProps({
				conversations: [row],
				target: { type: "conversation", id: row.id },
				messageState: "ready",
			}),
		),
	);
	assert.match(html, /archived by Ada Lovelace/);
	assert.equal(html.includes(">Unarchive<"), false);
	assert.equal(html.includes("Delete permanently"), false);
});

test("the banner degrades with what the server knows", () => {
	const render = (patch) =>
		renderToStaticMarkup(
			createElement(ui.TeamBridgeArchivedBanner, {
				conversation: archivedRow(patch),
				canManage: false,
				onUnarchive: () => {},
				onDelete: () => {},
			}),
		);
	assert.match(render({}), /archived by Ada Lovelace on /);
	assert.match(
		render({ archived_by_label: undefined }),
		/This channel was archived on /,
	);
	assert.match(
		render({ archived_by_label: undefined, archived_at: undefined }),
		/This channel was archived\./,
	);
});

test("an archived channel never appears in the sidebar, even from a server that still returns it", () => {
	const live = conversation({ id: "bcv_live", name: "launch" });
	const gone = archivedRow({ id: "bcv_gone", name: "old-launch" });
	const html = renderToStaticMarkup(
		createElement(
			ui.TeamBridgePageView,
			viewProps({ conversations: [live, gone] }),
		),
	);
	assert.match(html, /launch/);
	assert.equal(html.includes('data-conversation-id="bcv_gone"'), false);
	assert.match(html, /data-conversation-id="bcv_live"/);
});

test("the channels header offers Archived channels, and a row offers Archive only when permitted", () => {
	const mine = conversation({ id: "bcv_mine", name: "mine" });
	const theirs = conversation({
		id: "bcv_theirs",
		name: "theirs",
		can_administer: false,
	});
	const builtin = conversation({
		id: "bcv_humans",
		name: "humans",
		builtin: "humans",
		can_administer: true,
	});
	const html = renderToStaticMarkup(
		createElement(
			ui.TeamBridgePageView,
			viewProps({
				conversations: [mine, theirs, builtin],
				onOpenArchived: () => {},
			}),
		),
	);
	assert.match(html, /aria-label="Channel options"/);
	const menus = html.match(/aria-label="More actions for [^"]+"/g) ?? [];
	assert.deepEqual(menus, ['aria-label="More actions for mine"']);
});

test("the archived view states loading, error, empty and populated", () => {
	const render = (props) =>
		renderToStaticMarkup(
			createElement(ui.TeamBridgeArchivedChannelsView, {
				conversations: [],
				onOpen: () => {},
				...props,
			}),
		);
	assert.match(render({ state: "loading" }), /Loading archived channels/);
	assert.match(
		render({ state: "error", onRetry: () => {} }),
		/Couldn.t load archived channels[\s\S]*Try again/,
	);
	assert.match(render({ state: "ready" }), /No archived channels\./);
	const populated = render({ state: "ready", conversations: [archivedRow()] });
	assert.match(populated, /release-proof-0\.84\.1/);
	assert.match(populated, /Archived by Ada Lovelace/);
});
