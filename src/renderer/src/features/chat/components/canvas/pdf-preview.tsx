import type { CanvasDocument } from "@features/chat/types/canvas";
import { mimeTypeForPath } from "@features/chat/utils/file-kind";
import { Button } from "@shared/components/ui/button";
import { useFileBlobUrl } from "@shared/hooks/use-file-blob-url";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { type FC, memo, useEffect, useState } from "react";
import {
	FileViewerState,
	OpenInOsButton,
	ViewerChrome,
} from "./file-viewer-state";
import { watchPdfViewer } from "./pdf-viewer-poll";

/**
 * Chromium owns the document; the app owns byte access and failure recovery.
 * The frame's load event is NOT PDF readiness: our navigation guard once blocked
 * the built-in viewer after application/pdf had loaded. Main reads the parsed
 * result from that exact browser-owned guest. Unknown runtime shapes time out
 * visibly instead of leaving a successful-looking blank.
 */
const PdfPreviewAttempt: FC<{
	document: CanvasDocument;
	onRetry: () => void;
}> = ({ document, onRetry }) => {
	useI18nLocale();
	const state = useFileBlobUrl(document.path, {
		mtimeMs: document.lastAgentModified,
		mimeType: mimeTypeForPath(document.path),
		sizeBytes: document.sizeBytes,
	});

	const [viewer, setViewer] = useState<"loading" | "ready" | "failed">(
		"loading",
	);
	useEffect(() => {
		if (state.status !== "ready") return;
		setViewer("loading");
		return watchPdfViewer(
			() =>
				typeof window.api?.pdfViewerStatus === "function"
					? window.api.pdfViewerStatus(state.url)
					: Promise.resolve("failed"),
			setViewer,
		);
	}, [state.status, state.url]);
	const retry = (
		<Button variant="secondary" size="sm" onClick={onRetry}>
			{t("ui.canvas.files.retry")}
		</Button>
	);

	/* The letterbox wears the PANE's ground (`canvas/index.tsx`): it is the pane's
	   body behind the document, so it takes the drawer's rung rather than the
	   conversation's `canvas`, which would leave the pane's tone under a changed
	   bar. */
	return (
		<div
			data-glass-plane="clear"
			className={cn("flex h-full w-full flex-col bg-elevated")}
		>
			{/* Our chrome, and the only name on this surface: see the note above. */}
			<ViewerChrome path={document.path} />

			<div
				className={cn("relative min-h-0 flex-1")}
				data-pdf-status={state.status === "ready" ? viewer : state.status}
			>
				{state.status === "ready" && viewer !== "failed" ? (
					<>
						<iframe
							src={`${state.url}#toolbar=0`}
							title={t("ui.canvas.pdf_preview.pdf", { title: document.title })}
							className={cn(
								"h-full w-full border-0 bg-surface",
								viewer === "loading" && "invisible",
							)}
						/>
						{viewer === "loading" ? (
							<output className={cn("absolute inset-0 block")}>
								<FileViewerState
									quiet
									title={t("ui.canvas.pdf_preview.opening")}
								/>
							</output>
						) : null}
					</>
				) : state.status === "loading" ? (
					<FileViewerState quiet title={t("ui.canvas.pdf_preview.opening")} />
				) : state.status === "unavailable" && state.code === "too-large" ? (
					<FileViewerState
						title={t("ui.canvas.pdf_preview.too_large_to_preview")}
						detail={state.message}
					>
						<OpenInOsButton path={document.path} />
					</FileViewerState>
				) : (
					<FileViewerState
						title={
							state.status === "unavailable" && state.code === "not-found"
								? t("ui.canvas.pdf_preview.file_no_longer_exists")
								: t("ui.canvas.pdf_preview.this_pdf_could_not_be_opened")
						}
						detail={
							state.status === "unavailable"
								? (state.message ?? document.path)
								: document.path
						}
					>
						{retry}
						<OpenInOsButton path={document.path} />
					</FileViewerState>
				)}
			</div>
		</div>
	);
};

const PdfPreviewComponent: FC<{ document: CanvasDocument }> = ({
	document,
}) => {
	const [attempt, setAttempt] = useState(0);
	return (
		<PdfPreviewAttempt
			key={`${document.path}:${document.lastAgentModified}:${document.sizeBytes}:${attempt}`}
			document={document}
			onRetry={() => setAttempt((value) => value + 1)}
		/>
	);
};

export const PdfPreview = memo(PdfPreviewComponent);
