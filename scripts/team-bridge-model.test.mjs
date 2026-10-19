import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/**
 * The conversation model's render decisions, executed through esbuild so the
 * test runs the SAME TypeScript the renderer bundles — the house pattern for a
 * renderer helper (there is no separate unit runner in this repo).
 */
const bundle = await build({
	stdin: {
		contents: `export * from "./src/renderer/src/features/team-bridge/team-bridge-model";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	write: false,
});
const model = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const member = (label, kind, state, accountId = `acct_${label}`) => ({
	account_id: accountId,
	kind,
	display_label: label,
	role: "member",
	state,
});

const conversation = (patch = {}) => ({
	id: "bcv_1",
	tenant_id: "tnt_1",
	kind: "dm",
	name: "",
	visibility: "private",
	agent_capable: false,
	status: "open",
	created_by: "acct_a",
	last_message_at: "2026-10-18T10:00:00Z",
	latest_seq: 2,
	members: [
		member("Ada", "human", "active", "acct_a"),
		member("Bea", "human", "active", "acct_b"),
	],
	last_read_seq: 0,
	unread_count: 2,
	muted: false,
	...patch,
});

const message = (seq, patch = {}) => ({
	id: `bcmsg_${seq}`,
	conversation_id: "bcv_1",
	seq,
	sender: { account_id: "acct_b", kind: "human", display_label: "Bea" },
	body: `message ${seq}`,
	origin: "human",
	created_at: "2026-10-18T10:00:00Z",
	...patch,
});

test("a DM is named for the other person, not for the reader", () => {
	assert.equal(model.conversationTitle(conversation(), "acct_a"), "Bea");
	assert.equal(model.conversationTitle(conversation(), "acct_b"), "Ada");
});

test("an agent DM is named for the agent's own label", () => {
	const dm = conversation({
		agent_capable: true,
		members: [
			member("Ada", "human", "active", "acct_a"),
			member("Ada's agent", "agent", "active", "acct_a"),
		],
	});
	assert.equal(model.conversationTitle(dm, "acct_a"), "Ada's agent");
});

test("a channel's own name wins over its members", () => {
	assert.equal(
		model.conversationTitle(
			conversation({ kind: "channel", name: "launch" }),
			"acct_a",
		),
		"launch",
	);
});

test("an unnamed group caps its member list", () => {
	const members = Array.from({ length: 5 }, (_, index) =>
		member(`Member ${index}`, "human", "active", `acct_${index}`),
	);
	assert.equal(
		model.conversationTitle(conversation({ kind: "group", members }), "acct_a"),
		"Member 0, Member 1 +3",
	);
});

test("no members means no title", () => {
	assert.equal(
		model.conversationTitle(conversation({ members: [] }), "acct_a"),
		null,
	);
});

test("the sidebar total counts only unmuted conversations", () => {
	assert.equal(
		model.badgeTotal({
			total: 0,
			conversations: [
				{ muted: false, unread_count: 4 },
				{ muted: true, unread_count: 9 },
			],
		}),
		4,
	);
});

test("the server total is used when it is present", () => {
	assert.equal(
		model.badgeTotal({
			total: 7,
			conversations: [{ muted: false, unread_count: 9 }],
		}),
		7,
	);
});

test("an invited agent is not counted as an agent participant", () => {
	const base = conversation({ agent_capable: true });
	assert.equal(model.hasAgentParticipant(base), false);
	assert.equal(
		model.hasAgentParticipant({
			...base,
			members: [...base.members, member("Agent", "agent", "active")],
		}),
		true,
	);
});

test("members order: people, then agents, then invited", () => {
	const ordered = model.orderedMembers(
		conversation({
			agent_capable: true,
			members: [
				member("Invited", "human", "invited"),
				member("Agent", "agent", "active"),
				member("Ada", "human", "active", "acct_a"),
			],
		}),
	);
	assert.deepEqual(
		ordered.map((entry) => entry.display_label),
		["Ada", "Agent", "Invited"],
	);
});

test("messages render oldest first even when the page arrives reversed", () => {
	assert.deepEqual(
		model
			.chronological([message(3), message(1), message(2)])
			.map((entry) => entry.seq),
		[1, 2, 3],
	);
});

test("a purged history keeps its seq gaps", () => {
	assert.deepEqual(
		model.chronological([message(9), message(2)]).map((entry) => entry.seq),
		[2, 9],
	);
});

test("conversation kinds map to the sidebar glyph family", () => {
	assert.equal(
		model.conversationGlyph(conversation({ kind: "channel" })),
		"hash",
	);
	assert.equal(
		model.conversationGlyph(conversation({ kind: "group" })),
		"users",
	);
	assert.equal(model.conversationGlyph(conversation({ kind: "dm" })), "at");
});

test("notifications are quiet while the window is visible", () => {
	assert.equal(model.shouldNotify("visible"), false);
	assert.equal(model.shouldNotify("hidden"), true);
});

test("only an explicit discoverable non-member is a preview", () => {
	assert.equal(
		model.isPreviewConversation(
			conversation({ discoverable: true, member: false }),
		),
		true,
	);
	assert.equal(
		model.isPreviewConversation(
			conversation({ discoverable: true, member: true }),
		),
		false,
	);
	// A server older than the discoverable slice sends neither field. Absence
	// must not turn every row into a preview and suppress its history.
	assert.equal(model.isPreviewConversation(conversation()), false);
	assert.equal(
		model.isPreviewConversation(conversation({ discoverable: true })),
		false,
	);
});

test("the notification register falls back to the legacy muted flag", () => {
	assert.equal(
		model.notificationPreference(conversation({ notify: "mention" })),
		"mention",
	);
	assert.equal(
		model.notificationPreference(
			conversation({ notify: "mute", muted: false }),
		),
		"mute",
	);
	assert.equal(
		model.notificationPreference(conversation({ muted: true })),
		"mute",
	);
	assert.equal(
		model.notificationPreference(conversation({ muted: false })),
		"all",
	);
});

test("the row's quiet bell follows notify, not only the old flag", () => {
	assert.equal(
		model.showsMutedGlyph(conversation({ notify: "mute", muted: false })),
		true,
	);
	// The newer value is authoritative: a row whose notify says mentions is not
	// muted even if a page raced and carries the old flag.
	assert.equal(
		model.showsMutedGlyph(conversation({ notify: "mention", muted: true })),
		false,
	);
	assert.equal(model.showsMutedGlyph(conversation({ muted: true })), true);
});

test("the immediate mute toggle returns to all, not the previous level", () => {
	assert.equal(model.toggledMuteNotify("mute"), "all");
	assert.equal(model.toggledMuteNotify("all"), "mute");
	assert.equal(model.toggledMuteNotify("mention"), "mute");
});

test("the optimistic patch moves notify and muted together, on one row", () => {
	const page = {
		conversations: [
			conversation({ id: "bcv_1" }),
			conversation({ id: "bcv_2", muted: false }),
		],
		has_more: true,
		next_before: "cursor_1",
	};
	const patched = model.withNotificationPreference(page, "bcv_2", "mute");
	assert.deepEqual(
		patched.conversations.map((row) => [row.id, row.notify, row.muted]),
		[
			["bcv_1", undefined, false],
			["bcv_2", "mute", true],
		],
	);
	// Paging fields survive the optimistic write: dropping them would strand
	// the rail's next page while the menu's request is in flight.
	assert.equal(patched.has_more, true);
	assert.equal(patched.next_before, "cursor_1");
	// Unmute is the same patch with the loudest register, not a deletion.
	assert.equal(
		model.withNotificationPreference(patched, "bcv_2", "all").conversations[1]
			.muted,
		false,
	);
});

test("the preference menu lists loud, mentions, mute in that order", () => {
	assert.deepEqual(
		model.TEAM_BRIDGE_NOTIFY_OPTIONS.map((option) => [
			option.value,
			option.labelKey,
		]),
		[
			["all", "ui.teamBridge.notify.all"],
			["mention", "ui.teamBridge.notify.mention"],
			["mute", "ui.teamBridge.notify.mute"],
		],
	);
	// Radix hands the group a bare string; an unknown value is loud, never
	// silently silent.
	assert.equal(model.asTeamBridgeNotify("mention"), "mention");
	assert.equal(model.asTeamBridgeNotify("mute"), "mute");
	assert.equal(model.asTeamBridgeNotify("nonsense"), "all");
});

test("a preview header counts member_count when it has no member rows", () => {
	assert.equal(
		model.conversationMemberCount(
			conversation({ member_count: 24, members: [] }),
		),
		24,
	);
	assert.equal(
		model.conversationMemberCount(
			conversation({
				members: [
					member("Ada", "human", "active"),
					member("Bea", "human", "active"),
					member("Cy", "human", "invited"),
				],
			}),
		),
		2,
	);
});
