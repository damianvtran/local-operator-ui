import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import {
	PNG_BASE64,
	deferred,
	mount,
	send,
	type,
	ui,
	until,
} from "./fixtures/team-bridge-auth-owner-page.mjs";

/*
 * A TEXT-ONLY SEND CARRIES ITS @-MENTIONS ON THE WIRE.
 *
 * The bug: the optimistic lane (every text-only top-level send) posted straight
 * through `TeamBridgeApi.send` and never read the composer's staged mention
 * outbox, so the hub received no `mentions[]` and every receiver fell back to
 * matching display names. These cases press Send in the REAL container (hooks,
 * React Query, the pending-send store, the mention provider and popover) with
 * only the preload transport replaced, and read the `team_bridge.messages.send`
 * request the desktop main process would receive.
 *
 * The fixture's conversation `bcv_shared` has two ACTIVE members, acct_a (the
 * reader) and acct_b; the directory lists acct_peer_0, who is NOT a member, so
 * picking them yields a silent pill (`notify: false`) plus a notice.
 */

/* jsdom has no `CSS`; the popover scrolls its active row into view by a
   `CSS.escape`d id, and option ids here are plain `[a-z0-9-]`. */
globalThis.CSS ??= { escape: (value) => String(value) };
/* A pick refocuses the field on the next frame; jsdom has no frames. */
globalThis.requestAnimationFrame ??= (callback) =>
	setTimeout(() => callback(0), 0);
globalThis.cancelAnimationFrame ??= clearTimeout;

const sends = (app) =>
	app.fixture.calls.filter((call) => call.op === "team_bridge.messages.send");
const click = (node) => act(async () => node.click());

async function openComposer(app) {
	await until(
		() => app.host.querySelector("textarea"),
		"the conversation composer",
	);
	/* The capability gates the whole mention source; wait for it to be read. */
	await until(
		() =>
			app.host.querySelector("textarea")?.getAttribute("role") === "combobox",
		"mentions enabled on the composer",
	);
}

/*
 * Typing that arms the mention query: a focused field, a caret, and an
 * `InputEvent` with an `inputType`, which is what the autocomplete reads as a
 * typing gesture (the fixture's plain `input` Event is not one, by design: a
 * restore must never open the popover).
 */
async function typeKeys(host, value) {
	await act(async () => {
		const field = host.querySelector("textarea");
		field.focus();
		Object.getOwnPropertyDescriptor(
			window.HTMLTextAreaElement.prototype,
			"value",
		).set.call(field, value);
		field.setSelectionRange(value.length, value.length);
		field.dispatchEvent(
			new window.InputEvent("input", {
				bubbles: true,
				inputType: "insertText",
			}),
		);
	});
}

/* Type `prefix@query`, then pick the option for `key` the way a reader does. */
async function mention(app, text, key) {
	await typeKeys(app.host, text);
	/* The popover is portalled to `document.body`, outside the page host. */
	const option = () => document.querySelector(`[data-mention-option="${key}"]`);
	await until(option, `${key} offered`);
	await click(option());
}

const BEA = [{ kind: "human", account_id: "acct_b" }];

test("a text-only send carries the staged mentions, and Retry resends exactly them", async () => {
	ui.resetPendingSendsForTest();
	const app = await mount({ sendMentions: true });
	try {
		await openComposer(app);
		await mention(app, "ping @acct", "human:acct_b");
		const body = app.host.querySelector("textarea").value.trim();
		assert.ok(body.startsWith("ping @acct_b"), body);
		/* The fixture refuses sends by default: the first attempt fails. */
		await send(app.host);
		await until(() => sends(app).length === 1, "the first attempt");
		assert.deepEqual(
			sends(app)[0].mentions,
			BEA,
			"the optimistic send carries the wire mentions",
		);
		await until(
			() => app.host.querySelector('[data-delivery="failed"]'),
			"a failed row with Retry",
		);

		/*
		 * Everything that could make a late outbox read wrong, before the Retry:
		 * the same text restaged with ANOTHER list, then evicted entirely by more
		 * than the outbox's 32 entries, and the page remounted (leave and return).
		 */
		ui.stageMentions("bcv_shared", body, [
			{ kind: "human", account_id: "acct_someone_else" },
		]);
		for (let i = 0; i < 40; i++)
			ui.stageMentions("bcv_flood", `filler ${i}`, BEA);
		assert.equal(ui.stagedMentions("bcv_shared", body), undefined);
		await app.leave();
		await app.back();

		app.fixture.refuse = false;
		const retry = await (async () => {
			let found;
			await until(() => {
				found = [...app.host.querySelectorAll("button")].find(
					(b) => b.textContent.trim() === "Retry",
				);
				return found;
			}, "the row's Retry after the remount");
			return found;
		})();
		await click(retry);
		await until(() => sends(app).length === 2, "the retried attempt");
		const [first, second] = sends(app);
		assert.equal(second.client_ref, first.client_ref, "Retry keeps its key");
		assert.deepEqual(
			second.mentions,
			BEA,
			"Retry resends the mentions captured at the press",
		);
		await until(
			() =>
				ui.usePendingSends
					.getState()
					.entries.every((row) => row.status === "sent"),
			"the retry settles",
		);
	} finally {
		await app.close();
	}
});

