import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { build } from "esbuild";

// Pure shipped source: no renderer, native runtime, server or writable bundle.
// Deferred boundaries exercise ownership changes while actual journal promises
// are outstanding rather than a second implementation of the state machine.
const bundle = await build({
	entryPoints: [
		"src/renderer/src/features/team-bridge/team-bridge-send-journal.ts",
	],
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
});
const { TeamBridgeSendJournal, teamBridgeConversationTargetKey } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const A = { accountId: "account-a", tenantId: "tenant-a", epoch: 1 };
const C = { id: "conversation-a", tenant_id: A.tenantId, kind: "group" };
const sender = {
	account_id: A.accountId,
	kind: "human",
	display_label: "Sender",
};
const input = (clientRef, overrides = {}) => ({
	authority: A,
	targetKey: "compose:group",
	clientRef,
	sender,
	body: "same body",
	attachments: [],
	createdAt: "2026-10-28T12:00:00.000Z",
	...overrides,
});
const message = (id, seq, overrides = {}) => ({
	id,
	seq,
	conversation_id: C.id,
	sender,
	body: "same body",
	origin: "human",
	created_at: "2026-10-28T12:00:01.000Z",
	...overrides,
});
const deferred = () => {
	let resolve;
	let reject;
	const promise = new Promise((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
};
async function until(predicate) {
	for (let turn = 0; turn < 100; turn++) {
		if (predicate()) return;
		await setImmediate();
	}
	assert.fail("Journal did not reach the expected state");
}
const rows = (
	journal,
	targetKey = "compose:group",
	conversationId = undefined,
) => journal.rowsFor(A.accountId, A.tenantId, targetKey, conversationId);
const effects = (overrides = {}) => ({
	assertCurrent: () => {},
	create: async () => C,
	post: async (_conversation, row) => ({ id: `server:${row.clientRef}` }),
	...overrides,
});

// Dependency/harness preflight: loading the actual class and observing a
// deliberately failing authority callback must fail closed, not silently skip.
test("rejects missing/wildcard owners, missing epoch and stale enqueue synchronously", () => {
	const journal = new TeamBridgeSendJournal();
	for (const authority of [
		{ ...A, accountId: "" },
		{ ...A, accountId: "*" },
		{ ...A, tenantId: undefined },
		{ ...A, tenantId: "*" },
		{ ...A, epoch: undefined },
		{ ...A, epoch: Number.NaN },
	])
		assert.throws(() =>
			journal.enqueue(input("invalid", { authority }), effects()),
		);
	assert.throws(() =>
		journal.enqueue(
			input("stale"),
			effects({
				assertCurrent: () => {
					throw new Error("revoked");
				},
			}),
		),
	);
	assert.equal(rows(journal).length, 0);
	assert.equal(journal.getRevision(), 0);
});

test("enqueue is synchronous, work starts after detach, snapshots and subscriptions survive views", async () => {
	const journal = new TeamBridgeSendJournal({ now: () => 25 });
	const post = deferred();
	let created = 0;
	let notifications = 0;
	let detached = false;
	const unsubscribe = journal.subscribe(() => notifications++);
	const row = journal.enqueue(
		input("instant", { createdAt: undefined }),
		effects({
			create: async () => {
				assert.ok(detached);
				created++;
				return C;
			},
			post: () => post.promise,
		}),
	);
	assert.equal(row.state, "queued");
	assert.equal(created, 0);
	assert.equal(row.enqueuedAt, 25);
	assert.ok(new Date(row.message.created_at).getUTCFullYear() >= 2026);
	assert.equal(rows(journal)[0], row);
	assert.equal(rows(journal), rows(journal));
	detached = true;
	await until(() => rows(journal)[0].state === "posting");
	unsubscribe();
	const afterUnmount = notifications;
	post.resolve({ id: "server-instant" });
	await until(() => rows(journal)[0].state === "confirmed");
	assert.equal(notifications, afterUnmount);
	assert.equal(rows(journal)[0].serverId, "server-instant");
	assert.equal(
		journal.rowsFor("account-b", A.tenantId, "compose:group").length,
		0,
	);
	assert.equal(
		journal.rowsFor(A.accountId, "tenant-b", "compose:group").length,
		0,
	);
	assert.equal(rows(journal, "other-target").length, 0);
	assert.equal(
		rows(journal, teamBridgeConversationTargetKey(C.id), C.id).length,
		1,
	);
});

test("three rapid group sends coalesce creation and conversation aliases join the serial queue", async () => {
	const journal = new TeamBridgeSendJournal();
	const create = deferred();
	const firstPost = deferred();
	let creates = 0;
	let activePosts = 0;
	let maxPosts = 0;
	const posted = [];
	const shared = effects({
		create: () => {
			creates++;
			return create.promise;
		},
		post: async (conversation, row) => {
			assert.equal(conversation.id, C.id);
			activePosts++;
			maxPosts = Math.max(maxPosts, activePosts);
			posted.push(row.clientRef);
			if (row.clientRef === "one") await firstPost.promise;
			activePosts--;
			return { id: `server:${row.clientRef}` };
		},
	});
	for (const ref of ["one", "two", "three"])
		journal.enqueue(input(ref), shared);
	assert.equal(rows(journal).length, 3);
	await until(() => creates === 1);
	assert.deepEqual(posted, []);
	create.resolve(C);
	await until(() => posted.length === 1);
	journal.enqueue(
		input("four", {
			targetKey: teamBridgeConversationTargetKey(C.id),
			conversationId: C.id,
		}),
		shared,
	);
	assert.equal(
		journal.getConversation(A.accountId, A.tenantId, "compose:group").kind,
		"group",
	);
	firstPost.resolve();
	await until(() => rows(journal).every((row) => row.state === "confirmed"));
	assert.deepEqual(posted, ["one", "two", "three", "four"]);
	assert.equal(creates, 1);
	assert.equal(maxPosts, 1);
	assert.equal(rows(journal).length, 4);
});

test("failed post retries same clientRef/conversation with fresh epoch and staged progress", async () => {
	const journal = new TeamBridgeSendJournal();
	let epoch = 1;
	let creates = 0;
	let uploads = 0;
	let posts = 0;
	const refs = [];
	const attachment = { stagedId: null };
	const attemptEffects = (captured) =>
		effects({
			assertCurrent: () => {
				if (captured !== epoch) throw new Error("epoch changed");
			},
			create: async () => {
				creates++;
				return C;
			},
			stage: async (_conversation, row) => {
				if (!row.attachments[0].stagedId) {
					uploads++;
					row.attachments[0].stagedId = "upload-a";
				}
				return row.attachments;
			},
			post: async (conversation, row) => {
				refs.push([conversation.id, row.clientRef]);
				if (++posts === 1)
					throw new Error("sensitive request body must not escape");
				return { message: message("posted", 3) };
			},
		});
	journal.enqueue(
		input("retry", { attachments: [attachment] }),
		attemptEffects(1),
	);
	await until(() => rows(journal)[0].state === "failed");
	assert.equal(rows(journal)[0].error.kind, "post");
	assert.ok(!JSON.stringify(rows(journal)[0].error).includes("sensitive"));
	epoch = 2;
	assert.equal(
		journal.retry(
			"retry",
			{ ...A, tenantId: "other", epoch },
			attemptEffects(2),
		),
		null,
	);
	const retried = journal.retry("retry", { ...A, epoch }, attemptEffects(2));
	assert.equal(retried.attempt, 2);
	await until(() => rows(journal)[0].state === "confirmed");
	assert.deepEqual(refs, [
		[C.id, "retry"],
		[C.id, "retry"],
	]);
	assert.equal(creates, 1);
	assert.equal(uploads, 1);
	assert.equal(rows(journal)[0].serverMessage.id, "posted");
	assert.equal(journal.discard("retry", A.accountId, A.tenantId), false);
});

test("partial stage progress survives failure without posting text alone", async () => {
	const journal = new TeamBridgeSendJournal();
	let uploads = 0;
	let posts = 0;
	journal.enqueue(
		input("partial", { attachments: [{ id: null }, { id: null }] }),
		effects({
			stage: async (_conversation, row) => {
				row.attachments[0].id = "first-upload";
				uploads++;
				throw new Error("second upload failed");
			},
			post: async () => {
				posts++;
			},
		}),
	);
	await until(() => rows(journal)[0].state === "failed");
	assert.equal(rows(journal)[0].error.kind, "stage");
	assert.equal(posts, 0);
	journal.retry(
		"partial",
		A,
		effects({
			stage: async (_conversation, row) => {
				for (const attachment of row.attachments)
					if (!attachment.id) {
						uploads++;
						attachment.id = "second-upload";
					}
				return row.attachments;
			},
			post: async () => {
				posts++;
				return { id: "partial-result" };
			},
		}),
	);
	await until(() => rows(journal)[0].state === "confirmed");
	assert.equal(uploads, 2);
	assert.equal(posts, 1);
});

test("create failure rejects invalid tenant receipt and allows failed-row discard only in its owner lane", async () => {
	const journal = new TeamBridgeSendJournal();
	let posts = 0;
	journal.enqueue(
		input("discard"),
		effects({
			create: async () => ({ ...C, tenant_id: "other-tenant" }),
			post: async () => {
				posts++;
			},
		}),
	);
	assert.equal(journal.discard("discard", A.accountId, A.tenantId), false);
	await until(() => rows(journal)[0].state === "failed");
	assert.equal(posts, 0);
	assert.equal(
		journal.getConversation(A.accountId, A.tenantId, "compose:group"),
		null,
	);
	assert.equal(journal.discard("discard", "account-b", A.tenantId), false);
	assert.equal(journal.discard("discard", A.accountId, A.tenantId), true);
	assert.deepEqual(rows(journal), []);
});

for (const boundary of ["create", "stage", "post"]) {
	for (const transition of ["switch-account", "logout-relogin"]) {
		test(`${boundary}: ${transition} refuses late results/cache callbacks and permits fresh retry`, async () => {
			const journal = new TeamBridgeSendJournal();
			const gate = deferred();
			let account = A.accountId;
			let epoch = 1;
			let entered = false;
			let createdCallbacks = 0;
			let confirmedCallbacks = 0;
			let cleanups = 0;
			let creates = 0;
			let posts = 0;
			journal.enqueue(
				input("late"),
				effects({
					assertCurrent: () => {
						if (account !== A.accountId || epoch !== 1)
							throw new Error("stale");
					},
					create: async () => {
						creates++;
						if (boundary === "create") {
							entered = true;
							await gate.promise;
						}
						return C;
					},
					stage: async () => {
						if (boundary === "stage") {
							entered = true;
							await gate.promise;
						}
						return [];
					},
					post: async () => {
						posts++;
						if (boundary === "post") {
							entered = true;
							await gate.promise;
						}
						return { message: message("late-server", 4) };
					},
					onCreated: () => {
						createdCallbacks++;
					},
					onConfirmed: () => {
						confirmedCallbacks++;
					},
					onSettled: () => {
						cleanups++;
					},
				}),
			);
			await until(() => entered);
			const callbacksBefore = createdCallbacks;
			account = transition === "switch-account" ? "account-b" : A.accountId;
			epoch = 3; // Logout and relogin cannot revive the captured epoch.
			gate.resolve();
			await until(() => rows(journal)[0].state === "failed");
			assert.equal(rows(journal)[0].error.kind, "authority");
			assert.equal(rows(journal)[0].serverId, null);
			assert.equal(createdCallbacks, callbacksBefore);
			assert.equal(confirmedCallbacks, 0);
			assert.equal(cleanups, 1);
			assert.equal(posts, boundary === "post" ? 1 : 0);
			assert.equal(
				journal.getConversation("account-b", A.tenantId, "compose:group"),
				null,
			);
			assert.equal(
				journal.getConversation(A.accountId, A.tenantId, "compose:group").id,
				C.id,
			);
			account = A.accountId;
			journal.retry(
				"late",
				{ ...A, epoch },
				effects({
					assertCurrent: () => {
						assert.equal(account, A.accountId);
						assert.equal(epoch, 3);
					},
					create: async () => {
						creates++;
						return C;
					},
					onCreated: () => {
						createdCallbacks++;
					},
					onConfirmed: () => {
						confirmedCallbacks++;
					},
				}),
			);
			await until(() => rows(journal)[0].state === "confirmed");
			assert.equal(creates, 1);
			assert.equal(confirmedCallbacks, 1);
			assert.equal(createdCallbacks, callbacksBefore + 1);
		});
	}
}

test("clear while create is pending prevents receipts/rows resurrection and cleans queued attempts", async () => {
	const journal = new TeamBridgeSendJournal();
	const create = deferred();
	let entered = false;
	let cleanups = 0;
	let callbacks = 0;
	const fx = effects({
		create: () => {
			entered = true;
			return create.promise;
		},
		onCreated: () => {
			callbacks++;
		},
		onConfirmed: () => {
			callbacks++;
		},
		onSettled: () => {
			cleanups++;
		},
	});
	journal.enqueue(input("clear-one"), fx);
	journal.enqueue(input("clear-two"), fx);
	await until(() => entered);
	journal.clearAccount(A.accountId, { receipts: true });
	create.resolve(C);
	await until(() => cleanups === 2);
	assert.equal(callbacks, 0);
	assert.deepEqual(rows(journal), []);
	assert.equal(
		journal.getConversation(A.accountId, A.tenantId, "compose:group"),
		null,
	);
});

test("projection anchors pending/confirmed rows, sorts history, exact reconciles, and stays render-pure", async () => {
	const journal = new TeamBridgeSendJournal();
	const target = teamBridgeConversationTargetKey(C.id);
	const history = [message("history-two", 2), message("history-one", 1)];
	const observe = (canonical) =>
		journal.observe(A.accountId, A.tenantId, target, C.id, canonical);
	const project = (canonical) =>
		journal.project(A.accountId, A.tenantId, target, C.id, canonical);
	observe(history);
	const post = deferred();
	journal.enqueue(
		input("own", { targetKey: target, conversationId: C.id }),
		effects({ post: () => post.promise }),
	);
	await until(() => rows(journal, target)[0].state === "posting");
	const foreign = message("foreign-during-send", 3);
	observe([foreign, ...history]);
	assert.deepEqual(
		project([foreign, ...history]).map((item) => item.key),
		["history-one", "history-two", "own", "foreign-during-send"],
	);
	const revision = journal.getRevision();
	assert.deepEqual(
		project([foreign, ...history]),
		project([foreign, ...history]),
	);
	assert.equal(journal.getRevision(), revision);
	// Equal bodies and timestamps never reconcile two distinct people/attempts.
	assert.equal(project([foreign, ...history]).length, 4);
	post.resolve({ message: message("own-server", 4) });
	await until(() => rows(journal, target)[0].state === "confirmed");
	const canonical = [message("own-server", 4), foreign, ...history];
	observe(canonical);
	const acked = project(canonical);
	assert.deepEqual(
		acked.map((item) => item.key),
		["history-one", "history-two", "own", "foreign-during-send"],
	);
	assert.equal(acked[2].message.id, "own-server");
	assert.equal(acked[2].message.created_at, input("own").createdAt);
	assert.equal(
		acked.filter((item) => item.message.id === "own-server").length,
		1,
	);
	const newest = message("after-confirmation", 5);
	observe([newest, ...canonical]);
	assert.equal(
		project([newest, ...canonical]).at(-1).key,
		"after-confirmation",
	);
	const older = message("older-page", 0);
	observe([newest, ...canonical, older]);
	assert.equal(project([newest, ...canonical, older])[0].key, "older-page");
	assert.equal(rows(journal, target).length, 1); // Metadata is not pruned by render.
});

test("canonical client_ref reconciles before POST receipt, but never across conversations", async () => {
	const journal = new TeamBridgeSendJournal();
	const gate = deferred();
	const target = teamBridgeConversationTargetKey(C.id);
	journal.enqueue(
		input("ref-match", { targetKey: target, conversationId: C.id }),
		effects({ post: () => gate.promise }),
	);
	await until(() => rows(journal, target)[0].state === "posting");
	const canonical = message("early-server", 1, { client_ref: "ref-match" });
	const projection = journal.project(A.accountId, A.tenantId, target, C.id, [
		canonical,
	]);
	assert.equal(projection.length, 1);
	assert.equal(projection[0].key, "ref-match");
	assert.equal(projection[0].message.id, canonical.id);
	assert.equal(
		journal.project(A.accountId, A.tenantId, target, C.id, [
			{ ...canonical, conversation_id: "different-conversation" },
		]).length,
		2,
	);
	gate.resolve({ id: "early-server" });
	await until(() => rows(journal, target)[0].state === "confirmed");
});
