/**
 * Bytes and downloads for PEER-held Files rows (`features.remote_files`).
 *
 * Two doors, both addressed by the owner's row id and never by its path
 * (I3-1, `remote-files.ts`):
 *
 * - `fetchRemoteFileBlob`: the row's bytes into this window (preview, Save
 *   as..., Copy image, the finder thumbnail), over the media relay's
 *   `sessions.files.content` op; a digest-backed row reuses the transcript's
 *   own fetch-on-miss op instead, so the two surfaces share one cache entry.
 * - `downloadRemoteFile`: the backend lands the file on THIS device and answers
 *   a receipt; the landed path is remembered per row so the row's menu can
 *   then offer the local file actions on that copy, and on nothing else.
 */
import {
	desktopMedia,
	desktopRequest,
} from "@shared/api/local-operator/desktop-api";
import { t } from "@shared/i18n";
import {
	showErrorToast,
	showInfoToast,
	showSuccessToast,
} from "@shared/utils/toast-manager";
import { useSyncExternalStore } from "react";
import type { CanvasDocument, CanvasRemoteFile } from "../types/canvas";
import { openLocalTarget, revealLocalTarget } from "../utils/link-open";
import { remoteUnreadableText } from "./remote-files";
import {
	AttachmentGoneError,
	AttachmentOwnerUnreachableError,
	fetchAttachmentBlob,
} from "./use-attachment-url";

/** The backend's download receipt (core design §3). */
export type RemoteDownloadReceipt = {
	path: string;
	name: string;
	bytes: number;
	sha256: string;
	created: boolean;
	origin_device?: { id: string; name: string | null } | null;
};

/**
 * One peer-held document's bytes as a Blob.
 *
 * Throws `AttachmentOwnerUnreachableError` on a 504 (the owner did not answer
 * in time: worth retrying), `AttachmentGoneError` on a 404, and an Error
 * carrying the owner's reason on a 409 - the same classes the menus already
 * turn into sentences.
 */
export async function fetchRemoteFileBlob(
	document: CanvasDocument,
): Promise<Blob> {
	const remote = document.remote;
	if (!remote) throw new Error("Not a remote file");
	if (remote.unreadable) throw new Error(remoteUnreadableText(remote));
	if (document.artifact)
		return fetchAttachmentBlob(
			{
				sessionId: document.artifact.sessionId,
				childId: document.artifact.childId ?? null,
			},
			document.artifact.digest,
		);
	const result = await desktopMedia(
		{
			op: "sessions.files.content",
			sessionId: remote.sessionId,
			fileId: remote.fileId,
		},
		null,
	);
	if (result.kind === "bytes")
		return new Blob([result.data as BlobPart], { type: result.mimeType });
	if (result.status === 504) throw new AttachmentOwnerUnreachableError();
	if (result.status === 404) throw new AttachmentGoneError();
	throw new Error(t("ui.canvas.files.remoteReadFailed"));
}

/** Read a Blob as a `data:` URI, the shape the canvas opens without a path. */
export function blobToDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error ?? new Error("read failed"));
		reader.readAsDataURL(blob);
	});
}

// ------------------------------------------------------------ landed copies

/*
 * Landed paths by `<sessionId>:<fileId>`. Module-wide and in memory: a
 * receipt is a fact about this device for as long as the app runs, and a
 * second download of the same row is idempotent on the backend (it answers the
 * same path with `created: false`), so losing the map on restart costs one
 * cheap re-POST, never a duplicate file.
 */
const landed = new Map<string, string>();
const listeners = new Set<() => void>();

const keyOf = (remote: CanvasRemoteFile) =>
	`${remote.sessionId}:${remote.fileId}`;

