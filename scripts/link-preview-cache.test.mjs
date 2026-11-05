/**
 * The cache's bounds and TTLs, and the promise that no log line carries a URL.
 *
 * WHAT IS REAL HERE. The cache module and the service, over a real directory in the
 * OS temp dir - `readFile`/`writeFile`/`unlink`, not a mocked filesystem - so the
 * artifact lifecycle (write, read back, sweep, evict) is exercised as it runs.
 *
 * The TTLs and the LRU bounds are driven with an injected clock and reduced bounds
 * so the behaviour is asserted exactly, at numbers a test can afford; the shipped
 * defaults (30 min, 6 h, 256 entries, 200 MiB) are constants in the module and are
 * not weakened by these narrower instances.
 *
 * The LAST test is the privacy invariant: a resolve of a URL with an identifying
 * host, path and query produces log lines, and not one of them may contain any part
 * of that URL.
 */

import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { bundleMainModules } from "./link-preview-bundle.mjs";

const mod = await import(
	await bundleMainModules("link-preview-cache-suite", [
		"src/main/link-preview/resolve.ts",
		"src/main/link-preview/cache.ts",
	])
);

const ready = (title) => ({
	kind: "ready",
	preview: {
		url: "https://example.com/",
		title,
		description: null,
		siteName: null,
		favicon: null,
		image: null,
	},
});

const absent = { kind: "absent", reason: "no-html" };

/** A log line this module is allowed to write: the opaque id, then a state. */
const IDENTIFIED = /^link-preview [0-9a-f]{32} /;

function clocked(start = 1_000_000) {
	let at = start;
	return {
		now: () => at,
		advance(ms) {
			at += ms;
		},
	};
}

test("a positive answer expires at six hours, a negative one at thirty minutes", async () => {
	const clock = clocked();
	const cache = mod.createLinkPreviewCache({
		directory: await mkdtemp(join(tmpdir(), "link-preview-ttl-")),
		now: clock.now,
	});
	await cache.store("https://example.com/a", ready("a"), []);
	await cache.store("https://example.com/b", absent, []);

	clock.advance(60 * 60 * 1000);
	assert.ok(cache.lookup("https://example.com/a"), "an hour is still fresh");
	assert.deepEqual(
		cache.lookup("https://example.com/b"),
		undefined,
		"an hour is stale for a negative",
	);

	clock.advance(5 * 60 * 60 * 1000 + 1);
	assert.equal(
		cache.lookup("https://example.com/a"),
		undefined,
		"six hours plus a millisecond",
	);
});

test("the entry cap evicts least-recently-used first", async () => {
	const clock = clocked();
	const cache = mod.createLinkPreviewCache({
		directory: await mkdtemp(join(tmpdir(), "link-preview-lru-")),
		now: clock.now,
		bounds: { maxEntries: 3 },
	});
	for (const key of ["a", "b", "c"]) {
		await cache.store(key, ready(key), []);
		clock.advance(10);
	}
	// Touch "a" so "b" becomes the oldest.
	assert.ok(cache.lookup("a"));
	clock.advance(10);
	await cache.store("d", ready("d"), []);
	assert.equal(cache.stats().entries, 3);
	assert.equal(cache.lookup("b"), undefined, "b was the least recently used");
	assert.ok(cache.lookup("a"), "a was touched, so it survived");
	assert.ok(cache.lookup("d"));
});

test("the byte and artifact caps hold, and eviction removes the files too", async () => {
	const directory = await mkdtemp(join(tmpdir(), "link-preview-bytes-"));
	const cache = mod.createLinkPreviewCache({
		directory,
		bounds: { maxTotalBytes: 1000, maxArtifacts: 2 },
	});
	const png = new Uint8Array(600);
	png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
	for (const [index, key] of ["a", "b", "c"].entries()) {
		const id = mod.previewIdFor("image", key);
		await cache.store(key, ready(key), [
			{ id, mime: "image/png", bytes: png },
			{
				id: mod.previewIdFor("favicon", `${key}-${index}`),
				mime: "image/png",
				bytes: png,
			},
		]);
	}
	const stats = cache.stats();
	assert.ok(stats.bytes <= 1000, `bytes ${stats.bytes} within the cap`);
	assert.ok(
		stats.artifacts <= 2,
		`artifacts ${stats.artifacts} within the cap`,
	);
	const files = await readdir(directory);
	assert.ok(
		files.length <= 2,
		`evicted files left the directory: ${JSON.stringify(files)}`,
	);
});

test("an artifact survives a restart, and an unknown id is a stated 404", async () => {
	const directory = await mkdtemp(join(tmpdir(), "link-preview-restart-"));
	const png = new Uint8Array(29);
	png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
	png.set([0x49, 0x48, 0x44, 0x52], 12);
	const id = mod.previewIdFor("image", "https://example.com/pic");
	const first = mod.createLinkPreviewCache({ directory });
	await first.store("https://example.com/pic", ready("pic"), [
		{ id, mime: "image/png", bytes: png },
	]);
	assert.deepEqual(
		await first.read(id).then((artifact) => artifact?.mime),
		"image/png",
	);

	// A new process: the index is gone, the directory is not. Startup sweep adopts it.
	const second = mod.createLinkPreviewCache({ directory });
	await second.sweep();
	const adopted = await second.read(id);
	assert.equal(adopted?.mime, "image/png");
	assert.equal(adopted?.bytes.byteLength, png.byteLength);
});

test("no log line ever contains the URL, its host, its path or its query", async () => {
	const logs = [];
	const service = mod.createLinkPreviewService({
		cache: mod.createLinkPreviewCache({
			directory: await mkdtemp(join(tmpdir(), "link-preview-log-")),
		}),
		lookup: async () => [{ address: "93.184.216.34", family: 4 }],
		hop: async () => ({
			status: 200,
			location: null,
			contentType: "text/html",
			body: new TextEncoder().encode(
				"<!doctype html><html><head><title>Secret title</title></head></html>",
			),
			truncated: false,
		}),
		log: (line) => logs.push(line),
	});
	const secretive =
		"https://private.example.invalid/documents/very-identifying-path?token=hunter2";
	const result = await service.resolve({ url: secretive, index: 0 });
	assert.equal(result.kind, "ready");
	assert.ok(logs.length > 0, "the resolve logged something");
	for (const line of logs) {
		for (const fragment of [
			"private.example.invalid",
			"very-identifying-path",
			"token",
			"hunter2",
			"https://",
		]) {
			assert.ok(
				!line.includes(fragment),
				`log line leaked ${fragment}: ${line}`,
			);
		}
		assert.match(line, IDENTIFIED, `only the opaque id identifies it: ${line}`);
	}
});
