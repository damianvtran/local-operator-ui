/**
 * The on-disk preview cache: artifacts on disk, one bounded index in memory.
 *
 * WHY IT IS ACCOUNT-AGNOSTIC AND KEYED BY URL. Everything it stores is a public
 * web artifact - a page's title, its OpenGraph image, a favicon - so the cache has
 * no reason to know who asked. Keying by normalised URL rather than by
 * account/tenant/message means the same article previewed in two accounts, or two
 * messages, or two windows, costs one fetch and one copy of the bytes; and it
 * means nothing in here becomes a record of which account read which link. The
 * corollary is that NOTHING account-scoped may ever be cached here: a private
 * page, a signed-in view, an attachment. It only ever fetches what an anonymous
 * visitor would see, which is also why the fetcher sends no cookies.
 *
 * WHAT IS DELIBERATELY IN MEMORY ONLY. The metadata index. It maps a normalised URL
 * to a resolved preview, is bounded to `MAX_ENTRIES`, and starts empty on every
 * launch: persisting it would write the set of links this user had looked at to
 * disk as plain text, a browsing record this feature has no business creating. The
 * ARTIFACTS are persisted, because their whole purpose is to avoid re-fetching a
 * picture, and they are named by the opaque `previewId` (a sha256 prefix), so a
 * directory listing reveals no URL. The name also carries the artifact's KIND
 * (`favicon-<id>.png`, `image-<id>.jpg`): the kind is part of what an `image`
 * request asks for, and after a restart the directory is the only record left,
 * so a kind that lived only in the memory index could not be checked at all.
 *
 * TTLs ARE PER ANSWER, not per cache. A ready card is good for six hours and a
 * refusal (dead host, no metadata, not HTML) for thirty minutes. A RETRYABLE
 * error gets sixty seconds: the contract tells the card that a retry can change
 * it, so pinning that answer for the half hour a dead host gets would make the
 * retry the contract advertises impossible to honour.
 *
 * BOUNDS. 256 entries, 32 MB, 400 artifacts, LRU by last use. An entry is the
 * eviction unit - its artifacts leave with it - and the artifact count is a second
 * bound because 400 tiny favicons are a different problem from 400 preview images:
 * byte accounting alone would let a million 20-byte files through.
 */

