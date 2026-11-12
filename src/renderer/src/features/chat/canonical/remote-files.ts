/**
 * Files a PEER owns, listed on this device (`features.remote_files`).
 *
 * docs/design/remote-files-parity.md §2-§3 (core). A remote session's Files
 * rows arrive through the SAME index and the SAME classification as local ones
 * (kind, origin, sticky sections, sort, filter), plus four remote-only fields.
 * This module turns those fields into one `CanvasRemoteFile` and decides, as a
 * PURE table, which file actions such a row may offer.
 *
 * THE ONE RULE THAT MATTERS (UI invariant I3-1): a remote row's `ref.path` is
 * the OWNER's display path. It may name an unrelated file on this disk, so it
 * is never handed to `openFile`, `showItemInFolder`, `readFileBytes` or the
 * static route. The only local path a remote row ever acts on is the one the
 * backend's download receipt returned (`landedPath`). `remoteFileActions`
 * carries the target of every path-shaped action, and the menu acts on that
 * target alone, so the invariant is checked where the table is built.
 */
import { t } from "@shared/i18n";
import type { CanvasRemoteFile } from "../types/canvas";
import type { SessionFile } from "./session-files";

/** Reasons the owner may give for a row it cannot serve (`remote_unreadable`). */
export type RemoteUnreadableReason =
	| "outside_session_files"
	| "missing"
	| "too_large"
	| "sensitive"
	| "not_referenced";

/**
 * The media relay's per-response ceiling (`desktop-media.ts`), and therefore
 * the ceiling of anything this window reads into a Blob: Save as..., Copy
 * image, an open through the content route. A larger readable file is still
 * offered as Download to this device, which lands it on disk instead.
 */
export const REMOTE_PREVIEW_MAX_BYTES = 32 * 1024 * 1024;

/**
 * The remote facts of one index row, or `null` for a local row.
 *
 * `deviceName` falls back to the device id: the viewer stamps `origin_device`
 * from its own catalogue, and an unnamed peer is still a peer.
 */
export function remoteOf(
	row: SessionFile,
	parentSessionId: string,
): CanvasRemoteFile | null {
	if (!row.remote) return null;
	const device = row.origin_device ?? null;
	return {
		fileId: row.id,
		sessionId: parentSessionId,
		deviceName: device?.name || device?.id || "",
		readKind: row.remote_read?.kind ?? null,
		// A row with no read verdict is unreadable too: the owner computes
		// `remote_read` for every page row, so its absence is a refusal, never a
		// licence to guess.
		unreadable:
			row.remote_unreadable ??
			(row.remote_read ? null : ("outside_session_files" as const)),
		ownerPath: row.ref.type === "path" ? row.ref.path : null,
		sizeBytes: row.size_bytes,
	};
}

/** The explanation a disabled remote action carries (tooltip / menu sublabel). */
export function remoteUnreadableText(remote: CanvasRemoteFile): string {
	const device = remote.deviceName;
	switch (remote.unreadable) {
		case "missing":
			return t("ui.canvas.files.remoteReason.missing", { device });
		case "too_large":
			return t("ui.canvas.files.remoteReason.tooLarge", { device });
		case "sensitive":
			return t("ui.canvas.files.remoteReason.sensitive", { device });
		case "not_referenced":
			return t("ui.canvas.files.remoteReason.notReferenced", { device });
		default:
			return t("ui.canvas.files.remoteReason.workspace", { device });
	}
}

/** Whether this row's bytes fit the window's read ceiling (an unknown size does). */
export function remoteFitsWindow(remote: CanvasRemoteFile): boolean {
	return (
		remote.sizeBytes === null || remote.sizeBytes <= REMOTE_PREVIEW_MAX_BYTES
	);
}

/** Why a readable row too large for this window cannot open here. */
export function remoteTooLargeText(remote: CanvasRemoteFile): string {
	return t("ui.canvas.files.remoteTooLargeToOpen", {
		device: remote.deviceName,
	});
}

/**
 * The one sentence an unreadable row's menu leads with, or `null` when every
 * entry the row offers can run. Every disabled entry of an unreadable row fails
 * for the same owner-side reason, so it is said once, at the top (D1-4).
 */
export function remoteMenuReason(remote: CanvasRemoteFile): string | null {
	return remote.unreadable ? remoteUnreadableText(remote) : null;
}

/**
 * The folder the Files header's Open folder may reveal, or `null` to hide it.
 *
 * A remote session's `cwd` is the OWNER's working directory: revealing it here
 * opens whatever folder this disk has at that path, or fails (QA round 1,
 * Q1-1). The header shows the device line instead (I3-1, as for rows).
 */
export function revealableCwd(
	cwd: string | undefined,
	remote: boolean,
): string | undefined {
	return remote ? undefined : cwd;
}

/**
 * The owner-offline sentence every remote surface shares (UX round 1, U1-6):
 * the transcript tile, the canvas viewers, the sound line and the toasts.
 */
export function remoteUnreachableText(device: string): string {
	// A sentence can't start with the lower-case fallback name, so a nameless
	// owner gets its own wording rather than "the other device isn't…".
	return device
		? t("ui.canvas.files.remoteUnreachable", { device })
		: t("ui.canvas.files.remoteUnreachableUnnamed");
}

export type RemoteActionId =
	| "show-in-canvas"
	| "expand-image"
	| "download"
	| "open-file"
	| "open-folder"
	| "copy-file-path"
	| "copy-owner-path"
	| "save-as"
	| "copy-image";

