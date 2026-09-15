import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync, existsSync, symlinkSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({ entryPoints: ["src/main/browser/extensions.ts"], bundle: true, platform: "node", format: "esm", write: false });
const { BrowserExtensionManager, inspectExtension } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const ID = "a".repeat(32);
function fixture(overrides = {}) {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "lo-extension-unit-")));
	const source = join(root, "source");
	mkdirSync(source);
	const manifest = { manifest_version: 3, name: "Fixture", version: "1.0", permissions: ["storage", "alarms"], host_permissions: ["https://example.com/*"], optional_permissions: ["tabs"], content_scripts: [{ matches: ["https://example.org/*"], js: ["content.js"] }], action: { default_popup: "popup.html" } };
	writeFileSync(join(source, "manifest.json"), JSON.stringify(manifest));
	const loaded = new Map();
	const calls = [];
	let approval = true;
	let chosen = source;
	const options = {
		dir: join(root, "browser"),
		runtime: {
			loadExtension: async (path, options) => { calls.push(["load", path, options]); loaded.set(ID, { id: ID }); return { id: ID }; },
			removeExtension: (id) => { calls.push(["unload", id]); loaded.delete(id); },
			getExtension: (id) => loaded.get(id),
		},
		chooseDirectory: async () => chosen,
		confirm: async (inspection) => { calls.push(["approve", inspection]); return approval; },
		openPopup: async (...args) => { calls.push(["popup", ...args]); },
		closePopup: (id) => { calls.push(["close-popup", id]); },
		...overrides,
	};
	const manager = new BrowserExtensionManager(options);
	return { root, source, manifest, options, manager, loaded, calls, approve: (next) => { approval = next; }, choose: (next) => { chosen = next; } };
}

test("approval precedes loading; stable registry reloads, disables and removes without deleting source", async () => {
	const f = fixture();
	await f.manager.start();
	assert.deepEqual(f.manager.list(), { rows: [], error: null });
	const installed = await f.manager.install();
	const row = installed.rows[0];
	assert.equal(row.loaded, true);
	assert.equal(row.path, f.source);
	assert.equal(f.calls[0][0], "approve");
	assert.deepEqual(f.calls[1], ["load", f.source, { allowFileAccess: false }]);
	assert.equal(statSync(f.manager.filePath).mode & 0o777, 0o600);
	assert.equal(statSync(join(f.root, "browser")).mode & 0o777, 0o700);
	await f.manager.openPopup(row.key);
	assert.ok(f.calls.some((call) => call[0] === "popup" && call[1] === ID));
	f.manager.stop();
	const restarted = new BrowserExtensionManager(f.options);
	await restarted.start();
	assert.equal(restarted.list().rows[0].id, row.id);
	assert.equal(restarted.list().rows[0].key, row.key);
	assert.equal(restarted.list().rows[0].loaded, true);
	await restarted.setEnabled(row.key, false);
	assert.equal(restarted.list().rows[0].loaded, false);
	assert.equal(restarted.list().rows[0].enabled, false);
	await assert.rejects(restarted.openPopup(row.key), /no loaded default popup/);
	await restarted.setEnabled(row.key, true);
	await restarted.remove(row.key);
	assert.deepEqual(restarted.list().rows, []);
	assert.equal(existsSync(join(f.source, "manifest.json")), true);
	assert.deepEqual(JSON.parse(readFileSync(f.manager.filePath, "utf8")).rows, []);
});

test("chooser cancellation and permission rejection never load or save", async () => {
	const f = fixture();
	f.choose(null); await f.manager.install();
	f.choose(f.source); f.approve(false); await f.manager.install();
	assert.equal(f.calls.filter((call) => call[0] === "load").length, 0);
	assert.equal(existsSync(f.manager.filePath), false);
	assert.deepEqual(f.manager.list().rows, []);
});

test("canonical paths deduplicate symlinks and manifest access includes optional/content-script requests", async () => {
	const f = fixture();
	const alias = join(f.root, "alias"); symlinkSync(f.source, alias);
	f.choose(alias);
	const row = (await f.manager.install()).rows[0];
	assert.equal(row.path, f.source);
	assert.ok(row.permissions.includes("Optional permission: tabs"));
	assert.ok(row.permissions.includes("Content scripts: https://example.org/*"));
	f.choose(f.source);
	await assert.rejects(f.manager.install(), /already registered/);
});

test("manifest edits fail closed across restart and require reviewed re-enable", async () => {
	const f = fixture();
	const row = (await f.manager.install()).rows[0];
	f.manager.stop();
	f.manifest.permissions.push("nativeMessaging");
	writeFileSync(join(f.source, "manifest.json"), JSON.stringify(f.manifest));
	const restarted = new BrowserExtensionManager(f.options); await restarted.start();
	assert.match(restarted.list().rows[0].error, /manifest changed/);
	assert.equal(restarted.list().rows[0].loaded, false);
	await restarted.setEnabled(row.key, false);
	f.approve(false); await restarted.setEnabled(row.key, true);
	assert.equal(restarted.list().rows[0].enabled, false);
	f.approve(true); await restarted.setEnabled(row.key, true);
	assert.equal(restarted.list().rows[0].loaded, true);
	assert.ok(restarted.list().rows[0].permissions.includes("Permission: nativeMessaging"));
});

test("corrupt registry is visible and cannot silently overwrite prior registrations", async () => {
	const f = fixture(); mkdirSync(f.options.dir);
	writeFileSync(f.manager.filePath, "broken JSON");
	await f.manager.start();
	assert.match(f.manager.list().error, /registry is unreadable/);
	await assert.rejects(f.manager.install(), /registry is unreadable/);
	assert.equal(readFileSync(f.manager.filePath, "utf8"), "broken JSON");
});

