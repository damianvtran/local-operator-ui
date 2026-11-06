import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
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
	const state = { requests: [], mode: initial };
	const server = createServer((request, response) => {
		state.requests.push({
			url: request.url,
			authorization: request.headers.authorization,
		});
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
test("index.ts builds the cache, attaches it, and clears it on a principal change", async () => {
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
	// The clear lives in the attention service's own principal port, beside the
	// link-preview clear - the same fence, not a second one.
	const fence = main.slice(
		main.indexOf("principalChanged: () => {"),
		main.indexOf("const linkPreviewArtifacts = new LinkPreviewArtifactCache"),
	);
	assert.match(fence, /void linkPreviewArtifacts\.clear\(\);/);
	assert.match(fence, /void teamBridgeImages\.clear\(\);/);
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
