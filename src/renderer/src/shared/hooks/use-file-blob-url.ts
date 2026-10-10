/**
 * A local file's bytes as an object URL, for every surface that shows a format
 * the renderer has no other way to paint (PDF, image, audio, video thumbnails).
 *
 * Three decisions, each with a reason:
 *
 * **The bytes come over IPC, not the backend.** A path the agent touched is a
 * path on disk; `read-file-bytes` answers with it whether or not the backend is
 * running, which matters for a panel whose whole content is local paths. It is
 * also what the CSP already permits for a frame (`frame-src … blob:`) — a custom
 * backend origin would not be, because `frame-src` names only the two literal
 * hosts.
 *
 * **The blob URL is refcounted and released on unmount.** The transcript window
 * is 60 rows and rows unmount as the reader scrolls; a viewer that closed with
 * its blob still alive is a leak proportional to scrolling. The discipline lives
 * in `shared/lib/blob-url-cache`, shared with attachment images, so there is one
 * implementation of it rather than two.
 *
 * **The cache key is `path:mtime:size`, and a caller with no mtime shares
 * nothing.** A digest is immutable, a file is not: an agent rewriting the file
 * the user is looking at must not keep showing the version that was on disk when
 * the panel opened. `mtimeMs` comes from the probe, which is why it is a
 * parameter — a renderer cannot `stat`. The key changes when the CALLER supplies
 * a different mtime or size, so the grid's click handler threads the probe's
 * `lastAgentModified` through the document it opens.
 *
 * A caller that CANNOT stat (a message attachment, a composer tile: they hold a
 * bare path) used to key on `path:0`, and two holders of one path then shared
 * whichever bytes the first read — so an agent that rewrites `/tmp/plot.png`
 * between turns showed the OLD picture in the newer message while the older one
 * was still mounted (agent review round 1, R1). With no mtime there is no
 * evidence two reads are the same file, so the entry is private to the holder:
 * its own key, its own read, revoked on its own unmount. The cost is one read per
 * holder instead of one per path, which is what the route this replaced paid on
 * every request.
 *
 * Failure is STATE, not an exception, because the viewer must say something
 * specific: "too large to preview" offers the OS, "not found" says so, and
 * neither is a spinner that never resolves.
 *
 * **A path that is already a URL passes straight through.** The composer's
 * staging tiles and the transcript's attachments hand over a MIXED list —
 * picked files, pasted `data:` images, `http(s):` URLs — and the caller should
 * not have to branch on where each one's bytes live before it can ask for a
 * URL. `data:` carries its bytes in the string and an `http(s):` one is fetched
 * by the element itself; there is nothing for the bridge to read and nothing
 * this hook revokes. A `file://` spelling of a local path is normalised instead
 * (the bridge speaks bare paths), so both spellings are one cache entry.
 *
 * **A relative path resolves against Electron MAIN's working directory.** Main
 * resolves it (`resolveUserPath`, `~` and cwd), where the route this replaced
 * resolved it against the DAEMON's, and the cache key carries no cwd. Legacy
 * payloads with a relative path are the only caller affected, and a path that
 * the two processes would resolve differently was already ambiguous (agent
 * review round 1, R9).
 */

import {
	createBlobUrl,
	peek,
	publish,
	release,
	retain,
} from "@shared/lib/blob-url-cache";
import { useEffect, useState } from "react";
import {
	MAX_FILE_READ_BYTES,
	type ReadFileBytesFailure,
} from "../../../../shared/desktop-contract";

export type FileBlobState =
	| { status: "loading"; url: null }
	| { status: "ready"; url: string }
	| {
			status: "unavailable";
			url: null;
			code: ReadFileBytesFailure | "no-bridge";
			message: string;
			sizeBytes?: number;
	  };

type FileBlobOptions = {
	/** Last modification of the file, so a rewrite is a different cache entry. */
	mtimeMs?: number | null;
	/** MIME type of the blob; a PDF renders only when the blob says it is one. */
	mimeType: string;
	/**
	 * The size the probe reported, when it reported one.
	 *
	 * This is what makes the "too large to preview" state honest BEFORE a read is
	 * attempted: main refuses anything over `MAX_FILE_READ_BYTES`, and a viewer
	 * that only learns that after the round trip has spent an IPC call to be told
	 * something the tile already knew.
	 */
	sizeBytes?: number | null;
	/**
	 * A ceiling BELOW `MAX_FILE_READ_BYTES`, for a surface whose picture is much
	 * smaller than its file (a 28px video thumbnail must not pull 64 MiB across
	 * IPC for one still). Enforced twice: here, against the probe's size, so the
	 * state is stated without a read; and by main, against `stat`, for a caller
	 * that has no size (the bridge's own `maxBytes` argument) — so the ceiling
	 * holds whether or not the size was known.
	 */
	maxBytes?: number | null;
};

/**
 * The short, user-facing reason a preview is missing, for surfaces too small to
 * carry a sentence (a composer tile's tooltip). The viewers keep their own
 * longer copy beside their own layout; this is the one-line form so a tile can
 * say WHY rather than look the same for every failure (design round 1, D5).
 * `null` for `no-bridge`, which is a fact about the host and not the file.
 */
export function previewFailureReason(
	code: ReadFileBytesFailure | "no-bridge",
): string | null {
	switch (code) {
		case "too-large":
			return "Too large to preview";
		case "not-found":
			return "File no longer exists";
		case "not-a-file":
			return "Not a file";
		case "unreadable":
			return "Could not be read";
		case "no-bridge":
			return null;
	}
}

