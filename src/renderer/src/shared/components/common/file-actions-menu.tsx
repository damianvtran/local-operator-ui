import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	Tooltip,
} from "@shared/components/ui";
import {
	ClipboardCopy,
	File as FileIcon,
	FolderOpen,
	LayoutGrid,
	MoreHorizontal,
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
	 * Optional: icon to use for the trigger (defaults to MoreHorizontal).
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
};

/**
 * FileActionsMenu provides actions to open a file, show in canvas, or its location in the OS.
 * Uses Electron's window.api.openFile and window.api.showItemInFolder.
 */
export const FileActionsMenu = ({
	filePath,
	tooltip = "File actions",
	icon,
	"aria-label": ariaLabel = "File actions",
	onShowInCanvas,
}: FileActionsMenuProps) => {
	const handleCopyFilePath = async () => {
		if (!filePath) return;
		try {
			await navigator.clipboard.writeText(filePath);
			showSuccessToast("File path copied to clipboard");
		} catch (err) {
			console.error("Failed to copy file path: ", err);
			showErrorToast("Failed to copy file path");
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
						{icon ?? <MoreHorizontal aria-hidden="true" />}
					</Button>
				</DropdownMenuTrigger>
			</Tooltip>

			<DropdownMenuContent
				align="end"
				className="min-w-45"
				onClick={(e) => e.stopPropagation()}
			>
				{onShowInCanvas && (
					<DropdownMenuItem onSelect={onShowInCanvas}>
						<LayoutGrid aria-hidden="true" />
						<span>Show in canvas</span>
					</DropdownMenuItem>
				)}
				<DropdownMenuItem onSelect={handleOpenFile}>
					<FileIcon aria-hidden="true" />
					<span>Open file</span>
				</DropdownMenuItem>
				<DropdownMenuItem
					onSelect={() => window.api.showItemInFolder(filePath)}
				>
					<FolderOpen aria-hidden="true" />
					<span>Open folder</span>
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={handleCopyFilePath}>
					<ClipboardCopy aria-hidden="true" />
					<span>Copy file path</span>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
};
