/**
 * The fence around a Team Bridge owner read compares AUTHORITY, not the
 * identity of the cached status object.
 *
 *     node --test scripts/team-bridge-owner-fence.test.mjs
 *
 * WHY THIS FILE EXISTS. `readForBridgeOwner` reads the owner's status snapshot,
 * awaits the private read, then refuses the result if the status changed. It
 * used to compare the OBJECT it captured against whatever the status query held
 * afterwards. A status refetch (the query refetches on window focus) installs a
 * fresh object from the same authority — same account, same readiness, same
 * read-only posture. Structural sharing keeps the reference only for a
 * deep-equal answer, and the status payload's `checked_at` / `fetched_at` move
 * on every check, so every refetch is a different reference (the control test
 * below proves both halves). The
 * fence then threw "Team Bridge read authority changed" on a read that crossed
 * no authority change at all.
 *
 * The cost was not a transient failure: the owner-audit queries run `retry:
 * false` with `gcTime: 0` (their design: a private read is not retried over a
 * changed authority), so one spurious trip became a permanently rendered
 * "Audited messages could not be loaded." The section is the one place a human
 * audits their agent, so a false refusal there is the surface's worst failure.
 *
 * WHAT IS ASSERTED, and each one can falsify a different defect:
 *
 * 1. A CONTENT-ONLY refetch mid-read resolves. This is the regression; before
 *    the fix it rejected, and the assertion names the reference change so a
 *    future structural-sharing change cannot make this file pass vacuously.
 * 2. A control: an untouched snapshot resolves and returns the read's value.
 * 3. Every field in the authority set — account, state, read_only, local
 *    enabled — still rejects when it changes mid-read. The fence's purpose is
 *    unchanged: a read may not cross a genuine authority change.
 * 4. ALL ORGANIZATIONS: two per-organization reads in flight at once, one
 *    status refetch between them — both resolve on a content-only refetch,
 *    both refuse a genuine change. That is the shape the operator hit.
 * 5. A vanished status snapshot still refuses (via the read fence and via
 *    `captureBridgeStatusAuthority`, which the banner predicate calls bare).
 * 6. `bridgeOwnerCurrent` (the same field set, evaluated as a predicate) agrees
 *    with the fence: a content-only change stays "current", an authority change
 *    does not. Both call sites read the same projection, which is the point of
 *    extracting it — a second notion of "same authority" would drift here.
 *
 * WHAT IS MOCKED, stated so nobody reads more into a green run: the query cache
 * is a real `QueryClient` with the two authority rows seeded exactly as the app
 * holds them (the signed-in account and the Team Bridge status for it). No
 * transport, no backend and no window are involved: this file is evidence about
 * the fencing decision, never that the route answers.
 */

import assert from "node:assert/strict";
import Module from "node:module";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The shipped source, bundled the way the sibling team-bridge suites run it.
 * `react` stays external because the module calls hooks (never in this file) and
 * a second React copy would change nothing but the cost.
 */
