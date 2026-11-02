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
/* These exercise the OWNED page, not only TeamBridgePageView. Pending sends are
 * module-owned, so their survival alone cannot prove that React retained the
 * visible node through the compose-to-created target transition. */
async function beginOwnedGroup(app) {
	ui.resetPendingSendsForTest();
	app.fixture.refuse = false;
	app.fixture.created = [];
	const create = deferred();
	const post = deferred();
	app.fixture.createGate = create;
	app.fixture.postGate = post;
	await click(
		button(
			app.host,
			(b) => b.getAttribute("aria-label") === "New message",
			"New message",
		),
	);
	await addRecipient(app.host, "Peer");
	await addRecipient(app.host, "Other peer");
	await until(() => app.host.querySelector("textarea"), "group composer");
	await type(app.host, BODY);
	await send(app.host);
	await until(
		() => app.host.querySelector('[data-delivery="pending"]'),
		"pending row before create",
	);
	const row = app.host.querySelector('[data-delivery="pending"]');
	assert.ok(row, "the pending node exists before create");
	return { create, post, row };
}

// Preserve the original assertion alongside teardown errors: a cleanup timeout
// must not turn the diagnostic failure into an unrelated single error.
async function withTrackedOwner(body) {
	const app = await mount({ empty: true });
	let failure;
	try {
		await body(app);
	} catch (error) {
		failure = error;
	}
	try {
		await app.close();
	} catch (cleanupError) {
		if (failure)
			throw new AggregateError(
				[failure, cleanupError],
				"test and fixture cleanup failed",
			);
		throw cleanupError;
	}
	if (failure) throw failure;
}

test("a later fixture refuses to start while an earlier lane is held", async () => {
	await withTrackedOwner(async (app) => {
		const { create, post } = await beginOwnedGroup(app);
		await until(
			() => app.laneAttempts().length === 1,
			"one actual lane registered",
		);
		const attempt = app.laneAttempts()[0];
		const childCount = document.body.childElementCount;
		localStorage.setItem("owner-fixture-control", "preserved");
		await assert.rejects(
			() => mount({ empty: true }),
			/previous fixture still owns a pending lane/,
		);
		assert.equal(
			document.body.childElementCount,
			childCount,
			"refusal creates no second host",
		);
		assert.equal(
			localStorage.getItem("owner-fixture-control"),
			"preserved",
			"refusal precedes storage clearing",
		);
		assert.equal(attempt.state, "pending", "the original job remains tracked");
		await act(async () => create.resolve());
		await until(() => sends(app).length === 1, "the authorized post is held");
		await act(async () => post.resolve());
		await until(() => attempt.state !== "pending", "the original job settles");
	});
});

test("the exact lane remains pending across revocation after an authorized post dispatch", async () => {
	await withTrackedOwner(async (app) => {
		const { create, post } = await beginOwnedGroup(app);
		await until(
			() => app.laneAttempts().length === 1,
			"one actual lane registered",
		);
		const attempt = app.laneAttempts()[0];
		assert.ok(
			attempt.run instanceof Promise,
			"the registered object is the actual promise",
		);
		await act(async () => create.resolve());
		await until(
			() => sends(app).length === 1,
			"authorized post reached its held transport",
		);
		assert.equal(sends(app)[0].owner, "acct_a");
		assert.equal(sends(app)[0].tenant_id, "org_shared");
		assert.equal(sends(app)[0].conversation_id, app.fixture.created[0].id);
		await app.changeAuth("acct_b");
		await until(
			() => app.frames.some((frame) => frame.auth === "acct_b"),
			"B committed",
		);
		await until(
			() =>
				app.client.isMutating() === 0 &&
				ui.usePendingSends.getState().entries.length === 0,
			"revocation clears visible pending state",
		);
		assert.equal(
			app.laneAttempts().length,
			1,
			"the attempt remains registered",
		);
		assert.equal(
			app.laneAttempts()[0].run === attempt.run,
			true,
			"the exact run remains tracked",
		);
		assert.equal(
			attempt.state,
			"pending",
			"store clearing cannot pretend the held run is complete",
		);
		assert.equal(
			app.frames.some(
				(frame) =>
					frame.auth === "acct_b" &&
					(frame.text.includes(BODY) || frame.draft.includes(BODY)),
			),
			false,
		);
		await act(async () => post.resolve());
		await until(
			() => attempt.state !== "pending",
			"the exact run terminates after post release",
		);
		assert.equal(
			app.laneObserverFailed(),
			false,
			"observer errors are never hidden",
		);
		assert.equal(
			sends(app).length,
			1,
			"the already-dispatched post is not duplicated",
		);
	});
});

test("revocation before create completion refuses a new post", async () => {
	await withTrackedOwner(async (app) => {
		const { create } = await beginOwnedGroup(app);
		await until(
			() => app.laneAttempts().length === 1,
			"one actual lane registered",
		);
		const attempt = app.laneAttempts()[0];
		await app.changeAuth("acct_b");
		await until(
			() => app.frames.some((frame) => frame.auth === "acct_b"),
			"B committed",
		);
		assert.equal(attempt.state, "pending", "create is still held");
		await act(async () => create.resolve());
		await until(
			() => attempt.state !== "pending",
			"revoked create continuation terminates",
		);
		assert.equal(app.laneObserverFailed(), false);
		assert.equal(
			sends(app).length,
			0,
			"revoked authority cannot dispatch a new post",
		);
		assert.equal(
			app.frames.some(
				(frame) =>
					frame.auth === "acct_b" &&
					(frame.text.includes(BODY) || frame.draft.includes(BODY)),
			),
			false,
		);
	});
});