import { createHash } from "node:crypto";
import {
	mkdir,
	readFile,
	readdir,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type {
	LinkPreviewArtifactKind,
	LinkPreviewResolveResult,
} from "../../shared/link-preview";
import { extensionForKind, mimeForKind } from "./sniff";

export const MAX_ENTRIES = 256;
export const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
export const MAX_ARTIFACTS = 400;
/** A page's title does not change in an afternoon. */
export const POSITIVE_TTL_MS = 6 * 60 * 60 * 1000;
/** A dead host must not be re-asked on every scroll. */
export const NEGATIVE_TTL_MS = 30 * 60 * 1000;
/** An answer a retry CAN change: long enough that a scrolling transcript does not
 * re-fetch a flapping network per card, short enough that the retry the contract
 * advertises actually reaches the network. */
export const RETRYABLE_TTL_MS = 60 * 1000;
/** How often the bounds are re-applied on the access path; startup always sweeps. */
export const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** Every extension this cache can hold, mapped to the mime it means. The extension
 * is a function of the SNIFFED kind, so a file's name states what its bytes are,
 * never what a server claimed. */
const EXTENSION_MIME = new Map<string, string>([
	[extensionForKind("png"), mimeForKind("png")],
	[extensionForKind("jpeg"), mimeForKind("jpeg")],
	[extensionForKind("gif"), mimeForKind("gif")],
	[extensionForKind("webp"), mimeForKind("webp")],
	[extensionForKind("ico"), mimeForKind("ico")],
]);

const MIME_EXTENSION = new Map<string, string>(
	[...EXTENSION_MIME].map(([extension, mime]) => [mime, extension]),
);

/**
 * The opaque identifier an artifact is addressed by: 32 hex characters of sha256
 * over (kind, normalised URL).
 *
 * Derived rather than random so two resolves of the same page produce the same id
 * - which is what lets a renderer memoise an `<img>` src - and truncated to 32
 * characters so it is a handle rather than a fingerprint of the URL behind it.
 * Nothing may log the URL it was built from; this id is the only identifier that
 * crosses a log line or names a file.
 */
export function previewIdFor(kind: "favicon" | "image", key: string): string {
	return createHash("sha256")
		.update(`${kind}\u0000${key}`)
		.digest("hex")
		.slice(0, 32);
}

/** Bytes the fetcher has already sniffed, handed over for storage. */
export interface PendingArtifact {
	id: string;
	/** Which artifact of the card this is. Carried so `read` can refuse an id
	 * served under the other kind, and so the file name says it after a restart. */
	kind: LinkPreviewArtifactKind;
	mime: string;
	bytes: Uint8Array;
}

export interface CachedArtifact {
	mime: string;
	bytes: Uint8Array;
}

interface ArtifactRecord {
	id: string;
	kind: LinkPreviewArtifactKind;
	mime: string;
	file: string;
	bytes: number;
}

interface Entry {
	result: LinkPreviewResolveResult;
	artifacts: ArtifactRecord[];
	expiresAt: number;
	lastUsed: number;
}

export interface LinkPreviewCache {
	/** A fresh positive or negative answer, or `undefined` on a miss. */
	lookup(key: string): { result: LinkPreviewResolveResult } | undefined;
	/** Persist an answer's artifacts, then index it. Returns the answer with any
	 * artifact whose file failed to land pruned out of it. */
	store(
		key: string,
		result: LinkPreviewResolveResult,
		pending: readonly PendingArtifact[],
	): Promise<LinkPreviewResolveResult>;
	/** The bytes of one artifact OF THE KIND ASKED FOR, or `null`: an id that names
	 * the other kind is not an artifact this request can be answered with. */
	read(
		id: string,
		which: LinkPreviewArtifactKind,
	): Promise<CachedArtifact | null>;
	sweep(): Promise<void>;
	stats(): { entries: number; artifacts: number; bytes: number };
}

function ttlFor(result: LinkPreviewResolveResult): number {
	if (result.kind === "ready") return POSITIVE_TTL_MS;
	if (result.kind === "error" && result.retryable) return RETRYABLE_TTL_MS;
	return NEGATIVE_TTL_MS;
}

/** A card's artifact id must be 32 lowercase hex characters; anything else is not
 * one of ours and never names a file. */
const ARTIFACT_ID = /^[0-9a-f]{32}$/;

/** An artifact file's name: the KIND, the opaque id, and the extension the sniff
 * chose. Parsed back on adoption, where the memory index no longer exists. */
const ARTIFACT_FILE = /^(favicon|image)-([0-9a-f]{32})\.([a-z0-9]+)$/;

/**
 * The bounds, in the form the cache applies them. Injectable so a test can prove
 * the LRU and byte accounting at a size a test can afford, WITHOUT changing what
 * the shipped defaults are: production always gets the defaults below, and the
 * numbers the product documents (256 / 32 MB / 400) are those constants.
 */
export interface LinkPreviewCacheBounds {
	maxEntries: number;
	maxTotalBytes: number;
	maxArtifacts: number;
}

export const DEFAULT_BOUNDS: LinkPreviewCacheBounds = {
	maxEntries: MAX_ENTRIES,
	maxTotalBytes: MAX_TOTAL_BYTES,
	maxArtifacts: MAX_ARTIFACTS,
};

export function createLinkPreviewCache(options: {
	directory: string;
	now?: () => number;
	bounds?: Partial<LinkPreviewCacheBounds>;
}): LinkPreviewCache {
	const directory = options.directory;
	const now = options.now ?? (() => Date.now());
	const bounds: LinkPreviewCacheBounds = {
		...DEFAULT_BOUNDS,
		...options.bounds,
	};
	const entries = new Map<string, Entry>();
	const artifacts = new Map<string, ArtifactRecord>();
	let lastSweep = 0;

	function totalBytes(): number {
		let total = 0;
		for (const record of artifacts.values()) total += record.bytes;
		return total;
	}

	async function dropArtifact(record: ArtifactRecord): Promise<void> {
		artifacts.delete(record.id);
		try {
			await unlink(join(directory, record.file));
		} catch {
			// Already gone: the accounting is the only thing that mattered.
		}
	}

	async function dropEntry(key: string, expected?: Entry): Promise<void> {
		const entry = entries.get(key);
		if (entry === undefined) return;
		// `evict` and `sweep` decide from a snapshot and then await; a re-store of the
		// same key landing in that window would replace the entry, and this call must
		// not destroy the FRESH one (and its freshly written file) on the old one's
		// behalf. Callers that mean "whatever is there" pass no expectation.
		if (expected !== undefined && entry !== expected) return;
		entries.delete(key);
		for (const record of entry.artifacts) {
			// An artifact another entry also references is the same bytes (ids derive
			// from kind+URL), so only an unreferenced file is removed.
			const shared = [...entries.values()].some((candidate) =>
				candidate.artifacts.some((owned) => owned.id === record.id),
			);
			if (!shared) await dropArtifact(record);
		}
	}

	/** Evict oldest-first until the entry, byte and artifact bounds hold. Once no
	 * entry is left, stray artifacts (on disk from a previous process) are dropped
	 * largest-first, so the byte bound still holds with an empty index. */
	async function evict(): Promise<void> {
		while (
			entries.size > bounds.maxEntries ||
			totalBytes() > bounds.maxTotalBytes ||
			artifacts.size > bounds.maxArtifacts
		) {
			const oldest = [...entries.entries()].sort(
				([, a], [, b]) => a.lastUsed - b.lastUsed,
			)[0];
			if (oldest !== undefined) {
				await dropEntry(oldest[0], oldest[1]);
				continue;
			}
			const stray = [...artifacts.values()].sort(
				(a, b) => b.bytes - a.bytes,
			)[0];
			if (stray === undefined) break;
			await dropArtifact(stray);
		}
	}

	/**
	 * Adopt the files a previous launch left behind.
	 *
	 * The metadata index is memory-only, so after a restart the directory is the
	 * only record of what an id refers to. Its files are named `<id>.<ext>`, and the
	 * extension was derived from the sniff, which is enough to answer an `image`
	 * request for a card rendered before this launch - and enough to charge every
	 * file against the bounds, so a crash cannot leave the cache unbounded.
	 */
	async function adoptExistingFiles(): Promise<void> {
		let names: string[];
		try {
			names = await readdir(directory);
		} catch {
			return;
		}
		for (const name of names) {
			const parsed = ARTIFACT_FILE.exec(name);
			if (parsed === null) continue;
			const [, kind, id, extension] = parsed;
			if (kind === undefined || id === undefined || extension === undefined) {
				continue;
			}
			const mime = EXTENSION_MIME.get(extension);
			if (mime === undefined || artifacts.has(id)) continue;
			try {
				const size = (await stat(join(directory, name))).size;
				artifacts.set(id, {
					id,
					kind: kind === "favicon" ? "favicon" : "image",
					mime,
					file: name,
					bytes: size,
				});
			} catch {
				// A file that vanished between the listing and the stat is not adopted.
			}
		}
	}

	async function store(
		key: string,
		result: LinkPreviewResolveResult,
		pending: readonly PendingArtifact[],
	): Promise<LinkPreviewResolveResult> {
		// A re-store REPLACES the entry, so the previous one's artifacts leave with
		// it. Dropping it before the writes is deliberate: an id is a function of the
		// kind and the key, so a re-store of the same key writes the same file names,
		// and dropping afterwards would unlink the bytes this call just wrote.
		await dropEntry(key);
		const written: ArtifactRecord[] = [];
		for (const artifact of pending) {
			if (!ARTIFACT_ID.test(artifact.id)) continue;
			const extension = MIME_EXTENSION.get(artifact.mime);
			if (extension === undefined) continue;
			const file = `${artifact.kind}-${artifact.id}.${extension}`;
			try {
				await mkdir(directory, { recursive: true });
				await writeFile(join(directory, file), artifact.bytes);
			} catch {
				continue;
			}
			const previous = artifacts.get(artifact.id);
			if (previous !== undefined) await dropArtifact(previous);
			const record: ArtifactRecord = {
				id: artifact.id,
				kind: artifact.kind,
				mime: artifact.mime,
				file,
				bytes: artifact.bytes.byteLength,
			};
			artifacts.set(artifact.id, record);
			written.push(record);
		}

		// A card must never carry an id whose bytes are not on disk: an artifact that
		// failed to write is dropped from the answer instead of rendered broken.
		let answer = result;
		if (answer.kind === "ready") {
			const ids = new Set(written.map((record) => record.id));
			const { favicon, image, ...rest } = answer.preview;
			answer = {
				kind: "ready",
				preview: {
					...rest,
					favicon: favicon !== null && ids.has(favicon.id) ? favicon : null,
					image: image !== null && ids.has(image.id) ? image : null,
				},
			};
		}

		const at = now();
		entries.set(key, {
			result: answer,
			artifacts: written,
			expiresAt: at + ttlFor(answer),
			lastUsed: at,
		});
		/*
		 * The BOUNDS are applied on EVERY store, not on a timer. A cache that runs
		 * unbounded for up to five minutes between sweeps is a cache whose ceiling is
		 * "whatever five minutes of scrolling costs", which is exactly the number the
		 * cap exists to remove. `evict` is O(1) while the bounds hold: it only sorts
		 * once a bound is crossed. The five-minute interval bounds the DISK work
		 * (`sweep`), which is the expensive half.
		 */
		await evict();
		// The DISK work (adopting files a previous launch left, dropping what has
		// expired) is the expensive half, so it runs at most every five minutes on
		// the access path - and unconditionally at startup, from `sweep()`.
		if (at - lastSweep >= SWEEP_INTERVAL_MS) {
			lastSweep = at;
			await adoptExistingFiles();
			for (const [staleKey, entry] of [...entries]) {
				if (at >= entry.expiresAt) await dropEntry(staleKey, entry);
			}
		}
		return answer;
	}

	async function sweep(): Promise<void> {
		await adoptExistingFiles();
		const at = now();
		for (const [key, entry] of [...entries]) {
			if (at >= entry.expiresAt) await dropEntry(key, entry);
		}
		await evict();
	}

	return {
		lookup(key) {
			const entry = entries.get(key);
			if (entry === undefined) return undefined;
			if (now() >= entry.expiresAt) {
				// Expiry goes through the SAME drop path the sweep uses, so an expired
				// entry's files leave the directory and the byte/artifact accounting with
				// it. A bare `entries.delete` left them on disk, referenced by nothing
				// and reachable by nothing, permanently spending a bound that the LRU
				// then took out on live entries.
				void dropEntry(key, entry);
				return undefined;
			}
			entry.lastUsed = now();
			return { result: entry.result };
		},
		store,
		async read(id, which) {
			if (!ARTIFACT_ID.test(id)) return null;
			const record = artifacts.get(id);
			if (record === undefined) return null;
			// The kind is part of the question: an id that names the card's favicon must
			// not be served for `image`, and the reverse. A renderer asking for the
			// wrong one gets a stated `not-found` rather than the wrong picture.
			if (record.kind !== which) return null;
			try {
				const bytes = await readFile(join(directory, record.file));
				return { mime: record.mime, bytes: new Uint8Array(bytes) };
			} catch {
				artifacts.delete(id);
				return null;
			}
		},
		sweep,
		stats() {
			return {
				entries: entries.size,
				artifacts: artifacts.size,
				bytes: totalBytes(),
			};
		},
	};
}
