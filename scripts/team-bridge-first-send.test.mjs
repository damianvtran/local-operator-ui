import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";

/*
 * FIRST-SEND MOUNTED MATRIX.
 *
 * Real: the page, its container (send/journal wiring), auth commissioning,
 * every API parser, the shipped singleton QueryClient and the shipped
 * `team-bridge-message-list`. Fixture edges only: preload transport (a fake
 * hub), the binary media relay, and the sidebar decoration.
 *
 * The fixture's transport seam is OPT-IN, so the untouched auth-owner security
 * suite keeps its own exact transport and cannot be weakened from here. This
 * file only adds answers the default fake hub does not have (a foreign tenant,
 * gates, an authority that goes away); every assertion about identity,
 * ownership and cache isolation runs against the real fence code.
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT.
 * Latency here is JSDOM commit cost: click -> React commit -> `[data-send-state]`
 * present, measured synchronously, with NO await between the click and the
 * query. It is NOT browser paint latency, not input-to-photon, and no layout or
 * style work is measured — jsdom performs neither. The claim it backs is
 * "the row exists in the committed DOM in the same task as the click, before
 * any transport await", never "the user sees it within N ms".
 */

// Read at fixture import time: the test-only outbox reset export is compiled in
// only for this suite. Static imports are hoisted, so the flag is set first.
process.env.TEAM_BRIDGE_FIRST_SEND_FIXTURE = "1";
const { deferred, delay, mount, send, sourceVariant, type, ui, until } =
	await import("./fixtures/team-bridge-auth-owner-page.mjs");

const CAPABILITY = {
	enabled: true,
	max_count: 4,
	max_bytes: 1024 * 1024,
	mime_types: ["image/png", "image/jpeg"],
};
/* A png signature is all `sniffImage` needs; without `createImageBitmap` the
 * bounding step passes the bytes through, exactly as it does on a platform
 * without a decoder. The upload seam is where the bytes stop. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const outboxReset = ui.resetTeamBridgeOutboxAccountForTests;
assert.equal(
	typeof outboxReset,
	"function",
	"the fixture must be compiled with TEAM_BRIDGE_FIRST_SEND_FIXTURE=1",
);

/* The shipped singleton is shared by every mounted fixture; its cache clear is
 * deliberately not an outbox reset (navigation must not lose unsent work), so
 * each suite ends its own account journals explicitly. */
const cleanup = (client) => {
	for (const accountId of ["acct_a", "acct_b"]) outboxReset(client, accountId);
};

const pendingRow = (host) => host.querySelector('[data-send-state="pending"]');
const failedRow = (host) => host.querySelector('[data-send-state="failed"]');
const confirmedRow = (host) =>
	host.querySelector('[data-send-state="confirmed"]');
const rows = (host) => [...host.querySelectorAll("[data-send-state]")];

const clickButton = (scope, label) => {
	const button = [...scope.querySelectorAll("button")].find(
		(node) => node.textContent.trim() === label,
	);
	assert.ok(button, `real "${label}" control`);
	return button;
};

/* Open a To: draft for a directory peer: no conversation exists yet, so the
 * first send is the create-then-post path AND a pasted image stays 'held'. */
/* The People row's own identity attribute, not its text: the row's avatar
 * contributes an initial character to `textContent`, so matching on "Peer"
 * would never select it. */
const openPeerDraft = async (app) => {
	const selector = '[data-team-bridge-person="acct_peer_0"]';
	await until(
		() => app.host.querySelector(selector),
		"directory peer rail row",
	);
	await act(async () => app.host.querySelector(selector).click());
	await until(() => app.host.querySelector("textarea"), "real draft composer");
};

