import { isolateLtr, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
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
	useI18nLocale();
	// The file name is a Latin-led LTR run inside a sentence the catalogue may set
	// right-to-left (ur): isolated in code, never in the catalogue (S18b design
	// round 1, D3), so a name that starts or ends on a neutral (`_backup_.pdf`)
	// stays attached to its own run. A no-op under every LTR locale.
	const name = isolateLtr(getFileName(file));
	return (
		<div
			className="mt-2 flex w-fit max-w-full items-center rounded-sm border border-warning-border bg-warning-wash px-3 py-2 text-warning"
			title={t("ui.chat.attachments.not_viewable", { name })}
		>
			<span className="me-2 flex shrink-0 items-center">
				<CircleAlert size={14} />
			</span>
			{/*
			 * `line-clamp-2`, not `truncate` (S18b design round 1, D2): the sentence
			 * ends in the reason, and a translation moves the width at which a
			 * single-line ellipsis starts eating it (ru truncated below a 752px card
			 * where English did below 579px). Two lines keep the file name and the
			 * reason at every locale; `break-words` lets a long unbroken name wrap
			 * instead of clipping without an ellipsis, which line-clamp cannot draw
			 * inline.
			 */}
			<span className="line-clamp-2 max-w-full break-words text-body-sm">
				{reason
					? `${name} ${reason}`
					: t("ui.chat.attachments.not_viewable_detail", { name })}
			</span>
			{onOpen ? (
				<button
					type="button"
					onClick={onOpen}
					className="ms-3 shrink-0 text-body-sm underline underline-offset-2"
				>
					{t("ui.chat.attachments.open")}
				</button>
			) : null}
		</div>
	);
};
