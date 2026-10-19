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