const pasteImage = async (host, name = "shot.png") => {
	const field = host.querySelector("textarea");
	assert.ok(field, "composer before the paste");
	const file = new window.File([PNG], name, { type: "image/png" });
	const clipboard = {
		items: [{ kind: "file", getAsFile: () => file }],
		files: [file],
		types: ["Files"],
	};
	const event = new window.Event("paste", { bubbles: true, cancelable: true });
	Object.defineProperty(event, "clipboardData", { value: clipboard });
	await act(async () => {
		field.dispatchEvent(event);
	});
};

/* The synchronous measurement: no await anywhere between the click and the
 * DOM read, so the reading is commit cost, not a settled-over-time number. */
const sendSynchronously = (host) => {
	const button = [...host.querySelectorAll("button")].find((node) =>
		["Send", "Send message"].includes(node.getAttribute("aria-label")),
	);
	assert.ok(button && !button.disabled, "enabled send control");
	const started = performance.now();
	act(() => {
		button.click();
	});
	return performance.now() - started;
};

const posts = (fixture, owner) =>
	fixture.calls.filter(
		(call) =>
			call.op === "team_bridge.messages.send" &&
			(owner === undefined || call.owner === owner),
	);
const creates = (fixture, owner) =>
	fixture.calls.filter(
		(call) =>
			call.op === "team_bridge.conversations.create" &&
			(owner === undefined || call.owner === owner),
	);
const uploads = (fixture, owner) =>
	fixture.calls.filter(
		(call) =>
			call.op === "team_bridge.attachment.upload" &&
			(owner === undefined || call.owner === owner),
	);

/* A committed B-auth frame must never carry A's authored text, and no query
 * cached under B may hold it either. */
const assertNoForeignCarry = (app, body) => {
	assert.equal(
		app.frames.filter(
			(frame) =>
				frame.auth === "acct_b" &&
				(frame.text.includes(body) || frame.draft.includes(body)),
		).length,
		0,
		"every committed B-auth frame excludes the authored body",
	);
	for (const query of app.client.getQueryCache().getAll()) {
		if (!JSON.stringify(query.queryKey).includes("acct_b")) continue;
		assert.equal(
			JSON.stringify(query.state.data ?? null).includes(body),
			false,
			`no cache entry under B holds the body (${JSON.stringify(query.queryKey)})`,
		);
	}
};

test("first send commits a pending row in the click task and only then creates", async () => {
	const app = await mount({ cleanup, empty: true });
	try {
		await openPeerDraft(app);
		await type(app.host, "first send body");
		app.fixture.createGate = deferred();

		const elapsed = sendSynchronously(app.host);
		const row = pendingRow(app.host);
		assert.ok(
			row,
			"the local row is in the committed DOM in the same task as the click",
		);
		/* The commit cost of a COLD first render in JSDOM; the warmed, per-send
		 * number is asserted in the rapid-send case below. Neither is paint. */
		console.log(`first-send cold commit cost: ${elapsed.toFixed(1)}ms`);
		assert.equal(
			row.textContent.includes("first send body"),
			true,
			"the row the person just authored, not a placeholder",
		);
		assert.equal(
			row.querySelector("img"),
			null,
			"a text-only send reserves no image box",
		);
		/* The queue accepted the work in the click. The create may already be on
		 * the wire - that is the point of doing it in the background - but NOTHING
		 * can post before the conversation exists. */
		assert.equal(posts(app.fixture).length, 0);
		assert.equal(app.host.querySelector("textarea").value, "");

		app.fixture.createGate.resolve();
		app.fixture.createGate = null;
		await until(
			() =>
				creates(app.fixture).length === 1 && posts(app.fixture).length === 1,
			"create then exactly one post",
		);
		assert.equal(posts(app.fixture)[0].body, "first send body");
	} finally {
		app.fixture.createGate?.resolve();
		await app.close();
	}
});

