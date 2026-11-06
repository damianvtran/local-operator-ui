import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The artifact cache's BOUNDS, driven on a real directory.
 *
 * Why a real temp directory rather than a mocked `fs`: every property here is a
 * property of files and an index that outlives the process — a stale entry, an
 * orphan, a torn write — and a mock would assert the code I wrote instead of what
 * a disk does. The clock and the limits are injected so TTL and eviction are
 * deterministic without sleeping.
 */
const bundle = await build({
	stdin: {
		contents: "export * from './src/main/link-preview/artifact-cache';",
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	LinkPreviewArtifactCache,
	ARTIFACT_MAX_BLOB_BYTES,
	ARTIFACT_MAX_BYTES,
	ARTIFACT_MAX_COUNT,
	previewKeyFor,
	artifactOwnerFingerprint,
	ARTIFACT_ALLOWED_MIMES,
} = await import(
	`data:text/javascript;base64,${Buffer.from(
		bundle.outputFiles[0].text,
	).toString("base64")}`
);

const DIRS = [];
async function tempDir() {
	const dir = await mkdtemp(join(tmpdir(), "lp-cache-"));
	DIRS.push(dir);
	return dir;
}
test.after(async () => {
	for (const dir of DIRS) await rm(dir, { recursive: true, force: true });
});

const ACCOUNT_A = "acc_01HACCOUNTA";
const ACCOUNT_B = "acc_01HACCOUNTB";
const FP_A = artifactOwnerFingerprint(ACCOUNT_A);
const FP_B = artifactOwnerFingerprint(ACCOUNT_B);

const ID_A = "a".repeat(32);
const ID_B = "b".repeat(32);
const ID_C = "c".repeat(32);
const bytesOf = (n, fill = 7) => new Uint8Array(n).fill(fill);

async function openCache(overrides = {}) {
	const clock = overrides.clock ?? { now: 0 };
	const cache = new LinkPreviewArtifactCache({
		dir: overrides.dir ?? (await tempDir()),
		now: () => clock.now,
		ttlMs: overrides.ttlMs,
		maxBytes: overrides.maxBytes,
		maxArtifacts: overrides.maxArtifacts,
		sweepIntervalMs: overrides.sweepIntervalMs,
	});
	await cache.open();
	return { cache, clock };
}

test("the documented bounds are the ones the product chose", () => {
	assert.equal(ARTIFACT_MAX_BYTES, 64 * 1024 * 1024);
	assert.equal(ARTIFACT_MAX_COUNT, 400);
	// Bigger than any artifact core produces (a 2 MiB og:image is its ceiling).
	assert.equal(ARTIFACT_MAX_BLOB_BYTES, 4 * 1024 * 1024);
});

test("a stored blob is served, and one past its TTL is not", async () => {
	const { cache, clock } = await openCache({ ttlMs: 1000 });
	await cache.store(ID_A, "image/png", bytesOf(4), FP_A);
	const hit = await cache.read(ID_A, FP_A);
	assert.equal(hit.mime, "image/png");
	assert.equal(hit.bytes.byteLength, 4);

	clock.now = 1001;
	assert.equal(await cache.read(ID_A, FP_A), null, "an expired blob is a miss");

	// The sweep is what reclaims the space; a read alone only refuses to serve.
	clock.now = 1001;
	await cache.sweep();
	const names = await readdir(cache.directory);
	assert.ok(!names.includes(ID_A), "the expired file is gone");
});

test("a stale index entry cannot resurrect bytes that are gone", async () => {
	const dir = await tempDir();
	const { cache } = await openCache({ dir, ttlMs: 60_000 });
	await cache.store(ID_A, "image/png", bytesOf(8), FP_A);
	await rm(join(dir, ID_A));

	assert.equal(await cache.read(ID_A, FP_A), null);
	// The index entry was dropped in memory; a fresh process reading the same
	// directory must also answer a miss rather than a phantom hit.
	const reopened = new LinkPreviewArtifactCache({ dir, now: () => 0 });
	await reopened.open();
	assert.equal(await reopened.read(ID_A, FP_A), null);
	assert.deepEqual(reopened.ids(), []);
});

test("an interrupted write's temp file and any stray are removed at open", async () => {
	const dir = await tempDir();
	const first = new LinkPreviewArtifactCache({ dir, now: () => 0 });
	await first.open();
	await first.store(ID_A, "image/png", bytesOf(4), FP_A);

	await writeFile(join(dir, `${ID_B}.123.deadbeef.tmp`), "half a blob");
	await writeFile(join(dir, "not-an-id"), "stray");

	const reopened = new LinkPreviewArtifactCache({ dir, now: () => 0 });
	await reopened.open();
	const names = await readdir(dir);
	assert.deepEqual(names.sort(), ["index.json", ID_A].sort());
	assert.equal((await reopened.read(ID_A, FP_A)).bytes.byteLength, 4);
});

test("bytes survive a restart through the index", async () => {
	const dir = await tempDir();
	const first = new LinkPreviewArtifactCache({ dir, now: () => 0 });
	await first.open();
	await first.store(ID_A, "image/webp", bytesOf(3), FP_A);

	const reopened = new LinkPreviewArtifactCache({ dir, now: () => 0 });
	await reopened.open();
	const hit = await reopened.read(ID_A, FP_A);
	assert.equal(hit.mime, "image/webp");
	assert.equal(hit.bytes.byteLength, 3);
});

test("the count cap evicts by last use, not by store order", async () => {
	const { cache, clock } = await openCache({
		maxArtifacts: 2,
		maxBytes: 1024 * 1024,
		ttlMs: 60_000,
		sweepIntervalMs: 60_000,
	});
	await cache.store(ID_A, "image/png", bytesOf(1), FP_A);
	clock.now = 10;
	await cache.store(ID_B, "image/png", bytesOf(1), FP_A);
	// A is newest by USE even though it is oldest by store time.
	clock.now = 20;
	assert.equal((await cache.read(ID_A, FP_A)).bytes.byteLength, 1);
	clock.now = 30;
	await cache.store(ID_C, "image/png", bytesOf(1), FP_A);

	assert.deepEqual(cache.ids().sort(), [ID_A, ID_C].sort());
	assert.equal(await cache.read(ID_B, FP_A), null);
	const names = await readdir(cache.directory);
	assert.ok(!names.includes(ID_B));
});

test("the byte cap evicts until the directory fits", async () => {
	const { cache } = await openCache({
		maxArtifacts: 400,
		maxBytes: 10,
		ttlMs: 60_000,
	});
	await cache.store(ID_A, "image/png", bytesOf(6), FP_A);
	await cache.store(ID_B, "image/png", bytesOf(6), FP_A);
	assert.ok(cache.stats().residentBytes <= 10);
	assert.deepEqual(cache.ids(), [ID_B]);
	assert.equal(await cache.read(ID_A, FP_A), null);
	assert.equal(cache.stats().evictions, 1);
});

test("a blob larger than any artifact core produces is refused outright", async () => {
	const { cache } = await openCache({ ttlMs: 60_000 });
	await cache.store(
		ID_A,
		"image/png",
		bytesOf(ARTIFACT_MAX_BLOB_BYTES + 1),
		FP_A,
	);
	assert.deepEqual(cache.ids(), []);
	assert.equal(await cache.read(ID_A, FP_A), null);
	// Nor is an empty body something to keep.
	await cache.store(ID_B, "image/png", new Uint8Array(0), FP_A);
	assert.deepEqual(cache.ids(), []);
});

test("drop forgets specific ids and nothing else", async () => {
	const { cache } = await openCache({ ttlMs: 60_000 });
	await cache.store(ID_A, "image/png", bytesOf(2), FP_A);
	await cache.store(ID_B, "image/png", bytesOf(2), FP_A);
	await cache.drop([ID_A]);
	assert.deepEqual(cache.ids(), [ID_B]);
	const names = await readdir(cache.directory);
	assert.ok(!names.includes(ID_A));
	assert.equal(await cache.read(ID_A, FP_A), null);
	// Dropping an id it never held is a no-op, not a failure: the "disabled" rule
	// fires on answers that may have no artifacts of their own.
	await cache.drop([ID_C]);
	assert.deepEqual(cache.ids(), [ID_B]);
});

test("the index on disk names artifacts, never a page", async () => {
	const dir = await tempDir();
	const { cache } = await openCache({ dir, ttlMs: 60_000 });
	await cache.store(ID_A, "image/png", bytesOf(2), FP_A);
	const raw = await readFile(join(dir, "index.json"), "utf8");
	assert.ok(raw.includes(ID_A));
	for (const entry of Object.values(JSON.parse(raw).entries)) {
		assert.deepEqual(Object.keys(entry).sort(), [
			"account",
			"lastUsedAt",
			"mime",
			"size",
			"storedAt",
		]);
	}
	// The whole point of keying by an opaque id: a directory listing, or the index,
	// reveals no link. A url/host/query in either would be a browsing record.
	assert.ok(!/https?|www\.|\?|#/.test(raw), `index must name no page: ${raw}`);
	for (const name of await readdir(dir)) {
		assert.match(
			name,
			/^(index\.json|[0-9a-f]{32})$/,
			`unexpected name ${name}`,
		);
	}
});

test("the preview key is opaque, stable, account-scoped and not a URL", () => {
	const url = ["ht", "tps", "://", "example", ".test", "/a?b=c"].join("");
	const key = previewKeyFor(FP_A, url);
	assert.match(key, /^[0-9a-f]{64}$/);
	assert.equal(previewKeyFor(FP_A, url), key);
	assert.notEqual(previewKeyFor(`${url}&d=e`.replace("?b=c", "")), "");
	assert.notEqual(previewKeyFor(FP_A, `${url}&d=e`), key);
	// The account is part of the key: one account's refusal must never address
	// another account's ids for the same link (review round 1, finding 4).
	assert.notEqual(previewKeyFor(FP_B, url), key);
	assert.ok(!key.includes("example"));
});

test("a hit is served only to the receipt that stored it", async () => {
	const { cache } = await openCache({ ttlMs: 60_000 });
	await cache.store(ID_A, "image/png", bytesOf(4), FP_A);
	assert.equal((await cache.read(ID_A, FP_A)).bytes.byteLength, 4);
	// Another account's receipt is a MISS, not a deletion: A's entry is still the
	// right answer for A's own card, and the request must go and ask core, which is
	// the authority on whose scope names what (review round 1, MAJOR-1).
	assert.equal(await cache.read(ID_A, FP_B), null);
	assert.deepEqual(cache.ids(), [ID_A]);
	assert.equal(cache.stats().foreignHits, 1);
	// The file is still there for its owner.
	assert.equal((await cache.read(ID_A, FP_A)).bytes.byteLength, 4);
});

test("the cache directory and its files are private to this user", async () => {
	const { stat } = await import("node:fs/promises");
	const dir = await tempDir();
	const { cache } = await openCache({ dir, ttlMs: 60_000 });
	await cache.store(ID_A, "image/png", bytesOf(4), FP_A);
	assert.equal((await stat(dir)).mode & 0o777, 0o700);
	assert.equal((await stat(join(dir, ID_A))).mode & 0o600, 0o600);
	assert.equal((await stat(join(dir, "index.json"))).mode & 0o600, 0o600);
});

test("index.json carries the account only as a fingerprint", async () => {
	const dir = await tempDir();
	const { cache } = await openCache({ dir, ttlMs: 60_000 });
	await cache.store(ID_A, "image/png", bytesOf(2), FP_A);
	const raw = await readFile(join(dir, "index.json"), "utf8");
	const entry = Object.values(JSON.parse(raw).entries)[0];
	assert.equal(entry.account, FP_A);
	assert.ok(!raw.includes(ACCOUNT_A), "the account id itself is never written");
	assert.match(entry.account, /^[0-9a-f]{32}$/);
});

test("a corrupt, wrong-version or path-shaped index starts empty", async () => {
	for (const document of [
		"{not json",
		JSON.stringify({ version: 99, entries: { [ID_A]: {} } }),
		JSON.stringify({
			version: 2,
			entries: {
				"../../../../etc/passwd": {
					mime: "image/png",
					size: 4,
					storedAt: 0,
					lastUsedAt: 0,
					account: FP_A,
				},
			},
		}),
	]) {
		const dir = await tempDir();
		await writeFile(join(dir, "index.json"), document);
		// A file the index does not describe, plus the path-shaped key's would-be
		// target: neither may survive, and neither may be readable.
		await writeFile(join(dir, ID_B), bytesOf(4));
		const cache = new LinkPreviewArtifactCache({ dir, now: () => 0 });
		await cache.open();
		assert.deepEqual(cache.ids(), []);
		assert.deepEqual(cache.stats().residentBytes, 0);
		assert.deepEqual(await readdir(dir), ["index.json"]);
		// A fresh store still works on the same directory.
		await cache.store(ID_C, "image/png", bytesOf(1), FP_A);
		assert.deepEqual(cache.ids(), [ID_C]);
	}
});

test("clear() drops every blot and leaves a usable directory", async () => {
	const { cache } = await openCache({ ttlMs: 60_000 });
	await cache.store(ID_A, "image/png", bytesOf(2), FP_A);
	await cache.store(ID_B, "image/png", bytesOf(2), FP_B);
	await cache.clear();
	assert.deepEqual(cache.ids(), []);
	assert.equal(cache.stats().residentBytes, 0);
	assert.deepEqual(await readdir(cache.directory), ["index.json"]);
	await cache.store(ID_C, "image/png", bytesOf(2), FP_A);
	assert.deepEqual(cache.ids(), [ID_C]);
});

test("only core's raster set is stored, and an index claiming otherwise is a miss", async () => {
	const { cache } = await openCache({ ttlMs: 60_000 });
	await cache.store(ID_A, "image/svg+xml", bytesOf(4), FP_A);
	await cache.store(ID_B, "text/html", bytesOf(4), FP_A);
	assert.deepEqual(cache.ids(), []);
	// A hand-edited index claiming a document is refused on the way OUT too.
	await cache.store(ID_C, "image/png", bytesOf(4), FP_A);
	const dir = cache.directory;
	const raw = JSON.parse(await readFile(join(dir, "index.json"), "utf8"));
	raw.entries[ID_C].mime = "image/svg+xml";
	await writeFile(join(dir, "index.json"), JSON.stringify(raw));
	const reopened = new LinkPreviewArtifactCache({ dir, now: () => 0 });
	await reopened.open();
	assert.equal(await reopened.read(ID_C, FP_A), null);
});

test("store refuses an id that is not one, even though its caller checked", async () => {
	const { cache } = await openCache({ ttlMs: 60_000 });
	await cache.store("../../escape", "image/png", bytesOf(4), FP_A);
	await cache.store("A".repeat(32), "image/png", bytesOf(4), FP_A);
	assert.deepEqual(cache.ids(), []);
	// Nothing was written — not even an index — because no id ever survived the
	// pattern check.
	assert.deepEqual(await readdir(cache.directory), []);
});

test("a read still answers when the eviction pass behind it fails", async () => {
	const dir = await tempDir();
	const { cache, clock } = await openCache({
		dir,
		ttlMs: 1000,
		sweepIntervalMs: 0,
	});
	await cache.store(ID_A, "image/png", bytesOf(4), FP_A);
	clock.now = 900;
	await cache.store(ID_B, "image/webp", bytesOf(2), FP_A);

	// The directory goes read-only, so the sweep this read triggers cannot delete
	// the expired blob A or rewrite the index. The READ of a live blob must still
	// answer: an eviction that fails is a storage problem, never a broken card.
	const { chmod } = await import("node:fs/promises");
	await chmod(dir, 0o555);
	try {
		clock.now = 1000;
		const hit = await cache.read(ID_B, FP_A);
		assert.equal(hit.mime, "image/webp");
		assert.equal(hit.bytes.byteLength, 2);
	} finally {
		await chmod(dir, 0o755);
	}
});

test("before open, every call is a quiet no-op", async () => {
	const cache = new LinkPreviewArtifactCache({
		dir: await tempDir(),
		now: () => 0,
	});
	assert.equal(await cache.read(ID_A, FP_A), null);
	await cache.store(ID_A, "image/png", bytesOf(1), FP_A);
	await cache.drop([ID_A]);
	await cache.sweep();
	assert.deepEqual(cache.ids(), []);
});
