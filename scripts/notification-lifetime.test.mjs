import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { collectGarbage } from "./gc-probe.mjs";

/*
 * THE LIFETIME REGISTRY'S CONTRACT, asserted against the shipped module rather
 * than a transcription of it (bundled in memory from `src/`, the house pattern
 * for main-process contracts).
 *
 * WHY EVERY PROBE FORCES A REAL COLLECTION. The property under test IS
 * collectability: a fix that retained nothing would pass any assertion that
 * only counts entries, and a regression that dropped the retention would pass
 * one that only clicks and checks the callback. `gc-probe.mjs` is the
 * instrument, and each `deref()` below is a reading from it — including the
 * control in the first test, which proves the instrument discriminates on the
 * object class this module exists for rather than trusting the collector to
 * always run.
 *
 * The fake models the real `Notification` at the two surfaces this module
 * uses: `once` (all three settle events are one-shot — a click cannot happen
 * twice on one delivered banner, and `close`/`failed` cannot follow a click)
 * and the emission itself, which the real EventEmitter supplies.
 */

const bundle = await build({
	stdin: {
		contents: 'export * from "./src/main/notification-lifetime";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { NotificationLifetime, NOTIFICATION_LIFETIME_BOUND } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** The two error shapes asserted below, hoisted so no regex is built per call. */
const ROUTING_ERROR = /routing exploded/;
const BOUND_ERROR = /positive integer/;

/** A `LifetimeNotification` double that records and fires its own settle events. */
function fakeNotification() {
	const listeners = new Map();
	return {
		once(event, listener) {
			const list = listeners.get(event) ?? [];
			list.push(listener);
			listeners.set(event, list);
		},
		emit(event) {
			const list = listeners.get(event) ?? [];
			listeners.delete(event);
			for (const listener of list) listener();
		},
		/** How many one-shot listeners this event carries — the count F1 is about. */
		listenerCount(event) {
			return (listeners.get(event) ?? []).length;
		},
	};
}

/**
 * Retain a fresh fake and answer ONLY a WeakRef: the local binding must not
 * survive, or the probe would be reading its own test frame rather than the
 * registry (the mistake the first cut of the notifier probe made, and the
 * reason the helper exists at all).
 */
function retained(lifetime, onClick = () => {}) {
	const notification = fakeNotification();
	lifetime.retain(notification, onClick);
	return new WeakRef(notification);
}

test("retention is what keeps a shown notification clickable", async () => {
	const lifetime = new NotificationLifetime();
	const kept = retained(lifetime);
	// Never retained, never rooted anywhere else: the control the whole probe
	// depends on. If this one survived the collection too, the instrument would
	// prove nothing about `kept`.
	const never = new WeakRef(fakeNotification());
	assert.equal(lifetime.size, 1, "one entry was registered");
	await collectGarbage();
	assert.notEqual(
		kept.deref(),
		undefined,
		"a retained notification must survive: a collected wrapper's click never runs (electron/electron#16922)",
	);
	assert.equal(
		never.deref(),
		undefined,
		"control: an un-retained notification is collectible, which is the defect this module exists for",
	);
});

test("a click runs the callback, settles the entry, and the notification becomes collectible", async () => {
	const lifetime = new NotificationLifetime();
	let clicked = 0;
	const ref = retained(lifetime, () => {
		clicked += 1;
	});
	ref.deref().emit("click");
	assert.equal(clicked, 1, "the routing callback ran");
	assert.equal(lifetime.size, 0, "a clicked entry leaves the registry");
	await collectGarbage();
	assert.equal(
		ref.deref(),
		undefined,
		"a clicked notification is released so the registry cannot grow without bound",
	);
});

test("a re-retain is a no-op: one listener, one fire, and the entry keeps its place", async () => {
	// F1 (review round 1): retaining a notification that is already live must
	// leave it exactly as it was. Two independent failures are pinned here. A
	// second `once("click")` would fire the callback twice on one click; and an
	// entry re-inserted into the FIFO would move to the newest slot, so the
	// bound would let go of the wrong (next-oldest) banner.
	const lifetime = new NotificationLifetime();
	const first = [];
	const second = [];
	const single = fakeNotification();
	lifetime.retain(single, () => first.push("fired"));
	lifetime.retain(single, () => second.push("fired"));
	assert.equal(single.listenerCount("click"), 1, "one click listener, not two");
	single.emit("click");
	assert.deepEqual(first, ["fired"], "the first callback ran, once");
	assert.deepEqual(second, [], "the re-retain's callback must never run");
	assert.equal(lifetime.size, 0, "the single entry settled");

	// The order half: A, B retained, then A re-retained, then C arrives at a
	// bound of 2. With the guard A is still the oldest entry and is the one let
	// go; a re-insert would have made A the newest and evicted B instead.
	const ordered = new NotificationLifetime(2);
	const aRef = retained(ordered);
	const bRef = retained(ordered);
	ordered.retain(aRef.deref(), () => {});
	const cRef = retained(ordered);
	assert.equal(ordered.size, 2, "the bound still caps the registry");
	await collectGarbage();
	assert.equal(
		aRef.deref(),
		undefined,
		"A was the oldest, so A gives up its handler — a re-retain must not move it to the newest slot",
	);
	assert.ok(bRef.deref() && cRef.deref(), "B and C are still clickable");
});

test("a throwing click callback still settles the entry", async () => {
	const lifetime = new NotificationLifetime();
	const ref = retained(lifetime, () => {
		throw new Error("routing exploded");
	});
	assert.throws(() => ref.deref().emit("click"), ROUTING_ERROR);
	assert.equal(
		lifetime.size,
		0,
		"the release runs in a finally: a broken route must not hold a dead handler until the bound reaps it",
	);
	await collectGarbage();
	assert.equal(ref.deref(), undefined);
});

test("a closed or failed notification is released without a click", async () => {
	for (const event of ["close", "failed"]) {
		const lifetime = new NotificationLifetime();
		const ref = retained(lifetime);
		ref.deref().emit(event);
		assert.equal(lifetime.size, 0, `${event} settles the entry`);
		await collectGarbage();
		assert.equal(
			ref.deref(),
			undefined,
			`a ${event} notification cannot serve a click any more, so it must not be held`,
		);
	}
});

test("the oldest entry gives up its handler at the bound", async () => {
	const lifetime = new NotificationLifetime(3);
	const refs = [];
	for (let index = 0; index < 5; index += 1) refs.push(retained(lifetime));
	assert.equal(lifetime.size, 3, "the bound caps the registry");
	await collectGarbage();
	assert.equal(
		refs[0].deref(),
		undefined,
		"the oldest entry is the one let go first",
	);
	assert.equal(refs[1].deref(), undefined);
	assert.ok(
		refs[2].deref() && refs[3].deref() && refs[4].deref(),
		"the newest entries are still clickable",
	);
});

test("the bound is validated at construction", () => {
	assert.ok(NOTIFICATION_LIFETIME_BOUND >= 1);
	for (const bad of [0, -1, 1.5, Number.NaN]) {
		assert.throws(
			() => new NotificationLifetime(bad),
			BOUND_ERROR,
			`bound ${String(bad)} must be refused rather than silently making the registry useless`,
		);
	}
});
