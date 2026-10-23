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

// The page's catalogue strings, as plain functions.
const chiefCopy = {
	named: (agent, person) => `${agent} (${person})`,
	unnamed: (person) => `${person}'s chief of staff`,
};

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
		// Current memberships include invitations; this is not an active-access count.
		3,
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
	const chief = chiefCopy;
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

test('the legacy stored label "Member" is a placeholder, never a name', () => {
	const people = [
		{
			account_id: "acct_ben",
			display_label: "Ben Tran",
			role: "admin",
			bridge_enabled: true,
			bridge_state: "active",
		},
	];
	const chief = chiefCopy;
	// A directory hit names the sender even when the stored label is legacy.
	assert.equal(
		model.participantLabel(
			{ account_id: "acct_ben", kind: "human", display_label: "Member" },
			people,
			chief,
		),
		"Ben Tran",
	);
	// No directory hit: the legacy label is ABSENT, so nothing resolves and the
	// caller paints its "Unknown person" / "Unknown agent" placeholder.
	for (const kind of ["human", "agent"]) {
		assert.equal(
			model.participantLabel(
				{ account_id: "acct_gone", kind, display_label: "Member" },
				people,
				chief,
			),
			null,
		);
	}
	// Exactly the server's fallback: a real name that merely contains it, or a
	// different case, is somebody's chosen label and is kept.
	assert.equal(
		model.participantLabel(
			{ account_id: "acct_gone", kind: "human", display_label: "member" },
			people,
			chief,
		),
		"member",
	);
	assert.equal(
		model.participantLabel(
			{ account_id: "acct_gone", kind: "human", display_label: "  " },
			people,
			chief,
		),
		null,
	);
});

