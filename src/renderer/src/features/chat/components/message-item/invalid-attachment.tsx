import { CircleAlert } from "lucide-react";
import type { FC } from "react";
/**
 * Props for the InvalidAttachment component
 */
export type InvalidAttachmentProps = {
	file: string;
	/**
	 * The specific reason, when the caller knows one ("is too large to preview").
	 * The default sentence guesses at three causes (incomplete, deleted, moved),
	 * which is wrong for a file that is fine and merely over the preview cap.
	 */
	reason?: string;
	/** Hands the file to the OS; offered when a preview is impossible but the file is fine. */
	onOpen?: () => void;
};

/**
 * Extracts the filename from a path
 * @param path - The file path or URL
 * @returns The extracted filename
 */
const PATH_SEPARATOR_REGEX = /[/\\]/;
const getFileName = (path: string): string => {
	// Handle both local paths and URLs
	const parts = path.split(PATH_SEPARATOR_REGEX);
	return parts[parts.length - 1];
};

/**
 * Component for displaying invalid file attachments
 */
export const InvalidAttachment: FC<InvalidAttachmentProps> = ({
	file,
	reason,
	onOpen,
}) => {
	return (
		<div
			className="mt-2 flex w-fit max-w-full items-center rounded-sm border border-warning-border bg-warning-wash px-3 py-2 text-warning"
			title={`File not viewable: ${getFileName(file)}`}
		>
			<span className="mr-2 flex shrink-0 items-center">
				<CircleAlert size={14} />
			</span>
			<span className="max-w-full truncate text-body-sm">
				{reason
					? `${getFileName(file)} ${reason}`
					: `${getFileName(file)} is not viewable (file may be incomplete, deleted, or moved)`}
			</span>
			{onOpen ? (
				<button
					type="button"
					onClick={onOpen}
					className="ml-3 shrink-0 text-body-sm underline underline-offset-2"
				>
					Open
				</button>
			) : null}
		</div>
	);
};
