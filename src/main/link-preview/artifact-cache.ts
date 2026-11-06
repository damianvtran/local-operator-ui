/**
 * The on-disk artifact cache: image BYTES only, bounded, and addressed by core's
 * scope-derived artifact id PLUS the account that receipt named.
 *
 * WHAT THIS CACHE IS FOR, AND WHAT IT IS NOT. Core already resolves a link into a
 * card, and it already caches that answer with its own TTLs and hit/miss counters
 * (`GET .../link-preview/cache` reports them). This cache exists for exactly one
 * reason: so a scrolling transcript does not re-download the same PNG from the
 * daemon on every re-render. It therefore stores BYTES and a mime, and it stores
 * NOTHING about a page — no title, no description, no site name, and above all no
 * URL. A second metadata cache in main would be the "two fetch paths" the
 * platform decision removed, and it would be a browsing record on disk besides;
 * see `service.ts`'s header for the same rule stated where a reader is most likely
 * to try adding one.
 *
 * THE ID NAMES THE BLOB; THE ACCOUNT FINGERPRINT GATES IT. The file name is the
 * artifact id and nothing else — core derives that id from (account, tenant,
 * canonical URL), so one blob keeps one name and a second key scheme cannot serve
 * the wrong bytes. But a NAME IS NOT A GATE: this cache answers before any
 * transport call, so if a hit were served on the id alone, then a replayed id
 * (another account's card, a session before a re-login, a stale renderer store)
 * would get bytes that core would have refused with `409 account_mismatch`. The
 * index therefore carries `account: sha256(expectedAccountId)` per entry — a
 * fingerprint, never the id itself, so the index still names no identity in
 * plaintext — and a hit whose fingerprint differs from the request's is a MISS.
 * The request then reaches core, which is the authority on whose scope owns what.
 * That is what makes the header's old claim true: a cached file can never be
 * served into another account's session, because the only receipts it will answer
 * are the ones that produced it.
 *
 * AND THE WHOLE DIRECTORY IS DROPPED ON A PRINCIPAL TRANSITION. A fingerprint
 * closes the replay hole; it does not stop a 24 h copy of the previous account's
 * images from sitting on the disk after a sign-out. This repo already has that
 * rule for exactly this class of bytes (`team-bridge-notification-images.ts` keeps
 * private images memory-only for it), so `clear()` exists and is wired to the same
 * principal fence the app's attention service already applies. Nothing here
 * decides WHEN that is; see `index.ts`.
 *
 * FILE MODES ARE THE REPO'S PRIVATE-BYTES RULE: directory `0o700`, files `0o600`
 * (`team-bridge-notify-store.ts`, `viewer-record.ts`). On a Linux `~/.config` a
 * default-mode directory is readable by every local account, and a cached
 * third-party image is not a public artifact of this app.
 *
 * WHAT SURVIVES A RESTART, AND WHY IT IS ONLY THE BYTES. The index
 * (`index.json`) carries `{mime, size, storedAt, lastUsedAt, account}` — the
 * minimum needed to enforce the bounds without stat-ing every file, to answer a
 * read without a sniff, and to answer only the receipt that produced the entry.
 * Nothing in it names a page. The index is written on store, drop, clear and
 * sweep, never on read: a read only moves `lastUsedAt` in memory, because
 * rewriting a JSON file per rendered favicon would cost more than the disk cache
 * saves. A crash therefore loses recency, not bytes — the next sweep re-derives
 * order from the last persisted `lastUsedAt`, which is the safe direction: an
 * artifact may be evicted slightly early, never kept past its TTL.
 *
 * A STALE INDEX NEVER RESURRECTS BYTES. `read` requires BOTH an index entry and a
 * file that loads; a missing file drops the entry and reports a miss, so a torn
 * write or a manual `rm` leaves a cold cache rather than a phantom hit. Startup
 * additionally deletes files no entry describes, so an interrupted `store` cannot
 * leak storage that no accounting knows about.
 *
 * ONE PLACE OWNS THE BYTE ACCOUNTING. `residentBytes` is only ever moved by
 * `forgetEntry`/`rememberEntry`, which each mutate the map and the total in one
 * synchronous step — no `await` between them. A sibling version of this file
 * subtracted in a `read` catch without checking it still owned the entry, so two
 * racing misses on a missing file drove the total negative and the 64 MB bound
 * silently stopped firing; the single-owner rule is why that cannot recur.
 */