test("the canonical swap keeps the same row node and its client reference", async () => {
	const app = await mount({ cleanup });
	try {
		app.fixture.refuse = false;
		app.fixture.postGate = deferred();
		await type(app.host, "swap body");
		sendSynchronously(app.host);
		const row = pendingRow(app.host);
		assert.ok(row, "pending row before the post answers");
		const localId = row.getAttribute("data-message-id");
		assert.ok(localId, "the local row carries the author's stable client key");

		app.fixture.postGate.resolve();
		app.fixture.postGate = null;
		await until(() => confirmedRow(app.host), "confirmed row after the ACK");
		const confirmed = confirmedRow(app.host);
		assert.equal(
			confirmed,
			row,
			"the same DOM node survives the local-to-server id swap",
		);
		assert.notEqual(
			confirmed.getAttribute("data-message-id"),
			localId,
			"the row now names the hub's message, not the local key",
		);
		const page = app.client.getQueryData(
			ui.teamBridgeKeys.messages("bcv_shared", "org_shared", "acct_a"),
		);
		const canonical = (page?.messages ?? []).find(
			(message) => message.body === "swap body",
		);
		assert.ok(
			canonical,
			"the canonical message is in the owner-qualified cache",
		);
		assert.equal(
			confirmed.getAttribute("data-message-id"),
			canonical.id,
			"the row id and the cached message id are one identity",
		);
		assert.equal(
			confirmed.querySelector("img"),
			null,
			"no image box appears at the swap for a text-only send",
		);
	} finally {
		app.fixture.postGate?.resolve();
		await app.close();
	}
});

test("a failed row retries the same client reference in the created conversation, then discards", async () => {
	const app = await mount({ cleanup, empty: true });
	try {
		await openPeerDraft(app);
		await type(app.host, "retry body");
		await send(app.host);
		await until(() => failedRow(app.host), "failed row after the refusal");
		assert.equal(creates(app.fixture).length, 1);
		const first = posts(app.fixture);
		assert.equal(first.length, 1);
		const clientRef = first[0].client_ref;
		const conversationId = first[0].conversation_id;
		assert.ok(clientRef && conversationId);

		app.fixture.refuse = false;
		await act(async () => clickButton(app.host, "Retry").click());
		await until(() => confirmedRow(app.host), "confirmed row after the retry");
		assert.equal(
			creates(app.fixture).length,
			1,
			"retry reuses the created conversation instead of creating a second",
		);
		const retried = posts(app.fixture);
		assert.equal(retried.length, 2);
		assert.deepEqual(
			retried.map((call) => [call.client_ref, call.conversation_id]),
			[
				[clientRef, conversationId],
				[clientRef, conversationId],
			],
			"both attempts name one idempotent attempt in one conversation",
		);

		/* Discard drops the row and its reservation, and nothing restores it. */
		app.fixture.refuse = true;
		await type(app.host, "discard body");
		await send(app.host);
		await until(
			() => failedRow(app.host)?.textContent.includes("discard body"),
			"second failed row",
		);
		await act(async () => clickButton(app.host, "Discard").click());
		await delay();
		assert.equal(
			app.host.textContent.includes("discard body"),
			false,
			"a discarded body leaves the thread",
		);
		assert.equal(failedRow(app.host), null, "no failed row stays reserved");
		assert.equal(pendingRow(app.host), null);
		/* Only the earlier, confirmed row is still on screen: discarding the
		 * failed one removes it and nothing else. */
		assert.equal(
			rows(app.host).filter((node) => node.textContent.includes("retry body"))
				.length,
			1,
		);
		assert.equal(posts(app.fixture).length, 3);
	} finally {
		await app.close();
	}
});

