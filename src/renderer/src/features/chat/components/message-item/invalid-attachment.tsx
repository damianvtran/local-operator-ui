import { useI18nLocale } from "@shared/i18n/use-locale";
import { CircleAlert } from "lucide-react";
import type { FC } from "react";
import { t } from "../../../../../../i18n/messages";
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
	useI18nLocale();
	return (
		<div
			className="mt-2 flex w-fit max-w-full items-center rounded-sm border border-warning-border bg-warning-wash px-3 py-2 text-warning"
			title={t(
				"ui.chat.message.invalid_attachment.file_not_viewable_getfilenamevalue",
				{ getFileNameValue: getFileName(file) },
			)}
		>
			<span className="mr-2 flex shrink-0 items-center">
				<CircleAlert size={14} />
			</span>
			<span className="max-w-full truncate text-body-sm">
				{reason
					? t("ui.chat.message.invalid_attachment.getfilenamevalue_reason", {
							getFileNameValue: getFileName(file),
							reason: reason,
						})
					: t(
							"ui.chat.message.invalid_attachment.getfilenamevalue_is_not_viewable_file_may_be_incomplete_deleted_or",
							{ getFileNameValue: getFileName(file) },
						)}
			</span>
			{onOpen ? (
				<button
					type="button"
					onClick={onOpen}
					className="ml-3 shrink-0 text-body-sm underline underline-offset-2"
				>
					{t("ui.chat.message.invalid_attachment.open")}
				</button>
			) : null}
		</div>
	);
};