test("a silent (notify: false) mention keeps its flag: it is never put on the wire", async () => {
	ui.resetPendingSendsForTest();
	const app = await mount({ sendMentions: true });
	app.fixture.refuse = false;
	try {
		await openComposer(app);
		await mention(app, "@acct", "human:acct_b");
		const field = app.host.querySelector("textarea");
		await mention(app, `${field.value}and @Pe`, "human:acct_peer_0");
		/* A non-member pick starts silent; the reader confirms it stays silent. */
		const silent = () =>
			[...app.host.querySelectorAll("button")].find(
				(b) => b.textContent.trim() === "Mention without notifying",
			);
		await until(silent, "the non-member notice");
		await click(silent());
		assert.equal(
			app.host.querySelectorAll("[data-mention-pill]").length,
			2,
			"both pills stay in the text",
		);
		await send(app.host);
		await until(() => sends(app).length === 1, "the send");
		assert.deepEqual(
			sends(app)[0].mentions,
			BEA,
			"only the notifying mention is sent",
		);
		assert.ok(sends(app)[0].body.includes("@acct_b and @Peer"));
	} finally {
		await app.close();
	}
});

/* A Finder drop onto the composer: the preload names the file's path and the
   chip is staged; nothing is uploaded until a send binds it. The bytes must be
   a whole PNG (the same one the preload's `readFile` returns): the composer
   routes by sniffed bytes, not the declared type, so a truncated signature
   typed `image/png` is correctly sent down the generic file lane instead. */
async function dropImage(host) {
	const box = host.querySelector("textarea").parentElement;
	const file = new File([Buffer.from(PNG_BASE64, "base64")], "", {
		type: "image/png",
	});
	const event = new window.Event("drop", { bubbles: true, cancelable: true });
	event.dataTransfer = {
		types: ["Files"],
		items: [{ kind: "file", getAsFile: () => file }],
		files: [file],
	};
	await act(async () => box.dispatchEvent(event));
	await until(
		() => host.querySelector("[data-attachment-id]"),
		"the dropped picture's chip",
	);
}

test("a picture send keeps the mentions it was pressed with when an identical text send lands during its upload", async () => {
	/*
	 * Review MINOR-1 on #1663. The picture path is awaited and builds its request
	 * only after the upload; the optimistic text lane clears the shared outbox
	 * entry for (conversation, body) when ITS send lands. So: send "ok @Bea"
	 * (text, in flight), then "ok @Bea" again with a picture, and let the text
	 * send land while the picture uploads. Read late, the picture went out with
	 * no `mentions` at all.
	 */
	ui.resetPendingSendsForTest();
	const app = await mount({ sendMentions: true, attachments: true });
	app.fixture.refuse = false;
	try {
		await openComposer(app);
		await mention(app, "ok @acct", "human:acct_b");
		const body = app.host.querySelector("textarea").value.trim();
		/* The text send is held at the hub until the picture's upload starts. */
		const textPost = deferred();
		app.fixture.postGate = textPost;
		await send(app.host);
		await until(() => sends(app).length === 1, "the text send dispatched");
		assert.deepEqual(sends(app)[0].mentions, BEA);

		/* The same words, picked the same way, now with a picture. */
		await mention(app, "ok @acct", "human:acct_b");
		assert.equal(app.host.querySelector("textarea").value.trim(), body);
		await dropImage(app.host);
		const upload = deferred();
		app.fixture.mediaGate = upload;
		await send(app.host);
		await until(
			() => app.fixture.uploadStarts === 1,
			"the picture's upload is in flight",
		);
		assert.equal(sends(app).length, 1, "the picture has not posted yet");

		/* The text send lands mid-upload and retires the outbox entry. */
		app.fixture.postGate = null;
		textPost.resolve();
		await until(
			() =>
				ui.usePendingSends
					.getState()
					.entries.every((row) => row.status === "sent"),
			"the text send settles",
		);
		assert.equal(
			ui.stagedMentions("bcv_shared", body),
			undefined,
			"the landed text send cleared the shared outbox entry",
		);

		upload.resolve();
		await until(() => sends(app).length === 2, "the picture send");
		const picture = sends(app)[1];
		assert.deepEqual(picture.attachment_ids, ["batt_1"]);
		assert.deepEqual(
			picture.mentions,
			BEA,
			"the picture send carries the mentions captured at its press",
		);
	} finally {
		await app.close();
	}
});

test("a text-only send with no mention sends no `mentions` field", async () => {
	ui.resetPendingSendsForTest();
	const app = await mount({ sendMentions: true });
	app.fixture.refuse = false;
	try {
		await openComposer(app);
		await type(app.host, "no one in particular");
		await send(app.host);
		await until(() => sends(app).length === 1, "the send");
		assert.equal(
			Object.hasOwn(sends(app)[0], "mentions"),
			false,
			"an older hub sees the unchanged body",
		);
	} finally {
		await app.close();
	}
});
