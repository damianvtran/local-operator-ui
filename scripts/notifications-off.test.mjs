import assert from "node:assert/strict";
import { test } from "node:test";
import {
	NOTIFICATIONS_ENV,
	withNotificationsOff,
} from "./notifications-off.mjs";

/*
 * `scripts/notifications-off.mjs`'s contract, at the level every app-spawning
 * harness consumes it: the object a rig hands `spawn` is the object this
 * function returns.
 *
 * The BEHAVIOURAL proof lives one level up, in
 * `run-desktop-tests.test.mjs`, which runs the real runner over a real test
 * file that reports the environment it actually received. This file pins the
 * defaulting rule itself, including the two shapes that harness run cannot
 * conveniently produce (an empty value, and a value other than `0`).
 *
 * `NOTIFICATIONS_ENV` is asserted against the literal rather than only used,
 * because a typo in the constant would disable the whole fix silently: the
 * backend reads this exact name and nothing in this repo would notice a
 * misspelling — the banners would simply keep arriving.
 */

test("the env name is the backend's own kill switch", () => {
	// `local_operator/tui/notify.py::_ENV_DISABLE`, read by
	// `notifications_enabled()`. Spelled out here on purpose: this is the one
	// place that can catch a rename that nothing else would.
	assert.equal(NOTIFICATIONS_ENV, "LOCAL_OPERATOR_NO_NOTIFICATIONS");
});

test("an absent value takes the default, and the object is returned", () => {
	const env = { HOME: "/tmp/scratch" };
	assert.equal(withNotificationsOff(env), env);
	assert.equal(env[NOTIFICATIONS_ENV], "1");
	// Nothing else about the caller's environment is touched: this wraps a
	// literal built from `process.env`, so a function that returned a copy would
	// silently drop the rig's own HOME/config/user-data overrides.
	assert.deepEqual(env, { HOME: "/tmp/scratch", [NOTIFICATIONS_ENV]: "1" });
});

test("an empty value takes the default too", () => {
	// `os.environ.get()` returns `""` here, which is FALSY in the backend's
	// `notifications_enabled()` — so an empty value already means "not
	// disabled", and honouring it as a deliberate choice would leave the banners
	// armed while looking like they had been turned off.
	assert.equal(
		withNotificationsOff({ [NOTIFICATIONS_ENV]: "" })[NOTIFICATIONS_ENV],
		"1",
	);
});

test("a value the caller set deliberately is never overwritten", () => {
	for (const value of ["0", "1", "yes", "0 "]) {
		const env = { [NOTIFICATIONS_ENV]: value };
		withNotificationsOff(env);
		assert.equal(env[NOTIFICATIONS_ENV], value);
	}
});