test("three rapid first sends create once and post in order", async () => {
	const app = await mount({ cleanup, empty: true });
	try {
		await openPeerDraft(app);
		app.fixture.createGate = deferred();
		const costs = [];
		for (const body of ["first", "second", "third"]) {
			await type(app.host, body);
			costs.push(sendSynchronously(app.host));
		}
		assert.equal(
			rows(app.host).length,
			3,
			"three authored rows are visible before the conversation exists",
		);
		assert.equal(
			posts(app.fixture).length,
			0,
			"nothing posts before the create",
		);
		/* WARMED commit cost: the second and third sends re-render the same list
		 * the reader already sees. JSDOM does no layout or paint, so this is the
		 * only honest budget it can offer - a <16ms frame is asserted on the warm
		 * sample, and the cold first render is reported, not asserted. */
		const warm = costs.slice(1).sort((left, right) => left - right)[0];
		console.log(
			`rapid-send commit costs (ms): ${costs.map((ms) => ms.toFixed(1)).join(", ")}`,
		);
		assert.ok(
			warm < 16,
			`warm row render took ${warm.toFixed(1)}ms, above one 60Hz frame`,
		);

		app.fixture.createGate.resolve();
		app.fixture.createGate = null;
		await until(() => posts(app.fixture).length === 3, "three posts");
		assert.equal(
			creates(app.fixture).length,
			1,
			"one conversation for the whole burst",
		);
		assert.deepEqual(
			posts(app.fixture).map((call) => call.body),
			["first", "second", "third"],
			"posts preserve authoring order",
		);
		assert.equal(
			new Set(posts(app.fixture).map((call) => call.client_ref)).size,
			3,
			"each row keeps its own client reference",
		);
	} finally {
		app.fixture.createGate?.resolve();
		await app.close();
	}
});

test("route unmount and remount keep a pending row and a failed row", async () => {
	const app = await mount({ cleanup, navigation: true });
	const away = "/inbox";
	const back = "/team-bridge?tenant=org_shared&conversation=bcv_shared";
	try {
		await until(
			() => app.host.querySelector("textarea"),
			"conversation composer",
		);
		/* This case is about a row surviving navigation, so the post must LAND:
		 * the refusal case is the second half of the same test. */
		app.fixture.refuse = false;
		app.fixture.postGate = deferred();
		await type(app.host, "pending across navigation");
		sendSynchronously(app.host);
		assert.ok(pendingRow(app.host));

		await app.navigate(away);
		assert.ok(
			app.host.querySelector("[data-fixture-away]"),
			"the page actually unmounted",
		);
		await app.navigate(back);
		await until(
			() =>
				pendingRow(app.host)?.textContent.includes("pending across navigation"),
			"pending row restored after remount",
		);
		assert.equal(
			app.host.querySelectorAll("[data-send-state]").length,
			1,
			"the outbox does not duplicate the row on remount",
		);

		app.fixture.postGate.resolve();
		app.fixture.postGate = null;
		await until(() => confirmedRow(app.host), "the pending row confirms");

		app.fixture.refuse = true;
		await type(app.host, "failed across navigation");
		await send(app.host);
		await until(() => failedRow(app.host), "failed row");
		await app.navigate(away);
		await app.navigate(back);
		await until(
			() =>
				failedRow(app.host)?.textContent.includes("failed across navigation"),
			"failed row restored after remount",
		);
		assert.ok(
			clickButton(app.host, "Retry"),
			"the restored failed row still offers its own retry",
		);
	} finally {
		app.fixture.postGate?.resolve();
		await app.close();
	}
});

