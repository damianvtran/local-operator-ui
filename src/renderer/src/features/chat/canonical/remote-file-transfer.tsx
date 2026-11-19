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
import { remoteFilePath } from "@shared/lib/remote-file-path";
import {
	showErrorToast,
	showInfoToast,
	showLoadingToast,
	showSuccessToast,
} from "@shared/utils/toast-manager";
import { type ReactNode, useSyncExternalStore } from "react";
import type { CanvasDocument, CanvasRemoteFile } from "../types/canvas";
import { openLocalTarget, revealLocalTarget } from "../utils/link-open";
import { remoteUnreachableText, remoteUnreadableText } from "./remote-files";
import {
	ATTACHMENT_RETRY_DELAYS_MS,
	AttachmentGoneError,
	AttachmentOwnerUnreachableError,
	fetchAttachmentBlob,
} from "./use-attachment-url";

/**
 * A sentence that names a device, with the name kept on one line.
 *
 * Device names are hyphenated (`lop-remote-node-2`), and a wrapping toast or
 * menu label broke them at the hyphen - "…from lop-remote-node-" / "2…"
 * (design round 2, D2-3). The translated sentence is left whole; only the
 * device's own run is marked `whitespace-nowrap`.
 */
export function keepDeviceWhole(text: string, device: string): ReactNode {
	const at = device ? text.indexOf(device) : -1;
	if (at < 0) return text;
	return (
		<>
			{text.slice(0, at)}
			<span className="whitespace-nowrap">{device}</span>
			{text.slice(at + device.length)}
		</>
	);
}

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
 * turn into sentences. A 504 whose code says the owner's transfer is still
 * running throws `RemoteFetchPendingError`, its subclass, so a viewer can say
 * "still fetching" rather than "offline" (UX round 2, U2-1).
 *
 * `delays` re-asks a 504 on that schedule (a viewer passes the transcript's
 * `ATTACHMENT_RETRY_DELAYS_MS`), calling `onPending` before each wait; the
 * default is one attempt, so an action (Save as..., Copy) answers at once.
 */
export async function fetchRemoteFileBlob(
	document: CanvasDocument,
	{
		delays = [],
		onPending,
		signal,
	}: {
		delays?: readonly number[];
		onPending?: () => void;
		signal?: { aborted: boolean };
	} = {},
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
	for (let attempt = 0; ; attempt += 1) {
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
		const delay = delays[attempt];
		if (result.status === 504 && delay !== undefined && !signal?.aborted) {
			onPending?.();
			await new Promise((resolve) => setTimeout(resolve, delay));
			if (signal?.aborted) throw new AttachmentOwnerUnreachableError();
			continue;
		}
		if (result.status === 504)
			throw result.kind === "error" &&
				result.refusal?.code === FETCH_PENDING_CODE
				? new RemoteFetchPendingError()
				: new AttachmentOwnerUnreachableError();
		if (result.status === 404) throw new AttachmentGoneError();
		throw new Error(t("ui.canvas.files.remoteReadFailed"));
	}
}

/**
 * The owner answered and its transfer is still running (504
 * `attachment_fetch_pending`). A subclass, so every caller that treats an
 * unreachable owner as "worth retrying" keeps doing so.
 */
