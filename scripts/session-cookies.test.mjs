/**
 * Contract tests for session-only cookie persistence.
 *
 * The shipped TypeScript is bundled in memory with esbuild and driven against a
 * fake jar and a real filesystem, the same way `browser-host.test.mjs` tests the
 * browser host's core. What that buys here is the part of this feature that is
 * about policy and ordering rather than about Chromium: which cookies may be
 * stored at all, what happens after a crash, what a clear owes before it reports
 * success, and what a keychain that is unavailable or useless does.
 *
 * WHAT THESE TESTS ARE NOT: proof that a real restart brings a real login back.
 * The jar is a fake, so nothing here has ever loaded a page, and the CHIPS
 * behaviour of the real runtime is not exercised. That evidence is
 * `scripts/session-cookie-electron.test.mjs` (real Chromium, two real processes)
 * and the app-level run recorded on the PR.
 */

import assert from "node:assert/strict";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/main/browser/session-cookies";',
			// The quit hold is bundled too: the defect it guards against is in an error
			// path of an Electron event handler, and this is the only way to drive that
			// path without booting the app (which would take the operator's focus and
			// log to their real log directory).
			'export * from "./src/main/browser/session-cookie-quit-hold";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	// `session-cookies.ts` imports Electron only as TYPES (the runtime piece lives
	// in `session-cookies-electron.ts`), so this needs no fixture — and it imports
	// `./profile` for a type only, which is why the bundle stays Electron-free.
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	SessionCookieVault,
	createDebuggerCookieJar,
	createSafeStorageCipher,
	createSessionCookieQuitHold,
	removeDurable,
	restoreParams,
	sessionCookiePaths,
	storedCookieFor,
	partitionKeyForWrite,
	isSessionCookie,
	cookieIdentity,
	attributeDrift,
	REFUSAL,
} = mod;

const PARTITION_TENANT = {
	topLevelSite: "https://tenant.example",
	hasCrossSiteAncestor: false,
};

/** A jar that records every write, so a test can assert on the parameters rather
 * than on a return value: the whole failure mode this feature has to avoid is a
 * write that is missing the partition key. */
function fakeJar(initial) {
	const cookies = [...initial];
	const writes = [];
	return {
		cookies,
		writes,
		async readAllCookies() {
			return cookies.map((cookie) => ({ ...cookie }));
		},
		async writeCookie(params) {
			writes.push(params);
			const domain = params.domain ?? new URL(params.url).hostname;
			const index = cookies.findIndex(
				(cookie) =>
					cookie.name === params.name &&
					cookie.domain === domain &&
					cookie.path === params.path,
			);
			const stored = {
				name: params.name,
				value: params.value,
				domain,
				path: params.path,
				secure: params.secure === true,
				httpOnly: params.httpOnly === true,
				session: params.expires === undefined,
				expires: params.expires ?? -1,
				sameSite: params.sameSite ?? null,
				priority: params.priority ?? "Medium",
				sourceScheme: params.sourceScheme ?? null,
				sourcePort: params.sourcePort ?? null,
				partitionKey: params.partitionKey ?? null,
			};
			if (index >= 0) cookies[index] = stored;
			else cookies.push(stored);
		},
	};
}

/** A cipher whose "ciphertext" is recognisable, and that can be told to refuse. */
function fakeCipher({
	available = true,
	reason = "no keychain in this test",
} = {}) {
	return {
		encrypted: [],
		availability: () => (available ? { ok: true } : { ok: false, reason }),
		encrypt(plaintext) {
			this.encrypted.push(plaintext);
			return Buffer.from(`cipher:${Buffer.from(plaintext).toString("base64")}`);
		},
		decrypt(ciphertext) {
			const text = ciphertext.toString("utf8");
			if (!text.startsWith("cipher:")) throw new Error("not our ciphertext");
			return Buffer.from(text.slice("cipher:".length), "base64").toString(
				"utf8",
			);
		},
	};
}

const cookiesFor = (overrides = []) => [
	{
		name: "session_plain",
		value: "v1",
		domain: "app.example",
		path: "/",
		secure: true,
		httpOnly: false,
		session: true,
		expires: -1,
		sameSite: "Lax",
		sourceScheme: "Secure",
		sourcePort: 443,
		...overrides[0],
	},
	{
		name: "session_partitioned",
		value: "v2",
		domain: "third.example",
		path: "/",
		secure: true,
		httpOnly: true,
		session: true,
		expires: -1,
		sameSite: "None",
		partitionKey: { ...PARTITION_TENANT },
		sourceScheme: "Secure",
		sourcePort: 443,
		...overrides[1],
	},
	{
		name: "persistent",
		value: "v3",
		domain: "app.example",
		path: "/",
		secure: true,
		httpOnly: false,
		session: false,
		expires: Date.now() / 1000 + 3600,
		sameSite: "Lax",
		...overrides[2],
	},
];

let root;
const dirFor = (name) => {
	const dir = join(root, name);
	return { dir, ...sessionCookiePaths(dir) };
};
const makeVault = (jar, cipher, paths, log, extra = {}) =>
	new SessionCookieVault({
		jar,
		cipher,
		snapshotPath: paths.snapshotPath,
		markerPath: paths.markerPath,
		clearSessionData: async () => {},
		log,
		...extra,
	});

/** The app's own lifecycle: the restore warms the jar channel before anything can
 * browse, and the snapshot happens on the way out. `snapshot()` refuses to be the
 * first user of that channel, because opening it on the quit path needs a renderer
 * and a renderer created while the app tears down never comes up. */
const savedSnapshot = async (jar, cipher, paths, log, extra = {}) => {
	const vault = makeVault(jar, cipher, paths, log, extra);
	await vault.restore();
	return vault.snapshot();
};

const collector = () => {
	const lines = [];
	return { lines, log: (message) => lines.push(message) };
};

/** Declared outside the hooks so `after` can clear it (see `before`). */
let loopHold = null;

before(() => {
	root = mkdtempSync(join(tmpdir(), "lop-session-cookies-"));
	/*
	 * Hold the loop for this file's duration, because the timers this file waits on
	 * are unref'd on purpose and a case that awaits one therefore depends on
	 * something ELSE keeping the process alive.
	 *
	 * The hold's quit budget and the jar layer's per-call deadline are unref'd
	 * because neither may be the reason the app is still alive, which is right in
	 * the app and fatal to a test that waits on one alone: under the Node 22 the CI
	 * job runs, the loop drains at the first case that only awaits such a timer and
	 * the runner cancels it and its successors. Measured, not assumed - `a stop that
	 * never settles is released at the budget` was cancelled 10 ms into its own
	 * 120 ms budget with "Promise resolution is still pending but the event loop has
	 * already resolved", and the four cases after it went with it, while the same
	 * file passes on Node 26 (whose runner keeps a handle of its own).
	 *
	 * Bounded rather than open-ended, so a genuine regression - a budget that never
	 * fires - still ends the file instead of holding the job open; cleared in
	 * `after`. It asserts nothing and changes no expectation.
	 */
	loopHold = setTimeout(() => {}, 30_000);
});
after(() => {
	clearTimeout(loopHold);
	rmSync(root, { recursive: true, force: true });
});