test("the reader's own messages resolve from the signed-in identity", () => {
	const chief = chiefCopy;
	const self = { accountId: "acct_self", name: "Damian Tran" };
	// The directory does not list the reader: the identity still names them.
	assert.equal(
		model.participantLabel(
			{ account_id: "acct_self", kind: "human", display_label: "Member" },
			[],
			chief,
			self,
		),
		"Damian Tran",
	);
	// The reader's AGENT is not the reader: identity names humans only.
	assert.equal(
		model.participantLabel(
			{ account_id: "acct_self", kind: "agent", display_label: "Member" },
			[],
			chief,
			self,
		),
		null,
	);
	// Somebody else's legacy label never borrows the reader's name.
	assert.equal(
		model.participantLabel(
			{ account_id: "acct_other", kind: "human", display_label: "Member" },
			[],
			chief,
			self,
		),
		null,
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

test("chiefs of staff include the reader’s distinct agent and exclude disabled agents", () => {
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
			["acct_self", "Aida", false],
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

test("a one-recipient draft resolves to the existing DM; a group draft never does", () => {
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
	const ben = { kind: "human", accountId: "acct_ben", label: "Ben" };
	const sana = { kind: "human", accountId: "acct_sana", label: "Sana" };
	assert.equal(
		model.targetConversation(
			{ type: "compose", recipients: [ben] },
			[dm],
			"acct_self",
		)?.id,
		"bcv_dm",
	);
	assert.equal(
		model.targetConversation(
			{ type: "compose", recipients: [ben, sana] },
			[dm],
			"acct_self",
		),
		null,
	);
	assert.equal(
		model.targetConversation(
			{ type: "compose", recipients: [sana] },
			[dm],
			"acct_self",
		),
		null,
	);
});

// ---------------------------------------------------------------------------
// Review round 1 (R1-1, R1-5, R1-8): the DM-placement decisions, directly.
// ---------------------------------------------------------------------------

const human = (id, label = id) => ({
	account_id: id,
	kind: "human",
	display_label: label,
	role: "member",
	state: "active",
});
const agentOf = (id, label = "Aida") => ({
	account_id: id,
	kind: "agent",
	display_label: label,
	role: "member",
	state: "active",
});
const convo = (id, kind, members, patch = {}) => ({
	id,
	tenant_id: "t",
	kind,
	visibility: "private",
	agent_capable: true,
	status: "open",
	created_by: "acct_self",
	last_message_at: "2026-10-21T00:00:00Z",
	latest_seq: 1,
	last_read_seq: 0,
	unread_count: 0,
	muted: false,
	members,
	...patch,
});
const person = (id, agent) => ({
	account_id: id,
	display_label: id,
	role: "member",
	bridge_enabled: true,
	bridge_state: "active",
	...(agent ? { agent } : {}),
});

test("R1-1: a DM with someone who left the org is listed, and the reader's own row claims nothing", () => {
	const self = human("acct_self");
	const withBen = convo("bcv_ben", "dm", [self, human("acct_ben")], {
		last_message_at: "2026-10-20T00:00:00Z",
	});
	const withGone = convo("bcv_gone", "dm", [self, human("acct_gone")], {
		last_message_at: "2026-10-21T00:00:00Z",
	});
	const people = [person("acct_self"), person("acct_ben")];
	// The newest DM (with someone no longer in the directory) is the one the
	// self row would have swallowed: it must be returned as unmatched.
	assert.deepEqual(
		model
			.unmatchedDirects([withBen, withGone], people, [], "acct_self")
			.map((row) => row.id),
		["bcv_gone"],
	);
});

test("R1-1: agent DMs are painted by the chief's row; an owner without a chief leaves them listed", () => {
	const self = human("acct_self");
	const aidaDm = convo("bcv_aida", "dm", [self, agentOf("acct_ben")]);
	const people = [
		person("acct_self"),
		person("acct_ben", { endpoint_id: "e", name: "Aida", state: "active" }),
	];
	const chiefs = model.chiefsOfStaff(people, "acct_self");
	assert.deepEqual(
		model.unmatchedDirects([aidaDm], people, chiefs, "acct_self"),
		[],
	);
	// Ben unenrolled his agent: no chief row, so the history stays reachable.
	assert.deepEqual(
		model
			.unmatchedDirects(
				[aidaDm],
				[person("acct_self"), person("acct_ben")],
				[],
				"acct_self",
			)
			.map((row) => row.id),
		["bcv_aida"],
	);
});

test("R1-5: an agent-to-agent DM never resolves from a chief's row", () => {
	const agentToAgent = convo("bcv_aa", "dm", [
		agentOf("acct_self"),
		agentOf("acct_ben"),
	]);
	const mine = convo("bcv_mine", "dm", [
		human("acct_self"),
		agentOf("acct_ben"),
	]);
	assert.equal(
		model.dmWithAgent([agentToAgent], "acct_ben", "acct_self"),
		null,
	);
	assert.equal(
		model.dmWithAgent([agentToAgent, mine], "acct_ben", "acct_self")?.id,
		"bcv_mine",
	);
	assert.equal(
		model.targetConversation(
			{ type: "chief", accountId: "acct_ben" },
			[agentToAgent],
			"acct_self",
		),
		null,
	);
});

test("railSections: built-ins lead in fixed order; groups and DMs keep the caller's order", () => {
	const rows = [
		convo("c_ops", "channel", []),
		convo("g_1", "group", []),
		convo("c_agents", "channel", [], { builtin: "agents" }),
		convo("d_1", "dm", []),
		convo("c_humans", "channel", [], { builtin: "humans" }),
		convo("c_future", "channel", [], { builtin: "unknown_future" }),
		convo("g_2", "group", []),
	];
	const sections = model.railSections(rows);
	assert.deepEqual(
		sections.channels.map((row) => row.id),
		["c_humans", "c_agents", "c_ops", "c_future"],
	);
	assert.deepEqual(
		sections.groups.map((row) => row.id),
		["g_1", "g_2"],
	);
	assert.deepEqual(
		sections.directs.map((row) => row.id),
		["d_1"],
	);
});

test("recipientCandidates offers the reader’s chief, not their human or bridge-off people", () => {
	const people = [
		person("acct_self", { endpoint_id: "e0", name: "Aida", state: "active" }),
		person("acct_ben", { endpoint_id: "e1", name: "Aida", state: "active" }),
		{ ...person("acct_off"), bridge_enabled: false, bridge_state: "disabled" },
	];
	const out = model.recipientCandidates(people, "acct_self", chiefCopy);
	assert.deepEqual(
		out.map((row) => `${row.kind}:${row.accountId}:${row.label}`),
		[
			"human:acct_ben:acct_ben",
			"agent:acct_self:Aida (acct_self)",
			"agent:acct_ben:Aida (acct_ben)",
		],
	);
	assert.equal(out[1].endpointId, "e0");
	assert.equal(out[2].endpointId, "e1");
});

// ---------------------------------------------------------------------------
// R1-2 / R1-8: the first send's two writes, and what a retry does.
// ---------------------------------------------------------------------------

const firstSendRig = ({ failPostTimes = 0, createId = "bcv_new" } = {}) => {
	const calls = { create: 0, post: [] };
	let failures = failPostTimes;
	return {
		calls,
		remembered: new Map(),
		create: async () => {
			calls.create += 1;
			return { id: `${createId}_${calls.create}`, tenant_id: "tnt_1" };
		},
		post: async (id, message) => {
			calls.post.push({ id, ...message });
			if (failures > 0) {
				failures -= 1;
				throw new Error("post failed");
			}
			return {};
		},
	};
};
const groupInput = {
	kind: "group",
	visibility: "private",
	agentCapable: false,
	members: [
		{ account_id: "acct_ben", kind: "human", display_label: "Ben" },
		{ account_id: "acct_sana", kind: "human", display_label: "Sana" },
	],
};

test("R1-2: a retried group send after a failed post creates ONE group and reuses the client_ref", async () => {
	const rig = firstSendRig({ failPostTimes: 1 });
	const args = {
		draftKey: "tnt_1|group|acct_ben,acct_sana",
		input: groupInput,
		body: "hello",
		clientRef: "ref-1",
		tenantId: "tnt_1",
		remembered: rig.remembered,
		create: rig.create,
		post: rig.post,
	};
	await assert.rejects(model.sendFirstMessage(args));
	assert.equal(rig.calls.create, 1);
	const done = await model.sendFirstMessage(args);
	assert.equal(rig.calls.create, 1, "the retry must not create a second group");
	assert.equal(done.id, "bcv_new_1");
	assert.deepEqual(
		rig.calls.post.map((call) => [call.id, call.clientRef, call.tenantId]),
		[
			["bcv_new_1", "ref-1", "tnt_1"],
			["bcv_new_1", "ref-1", "tnt_1"],
		],
	);
	assert.equal(rig.remembered.size, 0, "success forgets the draft");
});

test("a failed create remembers nothing, so the retry creates", async () => {
	const remembered = new Map();
	let creates = 0;
	const args = {
		draftKey: "k",
		input: groupInput,
		body: "b",
		clientRef: "r",
		tenantId: "tnt_1",
		remembered,
		create: async () => {
			creates += 1;
			if (creates === 1) throw new Error("create failed");
			return { id: "bcv_ok" };
		},
		post: async () => ({}),
	};
	await assert.rejects(model.sendFirstMessage(args));
	assert.equal(remembered.size, 0);
	assert.equal((await model.sendFirstMessage(args)).id, "bcv_ok");
	assert.equal(creates, 2);
});

test("a create response without an id is a failure, not a post to nowhere", async () => {
	let posted = false;
	await assert.rejects(
		model.sendFirstMessage({
			draftKey: "k",
			input: groupInput,
			body: "b",
			clientRef: "r",
			tenantId: undefined,
			remembered: new Map(),
			create: async () => ({}),
			post: async () => {
				posted = true;
			},
		}),
	);
	assert.equal(posted, false);
});

test("different drafts never share a remembered conversation", async () => {
	const rig = firstSendRig({ failPostTimes: 1 });
	const base = {
		input: groupInput,
		body: "b",
		clientRef: "r",
		tenantId: "tnt_1",
		remembered: rig.remembered,
		create: rig.create,
		post: rig.post,
	};
	await assert.rejects(model.sendFirstMessage({ ...base, draftKey: "A" }));
	await model.sendFirstMessage({ ...base, draftKey: "B" });
	assert.equal(rig.calls.create, 2);
	assert.equal(rig.remembered.has("A"), true);
});

// Production regression: document member_count is absent; wire member rows are
// enough to state current membership, without granting invitees active access.
test("one active owner and three invited agents count as four current members", () => {
	const members = [
		member("Damian", "human", "active", "acct_self"),
		...["Ben", "Sana", "Sherman"].map((name) =>
			member(name, "agent", "invited"),
		),
		member("Former", "human", "left"),
		member("Removed", "agent", "removed"),
	];
	assert.equal(
		model.conversationMemberCount(conversation({ kind: "channel", members })),
		4,
	);
	assert.deepEqual(model.conversationMembershipCounts({ members }), {
		active: 1,
		invited: 3,
	});
	// A populated participant list is authoritative even if aggregate metadata is stale.
	assert.equal(
		model.conversationMemberCount(conversation({ members, member_count: 99 })),
		4,
	);
	assert.equal(
		model.conversationMemberCount(
			conversation({ members: [], member_count: undefined }),
		),
		0,
	);
});

test("self chief remains offerable with named, empty, or server owner-fallback names", () => {
	for (const name of ["Aida", "", "Damian"]) {
		const self = {
			...person("acct_self", { endpoint_id: "ep_self", name, state: "active" }),
			display_label: "Damian",
		};
		const candidates = model.recipientCandidates(
			[self],
			"acct_self",
			chiefCopy,
		);
		assert.equal(model.personRowState(self, "acct_self"), "self");
		assert.equal(candidates.length, 1);
		assert.equal(candidates[0].kind, "agent");
		assert.equal(candidates[0].endpointId, "ep_self");
		// Integrated #1334 uses one shared composition rule: absent/owner-name
		// fallback describes a chief of staff rather than repeating the human.
		assert.equal(
			candidates[0].label,
			name === "Aida" ? "Aida (Damian)" : "Damian's chief of staff",
		);
		const human = { kind: "human", accountId: "acct_self", label: "Damian" };
		assert.notEqual(
			model.recipientKey(candidates[0]),
			model.recipientKey(human),
		);
		assert.equal(model.recipientKey(candidates[0]), "agent:acct_self");
		assert.deepEqual(model.recipientMemberInput(candidates[0]), {
			account_id: "acct_self",
			kind: "agent",
			endpoint_id: "ep_self",
			// Store a name, never the localized composed picker label (#1334).
			display_label: name === "Aida" ? "Aida" : "Damian",
		});
		// Adding the agent does not add a human recipient; the server owns creator membership.
		const input = model.draftCreateInput(candidates);
		assert.equal(input.members.length, 1);
		assert.equal(input.members[0].kind, "agent");
		assert.equal(input.agentCapable, true);
		assert.equal(input.kind, "dm");
		assert.deepEqual(
			model.draftCreateInput([human, candidates[0]]).members.map((m) => m.kind),
			["human", "agent"],
		);
	}
});

// ---------------------------------------------------------------------------
// Chief-of-staff label: "Ben Tran (Ben Tran)" (operator report, 2026-10-22).
// ---------------------------------------------------------------------------

const ben = (agent) => ({
	account_id: "acct_ben",
	display_label: "Ben Tran",
	role: "member",
	bridge_enabled: true,
	bridge_state: "active",
	...(agent ? { agent } : {}),
});

test("composeChiefLabel names the agent with the person as context, never the person twice", () => {
	assert.equal(
		model.composeChiefLabel("Aida", "Ben Tran", chiefCopy),
		"Aida (Ben Tran)",
	);
	// The server defaulted the agent's name to its owner's: that is no name.
	assert.equal(
		model.composeChiefLabel("Ben Tran", "Ben Tran", chiefCopy),
		"Ben Tran's chief of staff",
	);
	assert.equal(
		model.composeChiefLabel("  ben   tran ", "Ben Tran", chiefCopy),
		"Ben Tran's chief of staff",
	);
	assert.equal(
		model.composeChiefLabel("", "Ben Tran", chiefCopy),
		"Ben Tran's chief of staff",
	);
	assert.equal(
		model.composeChiefLabel("   ", "Ben Tran", chiefCopy),
		"Ben Tran's chief of staff",
	);
});

test("the rail's recipient label for an unnamed chief never repeats the person", () => {
	const out = model.recipientCandidates(
		[ben({ endpoint_id: "e1", name: "Ben Tran", state: "active" })],
		"acct_self",
		chiefCopy,
	);
	assert.equal(
		out.find((row) => row.kind === "agent").label,
		"Ben Tran's chief of staff",
	);
});

test("recipientMemberInput never sends a duplicated agent label to the server", () => {
	const sent = model.recipientMemberInput({
		kind: "agent",
		accountId: "acct_ben",
		endpointId: "e1",
		label: "Ben Tran (Ben Tran)",
	});
	assert.equal(sent.display_label, "Ben Tran");
	assert.equal(
		model.recipientMemberInput({
			kind: "agent",
			accountId: "acct_ben",
			endpointId: "e1",
			label: "Aida (Ben Tran)",
		}).display_label,
		"Aida (Ben Tran)",
	);
});

test("participantLabel reads existing bad rows: 'X (X)' and the person's own name are absent", () => {
	const agent = (display_label) => ({
		account_id: "acct_ben",
		kind: "agent",
		display_label,
	});
	// Directory names the agent: it wins over a bad stored row.
	const named = [ben({ endpoint_id: "e1", name: "Aida", state: "active" })];
	for (const stored of ["Ben Tran (Ben Tran)", "Ben Tran", "Member"]) {
		assert.equal(
			model.participantLabel(agent(stored), named, chiefCopy),
			"Aida (Ben Tran)",
		);
	}
	// Directory agent name is the person's own: no name known.
	const echoed = [
		ben({ endpoint_id: "e1", name: "Ben Tran", state: "active" }),
	];
	for (const stored of ["Ben Tran (Ben Tran)", "Ben Tran", "Member"]) {
		assert.equal(
			model.participantLabel(agent(stored), echoed, chiefCopy),
			"Ben Tran's chief of staff",
		);
	}
	// No agent in the directory but the person is listed.
	assert.equal(
		model.participantLabel(agent("Ben Tran (Ben Tran)"), [ben()], chiefCopy),
		"Ben Tran's chief of staff",
	);
	// A stored "Aida (Ben Tran)" is not composed a second time.
	assert.equal(
		model.participantLabel(agent("Aida (Ben Tran)"), [ben()], chiefCopy),
		"Aida (Ben Tran)",
	);
	// Person not in the directory: the stored agent name stands; a doubled one is absent.
	assert.equal(model.participantLabel(agent("Aida"), [], chiefCopy), "Aida");
	assert.equal(
		model.participantLabel(agent("Ben Tran (Ben Tran)"), [], chiefCopy),
		null,
	);
});

test("a DM title with a doubled stored agent label is not the doubled label", () => {
	const dm = conversation({
		agent_capable: true,
		members: [
			member("Ada", "human", "active", "acct_a"),
			member("Ben Tran (Ben Tran)", "agent", "active", "acct_ben"),
		],
	});
	assert.equal(model.conversationTitle(dm, "acct_a"), null);
});

// ---------------------------------------------------------------------------
// Optimistic send.
// ---------------------------------------------------------------------------

const pend = (clientRef, body, patch = {}) => ({
	clientRef,
	body,
	createdAt: `2026-10-22T10:00:0${patch.n ?? 0}.000Z`,
	tenantId: "tnt_1",
	conversationId: "bcv_1",
	draftKey: null,
	baselineSeq: 2,
	status: "sending",
	...patch,
});
const mine = (seq, body, patch = {}) =>
	message(seq, {
		id: `bcmsg_${seq}`,
		body,
		sender: { account_id: "acct_self", kind: "human", display_label: "Me" },
		...patch,
	});
const selfId = { accountId: "acct_self", label: "Me" };

test("a pending send is drawn at once, after every confirmed message, keyed by client_ref", () => {
	const out = model.threadWithPending(
		[message(1), message(2)],
		[pend("ref-1", "hi")],
		selfId,
	);
	assert.deepEqual(
		out.map((m) => m.id),
		["bcmsg_1", "bcmsg_2", "pending:ref-1"],
	);
	assert.equal(out[2].body, "hi");
	assert.equal(
		model.pendingMark(out[2], [pend("ref-1", "hi")]).clientRef,
		"ref-1",
	);
	assert.equal(model.pendingMark(out[0], [pend("ref-1", "hi")]), null);
});

test("pending survives 'no conversation id yet': a new thread draws it from the draft key", () => {
	const entry = pend("ref-n", "first", {
		conversationId: null,
		draftKey: "tnt|dm|human:acct_ben",
		baselineSeq: -1,
	});
	assert.equal(
		model.pendingForThread([entry], null, "tnt|dm|human:acct_ben").length,
		1,
	);
	assert.equal(
		model.pendingForThread([entry], null, "tnt|dm|human:acct_other").length,
		0,
	);
	assert.equal(model.threadWithPending([], [entry], selfId).length, 1);
	// It adopts the created conversation and stays on screen both ways.
	const adopted = { ...entry, conversationId: "bcv_new" };
	assert.equal(model.pendingForThread([adopted], "bcv_new", null).length, 1);
	assert.equal(
		model.pendingForThread([adopted], null, "tnt|dm|human:acct_ben").length,
		1,
	);
	assert.equal(model.pendingForThread([adopted], "bcv_other", null).length, 0);
});

test("a message arriving from someone else never jumps above the one just typed", () => {
	const out = model.threadWithPending(
		[message(1), message(2), message(3, { id: "bcmsg_3" })],
		[pend("ref-1", "typed")],
		selfId,
	);
	assert.equal(out.at(-1).id, "pending:ref-1");
	assert.deepEqual(
		model.chronological(out).map((m) => m.id),
		["bcmsg_1", "bcmsg_2", "bcmsg_3", "pending:ref-1"],
	);
});

test("pending entries keep the order they were typed in", () => {
	const out = model.threadWithPending(
		[],
		[pend("b", "second", { n: 2 }), pend("a", "first", { n: 1 })],
		selfId,
	);
	assert.deepEqual(
		out.map((m) => m.body),
		["first", "second"],
	);
	assert.deepEqual(
		model.chronological(out).map((m) => m.body),
		["first", "second"],
	);
});

test("confirm REPLACES the pending entry: the POST's id in the list claims it, never both", () => {
	const entry = pend("ref-1", "hi", { status: "sent", confirmedId: "bcmsg_9" });
	const out = model.threadWithPending(
		[message(1), mine(9, "hi")],
		[entry],
		selfId,
	);
	assert.deepEqual(
		out.map((m) => m.id),
		["bcmsg_1", "bcmsg_9"],
	);
});

test("the race: the server's copy arrives (refetch/feed) BEFORE the POST resolves, and is not duplicated", () => {
	const entry = pend("ref-1", "hi"); // still "sending", no confirmedId yet
	const out = model.threadWithPending(
		[message(1), message(2), mine(3, "hi")],
		[entry],
		selfId,
	);
	assert.deepEqual(
		out.map((m) => m.id),
		["bcmsg_1", "bcmsg_2", "bcmsg_3"],
	);
	assert.equal(
		model.openPending(
			[message(1), message(2), mine(3, "hi")],
			[entry],
			"acct_self",
		).length,
		0,
	);
});

test("a copy claims one entry only: the same text sent twice shows two rows", () => {
	const entries = [pend("a", "ok", { n: 1 }), pend("b", "ok", { n: 2 })];
	const one = model.threadWithPending([mine(3, "ok")], entries, selfId);
	assert.deepEqual(
		one.map((m) => m.id),
		["bcmsg_3", "pending:b"],
	);
	const two = model.threadWithPending(
		[mine(3, "ok"), mine(4, "ok")],
		entries,
		selfId,
	);
	assert.deepEqual(
		two.map((m) => m.id),
		["bcmsg_3", "bcmsg_4"],
	);
});

test("an older identical message, or someone else's, does not claim a pending entry", () => {
	const entry = pend("ref-1", "ok", { baselineSeq: 5 });
	const old = model.threadWithPending([mine(4, "ok")], [entry], selfId);
	assert.equal(old.at(-1).id, "pending:ref-1");
	const other = model.threadWithPending(
		[message(6, { body: "ok" })],
		[entry],
		selfId,
	);
	assert.equal(other.at(-1).id, "pending:ref-1");
});

test("a FAILED entry stays drawn (never vanishes) until a copy proves it landed", () => {
	const failed = pend("ref-1", "hi", { status: "failed" });
	const out = model.threadWithPending([message(1)], [failed], selfId);
	assert.equal(out.at(-1).id, "pending:ref-1");
	assert.equal(model.pendingMark(out.at(-1), [failed]).status, "failed");
	// An ambiguous failure whose request landed collapses into its copy.
	const landed = model.threadWithPending(
		[message(1), mine(3, "hi")],
		[failed],
		selfId,
	);
	assert.deepEqual(
		landed.map((m) => m.id),
		["bcmsg_1", "bcmsg_3"],
	);
});

test("postedMessageId reads the id from either response envelope", () => {
	assert.equal(model.postedMessageId({ id: "m1" }), "m1");
	assert.equal(model.postedMessageId({ message: { id: "m2" } }), "m2");
	assert.equal(model.postedMessageId({}), undefined);
	assert.equal(model.postedMessageId(null), undefined);
});

test("sendFirstMessage returns the POST's answer so the pending entry can be reconciled by id", async () => {
	const rig = firstSendRig();
	rig.post = async () => ({ id: "bcmsg_77" });
	const done = await model.sendFirstMessage({
		draftKey: "k",
		input: groupInput,
		body: "hello",
		clientRef: "ref-1",
		tenantId: "tnt_1",
		remembered: rig.remembered,
		create: rig.create,
		post: rig.post,
	});
	assert.equal(model.postedMessageId(done.posted), "bcmsg_77");
});

test("first send then failed post then retry: same client_ref, one create, one message", async () => {
	const rig = firstSendRig({ failPostTimes: 1 });
	const args = {
		draftKey: "k",
		input: groupInput,
		body: "hello",
		clientRef: "ref-1",
		tenantId: "tnt_1",
		remembered: rig.remembered,
		create: rig.create,
		post: rig.post,
	};
	await assert.rejects(model.sendFirstMessage(args));
	// Between the failure and Retry the row is failed, and drawn.
	const failed = pend("ref-1", "hello", {
		conversationId: "bcv_new_1",
		status: "failed",
	});
	assert.equal(model.threadWithPending([], [failed], selfId).length, 1);
	await model.sendFirstMessage(args);
	assert.equal(rig.calls.create, 1);
	assert.deepEqual(
		rig.calls.post.map((c) => c.clientRef),
		["ref-1", "ref-1"],
	);
});

// ---------------------------------------------------------------------------
// performSend: the page container's whole optimistic attempt, executed.
// ---------------------------------------------------------------------------

const sendRig = (over = {}) => {
	const calls = { create: 0, post: [], created: [] };
	return {
		calls,
		args: {
			conversationId: null,
			tenantId: undefined,
			draftKey: "tnt_1|dm|human:acct_ben",
			input: groupInput,
			draftTenantId: "tnt_1",
			body: "hello",
			clientRef: "ref-1",
			remembered: new Map(),
			create: async () => {
				calls.create += 1;
				return { id: "bcv_new", tenant_id: "tnt_1" };
			},
			post: async (id, message) => {
				calls.post.push({ id, ...message });
				return { id: "bcmsg_9" };
			},
			onCreated: (created) => calls.created.push(created),
			...over,
		},
	};
};

test("performSend: the first send creates, adopts the id BEFORE the post, and reports the posted id", async () => {
	const order = [];
	const rig = sendRig({
		post: async (id, message) => {
			order.push("post");
			rig.calls.post.push({ id, ...message });
			return { message: { id: "bcmsg_9" } };
		},
		onCreated: () => order.push("adopt"),
	});
	const out = await model.performSend(rig.args);
	assert.deepEqual(order, ["adopt", "post"]);
	assert.deepEqual(out, {
		ok: true,
		id: "bcv_new",
		tenantId: "tnt_1",
		confirmedId: "bcmsg_9",
	});
});

test("performSend: a failed post is {ok:false}, never a throw; the retry reuses the client_ref and the created conversation", async () => {
	let failing = true;
	const rig = sendRig({
		post: async (id, message) => {
			rig.calls.post.push({ id, ...message });
			if (failing) throw new Error("offline");
			return { id: "bcmsg_9" };
		},
	});
	assert.deepEqual(await model.performSend(rig.args), { ok: false });
	failing = false;
	const retried = await model.performSend(rig.args);
	assert.equal(retried.ok, true);
	assert.equal(rig.calls.create, 1, "the retry must not create again");
	assert.deepEqual(
		rig.calls.post.map((c) => [c.id, c.clientRef]),
		[
			["bcv_new", "ref-1"],
			["bcv_new", "ref-1"],
		],
	);
});

test("performSend: an existing thread posts straight to it, with its tenant, and never creates", async () => {
	const rig = sendRig({
		conversationId: "bcv_1",
		tenantId: "tnt_9",
		draftKey: null,
		input: null,
	});
	const out = await model.performSend(rig.args);
	assert.equal(rig.calls.create, 0);
	assert.deepEqual(rig.calls.post, [
		{ id: "bcv_1", clientRef: "ref-1", body: "hello", tenantId: "tnt_9" },
	]);
	assert.equal(out.ok && out.confirmedId, "bcmsg_9");
});

test("performSend: a failed create is a failed row, and nothing is posted", async () => {
	const rig = sendRig({
		create: async () => {
			throw new Error("403");
		},
	});
	assert.deepEqual(await model.performSend(rig.args), { ok: false });
	assert.equal(rig.calls.post.length, 0);
});

test("performSend: no thread and no draft to create is a failure, not a silent drop", async () => {
	const rig = sendRig({ draftKey: null, input: null });
	assert.deepEqual(await model.performSend(rig.args), { ok: false });
});

// ---------------------------------------------------------------------------
// Review round 1 on #1334: R1-1 (round trip) and R1-3 (overlapping sends).
// ---------------------------------------------------------------------------

test("R1-1: what the create payload STORES reads back as the same single label (compose → store → read)", () => {
	for (const agentName of ["Aida", "Ben Tran", ""]) {
		const people = [
			ben(
				agentName
					? { endpoint_id: "e1", name: agentName, state: "active" }
					: { endpoint_id: "e1", name: "", state: "active" },
			),
		];
		const [, chief] = model.recipientCandidates(people, "acct_self", chiefCopy);
		const shown = chief.label;
		const stored = model.recipientMemberInput(chief).display_label;
		// Never the composed display label, so the read path cannot compose it twice.
		assert.notEqual(stored, "Ben Tran's chief of staff");
		assert.notEqual(stored, "Aida (Ben Tran)");
		const read = model.participantLabel(
			{ account_id: "acct_ben", kind: "agent", display_label: stored },
			people,
			chiefCopy,
		);
		assert.equal(read, shown, `agent name ${JSON.stringify(agentName)}`);
		// With the directory unavailable the stored NAME is all there is: it
		// never reads back as a doubled or composed label.
		const offline = model.participantLabel(
			{ account_id: "acct_ben", kind: "agent", display_label: stored },
			[],
			chiefCopy,
		);
		assert.equal(offline, stored);
	}
	assert.equal(
		model.recipientMemberInput(
			model.recipientCandidates(
				[ben({ endpoint_id: "e1", name: "Aida", state: "active" })],
				"acct_self",
				chiefCopy,
			)[1],
		).display_label,
		"Aida",
	);
});

test("R1-3: two sends while the first create is in flight create ONE conversation", async () => {
	let resolveCreate;
	let creates = 0;
	const posts = [];
	const remembered = new Map();
	const base = {
		draftKey: "k",
		input: groupInput,
		tenantId: "tnt_1",
		remembered,
		create: () => {
			creates += 1;
			return new Promise((resolve) => {
				resolveCreate = () => resolve({ id: "bcv_one", tenant_id: "tnt_1" });
			});
		},
		post: async (id, message) => {
			posts.push([id, message.clientRef]);
			return {};
		},
	};
	const first = model.sendFirstMessage({
		...base,
		body: "a",
		clientRef: "ref-a",
	});
	const second = model.sendFirstMessage({
		...base,
		body: "b",
		clientRef: "ref-b",
	});
	await Promise.resolve();
	resolveCreate();
	await Promise.all([first, second]);
	assert.equal(creates, 1, "one create for one draft");
	assert.deepEqual(
		posts.map((p) => p[0]),
		["bcv_one", "bcv_one"],
	);
	assert.deepEqual(posts.map((p) => p[1]).sort(), ["ref-a", "ref-b"]);
});

test("R1-3: a create that fails for overlapping sends fails both and leaves nothing remembered", async () => {
	const remembered = new Map();
	const base = {
		draftKey: "k",
		input: groupInput,
		tenantId: "tnt_1",
		remembered,
		create: async () => {
			throw new Error("403");
		},
		post: async () => ({}),
	};
	const results = await Promise.allSettled([
		model.sendFirstMessage({ ...base, body: "a", clientRef: "ref-a" }),
		model.sendFirstMessage({ ...base, body: "b", clientRef: "ref-b" }),
	]);
	assert.deepEqual(
		results.map((r) => r.status),
		["rejected", "rejected"],
	);
	assert.equal(remembered.size, 0);
});

test("R2-1: EVERY overlapping send adopts the created conversation, including the one that shared the create", async () => {
	let resolveCreate;
	const adopted = [];
	const remembered = new Map();
	const base = {
		draftKey: "k",
		input: groupInput,
		tenantId: "tnt_1",
		remembered,
		create: () =>
			new Promise((resolve) => {
				resolveCreate = () => resolve({ id: "bcv_one", tenant_id: "tnt_1" });
			}),
		post: async () => ({}),
	};
	const a = model.sendFirstMessage({
		...base,
		body: "a",
		clientRef: "ref-a",
		onCreated: (c) => adopted.push(["ref-a", c.id]),
	});
	const b = model.sendFirstMessage({
		...base,
		body: "b",
		clientRef: "ref-b",
		onCreated: (c) => adopted.push(["ref-b", c.id]),
	});
	await Promise.resolve();
	resolveCreate();
	await Promise.all([a, b]);
	assert.deepEqual(adopted.sort(), [
		["ref-a", "bcv_one"],
		["ref-b", "bcv_one"],
	]);
});

test("R2-1: a retry that reuses the remembered conversation also adopts it", async () => {
	const adopted = [];
	const remembered = new Map([["k", { id: "bcv_old", tenantId: "tnt_1" }]]);
	await model.sendFirstMessage({
		draftKey: "k",
		input: groupInput,
		body: "a",
		clientRef: "ref-a",
		tenantId: "tnt_1",
		remembered,
		create: async () => {
			throw new Error("must not create");
		},
		post: async () => ({}),
		onCreated: (c) => adopted.push(c.id),
	});
	assert.deepEqual(adopted, ["bcv_old"]);
});
