/**
 * A local file's bytes as an object URL, for the viewers that show a format the
 * renderer has no other way to paint (PDF, image, audio).
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
 * **The cache key is `path:mtime`.** A digest is immutable, a file is not: an
 * agent rewriting the file the user is looking at must not keep showing the
 * version that was on disk when the panel opened. `mtimeMs` comes from the
 * probe, which is why it is a parameter — a renderer cannot `stat`. The scope is
 * exactly that: the key changes when the CALLER supplies a different mtime, so
 * the grid's click handler threads the probe's `lastAgentModified` through the
 * document it opens, and a tab opened without one keeps serving the bytes it
 * first read.
 *
 * Failure is STATE, not an exception, because the viewer must say something
 * specific: "too large to preview" offers the OS, "not found" says so, and
 * neither is a spinner that never resolves.
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
};

/** The cache key. Path plus modification, because a file is mutable. */
const cacheKey = (path: string, mtimeMs: number | null | undefined): string =>
	`file:${path}:${mtimeMs ?? 0}`;

export function useFileBlobUrl(
	path: string,
	{ mtimeMs, mimeType, sizeBytes }: FileBlobOptions,
): FileBlobState {
	const key = cacheKey(path, mtimeMs);
	/*
	 * A `data:` document is already a URL, so there is nothing to fetch and
	 * nothing to revoke. This is settled here rather than at the three call sites
	 * that used to pass `enabled: !path.startsWith("data:")`: passing `enabled`
	 * false made the effect return before touching state, so the hook answered
	 * `loading` forever and the viewer said "Opening…" about a document it had
	 * been handed in full.
	 */
	const isDataUri = path.startsWith("data:");
	/*
	 * The same argument one step earlier for size: a file the probe measured as
	 * over the read cap is refused by main without being read, so the viewer
	 * states it without asking.
	 */
	const overCap = !isDataUri && (sizeBytes ?? 0) > MAX_FILE_READ_BYTES;
	// PEEK, never retain: a `useState` initializer is double-invoked under
	// `StrictMode` (`main.tsx`), and a retain there adds a reference no unmount
	// can pay back. The effect below owns every reference.
	const [state, setState] = useState<FileBlobState>(() => {
		if (isDataUri) return { status: "ready", url: path };
		if (overCap)
			return {
				status: "unavailable",
				url: null,
				code: "too-large",
				message: `${path} is ${sizeBytes} bytes, over the ${MAX_FILE_READ_BYTES}-byte preview cap`,
				sizeBytes: sizeBytes ?? undefined,
			};
		const cached = peek(key);
		return cached
			? { status: "ready", url: cached }
			: { status: "loading", url: null };
	});

	useEffect(() => {
		if (isDataUri || overCap) return;
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
				const result = await window.api.readFileBytes(path);
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
	}, [isDataUri, overCap, key, mimeType, path]);

	return state;
}
