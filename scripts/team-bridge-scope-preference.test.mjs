import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/**
 * The opening-scope decision and its stored preference, executed through esbuild
 * so the test runs the SAME TypeScript the renderer bundles - the house pattern
 * beside `team-bridge-scope.test.mjs`. No DOM, no backend: both subjects are
 * pure functions, so a regression here is a pure function change.
 *
 * WHY THE TWO ARE TESTED TOGETHER. The operator's rule is "one organization ->
 * that organization; several -> the last-used choice". The stored value is one
 * INPUT to that decision, and the failures that matter are precedence ones - a
 * stored value outranking a deep link, or a single organization losing to a
 * stored "all" - which no test of either half alone can see.
 */
const bundle = await build({
	stdin: {
		contents: `export * from "./src/renderer/src/features/team-bridge/team-bridge-scope-preference";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	write: false,
});
const scope = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const ALL = "all";
const KEY = scope.SCOPE_PREFERENCE_KEY;

/** The only two Storage methods the module is allowed to use. */
function fakeStorage(initial) {
	const map = new Map(
		initial === undefined ? [] : [[KEY, JSON.stringify(initial)]],
	);
	return {
		map,
		getItem: (key) => (map.has(key) ? map.get(key) : null),
		setItem: (key, value) => void map.set(key, String(value)),
	};
}

const org = (tenantId, name = tenantId) => ({
	tenantId,
	name,
	role: "member",
	unread: 0,
});
const orgs = (...ids) => ids.map((id) => org(id));

test("a stored scope is read only for the account that stored it", () => {
	const storage = fakeStorage({ "acct-1": "tnt_1", "acct-2": "tnt_2" });
	assert.equal(scope.readScopePreference(storage, "acct-1"), "tnt_1");
	assert.equal(scope.readScopePreference(storage, "acct-2"), "tnt_2");
	assert.equal(scope.readScopePreference(storage, "acct-3"), undefined);
});

test("nothing stored, or no entry, is undefined rather than a scope", () => {
	assert.equal(scope.readScopePreference(fakeStorage(), "acct-1"), undefined);
	assert.equal(scope.readScopePreference(fakeStorage({}), "acct-1"), undefined);
});

test("the union sentinel round-trips as itself", () => {
	const storage = fakeStorage({ "acct-1": ALL });
	assert.equal(scope.readScopePreference(storage, "acct-1"), ALL);
});

test("a corrupt entry yields undefined and never throws", () => {
	const cases = [
		"not json at all",
		"null",
		"[]",
		'"tnt_1"',
		JSON.stringify({ "acct-1": 42 }),
		JSON.stringify({ "acct-1": "" }),
		JSON.stringify({ "acct-1": "   " }),
		JSON.stringify({ "acct-1": "t".repeat(129) }),
	];
	for (const raw of cases) {
		const storage = {
			getItem: () => raw,
			setItem: () => {},
		};
		assert.doesNotThrow(() => scope.readScopePreference(storage, "acct-1"));
		assert.equal(scope.readScopePreference(storage, "acct-1"), undefined, raw);
	}
});

test("a pick is written for one account and keeps every other entry", () => {
	const storage = fakeStorage({ "acct-other": "tnt_9" });
	scope.writeScopePreference(storage, "acct-1", "tnt_1");
	scope.writeScopePreference(storage, "acct-1", ALL);
	assert.deepEqual(JSON.parse(storage.map.get(KEY)), {
		"acct-other": "tnt_9",
		"acct-1": ALL,
	});
});

test("a store that refuses writes costs only the preference", () => {
	const storage = {
		getItem: () => null,
		setItem: () => {
			throw new Error("quota exceeded");
		},
	};
	assert.doesNotThrow(() =>
		scope.writeScopePreference(storage, "acct-1", "tnt_1"),
	);
});

test("a deep link outranks every stored or chosen scope", () => {
	assert.equal(
		scope.resolveOpeningScope({
			organizations: orgs("tnt_1", "tnt_2"),
			stored: "tnt_2",
			requestedTenant: "tnt_1",
			chosen: true,
			current: "tnt_2",
			snapshotRows: [{ tenant_id: "tnt_2" }],
		}),
		"tnt_1",
	);
});

test("a scope the reader picked this session outranks the stored default", () => {
	assert.equal(
		scope.resolveOpeningScope({
			organizations: orgs("tnt_1", "tnt_2"),
			stored: "tnt_2",
			chosen: true,
			current: ALL,
		}),
		ALL,
	);
});

test("one organization wins over a stored value, both 'all' and an org", () => {
	const organizations = orgs("tnt_1");
	for (const stored of [ALL, "tnt_1", "tnt_gone", undefined]) {
		assert.equal(
			scope.resolveOpeningScope({
				organizations,
				stored,
				chosen: false,
				current: stored ?? ALL,
			}),
			"tnt_1",
			`stored=${stored}`,
		);
	}
});

test("a stored organization that is still a membership is the landing", () => {
	assert.equal(
		scope.resolveOpeningScope({
			organizations: orgs("tnt_1", "tnt_2", "tnt_3"),
			stored: "tnt_2",
			chosen: false,
			current: "tnt_2",
		}),
		"tnt_2",
	);
});

test("several organizations with nothing stored lands on the union", () => {
	assert.equal(
		scope.resolveOpeningScope({
			organizations: orgs("tnt_1", "tnt_2"),
			stored: undefined,
			chosen: false,
			current: ALL,
		}),
		ALL,
	);
});

test("a revoked organization corrects to the union, never to the first org", () => {
	assert.equal(
		scope.resolveOpeningScope({
			organizations: orgs("tnt_1", "tnt_2"),
			stored: "tnt_gone",
			chosen: false,
			current: "tnt_gone",
		}),
		ALL,
	);
});

test("before the organization list answers, the snapshot may pick the one org", () => {
	assert.equal(
		scope.resolveOpeningScope({
			organizations: [],
			chosen: false,
			current: ALL,
			snapshotRows: [{ tenant_id: "tnt_1" }, { tenant_id: "tnt_1" }],
		}),
		"tnt_1",
	);
	assert.equal(
		scope.resolveOpeningScope({
			organizations: [],
			chosen: false,
			current: ALL,
			snapshotRows: [{ tenant_id: "tnt_1" }, { tenant_id: "tnt_2" }],
		}),
		ALL,
	);
});

test("while the list is still pending, a seeded choice is left alone", () => {
	assert.equal(
		scope.resolveOpeningScope({
			organizations: [],
			stored: "tnt_2",
			chosen: false,
			current: "tnt_2",
		}),
		"tnt_2",
	);
});

test("the snapshot never outranks the organization list", () => {
	assert.equal(
		scope.resolveOpeningScope({
			organizations: orgs("tnt_1"),
			chosen: false,
			current: "tnt_2",
			snapshotRows: [{ tenant_id: "tnt_2" }],
		}),
		"tnt_1",
	);
});