test("a pasted image previews locally before its upload, and survives the swap", async () => {
	const app = await mount({
		cleanup,
		empty: true,
		attachments: CAPABILITY,
		media: async (request, bytes) => {
			if (request.op === "team_bridge.attachment.upload") {
				if (app.fixture.uploadGate) await app.fixture.uploadGate.promise;
				return {
					kind: "json",
					body: {
						result: {
							attachment: {
								id: "att_staged_1",
								mime: "image/png",
								size: bytes?.byteLength ?? 0,
								width: 1,
								height: 1,
							},
						},
					},
				};
			}
			return { kind: "error", status: 404 };
		},
	});
	try {
		app.fixture.refuse = false;
		await openPeerDraft(app);
		await pasteImage(app.host);
		await until(
			() => app.host.querySelector('[data-attachment-chip="held"]'),
			"held chip: bytes wait for the first send to create the conversation",
		);
		assert.equal(
			uploads(app.fixture).length,
			0,
			"a paste in a draft writes nothing to the hub",
		);

		app.fixture.createGate = deferred();
		app.fixture.uploadGate = deferred();
		await type(app.host, "with an image");
		sendSynchronously(app.host);
		const row = pendingRow(app.host);
		assert.ok(row, "pending row with its image");
		const preview = row.querySelector("img");
		assert.ok(preview, "the image tile is rendered before any upload");
		const previewUrl = preview.getAttribute("src");
		assert.equal(previewUrl.startsWith("blob:"), true, previewUrl);
		assert.equal(
			row.querySelector("[data-attachment-reserved]"),
			null,
			"no placeholder stands in for a picture this session holds",
		);
		assert.equal(
			uploads(app.fixture).length,
			0,
			"the preview is local: no upload has happened yet",
		);

		app.fixture.createGate.resolve();
		app.fixture.createGate = null;
		await until(() => uploads(app.fixture).length === 1, "upload after create");
		app.fixture.uploadGate.resolve();
		await until(() => confirmedRow(app.host), "confirmed row");
		const confirmed = confirmedRow(app.host);
		assert.equal(confirmed, row, "the row (and its tile) survives the swap");
		assert.equal(
			confirmed.querySelector("img")?.getAttribute("src"),
			previewUrl,
			"the local picture stays in place through confirmation",
		);
	} finally {
		app.fixture.createGate?.resolve();
		app.fixture.uploadGate?.resolve();
		await app.close();
	}
});

test("a late post cannot be dispatched or cached under the account that replaced A", async () => {
	const app = await mount({ cleanup });
	const body = "A held private first send";
	try {
		app.fixture.refuse = false;
		app.fixture.postGate = deferred();
		await type(app.host, body);
		sendSynchronously(app.host);
		await until(() => posts(app.fixture).length === 1, "A dispatched its post");

		const gate = app.fixture.postGate;
		await app.changeAuth("acct_b");
		app.fixture.postGate = null;
		await act(async () => gate.resolve());
		await act(async () => new Promise((resolve) => setTimeout(resolve, 60)));

		assert.equal(
			posts(app.fixture, "acct_b").length,
			0,
			"no post is dispatched under B",
		);
		assert.equal(posts(app.fixture).length, 1, "no automatic retry under B");
		/* THE OWNER RECEIPT ITSELF (review round 1, F6): the fixture advertises the
		 * conversation-owner guard but does not enforce it, so the only proof that
		 * the write names its account is the dispatched request. A regression that
		 * dropped `expected_account_id` would otherwise pass this suite. */
		assert.equal(
			posts(app.fixture)[0]?.expected_account_id,
			"acct_a",
			"the dispatched write names the account that authored it",
		);
		assertNoForeignCarry(app, body);
	} finally {
		app.fixture.postGate?.resolve();
		await app.close();
	}
});

