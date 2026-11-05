/**
 * The cache's bounds and TTLs, and the promise that no log line carries a URL.
 *
 * WHAT IS REAL HERE. The cache module and the service, over a real directory in the
 * OS temp dir - `readFile`/`writeFile`/`unlink`, not a mocked filesystem - so the
 * artifact lifecycle (write, read back, sweep, evict) is exercised as it runs.
 *
 * The TTLs and the LRU bounds are driven with an injected clock and reduced bounds
 * so the behaviour is asserted exactly, at numbers a test can afford; the shipped
 * defaults (6 h for a card, 30 min for a refusal, 60 s for a retryable error,
 * 256 entries / 32 MB / 400 artifacts) are constants in the module and are not
 * weakened by these narrower instances.
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

// `not-html` is a member of `LinkPreviewAbsentReason`; this fixture is a refusal a
// retry cannot change, which is what gives it the thirty-minute TTL.
const absent = { kind: "absent", reason: "not-html" };

/** A log line this module is allowed to write: the opaque id, then a state. */
const IDENTIFIED = /^link-preview [0-9a-f]{32} /;

/** A PNG header: the cache only needs the bytes to be a picture's bytes. */
function pngBytes() {
	const bytes = new Uint8Array(600);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
	bytes.set([0x49, 0x48, 0x44, 0x52], 12);
	return bytes;
}

/** Let a background file removal land. `lookup` must stay synchronous (it answers a
 * renderer call), so the expiry path it starts finishes after it has returned. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

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
			{ id, kind: "image", mime: "image/png", bytes: png },
			{
				id: mod.previewIdFor("favicon", `${key}-${index}`),
				kind: "favicon",
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
		{ id, kind: "image", mime: "image/png", bytes: png },
	]);
	assert.deepEqual(
		await first.read(id, "image").then((artifact) => artifact?.mime),
		"image/png",
	);

	// A new process: the index is gone, the directory is not. Startup sweep adopts it,
	// and the KIND comes back from the file name - so `which` is still enforced.
	const second = mod.createLinkPreviewCache({ directory });
	await second.sweep();
	const adopted = await second.read(id, "image");
	assert.equal(adopted?.mime, "image/png");
	assert.equal(adopted?.bytes.byteLength, png.byteLength);
	assert.equal(await second.read(id, "favicon"), null, "the kind survived too");
});

test("a retryable error expires in a minute, a refusal in thirty", async () => {
	const clock = clocked();
	const cache = mod.createLinkPreviewCache({
		directory: await mkdtemp(join(tmpdir(), "link-preview-retryable-")),
		now: clock.now,
	});
	const retryable = { kind: "error", retryable: true };
	const dead = { kind: "error", retryable: false };
	await cache.store("https://example.com/flap", retryable, []);
	await cache.store("https://example.com/dead", dead, []);
	await cache.store("https://example.com/absent", absent, []);

	clock.advance(30 * 1000);
	assert.ok(
		cache.lookup("https://example.com/flap"),
		"half a minute is still fresh for a retryable error",
	);

	clock.advance(30 * 1000 + 1);
	assert.equal(
		cache.lookup("https://example.com/flap"),
		undefined,
		"a retryable error must not outlive the retry the contract advertises",
	);
	assert.ok(
		cache.lookup("https://example.com/dead"),
		"a dead host is still refused",
	);
	assert.ok(
		cache.lookup("https://example.com/absent"),
		"and so is an absent page",
	);
});

test("an expired entry's artifacts leave with it, so two sweeps leave none", async () => {
	const clock = clocked();
	const directory = await mkdtemp(join(tmpdir(), "link-preview-expiry-"));
	const cache = mod.createLinkPreviewCache({ directory, now: clock.now });
	const png = pngBytes();
	const id = mod.previewIdFor("image", "https://example.com/exp");
	await cache.store("https://example.com/exp", ready("exp"), [
		{ id, kind: "image", mime: "image/png", bytes: png },
	]);
	assert.deepEqual(cache.stats(), {
		entries: 1,
		artifacts: 1,
		bytes: png.byteLength,
	});
	assert.deepEqual(await readdir(directory), [`image-${id}.png`]);

	clock.advance(6 * 60 * 60 * 1000 + 1);
	assert.equal(cache.lookup("https://example.com/exp"), undefined);
	await flush();
	await cache.sweep();
	await cache.sweep();
	assert.deepEqual(
		cache.stats(),
		{ entries: 0, artifacts: 0, bytes: 0 },
		"the expired entry's bytes left the accounting as well as the index",
	);
	assert.deepEqual(
		await readdir(directory),
		[],
		"no readable artifact survived the entry that owned it",
	);
});

test("re-storing a key replaces the entry, taking its artifacts with it", async () => {
	const directory = await mkdtemp(join(tmpdir(), "link-preview-restore-"));
	const cache = mod.createLinkPreviewCache({ directory });
	const png = pngBytes();
	const id = mod.previewIdFor("image", "https://example.com/x");
	await cache.store("https://example.com/x", ready("first"), [
		{ id, kind: "image", mime: "image/png", bytes: png },
	]);

	// The page's card came back without a picture. The old file must not stay behind,
	// referenced by nothing and spending a bound the LRU would take out on live entries.
	await cache.store("https://example.com/x", ready("second"), []);
	assert.deepEqual(cache.stats(), { entries: 1, artifacts: 0, bytes: 0 });
	assert.deepEqual(await readdir(directory), []);
	assert.equal(await cache.read(id, "image"), null);
});

test("an artifact is served only under the kind it was stored as", async () => {
	const cache = mod.createLinkPreviewCache({
		directory: await mkdtemp(join(tmpdir(), "link-preview-kind-")),
	});
	const png = pngBytes();
	const imageId = mod.previewIdFor("image", "https://example.com/k");
	const faviconId = mod.previewIdFor("favicon", "https://example.com/k");
	await cache.store("https://example.com/k", ready("k"), [
		{ id: imageId, kind: "image", mime: "image/png", bytes: png },
		{ id: faviconId, kind: "favicon", mime: "image/png", bytes: png },
	]);
	assert.equal((await cache.read(imageId, "image"))?.mime, "image/png");
	assert.equal((await cache.read(faviconId, "favicon"))?.mime, "image/png");
	assert.equal(await cache.read(imageId, "favicon"), null, "kind is enforced");
	assert.equal(
		await cache.read(faviconId, "image"),
		null,
		"in both directions",
	);
	assert.equal(await cache.read("../../../etc/passwd", "image"), null);
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
