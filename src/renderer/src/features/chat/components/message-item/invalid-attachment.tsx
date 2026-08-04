import { CircleAlert } from "lucide-react";
import type { FC } from "react";
/**
 * Props for the InvalidAttachment component
 */
export type InvalidAttachmentProps = {
	file: string;
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
export const InvalidAttachment: FC<InvalidAttachmentProps> = ({ file }) => {
	return (
		<div
			className="mt-2 flex w-fit max-w-full items-center rounded-sm border border-warning-border bg-warning-wash px-3 py-2 text-warning"
			title={`File not viewable: ${getFileName(file)}`}
		>
			<span className="mr-2 flex shrink-0 items-center">
				<CircleAlert size={14} />
			</span>
			<span className="max-w-full truncate text-body-sm">
				{getFileName(file)} is not viewable (file may be incomplete, deleted, or
				moved)
			</span>
		</div>
	);
};