test("a send authored before sign-out writes nothing, and a later B login inherits nothing", async () => {
	let signedOut = false;
	const app = await mount({
		cleanup,
		empty: true,
		attachments: CAPABILITY,
		intercept: (request) => {
			if (
				signedOut &&
				request.op === "radient.request" &&
				request.control?.operation === "account"
			)
				return { status: 401, body: { detail: "signed out" } };
			return undefined;
		},
		media: async () => ({ kind: "error", status: 503 }),
	});
	const body = "authored then signed out";
	try {
		await openPeerDraft(app);
		await pasteImage(app.host);
		await until(
			() => app.host.querySelector('[data-attachment-chip="held"]'),
			"held chip",
		);
		app.fixture.createGate = deferred();
		await type(app.host, body);
		sendSynchronously(app.host);
		assert.ok(pendingRow(app.host));

		signedOut = true;
		await act(async () => ui.commissionAccountRead(app.client));
		await delay();
		app.fixture.createGate.resolve();
		app.fixture.createGate = null;
		await act(async () => new Promise((resolve) => setTimeout(resolve, 60)));

		assert.equal(
			creates(app.fixture, "acct_b").length,
			0,
			"a create is never dispatched under the next account",
		);
		assert.equal(uploads(app.fixture).length, 0, "no upload after sign-out");
		assert.equal(posts(app.fixture).length, 0, "no post after sign-out");
		assertNoForeignCarry(app, body);

		signedOut = false;
		await app.changeAuth("acct_b");
		await delay();
		assert.equal(posts(app.fixture, "acct_b").length, 0);
		assertNoForeignCarry(app, body);
	} finally {
		app.fixture.createGate?.resolve();
		await app.close();
	}
});

test("tenant navigation keeps the original scoped send and renders nothing under the foreign org", async () => {
	const app = await mount({
		cleanup,
		navigation: true,
		intercept: (request, { tenant }) => {
			if (tenant !== "org_other") return undefined;
			if (request.op === "team_bridge.conversations.list")
				return {
					status: 200,
					body: {
						result: {
							conversations: [
								{
									id: "bcv_other",
									tenant_id: "org_other",
									kind: "group",
									name: "Other thread",
									visibility: "private",
									agent_capable: false,
									status: "open",
									created_by: "acct_a",
									last_message_at: "2026-10-28T12:00:00Z",
									latest_seq: 0,
									members: [],
									last_read_seq: 0,
									unread_count: 0,
									muted: false,
								},
							],
						},
					},
				};
			if (request.op === "team_bridge.messages.list")
				return {
					status: 200,
					body: { result: { messages: [], has_more: false } },
				};
			if (request.op === "team_bridge.unread")
				return {
					status: 200,
					body: { result: { total: 0, organizations: [], conversations: [] } },
				};
			return undefined;
		},
	});
	const body = "scoped to the original org";
	try {
		app.fixture.refuse = false;
		app.fixture.postGate = deferred();
		await until(
			() => app.host.querySelector("textarea"),
			"conversation composer",
		);
		await type(app.host, body);
		sendSynchronously(app.host);
		assert.ok(pendingRow(app.host));

		/* A TENANT SWITCH IS A REMOUNT, not a re-read of one page's search
		 * string: the route leaves and comes back with the other organization,
		 * exactly as the rail's scope switcher and a notification link do. */
		await app.navigate("/inbox");
		app.fixture.tenant = "org_other";
		await app.navigate("/team-bridge?tenant=org_other");
		await until(
			() => app.host.textContent.includes("Other thread"),
			"the foreign tenant's own conversation list",
		);
		assert.equal(
			app.host.textContent.includes(body),
			false,
			"a pending org_shared row never renders under a foreign org",
		);
		assert.deepEqual(rows(app.host), [], "no local row under the foreign org");

		const gate = app.fixture.postGate;
		app.fixture.postGate = null;
		await act(async () => gate.resolve());
		await until(
			() => posts(app.fixture).length === 1,
			"the original post dispatches",
		);
		assert.equal(
			posts(app.fixture)[0].tenant_id,
			"org_shared",
			"the send keeps the tenant it was authored in",
		);
		assert.equal(app.host.textContent.includes(body), false);

		await app.navigate("/inbox");
		app.fixture.tenant = "org_shared";
		await app.navigate(
			"/team-bridge?tenant=org_shared&conversation=bcv_shared",
		);
		await until(
			() => app.host.textContent.includes(body),
			"back in its own org the row is visible again",
		);
	} finally {
		app.fixture.postGate?.resolve();
		await app.close();
	}
});

