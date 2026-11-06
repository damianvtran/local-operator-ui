/**
 * The on-disk cache for Team Bridge message images: the bytes behind a
 * `team_bridge.attachment` receipt, bounded, and addressed by a hash of the
 * receipt itself.
 *
 * WHAT THIS CACHE IS FOR, AND WHAT IT DELIBERATELY IS NOT. Entering a channel
 * re-fetched every visible image, and nothing survived a restart: the renderer's
 * blob cache (`src/renderer/src/shared/lib/blob-url-cache.ts`) is scoped to a
 * mounted surface and, by rule 3 there, "nothing is parked" — an object URL is
 * released as soon as its consumers are gone. This cache does NOT change that. It
 * removes the NETWORK cost of re-entering a channel, not the IPC cost of
 * re-reading the bytes: main still hands the renderer the same bytes over the
 * same channel, and the renderer still builds a fresh blob URL each time. A
 * parked-blob layer is a separate decision that must fight the refcount
 * discipline for a benefit the measurement has not justified yet, so it is
 * explicitly out of scope here rather than accidentally omitted.
 *
 * ONE TRANSPORT, ONE ROUTE. This is not a second way to fetch an image. The
 * request that misses here goes out with the same bearer, to the same hub route,
 * through the same relay (`desktop-media.ts`, op `team_bridge.attachment`); the
 * cache only sits in front of that call. There is no new IPC op and no renderer
 * contract change, which is why nothing in the renderer knows this file exists.
 *
 * THE KEY IS A HASH OF THE RECEIPT, NEVER THE IDS. `teamBridgeImageKey` hashes
 * (account fingerprint, tenant, conversation, message, attachment) into one
 * 64-hex file name, so the directory on disk names no tenant, no conversation,
 * no message and no account — a directory listing is not a per-conversation
 * record of what this operator looked at. The stored `account` is a fingerprint
 * for the same reason.
 *
 * A HIT IS ONLY A HIT FOR THE SAME RECEIPT. The fingerprint in the key already
 * separates two accounts' entries; the index carries it a second time so a
 * replayed or hand-edited key cannot be answered under a receipt that did not
 * produce it. A mismatch is a MISS, and deliberately not a deletion: the other
 * account's entry is still the right answer for its own receipt, and this
 * request must now ask the hub, which is the authority on whose scope owns what.
 * This is the rule `link-preview/artifact-cache.ts` states at length; the shape
 * here is the same one on purpose rather than a second idiom.
 *
 * AND THE DIRECTORY IS DROPPED ON A PRINCIPAL TRANSITION. A fingerprint closes
 * the replay hole; it does not stop a seven-day copy of the previous account's
 * images sitting on disk after a sign-out. `clear()` exists for that and is wired
 * to the same principal fence the link-preview cache listens to; nothing here
 * decides WHEN it fires (see `index.ts`).
 *
 * FILE MODES ARE THE REPO'S PRIVATE-BYTES RULE: directory `0o700`, files `0o600`
 * (`link-preview/artifact-cache.ts`, `team-bridge-notify-store.ts`). A cached
 * member-gated image is not a public artifact of this app.
 *
 * WHAT THIS CACHE DOES NOT HOLD. No URL, no title, no caption, no sender, no
 * account id, no count of messages and no plaintext of any id. The index carries
 * `{mime, size, storedAt, lastUsedAt, account}` — the minimum to enforce the
 * bounds without stat-ing every file, to answer a read without a sniff, and to
 * answer only the receipt that produced it. Hit/miss counters are numbers and
 * stay in this process; `stats()` is for tests and diagnostics, never a wire.
 *
 * A STALE INDEX NEVER RESURRECTS BYTES. `read` requires BOTH an index entry and a
 * file that loads; a missing file drops the entry and reports a miss. The index
 * is versioned, so an index this build does not understand is discarded wholesale
 * (`removeOrphans` then reclaims the files) rather than trusted field by field.
 *
 * ONE OWNER FOR THE BYTE TOTAL. `forgetEntry`/`rememberEntry` each mutate the map
 * and the total in one synchronous step — no `await` between them — so two racing
 * misses on a missing file cannot drive `residentBytes` negative and silently
 * disable the byte bound.
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

/** 7 days. The bytes are immutable: an attachment id names one upload, and the
 * hub never rewrites it. The TTL is therefore a disk-housekeeping bound, not a
 * freshness one — it says how long an image the operator has stopped looking at
 * may keep its space, not how long the picture stays true. */
