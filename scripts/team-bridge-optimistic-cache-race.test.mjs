import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import {
	deferred,
	mount,
	send,
	type,
	ui,
	until,
} from "./fixtures/team-bridge-auth-owner-page.mjs";

/*
 * THE ROW THAT ARRIVES BEFORE THE ANSWER.
 *
 * The optimistic send draws the author's message at the press and is reconciled
 * when its server row exists. The send RESPONSE is the usual door - it carries the
 * stored message - but it is not the only one: anything that writes into the
 * messages query cache (a poll landing mid-flight, another lane reading the thread
 * for a banner) can put the server copy on screen while the POST is still open.
 * Without a match, that instant would draw the message TWICE: once from the page and
 * once from the pending store.
 *
 * THE MATCH CANNOT BE `client_ref`. The hub stores it and never serialises it
 * (agent-server `models/bridge_conversation.go`: `json:"-"`), so no server row
 * carries one, whoever wrote it into the cache. What identifies the row is what the
 * author knows: it is theirs, it is the same body, and its seq is above everything
 * the thread held when they pressed Send. The send response's message id binds the
 * row afterwards.
 *
 * This runs through the REAL page: the shipped container, hooks, keys and the
 * shipped QueryClient, with only the preload transport replaced.
 */
const row = (body, overrides = {}) => ({
	id: "bcv_shared",
	tenant_id: "org_shared",
	kind: "group",
	name: "Shared thread",
	visibility: "private",
	agent_capable: false,
	status: "open",
	created_by: "acct_a",
	last_message_at: "2026-10-23T12:00:00Z",
	latest_seq: 0,
	members: [],
	last_read_seq: 0,
	unread_count: 0,
	muted: false,
	...overrides,
	body,
});

test("a server row written straight into the cache while the send is open replaces the pending row in place", async () => {
	const app = await mount({});
	try {
		/* The hub's copy of the conversation, so the thread is a real one. */
		assert.ok(app.fixture, "the fixture is mounted");
		const post = deferred();
		app.fixture.postGate = post;
		const field = app.host.querySelector("textarea");
		assert.ok(field, "the composer is mounted");
		await type(app.host, "written before the answer");
		await send(app.host);
		await until(
			() => app.host.querySelectorAll("[data-row-key]").length === 1,
			"the optimistic row at the press",
		);
		const [pending] = app.host.querySelectorAll("[data-row-key]");
		assert.equal(pending.getAttribute("data-delivery"), "pending");
		/*
		 * THE OTHER DOOR: the server's row, written into the cache the thread reads,
		 * exactly as a poll or the notification watcher would write it. Same account,
		 * same body, seq 1 - above the empty page the press started from.
		 */
		await act(async () =>
			app.client.setQueryData(
				ui.teamBridgeKeys.messages("bcv_shared", "org_shared", "acct_a"),
				{
					messages: [
						{
							id: "msg_cached",
							conversation_id: "bcv_shared",
							seq: 1,
							sender: {
								account_id: "acct_a",
								kind: "human",
								display_label: "acct_a",
							},
							body: "written before the answer",
							origin: "human",
							created_at: "2026-10-23T12:00:00Z",
						},
					],
					has_more: false,
				},
			),
		);
		const drawn = [...app.host.querySelectorAll("[data-row-key]")];
		assert.equal(
			drawn.length,
			1,
			`one row for one message, saw ${drawn.length}`,
		);
		assert.equal(
			drawn[0],
			pending,
			"the same list item: the server row replaced it rather than remounting it",
		);
		/* The hub takes it, and the optimistic entry settles under the response id. */
		post.resolve();
		await until(
			() => !app.host.querySelector('[data-delivery="pending"]'),
			"the row settles once the send is confirmed",
		);
		assert.equal(
			app.host.querySelectorAll("[data-row-key]").length,
			1,
			"still one row after the answer",
		);
	} finally {
		await app.close();
	}
});
