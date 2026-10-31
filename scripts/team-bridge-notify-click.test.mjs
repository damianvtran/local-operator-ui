import assert from "node:assert/strict";
import { test } from "node:test";
import { mount, until } from "./fixtures/team-bridge-auth-owner-page.mjs";

/*
 * A NOTIFICATION CLICK LANDS ON ITS MESSAGE (operator report 2026-10-30: the
 * click opened the conversation WITHOUT the announced message, which appeared
 * seconds later). Measured through the REAL page, hooks, keys and shipped
 * QueryClient; only the preload transport is a fixture.
 *
 *  - cached: the watcher wrote the message into the timeline's entry before it
 *    raised the banner, so the click paints it in the first frame, no request;
 *  - missing: the entry is a stale page without it, so the timeline shows its
 *    loading state - never the stale page - reads that key once, and lands.
 */
const PATH =
	"/team-bridge?tenant=org_shared&conversation=bcv_shared&message=bcmsg_target";
const message = (id, seq, body) => ({
	id,
	conversation_id: "bcv_shared",
	seq,
	sender: {
		account_id: "acct_b",
		kind: "human",
		display_label: "acct_b",
	},
	body,
	origin: "human",
	created_at: "2026-10-30T12:00:00Z",
	client_ref: `cref_${id}`,
});
const OLD = message("bcmsg_old", 1, "Stale page body");
const TARGET = message("bcmsg_target", 2, "Announced message body");

/** Seed the timeline entry and record (and answer) every history read. */
const seedWith = (page, history) => {
	const reads = [];
	return {
		reads,
		seed: ({ client, ui }) => {
			client.setQueryData(
				ui.teamBridgeKeys.messages("bcv_shared", "org_shared", "acct_a"),
				{ messages: page, has_more: false },
			);
			const transport = window.api.desktop.request;
			window.api.desktop.request = async (request) => {
				if (request.op !== "team_bridge.messages.list")
					return transport(request);
				reads.push(request.conversation_id);
				return {
					status: 200,
					body: { result: { messages: history, has_more: false } },
				};
			};
		},
	};
};
const targetRow = (host) =>
	host.querySelector('[data-message-id="bcmsg_target"]');

test("a click whose message is cached paints it, highlighted, with no history read", async () => {
	const { seed, reads } = seedWith([TARGET, OLD], [TARGET, OLD]);
	const app = await mount({ path: PATH, seed });
	try {
		await until(() => targetRow(app.host), "target row");
		assert.deepEqual(reads, [], "first frame came from the cache");
		const first = app.frames.findIndex((frame) =>
			frame.text.includes("Announced message body"),
		);
		assert.ok(first >= 0, "the clicked message rendered");
		/*
		 * WHAT THIS PROVES, AND WHY IT IS NOT `frame.slice(first).length > 0`
		 * (agent review round 1, n2): that expression is true for ANY index
		 * the line above accepts, so it asserted nothing. The distinction that
		 * matters is whether the message was in the cache BEFORE the banner
		 * pointed at it: a click whose id the timeline entry does not hold paints
		 * the loading state (the sibling test below pins that shape) and only
		 * then reads. A cached click may never paint it, at any point - so this
		 * assertion fails on the notify-before-write ordering and passes only on
		 * write-then-notify.
		 */
		assert.equal(
			app.frames.some((frame) => frame.text.includes("Loading messages")),
			false,
			"no frame painted the loading state: the message was already cached",
		);
		const row = targetRow(app.host);
		assert.equal(row.dataset.messageTarget, "true");
		assert.match(row.className, /lo-team-bridge-target/);
		// The moment passes: the highlight clears after its fade.
		await until(
			() => targetRow(app.host)?.dataset.messageTarget === undefined,
			"highlight cleared",
		);
	} finally {
		await app.close();
	}
});

test("a click whose message is missing shows loading, never the stale page, then fetches and lands", async () => {
	const { seed, reads } = seedWith([OLD], [TARGET, OLD]);
	const app = await mount({ path: PATH, seed });
	try {
		await until(() => targetRow(app.host), "target row after the read");
		assert.ok(reads.length >= 1, "the missing message was read");
		assert.ok(
			reads.every((id) => id === "bcv_shared"),
			"only the clicked conversation's key",
		);
		const stalePainted = app.frames.some(
			(frame) =>
				frame.text.includes("Stale page body") &&
				!frame.text.includes("Announced message body"),
		);
		assert.equal(stalePainted, false, "the stale page never painted alone");
		assert.equal(targetRow(app.host).dataset.messageTarget, "true");
	} finally {
		await app.close();
	}
});