export type RemoteAction = {
	id: RemoteActionId;
	label: string;
	/** Present only when the action cannot run; the sentence says why. */
	disabledReason: string | null;
	/**
	 * The ONLY path a path-shaped action may act on. For open-file, open-folder
	 * and copy-file-path it is the landed local copy; for copy-owner-path it is
	 * the owner's display path, which is copied as text and never opened.
	 */
	target: string | null;
};

export type RemoteActionOptions = {
	mediaKind: "image" | "video" | "audio" | "file";
	canShowInCanvas: boolean;
	canExpand: boolean;
	/** The receipt's path once this row was downloaded on this device. */
	landedPath: string | null;
};

/**
 * The §3 action table for one remote row.
 *
 * | Action             | readable                       | unreadable          |
 * |--------------------|--------------------------------|---------------------|
 * | Show in canvas     | yes; disabled + reason > 32 MiB| disabled + reason   |
 * | Download           | yes, until landed              | disabled + reason   |
 * | Open file/folder   | after download, landed path    | -                   |
 * | Copy file path     | after download, landed path    | -                   |
 * | Copy path on dev.  | path rows, until landed        | path rows           |
 * | Save as...         | yes, <= 32 MiB                 | disabled + reason   |
 * | Copy image         | images, <= 32 MiB              | -                   |
 *
 * An unreadable row offers the SAME entries, in the same order, as a readable
 * one that has not been downloaded, with the transfer entries disabled (design
 * round 1, D1-4): the menu keeps one shape, and the reason is stated once by
 * the menu (`remoteMenuReason`), not under one entry.
 */
export function remoteFileActions(
	remote: CanvasRemoteFile,
	{ mediaKind, canShowInCanvas, canExpand, landedPath }: RemoteActionOptions,
): RemoteAction[] {
	const device = remote.deviceName;
	const ownerPath = remote.ownerPath;
	const copyOwner: RemoteAction[] = ownerPath
		? [
				{
					id: "copy-owner-path",
					label: t("ui.canvas.files.remoteCopyOwnerPath", { device }),
					disabledReason: null,
					target: ownerPath,
				},
			]
		: [];
	if (remote.unreadable) {
		const reason = remoteUnreadableText(remote);
		return [
			...(canShowInCanvas
				? [
						{
							id: "show-in-canvas" as const,
							label: t("ui.common.file_actions.show_in_canvas"),
							disabledReason: reason,
							target: null,
						},
					]
				: []),
			{
				id: "download",
				label: t("ui.canvas.files.remoteDownload"),
				disabledReason: reason,
				target: null,
			},
			...copyOwner,
			{
				id: "save-as",
				label: t("ui.chat.image_actions.save_as"),
				disabledReason: reason,
				target: null,
			},
		];
	}
	const fitsWindow = remoteFitsWindow(remote);
	const actions: RemoteAction[] = [];
	if (canShowInCanvas)
		actions.push({
			id: "show-in-canvas",
			label: t("ui.common.file_actions.show_in_canvas"),
			// Above the relay's ceiling an open can only fail (review R1-4), so the
			// entry says why and Download, which lands it on disk, stays offered.
			disabledReason: fitsWindow ? null : remoteTooLargeText(remote),
			target: null,
		});
	if (canExpand && mediaKind === "image")
		actions.push({
			id: "expand-image",
			label: t("ui.chat.image_actions.expand_image"),
			disabledReason: null,
			target: null,
		});
	if (landedPath) {
		actions.push(
			{
				id: "open-file",
				label: t("ui.common.file_actions.open_file"),
				disabledReason: null,
				target: landedPath,
			},
			{
				id: "open-folder",
				label: t("ui.common.file_actions.open_folder"),
				disabledReason: null,
				target: landedPath,
			},
			{
				id: "copy-file-path",
				label: t("ui.common.file_actions.copy_file_path"),
				disabledReason: null,
				target: landedPath,
			},
		);
	} else {
		actions.push(
			{
				id: "download",
				label: t("ui.canvas.files.remoteDownload"),
				disabledReason: null,
				target: null,
			},
			...copyOwner,
		);
	}
	if (fitsWindow) {
		actions.push({
			id: "save-as",
			label: t("ui.chat.image_actions.save_as"),
			disabledReason: null,
			target: null,
		});
		if (mediaKind === "image")
			actions.push({
				id: "copy-image",
				label: t("ui.chat.image_actions.copy_image"),
				disabledReason: null,
				target: null,
			});
	}
	return actions;
}

/**
 * Which sentence the Files panel shows when a remote session's index is not
 * listable here. `null` = the index is listable and its rows show as usual.
 *
 * - capability absent (an older viewer daemon): today's sentence, unchanged.
 * - `peer_update_required`: the OWNER predates the peer index; name it so the
 *   reader knows which device to update.
 */
export function remoteUnsupportedSentence(page: {
	unsupported_reason?: string | null;
	device_name?: string | null;
}): string {
	if (page.unsupported_reason === "peer_update_required") {
		const device =
			page.device_name || t("ui.canvas.files.remoteDeviceFallback");
		// What to do, not only what is wrong (UX round 1, U1-7): the desktop app
		// has no peer-update action, and `lop network update <peer>` is core's own
		// verb for it (`local_operator/network/cli.py`, the 409's sentence too).
		return `${t("ui.canvas.files.remotePeerUpdate", { device })}\n${t(
			"ui.canvas.files.remotePeerUpdateHow",
			{ device },
		)}`;
	}
	return REMOTE_FILES_UNSUPPORTED_SENTENCE;
}

/**
 * Today's sentence for a remote session on a viewer without
 * `features.remote_files`. Kept byte-for-byte: an older daemon must read
 * exactly as it did (design §6 "Older VIEWER daemon").
 */
export const REMOTE_FILES_UNSUPPORTED_SENTENCE =
	"Remote files cannot be opened on this device.";