export const TEAM_BRIDGE_IMAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Resident-byte ceiling for the whole directory. Sized against the product: a
 * channel's visible images are a handful of ~200 KB screenshots, so this holds
 * several hundred messages' worth before the oldest is dropped. */
export const TEAM_BRIDGE_IMAGE_MAX_BYTES = 128 * 1024 * 1024;

/** File-count ceiling. A byte bound alone would let a million tiny images through,
 * and each file costs an inode and a directory entry regardless of size. */
export const TEAM_BRIDGE_IMAGE_MAX_COUNT = 500;

/** How often the bounds are re-applied on the access path. Startup always sweeps;
 * between sweeps this is the most often a read or write may trigger one, so
 * scrolling a channel does not turn into a directory scan per image. */
export const TEAM_BRIDGE_IMAGE_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * The largest single blob this cache will keep, and it is the RELAY'S OWN ceiling
 * rather than a product choice: `desktop-media.ts` refuses a `team_bridge.attachment`
 * body above 5 MiB before it will hand it to anyone, so a body this cache refused
 * while the relay accepted it would be a payload the operator sees once and never
 * again. Kept equal on purpose; if one moves, both move.
 */
export const TEAM_BRIDGE_IMAGE_MAX_BLOB_BYTES = 5 * 1024 * 1024;

/**
 * The media types this cache will hold: exactly the set the relay accepts for this
 * op.
 *
 * WHY AN ALLOWLIST AND NOT `image/*`. A cached blob crosses IPC as bare bytes and
 * lands in a renderer `<img>`; core's `nosniff` and `default-src 'none'` headers do
 * not survive that hop. `image/svg+xml` is the type that matters — an SVG is a
 * document that can carry script — and while the hub never produces one, a cache
 * that accepted any `image/` would turn a hand-edited index into a document this
 * app hands the renderer unguarded.
 */
export const TEAM_BRIDGE_IMAGE_ALLOWED_MIMES: ReadonlySet<string> = new Set([
	"image/png",
	"image/jpeg",
]);

/** A cache key is a lower-case sha256 and nothing else. Enforced on the way in AND
 * when the index is read: the key is a file name here, so a key that could spell a
 * path, a traversal or a second spelling of an existing entry never gets a file. */
export const TEAM_BRIDGE_IMAGE_KEY = /^[0-9a-f]{64}$/;

const INDEX_FILE = "index.json";
/** Bumped when the entry shape or the binding rule changes. An index from another
 * version is DISCARDED, not migrated: the files it names become orphans and are
 * reclaimed, which loses cached bytes and nothing else. */
const INDEX_VERSION = 1;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

/** The fields a read needs, and nothing that names an identity or a conversation. */
export interface TeamBridgeImageIndexEntry {
	mime: string;
	size: number;
	storedAt: number;
	lastUsedAt: number;
	/** `teamBridgeImageAccountFingerprint(expectedAccountId)` of the receipt that
	 * stored these bytes. Compared on every read; see the header for why the key
	 * alone is not the gate. */
	account: string;
}

export interface CachedTeamBridgeImage {
	mime: string;
	bytes: Uint8Array;
}

export interface TeamBridgeImageCacheStats {
	entries: number;
	residentBytes: number;
	evictions: number;
	/** Reads answered from disk, reads that missed, and reads refused because the
	 * entry belongs to another receipt. Numbers only — never ids, never bytes. */
	hits: number;
	misses: number;
	foreignHits: number;
}

export interface TeamBridgeImageCacheOptions {
	/** `path.join(app.getPath("userData"), "cache", "team-bridge-images")` in the
	 * app; a temp directory in tests, which is why this module imports no Electron. */
	dir: string;
	now?: () => number;
	ttlMs?: number;
	maxBytes?: number;
	maxCount?: number;
	sweepIntervalMs?: number;
}

