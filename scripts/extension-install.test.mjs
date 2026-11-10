import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { crc32 } from "node:zlib";
import { build } from "esbuild";

const bundle = await build({
	entryPoints: ["src/main/browser/extensions/install.ts"],
	bundle: true,
	platform: "node",
	format: "cjs",
	write: false,
});
const { createRequire } = await import("node:module");
const require = createRequire(import.meta.url);
const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(
	require,
	module,
	module.exports,
);
const {
	safeExtensionEntry,
	extractVerifiedArchive,
	prepareExtension,
	persistStoreCrx,
	storeCrxUrl,
	downloadStoreCrx,
	MAX_EXTENSION_DOWNLOAD_BYTES,
} = module.exports;
const ID = "aeblfdkhhhdcdjpifhhbdiojplfjncoa";
const directory = async (t) => {
	const path = await mkdtemp(
		join(
			process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(),
			"extension-install-test-",
		),
	);
	t.after(() => rm(path, { recursive: true, force: true }));
	return path;
};
// Minimal stored ZIP fixture, not a second extraction implementation. CRCs,
// central attributes and duplicate names deliberately exercise yauzl + product
// exclusive file writes rather than asserting against source text.
function archive(entries) {
	const local = [];
	const central = [];
	let offset = 0;
	for (const { name, data = "fixture", mode = 0o100600 } of entries) {
		const filename = Buffer.from(name);
		const body = Buffer.from(data);
		const header = Buffer.alloc(30);
		header.writeUInt32LE(0x04034b50);
		header.writeUInt16LE(20, 4);
		header.writeUInt32LE(crc32(body), 14);
		header.writeUInt32LE(body.length, 18);
		header.writeUInt32LE(body.length, 22);
		header.writeUInt16LE(filename.length, 26);
		const record = Buffer.alloc(46);
		record.writeUInt32LE(0x02014b50);
		record.writeUInt16LE(0x0314, 4);
		record.writeUInt16LE(20, 6);
		record.writeUInt32LE(crc32(body), 16);
		record.writeUInt32LE(body.length, 20);
		record.writeUInt32LE(body.length, 24);
		record.writeUInt16LE(filename.length, 28);
		record.writeUInt32LE((mode * 65536) >>> 0, 38);
		record.writeUInt32LE(offset, 42);
		local.push(header, filename, body);
		central.push(record, filename);
		offset += header.length + filename.length + body.length;
	}
	const table = Buffer.concat(central);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(table.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...local, table, end]);
}
test("archive entry policy rejects traversal, absolute paths, separators, ADS and symlinks", () => {
	for (const name of [
		"../escape",
		"a/../../escape",
		"/escape",
		"C:/escape",
		"C:\\escape",
		"a\\..\\escape",
		"a:stream",
		"\0bad",
		".",
		"",
	])
		assert.throws(() =>
			safeExtensionEntry("/owned", {
				fileName: name,
				externalFileAttributes: 0,
			}),
		);
	assert.throws(() =>
		safeExtensionEntry("/owned", {
			fileName: "link",
			externalFileAttributes: (0o120777 * 65536) >>> 0,
		}),
	);
	assert.equal(
		safeExtensionEntry("/owned", {
			fileName: "background/worker.js",
			externalFileAttributes: 0,
		}),
		"/owned/background/worker.js",
	);
});
test("real streaming extraction writes safe entries and rejects duplicate files", async (t) => {
	const root = await directory(t);
	await extractVerifiedArchive(
		archive([{ name: "safe/file.js", data: "payload" }]),
		root,
	);
	assert.equal(await readFile(join(root, "safe/file.js"), "utf8"), "payload");
	await assert.rejects(
		extractVerifiedArchive(
			archive([{ name: "duplicate" }, { name: "duplicate" }]),
			root,
		),
	);
});
test("real extractor refuses link and escaping ZIP central entries", async (t) => {
	const root = await directory(t);
	for (const entry of [
		{ name: "../escaped" },
		{ name: "/escaped" },
		{ name: "symlink", mode: 0o120777 },
	])
		await assert.rejects(extractVerifiedArchive(archive([entry]), root));
	assert.deepEqual(await readdir(root), []);
});
test("invalid package cannot create an installation tree or replace the durable package", async (t) => {
	const root = await directory(t);
	await assert.rejects(prepareExtension(root, ID, Buffer.from("not signed")));
	// Verification fails before any directory is created.
	assert.deepEqual(await readdir(root), []);
	await persistStoreCrx(root, ID, Buffer.from("previous"));
	await persistStoreCrx(root, ID, Buffer.from("atomic test"));
	assert.equal(
		await readFile(join(root, ID, "official.crx"), "utf8"),
		"atomic test",
	);
	await persistStoreCrx(root, ID, Buffer.from("atomic test"));
	assert.deepEqual(await readdir(join(root, ID)), ["official.crx"]);
});
test("ids that are not 32 a-p letters never become paths or URLs", async (t) => {
	const root = await directory(t);
	for (const id of [
		"..",
		"../x",
		"AEBLFDKHHHDCDJPIFHHBDIOJPLFJNCOA",
		"a".repeat(31),
		`${"a".repeat(31)}/`,
	]) {
		assert.throws(() => storeCrxUrl(id), /Invalid extension id/);
		await assert.rejects(
			persistStoreCrx(root, id, Buffer.from("x")),
			/Invalid extension id/,
		);
		await assert.rejects(prepareExtension(root, id, Buffer.from("x")));
	}
	assert.deepEqual(await readdir(root), []);
});
test("store URL is fixed, CRX3-only and carries the runtime Chromium version", () => {
	const url = new URL(storeCrxUrl(ID));
	assert.equal(url.origin, "https://clients2.google.com");
	assert.equal(url.searchParams.get("acceptformat"), "crx3");
	assert.equal(url.searchParams.get("x"), `id=${ID}&uc`);
	assert.equal(
		url.searchParams.get("prodversion"),
		process.versions.chrome ?? "0",
	);
});
test("download is bounded before buffering and never sends credentials", async () => {
	const seen = [];
	const big = async (_input, init) => {
		seen.push(init);
		return new Response("x", {
			headers: { "content-length": String(MAX_EXTENSION_DOWNLOAD_BYTES + 1) },
		});
	};
	await assert.rejects(
		downloadStoreCrx(ID, new AbortController().signal, big),
		/download bound/,
	);
	assert.equal(seen[0].credentials, "omit");
	const ok = await downloadStoreCrx(
		ID,
		new AbortController().signal,
		async () => new Response("crx bytes"),
	);
	assert.equal(ok.toString(), "crx bytes");
});
test(
	"verified store package prepares (MV3, key bound, name resolved), persists and re-extracts fresh",
	{ skip: !process.env.EXTENSION_CRX },
	async (t) => {
		const root = await directory(t);
		const crx = await readFile(process.env.EXTENSION_CRX);
		const first = await prepareExtension(root, ID, crx);
		const manifest = JSON.parse(
			await readFile(join(first.directory, "manifest.json"), "utf8"),
		);
		assert.equal(manifest.manifest_version, 3);
		assert.ok(manifest.key);
		assert.equal(first.manifest.version, manifest.version);
		assert.ok(!first.name.startsWith("__MSG_"), first.name);
		await persistStoreCrx(root, ID, crx);
		await first.dispose();
		const restarted = await prepareExtension(
			root,
			ID,
			await readFile(join(root, ID, "official.crx")),
		);
		assert.notEqual(first.directory, restarted.directory);
		await restarted.dispose();
		assert.deepEqual(await readdir(join(root, ID)), ["official.crx"]);
		// The genuine package is refused under another listing's id.
		await assert.rejects(prepareExtension(root, "a".repeat(32), crx));
	},
);