test("a clean cycle stores only session cookies, and restores their attributes", async () => {
	const paths = dirFor("clean");
	const { log } = collector();
	const jar = fakeJar(cookiesFor());
	const vault = makeVault(jar, fakeCipher(), paths, log);
	// The app's own order: the restore runs (and warms the jar channel) before
	// anything browses, and the snapshot happens on the way out.
	await vault.restore();

	const saved = await vault.snapshot();
	assert.equal(saved.written, true);
	assert.equal(
		saved.saved,
		2,
		"the persistent cookie is not the vault's business",
	);

	// A restart: the jar comes back with only the persistent cookie, exactly as
	// Chromium leaves it (session cookies do not survive the process).
	const afterRestart = fakeJar([cookiesFor()[2]]);
	const restoring = makeVault(afterRestart, fakeCipher(), paths, log);
	const report = await restoring.restore();
	assert.equal(report.outcome, "restored");
	assert.equal(report.restored, 2);
	assert.deepEqual(report.failed, []);
	assert.deepEqual(report.drifted, []);

	const plain = afterRestart.writes.find((w) => w.name === "session_plain");
	assert.equal(plain.secure, true);
	assert.equal(plain.httpOnly, false);
	assert.equal(plain.sameSite, "Lax");
	assert.equal(
		plain.partitionKey,
		undefined,
		"an unpartitioned cookie stays unpartitioned",
	);
	assert.equal(
		plain.expires,
		undefined,
		"no expiry is how the cookie comes back as a session cookie",
	);
	assert.equal(plain.path, "/");

	const partitioned = afterRestart.writes.find(
		(w) => w.name === "session_partitioned",
	);
	assert.deepEqual(partitioned.partitionKey, {
		topLevelSite: "https://tenant.example",
		hasCrossSiteAncestor: false,
	});
	assert.equal(partitioned.httpOnly, true);

	// The persistent cookie was neither snapshotted nor rewritten.
	assert.equal(
		afterRestart.writes.some((w) => w.name === "persistent"),
		false,
	);
});

test("the naive channel's failure mode is real: it writes the cookie without its partition key", () => {
	// This is the guard's non-vacuous half. The Electron cookie API reports a
	// partitioned cookie with NO partition information at all (measured on the
	// pinned runtime), so a design built on that API writes exactly what it read:
	// no `partitionKey`, which is an unpartitioned cookie offered to every
	// top-level site. The vault must never produce that shape for this cookie.
	const read = cookiesFor()[1];
	const naive = {
		url: `https://${read.domain}${read.path}`,
		name: read.name,
		value: read.value,
		secure: read.secure,
		httpOnly: read.httpOnly,
		sameSite: read.sameSite,
	};
	assert.equal("partitionKey" in naive, false);

	const vaultWrite = restoreParams(storedCookieFor(read).cookie);
	assert.deepEqual(vaultWrite.partitionKey, {
		topLevelSite: "https://tenant.example",
		hasCrossSiteAncestor: false,
	});
});

test("a cookie whose partition identity cannot be represented is refused, not flattened", async () => {
	const paths = dirFor("partition-refusal");
	const { lines, log } = collector();
	const opaque = {
		...cookiesFor()[1],
		name: "session_opaque",
		partitionKey: undefined,
		partitionKeyOpaque: true,
	};
	const incomplete = {
		...cookiesFor()[1],
		name: "session_incomplete",
		// Measured: the setter rejects a partition key that does not carry
		// `hasCrossSiteAncestor`, so this key cannot be restored as it was.
		partitionKey: { topLevelSite: "https://tenant.example" },
	};
	const jar = fakeJar([...cookiesFor(), opaque, incomplete]);
	const vault = makeVault(jar, fakeCipher(), paths, log);
	await vault.restore();
	const saved = await vault.snapshot();

	assert.equal(saved.saved, 2);
	assert.deepEqual(
		saved.refused.map((entry) => [entry.name, entry.reason]).sort(),
		[
			["session_incomplete", REFUSAL.partitionUnrepresentable],
			["session_opaque", REFUSAL.partitionUnrepresentable],
		],
	);
	assert.match(lines.join("\n"), /not saving session_opaque/);

	// And the refusal survives the round trip: neither name is ever written.
	const afterRestart = fakeJar([]);
	await makeVault(afterRestart, fakeCipher(), paths, log).restore();
	assert.deepEqual(afterRestart.writes.map((w) => w.name).sort(), [
		"session_partitioned",
		"session_plain",
	]);
});

test("host-only and domain scope are separate: only a dotted domain is sent as `domain`", () => {
	const hostOnly = storedCookieFor({
		...cookiesFor()[0],
		domain: "app.example",
	}).cookie;
	const domainCookie = storedCookieFor({
		...cookiesFor()[0],
		domain: ".app.example",
	}).cookie;
	assert.equal(
		restoreParams(hostOnly).domain,
		undefined,
		"host-only writes no domain",
	);
	assert.equal(restoreParams(hostOnly).url, "https://app.example/");
	assert.equal(restoreParams(domainCookie).domain, ".app.example");
});

test("a non-Secure cookie is written through an http url, because an https one forces Secure", () => {
	// Measured: `Network.setCookie` with an https url stores `secure: true` even
	// when asked for `false`, so the scheme has to follow the attribute rather
	// than the recorded source scheme.
	const insecure = storedCookieFor({
		...cookiesFor()[0],
		secure: false,
		sourceScheme: "Secure",
		sourcePort: 443,
	}).cookie;
	const params = restoreParams(insecure);
	assert.equal(params.secure, false);
	assert.equal(params.url, "http://app.example/");
	assert.equal(
		params.sourceScheme,
		"Secure",
		"the recorded source scheme still travels",
	);
});

test("unspecified SameSite stays unspecified, and an explicit one survives", () => {
	const unspecified = storedCookieFor({
		...cookiesFor()[0],
		sameSite: null,
	}).cookie;
	const strict = storedCookieFor({
		...cookiesFor()[0],
		sameSite: "Strict",
	}).cookie;
	assert.equal("sameSite" in restoreParams(unspecified), false);
	assert.equal(restoreParams(strict).sameSite, "Strict");
});

test("session-vs-persistent is read from either field, so an odd build cannot smuggle a persistent cookie in", () => {
	assert.equal(isSessionCookie({ session: true }), true);
	assert.equal(isSessionCookie({ expires: -1 }), true);
	assert.equal(isSessionCookie({ session: false, expires: 12345 }), false);
});

