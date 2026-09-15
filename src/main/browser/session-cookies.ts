import { createHash, randomUUID } from "node:crypto";
import {
	closeSync,
	existsSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { PRIVATE_DIR_MODE, PRIVATE_FILE_MODE } from "./atomic-json";
import type { ClearWhat } from "./profile";
import { CDP_DEADLINE_MS, deadline } from "./vendor/driver/deadline";

/**
 * Session-only cookie persistence across an app restart.
 *
 * WHY THIS EXISTS: the shared browser partition (`persist:local-operator-browser`)
 * keeps persistent cookies, localStorage and IndexedDB across a restart, but a
 * *session* cookie — the shape most logins issue — is dropped, because the pinned
 * Electron sets BOTH `restore_old_session_cookies` and `persist_session_cookies`
 * to false (`shell/browser/net/network_context_service.cc:112-113`, Electron
 * 44.3.0 / Chrome 152.0.7977.78, verified by fetching the pinned tag). An agent
 * that logs into a site therefore loses that login whenever the app restarts,
 * which is the whole reason this module exists.
 *
 * WHY IT DOES NOT USE `session.cookies`: the installed `electron.d.ts` exposes
 * neither a partition key nor a creation date on that API, and the pinned C++
 * confirms it is not a gap in the typings — `Converter<net::CanonicalCookie>::
 * ToV8` emits name/value/domain/hostOnly/path/secure/httpOnly/session/
 * expirationDate/sameSite and nothing about CHIPS
 * (`shell/browser/api/electron_api_cookies.cc:58-76`). Its setter passes
 * `std::nullopt` as the partition key (same file, line 409), so it can only ever
 * create UNPARTITIONED cookies. A `cookies.get()` -> encrypt -> `cookies.set()`
 * design therefore cannot distinguish a partitioned cookie from an unpartitioned
 * one, and silently flattens the partitioned one's isolation on the way back.
 * That is not a tradeoff, it is a security regression, so the naive channel is
 * not used for anything.
 *
 * MEASURED, not assumed (Electron 44.3.0, Chrome 152.0.7977.78, macOS; the probe
 * and its raw output are on the PR):
 *
 *   - a page-set `Partitioned` cookie is stored with
 *     `partitionKey: {topLevelSite, hasCrossSiteAncestor}` and is reported by
 *     `session.cookies.get()` with NO partition information at all — the two
 *     APIs disagree about the cookie's identity;
 *   - a naive `get()` -> `set()` round trip left the jar holding BOTH the
 *     partitioned cookie and a new unpartitioned twin of the same name, and the
 *     page's own `document.cookie` then listed the cookie twice: the isolation
 *     was gone and a duplicate appeared (this is the failure mode the guard in
 *     `partitionKeyForWrite` exists to prevent, and
 *     `session-cookies.test.mjs` asserts it against a real jar);
 *   - CDP over the in-process debugger DOES carry and restore that identity:
 *     `Network.setCookie` stores exactly the `partitionKey` it is given, but the
 *     object must carry `hasCrossSiteAncestor` — `{topLevelSite}` alone is
 *     rejected with "Invalid parameters";
 *   - `Network.setCookie` with no `expires` writes a session cookie
 *     (`session: true`, `expires: -1`), which is the only way to ask for one;
 *   - omitting `sameSite` stores `unspecified` where passing `Lax` stores a
 *     Lax cookie, so explicit-vs-unspecified survives;
 *   - the channel's own SECURITY coupling: an `https` url forces the Secure
 *     attribute and an insecure source scheme cannot carry it, so the url has to
 *     be derived from the cookie's recorded source scheme/port and not guessed
 *     (`restoreParams`);
 *   - `Storage.setCookies` (the batch setter) silently stored nothing in this
 *     build, so the per-cookie `Network.setCookie` is the only usable path;
 *   - a third-party frame is NOT a cookie-free surface: a frame on `127.0.0.1`
 *     inside a page on `localhost` set and read its own cookies, and its own
 *     subresource request carried them. What it does not receive is the TOP-LEVEL
 *     page's cookies. So "the frame did not see the partitioned cookie" would
 *     pass for the wrong reason, which is why the isolation claim is compared at
 *     the jar level (`partitionKeyForWrite`) and against a real jar in
 *     `session-cookie-electron.test.mjs` rather than inside a frame.
 *
 * WHAT THE AT-REST GUARANTEE ACTUALLY IS, stated so it is not read as more than
 * it is: ciphertext in a 0600 file inside a 0700 directory, with every failure
 * path refusing rather than falling back to plaintext — and, because a damaged
 * `safeStorage` payload is not self-evidently damaged, an integrity digest over
 * that ciphertext, verified before it is decrypted. `safeStorage`'s macOS path
 * wraps the payload with no integrity check — measured in the pinned runtime: a
 * bit-flip inside the snapshot does not make `decryptString` throw, it returns a
 * string whose head is still the plaintext prefix — so refusing on `JSON.parse`
 * alone would accept any rewrite that stays parseable and restore it as
 * valid-but-altered credential material. `sealSnapshotCiphertext` closes that by
 * writing a domain-separated SHA-256 of the ciphertext beside it, and
 * `openSnapshotCiphertext` checks that digest before anything else looks at the
 * bytes: a mismatch is a refusal on the same path as any other unreadable
 * snapshot, never a partial restore and never plaintext.
 *
 * That digest is a checksum, NOT a MAC. It carries no secret, so it detects
 * accidental corruption and every rewrite that does not recompute it (a
 * bit-flip, a truncation, a splice) — which is exactly the silent failure the
 * reviewer measured — and it cannot detect a rewrite that recomputes it. Who can
 * read the material is unchanged either way: reading it still needs the OS
 * keychain, and rewriting the file still needs write access to a 0600 file in a
 * 0700 directory the attacker already owns. So "corrupt ciphertext fails closed"
 * is a claim about corruption, now backed by a guard rather than by JSON
 * validity, and is still not a claim that tampering is detected.
 *
 * WHAT IS DELIBERATELY NOT DONE HERE: the snapshot never reaches the renderer,
 * the agent RPC surface, the app's JSON config or any log line — only the
 * ciphertext file and a private marker file. Values are never logged; a refusal
 * names the cookie and the reason, nothing more.
 */

/** Directory under the app's userData, beside the approvals store. */
export const SESSION_COOKIE_DIRNAME = "browser";

/** The encrypted snapshot, and the dirty marker that gates it. */
export const SNAPSHOT_FILENAME = "session-cookies.enc";
export const MARKER_FILENAME = "session-cookie-generation.json";

/** The snapshot format's own version, so a future change can refuse to read an
 * older document instead of misreading it. */
export const SNAPSHOT_VERSION = 1;

/** Why a cookie that was in the jar is not written back. Exported so a test
 * names the reason it asserts on rather than a string copy. */
export const REFUSAL = {
	partitionUnrepresentable: "partition-identity-unrepresentable",
	notSession: "not-a-session-cookie",
	malformed: "malformed-identity",
} as const;

/** A cookie domain's leading dot is how CDP marks a domain cookie (as opposed to
 * a host-only one); it is stripped only to build a url for the host itself. */
const LEADING_DOT = /^\./;

/**
 * A cookie as the CDP jar reports it.
 *
 * Structural on purpose: the desktop suite drives this module with a fake jar, so
 * nothing here may depend on a live Chromium being present.
 */
export interface JarCookie {
	name: string;
	value: string;
	domain: string;
	path: string;
	secure: boolean;
	httpOnly: boolean;
	session: boolean;
	expires?: number;
	sameSite?: string | null;
	priority?: string | null;
	sourceScheme?: string | null;
	sourcePort?: number | null;
	partitionKey?: CookiePartitionKeyLike | null;
	/** Set instead of `partitionKey` when the key is opaque (a scheme-only
	 * partition). No CDP parameter can express one, so such a cookie is refused.
	 *
	 * TESTS ONLY, in production terms: `createDebuggerCookieJar` returns CDP's
	 * cookies verbatim and no CDP shape carries an opaque key, so this flag is
	 * never set by a real jar. The refusal that protects production is the
	 * missing/incomplete `partitionKey` branch in `partitionKeyForWrite`; this one
	 * exists so the shape is refused rather than miswritten if it ever arrives. */
	partitionKeyOpaque?: boolean;
}

/** The two fields CDP's `CookiePartitionKey` is made of. */
export interface CookiePartitionKeyLike {
	topLevelSite?: string;
	hasCrossSiteAncestor?: boolean;
}

/** A cookie as it is stored in the snapshot: only what is needed to write it
 * back, with the identity fields kept verbatim. */
export interface StoredCookie {
	name: string;
	value: string;
	domain: string;
	path: string;
	secure: boolean;
	httpOnly: boolean;
	sameSite: string | null;
	priority: string | null;
	sourceScheme: string | null;
	sourcePort: number | null;
	partitionKey: Required<CookiePartitionKeyLike> | null;
}

/** The document written to disk. `generation` is diagnostic — the marker file is
 * what decides whether a snapshot may be replayed. */
export interface CookieSnapshot {
	version: number;
	generation: string;
	writtenAt: number;
	cookies: StoredCookie[];
}

/** The jar channel. One read of everything, one write of one cookie. */
export interface CookieJarTransport {
	/** Open the channel now, while the app is healthy.
	 *
	 * Load-bearing, and learned from a real shutdown: the debugger channel needs a
	 * document before it answers, so a lazily-opened channel opened for the first
	 * time on the quit path would create a renderer while the app is tearing down —
	 * which never resolves, so the clean quit hung and was killed (measured against
	 * the built app: no snapshot, and `will-quit` never returned). Warming it at
	 * startup, before any browsing, is what the restore step is for. */
	prepare?(): Promise<void>;
	readAllCookies(): Promise<JarCookie[]>;
	writeCookie(params: Record<string, unknown>): Promise<void>;
}

/** Where a snapshot is and is not readable, and the encrypt/decrypt pair. */
export interface VaultCipher {
	availability(): { ok: true } | { ok: false; reason: string };
	encrypt(plaintext: string): Buffer;
	decrypt(ciphertext: Buffer): string;
}

export interface SessionCookieVaultOptions {
	jar: CookieJarTransport;
	cipher: VaultCipher;
	/** Files: the encrypted snapshot and the dirty marker. */
	snapshotPath: string;
	markerPath: string;
	/** Electron's `session.cookies.flushStore()`, if the caller has a session.
	 * Read before a snapshot so a cookie written a moment ago is in the store the
	 * snapshot reads rather than in a buffer. */
	flushStore?: () => Promise<void>;
	/** The app's clear-browsing-data operation. Injected so this module never
	 * touches a Session itself (and stays drivable from a test). */
	clearSessionData: (what: ClearWhat) => Promise<void>;
	log: (message: string) => void;
	now?: () => number;
	/** Per-call bound on one jar interaction, defaulting to the CDP layer's own
	 * per-command deadline. Injectable so a test can prove the bound without
	 * waiting out the real one. */
	jarDeadlineMs?: number;
}

export interface RestoreReport {
	restored: number;
	refused: { name: string; reason: string }[];
	failed: { name: string; reason: string }[];
	drifted: { name: string; reason: string }[];
	/** Cookies written back with a DELIBERATE adjustment to an attribute the
	 * design does not promise verbatim (see `restoreParams`), reported rather than
	 * left for a reader to notice. */
	adjusted: { name: string; reason: string }[];
	outcome:
		| "restored"
		| "no-snapshot"
		| "unclean-previous-run"
		| "cipher-unavailable"
		| "unreadable"
		| "disabled"
		| "channel-unavailable";
}

export interface SnapshotReport {
	written: boolean;
	saved: number;
	refused: { name: string; reason: string }[];
	reason?: string;
}

/**
 * The restore parameters for one stored cookie.
 *
 * Every rule here is measured (see the module comment), because the failure modes
 * are silent: the wrong url scheme changes the Secure attribute, the wrong
 * `domain` shape changes the scope from host-only to every subdomain, and a
 * dropped `partitionKey` removes the isolation.
 *
 *   - `domain` is passed ONLY when it carries the leading dot CDP uses for a
 *     domain cookie. Without the dot the cookie was host-only, and the host-only
 *     shape is expressed by passing no domain at all with a url on that host.
 *   - the url's scheme follows `secure`, not `sourceScheme`: an https url forces
 *     Secure (measured), so a non-Secure cookie has to be written through an http
 *     url even when its source scheme was https, and the recorded `sourceScheme`
 *     is then passed explicitly so that pairing survives.
 *   - `sourcePort` goes in the url only when it is not the scheme's default, and
 *     is passed explicitly either way.
 *   - no `expires` at all: that is what makes the restored cookie a session
 *     cookie again.
 *   - an absent `sameSite` is omitted rather than sent as `Lax`, which is what
 *     keeps "unspecified" unspecified.
 */
export function restoreParams(cookie: StoredCookie): Record<string, unknown> {
	const secure = cookie.secure === true;
	const scheme = secure ? "https" : "http";
	const host = cookie.domain.replace(LEADING_DOT, "");
	/*
	 * The url carries the scheme, host and path. `secure` decides the SCHEME rather
	 * than the recorded source scheme, because an https url forces the Secure
	 * attribute (measured), so a cookie set over http with the Secure attribute and a
	 * cookie set over https without it have to be spelled differently.
	 *
	 * The PORT belongs to the source scheme instead, and is spelled in the url only
	 * when it differs from ITS OWN scheme's default. Deriving it from the url's
	 * scheme produced `http://host:443/` for a cookie set over https without the
	 * Secure attribute — a host:port pair the site never had.
	 *
	 * A Secure cookie cannot be created from an insecure source scheme at all
	 * (measured: "Secure attribute cannot be set for a cookie with an insecure source
	 * scheme"). That pairing only occurs for a trustworthy-but-insecure origin such
	 * as http://localhost, and the closest faithful restore is the Secure source.
	 */
	const sourceScheme = secure ? "Secure" : (cookie.sourceScheme ?? "NonSecure");
	const sourceDefaultPort = sourceScheme === "Secure" ? 443 : 80;
	const sourcePort =
		secure && cookie.sourceScheme !== "Secure"
			? 443
			: (cookie.sourcePort ?? sourceDefaultPort);
	const port = sourcePort === sourceDefaultPort ? "" : `:${sourcePort}`;
	const params: Record<string, unknown> = {
		name: cookie.name,
		value: cookie.value,
		url: `${scheme}://${host}${port}${cookie.path.startsWith("/") ? cookie.path : `/${cookie.path}`}`,
		path: cookie.path,
		secure,
		httpOnly: cookie.httpOnly === true,
		sourceScheme,
		sourcePort,
	};
	if (cookie.domain.startsWith(".")) params.domain = cookie.domain;
	if (cookie.sameSite) params.sameSite = cookie.sameSite;
	if (cookie.priority && ["Low", "Medium", "High"].includes(cookie.priority)) {
		params.priority = cookie.priority;
	}
	if (cookie.partitionKey) {
		params.partitionKey = {
			topLevelSite: cookie.partitionKey.topLevelSite,
			hasCrossSiteAncestor: cookie.partitionKey.hasCrossSiteAncestor,
		};
	}
	return params;
}

/** A partition key that can be written back exactly, or null with the reason. */
export function partitionKeyForWrite(
	cookie: JarCookie,
): { ok: true; key: Required<CookiePartitionKeyLike> | null } | { ok: false } {
	if (cookie.partitionKeyOpaque === true) return { ok: false };
	const key = cookie.partitionKey;
	if (key === undefined || key === null) return { ok: true, key: null };
	// `hasCrossSiteAncestor` is not optional in the wire type: with it absent the
	// setter rejects the call ("Invalid parameters", measured), and a missing
	// top-level site is not a key that can be reconstructed.
	if (typeof key.topLevelSite !== "string" || key.topLevelSite === "") {
		return { ok: false };
	}
	if (typeof key.hasCrossSiteAncestor !== "boolean") return { ok: false };
	return {
		ok: true,
		key: {
			topLevelSite: key.topLevelSite,
			hasCrossSiteAncestor: key.hasCrossSiteAncestor,
		},
	};
}

/** Whether the jar entry is a session cookie. Both fields are checked because
 * either alone has been the only one present in different Chromium builds. */
export function isSessionCookie(cookie: JarCookie): boolean {
	return cookie.session === true || (cookie.expires ?? -1) < 0;
}

/** The snapshot record for a jar entry, or the reason it cannot be stored. */
export function storedCookieFor(
	cookie: JarCookie,
): { ok: true; cookie: StoredCookie } | { ok: false; reason: string } {
	if (!isSessionCookie(cookie))
		return { ok: false, reason: REFUSAL.notSession };
	if (!cookie.name || !cookie.domain || !cookie.path) {
		return { ok: false, reason: REFUSAL.malformed };
	}
	const partition = partitionKeyForWrite(cookie);
	if (!partition.ok) {
		// Refusing is the whole point: writing this cookie without its key would
		// hand it to every top-level site, which is a widening of the cookie's
		// reach that no later correction can undo.
		return { ok: false, reason: REFUSAL.partitionUnrepresentable };
	}
	return {
		ok: true,
		cookie: {
			name: cookie.name,
			value: cookie.value,
			domain: cookie.domain,
			path: cookie.path,
			secure: cookie.secure === true,
			httpOnly: cookie.httpOnly === true,
			sameSite: cookie.sameSite ?? null,
			priority: cookie.priority ?? null,
			sourceScheme: cookie.sourceScheme ?? null,
			sourcePort:
				typeof cookie.sourcePort === "number" ? cookie.sourcePort : null,
			partitionKey: partition.key,
		},
	};
}

/** The identity a restored cookie is compared against in the live jar. */
export function cookieIdentity(parts: {
	name: string;
	domain: string;
	path: string;
	partitionKey?: CookiePartitionKeyLike | null;
}): string {
	const key = parts.partitionKey;
	return [
		parts.name,
		parts.domain,
		parts.path,
		key
			? `${key.topLevelSite ?? ""}|${key.hasCrossSiteAncestor === true}`
			: "unpartitioned",
	].join("\u0001");
}

/** SameSite in the shape the two sides agree on, for comparison only. */
const sameSiteShape = (value: string | null | undefined): string =>
	(value ?? "unspecified").toLowerCase();

/**
 * A `VaultCipher` over Electron's `safeStorage`.
 *
 * FAIL CLOSED, in each direction, and the reasons are the point:
 *   - no encryption available (no keychain, a headless/keyless session) -> no
 *     snapshot is written and no snapshot is read. A plaintext fallback is not
 *     offered: this file is a credential at rest.
 *   - Linux's `basic_text` backend encrypts with a hardcoded key, so it is
 *     "available" while providing no protection; it is refused by name, as is
 *     `unknown` and any backend this build does not recognise.
 *   - a decrypt or encrypt failure is a refusal, never a downgrade.
 *
 * A SIGNED-APP UPDATE can change keychain continuity: macOS keys the item to the
 * app's identity, so an app signed by a different team — or one whose name
 * changed — can be denied the old item. That arrives here as a `decrypt` throw,
 * which is handled as corruption: the snapshot is discarded, the user logs in
 * again, and nothing is silently restored.
 *
 * WHAT THE FIRST BULLET COSTS, and why the cheap questions come first: asking
 * `safeStorage` can BLOCK the main thread. Measured in Electron 44.3.0 with a bare
 * scratch home — the shape an isolated harness forces — `isEncryptionAvailable()`
 * took 7785 ms and returned false, and a 50 ms heartbeat did not tick ONCE while
 * it ran, so nothing in this process could have timed it out. Under other keychain
 * states it waits on a SecurityAgent prompt that an unattended launch can never
 * answer. So the questions that cost nothing are asked first — whether the macOS
 * login keychain file is there at all, and which backend a Linux session selected
 * — and a refusal from either leaves the snapshot in place rather than destroying
 * it, with the marker's rule deciding what the next start trusts.
 */
/**
 * The macOS keychain file `safeStorage` reads its item out of, or `null` on a
 * platform with no such file to check (Linux's secret-service keyring, Windows's
 * credential store — neither has a keychain file, and the Linux backend question
 * below is the cheap precondition on that side).
 */
const loginKeychainPath = (platform: NodeJS.Platform): string | null =>
	platform === "darwin"
		? join(homedir(), "Library", "Keychains", "login.keychain-db")
		: null;

export function createSafeStorageCipher(
	backend: {
		isEncryptionAvailable(): boolean;
		encryptString(plaintext: string): Buffer;
		decryptString(ciphertext: Buffer): string;
		getSelectedStorageBackend?(): string;
	},
	platform: NodeJS.Platform = process.platform,
	/** Injectable so a test can state the premise instead of inheriting the
	 * machine's own keychain. */
	keychainExists: (path: string) => boolean = existsSync,
): VaultCipher {
	const LINUX_GOOD_BACKENDS = [
		"gnome_libsecret",
		"kwallet",
		"kwallet5",
		"kwallet6",
	];
	return {
		availability() {
			// CHEAP PRECONDITIONS FIRST, because the question below can BLOCK the main
			// thread. Measured in Electron 44.3.0 with a bare scratch home (the shape
			// every isolated harness has, and the same shape as a severed or locked
			// keychain): `isEncryptionAvailable()` took 7785 ms and returned false, and
			// a 50 ms heartbeat did not tick ONCE while it ran — so the main process was
			// frozen for those seconds and no timer of ours could have bounded them.
			// Under other keychain states the call waits on a SecurityAgent prompt
			// instead, which an unattended launch can never answer. A hang is worse than
			// a refusal for credential-at-rest material, so it is asked only when what
			// it needs is actually there:
			//   - a macOS session with no login keychain file has no item to read, and
			//     the answer is already known (measured false) — refuse without asking;
			//   - on Linux the selected backend can be read without disturbing the
			//     keyring, so a backend that cannot protect a credential is a refusal
			//     before the keyring is touched at all.
			// Neither is a downgrade: the snapshot is left in place, and the marker's
			// rule decides whether the next start discards it.
			const keychain = loginKeychainPath(platform);
			if (keychain !== null && !keychainExists(keychain)) {
				return {
					ok: false,
					reason: `the macOS login keychain is not at ${keychain}, so the stored session cookies cannot be read`,
				};
			}
			if (platform === "linux") {
				let selected: string | undefined;
				try {
					selected = backend.getSelectedStorageBackend?.();
				} catch {
					selected = undefined;
				}
				if (!selected || !LINUX_GOOD_BACKENDS.includes(selected)) {
					// `basic_text` is available-but-plaintext and `unknown` is no answer
					// at all; both are refusals rather than a weaker promise.
					return {
						ok: false,
						reason: `the Linux keyring backend is ${selected ?? "unknown"}, which does not protect a stored credential`,
					};
				}
			}
			try {
				if (!backend.isEncryptionAvailable()) {
					return { ok: false, reason: "the OS keychain is not available" };
				}
			} catch (error) {
				return {
					ok: false,
					reason: `the OS keychain could not be queried: ${String(error)}`,
				};
			}
			return { ok: true };
		},
		encrypt(plaintext: string): Buffer {
			return backend.encryptString(plaintext);
		},
		decrypt(ciphertext: Buffer): string {
			return backend.decryptString(ciphertext);
		},
	};
}

/** fsync a directory so a rename or unlink in it survives a power loss. Not
 * every platform allows this; a refusal is not a reason to fail the write. */
function fsyncDir(path: string): void {
	let fd: number | null = null;
	try {
		fd = openSync(path, "r");
		fsyncSync(fd);
	} catch {
		// Best effort, documented: the file's own contents are already fsynced.
	} finally {
		if (fd !== null) {
			try {
				closeSync(fd);
			} catch {
				// Nothing left to do about a directory handle.
			}
		}
	}
}

/**
 * Write a file atomically AND durably.
 *
 * `atomic-json.ts`'s staged-write-then-rename is reused as the shape, and the
 * fsync is added because the two files here are crash-consistency state: the
 * marker's whole job is to survive a crash, so an fsync that the policy files can
 * live without is load-bearing here. The mode is 0600 in a 0700 directory for the
 * same reason as the other private files: the snapshot is a credential.
 */
export function writeFileDurable(path: string, data: Buffer): void {
	mkdirSync(dirname(path), { recursive: true, mode: PRIVATE_DIR_MODE });
	const staged = `${path}.${process.pid}.tmp`;
	const fd = openSync(staged, "w", PRIVATE_FILE_MODE);
	try {
		writeFileSync(fd, data);
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
	renameSync(staged, path);
	fsyncDir(dirname(path));
}

/** Remove a file durably: the unlink is the invalidation, so it must be on disk
 * before the caller reports success.
 *
 * Only ENOENT is tolerated, because absent is the done state. Every other error
 * means the file is STILL THERE, so it is thrown rather than swallowed: catching
 * everything here made a clear that could not unlink the snapshot resolve and
 * log "discarded the stored session cookies" while the ciphertext stayed on
 * disk (measured, with the snapshot's directory made unwritable) — the wrong
 * thing to tell a user about credential material. Callers that can carry on
 * without a removal handle it at their own call site, where the consequence is
 * known (`restore` and `snapshot` below). */
export function removeDurable(path: string): void {
	try {
		unlinkSync(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	fsyncDir(dirname(path));
}

/**
 * The snapshot's on-disk wrapper: the ciphertext, then an integrity digest of it.
 *
 * WHY THIS EXISTS: `safeStorage`'s macOS path does not authenticate what it
 * encrypts — measured in the pinned runtime, a bit-flip inside the payload does
 * not make `decryptString` throw, it returns a string whose head is still the
 * intact plaintext prefix. So a damaged snapshot used to be caught by nothing
 * but `JSON.parse` and the shape check, and a targeted rewrite that stays
 * parseable was restored as a valid-but-altered document: credential material
 * silently wrong, which is the one outcome the rest of this module refuses. The
 * digest makes that refusal structural, and it covers the WHOLE ciphertext — so
 * the document's version, its generation, and every cookie identity and
 * attribute it asserts are covered transitively. There is deliberately no
 * out-of-band metadata that is trusted before the digest: the payload is the
 * only input, and it is not decrypted until the digest over it matches.
 *
 * WHAT IT IS NOT: a MAC. It carries no secret, so it detects corruption and any
 * rewrite that does not recompute it, and not a rewrite that does (see the
 * module header for why that is stated rather than engineered around).
 *
 * The format is the ciphertext followed by a fixed-size ASCII suffix,
 * `\nsha256=` plus 64 lowercase hex digits. Fixed-length and textual on purpose:
 * the boundary needs no parser to find, the ciphertext stays byte-for-byte the
 * prefix of the file, and a file too short to hold the suffix, or whose suffix
 * is not exactly that shape — a snapshot written before the digest existed, or
 * by a future scheme — is refused rather than guessed at. Refusing an old file
 * costs one login after an upgrade; trusting one unverified would put a file no
 * one can check on the same path as a checked one.
 */
/**
 * The suffix that carries the digest: a delimiter that cannot occur inside the
 * encoded payload, then the digest's own algorithm name. The length is derived
 * from it rather than written a second time, so the two cannot drift apart.
 */
const DIGEST_PREFIX = "\nsha256=";
const DIGEST_SUFFIX_BYTES = DIGEST_PREFIX.length + 64;
/** Bound into the digest so that a digest of this file's bytes cannot be replayed
 * as the digest of some other file's bytes, or of another scheme's. */
const DIGEST_DOMAIN = "local-operator/session-cookies/v1\n";
const digestOf = (ciphertext: Buffer): string =>
	createHash("sha256").update(DIGEST_DOMAIN).update(ciphertext).digest("hex");

/** Append this file's integrity digest to the ciphertext that is going on disk. */
function sealSnapshotCiphertext(ciphertext: Buffer): Buffer {
	return Buffer.concat([
		ciphertext,
		Buffer.from(`${DIGEST_PREFIX}${digestOf(ciphertext)}`),
	]);
}

/**
 * Verify a stored snapshot and return the ciphertext it wraps. Throws — the same
 * refusal as any other unreadable snapshot — when the file carries no digest of
 * the expected shape or when the digest disagrees with the bytes, so a caller
 * never gets unverified bytes to decrypt.
 */
function openSnapshotCiphertext(stored: Buffer): Buffer {
	if (stored.length <= DIGEST_SUFFIX_BYTES) {
		throw new Error("the snapshot is too short to carry an integrity digest");
	}
	const suffix = stored
		.subarray(stored.length - DIGEST_SUFFIX_BYTES)
		.toString("ascii");
	if (!suffix.startsWith(DIGEST_PREFIX)) {
		throw new Error(
			"the snapshot carries no integrity digest of the expected shape",
		);
	}
	const ciphertext = stored.subarray(0, stored.length - DIGEST_SUFFIX_BYTES);
	// A plain comparison, deliberately not constant-time: the digest holds no
	// secret, so its timing leaks nothing a reader of this file does not already
	// have in full.
	if (suffix.slice(DIGEST_PREFIX.length) !== digestOf(ciphertext)) {
		throw new Error(
			"the snapshot's integrity digest does not match its ciphertext, so it is corrupt or was rewritten",
		);
	}
	return ciphertext;
}

/**
 * The vault: one per browser profile, owned by the browser host, main process
 * only.
 *
 * Serialised through a promise queue. Snapshot, restore and clear all mutate the
 * same two files and the same jar, and the interleaving that matters is real: a
 * clear that lands between a restore's read and its write could be followed by the
 * restore writing cookies back after the user asked for them gone.
 */
export class SessionCookieVault {
	private queue: Promise<unknown> = Promise.resolve();
	/** Set when the marker could not be written: the vault cannot then promise
	 * that a crash will be detected, so it must not restore or snapshot at all. */
	private disabledReason: string | null = null;
	/** Whether the jar channel was opened by `restore()`. The quit path must never
	 * be the first user of that channel: opening it there needs a renderer, and a
	 * renderer created while the app is tearing down never comes up (measured). */
	private channelReady = false;

	constructor(private readonly options: SessionCookieVaultOptions) {}

	private log(message: string): void {
		this.options.log(`[browser] ${message}`);
	}

	private run<T>(work: () => Promise<T>): Promise<T> {
		const next = this.queue.then(work, work);
		this.queue = next.then(
			() => undefined,
			() => undefined,
		);
		return next;
	}

	/**
	 * Startup, before any page can load.
	 *
	 * The order is the crash-consistency rule and it is not rearranged by
	 * accident: the marker is written FIRST, so a process that dies at any point
	 * after this leaves the mark behind; a snapshot is only ever replayed when the
	 * run that wrote it got all the way to a clean exit and removed it. A crash
	 * therefore loses session cookies, which is exactly what happens today — the
	 * conservative direction, and the only one that cannot replay a cookie the user
	 * revoked in the run that died.
	 */
	async restore(): Promise<RestoreReport> {
		return this.run(async () => {
			const report: RestoreReport = {
				restored: 0,
				refused: [],
				failed: [],
				drifted: [],
				adjusted: [],
				outcome: "no-snapshot",
			};
			const generation = randomUUID();
			const marker = this.readMarker();
			if (marker) {
				// A previous run did not shut down cleanly, so its browsing may have
				// changed cookies the snapshot still shows as present. Discard it.
				//
				// The marker says WHICH kind of unclean run it was, because the two are
				// not the same event: a run that could not open the jar channel had no
				// persistence at all, and reporting it as a crash sends a reader after
				// a crash that never happened.
				this.log(
					marker.channelUnavailable
						? `session cookies: the previous run could not open the cookie-jar channel (${marker.channelUnavailable}), so the stored session cookies were discarded`
						: "session cookies: the previous run did not shut down cleanly, so the stored session cookies were discarded",
				);
				try {
					removeDurable(this.options.snapshotPath);
				} catch (error) {
					// The removal IS the invalidation: carrying on would find the file again
					// at the `existsSync` below and replay exactly the snapshot this branch
					// refuses. Stop here, restore nothing, and say so.
					this.log(
						`session cookies: the stored session cookies could not be discarded (${String(error)}); not restoring anything`,
					);
					report.outcome = "unclean-previous-run";
					return report;
				}
				try {
					removeDurable(this.options.markerPath);
				} catch (error) {
					// Harmless, and the marker is overwritten below anyway: until it is, a
					// marker that could not be removed only means "discard again", which is
					// the conservative direction.
					this.log(
						`session cookies: the previous run's shutdown marker could not be removed (${String(error)})`,
					);
				}
				report.outcome = "unclean-previous-run";
			}
			try {
				writeFileDurable(
					this.options.markerPath,
					Buffer.from(
						`${JSON.stringify({ generation, pid: process.pid, startedAt: this.now() }, null, 2)}\n`,
					),
				);
			} catch (error) {
				// Without the marker a crash is undetectable, so a stored snapshot
				// could be replayed after one. Refuse to take part this run.
				this.disabledReason = `could not write the session-cookie marker (${String(error)})`;
				this.log(
					`session cookies: ${this.disabledReason}; not restoring anything`,
				);
				try {
					removeDurable(this.options.snapshotPath);
				} catch (discardError) {
					// Left in place for a later run to fail closed on. This run cannot tell a
					// crash from a clean exit without a marker, so it has no basis for
					// invalidating anything; the next run that CAN write a marker decides.
					this.log(
						`session cookies: the stored session cookies could not be discarded (${String(discardError)})`,
					);
				}
				report.outcome = "disabled";
				return report;
			}

			// Warm the channel BEFORE the snapshot check, so the first run of an app
			// store (nothing to restore yet) still opens it while the app is healthy
			// rather than on the quit path. A channel that cannot be opened is reported
			// and not fatal: the run simply has no persistence.
			try {
				const prepare = this.options.jar.prepare;
				if (prepare) {
					await this.boundedJar(
						() => prepare.call(this.options.jar),
						"opening the cookie-jar channel",
					);
				}
				this.channelReady = true;
			} catch (error) {
				const reason = String(error);
				this.log(
					`session cookies: the cookie-jar channel could not be opened (${reason}); session cookies will not be restored or saved this run, and the marker this run leaves means the stored snapshot will be discarded at the next start`,
				);
				this.noteChannelUnavailable(reason, generation);
				report.outcome = "channel-unavailable";
				return report;
			}

			// Nothing stored is the ordinary state of a first run, so it is not an
			// error, not a keychain problem, and not worth a log line.
			if (!existsSync(this.options.snapshotPath)) return report;

			const availability = this.options.cipher.availability();
			if (!availability.ok) {
				// The snapshot is left alone: the marker that is now on disk makes the
				// next run discard it if this one does not end cleanly, and a keychain
				// that is merely unavailable for this run should not destroy the file.
				this.log(
					`session cookies: not restoring (${availability.reason}); the stored cookies were left in place and will be discarded unless this run is clean`,
				);
				report.outcome = "cipher-unavailable";
				return report;
			}

			let snapshot: CookieSnapshot | null;
			try {
				snapshot = this.readSnapshot();
			} catch (error) {
				// Corrupt ciphertext, a digest that disagrees with it, or a key that no
				// longer decrypts it (an app re-signed with a different identity does exactly
				// this). Fail closed and remove the file rather than retrying it every launch.
				// An error thrown out of `readSnapshot` means nothing was decrypted and
				// nothing was applied: the digest is checked first, then `JSON.parse` and the
				// shape check, because `safeStorage` does not authenticate what it encrypted
				// (see the module header).
				this.log(
					`session cookies: the stored snapshot could not be read (${String(error)}); discarding it`,
				);
				try {
					removeDurable(this.options.snapshotPath);
				} catch (discardError) {
					// Nothing can be restored from it either way, so this is reporting rather
					// than recovery: the next start reads it, refuses it, and tries again.
					this.log(
						`session cookies: the unreadable snapshot could not be discarded (${String(discardError)})`,
					);
				}
				report.outcome = "unreadable";
				return report;
			}
			if (!snapshot) return report;

			// What is already in the jar, so a restore never overwrites a newer
			// cookie: only session cookies can be missing here (they are what this
			// feature restores), so a same-identity entry that is NOT a session
			// cookie is a cookie the site has since replaced with a persistent one.
			const existing = new Set<string>();
			try {
				for (const cookie of await this.boundedJar(
					() => this.options.jar.readAllCookies(),
					"reading the cookie jar before restoring",
				)) {
					if (!isSessionCookie(cookie)) {
						existing.add(
							cookieIdentity({
								name: cookie.name,
								domain: cookie.domain,
								path: cookie.path,
								partitionKey: cookie.partitionKey ?? null,
							}),
						);
					}
				}
			} catch (error) {
				this.log(
					`session cookies: could not read the cookie jar before restoring (${String(error)})`,
				);
				report.outcome = "unreadable";
				return report;
			}

			const attempted = new Map<string, Record<string, unknown>>();
			for (const cookie of snapshot.cookies) {
				const identity = cookieIdentity(cookie);
				if (existing.has(identity)) {
					// A live non-session cookie with this identity outranks the
					// snapshot: it was written after the snapshot was taken (a site
					// replacing a session cookie with a persistent one is the ordinary
					// case), so replaying the older session cookie would overwrite a
					// newer one. Skipping it is also what keeps "never extend an
					// expiry" true by construction.
					report.refused.push({
						name: cookie.name,
						reason: "newer-persistent-cookie-present",
					});
					continue;
				}
				const params = restoreParams(cookie);
				attempted.set(identity, params);
				if (cookie.secure && cookie.sourceScheme !== "Secure") {
					// The one adjustment this design makes to a non-promised attribute,
					// reported rather than hidden: Chromium refuses to create a Secure
					// cookie from an insecure source scheme (measured), and this pairing
					// only occurs for a trustworthy-but-insecure origin such as
					// http://localhost. The Secure attribute itself, which IS promised, is
					// preserved — the source scheme is upgraded to match it.
					report.adjusted.push({
						name: cookie.name,
						reason: `secure cookie from an insecure source: source scheme raised from ${String(cookie.sourceScheme)} to Secure`,
					});
				}
				try {
					await this.boundedJar(
						() => this.options.jar.writeCookie(params),
						`writing ${cookie.name} back`,
					);
					report.restored += 1;
				} catch (error) {
					report.failed.push({ name: cookie.name, reason: String(error) });
				}
			}

			// Read back what actually landed, so "restored" is a measured claim
			// rather than a count of calls that did not throw.
			try {
				const after = await this.boundedJar(
					() => this.options.jar.readAllCookies(),
					"reading back the restored cookies",
				);
				const byIdentity = new Map(
					after.map((cookie) => [
						cookieIdentity({
							name: cookie.name,
							domain: cookie.domain,
							path: cookie.path,
							partitionKey: cookie.partitionKey ?? null,
						}),
						cookie,
					]),
				);
				for (const stored of snapshot.cookies) {
					const identity = cookieIdentity(stored);
					if (!attempted.has(identity)) continue;
					const live = byIdentity.get(identity);
					if (!live) {
						report.drifted.push({
							name: stored.name,
							reason: "not present after the write",
						});
						continue;
					}
					const drift =
						attributeDrift(stored, live) ??
						sourceMetadataDrift(attempted.get(identity), live);
					if (drift) report.drifted.push({ name: stored.name, reason: drift });
				}
			} catch (error) {
				report.drifted.push({
					name: "(all)",
					reason: `read-back failed: ${String(error)}`,
				});
			}

			report.outcome = "restored";
			const notes = [
				report.refused.length ? `skipped ${report.refused.length}` : "",
				report.failed.length ? `failed ${report.failed.length}` : "",
				report.drifted.length ? `drifted ${report.drifted.length}` : "",
				report.adjusted.length ? `adjusted ${report.adjusted.length}` : "",
			].filter(Boolean);
			this.log(
				`session cookies: restored ${report.restored} of ${snapshot.cookies.length} stored session cookies${notes.length ? ` (${notes.join(", ")})` : ""}`,
			);
			for (const entry of [
				...report.refused,
				...report.failed,
				...report.drifted,
			]) {
				this.log(`session cookies: ${entry.name}: ${entry.reason}`);
			}
			return report;
		});
	}

	/**
	 * Clean shutdown: store the jar's session cookies and then remove the marker.
	 *
	 * The marker is removed only AFTER the snapshot is durably on disk, so a crash
	 * in between leaves the mark and the next run discards this snapshot. The other
	 * order would let a crash claim a clean shutdown it never had.
	 */
	async snapshot(): Promise<SnapshotReport> {
		return this.run(async () => {
			const report: SnapshotReport = { written: false, saved: 0, refused: [] };
			if (this.disabledReason) {
				report.reason = this.disabledReason;
				return report;
			}
			if (!this.channelReady) {
				// Deliberately not an attempt: reading the jar here would open the
				// channel on the quit path, which is where it hangs. The marker is left
				// in place, so the next start discards rather than replays.
				report.reason = "the cookie-jar channel was never opened";
				this.log(
					"session cookies: not saving, the cookie-jar channel was never opened",
				);
				return report;
			}
			const availability = this.options.cipher.availability();
			if (!availability.ok) {
				report.reason = availability.reason;
				this.log(`session cookies: not saving (${availability.reason})`);
				return report;
			}
			let jar: JarCookie[];
			try {
				await this.options.flushStore?.();
				jar = await this.boundedJar(
					() => this.options.jar.readAllCookies(),
					"reading the cookie jar for the snapshot",
				);
			} catch (error) {
				report.reason = String(error);
				this.log(
					`session cookies: could not read the cookie jar (${String(error)})`,
				);
				return report;
			}
			const cookies: StoredCookie[] = [];
			for (const cookie of jar) {
				const stored = storedCookieFor(cookie);
				if (stored.ok) {
					cookies.push(stored.cookie);
				} else if (stored.reason !== REFUSAL.notSession) {
					report.refused.push({ name: cookie.name, reason: stored.reason });
					this.log(
						`session cookies: not saving ${cookie.name}: ${stored.reason}`,
					);
				}
			}
			const document: CookieSnapshot = {
				version: SNAPSHOT_VERSION,
				generation: this.readMarker()?.generation ?? randomUUID(),
				writtenAt: this.now(),
				cookies,
			};
			try {
				writeFileDurable(
					this.options.snapshotPath,
					// Sealed, not raw ciphertext: the digest is written in the same atomic
					// replace as the bytes it covers, so there is no window in which a
					// published snapshot and its digest disagree.
					sealSnapshotCiphertext(
						this.options.cipher.encrypt(JSON.stringify(document)),
					),
				);
			} catch (error) {
				report.reason = String(error);
				this.log(
					`session cookies: could not write the snapshot (${String(error)})`,
				);
				return report;
			}
			// The one call that may not be swallowed: a marker that stays behind makes the
			// next start discard a snapshot that is perfectly good, so this is reported
			// rather than claimed as a clean save.
			try {
				removeDurable(this.options.markerPath);
			} catch (error) {
				this.log(
					`session cookies: the snapshot was written but the clean-shutdown marker could not be removed (${String(error)}); the next start will discard it`,
				);
				report.reason = String(error);
				return report;
			}
			report.written = true;
			report.saved = cookies.length;
			this.log(
				`session cookies: saved ${cookies.length} session cookies for the next start`,
			);
			return report;
		});
	}

	/**
	 * Clear browsing data, with the invalidation the clearing owes.
	 *
	 * The snapshot is removed — and the removal is durable — BEFORE the jar is
	 * cleared, so a crash in the middle cannot leave a snapshot that a restart
	 * would replay after the user asked for their cookies to be gone. Clearing the
	 * cache alone must not log anybody out, so it does not touch the snapshot.
	 * Nothing here needs to decrypt, which is what makes the invalidation hold when
	 * the keychain is unavailable.
	 */
	async clearBrowsingData(what: ClearWhat): Promise<void> {
		return this.run(async () => {
			if (what !== "cache") {
				// The removal is the invalidation, and it has to be durable BEFORE the clear
				// reports success — so a removal that failed must not be reported as a
				// discard. `removeDurable` throws on anything but ENOENT and the error
				// propagates out of this call: the user's clear fails loudly (and the jar is
				// NOT cleared, since clearing it while the snapshot survived would let the
				// next start replay what they asked to be gone) instead of resolving on a
				// lie. Measured before this fix: with the snapshot's directory unwritable
				// the call resolved and logged a discard while the ciphertext stayed.
				removeDurable(this.options.snapshotPath);
				this.log(
					"session cookies: discarded the stored session cookies as part of clearing browsing data",
				);
			}
			await this.options.clearSessionData(what);
		});
	}

	private now(): number {
		return this.options.now?.() ?? Date.now();
	}

	/** Bound one call into the jar channel.
	 *
	 * The channel is a CDP attachment to a renderer, and the hang this feature
	 * already found on the quit path was exactly that primitive never answering a
	 * command. Startup awaits the restore and the quit awaits the snapshot, so an
	 * unbounded call into it holds both: every jar interaction therefore goes
	 * through the same per-call deadline the CDP layer uses, and a channel that
	 * stops answering degrades to "no persistence this run" — which the design
	 * already handles — instead of stalling the app. */
	private boundedJar<T>(op: () => T | Promise<T>, what: string): Promise<T> {
		return deadline(
			Promise.resolve().then(op),
			this.options.jarDeadlineMs ?? CDP_DEADLINE_MS,
			what,
		);
	}

	/** Record in the marker that this run could not open the jar channel.
	 *
	 * The marker itself has to STAY: this run still browses, so a crash of it must
	 * remain detectable and its stored snapshot must not be replayed. What it must
	 * not do is read as a crash — measured: with the marker written before the
	 * warm-up and left behind, one transient channel failure made the next start
	 * log "the previous run did not shut down cleanly" and discard a snapshot that
	 * was fine. Rewriting the marker with the reason is best effort; failing to
	 * rewrite it leaves exactly the state we were already in. */
	private noteChannelUnavailable(reason: string, generation: string): void {
		try {
			writeFileDurable(
				this.options.markerPath,
				Buffer.from(
					`${JSON.stringify(
						{
							generation,
							pid: process.pid,
							startedAt: this.now(),
							channelUnavailable: reason,
						},
						null,
						2,
					)}\n`,
				),
			);
		} catch (error) {
			this.log(
				`session cookies: could not record why the cookie-jar channel was unavailable (${String(error)})`,
			);
		}
	}

	private readMarker(): {
		generation?: string;
		channelUnavailable?: string;
	} | null {
		try {
			const parsed = JSON.parse(
				readFileSync(this.options.markerPath, "utf8"),
			) as {
				generation?: string;
				channelUnavailable?: string;
			};
			return parsed && typeof parsed === "object" ? parsed : null;
		} catch {
			// Missing is the only case that matters to the caller; a marker that
			// exists but does not parse still proves a run did not finish cleanly,
			// so it is reported as present rather than as absent.
			return readMarkerExists(this.options.markerPath) ? {} : null;
		}
	}

	private readSnapshot(): CookieSnapshot | null {
		let stored: Buffer;
		try {
			stored = readFileSync(this.options.snapshotPath);
		} catch {
			return null;
		}
		// The digest is verified here, before the ciphertext is handed to the
		// cipher: a mismatch throws out of this method as an unreadable snapshot, so
		// the caller refuses and discards it instead of decrypting bytes nothing has
		// vouched for.
		const parsed = JSON.parse(
			this.options.cipher.decrypt(openSnapshotCiphertext(stored)),
		) as CookieSnapshot;
		if (
			!parsed ||
			parsed.version !== SNAPSHOT_VERSION ||
			!Array.isArray(parsed.cookies)
		) {
			throw new Error(
				`unexpected snapshot shape (version ${String(parsed?.version)})`,
			);
		}
		return parsed;
	}
}

/** Whether a file exists at all, used to tell "absent" from "unreadable" for the
 * marker, where the difference decides whether a snapshot may be replayed. */
function readMarkerExists(path: string): boolean {
	try {
		readFileSync(path);
		return true;
	} catch {
		return false;
	}
}

/** Whether the source metadata the write asked for is what the jar kept. This is
 * the half `attributeDrift` deliberately leaves out: those attributes are not
 * promised verbatim, so a divergence is a finding only if the jar did not do what
 * the write asked for. */
export function sourceMetadataDrift(
	params: Record<string, unknown> | undefined,
	live: JarCookie,
): string | null {
	if (!params) return null;
	if (
		params.sourceScheme !== undefined &&
		params.sourceScheme !== live.sourceScheme
	) {
		return `the jar stored source scheme ${String(live.sourceScheme)} where the write asked for ${String(params.sourceScheme)}`;
	}
	if (
		params.sourcePort !== undefined &&
		Number(params.sourcePort) !== Number(live.sourcePort)
	) {
		return `the jar stored source port ${String(live.sourcePort)} where the write asked for ${String(params.sourcePort)}`;
	}
	return null;
}

/** The first attribute that did not survive the round trip, or null. Only the
 * attributes the design promises are compared; an incidental difference (a
 * creation time, a size) is not a fidelity failure. Source scheme and port are
 * checked separately, against the write's own parameters — see
 * `sourceMetadataDrift`. */
export function attributeDrift(
	stored: StoredCookie,
	live: JarCookie,
): string | null {
	if (live.value !== stored.value) return "value changed";
	if (live.secure !== stored.secure) return `secure became ${live.secure}`;
	if (live.httpOnly !== stored.httpOnly)
		return `httpOnly became ${live.httpOnly}`;
	if (!isSessionCookie(live)) return "no longer a session cookie";
	if (sameSiteShape(live.sameSite) !== sameSiteShape(stored.sameSite)) {
		return `sameSite became ${sameSiteShape(live.sameSite)}`;
	}
	const livePartition = partitionKeyForWrite(live);
	if (!livePartition.ok) return "partition identity is no longer representable";
	if (!samePartition(livePartition.key, stored.partitionKey))
		return "partition identity changed";
	return null;
}

function samePartition(
	a: Required<CookiePartitionKeyLike> | null,
	b: Required<CookiePartitionKeyLike> | null,
): boolean {
	if (a === null || b === null) return a === b;
	return (
		a.topLevelSite === b.topLevelSite &&
		a.hasCrossSiteAncestor === b.hasCrossSiteAncestor
	);
}

/** The paths the vault uses under an app's userData directory. */
export function sessionCookiePaths(userDataDir: string): {
	snapshotPath: string;
	markerPath: string;
} {
	const dir = join(userDataDir, SESSION_COOKIE_DIRNAME);
	return {
		snapshotPath: join(dir, SNAPSHOT_FILENAME),
		markerPath: join(dir, MARKER_FILENAME),
	};
}

/** The subset of Electron's `Debugger` this module uses. Structural, so the
 * desktop suite drives the transport without Chromium. */
export interface DebuggerLike {
	attach(protocolVersion?: string): void;
	isAttached(): boolean;
	sendCommand(
		method: string,
		params?: Record<string, unknown>,
	): Promise<unknown>;
}

/** A target the debugger can be attached to: the host's own hidden view. */
export interface CookieJarTarget {
	debugger: DebuggerLike;
	/** Give the view a document. Measured elsewhere in this tree (`cdp.ts`
	 * `attach()`): a WebContents that has never navigated has no renderer, and CDP
	 * commands to it never get a reply. */
	loadAboutBlank(): Promise<void>;
}

/**
 * The jar channel, over the in-process CDP debugger.
 *
 * WHY the debugger at all: it is the ONLY in-process channel that reports and
 * restores a cookie's CHIPS partition key (see the module comment). It is not the
 * agent RPC surface and not a socket — the attachment is to a hidden view this
 * feature owns, in the main process, and nothing about it is exposed.
 */
export function createDebuggerCookieJar(
	target: CookieJarTarget,
): CookieJarTransport {
	let attached = false;
	const attach = async (): Promise<void> => {
		// ADOPT what is already attached rather than attaching again: Electron
		// refuses a second `attach` with "Debugger is already attached to the
		// target", and a credential path that threw there would fail the whole
		// restore because somebody else had already opened the channel. This is the
		// same rule `cdp.ts` applies to a driven view ("attach to a view, or adopt
		// the attachment we already hold"); the target here is a hidden view this
		// feature owns, so the only possible holder is this module.
		if (attached || target.debugger.isAttached()) {
			attached = true;
			return;
		}
		await target.loadAboutBlank();
		target.debugger.attach("1.3");
		attached = true;
	};
	return {
		prepare: attach,
		async readAllCookies(): Promise<JarCookie[]> {
			await attach();
			const result = (await target.debugger.sendCommand(
				"Network.getAllCookies",
			)) as {
				cookies?: JarCookie[];
			};
			return result?.cookies ?? [];
		},
		async writeCookie(params: Record<string, unknown>): Promise<void> {
			await attach();
			const result = (await target.debugger.sendCommand(
				"Network.setCookie",
				params,
			)) as {
				success?: boolean;
			};
			if (result?.success !== true) {
				// The per-cookie rejection carries Chromium's own reason (an invalid
				// domain, a prefix violation); it is reported for that cookie and the
				// restore continues with the rest.
				throw new Error(
					`the browser refused the cookie: ${JSON.stringify(result ?? null)}`,
				);
			}
		},
	};
}
