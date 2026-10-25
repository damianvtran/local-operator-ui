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

import { desktopMedia } from "@shared/api/local-operator/desktop-api";
import type { DesktopLibraryAsset } from "../../../../shared/desktop-control-contract";
import { assetDisplayName } from "./library-model";

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
	const response = await desktopMedia(
		{ op: "library.content", assetId: asset.id, download: true },
		null,
	);
	if (response.kind !== "bytes") {
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