test("an unclean run's snapshot is discarded, and the marker is written before anything else", async () => {
	const paths = dirFor("crash");
	const { lines, log } = collector();
	await savedSnapshot(fakeJar(cookiesFor()), fakeCipher(), paths, log);
	assert.equal(existsSync(paths.snapshotPath), true);
	assert.equal(
		existsSync(paths.markerPath),
		false,
		"a clean shutdown removes the marker",
	);

	// Now the crash: the marker is on disk with the snapshot, which is exactly the
	// state a run that died mid-browse leaves behind.
	writeFileSync(
		paths.markerPath,
		JSON.stringify({ generation: "crashed-run" }),
	);
	const afterCrash = fakeJar([]);
	const report = await makeVault(
		afterCrash,
		fakeCipher(),
		paths,
		log,
	).restore();
	assert.equal(report.outcome, "unclean-previous-run");
	assert.equal(report.restored, 0);
	assert.deepEqual(afterCrash.writes, []);
	assert.equal(
		existsSync(paths.snapshotPath),
		false,
		"the stale snapshot is removed",
	);
	assert.match(lines.join("\n"), /did not shut down cleanly/);
});

test("an unreadable marker still proves a run did not finish cleanly", async () => {
	const paths = dirFor("crash-unreadable-marker");
	const { log } = collector();
	await savedSnapshot(fakeJar(cookiesFor()), fakeCipher(), paths, log);
	writeFileSync(paths.markerPath, "this is not json");
	const jar = fakeJar([]);
	const report = await makeVault(jar, fakeCipher(), paths, log).restore();
	assert.equal(report.outcome, "unclean-previous-run");
	assert.deepEqual(jar.writes, []);
});

test("a corrupt or truncated snapshot is refused and removed, never half-applied", async () => {
	const paths = dirFor("corrupt");
	const { lines, log } = collector();
	await savedSnapshot(fakeJar(cookiesFor()), fakeCipher(), paths, log);
	const whole = readFileSync(paths.snapshotPath);
	writeFileSync(
		paths.snapshotPath,
		whole.subarray(0, Math.floor(whole.length / 2)),
	);

	const jar = fakeJar([]);
	const report = await makeVault(jar, fakeCipher(), paths, log).restore();
	assert.equal(report.outcome, "unreadable");
	assert.deepEqual(
		jar.writes,
		[],
		"nothing from a half-written document is applied",
	);
	assert.equal(existsSync(paths.snapshotPath), false);
	assert.match(lines.join("\n"), /could not be read/);
});

/**
 * Rewrite the stored snapshot's document in place, leaving everything the file
 * carries around it — the encoding's own framing, and the integrity digest —
 * exactly as it was. The result is as well-formed as the file it replaces: it is
 * the *content* that changed, which is the shape a targeted corruption takes when
 * it must stay parseable. Deliberately written so it works on a sealed snapshot
 * and on an unsealed one alike, because what the test below is about is WHICH
 * guard refuses the rewrite, not what the format happens to be.
 */
const rewriteStoredValue = (path, from, to) => {
	const text = readFileSync(path).toString("latin1");
	const start = "cipher:".length;
	assert.ok(
		text.startsWith("cipher:"),
		"the snapshot is not in the encoded shape this test tampers",
	);
	// The encoded document runs to the first byte that cannot be part of it. Any
	// bytes after it are framing the rewrite must preserve untouched.
	const boundary = text.indexOf("\n", start);
	const end = boundary === -1 ? text.length : boundary;
	const document = JSON.parse(
		Buffer.from(text.slice(start, end), "base64").toString("utf8"),
	);
	const target = document.cookies.find((cookie) => cookie.value === from);
	assert.ok(target, `the stored document carries no cookie valued ${from}`);
	target.value = to;
	writeFileSync(
		path,
		Buffer.from(
			`cipher:${Buffer.from(JSON.stringify(document)).toString("base64")}${text.slice(end)}`,
			"latin1",
		),
	);
};

test("a rewrite that keeps the document parseable is refused by the integrity digest, not by JSON validity", async () => {
	// First the control this test is worthless without, in its own directory: the
	// digest must not refuse what the writer itself just wrote. A guard that
	// rejected everything would look identical from the refusal below alone.
	const honest = dirFor("digest-honest");
	const honestLog = collector();
	await savedSnapshot(fakeJar(cookiesFor()), fakeCipher(), honest, honestLog.log);
	const honestJar = fakeJar([cookiesFor()[2]]);
	const restored = await makeVault(
		honestJar,
		fakeCipher(),
		honest,
		honestLog.log,
	).restore();
	assert.equal(restored.outcome, "restored");
	assert.equal(restored.restored, 2);
	assert.equal(
		honestJar.cookies.find((cookie) => cookie.name === "session_plain")?.value,
		"v1",
		"a snapshot the writer sealed itself must restore its own values",
	);

	// Now the failure the reviewer measured in the pinned runtime, where
	// `safeStorage` does not authenticate what it encrypted and the refusal used to
	// be `JSON.parse`: a rewrite whose document stays parseable, so every check
	// after the cipher would accept it and the ALTERED value would be written back
	// as if it were the credential the user's session had.
	const paths = dirFor("digest-rewrite");
	const { lines, log } = collector();
	await savedSnapshot(fakeJar(cookiesFor()), fakeCipher(), paths, log);
	// The wrapper's shape, pinned here rather than only implied by the refusal: the
	// ciphertext stays the prefix of the file and the digest is a fixed suffix, so a
	// reader can find the boundary without a parser (and so the tamper below, which
	// preserves everything after that boundary, is tampering with a well-formed
	// file).
	assert.match(
		readFileSync(paths.snapshotPath).toString("latin1"),
		/^cipher:[A-Za-z0-9+/]+={0,2}\nsha256=[0-9a-f]{64}$/,
	);
	rewriteStoredValue(paths.snapshotPath, "v1", "v1-rewritten");

	const jar = fakeJar([cookiesFor()[2]]);
	const report = await makeVault(jar, fakeCipher(), paths, log).restore();
	assert.equal(
		report.outcome,
		"unreadable",
		"a document that parses but disagrees with its digest must be refused, not trusted",
	);
	assert.equal(report.restored, 0);
	assert.deepEqual(
		jar.writes,
		[],
		"nothing from a rewritten document may be applied",
	);
	assert.equal(existsSync(paths.snapshotPath), false);
	assert.match(lines.join("\n"), /integrity digest does not match/);
});

test("an interrupted write leaves the previous snapshot intact, not a truncated one", async () => {
	const paths = dirFor("interrupted");
	const { log } = collector();
	await savedSnapshot(fakeJar(cookiesFor()), fakeCipher(), paths, log);
	const before = readFileSync(paths.snapshotPath);

	// The staged file the writer uses, left behind by a kill between write and
	// rename. The published snapshot must be untouched by it.
	writeFileSync(`${paths.snapshotPath}.99999.tmp`, Buffer.from("cipher:half"));
	const jar = fakeJar([cookiesFor()[2]]);
	const report = await makeVault(jar, fakeCipher(), paths, log).restore();
	assert.equal(report.restored, 2);
	assert.deepEqual(readFileSync(paths.snapshotPath), before);
});