import { createHash, randomBytes } from "node:crypto";
import {
	chmod,
	mkdir,
	readFile,
	readdir,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { LINK_PREVIEW_ARTIFACT_ID } from "../../shared/link-preview";

/** 24 h: the same wall-clock life core gives a resolved card, so the bytes behind
 * a card do not outlive the card's own answer by more than the renderer's
 * memoisation of it. */
export const ARTIFACT_TTL_MS = 24 * 60 * 60 * 1000;

/** Resident-byte ceiling for the whole directory. */
export const ARTIFACT_MAX_BYTES = 64 * 1024 * 1024;

/** File-count ceiling. A byte bound alone would let a million 20-byte favicons
 * through, and each file costs an inode and a directory entry regardless of size. */
export const ARTIFACT_MAX_COUNT = 400;

/** How often the bounds are re-applied on the access path. Startup always sweeps;
 * between sweeps this is the most often a read or write may trigger one, so a
 * transcript re-render does not turn into a directory scan per card. */
export const ARTIFACT_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** The largest single blob this cache will keep. Core caps an `og:image` at 2 MiB
 * and a favicon at 256 KiB, so this is headroom rather than a product decision: a
 * body larger than it is not an artifact core produced, and keeping it would let
 * one response eat a thirty-second of the byte budget. */
export const ARTIFACT_MAX_BLOB_BYTES = 4 * 1024 * 1024;

/**
 * The media types this cache will hold, which is exactly the set core's
 * `sniff_raster` can return (`png`, `jpeg`, `gif`, `webp`, `ico` — the ICO entry
 * is spelled `image/vnd.microsoft.icon`).
 *
 * WHY AN ALLOWLIST AND NOT `image/*`. A cached blob crosses IPC as bare bytes and
 * lands in a renderer `<img>`: core's `nosniff` and `default-src 'none'; sandbox`
 * headers do not survive that hop. `image/svg+xml` is the type that matters — an
 * SVG is a document that can carry script — and while core's sniffer never emits
 * it today, a cache that accepts any `image/` would turn a future format (or a
 * hand-edited index) into a document this app hands the renderer unguarded.
 */
export const ARTIFACT_ALLOWED_MIMES: ReadonlySet<string> = new Set([
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"image/vnd.microsoft.icon",
]);

const INDEX_FILE = "index.json";
const INDEX_VERSION = 2;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

/** One cached blob's metadata. Exactly these five fields — see the header. */
export interface ArtifactIndexEntry {
	mime: string;
	size: number;
	storedAt: number;
	lastUsedAt: number;
	/** `artifactOwnerFingerprint(expectedAccountId)` of the receipt that stored
	 * this blob. Compared on every read; see the header for why the id alone is
	 * not a gate. */
	account: string;
}

export interface CachedArtifactBytes {
	mime: string;
	bytes: Uint8Array;
}

export interface ArtifactCacheStats {
	entries: number;
	residentBytes: number;
	evictions: number;
	/** Reads answered from disk, reads that missed, and reads refused because the
	 * entry belongs to another receipt. Neither is ever drawn — they exist so a
	 * test and an operator can see the cache move. */
	hits: number;
	misses: number;
	foreignHits: number;
}

export interface LinkPreviewArtifactCacheOptions {
	/** `path.join(app.getPath("userData"), "cache", "link-previews")` in the app;
	 * a temp directory in tests, which is why this module imports no Electron. */
	dir: string;
	now?: () => number;
	ttlMs?: number;
	maxBytes?: number;
	maxArtifacts?: number;
	sweepIntervalMs?: number;
}

interface IndexDocument {
	version: number;
	entries: Record<string, ArtifactIndexEntry>;
}

/**
 * The opaque account binding stored beside a cached blob.
 *
 * A fingerprint rather than the id: the index is a plain file on disk, and the
 * account id is an identity this cache has no use for in the clear. Truncated to
 * 32 hex chars like every other handle here — it is a comparison value, not a
 * fingerprint of anything a reader could usefully reverse.
 */
export function artifactOwnerFingerprint(accountId: string): string {
	return createHash("sha256")
		.update(`link-preview-account\u0000${accountId}`)
		.digest("hex")
		.slice(0, 32);
}

/**
 * A bounded, LRU, TTL'd cache of artifact bytes on disk, bound to the account that
 * stored them.
 *
 * Every method resolves rather than throws on an I/O refusal it can absorb: the
 * card that asked for an image must render as "no image", never as an unhandled
 * IPC rejection, and a full disk is not a reason for a transcript to break. A
 * caller that genuinely cannot proceed (no directory it may create) learns it from
 * `open()` once, at startup, and the service then treats the cache as absent.
 */
export class LinkPreviewArtifactCache {
	private readonly dir: string;
	private readonly now: () => number;
	private readonly ttlMs: number;
	private readonly maxBytes: number;
	private readonly maxArtifacts: number;
	private readonly sweepIntervalMs: number;
	private entries = new Map<string, ArtifactIndexEntry>();
	private residentBytes = 0;
	private evictions = 0;
	private hits = 0;
	private misses = 0;
	private foreignHits = 0;
	private lastSweep = Number.NEGATIVE_INFINITY;
	private opened = false;
	/** Serializes every mutating pass, so two concurrent writers cannot interleave
	 * a sweep with a store and leave the index accounting for a file that is gone.
	 * `read` is deliberately NOT queued (it is the hot path); it only mutates
	 * through `forgetEntry`, which is atomic within one synchronous step. */
	private queue: Promise<unknown> = Promise.resolve();

	constructor(options: LinkPreviewArtifactCacheOptions) {
		this.dir = options.dir;
		this.now = options.now ?? (() => Date.now());
		this.ttlMs = options.ttlMs ?? ARTIFACT_TTL_MS;
		this.maxBytes = options.maxBytes ?? ARTIFACT_MAX_BYTES;
		this.maxArtifacts = options.maxArtifacts ?? ARTIFACT_MAX_COUNT;
		this.sweepIntervalMs =
			options.sweepIntervalMs ?? ARTIFACT_SWEEP_INTERVAL_MS;
	}

	/** The directory this cache owns. Named so a test can assert a file's presence
	 * without re-deriving the path. */
	get directory(): string {
		return this.dir;
	}

	/**
	 * Create the directory, load the index, delete files no entry describes, and
	 * apply the bounds once.
	 *
	 * STARTUP IS THE ONE UNCONDITIONAL SWEEP. The interval below bounds how often a
	 * read or write may sweep, which would otherwise let a cold cache keep expired
	 * bytes for five minutes after launch; a process that starts with a full disk
	 * and a stale index should not wait for a card to be drawn before it recovers
	 * the space.
	 */
	async open(): Promise<void> {
		await mkdir(this.dir, { recursive: true, mode: DIRECTORY_MODE });
		// `mkdir`'s mode is subject to the umask, and an existing directory keeps
		// whatever it was created with, so it is set explicitly as well.
		await chmod(this.dir, DIRECTORY_MODE).catch(() => {});
		await this.loadIndex();
		await this.serialize(async () => {
			await this.removeOrphans();
			await this.sweepNow();
		});
		this.opened = true;
		this.lastSweep = this.now();
	}

	/** Every cached id currently indexed, oldest use first. Diagnostics and tests
	 * only: the bytes are addressed one id at a time. */
	ids(): string[] {
		return [...this.entries.entries()]
			.sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)
			.map(([id]) => id);
	}

	stats(): ArtifactCacheStats {
		return {
			entries: this.entries.size,
			residentBytes: this.residentBytes,
			evictions: this.evictions,
			hits: this.hits,
			misses: this.misses,
			foreignHits: this.foreignHits,
		};
	}

	/**
	 * The bytes for one id, for the receipt that asks, or `null`.
	 *
	 * An id that is not in the index is a miss without a filesystem call. An id
	 * whose entry belongs to a DIFFERENT receipt is also a miss — and deliberately
	 * not a deletion: the other account's entry is still the right answer for its
	 * own card, and this request must now go and ask core, which is the authority
	 * on whose scope names what.
	 *
	 * An entry that IS in the index but whose file has gone is a miss too, and the
	 * entry is dropped, so the next lookup does not pay for the same stat. An
	 * expired entry is a miss and is removed at the next sweep, so a read never
	 * depends on when a sweep last ran.
	 */
	async read(
		id: string,
		accountFingerprint: string,
	): Promise<CachedArtifactBytes | null> {
		if (!this.opened) return null;
		const entry = this.entries.get(id);
		if (entry === undefined) {
			this.misses += 1;
			return null;
		}
		if (entry.account !== accountFingerprint) {
			// A replayed id from another session. Not a hit, and not a delete: ask
			// core, which answers 404 for a scope that does not name the id.
			this.foreignHits += 1;
			return null;
		}
		if (!ARTIFACT_ALLOWED_MIMES.has(entry.mime)) {
			// A hand-edited index claiming `text/html` is not an artifact this app
			// serves: the same allowlist `store` applies on the way in, applied again
			// on the way out (review round 1, security nit 2).
			this.misses += 1;
			return null;
		}
		if (this.now() - entry.storedAt >= this.ttlMs) {
			this.misses += 1;
			return null;
		}
		let bytes: Uint8Array;
		try {
			bytes = new Uint8Array(await readFile(join(this.dir, id)));
		} catch {
			// The index outlived its file: a torn write, an interrupted sweep, or an
			// operator who cleared the directory by hand. Drop the claim rather than
			// answering with bytes that do not exist — and only if this call still
			// owns it, which `forgetEntry` decides (see the header).
			this.forgetEntry(id);
			this.misses += 1;
			return null;
		}
		entry.lastUsedAt = this.now();
		this.hits += 1;
		void this.maybeSweep();
		return { mime: entry.mime, bytes };
	}

	/**
	 * Keep one blob for one receipt, then re-apply the bounds if they are exceeded.
	 *
	 * A blob over `ARTIFACT_MAX_BLOB_BYTES` is refused before anything is written:
	 * storing it would evict several legitimate artifacts to hold something core
	 * would never have produced. So is a mime outside `ARTIFACT_ALLOWED_MIMES` and
	 * an id that is not one (see the header's note on `image/svg+xml` and on the
	 * file name being a path segment).
	 */
	async store(
		id: string,
		mime: string,
		bytes: Uint8Array,
		accountFingerprint: string,
	): Promise<void> {
		if (!this.opened) return;
		if (bytes.byteLength === 0 || bytes.byteLength > ARTIFACT_MAX_BLOB_BYTES)
			return;
		if (!ARTIFACT_ALLOWED_MIMES.has(mime)) return;
		// The class header calls the id a file name; a future caller that skipped
		// `service.ts`'s check must not be able to spell a path here.
		if (!LINK_PREVIEW_ARTIFACT_ID.test(id)) return;
		await this.serialize(async () => {
			const path = join(this.dir, id);
			const temp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
			try {
				await writeFile(temp, bytes, { mode: FILE_MODE });
				// Atomic, and the ONLY way a file enters the directory: a reader can
				// therefore never observe a half-written artifact under the real name.
				await rename(temp, path);
			} catch {
				await rm(temp, { force: true }).catch(() => {});
				return;
			}
			const at = this.now();
			this.rememberEntry(id, {
				mime,
				size: bytes.byteLength,
				storedAt: at,
				// A fresh blob is the newest thing here: its storedAt starts its TTL,
				// and its lastUsedAt is now, so it is the last thing an LRU pass takes.
				lastUsedAt: at,
				account: accountFingerprint,
			});
			await this.persistIndex();
			await this.sweepNow();
		});
	}

	/**
	 * Forget specific artifacts — the "disabled"/"absent" rule's only mechanism.
	 *
	 * Called with the ids a preview was holding, so the bytes cannot outlive the
	 * card that asked for them: a cached artifact must not survive
	 * `web_fetch.enabled: false` being turned on-after-off, and a preview that has
	 * since answered `absent` must not keep drawing its old picture.
	 *
	 * Never fails a caller: a blob that cannot be deleted is dropped from the index
	 * anyway, because an unindexed file is unreachable and the next startup's
	 * orphan pass removes it.
	 */
	async drop(ids: readonly string[]): Promise<void> {
		if (!this.opened || ids.length === 0) return;
		await this.serialize(async () => {
			let changed = false;
			for (const id of ids) {
				if (!this.forgetEntry(id)) continue;
				changed = true;
				try {
					await rm(join(this.dir, id), { force: true });
				} catch {
					// Indexed away already; the orphan pass collects it later.
				}
			}
			if (changed) await this.persistIndex();
		});
	}

	/**
	 * Drop EVERY cached blob — the principal-transition rule.
	 *
	 * A sign-out or account switch must not leave the previous account's images on
	 * disk for the remainder of their TTL. This is deliberately a full clear rather
	 * than a per-account drop: at the moment the fence fires this process no longer
	 * knows which receipts its entries belonged to, and keeping some of them is
	 * worth less than the guarantee that none of them are the departing account's.
	 */
	async clear(): Promise<void> {
		if (!this.opened) return;
		await this.serialize(async () => {
			const ids = [...this.entries.keys()];
			for (const id of ids) this.forgetEntry(id);
			await this.persistIndex();
			// Unlink AFTER the index is clean: an interrupted clear then leaves
			// orphans (which startup collects) rather than live entries with no files.
			for (const id of ids) {
				try {
					await rm(join(this.dir, id), { force: true });
				} catch {
					// The orphan pass on the next startup collects it.
				}
			}
		});
	}

	/** Apply the bounds now, whatever the interval says. */
	async sweep(): Promise<void> {
		if (!this.opened) return;
		await this.serialize(async () => {
			await this.sweepNow();
			this.lastSweep = this.now();
		});
	}

	/**
	 * Give up one entry and its bytes from the accounting.
	 *
	 * THE ONLY PLACE `residentBytes` MAY DECREASE, and it decreases exactly when
	 * this call actually removed the entry — `Map.delete` is the witness. The
	 * sibling bug this replaces read an entry, awaited a file read, then subtracted
	 * unconditionally, so two racing misses subtracted one entry twice and the byte
	 * ceiling stopped firing. No `await` may appear between the delete and the
	 * subtract.
	 */
	private forgetEntry(id: string): boolean {
		const entry = this.entries.get(id);
		if (entry === undefined) return false;
		this.entries.delete(id);
		this.residentBytes -= entry.size;
		return true;
	}

	/** The only place `residentBytes` may increase, paired with `forgetEntry`. */
	private rememberEntry(id: string, entry: ArtifactIndexEntry): void {
		this.forgetEntry(id);
		this.entries.set(id, entry);
		this.residentBytes += entry.size;
	}

	private async maybeSweep(): Promise<void> {
		if (this.now() - this.lastSweep < this.sweepIntervalMs) return;
		this.lastSweep = this.now();
		// An eviction pass that fails must not fail the read that triggered it: the
		// bytes are already in hand and the worst case is that the bounds stay tight
		// until the next pass.
		await this.serialize(() => this.sweepNow()).catch(() => {});
	}

	private async sweepNow(): Promise<void> {
		const at = this.now();
		let changed = false;
		for (const [id, entry] of [...this.entries]) {
			if (at - entry.storedAt < this.ttlMs) continue;
			if (this.forgetEntry(id)) {
				await this.unlink(id);
				changed = true;
			}
		}
		// LRU on last use, oldest first, until BOTH bounds hold. Ordering by use
		// rather than by store time is what makes a card that is on screen survive a
		// burst of new ones.
		while (
			this.entries.size > this.maxArtifacts ||
			this.residentBytes > this.maxBytes
		) {
			const oldest = this.ids()[0];
			if (oldest === undefined) break;
			if (!this.forgetEntry(oldest)) break;
			this.evictions += 1;
			await this.unlink(oldest);
			changed = true;
		}
		if (changed) await this.persistIndex();
	}

	private async unlink(id: string): Promise<void> {
		try {
			await rm(join(this.dir, id), { force: true });
		} catch {
			// The file stays but is unreachable; startup's orphan pass reclaims it.
		}
	}

	private async loadIndex(): Promise<void> {
		let raw: string;
		try {
			raw = await readFile(join(this.dir, INDEX_FILE), "utf8");
		} catch {
			return;
		}
		let document: unknown;
		try {
			document = JSON.parse(raw);
		} catch {
			// A corrupt index is not a reason to keep bytes nobody can address: start
			// empty, and `removeOrphans` deletes every file it does not describe.
			return;
		}
		if (
			typeof document !== "object" ||
			document === null ||
			(document as IndexDocument).version !== INDEX_VERSION ||
			typeof (document as IndexDocument).entries !== "object" ||
			(document as IndexDocument).entries === null
		)
			return;
		for (const [id, entry] of Object.entries(
			(document as IndexDocument).entries,
		)) {
			if (!isIndexEntry(entry)) continue;
			// An id is a file name here, so a hostile or corrupt index must not be able
			// to introduce a path (or a second spelling of an id) into this cache.
			if (!LINK_PREVIEW_ARTIFACT_ID.test(id)) continue;
			this.entries.set(id, { ...entry });
			this.residentBytes += entry.size;
		}
	}

	/**
	 * Write the index beside the blobs, atomically.
	 *
	 * A failure here is absorbed on purpose. The cost of an unpersisted index is one
	 * cold startup — every file becomes an orphan and is deleted, which loses cached
	 * bytes and nothing else — while throwing would turn "the disk is full" into an
	 * IPC rejection on a card that drew fine a moment ago.
	 */
	private async persistIndex(): Promise<void> {
		const document: IndexDocument = {
			version: INDEX_VERSION,
			entries: Object.fromEntries(this.entries),
		};
		const path = join(this.dir, INDEX_FILE);
		const temp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
		try {
			await writeFile(temp, JSON.stringify(document), { mode: FILE_MODE });
			await rename(temp, path);
		} catch {
			await rm(temp, { force: true }).catch(() => {});
		}
	}

	/** Delete every file this index does not describe, so an interrupted `store`
	 * cannot leak storage past the bounds. `index.json` and in-flight temps are
	 * never touched. */
	private async removeOrphans(): Promise<void> {
		let names: string[];
		try {
			names = await readdir(this.dir);
		} catch {
			return;
		}
		for (const name of names) {
			if (name === INDEX_FILE) continue;
			if (this.entries.has(name)) continue;
			// Anything else — a temp from an interrupted write, a file whose index
			// entry was lost, a hand-copied stray — is not reachable by any caller.
			try {
				await rm(join(this.dir, name), { recursive: true, force: true });
			} catch {
				// Leave it; the next startup tries again.
			}
		}
	}

	private serialize<T>(work: () => Promise<T>): Promise<T> {
		const next = this.queue.then(work, work);
		// The chain itself must never carry a rejection forward: every caller above
		// absorbs its own failures, and a rejected link here would poison the queue
		// for the life of the process.
		this.queue = next.catch(() => {});
		return next;
	}
}