test("owned group creation retains the pending node and sends once", async () => {
	await withTrackedOwner(async (app) => {
		await until(
			() =>
				app.frames.some(
					(frame) => frame.auth === "acct_a" && frame.tenant === "org_shared",
				),
			"source account and tenant commit",
		);
		const { create, post, row } = await beginOwnedGroup(app);
		assert.equal(
			row.isConnected,
			true,
			"the pre-create pending node is connected",
		);
		await until(
			() => app.laneAttempts().length === 1,
			"exactly one first-send lane is registered",
		);
		const attempt = app.laneAttempts()[0];
		assert.equal(
			attempt.state,
			"pending",
			"the create is held before transition",
		);
		await act(async () => create.resolve());
		await until(
			() => sends(app).length === 1,
			"the real parsed create path dispatched the held post",
		);
		assert.equal(
			app.fixture.createReceipts.length,
			1,
			"exactly one raw create receipt",
		);
		const receipt = app.fixture.createReceipts[0];
		assert.ok(
			typeof receipt.id === "string" && receipt.id.length > 0,
			"the raw receipt names a destination",
		);
		assert.equal(
			receipt.tenant_id,
			"org_shared",
			"the raw receipt names the source tenant",
		);
		await until(
			() =>
				app.host
					.querySelector('[data-conversation-id][aria-current="page"]')
					?.getAttribute("data-conversation-id") === receipt.id,
			"the created conversation is actually selected",
		);
		assert.equal(
			sends(app)[0].conversation_id,
			receipt.id,
			"the outbound post targets the parsed receipt",
		);
		assert.equal(
			sends(app)[0].tenant_id,
			"org_shared",
			"the outbound post names the source tenant",
		);
		assert.equal(
			sends(app)[0].expected_account_id,
			"acct_a",
			"the outbound owner fence names the source account",
		);
		assert.equal(
			attempt.state,
			"pending",
			"the actual lane is still held at post",
		);
		const afterCreate = app.host.querySelector('[data-delivery="pending"]');
		assert.ok(
			afterCreate?.isConnected,
			"the pending row remains connected after the selected transition",
		);
		// Scalar identity prevents failure diagnostics from serializing the React DOM graph.
		assert.equal(
			afterCreate === row,
			true,
			"the owner handoff retains the pending node",
		);
		await act(async () => post.resolve());
		await until(
			() => attempt.state !== "pending",
			"the exact lane terminates after post release",
		);
		assert.equal(
			app.laneObserverFailed(),
			false,
			"observer errors cannot be hidden",
		);
		assert.equal(sends(app).length, 1, "settlement does not send again");
		assert.equal(
			app.fixture.messages.get(JSON.stringify(["acct_a", "org_shared"]))?.[0]
				?.conversation_id,
			receipt.id,
			"the stored side effect targets the created conversation",
		);
	});
});

test("a foreign-tenant receipt and list never carry the source draft into that destination", async () => {
	const app = await mount({ empty: true });
	try {
		const { create, post } = await beginOwnedGroup(app);
		app.fixture.createReceiptTenant = "org_other";
		app.fixture.createListTenant = "org_other";
		await act(async () => create.resolve());
		await until(
			() => app.fixture.createReceipts.length === 1,
			"the raw receipt is recorded",
		);
		assert.equal(app.fixture.createReceipts[0].tenant_id, "org_other");
		await act(async () => post.resolve());
		await until(
			() =>
				app.client.isMutating() === 0 &&
				ui.usePendingSends
					.getState()
					.entries.every((entry) => entry.status !== "pending"),
			"the controlled attempt settles",
		);
		const foreignId = app.fixture.created[0].id;
		assert.equal(
			app.frames.some(
				(frame) =>
					frame.selectedId === foreignId &&
					(frame.text.includes(BODY) || frame.draft.includes(BODY)),
			),
			false,
			"no committed foreign destination exposes the source draft or row",
		);
		for (const request of sends(app)) {
			assert.equal(request.owner, "acct_a");
			assert.notEqual(
				request.tenant_id,
				"org_other",
				"no post may use the foreign tenant",
			);
		}
	} finally {
		await app.close();
	}
});

test("a late group create does not move the reader away from another target", async () => {
	const app = await mount({ empty: true });
	try {
		const { create, post } = await beginOwnedGroup(app);
		await click(personRow(app.host, "Peer"));
		await until(() => app.host.querySelector("textarea"), "the peer composer");
		const peerField = app.host.querySelector("textarea");
		const peerButton = personRow(app.host, "Peer");
		assert.equal(
			peerButton.getAttribute("aria-current"),
			"page",
			"the peer is selected before the old create answers",
		);
		await act(async () => create.resolve());
		await until(
			() => sends(app).length === 1,
			"the background first post is dispatched",
		);
		assert.equal(
			personRow(app.host, "Peer").getAttribute("aria-current"),
			"page",
			"the peer remains selected",
		);
		assert.equal(sends(app)[0].owner, "acct_a");
		assert.equal(sends(app)[0].tenant_id, "org_shared");
		assert.equal(sends(app)[0].conversation_id, app.fixture.created[0].id);
		assert.equal(
			app.host.querySelector("textarea") === peerField,
			true,
			"the stale group create cannot remount the selected peer",
		);
		await act(async () => post.resolve());
		await until(
			() =>
				ui.usePendingSends
					.getState()
					.entries.every((entry) => entry.status !== "pending"),
			"background post settles",
		);
		assert.equal(sends(app).length, 1, "background completion sends once");
		assert.equal(
			app.fixture.messages.get(JSON.stringify(["acct_a", "org_shared"]))?.[0]
				?.conversation_id,
			app.fixture.created[0].id,
			"the background side effect belongs to the created group",
		);
	} finally {
		await app.close();
	}
});

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