test("a keychain that is unavailable fails closed in both directions", async () => {
	const paths = dirFor("no-keychain");
	const { lines, log } = collector();
	const cipher = fakeCipher({
		available: false,
		reason: "the OS keychain is not available",
	});

	// The marker is written by the restore, before any page may load, and a run
	// that could not store anything leaves it behind.
	const jar = fakeJar(cookiesFor());
	const vault = makeVault(jar, cipher, paths, log);
	const started = await vault.restore();
	assert.equal(started.outcome, "no-snapshot");
	const saved = await vault.snapshot();
	assert.equal(saved.written, false);
	assert.equal(existsSync(paths.snapshotPath), false);
	assert.deepEqual(
		readdirSync(dirname(paths.markerPath)).filter((name) =>
			name.includes("session-cookie"),
		),
		["session-cookie-generation.json"],
		"only the marker exists: the marker is what later discards a stale snapshot",
	);

	// And a snapshot that exists from a run with a working keychain is not read.
	const good = dirFor("no-keychain-source");
	await savedSnapshot(fakeJar(cookiesFor()), fakeCipher(), good, log);
	const jar2 = fakeJar([]);
	const report = await makeVault(jar2, cipher, good, log).restore();
	assert.equal(report.outcome, "cipher-unavailable");
	assert.deepEqual(jar2.writes, []);
	assert.equal(
		existsSync(good.snapshotPath),
		true,
		"a temporarily unavailable keychain does not destroy the file",
	);
	assert.match(lines.join("\n"), /not restoring/);

	// A run that could not snapshot leaves its marker behind, so the file it could
	// not refresh is discarded by the next start rather than restored stale.
	assert.equal(existsSync(good.markerPath), true);
	const jar3 = fakeJar([]);
	const afterStale = await makeVault(jar3, fakeCipher(), good, log).restore();
	assert.equal(afterStale.outcome, "unclean-previous-run");
	assert.deepEqual(jar3.writes, []);
});

test("a Linux basic_text or unknown keyring backend is refused; a real keyring is allowed", () => {
	const backend = (selected) => ({
		isEncryptionAvailable: () => true,
		encryptString: (text) => Buffer.from(text),
		decryptString: (buffer) => buffer.toString(),
		getSelectedStorageBackend: () => selected,
	});
	assert.equal(
		createSafeStorageCipher(backend("basic_text"), "linux").availability().ok,
		false,
	);
	assert.equal(
		createSafeStorageCipher(backend("unknown"), "linux").availability().ok,
		false,
	);
	assert.equal(
		createSafeStorageCipher(backend(undefined), "linux").availability().ok,
		false,
	);
	assert.equal(
		createSafeStorageCipher(backend("gnome_libsecret"), "linux").availability()
			.ok,
		true,
	);
	assert.equal(
		createSafeStorageCipher(backend("kwallet6"), "linux").availability().ok,
		true,
	);
	// macOS and Windows have no such backend to ask about; availability alone is
	// the answer there. The keychain premise is stated rather than inherited: on a
	// machine with no login keychain file the answer below is a refusal by design
	// (see the next test), so a test that means to exercise the backend question
	// must say that the keychain is there.
	const keychainPresent = () => true;
	assert.equal(
		createSafeStorageCipher(backend("basic_text"), "darwin", keychainPresent)
			.availability().ok,
		true,
	);
	const missing = {
		isEncryptionAvailable: () => false,
		encryptString: () => Buffer.alloc(0),
		decryptString: () => "",
	};
	assert.equal(
		createSafeStorageCipher(missing, "darwin", keychainPresent).availability()
			.ok,
		false,
	);
});

test("the keychain question is not asked when its answer is already known, because asking it can freeze the launch", () => {
	// Measured in Electron 44.3.0 with a bare scratch home, which is the shape any
	// isolated harness has: `isEncryptionAvailable()` took 7785 ms and returned
	// false, and a 50 ms heartbeat did not tick once while it ran — the main
	// process was frozen for those seconds, so no timer of this process could have
	// bounded it. The absence of the file the item would live in is knowable for
	// free, and its answer is the one we already measured.
	let asked = 0;
	const backend = {
		isEncryptionAvailable: () => {
			asked++;
			return true;
		},
		encryptString: (text) => Buffer.from(text),
		decryptString: (buffer) => buffer.toString(),
	};
	const availability = createSafeStorageCipher(
		backend,
		"darwin",
		() => false,
	).availability();
	assert.equal(availability.ok, false);
	assert.match(availability.reason, /login keychain is not at/);
	assert.equal(
		asked,
		0,
		"the keychain was asked a question whose answer costs a frozen main thread",
	);

	// The control: with the keychain file there, the backend question is the one
	// that decides, so this precondition cannot be refusing everything.
	const present = createSafeStorageCipher(backend, "darwin", () => true);
	assert.equal(present.availability().ok, true);
	assert.equal(asked, 1, "a present keychain must still be asked about");

	// And on the platforms with no keychain file to check, the precondition is not
	// consulted at all: the Linux backend question below is that side's cheap
	// precondition instead (driven by the test above).
	const linuxAsked = [];
	const linux = createSafeStorageCipher(
		{
			...backend,
			isEncryptionAvailable: () => {
				linuxAsked.push("asked");
				return true;
			},
			getSelectedStorageBackend: () => "basic_text",
		},
		"linux",
		() => {
			throw new Error("no keychain file question exists on linux");
		},
	).availability();
	assert.equal(linux.ok, false);
	assert.deepEqual(
		linuxAsked,
		[],
		"a plaintext backend must be refused before the keyring is disturbed",
	);
});

test("clearing cookies durably invalidates the snapshot first, and clearing the cache does not", async () => {
	const paths = dirFor("clear");
	const { log } = collector();
	await savedSnapshot(fakeJar(cookiesFor()), fakeCipher(), paths, log);
	assert.equal(existsSync(paths.snapshotPath), true);

	// The cache is not browsing data a user thinks of as a logout: the snapshot
	// must survive it.
	let cleared = null;
	await makeVault(fakeJar([]), fakeCipher(), paths, log, {
		clearSessionData: async (what) => {
			cleared = what;
		},
	}).clearBrowsingData("cache");
	assert.equal(cleared, "cache");
	assert.equal(
		existsSync(paths.snapshotPath),
		true,
		"clearing the cache logs nobody out",
	);

	// Cookies and everything: the file is gone BEFORE the clear reports success.
	let snapshotGoneWhenClearing = null;
	await makeVault(fakeJar([]), fakeCipher(), paths, log, {
		clearSessionData: async () => {
			snapshotGoneWhenClearing = !existsSync(paths.snapshotPath);
		},
	}).clearBrowsingData("cookies");
	assert.equal(
		snapshotGoneWhenClearing,
		true,
		"the invalidation is durable before the clear resolves",
	);

	// Same for everything, and the invalidation does not need a keychain: with the
	// cipher refusing, a clear must still remove what a restore would read.
	await savedSnapshot(fakeJar(cookiesFor()), fakeCipher(), paths, log);
	await makeVault(
		fakeJar([]),
		fakeCipher({ available: false }),
		paths,
		log,
	).clearBrowsingData("everything");
	assert.equal(existsSync(paths.snapshotPath), false);
});