/**
 * A stable, opaque key for "the preview this card was resolved from", used ONLY to
 * remember which artifact ids to forget.
 *
 * WHY A HASH AND NOT THE URL, AND WHY THE ACCOUNT IS IN IT. The only thing this key
 * decides is which cached ids a later `absent`/`disabled` answer drops. Hashing
 * means the value cannot become a log line, a file name or a browsing record — and
 * it is never persisted at all (see `service.ts`), so nothing survives the process.
 * The account is part of the key because one account's refusal must not drop
 * another's ids for the same link: without it, any second account resolving the
 * same URL could empty the first one's cache entries (review round 1, finding 4).
 * A second use of this key — as a cache key for bytes or for metadata — would be
 * the second id scheme this cache exists to prevent, so it is deliberately not
 * exported beyond this purpose.
 */
export function previewKeyFor(accountFingerprint: string, url: string): string {
	return createHash("sha256")
		.update(`link-preview\u0000${accountFingerprint}\u0000${url}`)
		.digest("hex");
}

function isIndexEntry(value: unknown): value is ArtifactIndexEntry {
	if (typeof value !== "object" || value === null) return false;
	const entry = value as Partial<ArtifactIndexEntry>;
	return (
		typeof entry.mime === "string" &&
		entry.mime.length > 0 &&
		entry.mime.length <= 128 &&
		typeof entry.size === "number" &&
		Number.isInteger(entry.size) &&
		entry.size >= 0 &&
		typeof entry.storedAt === "number" &&
		Number.isFinite(entry.storedAt) &&
		typeof entry.lastUsedAt === "number" &&
		Number.isFinite(entry.lastUsedAt) &&
		typeof entry.account === "string" &&
		entry.account.length === 32
	);
}
