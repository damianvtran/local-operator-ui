import { randomUUID } from "node:crypto";
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
import { dirname, join } from "node:path";
import { PRIVATE_DIR_MODE, PRIVATE_FILE_MODE } from "./atomic-json";
import type { ClearWhat } from "./profile";

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
 *     `refuseStoredCookie`/`partitionKeyForWrite` exists to prevent, and
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
 *     build, so the per-cookie `Network.setCookie` is the only usable path.
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
	 * partition). No CDP parameter can express one, so such a cookie is refused. */
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
		| "disabled";
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
 */
export function createSafeStorageCipher(
	backend: {
		isEncryptionAvailable(): boolean;
		encryptString(plaintext: string): Buffer;
		decryptString(ciphertext: Buffer): string;
		getSelectedStorageBackend?(): string;
	},
	platform: NodeJS.Platform = process.platform,
): VaultCipher {
	const LINUX_GOOD_BACKENDS = [
		"gnome_libsecret",
		"kwallet",
		"kwallet5",
		"kwallet6",
	];
	return {
		availability() {
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
 * before the caller reports success. */
export function removeDurable(path: string): void {
	try {
		unlinkSync(path);
	} catch {
		// Absent is the done state.
	}
	fsyncDir(dirname(path));
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
				this.log(
					"session cookies: the previous run did not shut down cleanly, so the stored session cookies were discarded",
				);
				removeDurable(this.options.snapshotPath);
				removeDurable(this.options.markerPath);
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
				removeDurable(this.options.snapshotPath);
				report.outcome = "disabled";
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
				// Corrupt ciphertext, or a key that no longer decrypts it (an app
				// re-signed with a different identity does exactly this). Fail closed
				// and remove the file rather than retrying it every launch.
				this.log(
					`session cookies: the stored snapshot could not be read (${String(error)}); discarding it`,
				);
				removeDurable(this.options.snapshotPath);
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
				for (const cookie of await this.options.jar.readAllCookies()) {
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
					await this.options.jar.writeCookie(params);
					report.restored += 1;
				} catch (error) {
					report.failed.push({ name: cookie.name, reason: String(error) });
				}
			}

			// Read back what actually landed, so "restored" is a measured claim
			// rather than a count of calls that did not throw.
			try {
				const after = await this.options.jar.readAllCookies();
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
			const availability = this.options.cipher.availability();
			if (!availability.ok) {
				report.reason = availability.reason;
				this.log(`session cookies: not saving (${availability.reason})`);
				return report;
			}
			let jar: JarCookie[];
			try {
				await this.options.flushStore?.();
				jar = await this.options.jar.readAllCookies();
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
					this.options.cipher.encrypt(JSON.stringify(document)),
				);
			} catch (error) {
				report.reason = String(error);
				this.log(
					`session cookies: could not write the snapshot (${String(error)})`,
				);
				return report;
			}
			removeDurable(this.options.markerPath);
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

	private readMarker(): { generation?: string } | null {
		try {
			const parsed = JSON.parse(
				readFileSync(this.options.markerPath, "utf8"),
			) as {
				generation?: string;
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
		let raw: Buffer;
		try {
			raw = readFileSync(this.options.snapshotPath);
		} catch {
			return null;
		}
		const parsed = JSON.parse(
			this.options.cipher.decrypt(raw),
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
