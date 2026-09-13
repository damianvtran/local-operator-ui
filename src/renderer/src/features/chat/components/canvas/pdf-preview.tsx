import type { CanvasDocument } from "@features/chat/types/canvas";
import { mimeTypeForPath } from "@features/chat/utils/file-kind";
import { useFileBlobUrl } from "@shared/hooks/use-file-blob-url";
import { cn } from "@shared/lib/utils";
import { type FC, memo } from "react";
import {
	FileViewerState,
	OpenInOsButton,
	ViewerChrome,
} from "./file-viewer-state";

/**
 * PDFs, in Chromium's own viewer, over a blob URL.
 *
 * Measured, not assumed (Electron 35.5.1, macOS arm64, the app's CSP copied
 * verbatim): an `<iframe src="blob:…">` whose blob says `application/pdf` loads
 * a frame document with `contentType: application/pdf` and zero CSP violations.
 * `<embed>` — the variant every Stack Overflow answer reaches for — is the one
 * our own CSP blocks, because there is no `object-src` directive and it falls
 * back to `default-src 'self'`. `plugins: true` changes nothing on Electron 35
 * and would widen the app's plugin surface for no behaviour, so
 * `webPreferences` is not touched.
 *
 * ## Naming the file once
 *
 * Chromium draws its toolbar from the frame's URL — an iframe's `title`
 * attribute is an accessibility label, not a document name — so a blob URL put
 * the UUID of the blob in the platform bar while our own bar printed the
 * filename, two names for one document and one of them garbage. `#toolbar=0`
 * (a fragment Chromium's PDF viewer honours; verified in the app, not assumed)
 * drops the platform toolbar entirely, which leaves the name this file actually
 * has in the one strip we own. The trade is stated rather than hidden: the
 * platform's page counter, zoom stepper and print button go with it. Those are
 * in the OS viewer, one click away in the bar above, and a UUID printed as a
 * filename is worse than a missing zoom control.
 *
 * What the probe proves, and what the frames prove. The probe measures the viewer
 * DOCUMENT: frame URL, the injected `<embed>`, no CSP violations, no download.
 * Whether it PAINTS is a question for pixels, and the committed
 * `canvas-workspace--pdf-viewer` frames answer it - this harness's headless
 * Chrome draws the fixture document under our own name bar (`#toolbar=0`) in all
 * twelve themes. An earlier probe of the same wiring measured
 * `childBodyKids: 0`, so that was a difference between browser builds rather than
 * a law about this surface. The live `mentioned-files-app` frame stays the
 * evidence for the REAL read path, since that is the one production takes, over
 * the main process's bytes rather than a story fixture.
 *
 * No `pdf.js`, deliberately: it is a real dependency (a ~1.5 MB build plus a
 * worker asset, which is its own CSP decision), it re-implements a canvas
 * renderer for a toolbar Chromium already draws, and it duplicates the PDFium
 * the runtime already ships.
 */
const PdfPreviewComponent: FC<{ document: CanvasDocument }> = ({
	document,
}) => {
	const state = useFileBlobUrl(document.path, {
		mtimeMs: document.lastAgentModified,
		mimeType: mimeTypeForPath(document.path),
		sizeBytes: document.sizeBytes,
	});

	return (
		<div className={cn("flex h-full w-full flex-col bg-canvas")}>
			{/* Our chrome, and the only name on this surface: see the note above. */}
			<ViewerChrome title={document.title} path={document.path} />

			<div className={cn("min-h-0 flex-1")}>
				{state.status === "ready" ? (
					<iframe
						src={`${state.url}#toolbar=0`}
						title={`PDF: ${document.title}`}
						className={cn("h-full w-full border-0 bg-surface")}
					/>
				) : state.status === "loading" ? (
					<FileViewerState quiet title="Opening…" />
				) : state.code === "too-large" ? (
					<FileViewerState title="Too large to preview" detail={state.message}>
						<OpenInOsButton path={document.path} />
					</FileViewerState>
				) : (
					<FileViewerState
						title={
							state.code === "not-found"
								? "File no longer exists"
								: "This PDF could not be opened"
						}
						detail={state.message ?? document.path}
					>
						<OpenInOsButton path={document.path} />
					</FileViewerState>
				)}
			</div>
		</div>
	);
};

export const PdfPreview = memo(PdfPreviewComponent);