/* OPT-IN RED CONTROL (TEAM_BRIDGE_FIRST_SEND_BASELINE=8e415fbab9): compile the
 * pre-change team-bridge sources in memory and show this suite's core claim is
 * FALSE there — no local row reaches the DOM in the click task, so the first
 * test above could not pass before the implementation. Skipped without the
 * flag; the auth-owner suite's own pinned baseline is deliberately untouched. */
test(
	"baseline source rollback cannot commit a local row in the click task",
	{
		skip: sourceVariant.baseline
			? false
			: "set TEAM_BRIDGE_FIRST_SEND_BASELINE",
	},
	async () => {
		assert.equal(sourceVariant.baseline, "8e415fbab9");
		assert.ok(
			sourceVariant.files.length > 0,
			"the override actually replaced changed sources",
		);
		const app = await mount({ cleanup });
		try {
			await openPeerDraft(app);
			await type(app.host, "baseline body");
			sendSynchronously(app.host);
			assert.equal(
				pendingRow(app.host),
				null,
				"the pre-change page commits no local row",
			);
			assert.equal(
				app.host.textContent.includes("baseline body"),
				false,
				"nothing of the body is shown before the hub answers",
			);
		} finally {
			await app.close();
		}
	},
);

/* The operator's composer rule (2026-10-28): the box empties in the SAME commit
 * that shows the row, and the durable draft leaves with it, so neither a pencil
 * icon nor a reload can bring the sent text back. */
const storedDraftText = (body) =>
	Object.keys(localStorage).some((key) =>
		String(localStorage.getItem(key) ?? "").includes(body),
	);

test("the composer and its persisted draft clear in the same commit as the row", async () => {
	const app = await mount({ cleanup });
	try {
		await type(app.host, "cleared in the click");
		assert.equal(storedDraftText("cleared in the click"), true);
		app.fixture.createGate = deferred();
		sendSynchronously(app.host);
		/* No await between the click and these three readings: the row, the empty
		 * box and the erased stored draft are one commit. */
		assert.ok(pendingRow(app.host), "row in the click task");
		assert.equal(
			app.host.querySelector("textarea").value,
			"",
			"the composer is empty in the same task",
		);
		assert.equal(
			storedDraftText("cleared in the click"),
			false,
			"the durable draft is gone, not merely the on-screen text",
		);
		assert.equal(
			app.host.querySelector("textarea").getAttribute("rows"),
			"1",
			"the box is back to one row",
		);
	} finally {
		app.fixture.createGate?.resolve();
		await app.close();
	}
});

test("a failure offers Retry and Return to draft, and the returned draft never overwrites newer text", async () => {
	const app = await mount({ cleanup });
	try {
		await type(app.host, "please return me");
		await send(app.host);
		await until(() => failedRow(app.host), "failed row");
		assert.ok(clickButton(app.host, "Retry"), "Retry is offered");
		const returnButton = clickButton(app.host, "Return to draft");
		assert.ok(returnButton, "Return to draft is offered");

		await type(app.host, "typed since the failure");
		await act(async () => returnButton.click());
		await until(
			() => !failedRow(app.host),
			"the returned row leaves the thread",
		);
		const box = app.host.querySelector("textarea").value;
		assert.equal(
			box.includes("please return me"),
			true,
			"the sent text is back",
		);
		assert.equal(
			box.includes("typed since the failure"),
			true,
			"what the person typed since is kept",
		);
		assert.equal(
			storedDraftText("please return me"),
			true,
			"the returned draft is durable again",
		);
		assert.equal(posts(app.fixture).length, 1, "returning sends nothing");
	} finally {
		await app.close();
	}
});