test("a clear that lands during a restore runs after it, so nothing is written back after the user asked", async () => {
	const paths = dirFor("clear-race");
	const { log } = collector();
	await savedSnapshot(fakeJar(cookiesFor()), fakeCipher(), paths, log);

	const order = [];
	const jar = fakeJar([]);
	const slowJar = {
		...jar,
		async writeCookie(params) {
			order.push("restore-write");
			await new Promise((resolve) => setTimeout(resolve, 20));
			return jar.writeCookie(params);
		},
	};
	const vault = makeVault(slowJar, fakeCipher(), paths, log, {
		clearSessionData: async () => {
			order.push("clear");
		},
	});
	const restoring = vault.restore();
	const clearing = vault.clearBrowsingData("cookies");
	await Promise.all([restoring, clearing]);
	assert.deepEqual(
		order.slice(-1),
		["clear"],
		"the clear is serialised after the restore",
	);
	assert.equal(existsSync(paths.snapshotPath), false);
});

test("a newer persistent cookie is never overwritten by the older session snapshot", async () => {
	const paths = dirFor("newer-cookie");
	const { log } = collector();
	await savedSnapshot(fakeJar(cookiesFor()), fakeCipher(), paths, log);

	// The site replaced its session cookie with a persistent one between the two
	// runs, so the jar has a same-identity entry that is newer than the snapshot.
	const jar = fakeJar([
		{ ...cookiesFor()[0], session: false, expires: Date.now() / 1000 + 600 },
	]);
	const report = await makeVault(jar, fakeCipher(), paths, log).restore();
	assert.equal(report.restored, 1, "only the partitioned one is restored");
	assert.deepEqual(report.refused, [
		{ name: "session_plain", reason: "newer-persistent-cookie-present" },
	]);
	assert.deepEqual(
		jar.writes.map((w) => w.name),
		["session_partitioned"],
	);
});

test("restoring the newest value is the whole point: the snapshot holds what the jar held", async () => {
	const paths = dirFor("rotation");
	const { log } = collector();
	await savedSnapshot(
		fakeJar([{ ...cookiesFor()[0], value: "rotated" }]),
		fakeCipher(),
		paths,
		log,
	);
	const jar = fakeJar([]);
	await makeVault(jar, fakeCipher(), paths, log).restore();
	assert.equal(jar.writes[0].value, "rotated");
});

test("a read-back that disagrees is reported as drift rather than counted as restored", async () => {
	const paths = dirFor("drift");
	const { lines, log } = collector();
	await savedSnapshot(fakeJar(cookiesFor()), fakeCipher(), paths, log);
	const jar = fakeJar([]);
	const lying = {
		...jar,
		async writeCookie(params) {
			await jar.writeCookie(params);
			// The site's own write wins, as it would if something rewrote the cookie
			// in the moment between the restore and the read-back.
			const stored = jar.cookies.find((cookie) => cookie.name === params.name);
			if (stored) stored.secure = !stored.secure;
		},
	};
	const report = await makeVault(lying, fakeCipher(), paths, log).restore();
	assert.equal(report.restored, 2);
	assert.equal(report.drifted.length, 2);
	assert.match(lines.join("\n"), /drifted/);
});

test("live values never reach the log", async () => {
	const paths = dirFor("logging");
	const { lines, log } = collector();
	await savedSnapshot(fakeJar(cookiesFor()), fakeCipher(), paths, log);
	const jar = fakeJar([cookiesFor()[2]]);
	await makeVault(jar, fakeCipher(), paths, log).restore();
	const text = lines.join("\n");
	for (const value of ["v1", "v2", "v3"]) {
		assert.equal(
			text.includes(value),
			false,
			`a cookie value (${value}) reached the log`,
		);
	}
	assert.match(text, /restored 2 of 2/);
});

test("the snapshot and the marker are private files, and the snapshot is not the plaintext", async () => {
	const paths = dirFor("modes");
	const { log } = collector();
	await savedSnapshot(fakeJar(cookiesFor()), fakeCipher(), paths, log);
	const mode = statSync(paths.snapshotPath).mode & 0o777;
	assert.equal(mode, 0o600, "the snapshot is a credential at rest");
	const raw = readFileSync(paths.snapshotPath, "utf8");
	assert.equal(
		raw.startsWith("cipher:"),
		true,
		"what lands on disk is the ciphertext",
	);
	assert.equal(raw.includes("v1"), false);
});

test("a jar that cannot be read is a refusal, not a silent empty snapshot", async () => {
	const paths = dirFor("jar-failure");
	const { lines, log } = collector();
	const jar = {
		async readAllCookies() {
			throw new Error("the debugger detached");
		},
		async writeCookie() {},
	};
	const saved = await savedSnapshot(jar, fakeCipher(), paths, log);
	assert.equal(saved.written, false);
	assert.equal(existsSync(paths.snapshotPath), false);
	assert.match(lines.join("\n"), /could not read the cookie jar/);

	// The restore path refuses too, and says so rather than reporting "nothing to do".
	await savedSnapshot(fakeJar(cookiesFor()), fakeCipher(), paths, log);
	const report = await makeVault(jar, fakeCipher(), paths, log).restore();
	assert.equal(report.outcome, "unreadable");
	assert.equal(report.restored, 0);
});

test("a marker that cannot be written disables the vault rather than losing crash detection", async () => {
	const { lines, log } = collector();
	const missing = join(
		root,
		"missing",
		"nested",
		"session-cookie-generation.json",
	);
	const jar = fakeJar(cookiesFor());
	const paths = { snapshotPath: join(root, "s.enc"), markerPath: missing };
	// A directory where the marker file should go makes every write fail.
	mkdirSync(missing, { recursive: true });
	const vault = makeVault(jar, fakeCipher(), paths, log);
	const report = await vault.restore();
	assert.equal(report.outcome, "disabled");
	assert.equal(report.restored, 0);
	assert.equal(existsSync(paths.snapshotPath), false);

	// And the same instance will not snapshot either: without the marker, a crash
	// is undetectable, so a stored snapshot could be replayed after one.
	const saved = await vault.snapshot();
	assert.equal(saved.written, false);
	assert.match(saved.reason, /marker/);
	assert.match(lines.join("\n"), /not restoring anything/);
});

