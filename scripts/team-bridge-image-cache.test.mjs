import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The Team Bridge image cache's BOUNDS, its account binding, and its place in the
 * media relay — driven on a real directory and against a real HTTP server.
 *
 * WHY A REAL TEMP DIRECTORY RATHER THAN A MOCKED `fs`: every property here is a
 * property of files and an index that outlives the process (a stale entry, an
 * orphan, a torn write), and a mock would assert the code I wrote instead of what a
 * disk does. Why a real server rather than a stubbed `fetch`: the claim under test
 * is "entering a channel twice costs ONE upstream fetch", which is a count of
 * requests at the transport seam, not a statement about a cache API. The clock and
 * the limits are injected so TTL and eviction are deterministic without sleeping.
 *
 * WHAT IS NOT PROVEN HERE: that the Electron app wires the cache (a source-shape
 * check at the end pins the three lines that do it), and anything about the
 * renderer — this module deliberately has no DOM.
 */
const bundle = await build({
	stdin: {
		contents: `
 export {
  TeamBridgeImageCache,
  TEAM_BRIDGE_IMAGE_TTL_MS,
  TEAM_BRIDGE_IMAGE_MAX_BYTES,
  TEAM_BRIDGE_IMAGE_MAX_COUNT,
  TEAM_BRIDGE_IMAGE_SWEEP_INTERVAL_MS,
  TEAM_BRIDGE_IMAGE_MAX_BLOB_BYTES,
  TEAM_BRIDGE_IMAGE_ALLOWED_MIMES,
  TEAM_BRIDGE_IMAGE_KEY,
  teamBridgeImageKey,
  teamBridgeImageAccountFingerprint,
 } from './src/main/team-bridge-image-cache';
 export { requestDesktopMediaOutcome } from './src/main/desktop-media';
 export { AppAttentionService } from './src/main/app-attention-service';
 export { LinkPreviewArtifactCache } from './src/main/link-preview/artifact-cache';
 `,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	TeamBridgeImageCache,
	TEAM_BRIDGE_IMAGE_TTL_MS,
	TEAM_BRIDGE_IMAGE_MAX_BYTES,
	TEAM_BRIDGE_IMAGE_MAX_COUNT,
	TEAM_BRIDGE_IMAGE_SWEEP_INTERVAL_MS,
	TEAM_BRIDGE_IMAGE_MAX_BLOB_BYTES,
	TEAM_BRIDGE_IMAGE_ALLOWED_MIMES,
	TEAM_BRIDGE_IMAGE_KEY,
	teamBridgeImageKey,
	teamBridgeImageAccountFingerprint,
	requestDesktopMediaOutcome,
	AppAttentionService,
	LinkPreviewArtifactCache,
} = await import(
	`data:text/javascript;base64,${Buffer.from(
		bundle.outputFiles[0].text,
	).toString("base64")}`
);

const DIRS = [];
const SERVERS = [];
async function tempDir() {
	const dir = await mkdtemp(join(tmpdir(), "tb-image-cache-"));
	DIRS.push(dir);
	return dir;
}
test.after(async () => {
	for (const server of SERVERS) await new Promise((r) => server.close(r));
	for (const dir of DIRS) await rm(dir, { recursive: true, force: true });
});

const ACCOUNT_A = "acc_01HACCOUNTA";
const ACCOUNT_B = "acc_01HACCOUNTB";
const FP_A = teamBridgeImageAccountFingerprint(ACCOUNT_A);
const FP_B = teamBridgeImageAccountFingerprint(ACCOUNT_B);
const TOKEN = "tb-image-cache-test-bearer";
const PNG = "image/png";
const JPEG = "image/jpeg";

const bytesOf = (n, fill = 7) => new Uint8Array(n).fill(fill);
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** One attachment receipt. `suffix` shifts every id together, so two receipts
 * differ in exactly one message. */
function receiptOf(suffix, account = ACCOUNT_A) {
	return {
		expectedAccountId: account,
		tenantId: "tenant_1",
		conversationId: `conv_${suffix}`,
		messageId: `msg_${suffix}`,
		attachmentId: `batt_${suffix}`,
	};
}

async function openCache(overrides = {}) {
	const clock = overrides.clock ?? { now: 0 };
	const cache = new TeamBridgeImageCache({
		dir: overrides.dir ?? (await tempDir()),
		now: () => clock.now,
		ttlMs: overrides.ttlMs,
		maxBytes: overrides.maxBytes,
		maxCount: overrides.maxCount,
		sweepIntervalMs: overrides.sweepIntervalMs,
	});
	await cache.open();
	return { cache, clock };
}

/** Everything the cache owns on disk, excluding the index. */
async function diskEntries(dir) {
	const names = (await readdir(dir)).filter((name) => name !== "index.json");
	const sizes = new Map();
	for (const name of names) sizes.set(name, (await stat(join(dir, name))).size);
	return sizes;
}

/** The index as this build would have written it. */
async function readIndex(dir) {
	return JSON.parse(await readFile(join(dir, "index.json"), "utf8"));
}

/** A macrotask flush: enough for the fire-and-forget sweep a READ may trigger. */
async function settle() {
	for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

/**
 * A server standing in for the hub's attachment route, counting what reaches it.
 *
 * `mode` is mutable so one test can answer 200 and then 500 for the same route: the
 * point of the failed-fetch case is that the SECOND answer changes, and the cache's
 * behaviour must not.
 */
async function startHub(initial) {
	const state = { requests: [], mode: initial, gate: null };
	const server = createServer(async (request, response) => {
		state.requests.push({
			url: request.url,
			authorization: request.headers.authorization,
		});
		// A test that needs a response to be IN FLIGHT (F-2a) parks it here until it
		// releases the gate, so a clear can land in the middle of a real round trip.
		if (state.gate) await state.gate;
		const mode = state.mode;
		if (mode.status !== 200) {
			response.writeHead(mode.status, { "content-type": "application/json" });
			response.end(JSON.stringify({ detail: { code: "unavailable" } }));
			return;
		}
		response.writeHead(200, {
			"content-type": mode.contentType,
			"content-length": String(mode.bytes.byteLength),
		});
		response.end(Buffer.from(mode.bytes));
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	SERVERS.push(server);
	const { port } = server.address();
	return { state, backendUrl: `http://127.0.0.1:${port}` };
}

/** Wait until `predicate` holds, bounded: the alternative is a sleep long enough for
 * the slowest machine, and a test that silently does nothing on the fastest. */
async function until(predicate, what) {
	for (let i = 0; i < 400; i++) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error(`timed out waiting for ${what}`);
}

/** Drive the shipped relay for one attachment receipt. The relay's own schema is
 * `.strict()` about `op`, so the request is the IPC shape the renderer sends. */
async function fetchThroughRelay(backendUrl, receipt, cache) {
	return requestDesktopMediaOutcome(
		{ op: "team_bridge.attachment", ...receipt },
		null,
		backendUrl,
		TOKEN,
		cache,
	);
}

test("the documented bounds are the ones the product chose", () => {
	assert.equal(TEAM_BRIDGE_IMAGE_TTL_MS, 7 * 24 * 60 * 60 * 1000);
	assert.equal(TEAM_BRIDGE_IMAGE_MAX_BYTES, 128 * 1024 * 1024);
	assert.equal(TEAM_BRIDGE_IMAGE_MAX_COUNT, 500);
	assert.equal(TEAM_BRIDGE_IMAGE_SWEEP_INTERVAL_MS, 5 * 60 * 1000);
	// The relay's own ceiling for this op: a blob it would refuse is not one this
	// cache keeps. Pinned in both files' prose; asserted here so a change to one
	// without the other fails loudly.
	assert.equal(TEAM_BRIDGE_IMAGE_MAX_BLOB_BYTES, 5 * 1024 * 1024);
	assert.deepEqual([...TEAM_BRIDGE_IMAGE_ALLOWED_MIMES].sort(), [
		"image/jpeg",
		"image/png",
	]);
});

test("the key hashes the receipt, and the index names no id and no account", async () => {
	const receipt = receiptOf("k1");
	const key = teamBridgeImageKey(receipt);
	assert.equal(key.length, 64);
	assert.match(key, TEAM_BRIDGE_IMAGE_KEY);
	for (const id of [
		receipt.tenantId,
		receipt.conversationId,
		receipt.messageId,
		receipt.attachmentId,
		receipt.expectedAccountId,
	])
		assert.ok(!key.includes(id), `a key must not contain a raw id (${id})`);

	// Every field changes the key: two receipts that differ in one id are two files.
	const variants = [
		receiptOf("k1", ACCOUNT_B),
		{ ...receipt, tenantId: "tenant_2" },
		{ ...receipt, conversationId: "conv_other" },
		{ ...receipt, messageId: "msg_other" },
		{ ...receipt, attachmentId: "batt_other" },
	];
	for (const variant of variants)
		assert.notEqual(teamBridgeImageKey(variant), key);

	const { cache } = await openCache();
	await cache.store(key, PNG, bytesOf(4), FP_A);
	const index = await readIndex(cache.directory);
	assert.equal(index.version, 1);
	const entry = index.entries[key];
	assert.equal(entry.account, FP_A);
	assert.equal(entry.mime, PNG);
	assert.equal(entry.size, 4);

	const raw = await readFile(join(cache.directory, "index.json"), "utf8");
	for (const secret of [
		ACCOUNT_A,
		receipt.tenantId,
		receipt.conversationId,
		receipt.messageId,
		receipt.attachmentId,
	])
		assert.ok(!raw.includes(secret), `the index must not name ${secret}`);
	// The only names on disk are the hash and the index itself.
	assert.deepEqual(
		(await readdir(cache.directory)).sort(),
		["index.json", key].sort(),
	);
});

test("a stored image is served for the receipt that stored it", async () => {
	const { cache } = await openCache();
	const receipt = receiptOf("hit");
	const key = teamBridgeImageKey(receipt);
	await cache.store(key, PNG, bytesOf(9, 3), FP_A);
	const hit = await cache.read(key, FP_A);
	assert.equal(hit?.mime, PNG);
	assert.deepEqual([...(hit?.bytes ?? [])], [...bytesOf(9, 3)]);
	assert.equal(cache.stats().hits, 1);
	assert.equal(cache.stats().entries, 1);
	assert.equal(cache.stats().residentBytes, 9);
});

test("another account's receipt is a miss, and the first account's entry survives", async () => {
	const { cache } = await openCache();
	const receiptA = receiptOf("shared", ACCOUNT_A);
	const receiptB = receiptOf("shared", ACCOUNT_B);
	const keyA = teamBridgeImageKey(receiptA);
	const keyB = teamBridgeImageKey(receiptB);
	assert.notEqual(keyA, keyB, "the account must change the key");

	await cache.store(keyA, PNG, bytesOf(5, 1), FP_A);
	await cache.store(keyB, JPEG, bytesOf(6, 2), FP_B);

	assert.deepEqual(
		[...((await cache.read(keyA, FP_A))?.bytes ?? [])],
		[1, 1, 1, 1, 1],
	);
	assert.deepEqual(
		[...((await cache.read(keyB, FP_B))?.bytes ?? [])],
		[2, 2, 2, 2, 2, 2],
	);

	// A replayed key (the same key asked for under another receipt) is a miss, and
	// is deliberately not a delete: the owner's entry still answers the owner.
	assert.equal(await cache.read(keyA, FP_B), null);
	assert.equal(cache.stats().foreignHits, 1);
	assert.equal(cache.stats().entries, 2);
	assert.deepEqual(
		[...((await cache.read(keyA, FP_A))?.bytes ?? [])],
		[1, 1, 1, 1, 1],
	);
});

test("an image past its TTL is a miss and its bytes are swept", async () => {
	const { cache, clock } = await openCache({ ttlMs: 1000 });
	const receipt = receiptOf("ttl");
	const key = teamBridgeImageKey(receipt);
	await cache.store(key, PNG, bytesOf(4), FP_A);
	assert.ok(await cache.read(key, FP_A), "fresh entry answers");

	clock.now = 1000;
	assert.equal(await cache.read(key, FP_A), null, "an expired image is a miss");
	// The sweep a read triggers is queued behind it; a store drains that queue, which
	// is what makes this assertion deterministic rather than a sleep.
	await cache.store(
		teamBridgeImageKey(receiptOf("ttl2")),
		PNG,
		bytesOf(1),
		FP_A,
	);
	assert.equal(
		(await diskEntries(cache.directory)).has(key),
		false,
		"the expired blob is gone from disk too",
	);
});

test("the entry cap evicts the least recently used, not the newest", async () => {
	const { cache, clock } = await openCache({ maxCount: 3 });
	const keys = [1, 2, 3, 4].map((n) =>
		teamBridgeImageKey(receiptOf(`lru${n}`)),
	);
	await cache.store(keys[0], PNG, bytesOf(2), FP_A);
	clock.now = 1;
	await cache.store(keys[1], PNG, bytesOf(2), FP_A);
	clock.now = 2;
	await cache.store(keys[2], PNG, bytesOf(2), FP_A);

	// Touch the OLDEST, which is what LRU-by-use means: it must survive the next
	// store while the second-oldest goes.
	clock.now = 3;
	assert.ok(await cache.read(keys[0], FP_A));
	clock.now = 4;
	await cache.store(keys[3], PNG, bytesOf(2), FP_A);

	assert.deepEqual(
		cache.ids().slice().sort(),
		[keys[0], keys[2], keys[3]].sort(),
	);
	assert.equal(cache.stats().entries, 3);
	assert.equal(cache.stats().evictions, 1);
	const onDisk = await diskEntries(cache.directory);
	assert.equal(onDisk.has(keys[1]), false, "the evicted blob is unlinked");
	assert.equal(onDisk.size, 3);
});

test("the byte cap evicts oldest-first until the total fits", async () => {
	// The shipped bound is 128 MB; eviction is driven here with a 10-byte budget
	// because writing 128 MB to prove a `while (total > max)` loop is a waste of the
	// machine. The constant itself is pinned in the first test.
	const { cache, clock } = await openCache({ maxBytes: 10, maxCount: 100 });
	const keys = [1, 2, 3].map((n) => teamBridgeImageKey(receiptOf(`bytes${n}`)));
	await cache.store(keys[0], PNG, bytesOf(4), FP_A);
	clock.now = 1;
	await cache.store(keys[1], PNG, bytesOf(4), FP_A);
	assert.equal(cache.stats().residentBytes, 8);
	clock.now = 2;
	await cache.store(keys[2], PNG, bytesOf(4), FP_A);

	assert.equal(cache.stats().residentBytes, 8, "the oldest blob made room");
	assert.deepEqual(cache.ids().slice().sort(), [keys[1], keys[2]].sort());
	assert.equal((await diskEntries(cache.directory)).has(keys[0]), false);
});

test("a corrupt index is discarded rather than trusted", async () => {
	const dir = await tempDir();
	await writeFile(join(dir, "index.json"), "{ not json at all");
	await writeFile(join(dir, sha256("orphan")), "stale bytes");
	const cache = new TeamBridgeImageCache({ dir, now: () => 0 });
	await cache.open();
	assert.equal(cache.stats().entries, 0);
	assert.equal(cache.stats().residentBytes, 0);
	assert.deepEqual(
		await readdir(dir),
		["index.json"],
		"its files became orphans",
	);
});

test("a wrong-version index is discarded, and a path-shaped row is dropped", async () => {
	const dir = await tempDir();
	const key = teamBridgeImageKey(receiptOf("ver"));
	const entry = {
		mime: PNG,
		size: 3,
		storedAt: 0,
		lastUsedAt: 0,
		account: FP_A,
	};
	await writeFile(
		join(dir, "index.json"),
		JSON.stringify({ version: 99, entries: { [key]: entry } }),
	);
	await writeFile(join(dir, key), "abc");
	const older = new TeamBridgeImageCache({ dir, now: () => 0 });
	await older.open();
	assert.equal(
		older.stats().entries,
		0,
		"another version's index is not migrated",
	);
	assert.equal(await older.read(key, FP_A), null);

	// The same document at THIS version, but one row spelling a path: that row is
	// dropped on load, and its file is then an orphan.
	await writeFile(
		join(dir, "index.json"),
		JSON.stringify({
			version: 1,
			principal: null,
			entries: {
				[`../${"a".repeat(61)}`]: entry,
				"../../etc/passwd": entry,
			},
		}),
	);
	const current = new TeamBridgeImageCache({ dir, now: () => 0 });
	await current.open();
	assert.equal(current.stats().entries, 0);
	assert.deepEqual(await readdir(dir), ["index.json"]);
});

test("a path-shaped key is refused on store and on read", async () => {
	const { cache } = await openCache();
	for (const key of [
		"../../etc/passwd",
		"/tmp/escape",
		`${"a".repeat(63)}/`,
		"a".repeat(63),
		"A".repeat(64),
	]) {
		await cache.store(key, PNG, bytesOf(4), FP_A);
		assert.equal(await cache.read(key, FP_A), null);
	}
	assert.equal(cache.stats().entries, 0, "no entry, so no file name");
	// Nothing was ever stored, so the directory holds no index and no file: a refused
	// key cannot even cause a write.
	assert.deepEqual(await readdir(cache.directory), []);
});

test("an orphaned blob is reaped at open, and a stale row never returns bytes", async () => {
	const dir = await tempDir();
	const key = teamBridgeImageKey(receiptOf("orphan"));
	const orphan = sha256("nobody-indexed-this");
	await writeFile(join(dir, orphan), "unindexed bytes");

	const cache = new TeamBridgeImageCache({ dir, now: () => 0 });
	await cache.open();
	assert.equal((await readdir(dir)).includes(orphan), false, "orphan reaped");

	await cache.store(key, PNG, bytesOf(6), FP_A);
	await rm(join(dir, key));
	const hit = await cache.read(key, FP_A);
	assert.equal(hit, null, "a row whose file is gone is a miss");
	assert.equal(cache.stats().entries, 0, "and the claim is dropped");

	// A file that is not the length the index recorded is a partial write that got
	// renamed into place: no bytes rather than short ones.
	await cache.store(key, PNG, bytesOf(6), FP_A);
	await writeFile(join(dir, key), "abc");
	assert.equal(await cache.read(key, FP_A), null);
	assert.equal(cache.stats().entries, 0);
});

test("a non-image mime is never stored, and cannot be read back", async () => {
	const { cache } = await openCache();
	const key = teamBridgeImageKey(receiptOf("mime"));
	for (const mime of [
		"image/svg+xml",
		"text/html",
		"application/octet-stream",
	]) {
		await cache.store(key, mime, bytesOf(4), FP_A);
	}
	assert.equal(cache.stats().entries, 0);

	// A hand-edited index claiming a document type is a miss on the way OUT as well.
	await writeFile(
		join(cache.directory, "index.json"),
		JSON.stringify({
			version: 1,
			principal: FP_A,
			entries: {
				[key]: {
					mime: "image/svg+xml",
					size: 4,
					storedAt: 0,
					lastUsedAt: 0,
					account: FP_A,
				},
			},
		}),
	);
	const reopened = new TeamBridgeImageCache({
		dir: cache.directory,
		now: () => 0,
	});
	await writeFile(join(cache.directory, key), "<svg/>");
	await reopened.open();
	assert.equal(
		await reopened.read(key, FP_A),
		null,
		"the allowlist applies on the way OUT of a hand-edited index too",
	);
	assert.equal(await reopened.read(key, "b".repeat(32)), null);
});

test("the directory is 0700 and its files are 0600", async () => {
	const { cache } = await openCache();
	const key = teamBridgeImageKey(receiptOf("mode"));
	await cache.store(key, PNG, bytesOf(4), FP_A);
	assert.equal((await stat(cache.directory)).mode & 0o777, 0o700);
	assert.equal((await stat(join(cache.directory, key))).mode & 0o777, 0o600);
	assert.equal(
		(await stat(join(cache.directory, "index.json"))).mode & 0o777,
		0o600,
	);
});

test("two reads of the same image cost exactly ONE upstream fetch", async () => {
	const hub = await startHub({
		status: 200,
		contentType: PNG,
		bytes: bytesOf(64, 4),
	});
	const { cache, clock } = await openCache();
	const receipt = receiptOf("net");

	// BEFORE: with no cache attached - the shipped behaviour - each read is a fetch.
	await fetchThroughRelay(hub.backendUrl, receipt, null);
	await fetchThroughRelay(hub.backendUrl, receipt, null);
	assert.equal(
		hub.state.requests.length,
		2,
		"two reads without a cache, two fetches",
	);
	assert.equal(
		hub.state.requests[0].authorization,
		`Bearer ${TOKEN}`,
		"the fetch carries the relay's own bearer",
	);

	// AFTER: the first read fetches and stores, the second is answered from disk.
	const first = await fetchThroughRelay(hub.backendUrl, receipt, cache);
	assert.equal(first.response.kind, "bytes");
	assert.equal(first.response.mimeType, PNG);
	assert.deepEqual([...first.response.data], [...bytesOf(64, 4)]);
	assert.equal(hub.state.requests.length, 3);

	const second = await fetchThroughRelay(hub.backendUrl, receipt, cache);
	assert.equal(second.response.kind, "bytes");
	assert.equal(second.response.status, 200);
	assert.equal(second.response.mimeType, PNG);
	assert.deepEqual([...second.response.data], [...bytesOf(64, 4)]);
	assert.equal(hub.state.requests.length, 3, "the second read made no request");
	assert.equal(cache.stats().hits, 1);

	// The same again through a FRESH cache over the same directory: the survival of
	// the bytes is what makes this a restart win rather than a process-memory one. It
	// keeps the first cache's clock, because expiry is measured from the `storedAt`
	// that clock wrote.
	const reopened = new TeamBridgeImageCache({
		dir: cache.directory,
		now: () => clock.now,
	});
	await reopened.open();
	const third = await fetchThroughRelay(hub.backendUrl, receipt, reopened);
	assert.equal(third.response.kind, "bytes");
	assert.equal(
		hub.state.requests.length,
		3,
		"a restart still serves from disk",
	);
});

/*
 * Convergence of the image cache with the generic-file Save lane (a-fdf0, PR
 * #1735). The cache key hashes the five receipt ids and not `mode`, so without the
 * guard in `imageCacheAddress` a `mode=file` Save of a receipt whose picture is
 * already cached was answered from disk: the image bytes, no `?mode=file` fetch.
 */
const FILE_MODE_QUERY = /[?&]mode=file(&|$)/;

test("a mode=file read bypasses the image cache in both directions", async () => {
	const hub = await startHub({
		status: 200,
		contentType: PNG,
		bytes: bytesOf(32, 5),
	});
	const { cache } = await openCache();
	const receipt = receiptOf("filelane");

	await fetchThroughRelay(hub.backendUrl, receipt, cache);
	assert.equal(hub.state.requests.length, 1, "the picture was fetched once");
	assert.equal(cache.stats().entries, 1, "and stored");

	hub.state.mode = {
		status: 200,
		contentType: "application/octet-stream",
		bytes: bytesOf(16, 9),
	};
	const file = await requestDesktopMediaOutcome(
		{ op: "team_bridge.attachment", mode: "file", ...receipt },
		null,
		hub.backendUrl,
		TOKEN,
		cache,
	);
	assert.equal(hub.state.requests.length, 2, "the file read reached the hub");
	assert.match(hub.state.requests[1].url, FILE_MODE_QUERY);
	// The hub stub omits the file lane's hardening headers, so the file reader
	// refuses the body; what matters here is that the answer came from the hub
	// (`answered`), never from the cached picture (a hit is `answered: false`).
	assert.equal(file.answered, true, "answered by the hub, not by the cache");
	assert.notEqual(file.response.kind, "bytes", "the picture was not served");
	assert.equal(cache.stats().hits, 0, "the cached picture was never served");
	assert.equal(cache.stats().entries, 1, "and the file was not stored");
});

test("a failed fetch is not stored and cannot damage an existing entry", async () => {
	const hub = await startHub({
		status: 200,
		contentType: JPEG,
		bytes: bytesOf(8, 5),
	});
	const good = receiptOf("fail-good");
	const { cache } = await openCache();

	const stored = await fetchThroughRelay(hub.backendUrl, good, cache);
	assert.equal(stored.response.kind, "bytes");
	assert.equal(cache.stats().entries, 1);

	hub.state.mode = { status: 500, contentType: "application/json" };
	const bad = receiptOf("fail-bad");
	const failed = await fetchThroughRelay(hub.backendUrl, bad, cache);
	assert.notEqual(failed.response.kind, "bytes");
	assert.equal(cache.stats().entries, 1, "a failure stores nothing");
	assert.equal(cache.stats().residentBytes, 8);

	// The stored image is untouched by that failure, and still answers.
	hub.state.mode = { status: 500, contentType: "application/json" };
	const stillThere = await fetchThroughRelay(hub.backendUrl, good, cache);
	assert.equal(stillThere.response.kind, "bytes");
	assert.equal(stillThere.response.mimeType, JPEG);
	assert.deepEqual([...stillThere.response.data], [...bytesOf(8, 5)]);
});

test("the relay refuses a non-picture before it can reach the cache", async () => {
	const hub = await startHub({
		status: 200,
		contentType: "image/svg+xml",
		bytes: new Uint8Array(Buffer.from("<svg onload='alert(1)'/>")),
	});
	const { cache } = await openCache();
	const outcome = await fetchThroughRelay(
		hub.backendUrl,
		receiptOf("svg"),
		cache,
	);
	assert.equal(outcome.response.kind, "error");
	assert.equal(outcome.response.status, 502);
	assert.equal(cache.stats().entries, 0, "nothing was stored");
	assert.equal(cache.stats().residentBytes, 0);
});

test("stats() bytes equal the sum on disk after a randomized run", async () => {
	// A seeded LCG: the sequence is the same every run, so a failure is
	// reproducible, and it is still arbitrary enough to hit the interleavings I would
	// not think to write by hand.
	let seed = 0x5eed1234;
	const next = () => {
		seed = (seed * 1664525 + 1013904223) % 2 ** 32;
		return seed / 2 ** 32;
	};
	const pick = (n) => Math.floor(next() * n);

	const { cache, clock } = await openCache({
		maxBytes: 4096,
		maxCount: 12,
		// Reads must not trigger a background sweep here: the assertion below compares
		// a quiescent cache against the directory, so every mutation stays awaited.
		sweepIntervalMs: Number.POSITIVE_INFINITY,
	});
	const receipts = Array.from({ length: 24 }, (_, i) => receiptOf(`rnd${i}`));

	for (let step = 0; step < 400; clock.now += 1, step++) {
		const which = receipts[pick(receipts.length)];
		// Two thirds of the steps are the first account, so a run leaves foreign
		// entries in the directory as well as its own.
		const account = pick(3) === 0 ? ACCOUNT_B : ACCOUNT_A;
		const receipt = { ...which, expectedAccountId: account };
		const key = teamBridgeImageKey(receipt);
		const fingerprint = teamBridgeImageAccountFingerprint(account);
		const roll = next();
		if (roll < 0.55) {
			const size = 1 + pick(700);
			await cache.store(
				key,
				pick(2) === 0 ? PNG : JPEG,
				bytesOf(size, pick(255)),
				fingerprint,
			);
		} else if (roll < 0.9) {
			await cache.read(key, fingerprint);
		} else if (roll < 0.98) {
			await cache.clear();
		} else {
			// A rare step: an out-of-band deletion, as an operator or a crash might leave
			// behind. The cache must not then report bytes that are not there.
			await rm(join(cache.directory, key), { force: true });
			await cache.read(key, fingerprint);
		}

		const stats = cache.stats();
		assert.ok(
			stats.residentBytes <= 4096,
			`byte bound held at step ${step}: ${stats.residentBytes}`,
		);
		assert.ok(stats.entries <= 12, `entry cap held at step ${step}`);
	}

	await settle();
	const onDisk = await diskEntries(cache.directory);
	const stats = cache.stats();
	const sumBytes = [...onDisk.values()].reduce(
		(total, size) => total + size,
		0,
	);
	assert.equal(
		onDisk.size,
		stats.entries,
		"every indexed entry has exactly one file, and no file is unindexed",
	);
	assert.equal(
		sumBytes,
		stats.residentBytes,
		"the cache's reported bytes are the bytes on disk",
	);
	assert.ok(stats.hits + stats.misses > 0, "the run actually exercised reads");
});

/*
 * THE WIRING, PINNED AS SOURCE. This is a shape check, not a runtime proof: it
 * cannot start Electron, so it cannot show the cache actually clears on a sign-out.
 * What it does prove is that the three lines which make that true are still there
 * and still in the right places - the construction under `userData`, the attach to
 * the media relay, and the clear on the principal fence - because a later edit that
 * drops one of them would otherwise be invisible to every other test here.
 */
/*
 * ROUND 1 REMEDIATION REGRESSIONS. One test per reproduced hole, each written
 * against the hole's own reproduction rather than against the fix: the fence tests
 * drive a real fetch in flight and a real pre-open clear, and the binding tests
 * drive both launch orderings.
 */

test("a cache hit is not transport evidence (F-1)", async () => {
	const hub = await startHub({
		status: 200,
		contentType: PNG,
		bytes: bytesOf(32, 2),
	});
	const { cache } = await openCache();
	const receipt = receiptOf("answered");

	const miss = await fetchThroughRelay(hub.backendUrl, receipt, cache);
	assert.equal(miss.response.kind, "bytes");
	assert.equal(
		miss.answered,
		true,
		"a fetch that resolved is transport evidence",
	);

	const hit = await fetchThroughRelay(hub.backendUrl, receipt, cache);
	assert.equal(hit.response.kind, "bytes");
	assert.equal(
		hit.answered,
		false,
		"a hit contacted no daemon, so it must not reset the probe-miss counter",
	);
	assert.equal(hub.state.requests.length, 1);
});

test("a store whose fetch was in flight when the fence fired is refused (F-2a)", async () => {
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const hub = await startHub({
		status: 200,
		contentType: PNG,
		bytes: bytesOf(16, 6),
	});
	hub.state.gate = gate;
	const { cache } = await openCache();

	const pending = fetchThroughRelay(hub.backendUrl, receiptOf("flight"), cache);
	// The request is at the hub and its response has not been written yet.
	await until(
		() => hub.state.requests.length === 1,
		"the fetch to reach the hub",
	);
	await cache.clear();
	release();

	const outcome = await pending;
	assert.equal(
		outcome.response.kind,
		"bytes",
		"the caller still gets the bytes it asked for",
	);
	assert.deepEqual(
		await readdir(cache.directory),
		["index.json"],
		"nothing was written after the fence emptied the directory",
	);
	assert.equal(cache.stats().entries, 0);
});

test("a store carrying a stale epoch is refused (F-2a, unit form)", async () => {
	const { cache } = await openCache();
	const key = teamBridgeImageKey(receiptOf("stale-epoch"));
	const stale = cache.currentEpoch();
	await cache.clear();
	await cache.store(key, PNG, bytesOf(4), FP_A, stale);
	assert.equal(cache.stats().entries, 0);
	assert.deepEqual(
		await readdir(cache.directory),
		["index.json"],
		"a refused write leaves no blob behind",
	);
});

test("a clear that lands before open() is honoured (F-2b / SEC-1)", async () => {
	const dir = await tempDir();
	const key = teamBridgeImageKey(receiptOf("preopen"));
	const seed = new TeamBridgeImageCache({ dir: dir, now: () => 0 });
	await seed.open();
	await seed.store(key, PNG, bytesOf(8, 3), FP_A);
	assert.equal((await diskEntries(dir)).size, 1);

	// A fresh instance that has never opened: the fence lands while `open()` has not
	// even started.
	const cache = new TeamBridgeImageCache({ dir: dir, now: () => 0 });
	await cache.clear();
	await cache.open();
	assert.equal(cache.stats().entries, 0);
	assert.equal(
		await cache.read(key, FP_A),
		null,
		"the old receipt no longer hits",
	);
	assert.deepEqual(await readdir(dir), ["index.json"]);
});

test("a clear kept through a FAILED open still wipes on the next open (SEC-1)", async () => {
	const parent = await tempDir();
	const dir = join(parent, "cache");
	// A file where the directory should be: `open()` refuses, and stays unopened.
	await writeFile(dir, "not a directory");
	const cache = new TeamBridgeImageCache({ dir: dir, now: () => 0 });
	await assert.rejects(cache.open());
	await cache.clear();

	// The obstacle goes, and a previous run's bytes are there.
	await rm(dir);
	await mkdir(dir, { recursive: true });
	const key = teamBridgeImageKey(receiptOf("failedopen"));
	const seed = new TeamBridgeImageCache({ dir: dir, now: () => 0 });
	await seed.open();
	await seed.store(key, PNG, bytesOf(8, 4), FP_A);

	await cache.open();
	assert.equal(
		cache.stats().entries,
		0,
		"the remembered clear is honoured, not swallowed by the failed open",
	);
	assert.equal(await cache.read(key, FP_A), null);
});

test("a read that began before a clear is a miss (SEC-2)", async () => {
	const { cache } = await openCache();
	const key = teamBridgeImageKey(receiptOf("read-race"));
	await cache.store(key, PNG, bytesOf(6, 1), FP_A);

	// The read captures its epoch in this tick; the clear bumps it in the same tick,
	// before the read's queued turn. The old code served the entry here.
	const reading = cache.read(key, FP_A);
	const clearing = cache.clear();
	assert.equal(
		await reading,
		null,
		"a read that began before the fence must not be answered from it",
	);
	await clearing;
	assert.equal(await cache.read(key, FP_A), null);
});

test("the index is bound to a principal: same keeps, different drops, sign-out drops (SEC-3)", async () => {
	const dir = await cacheWithOneEntry("bind");
	const key = teamBridgeImageKey(receiptOf("bind"));
	const index = await readIndex(dir);
	assert.equal(
		index.principal,
		FP_A,
		"the document names a fingerprint, never an id",
	);

	// The app names the SAME account (either source, any ordering): the bytes stay,
	// which is the whole point of surviving a restart.
	const same = new TeamBridgeImageCache({ dir: dir, now: () => 0 });
	await same.open();
	await same.bind(ACCOUNT_A);
	assert.equal(same.stats().entries, 1);
	assert.ok(await same.read(key, FP_A));

	// A DIFFERENT account: dropped.
	const other = new TeamBridgeImageCache({ dir: dir, now: () => 0 });
	await other.open();
	await other.bind(ACCOUNT_B);
	assert.equal(other.stats().entries, 0);
	assert.equal(await other.read(key, FP_A), null);
	assert.deepEqual(await readdir(dir), ["index.json"]);

	// A VERIFIED sign-out: also dropped.
	const dir2 = await cacheWithOneEntry("signout");
	const out = new TeamBridgeImageCache({ dir: dir2, now: () => 0 });
	await out.open();
	await out.bind(null);
	assert.equal(out.stats().entries, 0);
	assert.deepEqual(await readdir(dir2), ["index.json"]);
});

test("open() applies the state check when it is given a principal (SEC-3)", async () => {
	// The shipped launch passes none (nothing has answered a status yet), but the check
	// is part of `open`'s contract for any caller that DOES know: bytes bound to one
	// account are never loaded under another, and a returned index with no binding is
	// discarded rather than trusted.
	const dir = await cacheWithOneEntry("open-check");
	const key = teamBridgeImageKey(receiptOf("open-check"));

	const other = new TeamBridgeImageCache({ dir: dir, now: () => 0 });
	await other.open(ACCOUNT_B);
	assert.equal(
		other.stats().entries,
		0,
		"another account's bytes are not loaded",
	);
	assert.equal(await other.read(key, FP_A), null);
	assert.deepEqual(
		await readdir(dir),
		["index.json"],
		"and they are gone from disk",
	);

	const same = new TeamBridgeImageCache({
		dir: await cacheWithOneEntry("open-keep"),
		now: () => 0,
	});
	await same.open(ACCOUNT_A);
	assert.equal(same.stats().entries, 1, "the right account keeps its cache");
});

test("the fence is a no-op before a principal is confirmed, and a wipe after (SEC-3)", async () => {
	const dir = await cacheWithOneEntry("fence");
	const key = teamBridgeImageKey(receiptOf("fence"));

	// Renderer-status-first launch, in the order index.ts wires it: the attention
	// service fires the transition fence (its `account` was null) and THEN announces
	// the principal. The fence must be a no-op here, or the cache cannot survive a
	// restart at all.
	const cache = new TeamBridgeImageCache({ dir: dir, now: () => 0 });
	await cache.open();
	await cache.fence();
	assert.equal(cache.stats().entries, 1, "a launch is not a transition");
	await cache.bind(ACCOUNT_A);
	assert.equal(cache.stats().entries, 1, "and the same account keeps them");
	assert.ok(await cache.read(key, FP_A));

	// A genuine transition: once a principal IS confirmed, the fence drops everything
	// - at that moment nobody knows which entries belonged to the departing account.
	await cache.fence();
	assert.equal(cache.stats().entries, 0, "a transition drops the bytes");
	assert.deepEqual(await readdir(cache.directory), ["index.json"]);
});

test("two orderings of the same launch end in the same state (SEC-3)", async () => {
	// Ordering A: the renderer status is first - fence (nothing confirmed, so a no-op)
	// then bind.
	const dirA = await cacheWithOneEntry("ordering");
	const a = new TeamBridgeImageCache({ dir: dirA, now: () => 0 });
	await a.open();
	await a.fence();
	await a.bind(ACCOUNT_A);
	assert.equal(
		a.stats().entries,
		1,
		"renderer-first keeps a returning account's cache",
	);

	// Ordering B: the reconcile poll is first - bind, and no fence at all, because the
	// service only fences on a real transition and a same-account reconcile is not one.
	const dirB = await cacheWithOneEntry("ordering");
	const b = new TeamBridgeImageCache({ dir: dirB, now: () => 0 });
	await b.open();
	await b.bind(ACCOUNT_A);
	assert.equal(b.stats().entries, 1, "reconcile-first keeps it too");
	assert.deepEqual(
		a.ids(),
		b.ids(),
		"both orderings end with the same entries",
	);

	// The state check is what makes either ordering safe: a principal that is NOT the
	// bound one drops the bytes, whichever source reported it first.
	const dirC = await cacheWithOneEntry("ordering");
	const c = new TeamBridgeImageCache({ dir: dirC, now: () => 0 });
	await c.open();
	await c.bind(ACCOUNT_B);
	assert.equal(c.stats().entries, 0, "a different account never inherits them");
});

test("an index row over the blob bound is dropped and never served (SEC-4 / F-3)", async () => {
	const dir = await tempDir();
	const key = teamBridgeImageKey(receiptOf("oversize"));
	const oversize = TEAM_BRIDGE_IMAGE_MAX_BLOB_BYTES + 1024;
	await writeFile(
		join(dir, "index.json"),
		JSON.stringify({
			version: 1,
			principal: FP_A,
			entries: {
				[key]: {
					mime: PNG,
					size: oversize,
					storedAt: 0,
					lastUsedAt: 0,
					account: FP_A,
				},
			},
		}),
	);
	await writeFile(join(dir, key), new Uint8Array(oversize));

	const cache = new TeamBridgeImageCache({ dir: dir, now: () => 0 });
	await cache.open();
	assert.equal(cache.stats().entries, 0, "the row is refused at load");
	assert.equal(
		cache.stats().residentBytes,
		0,
		"and cannot move the byte total",
	);
	assert.equal(await cache.read(key, FP_A), null);
	assert.deepEqual(await readdir(dir), ["index.json"], "its file is an orphan");
});

test("a hit and a miss report the same mime spelling (NIT-2)", async () => {
	const hub = await startHub({
		status: 200,
		contentType: "image/png; charset=binary",
		bytes: bytesOf(8, 1),
	});
	const { cache } = await openCache();
	const receipt = receiptOf("spelling");
	const miss = await fetchThroughRelay(hub.backendUrl, receipt, cache);
	const hit = await fetchThroughRelay(hub.backendUrl, receipt, cache);
	assert.equal(miss.response.mimeType, "image/png");
	assert.equal(hit.response.mimeType, "image/png");
});

test("read recency reaches the index, so the LRU order survives a restart (F-5)", async () => {
	const clock = { now: 0 };
	const { cache } = await openCache({ clock, sweepIntervalMs: 1000 });
	const older = teamBridgeImageKey(receiptOf("recency-old"));
	const newer = teamBridgeImageKey(receiptOf("recency-new"));
	await cache.store(older, PNG, bytesOf(2), FP_A);
	clock.now = 1;
	await cache.store(newer, PNG, bytesOf(2), FP_A);

	// Past the sweep interval, a read marks recency and the throttle flushes it.
	clock.now = 5000;
	assert.ok(await cache.read(older, FP_A));
	await settle();

	// A fresh instance over the same directory: `lastUsedAt` has to have reached the
	// index, or the eviction order after a restart is whatever it was at the last
	// store rather than the last read.
	const reread = new TeamBridgeImageCache({
		dir: cache.directory,
		now: () => clock.now,
	});
	await reread.open();
	assert.deepEqual(
		reread.ids(),
		[newer, older],
		"the image read last is the last thing an LRU pass would take",
	);
});

/**
 * A directory that already holds one stored image, for the tests whose subject is
 * what happens to EXISTING bytes when a principal arrives.
 */
async function cacheWithOneEntry(suffix) {
	const dir = await tempDir();
	const seed = new TeamBridgeImageCache({ dir, now: () => 0 });
	await seed.open();
	await seed.store(
		teamBridgeImageKey(receiptOf(suffix)),
		PNG,
		bytesOf(8, 5),
		FP_A,
	);
	return dir;
}

/*
 * R2-1 — THE ORDERING THE WHOLE PORT EXISTS FOR, and the one round 2 found broken.
 * A signed-out launch sends no renderer status at all (`useAgentMessages` gates its
 * check on a non-null account, and the surface's reads are `boundary: "surface_open"`),
 * so the reconcile poll is the ONLY witness to a principal that left while the app was
 * closed. Both caches are driven through the real service here, on the real fence and
 * resolver ports, because the bug lived in how the service reported the state, not in
 * either cache.
 */
test("a principal already gone at launch is dropped by the poll (R2-1)", async () => {
	const imageDir = await tempDir();
	const previewDir = await tempDir();
	const previewId = "a".repeat(32);

	// A previous run, signed in as A, left bytes in both caches.
	const imageSeed = new TeamBridgeImageCache({ dir: imageDir, now: () => 0 });
	await imageSeed.open();
	await imageSeed.store(
		teamBridgeImageKey(receiptOf("signout-launch")),
		PNG,
		bytesOf(8, 2),
		FP_A,
	);
	const previewSeed = new LinkPreviewArtifactCache({
		dir: previewDir,
		now: () => 0,
	});
	await previewSeed.open();
	await previewSeed.store(previewId, PNG, bytesOf(8, 3), FP_A);

	// The shipped launch: both caches opened with no principal, nothing answered yet.
	const imageCache = new TeamBridgeImageCache({ dir: imageDir, now: () => 0 });
	await imageCache.open();
	const previewCache = new LinkPreviewArtifactCache({
		dir: previewDir,
		now: () => 0,
	});
	await previewCache.open();
	assert.equal(imageCache.stats().entries, 1);
	assert.equal(previewCache.ids().length, 1);

	let statusReads = 0;
	const service = new AppAttentionService({
		request: async (input) => {
			const op = input && typeof input === "object" ? input.op : undefined;
			if (op !== "team_bridge.status")
				throw new Error(`unexpected op in this rig: ${op}`);
			statusReads += 1;
			return {
				status: 200,
				body: { result: { state: "signed_out", account_id: null } },
			};
		},
		publish: () => {},
		clear: () => {},
		principalChanged: () => {
			void imageCache.fence();
			void previewCache.fence();
		},
		principalResolved: (accountId) => {
			void imageCache.bind(accountId);
			void previewCache.bind(accountId);
		},
	});
	try {
		// Any bridge write asks for a bridge-only reconcile, which is the poll.
		service.observeResponse(
			{ op: "team_bridge.messages.send" },
			{ status: 200, body: { result: {} } },
		);
		await until(() => statusReads === 1, "the poll to read the bridge status");
		await settle();
		assert.equal(
			imageCache.stats().entries,
			0,
			"the signed-out poll empties the image cache",
		);
		assert.deepEqual(previewCache.ids(), [], "and the link-preview cache");

		// A second poll with nothing changed must not rewrite either index: the state is
		// announced every time, and `bind(null)` is guarded on something being bound.
		const before = [
			await stat(join(imageDir, "index.json")),
			await stat(join(previewDir, "index.json")),
		];
		service.observeResponse(
			{ op: "team_bridge.messages.send" },
			{ status: 200, body: { result: {} } },
		);
		await until(
			() => statusReads === 2,
			"the second poll to read the bridge status",
		);
		await settle();
		const after = [
			await stat(join(imageDir, "index.json")),
			await stat(join(previewDir, "index.json")),
		];
		assert.deepEqual(
			after.map((each) => [each.ino, each.mtimeMs]),
			before.map((each) => [each.ino, each.mtimeMs]),
			"a repeat sign-out does not rewrite the index",
		);
	} finally {
		service.stop();
	}
});

test("index.ts builds the cache, attaches it, and fences on a principal change", async () => {
	const main = await readFile(join(process.cwd(), "src/main/index.ts"), "utf8");
	assert.match(
		main,
		/dir: join\(app\.getPath\("userData"\), "cache", "team-bridge-images"\)/,
		"one directory under userData, named like its link-preview neighbour",
	);
	assert.match(main, /void teamBridgeImages\.open\(\)\.catch\(\(\) => \{\}\)/);
	assert.match(
		main,
		/backendService\.attachTeamBridgeImageCache\(teamBridgeImages\)/,
	);
	// Both principal ports are wired, and neither is a bare `clear()`: the transition
	// goes through `fence()` (a no-op until a principal is confirmed) and the state
	// through `bind()`, which owns the drop/no-drop decision inside the cache.
	const ports = main.slice(
		main.indexOf("principalChanged: () => {"),
		main.indexOf("const teamBridgeImages = new TeamBridgeImageCache("),
	);
	// Both caches take the same two ports, or the repository ends up with two
	// different principal rules for private bytes (#1721's fence, fixed here).
	assert.match(ports, /void linkPreviewArtifacts\.fence\(\);/);
	assert.match(ports, /void teamBridgeImages\.fence\(\);/);
	assert.match(ports, /void linkPreviewArtifacts\.bind\(accountId\);/);
	assert.match(ports, /principalResolved: \(accountId\) => \{/);
	assert.match(ports, /void teamBridgeImages\.bind\(accountId\);/);
});

/** A source-shape guard on the relay: the read comes before the fetch, and the
 * store only after the status and mime rules. Cheap, and it fails loudly if someone
 * moves either half. */
test("the relay reads the cache before the fetch and stores after the checks", async () => {
	const relay = await readFile(
		join(process.cwd(), "src/main/desktop-media.ts"),
		"utf8",
	);
	const read = relay.indexOf("const cached = await imageCache.read(");
	const fetchAt = relay.indexOf("const response = await fetch(");
	const store = relay.indexOf("await imageCache.store(");
	assert.ok(read > 0, "the relay reads the cache");
	assert.ok(fetchAt > read, "only after a miss does it fetch");
	assert.ok(store > fetchAt, "and it stores only the response it then returns");
	assert.match(relay, /response\.status === 200/);
});
