// lop://extensions and the PR #1821 round-1 remediation rules that are pure or
// near-pure: internal-page URL parsing and its nonce document mapping, the
// agent refusal in registry.requireSurface, the extension-subframe policy
// (R1-4), plain-language permissions (D3), the update-check sentence (U2),
// extension value-store removal (Q1) and the unpacked-size cap (R1-6).
// Shipped TypeScript is bundled in memory with esbuild, as the other
// extension-*.test.mjs files do.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { build } from "esbuild";

const require = createRequire(import.meta.url);

async function load(contents, extra = {}) {
	const compiled = await build({
		stdin: { contents, resolveDir: process.cwd() },
		bundle: true,
		platform: "node",
		format: "cjs",
		external: ["electron", "electron-chrome-extensions"],
		alias: { "@shared": `${process.cwd()}/src/renderer/src/shared` },
		write: false,
		logLevel: "silent",
		...extra,
	});
	const module = { exports: {} };
	vm.runInNewContext(compiled.outputFiles[0].text, {
		module,
		exports: module.exports,
		process,
		Buffer,
		URL,
		console,
		setTimeout,
		clearTimeout,
		setImmediate,
		queueMicrotask,
		TextDecoder,
		TextEncoder,
		AbortController,
		AbortSignal,
		performance,
		require: (name) =>
			name === "electron"
				? { BrowserWindow: class {}, app: { getPath: () => tmpdir() } }
				: name === "electron-chrome-extensions"
					? { ElectronChromeExtensions: class {} }
					: require(name),
	});
	return module.exports;
}

const ID = "aeblfdkhhhdcdjpifhhbdiojplfjncoa";

const pages = await load(`
	export * from "./src/shared/internal-pages";
	export * as main from "./src/main/browser/internal-pages";
	export * from "./src/main/browser/extensions/subframe-policy";
	export { describePermissions } from "./src/shared/browser-extensions";
`);

test("internal URLs: exact grammar, chrome:// alias canonicalises, nothing else parses", () => {
	const { parseInternalUrl, internalUrlOf } = pages;
	assert.deepEqual(
		{ ...parseInternalUrl("lop://extensions") },
		{
			page: "extensions",
			id: null,
		},
	);
	assert.deepEqual(
		{ ...parseInternalUrl(" LOP://extensions/ ") },
		{
			page: "extensions",
			id: null,
		},
	);
	assert.equal(
		internalUrlOf(parseInternalUrl(`chrome://extensions/?id=${ID}`)),
		`lop://extensions?id=${ID}`,
	);
	for (const bad of [
		"lop://extensionsX",
		"lop://extensions/../settings",
		"lop://extensions?id=../../etc",
		`lop://extensions?id=${ID}&x=1`,
		"lop://settings",
		"https://lop//extensions",
		"about:blank#lop://extensions",
		null,
		42,
	])
		assert.equal(parseInternalUrl(bad), null, String(bad));
});

test("main maps only its own nonce document to a page; agents/projections see lop://", () => {
	const { main } = pages;
	const page = { page: "extensions", id: ID };
	const document = main.internalDocumentUrl(page);
	assert.match(
		document,
		/^about:blank#lop-[0-9a-f]{32}:lop:\/\/extensions\?id=/,
	);
	assert.deepEqual({ ...main.internalPageOfDocument(document) }, page);
	assert.equal(main.displayUrlOf(document), `lop://extensions?id=${ID}`);
	// A guessed or stale-process nonce names nothing.
	assert.equal(
		main.internalPageOfDocument(
			`about:blank#lop-${"0".repeat(32)}:lop://extensions`,
		),
		null,
	);
	assert.equal(main.internalPageOfDocument("about:blank"), null);
	assert.equal(
		main.displayUrlOf("https://example.com/"),
		"https://example.com/",
	);
});