test("Retry after an ambiguous failure is idempotent: the hub keeps one message", async () => {
	const app = await mount({ cleanup });
	try {
		app.fixture.postFailsAfterLanding = true;
		await type(app.host, "landed but unanswered");
		await send(app.host);
		await until(() => failedRow(app.host), "failed row after the lost answer");
		const firstRef = posts(app.fixture)[0].client_ref;
		assert.equal(
			app.fixture.messages.get(JSON.stringify(["acct_a", "org_shared"]))
				?.length,
			1,
		);

		app.fixture.refuse = false;
		await act(async () => clickButton(app.host, "Retry").click());
		await until(() => confirmedRow(app.host), "confirmed row after the replay");
		assert.deepEqual(
			posts(app.fixture).map((call) => call.client_ref),
			[firstRef, firstRef],
			"the retry names the same idempotency key",
		);
		assert.equal(
			app.fixture.messages.get(JSON.stringify(["acct_a", "org_shared"]))
				?.length,
			1,
			"one stored message, not two",
		);
		assert.equal(
			rows(app.host).filter((node) =>
				node.textContent.includes("landed but unanswered"),
			).length,
			1,
			"one row on screen after the replay",
		);
	} finally {
		await app.close();
	}
});

test("a send that landed and failed cannot come back twice after Return to draft", async () => {
	const app = await mount({ cleanup });
	try {
		app.fixture.postFailsAfterLanding = true;
		await type(app.host, "returned after landing");
		await send(app.host);
		await until(() => failedRow(app.host), "failed row");
		await act(async () => clickButton(app.host, "Return to draft").click());
		await until(() => !failedRow(app.host), "the row is gone");
		/* The hub's history already holds that message; a refetch delivers it as
		 * canonical history, and the composition must not also resurrect the
		 * returned row (which would show the same text twice). */
		await act(async () =>
			app.client.invalidateQueries({
				queryKey: ui.teamBridgeKeys.messages("bcv_shared", "org_shared"),
			}),
		);
		await delay();
		assert.equal(rows(app.host).length, 0, "no local row survives the return");
		assert.equal(posts(app.fixture).length, 1, "no automatic resend");
	} finally {
		await app.close();
	}
});

test("an account change drops the departing account's rows and pictures", async () => {
	const app = await mount({ cleanup });
	const body = "A row that must not outlive A";
	try {
		app.fixture.refuse = false;
		app.fixture.postGate = deferred();
		await type(app.host, body);
		sendSynchronously(app.host);
		await until(() => posts(app.fixture).length === 1, "A dispatched its post");

		/* The fence is not the only claim in the isolation table: the journal must
		 * also EMPTY A's lane at the transition (review round 1, F1). The effect
		 * that used to do it lived inside the keyed subtree and could never fire. */
		/* The row lives in the CONVERSATION's lane, not the person lane (review
		 * round 2, F1c): asserting a lane that never held it passed with the purge
		 * deleted. Prove it was there, then prove it is gone. */
		const lane = ["acct_a", "org_shared", "conversation:bcv_shared"];
		assert.equal(
			app.journal.rowsFor(...lane).length,
			1,
			"A's row is in its lane before the switch",
		);

		await app.changeAuth("acct_b");
		const gate = app.fixture.postGate;
		app.fixture.postGate = null;
		await act(async () => gate.resolve());
		await delay();

		assert.equal(
			app.journal.rowsFor(...lane).length,
			0,
			"A's rows are gone once B owns the surface",
		);
		assert.equal(app.host.querySelectorAll("[data-send-state]").length, 0);
		assertNoForeignCarry(app, body);
	} finally {
		app.fixture.postGate?.resolve();
		await app.close();
	}
});

test("the failed row offers Retry, Return to draft and Discard, in that order", async () => {
	const app = await mount({ cleanup });
	try {
		app.fixture.refuse = true;
		await type(app.host, "a message that cannot be sent");
		await send(app.host);
		await until(() => failedRow(app.host), "failed row");
		const labels = [...failedRow(app.host).querySelectorAll("button")].map(
			(button) => button.textContent.trim(),
		);
		assert.deepEqual(labels, ["Retry", "Return to draft", "Discard"]);
	} finally {
		app.fixture.refuse = false;
		await app.close();
	}
});
