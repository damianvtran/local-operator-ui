import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	Tooltip,
} from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import {
	ClipboardCopy,
	Ellipsis,
	Eye,
	File as FileIcon,
	FolderOpen,
	LayoutGrid,
} from "lucide-react";
import { showErrorToast, showSuccessToast } from "../../utils/toast-manager";

/**
 * Props for FileActionsMenu
 */
export type FileActionsMenuProps = {
	/**
	 * The file path or URI to act on.
	 */
	filePath: string;
	/**
	 * Optional: placement for the tooltip or menu trigger.
	 */
	tooltip?: string;
	/**
	 * Optional: icon to use for the trigger (defaults to Ellipsis).
	 */
	icon?: React.ReactNode;
	/**
	 * Optional: aria-label for accessibility.
	 */
	"aria-label"?: string;
	/**
	 * Optional: callback to show the file in the canvas.
	 */
	onShowInCanvas?: (() => void) | undefined;
	/**
	 * Optional: callback for an in-app preview of a readable file.
	 *
	 * The menu is shared, so the item only exists where a surface CAN preview:
	 * the project feed's markdown/text tiles pass this, and every existing
	 * caller (which has no in-app reader for the file) omits it and keeps the
	 * four established entries unchanged. The item is FIRST because it is the
	 * cheapest door — it reads the stored copy rather than leaving the app.
	 */
	onPreview?: (() => void) | undefined;
};

/**
 * FileActionsMenu provides actions to open a file, show in canvas, or its location in the OS.
 * Uses Electron's window.api.openFile and window.api.showItemInFolder.
 */
export const FileActionsMenu = ({
	filePath,
	tooltip = t("ui.common.actions.file_actions_menu.file_actions"),
	icon,
	"aria-label": ariaLabel = t(
		"ui.common.actions.file_actions_menu.file_actions",
	),
	onShowInCanvas,
	onPreview,
}: FileActionsMenuProps) => {
	useI18nLocale();
	const handleCopyFilePath = async () => {
		if (!filePath) return;
		try {
			await navigator.clipboard.writeText(filePath);
			showSuccessToast(
				t("ui.common.actions.file_actions_menu.file_path_copied_to_clipboard"),
			);
		} catch (err) {
			console.error("Failed to copy file path: ", err);
			showErrorToast(
				t("ui.common.actions.file_actions_menu.failed_to_copy_file_path"),
			);
		}
	};

	const handleOpenFile = () => {
		if (filePath) {
			window.api.openFile(filePath);
		}
	};

	return (
		<DropdownMenu>
			<Tooltip content={tooltip}>
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={ariaLabel}
						// The trigger sits inside a clickable attachment; without this
						// the attachment opens behind the menu.
						onClick={(e) => e.stopPropagation()}
					>
						{icon ?? <Ellipsis aria-hidden="true" />}
					</Button>
				</DropdownMenuTrigger>
			</Tooltip>

			<DropdownMenuContent
				align="end"
				className="min-w-45"
				onClick={(e) => e.stopPropagation()}
			>
				{onPreview && (
					<DropdownMenuItem onSelect={onPreview}>
						<Eye aria-hidden="true" />
						<span>{t("ui.common.file_actions.preview")}</span>
					</DropdownMenuItem>
				)}
				{onShowInCanvas && (
					<DropdownMenuItem onSelect={onShowInCanvas}>
						<LayoutGrid aria-hidden="true" />
						<span>{t("ui.common.file_actions.show_in_canvas")}</span>
					</DropdownMenuItem>
				)}
				<DropdownMenuItem onSelect={handleOpenFile}>
					<FileIcon aria-hidden="true" />
					<span>{t("ui.common.file_actions.open_file")}</span>
				</DropdownMenuItem>
				<DropdownMenuItem
					onSelect={() => window.api.showItemInFolder(filePath)}
				>
					<FolderOpen aria-hidden="true" />
					<span>{t("ui.common.file_actions.open_folder")}</span>
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={handleCopyFilePath}>
					<ClipboardCopy aria-hidden="true" />
					<span>{t("ui.common.file_actions.copy_file_path")}</span>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
};
