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

test("a late notify refusal only shows under the conversation it belongs to", () => {
	const failure = {
		isError: true,
		variables: { conversationId: "bcv_2" },
	};
	assert.equal(model.notifyFailureIsVisible(failure, "bcv_2"), true);
	// The reader moved to B while A's write was in flight: A's settlement must
	// not re-arm the line under B.
	assert.equal(model.notifyFailureIsVisible(failure, "bcv_3"), false);
	assert.equal(
		model.notifyFailureIsVisible({ isError: false }, "bcv_2"),
		false,
	);
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
				member_count: 3,
				members: [
					member("Ada", "human", "active"),
					member("Bea", "human", "active"),
					member("Cy", "human", "invited"),
				],
			}),
		),
		// member_count counts active + invited; the insider header counts the
		// active rows only (the avatar strip filters the same state).
		2,
	);
});

// ---------------------------------------------------------------------------
// Rail targets, send-first drafts, labels and the Slack-style thread
// (operator review 2026-10-21). Pure decisions, asserted by name.
// ---------------------------------------------------------------------------

const msg = (patch) => ({
	id: `m${patch.seq}`,
	conversation_id: "bcv_1",
	body: "hi",
	origin: "human",
	sender: { account_id: "acct_a", kind: "human", display_label: "A" },
	...patch,
});

test("a thread groups same-sender runs within five minutes and divides days", () => {
	const now = new Date(2026, 9, 21, 12, 0);
	const items = model.threadItems(
		[
			msg({ seq: 4, created_at: new Date(2026, 9, 21, 9, 10).toISOString() }),
			msg({ seq: 1, created_at: new Date(2026, 9, 20, 9, 0).toISOString() }),
			msg({ seq: 2, created_at: new Date(2026, 9, 21, 9, 0).toISOString() }),
			msg({ seq: 3, created_at: new Date(2026, 9, 21, 9, 4).toISOString() }),
			msg({
				seq: 5,
				created_at: new Date(2026, 9, 21, 9, 11).toISOString(),
				sender: { account_id: "acct_a", kind: "agent", display_label: "Aida" },
			}),
		],
		now,
	);
	assert.deepEqual(
		items.map((item) =>
			item.type === "day"
				? `day:${item.relative}`
				: `${item.message.seq}${item.continuation ? "+" : ""}`,
		),
		// Seq order; yesterday, today; 3 continues 2 (4 min); 4 is 6 min after 3
		// so it starts a new run; 5 is the same ACCOUNT but an agent, so a new
		// speaker: a person and their own agent never share a header.
		["day:yesterday", "1", "day:today", "2", "3+", "4", "5"],
	);
});

test("an unparseable time never glues two messages into one run", () => {
	const items = model.threadItems(
		[
			msg({ seq: 1, created_at: "2026-10-21T09:00:00Z" }),
			msg({ seq: 2, created_at: "not a time" }),
		],
		new Date("2026-10-21T12:00:00Z"),
	);
	const second = items.find(
		(item) => item.type === "message" && item.message.seq === 2,
	);
	assert.equal(second.continuation, false);
});

test("a draft's first send makes a DM for one recipient and a group for more", () => {
	assert.equal(model.draftCreateInput([]), null);
	const ben = { kind: "human", accountId: "acct_ben", label: "Ben" };
	const aida = {
		kind: "agent",
		accountId: "acct_ben",
		endpointId: "bep_ben",
		label: "Aida (Ben)",
	};
	assert.deepEqual(model.draftCreateInput([ben]), {
		kind: "dm",
		visibility: "private",
		agentCapable: false,
		members: [{ account_id: "acct_ben", kind: "human", display_label: "Ben" }],
	});
	const dmWithAgent = model.draftCreateInput([aida]);
	assert.equal(dmWithAgent.kind, "dm");
	assert.equal(dmWithAgent.agentCapable, true);
	assert.deepEqual(dmWithAgent.members[0], {
		account_id: "acct_ben",
		kind: "agent",
		endpoint_id: "bep_ben",
		display_label: "Aida (Ben)",
	});
	const group = model.draftCreateInput([ben, aida]);
	assert.equal(group.kind, "group");
	assert.equal(group.agentCapable, true);
	// The wire member carries exactly the strict schema's keys: a stray form
	// field here is what broke every dialog create (`rowId`).
	for (const member of group.members) {
		assert.deepEqual(
			Object.keys(member).sort(),
			member.kind === "agent"
				? ["account_id", "display_label", "endpoint_id", "kind"]
				: ["account_id", "display_label", "kind"],
		);
	}
});

