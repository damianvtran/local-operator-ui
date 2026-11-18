/**
 * Team Bridge held messages: the rules the owner relies on when releasing one.
 *
 *     node --test scripts/team-bridge-holds.test.mjs
 *
 * Run from the SHIPPED source (esbuild in memory, as
 * `team-bridge-approvals.test.mjs` does), so these assert the code the app
 * runs rather than a restatement of it.
 *
 * What each block guards (local-operator B4b, operator decision a-3f46):
 * 1. Every hold kind on the operator's machine (model_hold, work_scope_hold,
 *    write_once_conflict, plus #4212's screening_failed and an unknown code)
 *    reads as a plain reason, never the machine word.
 * 2. Deliver appears ONLY when `can_deliver` is true and Discard only when
 *    `can_discard` is true; a recorded decision offers neither.
 * 3. The badge counts holds the owner can act on and nothing else.
 * 4. The wire: the three ops reach their routes with the strict bodies, the
 *    tenant guard exempts them, and the list parse keeps optional fields
 *    optional and drops unknown keys.
 * 5. The decide binds the hash of the SHOWN body, and refuses to arm when the
 *    server's hash disagrees.
 *
 * WHAT IT DOES NOT PROVE: that the daemon answers, or any pixel. Those are the
 * Storybook frames' and the live daemon's job.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { build } from "esbuild";

async function load(contents) {
	const bundle = await build({
		stdin: { contents, resolveDir: process.cwd() },
		bundle: true,
		format: "esm",
		platform: "neutral",
		mainFields: ["module", "main"],
		conditions: ["import"],
		loader: { ".css": "empty" },
		jsx: "automatic",
		write: false,
	});
	return import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);
}

const m = await load(
	`export * from "./src/renderer/src/features/team-bridge/team-bridge-holds-model";`,
);
const c = await load(`export * from "./src/shared/desktop-contract";`);
const api = await load(
	`export * from "./src/renderer/src/shared/api/local-operator/team-bridge-holds-api";`,
);

// Top-level regexes (biome useTopLevelRegex).
const RE_PLATFORM = /Touch ID|Mac|Windows|biometric/i;

const NOW = Date.parse("2026-11-18T12:00:00Z");
const hold = (over = {}) => ({
	message_id: "bcmsg_1",
	conversation_id: "bcv_abcdefgh",
	seq: 4,
	held_at: "2026-11-01T10:00:00Z",
	kind: "owner_decision",
	hold_code: "model_hold",
	releasable: true,
	can_deliver: true,
	can_discard: true,
	deliver_until: "2026-11-25T10:00:00Z",
	decision: null,
	...over,
});

test("every hold kind on the operator's machine reads as a plain reason", () => {
	const cases = {
		model_hold: "review",
		work_scope_hold: "new_work",
		write_once_conflict: "records",
		screening_failed: "not_screened",
		screening_model_unavailable: "no_screener",
		reply_truncated: "unclear",
	};
	for (const [code, reason] of Object.entries(cases)) {
		assert.equal(m.holdReason(hold({ hold_code: code })), reason, code);
		const label = m.holdReasonLabel(reason);
		assert.ok(label.length > 0 && !label.includes(code), code);
		assert.ok(!label.startsWith("ui."), `${code} copy is keyed`);
	}
});

test("an unknown code falls back on the kind, then on the generic reason", () => {
	assert.equal(
		m.holdReason({ hold_code: "brand_new", kind: "waiting" }),
		"waiting",
	);
	assert.equal(
		m.holdReason({ hold_code: "unknown_hold", kind: "screening" }),
		"unclear",
	);
	assert.equal(
		m.holdReason({ hold_code: "brand_new", kind: "brand_new" }),
		"other",
	);
});

test("Deliver only on can_deliver, Discard only on can_discard", () => {
	assert.deepEqual(m.holdAffordance(hold(), NOW), {
		state: "open",
		deliver: true,
		discard: true,
	});
	// #4212 screening_failed: releasable, Discard-only, window not past.
	assert.deepEqual(
		m.holdAffordance(
			hold({ hold_code: "screening_failed", can_deliver: false }),
			NOW,
		),
		{ state: "open", deliver: false, discard: true },
	);
	// Past the window: Discard only, and it says why.
	assert.deepEqual(
		m.holdAffordance(
			hold({ can_deliver: false, deliver_until: "2026-11-08T10:00:00Z" }),
			NOW,
		),
		{ state: "deliver_expired", deliver: false, discard: true },
	);
	// Not releasable (write_once_conflict on the operator's machine): no buttons.
	assert.deepEqual(
		m.holdAffordance(
			hold({
				kind: "waiting",
				hold_code: "write_once_conflict",
				releasable: false,
				can_deliver: false,
				can_discard: false,
				deliver_until: null,
			}),
			NOW,
		),
		{ state: "not_releasable" },
	);
	// A daemon that says can_deliver but not releasable is still believed on
	// the button; the renderer never invents or removes one.
	assert.equal(
		m.holdAffordance(hold({ releasable: false }), NOW).deliver,
		true,
	);
});

test("a recorded decision offers no button, whatever the flags say", () => {
	const decided = hold({
		decision: {
			word: "discard",
			decided_at: "2026-11-02T00:00:00Z",
			outcome: "pending",
			key_id: "k",
		},
	});
	assert.deepEqual(m.holdAffordance(decided, NOW), {
		state: "decided",
		word: "discard",
		outcome: "pending",
	});
});

test("the badge counts only holds the owner can act on", () => {
	const page = {
		items: [
			hold({ message_id: "bcmsg_a" }),
			hold({ message_id: "bcmsg_b", can_deliver: false }),
			hold({
				message_id: "bcmsg_c",
				releasable: false,
				can_deliver: false,
				can_discard: false,
			}),
			hold({
				message_id: "bcmsg_d",
				decision: {
					word: "deliver",
					decided_at: null,
					outcome: "pending",
					key_id: null,
				},
			}),
		],
	};
	assert.equal(m.actionableHoldCount(page), 2);
	assert.equal(m.actionableHoldCount(undefined), 0);
	assert.equal(m.actionableHoldCount({ items: [] }), 0);
});

test("refusals map to fixed copy by code; unknown codes read generically", () => {
	const generic = m.holdRefusalLabel("never_heard_of_it");
	assert.equal(m.holdRefusalLabel(null), generic);
	for (const code of [
		"hold_release_off",
		"hold_not_releasable",
		"snapshot_stale",
		"already_decided",
		"deliver_expired",
		"release_signing_unavailable",
	]) {
		const label = m.holdRefusalLabel(code);
		assert.notEqual(label, generic, code);
		assert.ok(!label.includes(code), code);
	}
	// Device-neutral: no platform or biometric name in the signing refusal.
	assert.doesNotMatch(
		m.holdRefusalLabel("release_signing_unavailable"),
		RE_PLATFORM,
	);
});

test("the decide binds the hash of the shown body", async () => {
	const body = "Can your agent draft the Q4 plan? ünïcode";
	const hex = createHash("sha256").update(body, "utf8").digest("hex");
	assert.equal(await m.shownBodySha256(body, hex), hex);
	assert.equal(await m.shownBodySha256(body, null), hex);
	// The server's hash disagrees with what is shown: never arm a button.
	assert.equal(await m.shownBodySha256(body, "0".repeat(64)), null);
	// No body shown: only a well-formed server hash is usable.
	assert.equal(await m.shownBodySha256(null, hex), hex);
	assert.equal(await m.shownBodySha256(null, "sha256:abc"), null);
	assert.equal(await m.shownBodySha256(undefined, undefined), null);
});

test("the three hold ops reach their routes with the strict bodies", () => {
	const list = c.desktopEndpoint({
		op: "team_bridge.holds.list",
		expected_account_id: "acct_1",
	});
	assert.equal(list.method, "GET");
	assert.equal(
		list.path,
		"/v1/desktop/team-bridge/holds?expected_account_id=acct_1",
	);
	const sha = "a".repeat(64);
	for (const word of ["deliver", "discard"]) {
		const request = {
			op: `team_bridge.holds.${word}`,
			expected_account_id: "acct_1",
			message_id: "bcmsg_1",
			conversation_id: "bcv_abcdefgh",
			body_sha256: sha,
		};
		assert.equal(c.desktopRequestSchema.safeParse(request).success, true);
		const endpoint = c.desktopEndpoint(request);
		assert.equal(endpoint.method, "POST");
		assert.equal(
			endpoint.path,
			`/v1/desktop/team-bridge/holds/bcmsg_1/${word}`,
		);
		assert.deepEqual(endpoint.body, {
			expected_account_id: "acct_1",
			conversation_id: "bcv_abcdefgh",
			body_sha256: sha,
		});
	}
});

test("the hold ops refuse malformed input before IPC", () => {
	const base = {
		op: "team_bridge.holds.deliver",
		expected_account_id: "acct_1",
		message_id: "bcmsg_1",
		conversation_id: "bcv_abcdefgh",
		body_sha256: "a".repeat(64),
	};
	const parse = (over) =>
		c.desktopRequestSchema.safeParse({ ...base, ...over }).success;
	assert.equal(parse({ body_sha256: "A".repeat(64) }), false);
	assert.equal(parse({ body_sha256: "a".repeat(63) }), false);
	assert.equal(parse({ message_id: "../x" }), false);
	assert.equal(parse({ tenant_id: "tnt_1" }), false);
	assert.equal(
		c.desktopRequestSchema.safeParse({
			op: "team_bridge.holds.list",
			expected_account_id: "acct_1",
			after: "x",
		}).success,
		false,
	);
});

test("the list parse keeps optional fields optional and drops unknown keys", () => {
	const wire = {
		enabled: true,
		key_protection: "keychain",
		items: [
			{ ...hold(), body: "LEAK", reason: "LEAK" },
			{
				...hold({ message_id: "bcmsg_2", hold_code: "screening_failed" }),
				unscreened: true,
			},
		],
	};
	const page = api.parseHoldsPage(wire);
	assert.equal(page.items.length, 2);
	assert.equal("body" in page.items[0], false);
	assert.equal("reason" in page.items[0], false);
	assert.equal(page.items[0].unscreened, undefined);
	assert.equal(page.items[1].unscreened, true);
	// An older core without `key_protection` still parses.
	const { key_protection: _drop, ...older } = wire;
	assert.equal(api.parseHoldsPage(older).key_protection, null);
	// A missing required flag fails the read rather than inventing a button.
	const { can_deliver: _cd, ...broken } = hold();
	assert.throws(() => api.parseHoldsPage({ enabled: true, items: [broken] }));
});