test("R1-4: agent tabs refuse extension subframes; user tabs keep them; hand-over reloads only when needed", () => {
	const { refusesExtensionSubframe, mustReloadOnOwnerChange } = pages;
	const ext = `chrome-extension://${ID}/inline/menu.html`;
	const cases = [
		// owner, isMainFrame, url, refused
		["agent", false, ext, true],
		[undefined, false, ext, true],
		["user", false, ext, false],
		["agent", true, ext, false],
		["agent", false, "https://example.com/", false],
		["user", false, "https://example.com/", false],
		["agent", false, "CHROME-EXTENSION://x/", true],
	];
	for (const [owner, isMainFrame, url, refused] of cases)
		assert.equal(
			refusesExtensionSubframe({ owner, isMainFrame, url }),
			refused,
			`${owner}/${isMainFrame}/${url}`,
		);
	assert.equal(
		mustReloadOnOwnerChange("agent", ["https://a.test/", ext]),
		true,
	);
	assert.equal(mustReloadOnOwnerChange("agent", ["https://a.test/"]), false);
	assert.equal(mustReloadOnOwnerChange("user", [ext]), false);
});

test("D3: Chrome's warning wording, silent permissions omitted, denied capabilities listed as blocked", () => {
	const summary = pages.describePermissions([
		"tabs",
		"history",
		"storage",
		"nativeMessaging",
		"notifications",
		"privacy",
		"declarativeNetRequestWithHostAccess",
		"someNewApi",
	]);
	assert.deepEqual(
		[...summary.labels],
		[
			"ui.browser.extensions.permission_history",
			"ui.browser.extensions.permission_privacy",
			"ui.browser.extensions.permission_block_content",
		],
	);
	assert.deepEqual([...summary.blocked], ["desktop_apps", "notifications"]);
	assert.deepEqual([...summary.other], ["someNewApi"]);
	// Every label key exists in the English catalogue.
	const en = require(
		`${process.cwd()}/src/i18n/catalogues/en/ui.browser.extensions.json`,
	);
	for (const key of summary.labels) assert.ok(en[key], key);
});

test("agents cannot resolve a tab showing lop://extensions or an extension's own page", async () => {
	const registryModule = await load(`
		export { TabRegistry, surfaceToken } from "./src/main/browser/registry";
		export { internalDocumentUrl } from "./src/main/browser/internal-pages";
	`);
	const views = new Map();
	const registry = new registryModule.TabRegistry(
		(_options, tabId) => {
			const view = {
				url: "https://example.com/",
				webContents: {
					id: tabId + 1000,
					getURL: () => view.url,
					getTitle: () => "",
					isDestroyed: () => false,
					on() {},
					once() {},
					removeListener() {},
					setAudioMuted() {},
				},
				setVisible() {},
				setBounds() {},
			};
			views.set(tabId, view);
			return view;
		},
		() => {},
		() => {},
	);
	const record = registry.create({ owner: "agent", sessionId: "s1" });
	const token = registryModule.surfaceToken(record);
	assert.equal(registry.requireSurface(token), record);
	views.get(record.tabId).url = registryModule.internalDocumentUrl({
		page: "extensions",
		id: null,
	});
	assert.throws(
		() => registry.requireSurface(token),
		(error) =>
			error.code === "owner_refused" && error.data?.reason === "internal_page",
	);
	// Projections never carry the nonce document or its URL-as-title.
	const [row] = registry.snapshot();
	assert.equal(row.url, "lop://extensions");
	assert.equal(row.title, "");
	views.get(record.tabId).url = `chrome-extension://${ID}/app/app.html`;
	assert.throws(
		() => registry.requireSurface(token),
		(error) => error.code === "owner_refused",
	);
});