export function landedPathFor(remote: CanvasRemoteFile): string | null {
	return landed.get(keyOf(remote)) ?? null;
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** The landed local copy of a remote row, re-rendering when one lands. */
export function useLandedPath(remote: CanvasRemoteFile | null): string | null {
	return useSyncExternalStore(subscribe, () =>
		remote ? landedPathFor(remote) : null,
	);
}

export function rememberLanded(remote: CanvasRemoteFile, path: string) {
	landed.set(keyOf(remote), path);
	for (const listener of listeners) listener();
}

/** The status a pending transfer answers; a re-POST joins the same transfer. */
const PENDING_STATUS = 504;

/**
 * Land one remote row on this device and answer the receipt (or `null` after
 * telling the reader why not). The success toast carries the local actions,
 * on the LANDED path only.
 */
export async function downloadRemoteFile(
	remote: CanvasRemoteFile,
): Promise<RemoteDownloadReceipt | null> {
	const device = remote.deviceName;
	if (remote.unreadable) {
		showInfoToast(remoteUnreadableText(remote));
		return null;
	}
	let response: Awaited<ReturnType<typeof desktopRequest>>;
	try {
		response = await desktopRequest({
			op: "sessions.files.download",
			sessionId: remote.sessionId,
			fileId: remote.fileId,
		});
	} catch {
		showErrorToast(t("ui.canvas.files.remoteDownloadFailed", { device }));
		return null;
	}
	const receipt = (response.body as { result?: RemoteDownloadReceipt } | null)
		?.result;
	if (response.status === 200 && receipt?.path) {
		rememberLanded(remote, receipt.path);
		showSuccessToast(
			t("ui.canvas.files.remoteDownloaded", { name: receipt.name }),
			{
				description: <LandedActions path={receipt.path} />,
			},
		);
		return receipt;
	}
	showErrorToast(
		response.status === PENDING_STATUS
			? t("ui.canvas.files.remoteDownloadPending", { device })
			: t("ui.canvas.files.remoteDownloadFailed", { device }),
	);
	return null;
}

/** The receipt's three local actions, on the landed path and nothing else. */
function LandedActions({ path }: { path: string }) {
	const link =
		"rounded-sm px-1 text-accent text-meta hover:underline focus-visible:underline";
	return (
		<span className="flex flex-wrap items-center gap-x-2">
			<button
				type="button"
				className={link}
				onClick={() => void openLocalTarget(path)}
			>
				{t("ui.common.file_actions.open_file")}
			</button>
			<button
				type="button"
				className={link}
				onClick={() => void revealLocalTarget(path)}
			>
				{t("ui.common.file_actions.open_folder")}
			</button>
			<button
				type="button"
				className={link}
				onClick={() => {
					void navigator.clipboard
						.writeText(path)
						.then(() =>
							showSuccessToast(
								t(
									"ui.common.actions.file_actions_menu.file_path_copied_to_clipboard",
								),
							),
						)
						.catch(() =>
							showErrorToast(
								t(
									"ui.common.actions.file_actions_menu.failed_to_copy_file_path",
								),
							),
						);
				}}
			>
				{t("ui.common.file_actions.copy_file_path")}
			</button>
		</span>
	);
}

/**
 * A peer-held document made openable without a path on this disk.
 *
 * Its `path` becomes a `blob:` URL over the fetched bytes: every byte viewer
 * reads a URL path through `useFileBlobUrl` as is, a text viewer gets its
 * decoded text as `content`, and the save path refuses a URL (a URL is not a
 * file). NOT a `data:` URI: the canvas store is persisted whole to
 * localStorage, and a 32 MiB file as base64 there would exceed its quota. The
 * owner's display path is dropped from the opened document entirely, so
 * nothing downstream can probe, open or write it (I3-1).
 */
export async function remoteOpenableDocument(
	document: CanvasDocument,
	blob: Blob,
	encoding: "utf-8" | "base64" | "bytes" | "range",
): Promise<CanvasDocument> {
	let content = "";
	if (encoding === "utf-8") content = await blob.text();
	else if (encoding === "base64") {
		const dataUrl = await blobToDataUrl(blob);
		content = dataUrl.slice(dataUrl.indexOf(",") + 1);
	}
	return {
		...document,
		path: URL.createObjectURL(blob),
		content,
		availability: undefined,
	};
}