/** The five ids a `team_bridge.attachment` receipt is made of, plus nothing else. */
export interface TeamBridgeImageReceipt {
	expectedAccountId: string;
	tenantId: string;
	conversationId: string;
	messageId: string;
	attachmentId: string;
}

interface IndexDocument {
	version: number;
	entries: Record<string, TeamBridgeImageIndexEntry>;
}

/**
 * The opaque account binding stored beside a cached image.
 *
 * A fingerprint rather than the id: the index is a plain file on disk, and the
 * account id is an identity this cache has no use for in the clear. Truncated to
 * 32 hex chars like every other handle here — it is a comparison value, not a
 * digest a reader could usefully reverse.
 */
export function teamBridgeImageAccountFingerprint(accountId: string): string {
	return createHash("sha256")
		.update(`team-bridge-image-account\u0000${accountId}`)
		.digest("hex")
		.slice(0, 32);
}

/**
 * The cache key for one attachment receipt: a full sha256 of the tuple.
 *
 * WHY THE ACCOUNT IS IN THE KEY rather than only in the index. Two accounts can
 * see the same conversation and the same message, and the hub decides which of
 * them may see which attachment; a key that ignored the account would make the
 * index the only gate. Including it means the two receipts address two files, so
 * a foreign entry is never even a candidate — and the index check stays as the
 * second, cheaper-to-reason-about guard against a replayed key.
 */
export function teamBridgeImageKey(receipt: TeamBridgeImageReceipt): string {
	const account = teamBridgeImageAccountFingerprint(receipt.expectedAccountId);
	return createHash("sha256")
		.update(
			`team-bridge-image\u0000${account}\u0000${receipt.tenantId}\u0000${receipt.conversationId}\u0000${receipt.messageId}\u0000${receipt.attachmentId}`,
		)
		.digest("hex");
}

/**
 * A bounded, LRU, TTL'd cache of Team Bridge message images on disk, bound to the
 * account that stored them.
 *
 * Every method resolves rather than throws on an I/O refusal it can absorb: an
 * image that cannot be cached must still draw, and a full disk is not a reason for
 * a channel to break. A caller that genuinely cannot proceed (no directory it may
 * create) learns it from `open()` once, at startup, and `index.ts` then treats the
 * cache as absent.
 */
export class TeamBridgeImageCache {
	private readonly dir: string;
	private readonly now: () => number;
	private readonly ttlMs: number;
	private readonly maxBytes: number;
	private readonly maxCount: number;
	private readonly sweepIntervalMs: number;
	private entries = new Map<string, TeamBridgeImageIndexEntry>();
	private residentBytes = 0;
	private evictions = 0;
	private hits = 0;
	private misses = 0;
	private foreignHits = 0;
	private lastSweep = Number.NEGATIVE_INFINITY;
	private opened = false;
	/** Serializes every mutating pass, so two concurrent writers cannot interleave a
	 * sweep with a store and leave the index accounting for a file that is gone.
	 * `read` is deliberately NOT queued (it is the hot path); it only mutates through
	 * `forgetEntry`, which is atomic within one synchronous step. */
	private queue: Promise<unknown> = Promise.resolve();

	constructor(options: TeamBridgeImageCacheOptions) {
		this.dir = options.dir;
		this.now = options.now ?? (() => Date.now());
		this.ttlMs = options.ttlMs ?? TEAM_BRIDGE_IMAGE_TTL_MS;
		this.maxBytes = options.maxBytes ?? TEAM_BRIDGE_IMAGE_MAX_BYTES;
		this.maxCount = options.maxCount ?? TEAM_BRIDGE_IMAGE_MAX_COUNT;
		this.sweepIntervalMs =
			options.sweepIntervalMs ?? TEAM_BRIDGE_IMAGE_SWEEP_INTERVAL_MS;
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
	 * STARTUP IS THE ONE UNCONDITIONAL SWEEP: the interval below bounds how often a
	 * read or write may sweep, which would otherwise let a cold cache keep expired
	 * bytes for five minutes after launch and a process that starts with a full disk
	 * start fetching images it cannot store.
	 */
	async open(): Promise<void> {
		await mkdir(this.dir, { recursive: true, mode: DIRECTORY_MODE });
		// `mkdir`'s mode is masked by the umask and is ignored outright when the
		// directory already exists, so it is set explicitly as well.
		await chmod(this.dir, DIRECTORY_MODE).catch(() => {});
		await this.loadIndex();
		await this.serialize(async () => {
			await this.removeOrphans();
			await this.sweepNow();
		});
		this.opened = true;
		this.lastSweep = this.now();
	}

	/** Every cached key currently indexed, oldest use first. Diagnostics and tests
	 * only: the bytes are addressed one key at a time. */
	ids(): string[] {
		return [...this.entries.entries()]
			.sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)
			.map(([key]) => key);
	}