test("U2: the update sentence never says up to date when a check failed or an update waits", async () => {
	const hook = await load(
		`export { updateReportMessage } from "./src/renderer/src/features/browser/hooks/use-browser-extensions";`,
		{ external: ["electron", "react", "sonner"] },
	);
	const none = hook.updateReportMessage({ applied: 0, pending: 0, failed: 0 });
	assert.equal(none, "Your extensions are up to date.");
	const failed = hook.updateReportMessage({
		applied: 0,
		pending: 0,
		failed: 1,
	});
	assert.notEqual(failed, none);
	assert.match(failed, /Couldn't check for updates/);
	const mixed = hook.updateReportMessage({ applied: 2, pending: 1, failed: 0 });
	assert.match(mixed, /2 extensions updated/);
	assert.match(mixed, /1 update needs your approval/);
	assert.doesNotMatch(mixed, /up to date/);
});

test("Q1: removeExtensionSettings deletes only <storage>/{Local,Sync} Extension Settings/<id>", async (t) => {
	const managerModule = await load(
		`export { removeExtensionSettings } from "./src/main/browser/extensions/manager";`,
	);
	const storage = await mkdtemp(
		join(process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(), "ext-settings-"),
	);
	t.after(() => rm(storage, { recursive: true, force: true }));
	const other = "b".repeat(32);
	for (const area of ["Local Extension Settings", "Sync Extension Settings"])
		for (const id of [ID, other]) {
			await mkdir(join(storage, area, id), { recursive: true });
			await writeFile(join(storage, area, id, "000003.log"), "QA_MARKER");
		}
	await managerModule.removeExtensionSettings(storage, ID);
	assert.deepEqual(await readdir(join(storage, "Local Extension Settings")), [
		other,
	]);
	assert.deepEqual(await readdir(join(storage, "Sync Extension Settings")), [
		other,
	]);
	// A non-id (traversal) and an in-memory session are no-ops.
	await managerModule.removeExtensionSettings(storage, "..");
	await managerModule.removeExtensionSettings(storage, `../${other}`);
	await managerModule.removeExtensionSettings(null, other);
	assert.deepEqual(await readdir(join(storage, "Local Extension Settings")), [
		other,
	]);
	assert.deepEqual((await readdir(storage)).sort(), [
		"Local Extension Settings",
		"Sync Extension Settings",
	]);
});

test("R1-6: extraction stops at the inflated-size / entry-count bound", async (t) => {
	const install = await load(
		`export { extractVerifiedArchive, MAX_UNPACKED_BYTES, MAX_UNPACKED_ENTRIES } from "./src/main/browser/extensions/install";`,
	);
	// Above the measured 1Password tree (1,046 entries, 44,495,108 bytes).
	assert.ok(install.MAX_UNPACKED_BYTES > 44_495_108 * 5);
	assert.ok(install.MAX_UNPACKED_ENTRIES > 1_046 * 10);
	const work = await mkdtemp(
		join(process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(), "ext-cap-"),
	);
	t.after(() => rm(work, { recursive: true, force: true }));
	await mkdir(join(work, "src"));
	await writeFile(join(work, "src", "a.txt"), "x".repeat(4096));
	await writeFile(join(work, "src", "b.txt"), "y".repeat(4096));
	execFileSync("zip", ["-qr", "../pkg.zip", "."], { cwd: join(work, "src") });
	const archive = require("node:fs").readFileSync(join(work, "pkg.zip"));
	await install.extractVerifiedArchive(archive, join(work, "ok"));
	assert.deepEqual((await readdir(join(work, "ok"))).sort(), [
		"a.txt",
		"b.txt",
	]);
	await assert.rejects(
		install.extractVerifiedArchive(archive, join(work, "big"), {
			bytes: 6000,
			entries: 100,
		}),
		/too large to unpack/,
	);
	await assert.rejects(
		install.extractVerifiedArchive(archive, join(work, "many"), {
			bytes: 1e9,
			entries: 1,
		}),
		/too large to unpack/,
	);
});

test("the address bar treats lop://extensions as an address, not a blocked scheme", async () => {
	const model = await load(
		`export { addressIntent } from "./src/renderer/src/features/browser/model/address-autocomplete";`,
	);
	assert.equal(model.addressIntent("lop://extensions"), "url");
	assert.equal(model.addressIntent(`lop://extensions?id=${ID}`), "url");
	assert.equal(model.addressIntent("lop://settings"), "blocked");
	assert.equal(model.addressIntent("javascript:alert(1)"), "blocked");
});
