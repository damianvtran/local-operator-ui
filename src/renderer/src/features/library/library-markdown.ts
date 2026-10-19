import type { CanvasDocument } from "@features/chat/types/canvas";
import type { DesktopLibraryAsset } from "../../../../shared/desktop-control-contract";

/**
 * The canvas document a Library markdown asset mounts the shared WYSIWYG with.
 *
 * THE BASELINE IS THE PROBE'S EXACT `mtimeMs`, never `asset.modified_at * 1000`.
 * The buffer owner compares `before.mtimeMs !== baselineMtime` strictly
 * (`document-buffers.ts`), and the index's `modified_at` is a seconds float
 * derived from a different stat call. Rounding or multiplying that value can
 * differ from the probe's floating-point millisecond reading by a fraction, and
 * the strict comparison then reports a clean file as moved: the first autosave
 * is held forever. The caller supplies the probe answer; `null` means the
 * bridge could not answer, which becomes `undefined` (the honest "no baseline"
 * path) rather than an invented one.
 *
 * The `library:` id prefix keeps the buffer from colliding with a Canvas
 * document that happens to point at the same path.
 */
export function libraryMarkdownDocument(
	asset: DesktopLibraryAsset,
	text: string,
	mtimeMs: number | null,
): CanvasDocument {
	return {
		id: `library:${asset.id}`,
		title:
			asset.name.trim() || asset.derived_name || asset.ref.path || asset.id,
		path: asset.ref.path ?? "",
		content: text,
		type: "markdown",
		readMtimeMs: mtimeMs ?? undefined,
		sizeBytes: asset.size_bytes,
		availability: "present",
	};
}
