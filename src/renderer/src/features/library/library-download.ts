import { t } from "@shared/i18n";
/**
 * Save one Library asset's bytes to disk through the browser's download path.
 *
 * WHY NOT `window.api.openFile` OR A FINDER REVEAL: an artifact asset is
 * digest-addressed inside the attachment store and has no user-visible file to
 * reveal. The content route accepts `?download=1`, which asks the backend for
 * an attachment disposition; this helper fetches those bytes through the media
 * relay (the JSON transport cannot carry them) and hands the browser a Blob
 * URL with a filename derived from the asset's effective name.
 *
 * THE OBJECT URL IS REVOKED ON THE NEXT TASK, not immediately: a synthetic
 * anchor's click hands the URL to the download manager asynchronously, and
 * revoking in the same tick can cancel the transfer in Chromium.
 */

import { remoteUnreachableText } from "@features/chat/canonical/remote-files";
import { desktopMedia } from "@shared/api/local-operator/desktop-api";
import { dismissToast, showLoadingToast } from "@shared/utils/toast-manager";
import type { DesktopLibraryAsset } from "../../../../shared/desktop-control-contract";
import { assetDisplayName, remoteDevice } from "./library-model";

/**
 * The owner of a PEER's asset did not answer (the relay's 504). Its message is
 * the offline sentence every remote surface shares (UX round 1, U1-6/U1-8), so
 * a caller shows it instead of the generic "could not be saved".
 */
export class RemoteAssetUnreachableError extends Error {
	constructor(device: string) {
		super(remoteUnreachableText(device));
		this.name = "RemoteAssetUnreachableError";
	}
}

/** The sentence a failed save shows: the offline one for a peer, else `fallback`. */
export function assetCopyFailure(error: unknown, fallback: string): string {
	return error instanceof RemoteAssetUnreachableError
		? error.message
		: fallback;
}

/** A path separator, hoisted so the split does not build a regex per download. */
const PATH_SEPARATOR = /[\\/]/;

/** A filename the OS accepts, with the extension the asset already carries. */
function downloadName(asset: DesktopLibraryAsset): string {
	const display = assetDisplayName(asset);
	const base = display.split(PATH_SEPARATOR).pop() || asset.id;
	if (base.includes(".")) return base;
	const path = asset.ref.display_path || asset.ref.path || "";
	const suffix = path.includes(".") ? path.slice(path.lastIndexOf(".")) : "";
	return `${base}${suffix}`;
}

export async function saveAssetCopy(asset: DesktopLibraryAsset): Promise<void> {
	/*
	 * A PEER's bytes cross the mesh, which can take seconds: the press shows a
	 * loading toast the outcome replaces (UX round 1, U1-8), the same pattern as
	 * the Files panel's Download to this device.
	 */
	const progress = asset.remote
		? showLoadingToast(
				t("ui.canvas.files.remoteDownloading", {
					name: assetDisplayName(asset),
					device: remoteDevice(asset),
				}),
				{ id: `library-remote-save:${asset.id}` },
			)
		: null;
	let response: Awaited<ReturnType<typeof desktopMedia>>;
	try {
		response = await desktopMedia(
			{ op: "library.content", assetId: asset.id, download: true },
			null,
		);
	} finally {
		if (progress !== null) dismissToast(progress);
	}
	if (response.kind !== "bytes") {
		if (asset.remote && response.kind === "error" && response.status === 504)
			throw new RemoteAssetUnreachableError(remoteDevice(asset));
		throw new Error(
			response.kind === "error"
				? response.detail
				: t("ui.library.errors.asset_read"),
		);
	}
	const blob = new Blob([response.data as BlobPart], {
		type:
			asset.ref.content_type || response.mimeType || "application/octet-stream",
	});
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = downloadName(asset);
	anchor.rel = "noopener";
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
