import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";

/*
 * ONE CHANNEL'S CRASH STAYS IN ITS PANE (P0, 2026-11-10).
 *
 * A render error inside the conversation pane (the reported one was React #185
 * from the windowed timeline) reached the route ErrorBoundary and replaced the
 * whole window: rail, sidebar and every other channel were gone until a reload.
 * The page now wraps the pane in `InlineErrorBoundary`, released by the room.
 *
 * Driven through the REAL page container (the shared fixture's preload
 * transport is the only fake). The crash is injected at the one seam every
 * history row passes through and the rail does not: formatting the ROW's
 * timestamp. Only a sentinel instant throws, so the rail (which formats the
 * conversation's `last_message_at`, a different instant) keeps working - and
 * the boundary does not care what threw. A malformed payload is not used: the
 * API schema drops such rows before they reach render.
 */
const SENTINEL = Date.parse("2001-02-03T04:05:06Z");
/* Every formatter built while this is installed throws for the sentinel only.
   A wrapper constructor, not a prototype patch: `format` is a bound getter on
   the real prototype and refuses a foreign receiver. */
const throwOnSentinel = () => {
	const Original = Intl.DateTimeFormat;
	const guard = (value) => {
		const at = value instanceof Date ? value.getTime() : Number(value);
		if (at === SENTINEL) throw new Error("injected pane render failure");
	};
	function Patched(...args) {
		const inner = new Original(...args);
		return new Proxy(inner, {
			get(target, property) {
				if (property === "format" || property === "formatToParts")
					return (value) => {
						guard(value);
						return target[property](value);
					};
				const own = target[property];
				return typeof own === "function" ? own.bind(target) : own;
			},
		});
	}
	Patched.supportedLocalesOf = Original.supportedLocalesOf;
	Intl.DateTimeFormat = Patched;
	return () => {
		Intl.DateTimeFormat = Original;
	};
};
process.env.TEAM_BRIDGE_PLAIN_MENUS = "1";
const { mount, ui, until } = await import(
	"./fixtures/team-bridge-auth-owner-page.mjs"
);

const person = (id, role = "member") => ({
	account_id: id,
	kind: "human",
	display_label: id,
	state: "active",
	role,
});

const channel = (id, name) => ({
	id,
	tenant_id: "org_shared",
	kind: "channel",
	name,
	visibility: "tenant",
	agent_capable: false,
	status: "open",
	created_by: "acct_a",
	last_message_at: "2026-10-23T12:00:00Z",
	latest_seq: 1,
	members: [person("acct_a", "owner")],
	member: true,
	last_read_seq: 1,
	unread_count: 0,
	muted: false,
	can_administer: true,
});

const msg = (conversationId, seq, body, patch = {}) => ({
	id: `msg_${conversationId}_${seq}`,
	conversation_id: conversationId,
	seq,
	sender: person("acct_b"),
	body,
	origin: "human",
	created_at: "2026-10-24T10:00:00Z",
	...patch,
});

const press = async (app, id) => {
	const button = [...app.host.querySelectorAll("button")].find(
		(b) => b.getAttribute("data-conversation-id") === id,
	);
	assert.ok(button, `rail row ${id}`);
	await act(async () => button.click());
};

test("a crash in one channel shows an inline error, keeps the rail, and the next channel renders", async () => {
	const app = await mount({ lifecycle: [] });
	const errors = [];
	const original = console.error;
	// React reports the caught error; keep the run's output readable.
	console.error = (...args) => errors.push(args.map(String).join(" "));
	const restore = [throwOnSentinel()];
	try {
		app.fixture.lifecycle = [
			channel("bcv_bad", "broken-room"),
			channel("bcv_good", "healthy-room"),
		];
		app.fixture.historyByConversation.set("bcv_bad", [
			msg("bcv_bad", 1, "never drawn", {
				created_at: "2001-02-03T04:05:06Z",
			}),
		]);
		app.fixture.historyByConversation.set("bcv_good", [
			msg("bcv_good", 1, "HEALTHY-ROOM-LINE"),
		]);
		await act(async () =>
			app.client.invalidateQueries({
				queryKey: ui.teamBridgeKeys.conversationsPrefix,
			}),
		);
		await until(
			() => app.host.querySelector('[data-conversation-id="bcv_bad"]'),
			"rail lists both channels",
		);
		await press(app, "bcv_bad");
		await until(
			() =>
				app.host.querySelector(
					'[data-testid="team-bridge-conversation-error"]',
				),
			"inline error in the pane",
		);
		const alert = app.host.querySelector(
			'[data-testid="team-bridge-conversation-error"]',
		);
		assert.equal(alert.getAttribute("role"), "alert");
		// The rest of the page is still mounted: the rail and its other channel.
		assert.ok(
			app.host.querySelector('[data-conversation-id="bcv_good"]'),
			"the rail survives the pane's crash",
		);
		assert.doesNotMatch(
			app.host.textContent,
			/Something went wrong.*Try again.*Reload/s,
			"not the route boundary's full-window fallback",
		);
		// Switching room releases the boundary: the next channel draws normally.
		await press(app, "bcv_good");
		await until(
			() => app.host.textContent.includes("HEALTHY-ROOM-LINE"),
			"healthy channel renders after the crash",
		);
		assert.equal(
			app.host.querySelector('[data-testid="team-bridge-conversation-error"]'),
			null,
			"the inline error is released on room change",
		);
		assert.ok(
			errors.some((line) => line.includes("injected pane render failure")),
			"the crash really happened (and was reported)",
		);
	} finally {
		for (const undo of restore) undo();
		console.error = original;
		await app.close();
	}
});
