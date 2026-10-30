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
 * read-only posture — and any field outside the authority set differing (a
 * session id, a server note) makes that new object a different reference. The
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
 * 4. `bridgeOwnerCurrent` (the same field set, evaluated as a predicate) agrees
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
			export { bridgeOwnerCurrent, readForBridgeOwner } from "./src/renderer/src/features/team-bridge/team-bridge-owner";
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

/* The runtime's status payload, reduced to the fields this fence reads plus one
 * outside the authority set: `state_note` is server prose that changes between
 * refetches of an unchanged authority, which is the realistic content-only delta
 * (a session id rotates the same way). */
const status = (overrides = {}) => ({
	capability: 3,
	state: "ready",
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
	...overrides,
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

/** One read, with the status query's cache replaced while it is in flight. */
const readWithSwap = async (client, next) => {
	const before = statusFor(client);
	const result = await m.readForBridgeOwner(client, ACCOUNT, async () => {
		client.setQueryData(m.teamBridgeKeys.statusFor(ACCOUNT), next(before));
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

test("a content-only status refetch mid-read resolves", async () => {
	const client = mount();
	const result = await readWithSwap(client, (before) => ({
		...before,
		/* Same account, state, read-only posture and local availability. */
		local: { ...before.local, session: "sess_2" },
		state_note: "runtime restarted",
	}));
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