	/** Numbers only, and never on the wire. */
	stats(): TeamBridgeImageCacheStats {
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
	 * The bytes for one key, for the receipt that asks, or `null`.
	 *
	 * A key that is not in the index is a miss without a filesystem call. A key
	 * whose entry belongs to a DIFFERENT receipt is also a miss — and deliberately
	 * not a deletion, for the reason the header gives. An entry that IS in the index
	 * but whose file has gone is a miss too, and the entry is dropped, so the next
	 * lookup does not pay for the same stat. An expired entry is a miss and is
	 * removed at the next sweep, so a read never depends on when a sweep last ran.
	 */
	async read(
		key: string,
		accountFingerprint: string,
	): Promise<CachedTeamBridgeImage | null> {
		if (!this.opened || !TEAM_BRIDGE_IMAGE_KEY.test(key)) return null;
		const entry = this.entries.get(key);
		if (entry === undefined) {
			this.misses += 1;
			return null;
		}
		if (entry.account !== accountFingerprint) {
			// A replayed or hand-edited key from another session. Not a hit, and not a
			// delete: ask the hub, which answers 404 for a scope that does not name it.
			this.foreignHits += 1;
			return null;
		}
		if (!TEAM_BRIDGE_IMAGE_ALLOWED_MIMES.has(entry.mime)) {
			// The same allowlist `store` applies on the way in, applied again on the way
			// out: a hand-edited index claiming `image/svg+xml` is not an image this app
			// serves.
			this.misses += 1;
			return null;
		}
		if (this.now() - entry.storedAt >= this.ttlMs) {
			this.misses += 1;
			return null;
		}
		let bytes: Uint8Array;
		try {
			bytes = new Uint8Array(await readFile(join(this.dir, key)));
		} catch {
			// The index outlived its file: a torn write, an interrupted sweep, or an
			// operator who cleared the directory by hand. Drop the claim rather than
			// answering with bytes that do not exist.
			this.forgetEntry(key);
			this.misses += 1;
			return null;
		}
		// A file that is not the size the index recorded is a partial write that got
		// renamed into place: serve nothing, and let the entry go so the next read
		// fetches a whole image.
		if (bytes.byteLength !== entry.size) {
			this.forgetEntry(key);
			this.misses += 1;
			return null;
		}
		entry.lastUsedAt = this.now();
		this.hits += 1;
		void this.maybeSweep();
		return { mime: entry.mime, bytes };
	}

	/**
	 * Keep one image for one receipt, then re-apply the bounds if they are exceeded.
	 *
	 * A blob over {@link TEAM_BRIDGE_IMAGE_MAX_BLOB_BYTES} is refused before anything
	 * is written, and so is a mime outside {@link TEAM_BRIDGE_IMAGE_ALLOWED_MIMES} and
	 * a key that is not one (see the header on `image/svg+xml` and on the file name
	 * being a path segment). Nothing here can fail a caller: an image that cannot be
	 * stored still draws.
	 */
	async store(
		key: string,
		mime: string,
		bytes: Uint8Array,
		accountFingerprint: string,
	): Promise<void> {
		if (!this.opened) return;
		if (
			bytes.byteLength === 0 ||
			bytes.byteLength > TEAM_BRIDGE_IMAGE_MAX_BLOB_BYTES
		)
			return;
		if (!TEAM_BRIDGE_IMAGE_ALLOWED_MIMES.has(mime)) return;
		if (!TEAM_BRIDGE_IMAGE_KEY.test(key)) return;
		await this.serialize(async () => {
			const path = join(this.dir, key);
			const temp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
			try {
				await writeFile(temp, bytes, { mode: FILE_MODE });
				// Atomic, and the ONLY way a file enters the directory: a reader can
				// therefore never observe a half-written image under the real name.
				await rename(temp, path);
			} catch {
				await rm(temp, { force: true }).catch(() => {});
				return;
			}
			const at = this.now();
			this.rememberEntry(key, {
				mime,
				size: bytes.byteLength,
				storedAt: at,
				// A fresh blob is the newest thing here: its storedAt starts its TTL, and
				// its lastUsedAt is now, so it is the last thing an LRU pass takes.
				lastUsedAt: at,
				account: accountFingerprint,
			});
			await this.persistIndex();
			await this.sweepNow();
		});
	}

	/**
	 * Drop EVERY cached image — the principal-transition rule.
	 *
	 * A sign-out or account switch must not leave the previous account's images on
	 * disk for the remainder of a seven-day TTL. Deliberately a full clear rather
	 * than a per-account drop: at the moment the fence fires this process no longer
	 * knows which receipts its entries belonged to, and keeping some of them is worth
	 * less than the guarantee that none of them are the departing account's.
	 */
	async clear(): Promise<void> {
		if (!this.opened) return;
		await this.serialize(async () => {
			const keys = [...this.entries.keys()];
			for (const key of keys) this.forgetEntry(key);
			await this.persistIndex();
			// Unlink AFTER the index is clean: an interrupted clear then leaves orphans
			// (which startup collects) rather than live entries with no files.
			for (const key of keys) await this.unlink(key);
		});
	}

	/**
	 * Remove one entry from the index and from the byte total — the single place
	 * either may shrink, and it only does so when this call actually removed the
	 * entry (`Map.delete` is the witness). No `await` may appear between the delete
	 * and the subtract.
	 */
	private forgetEntry(key: string): boolean {
		const entry = this.entries.get(key);
		if (entry === undefined) return false;
		this.entries.delete(key);
		this.residentBytes -= entry.size;
		return true;
	}

	/** The only place `residentBytes` may grow, paired with `forgetEntry`. */
	private rememberEntry(key: string, entry: TeamBridgeImageIndexEntry): void {
		this.forgetEntry(key);
		this.entries.set(key, entry);
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
		for (const [key, entry] of [...this.entries]) {
			if (at - entry.storedAt < this.ttlMs) continue;
			if (this.forgetEntry(key)) {
				await this.unlink(key);
				changed = true;
			}
		}
		// LRU on last use, oldest first, until BOTH bounds hold. Ordering by use
		// rather than by store time is what makes an image that is on screen survive a
		// burst of new ones.
		while (
			this.entries.size > this.maxCount ||
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

	private async unlink(key: string): Promise<void> {
		try {
			await rm(join(this.dir, key), { force: true });
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
		for (const [key, entry] of Object.entries(
			(document as IndexDocument).entries,
		)) {
			if (!isIndexEntry(entry)) continue;
			// A key is a file name here, so a hostile or corrupt index must not be able
			// to introduce a path (or a second spelling of a key) into this cache.
			if (!TEAM_BRIDGE_IMAGE_KEY.test(key)) continue;
			this.entries.set(key, { ...entry });
			this.residentBytes += entry.size;
		}
	}

	/**
	 * Write the index beside the images, atomically.
	 *
	 * A failure here is absorbed on purpose. The cost of an unpersisted index is one
	 * cold startup — every file becomes an orphan and is deleted, which loses cached
	 * bytes and nothing else — while throwing would turn "the disk is full" into an
	 * IPC rejection on an image that drew fine a moment ago.
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
	 * cannot leak storage past the bounds. `index.json` and in-flight temps are never
	 * touched. */
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
			// Anything else — a temp from an interrupted write, a file whose index entry
			// was lost, a hand-copied stray — is not reachable by any caller.
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
		// absorbs its own failures, and a rejected link here would poison the queue for
		// the life of the process.
		this.queue = next.catch(() => {});
		return next;
	}
}

function isIndexEntry(value: unknown): value is TeamBridgeImageIndexEntry {
	if (typeof value !== "object" || value === null) return false;
	const entry = value as Partial<TeamBridgeImageIndexEntry>;
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
