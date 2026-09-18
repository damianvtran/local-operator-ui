import type {
	CanvasDocument,
	CanvasDocumentType,
} from "@features/chat/types/canvas";
import { getFileTypeFromPath } from "@features/chat/utils/file-types";
import { getFileName } from "@features/chat/utils/get-file-name";

/**
 * One builder for a `CanvasDocument`.
 *
 * Five places hand-assembled this literal — ⌘O and New file in `canvas/index.tsx`,
 * the two branches of `handleFileClick`, and the (now deleted) `message.files`
 * effect in `message-item` — and they had drifted: one kept the `file://`
 * prefix on `path`, one used the path as `id` and one used a data URI, and one
 * wrote the file path into `content` as a "placeholder". Each difference was
 * invisible until two of them met in the store, where the `file://` and bare
 * spellings of one file became two tiles.
 *
 * The rules this encodes, and why each is not arbitrary:
 *
 * - **`path` is the resolved-form path with any `file://` prefix stripped**,
 *   and `id` is the same string. The store dedupes by `id` (`addMentionedFilesBatch`),
 *   so identity has to be the path itself — the basename collapse that used to
 *   stand in for this merged `~/a/report.pdf` with `~/b/report.pdf`.
 * - **`content` defaults to the empty string.** The store is persisted to
 *   `localStorage` with no `partialize` (`canvas-store.ts`), so a document that
 *   carries bytes writes those bytes into a ~5 MB quota. A *mention* is a
 *   pointer, never a payload: the viewers read bytes over IPC when they open.
 *   A caller that genuinely holds content (⌘O's `selectFile`, the click handler
 *   for a text file) passes it explicitly.
 * - **`title`** is the basename unless the caller has a better one.
 */

export type CanvasDocumentOptions = {
	/** Bytes or text, when the caller already holds them. Defaults to `""`. */
	content?: string;
	/** Overrides the extension-derived type. */
	type?: CanvasDocumentType;
	/** Overrides the basename, e.g. for a data URI. */
	title?: string;
	/** Set by the probe. Absent means "not checked yet", not "present". */
	availability?: "present" | "missing";
	/** Size in bytes, when the probe reported one. */
	sizeBytes?: number;
	/** Last agent modification, ms since epoch. */
	lastAgentModified?: number;
	/**
	 * The file's mtime at the moment this content was read, ms since epoch.
	 *
	 * A caller that read the bytes off a probe answer passes it, because the
	 * canvas's freshness check has nothing else to compare a later probe
	 * against; a caller that did not (the OS dialog, a file created here) leaves
	 * it absent, which the check reads as "adopt what the file says now".
	 */
	readMtimeMs?: number;
};

/** Strip a `file://` prefix, keeping the rest of the path intact. */
export const stripFileUrl = (path: string): string =>
	path.startsWith("file://") ? path.slice("file://".length) : path;

export function canvasDocumentForPath(
	path: string,
	options: CanvasDocumentOptions = {},
): CanvasDocument {
	const normalizedPath = stripFileUrl(path);
	const document: CanvasDocument = {
		id: normalizedPath,
		title: options.title ?? getFileName(path),
		path: normalizedPath,
		content: options.content ?? "",
		type: options.type ?? getFileTypeFromPath(path),
	};
	if (options.availability !== undefined)
		document.availability = options.availability;
	if (options.sizeBytes !== undefined) document.sizeBytes = options.sizeBytes;
	if (options.lastAgentModified !== undefined)
		document.lastAgentModified = options.lastAgentModified;
	if (options.readMtimeMs !== undefined)
		document.readMtimeMs = options.readMtimeMs;
	return document;
}