test("the debugger-backed jar imports one method and writes the parameters it is given", async () => {
	const calls = [];
	let attached = false;
	const target = {
		debugger: {
			attach: (version) => {
				if (attached)
					throw new Error("Debugger is already attached to the target");
				attached = true;
				calls.push(["attach", version]);
			},
			isAttached: () => attached,
			sendCommand: async (method, params) => {
				calls.push([method, params]);
				return method === "Network.getAllCookies"
					? { cookies: [{ name: "a", session: true }] }
					: { success: true };
			},
		},
		loadAboutBlank: async () => calls.push(["loadAboutBlank"]),
	};
	const jar = createDebuggerCookieJar(target);
	assert.deepEqual(await jar.readAllCookies(), [{ name: "a", session: true }]);
	await jar.writeCookie({ name: "a", partitionKey: PARTITION_TENANT });
	assert.deepEqual(
		calls[0],
		["loadAboutBlank"],
		"a view needs a document before CDP answers",
	);
	assert.deepEqual(calls[1], ["attach", "1.3"]);
	assert.equal(
		calls.filter(([method]) => method === "attach").length,
		1,
		"a second read reuses the attachment instead of attaching twice, which Electron refuses",
	);

	// An attachment somebody else already holds is adopted rather than re-attached.
	const adopted = createDebuggerCookieJar({
		debugger: {
			attach: () => {
				throw new Error("Debugger is already attached to the target");
			},
			isAttached: () => true,
			sendCommand: async () => ({ cookies: [] }),
		},
		loadAboutBlank: async () => {
			throw new Error("the document is already there");
		},
	});
	assert.deepEqual(await adopted.readAllCookies(), []);

	// A refusal from Chromium is an error for that cookie, with its own reason.
	const refusing = createDebuggerCookieJar({
		debugger: {
			attach: () => {},
			isAttached: () => true,
			sendCommand: async () => ({ success: false }),
		},
		loadAboutBlank: async () => {},
	});
	await assert.rejects(
		() => refusing.writeCookie({ name: "a" }),
		/the browser refused the cookie/,
	);
});

test("the one adjustment this design makes is reported, and nothing else may move", async () => {
	// A Secure cookie set from a trustworthy-but-insecure origin (http://localhost,
	// measured) cannot be written back with an insecure source scheme at all:
	// Chromium refuses it. The Secure attribute itself is preserved and the source
	// scheme is raised to match, which is the stricter direction — and it is named
	// in the report rather than left for a reader to notice.
	const paths = dirFor("adjusted");
	const { log } = collector();
	const trustworthyInsecure = {
		...cookiesFor()[0],
		name: "secure_from_insecure_source",
		secure: true,
		sourceScheme: "NonSecure",
		sourcePort: 1234,
	};
	await savedSnapshot(fakeJar([trustworthyInsecure]), fakeCipher(), paths, log);
	const jar = fakeJar([]);
	const report = await makeVault(jar, fakeCipher(), paths, log).restore();
	assert.deepEqual(report.adjusted, [
		{
			name: "secure_from_insecure_source",
			reason:
				"secure cookie from an insecure source: source scheme raised from NonSecure to Secure",
		},
	]);
	assert.deepEqual(
		report.drifted,
		[],
		"the write's own parameters are what the read-back checks",
	);
	const write = jar.writes[0];
	assert.equal(
		write.secure,
		true,
		"Secure is preserved, which is the promised attribute",
	);
	assert.equal(write.sourceScheme, "Secure");
	assert.equal(write.sourcePort, 443);
	assert.equal(write.url, "https://app.example/");
});

test("the quit path never opens the jar channel, because a renderer created while the app tears down never comes up", async () => {
	const paths = dirFor("cold-channel");
	const { lines, log } = collector();
	const calls = [];
	const base = fakeJar(cookiesFor());
	const jar = {
		...base,
		async prepare() {
			calls.push("prepare");
		},
		async readAllCookies() {
			calls.push("read");
			return base.readAllCookies();
		},
	};

	// A vault that never restored must not read the jar: that read is what would
	// open the channel, and on the built app it hung the clean quit (measured: no
	// snapshot, and `will-quit` never returned).
	const cold = makeVault(jar, fakeCipher(), paths, log);
	const refused = await cold.snapshot();
	assert.equal(refused.written, false);
	assert.match(refused.reason, /never opened/);
	assert.deepEqual(calls, [], "the quit path touched the jar");
	assert.match(lines.join("\n"), /channel was never opened/);

	// With the restore first — the app's order — the channel is opened while the
	// app is healthy and both a snapshot and a restore run work.
	const warm = makeVault(jar, fakeCipher(), paths, log);
	await warm.restore();
	const saved = await warm.snapshot();
	assert.equal(saved.written, true);
	assert.equal(calls[0], "prepare", "the channel is opened before it is used");
});

test("attributeDrift and cookieIdentity compare identity and the promised attributes", () => {
	const stored = storedCookieFor(cookiesFor()[1]).cookie;
	const live = cookiesFor()[1];
	assert.equal(attributeDrift(stored, live), null);
	assert.equal(cookieIdentity(stored), cookieIdentity(live));
	assert.match(attributeDrift(stored, { ...live, value: "other" }), /value/);
	assert.match(
		attributeDrift(stored, { ...live, partitionKey: null }),
		/partition/,
	);
	assert.match(attributeDrift(stored, { ...live, secure: false }), /secure/);
});

test("a partition key with only a top-level site is not representable", () => {
	assert.deepEqual(partitionKeyForWrite({ partitionKey: undefined }).key, null);
	assert.equal(
		partitionKeyForWrite({
			partitionKey: { topLevelSite: "https://a.example" },
		}).ok,
		false,
	);
	assert.equal(
		partitionKeyForWrite({
			partitionKey: {
				topLevelSite: "https://a.example",
				hasCrossSiteAncestor: false,
			},
		}).ok,
		true,
	);
	assert.equal(
		partitionKeyForWrite({
			partitionKey: {
				topLevelSite: "https://a.example",
				hasCrossSiteAncestor: false,
			},
			partitionKeyOpaque: true,
		}).ok,
		false,
	);
});

/* --- The app's shutdown path, and the failures that used to be silent. --- */

test("a rejected browser-host stop still quits, instead of cancelling the first quit silently", async () => {
	const calls = [];
	const lines = [];
	const holder = createSessionCookieQuitHold({
		isPending: () => true,
		stop: () => {
			calls.push("stop");
			return Promise.reject(new Error("the renderer died mid-stop"));
		},
		quit: () => calls.push("quit"),
		log: (message) => lines.push(message),
	});

	const held = await holder({ preventDefault: () => calls.push("preventDefault") });

	// The defect this pins: `await stopBrowserHost()` with no try/finally, so a
	// rejection skipped the `app.quit()` below it. Measured in Electron 44.3.0, an
	// unhandled main-process rejection fires `unhandledRejection` and NOT
	// `uncaughtException`, so the app did not crash — it stayed alive with no
	// window, and because the hold was spent the NEXT quit exited without the
	// snapshot the hold exists for. The quit must be asked for either way.
	assert.equal(held, true, "the quit was held for the stop");
	assert.deepEqual(
		calls,
		["preventDefault", "stop", "quit"],
		"the quit is asked for even though the stop rejected",
	);
	assert.match(lines.join("\n"), /failed while the quit was held/);
});