test("a participant is named from the live directory, not the stored label", () => {
	const people = [
		{
			account_id: "acct_ben",
			display_label: "Ben Tran",
			role: "admin",
			bridge_enabled: true,
			bridge_state: "active",
			agent: { endpoint_id: "bep_ben", name: "Aida", state: "active" },
		},
	];
	const chief = (agent, person) => `${agent} (${person})`;
	// The hub stored the creator as the placeholder "Member": the directory wins.
	assert.equal(
		model.participantLabel(
			{ account_id: "acct_ben", kind: "human", display_label: "Member" },
			people,
			chief,
		),
		"Ben Tran",
	);
	assert.equal(
		model.participantLabel(
			{ account_id: "acct_ben", kind: "agent", display_label: "Member" },
			people,
			chief,
		),
		"Aida (Ben Tran)",
	);
	// Someone no longer in the directory keeps the stored label.
	assert.equal(
		model.participantLabel(
			{ account_id: "acct_gone", kind: "human", display_label: "Former" },
			people,
			chief,
		),
		"Former",
	);
});

test("person and agent DMs with the same owner never resolve to each other", () => {
	const base = {
		tenant_id: "t",
		visibility: "private",
		agent_capable: true,
		status: "open",
		created_by: "acct_self",
		last_message_at: "2026-10-21T00:00:00Z",
		latest_seq: 1,
		last_read_seq: 0,
		unread_count: 0,
		muted: false,
	};
	const self = {
		account_id: "acct_self",
		kind: "human",
		display_label: "Me",
		role: "owner",
		state: "active",
	};
	const humanDm = {
		...base,
		id: "bcv_h",
		kind: "dm",
		members: [
			self,
			{
				account_id: "acct_ben",
				kind: "human",
				display_label: "Ben",
				role: "member",
				state: "active",
			},
		],
	};
	const agentDm = {
		...base,
		id: "bcv_a",
		kind: "dm",
		members: [
			self,
			{
				account_id: "acct_ben",
				kind: "agent",
				display_label: "Aida",
				role: "member",
				state: "active",
			},
		],
	};
	assert.equal(
		model.dmWithPerson([agentDm, humanDm], "acct_ben", "acct_self")?.id,
		"bcv_h",
	);
	assert.equal(model.dmWithAgent([humanDm, agentDm], "acct_ben")?.id, "bcv_a");
	assert.equal(model.dmWithPerson([agentDm], "acct_ben", "acct_self"), null);
	assert.equal(model.dmWithAgent([humanDm], "acct_ben"), null);
});

test("chiefs of staff exclude the reader and disabled agents", () => {
	const row = (id, agent) => ({
		account_id: id,
		display_label: id,
		role: "member",
		bridge_enabled: true,
		bridge_state: "active",
		...(agent ? { agent } : {}),
	});
	const chiefs = model.chiefsOfStaff(
		[
			row("acct_self", { endpoint_id: "e0", name: "Aida", state: "active" }),
			row("acct_ben", { endpoint_id: "e1", name: "Aida", state: "active" }),
			row("acct_sana", { endpoint_id: "e2", name: "Juno", state: "paused" }),
			row("acct_off", { endpoint_id: "e3", name: "X", state: "disabled" }),
			row("acct_none"),
		],
		"acct_self",
	);
	assert.deepEqual(
		chiefs.map((chief) => [
			chief.person.account_id,
			chief.agentName,
			chief.paused,
		]),
		[
			["acct_ben", "Aida", false],
			["acct_sana", "Juno", true],
		],
	);
});

test("a person or chief target resolves its DM once it exists, a compose never does", () => {
	const self = {
		account_id: "acct_self",
		kind: "human",
		display_label: "Me",
		role: "owner",
		state: "active",
	};
	const dm = {
		id: "bcv_dm",
		tenant_id: "t",
		kind: "dm",
		visibility: "private",
		agent_capable: false,
		status: "open",
		created_by: "acct_self",
		last_message_at: "2026-10-21T00:00:00Z",
		latest_seq: 1,
		last_read_seq: 0,
		unread_count: 0,
		muted: false,
		members: [
			self,
			{
				account_id: "acct_ben",
				kind: "human",
				display_label: "Ben",
				role: "member",
				state: "active",
			},
		],
	};
	assert.equal(
		model.targetConversation(
			{ type: "person", accountId: "acct_ben" },
			[],
			"acct_self",
		),
		null,
	);
	assert.equal(
		model.targetConversation(
			{ type: "person", accountId: "acct_ben" },
			[dm],
			"acct_self",
		)?.id,
		"bcv_dm",
	);
	assert.equal(
		model.targetConversation(
			{ type: "compose", recipients: [] },
			[dm],
			"acct_self",
		),
		null,
	);
	assert.equal(
		model.targetConversation(
			{ type: "conversation", id: "bcv_dm" },
			[dm],
			"acct_self",
		)?.id,
		"bcv_dm",
	);
});