/**
 * Source of the per-holder ids that keep an mtime-less entry private. Module
 * state because ids must be unique across every mounted holder, not per hook
 * instance; it only ever counts up, so the StrictMode double-invoked
 * initializer that draws one and discards it costs nothing.
 */
let nextHolderId = 0;

/**
 * The cache key. Path plus modification and size, because a file is mutable.
 *
 * Without an mtime the key is the HOLDER's, never the path's (see the header):
 * keying on a constant for "unknown" is what let a second holder join the first
 * holder's stale bytes. Size rides along when the caller has it, because a
 * rewrite inside one filesystem tick keeps the mtime and rarely keeps the size.
 */
const cacheKey = (
	path: string,
	mtimeMs: number | null | undefined,
	sizeBytes: number | null | undefined,
	holderId: number,
): string =>
	mtimeMs === null || mtimeMs === undefined
		? `file:${path}:holder-${holderId}`
		: `file:${path}:${mtimeMs}:${sizeBytes ?? ""}`;

/**
 * `file://` is a spelling of the same path, not an origin: the bridge and the
 * cache both speak bare paths, and legacy message payloads are the caller that
 * still writes it.
 */
const stripFileUrl = (path: string): string =>
	path.startsWith("file://") ? path.slice("file://".length) : path;

/**
 * A path that is already a URL, so there are no bytes to read: `data:` carries
 * its own, `http(s):` is fetched by the element that renders it.
 */
const isDirectUrl = (path: string): boolean =>
	path.startsWith("data:") ||
	path.startsWith("http://") ||
	path.startsWith("https://");

export function useFileBlobUrl(
	path: string,
	{ mtimeMs, mimeType, sizeBytes, maxBytes }: FileBlobOptions,
): FileBlobState {
	const filePath = stripFileUrl(path);
	/*
	 * A `data:`/`http(s):` document is already a URL, so there is nothing to fetch
	 * and nothing to revoke. This is settled here rather than at the call sites
	 * that used to pass `enabled: !path.startsWith("data:")`: passing `enabled`
	 * false made the effect return before touching state, so the hook answered
	 * `loading` forever and the viewer said "Opening…" about a document it had
	 * been handed in full.
	 */
	const direct = isDirectUrl(filePath) ? filePath : null;
	// A lazy initializer, so the id is drawn once per holder and survives
	// re-renders; the key it feeds is stable for the holder's whole life.
	const [holderId] = useState(() => nextHolderId++);
	const key = cacheKey(filePath, mtimeMs, sizeBytes, holderId);
	/*
	 * The same argument one step earlier for size: a file the probe measured as
	 * over the read cap is refused by main without being read, so the viewer
	 * states it without asking.
	 */
	const cap = Math.min(maxBytes ?? MAX_FILE_READ_BYTES, MAX_FILE_READ_BYTES);
	const overCap = direct === null && (sizeBytes ?? 0) > cap;
	// PEEK, never retain: a `useState` initializer is double-invoked under
	// `StrictMode` (`main.tsx`), and a retain there adds a reference no unmount
	// can pay back. The effect below owns every reference.
	const [state, setState] = useState<FileBlobState>(() => {
		if (direct) return { status: "ready", url: direct };
		if (overCap)
			return {
				status: "unavailable",
				url: null,
				code: "too-large",
				message: `${filePath} is ${sizeBytes} bytes, over the ${cap}-byte preview cap`,
				sizeBytes: sizeBytes ?? undefined,
			};
		const cached = peek(key);
		return cached
			? { status: "ready", url: cached }
			: { status: "loading", url: null };
	});

	useEffect(() => {
		if (direct || overCap) return;
		let live = true;
		const cached = retain(key);
		if (cached) {
			setState({ status: "ready", url: cached });
			return () => {
				live = false;
				release(key);
			};
		}
		setState({ status: "loading", url: null });

		const bridge = window.api?.readFileBytes;
		if (typeof bridge !== "function") {
			// Browser development: there is no local-file bridge, so this is not a
			// fact about the file and must not be reported as one.
			setState({
				status: "unavailable",
				url: null,
				code: "no-bridge",
				message: "Local file access is unavailable outside the desktop app.",
			});
			return;
		}

		void (async () => {
			try {
				// `cap` rides along so main refuses an over-ceiling file by `stat`
				// even when the caller had no size to refuse it with.
				const result = await window.api.readFileBytes(filePath, cap);
				if (!live) return;
				if (!result.success) {
					setState({
						status: "unavailable",
						url: null,
						code: result.code,
						message: result.error,
						sizeBytes: result.sizeBytes,
					});
					return;
				}
				const url = createBlobUrl(result.data as BlobPart, mimeType);
				if (!live) {
					// The viewer closed while the read was in flight. Publishing the
					// URL would strand an entry no unmount can release, so it dies
					// here instead.
					URL.revokeObjectURL(url);
					return;
				}
				publish(key, url);
				// Retain AFTER the bytes land, so the count reflects holders rather
				// than requests: a viewer that closed mid-read never retained and
				// must not release.
				setState({ status: "ready", url: retain(key) ?? url });
			} catch (error) {
				if (!live) return;
				setState({
					status: "unavailable",
					url: null,
					code: "unreadable",
					message: error instanceof Error ? error.message : String(error),
				});
			}
		})();

		return () => {
			live = false;
			release(key);
		};
	}, [direct, overCap, key, mimeType, filePath, cap]);

	return state;
}