test("the re-quit this hold issues is not held again, and an idle quit is left alone", async () => {
	const calls = [];
	let second = null;
	let pending = true;
	const holder = createSessionCookieQuitHold({
		isPending: () => pending,
		stop: async () => {
			calls.push("stop");
		},
		quit: () => {
			calls.push("quit");
			// `app.quit()` re-emits `will-quit` inside the handler that held the first
			// one, so this is the re-entrant call the flag exists to refuse: a second
			// hold here would mean the app never exits.
			second = holder({
				preventDefault: () => calls.push("re-preventDefault"),
			});
		},
		log: (message) => calls.push(`log:${message}`),
	});

	const first = await holder({
		preventDefault: () => calls.push("preventDefault"),
	});
	const secondHeld = await second;
	assert.equal(first, true);
	assert.equal(
		secondHeld,
		false,
		"the re-quit must not be held again, or the app never exits",
	);
	assert.deepEqual(calls, ["preventDefault", "stop", "quit"]);

	// Nothing to wait for: no hold, no cancelled quit, and the stop is not called.
	pending = false;
	const idleCalls = [];
	const idle = createSessionCookieQuitHold({
		isPending: () => false,
		stop: async () => idleCalls.push("stop"),
		quit: () => idleCalls.push("quit"),
		log: () => {},
	});
	assert.equal(
		await idle({ preventDefault: () => idleCalls.push("preventDefault") }),
		false,
	);
	assert.deepEqual(idleCalls, [], "an idle quit is left alone");
});

test("a stop that never settles is released at the budget instead of holding the quit", async () => {
	const calls = [];
	const lines = [];
	const budgetMs = 120;
	const holder = createSessionCookieQuitHold({
		isPending: () => true,
		// Never settles: a stop waiting on a CDP read the host is not answering. QA
		// constructed exactly this by SIGSTOPping the network service; its 68-8776 ms
		// figure is process-exit latency on the healthy path, not this hold, which it
		// measured at 13-29 ms over six quits with this budget never firing.
		stop: () => new Promise(() => {}),
		quit: () => calls.push("quit"),
		log: (message) => lines.push(message),
		budgetMs,
	});
	const started = Date.now();
	const held = await holder({
		preventDefault: () => calls.push("preventDefault"),
	});
	const elapsed = Date.now() - started;

	assert.equal(held, true);
	assert.deepEqual(calls, ["preventDefault", "quit"]);
	/*
	 * `budgetMs - 1`, not `budgetMs`: the release is a `setTimeout(budgetMs)` and
	 * both ends of `elapsed` are `Date.now()` readings truncated to whole
	 * milliseconds, so the timer legitimately lands one millisecond short of the
	 * nominal boundary. Asserting the exact boundary fails on the clock's
	 * granularity rather than on the behaviour - this line has been failing
	 * intermittently on `main` at 119 ms against a 120 ms budget, and been
	 * absorbed as a re-run, since the budget was introduced.
	 */
	assert.ok(
		elapsed >= budgetMs - 1,
		`the budget is what released the quit, not luck: ${elapsed} ms`,
	);
	/*
	 * The half that makes the assertion above a claim rather than a tolerance.
	 *
	 * It was 2000 ms, chosen against the only bound this code has without the
	 * budget - the CDP layer's 15 s per-call ceiling - which means a regression
	 * that released the quit after 1.5 s would have passed this test while the
	 * budget it exists to pin was gone. `budgetMs + 400` still clears that
	 * ceiling by more than an order of magnitude, and the margin is measured
	 * rather than guessed: over 15 runs at a load average of 113-150 the timer's
	 * overshoot was 1-15 ms, so the allowance is about 26x the jitter this suite
	 * actually sees while catching a 4x slip the old bound would have let
	 * through.
	 */
	assert.ok(
		elapsed < budgetMs + 400,
		`the quit waited ${elapsed} ms on a stop that never settles`,
	);
	// The consequence is stated, not silent: the user's session cookies are this
	// run's loss, and the marker rule is what makes that safe on the next start.
	assert.match(lines.join("\n"), /did not stop within 120 ms/);
	assert.match(lines.join("\n"), /discard what is on disk/);
});

test("a second quit during the stop is held until the snapshot lands, so the run is not reported as a crash", async () => {
	const paths = dirFor("second-quit");
	const { lines, log } = collector();
	const vault = makeVault(fakeJar(cookiesFor()), fakeCipher(), paths, log);
	await vault.restore();
	assert.equal(
		existsSync(paths.markerPath),
		true,
		"a run that restored is owed a marker until its snapshot lands",
	);

	// The app's own wiring: the stop inside the quit hold is what writes the
	// snapshot, and a stop is owed for the whole of it.
	let pending = true;
	let stops = 0;
	let atExit = null;
	let requit = null;
	const calls = [];
	const holder = createSessionCookieQuitHold({
		isPending: () => pending,
		stop: async () => {
			stops += 1;
			// The window the user's second Cmd+Q lands in: the hold lasts as long as
			// the snapshot does, which round 2 measured at 13-29 ms on a healthy host
			// (round 1's 68-8776 ms is exit latency, not this phase).
			await new Promise((resolve) => setTimeout(resolve, 150));
			await vault.snapshot();
			pending = false;
		},
		quit: () => {
			// Where the process would go away. What the snapshot left on disk is
			// read HERE, because this is the only moment the claim is about.
			atExit = {
				marker: existsSync(paths.markerPath),
				snapshot: existsSync(paths.snapshotPath),
			};
			// `app.quit()` re-emits `before-quit` inside the handler that held the
			// first quit, which is the re-entrant call that must not be held.
			requit = holder({ preventDefault: () => calls.push("re-preventDefault") });
		},
		log,
		budgetMs: 2_000,
	});

	const first = holder({ preventDefault: () => calls.push("preventDefault") });
	await new Promise((resolve) => setTimeout(resolve, 50));
	// The user presses Quit again, while the stop is still in flight.
	const second = holder({ preventDefault: () => calls.push("re-preventDefault") });
	const secondHeld = await second;

	// The defect this pins, measured against the shipped module: with a spent flag
	// this returned false, so `will-quit` passed its gate and the process was gone
	// 50 ms in, with the stop and its snapshot still running.
	assert.equal(
		secondHeld,
		true,
		"the second quit is held, not allowed to exit with the snapshot still running",
	);
	assert.deepEqual(
		calls,
		["preventDefault", "re-preventDefault"],
		"both user quits were cancelled",
	);
	assert.equal(
		stops,
		1,
		"the second quit re-holds the stop already running rather than starting another",
	);
	assert.equal(await first, true);
	assert.equal(
		await requit,
		false,
		"the hold's own release still gets through, or the app never exits",
	);
	assert.equal(atExit.snapshot, true, "the snapshot is on disk before the quit is let go");
	assert.equal(
		atExit.marker,
		false,
		"the marker is gone, so the next start must not report a crash that never happened",
	);

	// The consequence, read the way the next launch reads it.
	const next = makeVault(fakeJar([]), fakeCipher(), paths, log);
	const report = await next.restore();
	assert.equal(report.restored, 2, "the session cookies came back");
	assert.doesNotMatch(
		lines.join("\n"),
		/did not shut down cleanly/,
		"a clean quit reported as a crash is the misattribution this fixes",
	);
});

