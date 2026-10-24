import type { CanvasDocument } from "@features/chat/types/canvas";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { type FC, memo } from "react";
import { documentNameForDisplay } from "../../utils/get-file-name";
import { AudioDocumentPlayer } from "./audio-document-player";
import { ViewerChrome } from "./file-viewer-state";

/** Reuse the Files row resolver and shared engine: an artifact:<digest> is not
 * a file, and a native audio element here would bypass speech arbitration. */
const AudioPreviewComponent: FC<{ document: CanvasDocument }> = ({
	document,
}) => {
	/* A pasted document's name is read from its path with `t()` at render
	 * time, so the memoised preview has to subscribe to the locale itself. */
	useI18nLocale();
	return (
		<div
			data-glass-plane="clear"
			className="flex h-full w-full flex-col bg-elevated"
		>
			<ViewerChrome path={document.artifact ? null : document.path} />
			{/* The player body is a PLANE: the viewer root already owns the region's
			 * alpha, and `bg-sunken` here was the second opaque fill QA read as a solid
			 * black body (round 1, Q2). The flat role stays for the no-glass look; on
			 * glass the plane is clear. */}
			<div
				data-glass-plane="clear"
				className="flex flex-1 items-center justify-center bg-sunken p-6"
			>
				<div className="w-full max-w-96">
					<AudioDocumentPlayer
						doc={document}
						label={documentNameForDisplay(document)}
					/>
				</div>
			</div>
		</div>
	);
};
export const AudioPreview = memo(AudioPreviewComponent);