test("a directory with no manifest, and one that is gone, report a message a user can act on", async () => {
	/* Review round 1, R2: Node's own text reached the user here — `ENOENT: no such
	 * file or directory, stat '/…/manifest.json'` — where the doc promises "a
	 * message". The error still fails closed; only the copy moved. The second half
	 * is the same class one line up (a registration outliving its directory), and
	 * it is asserted here because the doc sentence covers both clauses at once. */
	const f = fixture();
	const bare = join(f.root, "bare"); mkdirSync(bare);
	f.choose(bare);
	// install() propagates the inspection failure: the sheet shows it as the
	// action's error, which is where a user met Node's sentence.
	await assert.rejects(f.manager.install(), (error) => {
		assert.match(error.message, /has no manifest\.json/);
		assert.doesNotMatch(error.message, /ENOENT/);
		return true;
	});
	assert.deepEqual(f.manager.list().rows, []);

	f.choose(f.source); await f.manager.install();
	rmSync(f.source, { recursive: true, force: true });
	// A restart is a fresh Chromium: the mock's loaded map is what the previous
	// process's session held, so emptying it models the next launch.
	f.loaded.clear();
	const restarted = new BrowserExtensionManager(f.options);
	await restarted.start();
	const gone = restarted.list().rows.find((row) => row.path === f.source);
	assert.equal(gone.loaded, false);
	assert.match(gone.error, /extension directory is missing/);
	assert.doesNotMatch(gone.error, /ENOENT/);
});

test("the registry file IS the approval record: a row written outside the app loads, with no dialog", async () => {
	/* This test asserts a GAP on purpose, and it exists to keep the doc's statement
	 * of it falsifiable. `docs/browser-extensions.md` ("What the registry actually
	 * trusts") says `<userData>/browser/extensions.json` is trusted as the record
	 * of approval: nothing signs it, so a process running as this user can write a
	 * row and have that directory loaded at the next start with no dialog. That is
	 * review round 1's R1, recorded as DEFERRED on PR #192 with the reasoning.
	 *
	 * If a change ever binds rows to their approval, this test fails, and the
	 * failure is the instruction: update that doc section, do not delete this case. */
	const f = fixture();
	mkdirSync(f.options.dir, { recursive: true });
	writeFileSync(f.manager.filePath, JSON.stringify({
		version: 1,
		rows: [{
			key: "11111111-1111-4111-8111-111111111111",
			path: f.source,
			name: "Hand-written",
			version: "1.0",
			enabled: true,
			id: null,
			digest: createHash("sha256").update(readFileSync(join(f.source, "manifest.json"))).digest("hex"),
			keyId: null,
			permissions: [],
			warnings: [],
			popupPath: null,
		},
	] }));
	let chooserCalls = 0;
	f.options.chooseDirectory = async () => { chooserCalls += 1; return null; };
	await f.manager.start();
	const row = f.manager.list().rows[0];
	assert.equal(f.manager.list().error, null);
	assert.equal(row.loaded, true);
	assert.deepEqual(f.calls.filter((call) => call[0] === "load"), [["load", f.source, { allowFileAccess: false }]]);
	assert.equal(f.calls.filter((call) => call[0] === "approve").length, 0);
	assert.equal(chooserCalls, 0);
});

test("failed load stays registered with an actionable error; missing IDs reject", async () => {
	const f = fixture(); f.options.runtime.loadExtension = async () => { throw new Error("Fixture runtime rejection"); };
	const state = await f.manager.install();
	assert.equal(state.rows[0].loaded, false);
	assert.equal(state.rows[0].enabled, true);
	assert.equal(state.rows[0].error, "Fixture runtime rejection");
	await assert.rejects(f.manager.remove("unknown"), /no longer exists/);
});

test("write failure prevents loading and registration changes", async () => {
	const f = fixture(); writeFileSync(f.options.dir, "not a directory");
	await assert.rejects(f.manager.install(), /Could not save/);
	assert.deepEqual(f.manager.list().rows, []);
	assert.equal(f.calls.filter((call) => call[0] === "load").length, 0);
});

test("concurrent install requests serialize native prompts and prevent duplicate registration", async () => {
	const f = fixture();
	const results = await Promise.allSettled([f.manager.install(), f.manager.install()]);
	assert.equal(results[0].status, "fulfilled");
	assert.equal(results[1].status, "rejected");
	assert.equal(f.manager.list().rows.length, 1);
});

test("manifest validation denies remote popup pages and warns on action-only extensions", () => {
	const f = fixture();
	f.manifest.action.default_popup = "https://example.com/";
	writeFileSync(join(f.source, "manifest.json"), JSON.stringify(f.manifest));
	assert.throws(() => inspectExtension(f.source), /inside the extension/);
	f.manifest.action = {};
	writeFileSync(join(f.source, "manifest.json"), JSON.stringify(f.manifest));
	const inspected = inspectExtension(f.source);
	assert.equal(inspected.popupPath, null);
	assert.ok(inspected.warnings.some((warning) => warning.includes("Action-click dispatch")));
});

test("keyed ID collision is rejected before loading can replace a prior extension", async () => {
	const f = fixture(); f.manifest.key = Buffer.from("fixture public key").toString("base64");
	writeFileSync(join(f.source, "manifest.json"), JSON.stringify(f.manifest));
	await f.manager.install();
	const second = join(f.root, "second"); mkdirSync(second);
	writeFileSync(join(second, "manifest.json"), JSON.stringify(f.manifest));
	f.choose(second);
	const state = await f.manager.install();
	assert.match(state.rows[1].error, /ID conflicts/);
	assert.equal(f.calls.filter((call) => call[0] === "load").length, 1);
	assert.equal(state.rows[0].loaded, true);
});