test("a second quit is bounded by the first hold's deadline, not by one of its own", async () => {
	const calls = [];
	const budgetMs = 600;
	const holder = createSessionCookieQuitHold({
		isPending: () => true,
		// Never settles: a stop waiting on a CDP read the host is not answering.
		stop: () => new Promise(() => {}),
		quit: () => calls.push("quit"),
		log: (message) => calls.push(`log:${message}`),
		budgetMs,
	});

	const started = Date.now();
	const first = holder({ preventDefault: () => calls.push("preventDefault") });
	await new Promise((resolve) => setTimeout(resolve, 400));
	// The second quit lands well inside the budget, which is where a per-quit
	// budget would show: it would hold this one for another 600 ms.
	const second = holder({ preventDefault: () => calls.push("re-preventDefault") });
	const secondHeld = await second;
	const elapsed = Date.now() - started;

	assert.equal(await first, true);
	assert.equal(secondHeld, true);
	/*
	 * The same one-millisecond correction as the budget test above, and for the
	 * same reason: 599 ms against a 600 ms budget is what this line reports when
	 * the `setTimeout` lands a fraction early, and it did so on `main` (CI run
	 * 34962627923) as well as here. The upper bound below is the half that
	 * carries the test's claim - it is what separates this shared deadline
	 * (~600 ms) from a per-quit budget (~1000 ms).
	 */
	assert.ok(
		elapsed >= budgetMs - 1,
		`the budget is what released the second quit, not luck: ${elapsed} ms`,
	);
	assert.ok(
		elapsed < budgetMs + 300,
		`the second quit inherited the first hold's deadline instead of taking one of its own: ${elapsed} ms for a ${budgetMs} ms budget`,
	);
	// One deadline means one timer, one consequence and one release, however many
	// quits joined the wait.
	assert.equal(
		calls.filter((call) => call === "quit").length,
		1,
		"the wait is released once, by the holder that started it",
	);
	assert.equal(
		calls.filter((call) => call.startsWith("log:")).length,
		1,
		"the abandonment is stated once, not once per quit",
	);
	assert.match(calls.join("\n"), /did not stop within 600 ms/);
});

test("removeDurable treats an absent file as done and anything else as a failure", () => {
	const paths = dirFor("remove-durable");
	mkdirSync(dirname(paths.snapshotPath), { recursive: true });

	// The ordinary "nothing to discard" path is the done state, not an error.
	assert.doesNotThrow(() => removeDurable(paths.snapshotPath));
	writeFileSync(paths.snapshotPath, Buffer.from("cipher:value"));
	assert.doesNotThrow(() => removeDurable(paths.snapshotPath));
	assert.equal(existsSync(paths.snapshotPath), false);

	// A directory is not unlinkable: the invalidation did NOT happen, and swallowing
	// it is what let a clear report a discard it never performed.
	const notAFile = join(root, "remove-durable", "browser", "a-directory");
	mkdirSync(notAFile, { recursive: true });
	assert.throws(
		() => removeDurable(notAFile),
		"a failed removal must not be reported as done",
	);
});

test("a clear that cannot discard the snapshot fails loudly instead of logging a discard", async () => {
	const paths = dirFor("clear-failure");
	const { lines, log } = collector();
	await savedSnapshot(fakeJar(cookiesFor()), fakeCipher(), paths, log);
	assert.equal(existsSync(paths.snapshotPath), true);

	// The reviewer's repro: unlink fails (a POSIX unlink needs write permission on
	// the DIRECTORY, so the file's own mode is not what is being tested here).
	const dir = dirname(paths.snapshotPath);
	const mode = statSync(dir).mode & 0o777;
	chmodSync(dir, 0o500);
	try {
		let cleared = false;
		const failure = await makeVault(fakeJar([]), fakeCipher(), paths, log, {
			clearSessionData: async () => {
				cleared = true;
			},
		})
			.clearBrowsingData("cookies")
			.then(
				() => null,
				(error) => error,
			);
		assert.ok(
			failure instanceof Error,
			"a clear that cannot invalidate the snapshot must not resolve",
		);
		assert.equal(
			cleared,
			false,
			"the jar is not cleared while the snapshot survives, or a restart would replay it",
		);
		assert.equal(existsSync(paths.snapshotPath), true);
		assert.doesNotMatch(
			lines.join("\n"),
			/discarded the stored session cookies/,
		);
	} finally {
		chmodSync(dir, mode);
	}
});

test("a run whose channel never opened reports the channel, not a crash it never had", async () => {
	const paths = dirFor("channel-unavailable");
	const { log } = collector();
	await savedSnapshot(fakeJar(cookiesFor()), fakeCipher(), paths, log);

	const channelDown = {
		prepare: async () => {
			throw new Error("the renderer never came up");
		},
		readAllCookies: async () => {
			throw new Error("no channel");
		},
		writeCookie: async () => {
			throw new Error("no channel");
		},
	};
	const broken = await makeVault(channelDown, fakeCipher(), paths, log).restore();
	assert.equal(broken.outcome, "channel-unavailable");
	assert.equal(broken.restored, 0);
	assert.equal(
		existsSync(paths.markerPath),
		true,
		"the marker stays: this run still browses, so a crash of it must stay detectable",
	);
	assert.equal(existsSync(paths.snapshotPath), true);

	// The next start discards, as it must, and names the real cause rather than
	// reporting a crash that never happened.
	const fresh = collector();
	const next = await makeVault(
		fakeJar([]),
		fakeCipher(),
		paths,
		fresh.log,
	).restore();
	assert.equal(next.outcome, "unclean-previous-run");
	assert.match(
		fresh.lines.join("\n"),
		/could not open the cookie-jar channel \(Error: the renderer never came up\)/,
	);
	assert.doesNotMatch(fresh.lines.join("\n"), /did not shut down cleanly/);
});

test("a jar that stops answering degrades to no persistence instead of stalling startup", async () => {
	const paths = dirFor("jar-hang");
	const { lines, log } = collector();
	await savedSnapshot(fakeJar(cookiesFor()), fakeCipher(), paths, log);

	// The hang this feature already found on the quit path: a call into the channel
	// that never settles rather than rejecting. Startup awaits the restore and the
	// quit awaits the snapshot, so an unbounded call would hold both.
	const neverSettles = new Promise(() => {});
	const hung = {
		prepare: () => neverSettles,
		readAllCookies: () => neverSettles,
		writeCookie: () => neverSettles,
	};
	const started = Date.now();
	const report = await makeVault(hung, fakeCipher(), paths, log, {
		jarDeadlineMs: 50,
	}).restore();

	assert.equal(report.outcome, "channel-unavailable");
	assert.equal(report.restored, 0);
	assert.ok(
		Date.now() - started < 5_000,
		"the restore came back on its own bound rather than hanging",
	);
	assert.match(lines.join("\n"), /did not respond within 50ms/);
});
