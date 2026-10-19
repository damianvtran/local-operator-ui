import assert from "node:assert/strict";
import { readFileSync, unlinkSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The discoverable-channel surfaces, exercised through the SHIPPED modules.
 *
 * WHY THIS EXISTS BESIDE THE MODEL TEST. A preview is a rendering decision — the
 * thread must show the join banner and must NOT show a message body even when a
 * cached page still carries one. That half is a server render of the real view.
 *
 * THE MENU'S RUNTIME IS NOT MOUNTED HERE, DELIBERATELY. Radix's portal under
 * jsdom cost 110 s per mount in this harness (measured while writing this file),
 * and the repo's answer for these menus is the source-shape assertions below
 * plus the real-browser story capture (`NotificationMenu`); the primitive owns
 * roving focus, Escape and focus return, so duplicating that in jsdom would
 * test Radix, not this component. What this file CAN pin cheaply is that the
 * shipped menu is wired to the model's option list and toggle rather than to a
 * second copy of the copy.
 *
 * The component bundle is imported from a real temp module (with `packages:
 * "external"`) rather than a data URL, because the components and this test
 * must share ONE React instance. The file is removed on exit, like the sibling
 * suites.
 */

const ROOT = process.cwd();
const bundle = await build({
	stdin: {
		contents: `
			export { TeamBridgePageView, TeamBridgePreviewBanner } from "./src/renderer/src/features/team-bridge/team-bridge-page";
			export { TeamBridgeConversationMenu } from "./src/renderer/src/features/team-bridge/team-bridge-conversation-menu";
		`,
		resolveDir: ROOT,
		sourcefile: "team-bridge-channels.mjs",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	jsx: "automatic",
	loader: { ".css": "empty" },
	alias: {
		"@shared": `${ROOT}/src/renderer/src/shared`,
		"@features": `${ROOT}/src/renderer/src/features`,
	},
	write: false,
});
const modulePath = new URL(
	`./_team-bridge-channels-${process.pid}.mjs`,
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
const ui = await import(modulePath.href);

const selfMember = {
	account_id: "acct_self",
	kind: "human",
	display_label: "Damian",
	role: "owner",
	state: "active",
};

const conversation = (patch = {}) => ({
	id: "bcv_1",
	tenant_id: "tnt_1",
	kind: "channel",
	name: "product-design",
	topic: "Design critiques",
	visibility: "tenant",
	agent_capable: false,
	status: "open",
	created_by: "acct_self",
	last_message_at: "2026-10-19T10:00:00Z",
	latest_seq: 2,
	members: [selfMember],
	last_read_seq: 0,
	unread_count: 0,
	muted: false,
	...patch,
});

const viewProps = (patch = {}) => ({
	selfAccountId: "acct_self",
	conversations: [],
	selected: null,
	messages: [],
	organizations: [
		{ tenantId: "tnt_1", name: "Minerva", role: "owner", unread: 0 },
	],
	scope: "tnt_1",
	totalUnread: 0,
	listState: "ready",
	messageState: "idle",
	onSelect: () => {},
	onSend: () => {},
	onNewConversation: () => {},
	onRetry: () => {},
	onScopeChange: () => {},
	onJoin: () => {},
	onNotifyChange: () => {},
	...patch,
});

const message = (conversationId, body) => ({
	id: "bcmsg_1",
	conversation_id: conversationId,
	seq: 1,
	sender: { account_id: "acct_bea", kind: "human", display_label: "Bea" },
	body,
	origin: "human",
	created_at: "2026-10-19T09:00:00Z",
});

test("a preview shows the join banner and never a message body", () => {
	const preview = conversation({
		discoverable: true,
		member: false,
		member_count: 24,
		members: [],
	});
	const html = renderToStaticMarkup(
		createElement(
			ui.TeamBridgePageView,
			viewProps({
				selected: preview,
				conversations: [preview],
				messages: [message(preview.id, "SECRET PREVIEW BODY")],
				messageState: "ready",
			}),
		),
	);
	assert.match(html, /You’re previewing this channel/);
	assert.match(html, /Join to see its history and get notifications/);
	assert.match(html, />Join</);
	assert.match(html, /24 members/);
	// The cached body and the composer are both wrong on a non-member pane.
	assert.doesNotMatch(html, /SECRET PREVIEW BODY/);
	assert.doesNotMatch(html, /Message this conversation/);
});

test("a refused join is stated above a still-available action", () => {
	const failed = renderToStaticMarkup(
		createElement(ui.TeamBridgePreviewBanner, {
			joinFailed: true,
			onJoin: () => {},
		}),
	);
	assert.match(failed, /You could not join this channel/);
	assert.match(failed, />Join</);

	const busy = renderToStaticMarkup(
		createElement(ui.TeamBridgePreviewBanner, {
			joining: true,
			onJoin: () => {},
		}),
	);
	assert.match(busy, /disabled/);
});

/* ------------------------------------------- the conversation menu (shipped) */

test("the header menu's trigger names the control", () => {
	const html = renderToStaticMarkup(
		createElement(ui.TeamBridgeConversationMenu, {
			conversation: { notify: "all", muted: false },
			onNotifyChange: () => {},
		}),
	);
	assert.match(html, /aria-label="Conversation options"/);
});

test("the menu renders the model's levels and toggle, inside Radix's radio group", () => {
	const source = readFileSync(
		`${ROOT}/src/renderer/src/features/team-bridge/team-bridge-conversation-menu.tsx`,
		"utf8",
	);
	// The three levels come from the model's one ordered list, so the menu and
	// the model test cannot drift into different orderings.
	assert.match(source, /TEAM_BRIDGE_NOTIFY_OPTIONS\.map/);
	assert.match(source, /<DropdownMenuRadioGroup/);
	assert.match(source, /onValueChange=/);
	// The immediate row is the model's toggle, not a second `notify === "mute"`
	// expression that could disagree with it.
	assert.match(source, /toggledMuteNotify\(notify\)/);
	// The checked row is the server's value through the one defaulting helper.
	assert.match(source, /notificationPreference\(conversation\)/);
	// Story/capture seed: the open state is a prop, never a click from the test.
	assert.match(source, /<DropdownMenu defaultOpen=\{defaultOpen\}>/);
});
