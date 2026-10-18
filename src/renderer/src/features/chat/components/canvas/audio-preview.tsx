import type { CanvasDocument } from "@features/chat/types/canvas";
import { type FC, memo } from "react";
import { AudioDocumentPlayer } from "./audio-document-player";
import { ViewerChrome } from "./file-viewer-state";

/** Reuse the Files row resolver and shared engine: an artifact:<digest> is not
 * a file, and a native audio element here would bypass speech arbitration. */
const AudioPreviewComponent: FC<{ document: CanvasDocument }> = ({
	document,
}) => (
	<div className="flex h-full w-full flex-col bg-elevated">
		<ViewerChrome path={document.artifact ? null : document.path} />
		<div className="flex flex-1 items-center justify-center bg-sunken p-6">
			<div className="w-full max-w-96">
				<AudioDocumentPlayer doc={document} label={document.title} />
			</div>
		</div>
	</div>
);
export const AudioPreview = memo(AudioPreviewComponent);