const bundle = await build({
	stdin: {
		contents: `
			import * as owner from "./src/renderer/src/features/team-bridge/team-bridge-owner";
			export const { bridgeOwnerCurrent, readForBridgeOwner } = owner;
			/* Read off the namespace, not named: the pre-fix module has no such
			 * export, and a named re-export would fail the bundle instead of letting
			 * this file run its cases against that module as the RED reproduction. */
			export const captureBridgeStatusAuthority = owner["captureBridgeStatusAuthority"];
			export { teamBridgeKeys } from "./src/renderer/src/features/team-bridge/team-bridge-keys";
			export { radientUserKeys } from "./src/renderer/src/shared/hooks/radient-account-authority";
			export { QueryClient } from "@tanstack/react-query";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "cjs",
	platform: "node",
	external: ["react", "react-dom"],
	loader: { ".css": "empty" },
	tsconfig: "tsconfig.app.json",
	write: false,
});
const compiledPath = `${process.cwd()}/scripts/team-bridge-owner-fence-runtime.cjs`;
const compiled = new Module(compiledPath);
compiled.filename = compiledPath;
compiled.paths = Module._nodeModulePaths(process.cwd());
compiled._compile(bundle.outputFiles[0].text, compiled.filename);
const m = compiled.exports;

/* The two refusals are distinct facts: the scope assertion names a changed
 * ACCOUNT, the authority comparison names a changed STATUS. Pinned as module
 * constants (the house pattern beside the sibling suites, and what
 * `useTopLevelRegex` requires) so a test cannot silently match the wrong one.
 */
const OWNER_CHANGED = /Team Bridge read owner changed/;
const AUTHORITY_CHANGED = /Team Bridge read authority changed/;

const ACCOUNT = "acct_9f4c1e2d3a4b";
const OTHER_ACCOUNT = "acct_5b8e0c7a1d23";

/* The runtime's status payload as `GET /v1/desktop/team-bridge/status` serves
 * it (local-operator `server/routes/desktop_team_bridge.py`), reduced to the
 * fields this fence reads plus the ones that move on EVERY check of an
 * unchanged authority: `checked_at` / `fetched_at` (the check's own clock),
 * `from_cache`, and the `delivery_hold` count. Those are why a refetch is never
 * deep-equal to its predecessor, so React Query's structural sharing cannot keep
 * the old reference and an identity fence trips on every refetch. */
const CHECKED_AT = "2026-10-30T09:00:00.000Z";
const REFETCHED_AT = "2026-10-30T09:01:07.412Z";
const status = (overrides = {}) => ({
	capability: 3,
	state: "ready",
	boundary: null,
	from_cache: false,
	checked_at: CHECKED_AT,
	fetched_at: CHECKED_AT,
	account_id: ACCOUNT,
	tenant_id: "org_a1b2c3",
	surface_state: "C",
	visibility: {
		settings: true,
		inbox: true,
		account_door: true,
		onboarding: true,
	},
	update_required: false,
	local: { enabled: true, onboarding: "done", session: "sess_1" },
	status: null,
	consent: null,
	error: null,
	read_only: false,
	state_note: null,
	delivery_hold: null,
	...overrides,
});

/* What a focus refetch of an unchanged authority actually changes: the check
 * clock, and here the cache flag. Nothing in the authority set moves. */
const contentOnlyRefetch = (before) => ({
	...before,
	checked_at: REFETCHED_AT,
	fetched_at: REFETCHED_AT,
	from_cache: true,
});

const mount = () => {
	const client = new m.QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	/* What the app has already resolved before an audit read starts. */
	client.setQueryData(m.radientUserKeys.user(), {
		account: { id: ACCOUNT, email: "damian@gominerva.com" },
	});
	client.setQueryData(m.teamBridgeKeys.statusFor(ACCOUNT), status());
	return client;
};

const statusFor = (client) =>
	client.getQueryData(m.teamBridgeKeys.statusFor(ACCOUNT));

/* A status refetch the way the app's `useTeamBridgeStatus` performs one: the
 * query's own fetch path, so the answer goes through React Query's structural
 * sharing exactly as a focus refetch does. `setQueryData` would bypass nothing
 * here, but `fetchQuery` is the path that runs in the app. */
const refetchStatus = (client, payload) =>
	client.fetchQuery({
		queryKey: m.teamBridgeKeys.statusFor(ACCOUNT),
		queryFn: async () => payload,
		staleTime: 0,
	});

/** One read, with a status refetch landing while it is in flight. */
const readWithSwap = async (client, next) => {
	const before = statusFor(client);
	const result = await m.readForBridgeOwner(client, ACCOUNT, async () => {
		await refetchStatus(client, next(before));
		/* The scenario is only exercised if the cache really holds a new object:
		 * react-query's structural sharing returns the previous reference for a
		 * deeply equal payload, and that case was never broken. */
		assert.notEqual(
			statusFor(client),
			before,
			"the swap must install a new status object, or nothing was refetched",
		);
		return "audit-rows";
	});
	return result;
};

test("control: a deep-equal status refetch keeps the cached reference", async () => {
	/* Why the content-only case below needs `checked_at` to move: React Query's
	 * structural sharing hands back the SAME object for a deep-equal answer, so
	 * an identity fence only ever tripped on a refetch whose content changed —
	 * which, for this payload, is every refetch. */
	const client = mount();
	const before = statusFor(client);
	await refetchStatus(client, structuredClone(before));
	assert.equal(statusFor(client), before);
	await refetchStatus(client, contentOnlyRefetch(before));
	assert.notEqual(statusFor(client), before);
	client.clear();
});

test("a content-only status refetch mid-read resolves", async () => {
	const client = mount();
	/* Same account, state, read-only posture and local availability; only the
	 * check clock and cache flag move, exactly as a real refetch. */
	const result = await readWithSwap(client, contentOnlyRefetch);
	assert.equal(result, "audit-rows");
	/* The predicate the app uses to decide "is this read still mine" must agree
	 * with the fence it shares its field set with. */
	assert.equal(m.bridgeOwnerCurrent(client, ACCOUNT), true);
	client.clear();
});

test("an untouched status snapshot resolves and returns the read's value", async () => {
	const client = mount();
	const before = statusFor(client);
	const result = await m.readForBridgeOwner(client, ACCOUNT, async () => {
		assert.equal(statusFor(client), before);
		return "audit-rows";
	});
	assert.equal(result, "audit-rows");
	client.clear();
});

test("a mid-read account change still rejects", async () => {
	const client = mount();
	await assert.rejects(
		readWithSwap(client, (before) => ({
			...before,
			account_id: OTHER_ACCOUNT,
		})),
		OWNER_CHANGED,
	);
	client.clear();
});

for (const [field, next] of [
	["state", (before) => ({ ...before, state: "unavailable" })],
	["read_only", (before) => ({ ...before, read_only: true })],
	[
		"local.enabled",
		(before) => ({ ...before, local: { ...before.local, enabled: false } }),
	],
]) {
	test(`a mid-read ${field} change still rejects`, async () => {
		const client = mount();
		await assert.rejects(readWithSwap(client, next), AUTHORITY_CHANGED);
		assert.equal(m.bridgeOwnerCurrent(client, ACCOUNT), false);
		client.clear();
	});
}

test("the status snapshot vanishing mid-read still rejects", async () => {
	/* A removed row is "no authority on record", never "unchanged". The owner
	 * assertion (account) runs first and is the one that names it. */
	const client = mount();
	await assert.rejects(
		m.readForBridgeOwner(client, ACCOUNT, async () => {
			client.removeQueries({ queryKey: m.teamBridgeKeys.statusFor(ACCOUNT) });
			return "audit-rows";
		}),
		OWNER_CHANGED,
	);
	client.clear();
});

test("captureBridgeStatusAuthority: a vanished snapshot counts as changed", () => {
	/* The banner delivery predicate calls the capture directly, without the
	 * owner assertion in front of it, so its own vanish answer must be false. */
	const client = mount();
	const holds = m.captureBridgeStatusAuthority(client, ACCOUNT);
	assert.equal(holds(), true);
	client.removeQueries({ queryKey: m.teamBridgeKeys.statusFor(ACCOUNT) });
	assert.equal(holds(), false);
	client.clear();
});

/*
 * ALL ORGANIZATIONS: the rail mounts one audit read PER ORGANIZATION, all keyed
 * on the same account's status row, all in flight at once. One status refetch
 * landing while they are out is every read's problem at the same time — on the
 * identity fence it refused all of them, so the operator saw the error under
 * every organization heading. Both reads must resolve on a content-only
 * refetch, and both must still refuse a genuine change.
 */
const concurrentOrgReads = async (client, next) => {
	let releaseA;
	let releaseB;
	const gateA = new Promise((resolve) => {
		releaseA = resolve;
	});
	const gateB = new Promise((resolve) => {
		releaseB = resolve;
	});
	const reads = [
		m.readForBridgeOwner(client, ACCOUNT, async () => {
			await gateA;
			return "org_a-rows";
		}),
		m.readForBridgeOwner(client, ACCOUNT, async () => {
			await gateB;
			return "org_b-rows";
		}),
	];
	/* Both reads have captured their snapshot; the refetch lands between. */
	const before = statusFor(client);
	await refetchStatus(client, next(before));
	assert.notEqual(statusFor(client), before);
	releaseA();
	releaseB();
	return Promise.allSettled(reads);
};

test("all organizations: two concurrent org reads survive a content-only refetch", async () => {
	const client = mount();
	const settled = await concurrentOrgReads(client, contentOnlyRefetch);
	assert.deepEqual(
		settled.map((entry) =>
			entry.status === "fulfilled" ? entry.value : String(entry.reason),
		),
		["org_a-rows", "org_b-rows"],
	);
	client.clear();
});

test("all organizations: two concurrent org reads both refuse a genuine change", async () => {
	const client = mount();
	const settled = await concurrentOrgReads(client, (before) => ({
		...contentOnlyRefetch(before),
		state: "unavailable",
	}));
	assert.deepEqual(
		settled.map((entry) => entry.status),
		["rejected", "rejected"],
	);
	for (const entry of settled)
		assert.match(entry.reason.message, AUTHORITY_CHANGED);
	client.clear();
});
