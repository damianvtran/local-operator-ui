import type { CanvasDocument } from "@features/chat/types/canvas";
import { mimeTypeForPath } from "@features/chat/utils/file-kind";
import { Button, Tooltip } from "@shared/components/ui";
import { useFileBlobUrl } from "@shared/hooks/use-file-blob-url";
import { cn } from "@shared/lib/utils";
import { FileUp } from "lucide-react";
import { type FC, memo } from "react";
import { FileViewerState, OpenInOsButton } from "./file-viewer-state";

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
 * ## The toolbar beneath the chrome bar
 *
 * Chromium's PDF viewer draws its own toolbar inside the frame: a page count, a
 * zoom stepper, rotate, download and print, in the platform's colours. It is not
 * themeable, it is not addressable from our DOM, and it is therefore an
 * **accepted platform object** rather than a themed surface — the same category
 * as the OS file picker or the native scrollbar. What we own is the strip above
 * it: the file's name and a way out to the OS, on `surface` with our hairline
 * rule, so the themed part of the frame is clearly ours and the document begins
 * where our chrome ends.
 *
 * The honest limitation, which is why the PDF frames in the evidence set come
 * from the real app rather than the storybook sweep: the probe proves the viewer
 * DOCUMENT loads (frame URL, the injected `<embed>`, no CSP violations, no
 * download) — it does not prove pixels. Frames decide that.
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
		enabled: !document.path.startsWith("data:"),
	});

	return (
		<div className={cn("flex h-full w-full flex-col bg-canvas")}>
			{/*
			 * Our chrome. The document frame below starts where this ends, which is
			 * the entire reason it exists: without it the first thing under the tab
			 * strip is a foreign toolbar and the panel reads as if the document had
			 * been embedded from somewhere else.
			 */}
			<div
				className={cn(
					"flex min-h-8 shrink-0 items-center justify-between gap-2",
					"border-hairline border-b bg-surface px-2 py-1.5",
				)}
			>
				<span className={cn("truncate text-body-sm text-ink")}>
					{document.title}
				</span>
				<Tooltip content="Open in default app">
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Open in default app"
						onClick={() => window.api.openFile(document.path)}
					>
						<FileUp aria-hidden="true" />
					</Button>
				</Tooltip>
			</div>

			<div className={cn("min-h-0 flex-1")}>
				{state.status === "ready" ? (
					<iframe
						src={state.url}
						title={`PDF: ${document.title}`}
						className={cn("h-full w-full border-0 bg-surface")}
					/>
				) : state.status === "loading" ? (
					<FileViewerState quiet title="Opening…" />
				) : state.code === "too-large" ? (
					<FileViewerState title="Too large to preview" detail={document.path}>
						<OpenInOsButton path={document.path} />
					</FileViewerState>
				) : (
					<FileViewerState
						title={
							state.code === "not-found"
								? "File no longer exists"
								: "This PDF could not be opened"
						}
						detail={state.message}
					>
						<OpenInOsButton path={document.path} />
					</FileViewerState>
				)}
			</div>
		</div>
	);
};

export const PdfPreview = memo(PdfPreviewComponent);
