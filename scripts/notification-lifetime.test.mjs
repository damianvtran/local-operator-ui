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

/** A `LifetimeNotification` double that records and fires its own settle events. */
function fakeNotification() {
	const listeners = new Map();
	return {
		once(event, listener) {
			listeners.set(event, listener);
		},
		emit(event) {
			const listener = listeners.get(event);
			listeners.delete(event);
			listener?.();
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

test("a throwing click callback still settles the entry", async () => {
	const lifetime = new NotificationLifetime();
	const ref = retained(lifetime, () => {
		throw new Error("routing exploded");
	});
	assert.throws(() => ref.deref().emit("click"), /routing exploded/);
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
			/positive integer/,
			`bound ${String(bad)} must be refused rather than silently making the registry useless`,
		);
	}
});
