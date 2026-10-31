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
 * A FIRST MESSAGE FINISHES POSTING AFTER THE READER LEAVES (QA Q1 on #1531).
 *
 * The operator's requirement: a message appears at once "and then that's reconciled
 * on the server side once available seamlessly". A send into an EXISTING
 * conversation already finishes in the background. A FIRST message did not: the
 * conversation was created, but the post was refused because the page that started
 * it was no longer mounted. Coming back showed a failed row with Retry.
 *
 * The fence that DOES stay: an account switch or sign-out between the create and
 * the post must still stop the post. That is a security fence (the message would be
 * written as, or into, the wrong account), not a presentation one.
 *
 * These run the REAL container (hooks, React Query, the shipped QueryClient, the
 * pending-send store) with only the preload transport replaced. They are jsdom
 * proofs of the page's behaviour, not a real-stack run.
 */

const BODY = "first words, sent on the way out";
const sends = (app) =>
	app.fixture.calls.filter((call) => call.op === "team_bridge.messages.send");
const button = (host, predicate, label) => {
	const found = [...host.querySelectorAll("button")].find(predicate);
	assert.ok(found, `button not found: ${label}`);
	return found;
};
const click = (node) => act(async () => node.click());
const personRow = (host, name) =>
	button(
		host,
		(b) => b.getAttribute("aria-label") === `Message ${name}`,
		`${name}'s row`,
	);
/* An option reads "<avatar initial><name>"; match the name, not a prefix of another. */
const names = (node, name) => {
	const text = node.textContent.trim();
	return text === name || text.slice(1) === name;
};

/* Pick recipients in the To: field the way a reader does: focus, then the option. */
async function addRecipient(host, name) {
	const field = host.querySelector('input[role="combobox"], input');
	assert.ok(field, "the To: field");
	await act(async () => field.focus());
	await until(
		() =>
			[...host.querySelectorAll('[role="option"]')].some((o) => names(o, name)),
		`${name} offered`,
	);
	await click(
		[...host.querySelectorAll('[role="option"]')].find((o) => names(o, name)),
	);
}

async function startAndLeave(app, openDraft) {
	/* Lanes and pending rows are module state that outlives a page by design; each
	   case is a fresh process, or a lane resolved by the case before it would turn
	   this first send into a send into an existing conversation. */
	ui.resetPendingSendsForTest();
	app.fixture.refuse = false;
	app.fixture.created = [];
	await openDraft();
	await until(() => app.host.querySelector("textarea"), "the composer");
	const create = deferred();
	app.fixture.createGate = create;
	await type(app.host, BODY);
	await send(app.host);
	await until(
		() => app.host.querySelector('[data-delivery="pending"]'),
		"the optimistic row at the press",
	);
	await app.leave();
	assert.equal(
		app.host.querySelector("textarea"),
		null,
		"Team Bridge is gone from the screen",
	);
	return create;
}

async function assertLandedOnce(app, openConversation) {
	await until(() => sends(app).length >= 1, "the post goes out");
	/* Let anything queued behind it run, so a second post would be seen. */
	await until(
		() =>
			ui.usePendingSends
				.getState()
				.entries.every((row) => row.status !== "pending"),
		"the send settles",
	);
	assert.equal(sends(app).length, 1, "exactly one post");
	assert.equal(sends(app)[0].conversation_id, app.fixture.created[0].id);
	assert.equal(sends(app)[0].body, BODY);
	const [row] = ui.usePendingSends.getState().entries;
	assert.equal(row.status, "sent", "the background send settled as sent");
	assert.equal(
		row.serverId,
		"msg_acct_a",
		"bound to the stored message the post answered with",
	);

	await app.back();
	await openConversation();
	await until(
		() => app.host.textContent.includes(BODY),
		"the message is in its conversation",
	);
	assert.equal(
		app.host.querySelector('[data-delivery="failed"]'),
		null,
		"no failed row",
	);
	assert.ok(
		![...app.host.querySelectorAll("button")].some(
			(b) => b.textContent.trim() === "Retry",
		),
		"no Retry",
	);
	const drawn = [...app.host.querySelectorAll("[data-row-key]")].filter((li) =>
		li.textContent.includes(BODY),
	);
	assert.equal(drawn.length, 1, "one row for one message");
	assert.equal(sends(app).length, 1, "returning posts nothing more");
}

test("a first message to a person posts once after the reader leaves mid-create", async () => {
	const app = await mount({ empty: true });
	try {
		const create = await startAndLeave(app, () =>
			click(personRow(app.host, "Peer")),
		);
		assert.equal(sends(app).length, 0, "nothing posted before the create");
		await act(async () => create.resolve());
		assert.equal(app.fixture.created[0].kind, "dm");
		await assertLandedOnce(app, async () => {
			await until(
				() =>
					[...app.host.querySelectorAll("button")].some(
						(b) => b.getAttribute("aria-label") === "Message Peer",
					),
				"the rail is back",
			);
			await click(personRow(app.host, "Peer"));
		});
	} finally {
		await app.close();
	}
});

test("a first message to a group posts once after the reader leaves mid-create", async () => {
	const app = await mount({ empty: true });
	try {
		const create = await startAndLeave(app, async () => {
			await click(
				button(
					app.host,
					(b) => b.getAttribute("aria-label") === "New message",
					"New message",
				),
			);
			await addRecipient(app.host, "Peer");
			await addRecipient(app.host, "Other peer");
		});
		await act(async () => create.resolve());
		assert.equal(app.fixture.created[0].kind, "group");
		await assertLandedOnce(app, async () => {
			const id = app.fixture.created[0].id;
			await until(
				() => app.host.querySelector(`[data-conversation-id="${id}"]`),
				"the new group is in the rail",
			);
			await click(app.host.querySelector(`[data-conversation-id="${id}"]`));
		});
	} finally {
		await app.close();
	}
});

/*
 * THE FENCE THAT STAYS. The create was authorised under account A; if B is signed
 * in by the time it answers, the post must not go out at all, and the unsent row
 * is the revocation's to clear (nothing of A's is left for B to see or retry).
 */
test("an account switch while the create is in flight posts nothing", async () => {
	const app = await mount({ empty: true });
	try {
		const create = await startAndLeave(app, () =>
			click(personRow(app.host, "Peer")),
		);
		await app.changeAuth("acct_b");
		await until(
			() => ui.usePendingSends.getState().entries.length === 0,
			"the revocation cleared the unsent row",
		);
		await act(async () => create.resolve());
		/* Give a post every chance to go out before asserting none did. */
		for (let i = 0; i < 10; i++)
			await act(async () => new Promise((r) => setTimeout(r, 10)));
		assert.equal(sends(app).length, 0, "zero posts across the switch");
		assert.equal(
			ui.usePendingSends.getState().entries.length,
			0,
			"no row survives the switch",
		);
	} finally {
		await app.close();
	}
});