export class RemoteFetchPendingError extends AttachmentOwnerUnreachableError {
	constructor() {
		super();
		this.name = "RemoteFetchPendingError";
	}
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
/** Core's 504 code for "the transfer is still running" (design §1). */
const FETCH_PENDING_CODE = "attachment_fetch_pending";

const PATH_SEPARATOR = /[\\/]/;

/** The folder a landed path sits in, as the toast names it ("Downloads"). */
function folderOf(path: string): string {
	const parts = path.split(PATH_SEPARATOR).filter(Boolean);
	return parts.length > 1 ? (parts[parts.length - 2] ?? "") : "";
}

/**
 * Land one remote row on this device and answer the receipt (or `null` after
 * telling the reader why not). The success toast carries the local actions,
 * on the LANDED path only.
 *
 * WHAT THE READER SEES (UX round 1, U1-2): a loading toast from the press,
 * which the outcome replaces in place (one toast id). A 504 whose code says
 * the transfer is still running is re-POSTed on the bytes' own backoff
 * (`ATTACHMENT_RETRY_DELAYS_MS`; the POST is idempotent and joins the
 * backend's single flight), so the file lands without a re-click; any other
 * 504 is the owner being offline and says so in the shared sentence (U1-6).
 * The receipt toast names the folder and stays 8 s, long enough to reach its
 * three actions (U1-9), and an identical file already there says so (Q1-5).
 *
 * `delays` is the retry schedule, a parameter only so tests need not wait it.
 */
export async function downloadRemoteFile(
	remote: CanvasRemoteFile,
	name: string,
	{ delays = ATTACHMENT_RETRY_DELAYS_MS }: { delays?: readonly number[] } = {},
): Promise<RemoteDownloadReceipt | null> {
	const device = remote.deviceName;
	if (remote.unreadable) {
		showInfoToast(remoteUnreadableText(remote));
		return null;
	}
	// i18n: ignore toast id, never shown
	const id = `remote-download:${keyOf(remote)}`;
	showLoadingToast(
		keepDeviceWhole(
			t("ui.canvas.files.remoteDownloading", { name, device }),
			device,
		),
		{ id },
	);
	for (let attempt = 0; ; attempt += 1) {
		let response: Awaited<ReturnType<typeof desktopRequest>>;
		try {
			response = await desktopRequest({
				op: "sessions.files.download",
				sessionId: remote.sessionId,
				fileId: remote.fileId,
			});
		} catch {
			showErrorToast(t("ui.canvas.files.remoteDownloadFailed", { device }), {
				id,
			});
			return null;
		}
		const body = response.body as {
			result?: RemoteDownloadReceipt;
			detail?: { code?: string } | string;
		} | null;
		const receipt = body?.result;
		if (response.status === 200 && receipt?.path) {
			rememberLanded(remote, receipt.path);
			const folder = folderOf(receipt.path);
			showSuccessToast(
				receipt.created === false
					? t("ui.canvas.files.remoteAlreadyDownloaded", {
							name: receipt.name,
							folder,
						})
					: t("ui.canvas.files.remoteDownloaded", {
							name: receipt.name,
							folder,
						}),
				{
					id,
					duration: LANDED_TOAST_MS,
					description: <LandedActions path={receipt.path} />,
				},
			);
			return receipt;
		}
		if (response.status !== PENDING_STATUS) {
			showErrorToast(t("ui.canvas.files.remoteDownloadFailed", { device }), {
				id,
			});
			return null;
		}
		const code =
			typeof body?.detail === "object" ? (body.detail?.code ?? null) : null;
		const delay = delays[attempt];
		if (code === FETCH_PENDING_CODE && delay !== undefined) {
			await new Promise((resolve) => setTimeout(resolve, delay));
			continue;
		}
		showErrorToast(
			code === FETCH_PENDING_CODE
				? t("ui.canvas.files.remoteDownloadPending", { device })
				: remoteUnreachableText(device),
			{ id },
		);
		return null;
	}
}

/**
 * How long the receipt toast stays: its three actions need reaching, and
 * Sonner's 4 s default dismissed them mid-read (UX round 1, U1-9).
 */
const LANDED_TOAST_MS = 8000;

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
 * A peer-held document as the canvas opens it: the same document with its
 * owner's display path replaced by a `remote-file:` identifier
 * (`shared/lib/remote-file-path.ts`), and no bytes.
 *
 * NO bytes and NO object URL here (agent review round 1, R1-2/R1-3): the
 * viewer fetches over the content route on mount, under one refcounted cache
 * entry it releases when the tab closes, and the persisted canvas store keeps
 * only the identifier, so a reloaded tab fetches again instead of holding a
 * dead `blob:` URL. The owner's display path is dropped from the opened
 * document entirely, so nothing downstream can probe, open or write it (I3-1).
 */
export function remoteCanvasDocument(document: CanvasDocument): CanvasDocument {
	const remote = document.remote;
	if (!remote) return document;
	return {
		...document,
		path: remoteFilePath(remote.sessionId, remote.fileId, document.title),
		content: "",
		availability: undefined,
	};
}

/** A Blob's bytes as bare base64, the encoding the spreadsheet viewer parses. */
export async function blobToBase64(blob: Blob): Promise<string> {
	const dataUrl = await blobToDataUrl(blob);
	return dataUrl.slice(dataUrl.indexOf(",") + 1);
}
