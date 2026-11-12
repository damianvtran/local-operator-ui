/**
 * The `⋯` menu of a PEER-held Files row (`features.remote_files`).
 *
 * The entries come from `remoteFileActions` (the core design's §3 table) and
 * this component only renders and dispatches them. Every path-shaped action
 * acts on the `target` the table computed - the landed local copy, or for
 * "Copy path on <device>" the owner's display path as clipboard TEXT - and on
 * nothing else, which is how UI invariant I3-1 stays true here: the owner's
 * path never reaches `openFile`, `showItemInFolder` or a file read.
 *
 * Same trigger, same `bg-accent-wash` and the same "File actions" name as
 * `ImageActionsMenu`, so a column of `⋯` reads as one control down a list that
 * mixes local and remote rows. An unreadable row keeps its menu: its entries
 * are DISABLED with the owner's reason under each, rather than absent, so the
 * reader learns why instead of finding nothing.
 */
import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
	Tooltip,
} from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { showErrorToast, showSuccessToast } from "@shared/utils/toast-manager";
import {
	ClipboardCopy,
	Copy,
	Download,
	Ellipsis,
	File as FileIcon,
	FolderOpen,
	HardDriveDownload,
	LayoutGrid,
	Maximize2,
} from "lucide-react";
import {
	downloadRemoteFile,
	fetchRemoteFileBlob,
	useLandedPath,
} from "../canonical/remote-file-transfer";
import {
	type RemoteAction,
	type RemoteActionId,
	type RemoteActionOptions,
	remoteFileActions,
	remoteMenuReason,
	remoteUnreachableText,
} from "../canonical/remote-files";
import {
	AttachmentGoneError,
	AttachmentOwnerUnreachableError,
} from "../canonical/use-attachment-url";
import type { CanvasDocument } from "../types/canvas";
import { downloadBlob, pngForClipboard } from "../utils/image-actions";
import { openLocalTarget, revealLocalTarget } from "../utils/link-open";

const ICONS: Record<RemoteActionId, React.ReactNode> = {
	"show-in-canvas": <LayoutGrid aria-hidden="true" />,
	"expand-image": <Maximize2 aria-hidden="true" />,
	download: <HardDriveDownload aria-hidden="true" />,
	"open-file": <FileIcon aria-hidden="true" />,
	"open-folder": <FolderOpen aria-hidden="true" />,
	"copy-file-path": <ClipboardCopy aria-hidden="true" />,
	"copy-owner-path": <ClipboardCopy aria-hidden="true" />,
	"save-as": <Download aria-hidden="true" />,
	"copy-image": <Copy aria-hidden="true" />,
};

export type RemoteFileActionsMenuProps = {
	document: CanvasDocument;
	mediaKind: RemoteActionOptions["mediaKind"];
	saveName: string;
	onShowInCanvas?: () => void;
	onExpand?: () => void;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	onCloseAutoFocus?: (event: Event) => void;
	triggerTabIndex?: number;
	tooltip: string;
};

const bytesFailure = (
	error: unknown,
	fallback: string,
	device: string,
): string =>
	error instanceof AttachmentOwnerUnreachableError
		? remoteUnreachableText(device)
		: error instanceof AttachmentGoneError
			? t("ui.notices.files.save_failed_gone")
			: fallback;

/**
 * Dispatch one action. Exported for the node test that pins I3-1 end to end:
 * the path-shaped cases read `action.target` and nothing else.
 */
export async function performRemoteAction(
	action: RemoteAction,
	{
		document,
		saveName,
		onShowInCanvas,
		onExpand,
	}: Pick<
		RemoteFileActionsMenuProps,
		"document" | "saveName" | "onShowInCanvas" | "onExpand"
	>,
): Promise<void> {
	if (action.disabledReason !== null) return;
	const remote = document.remote;
	if (!remote) return;
	const copyText = async (text: string) => {
		try {
			await navigator.clipboard.writeText(text);
			showSuccessToast(
				t("ui.common.actions.file_actions_menu.file_path_copied_to_clipboard"),
			);
		} catch {
			showErrorToast(
				t("ui.common.actions.file_actions_menu.failed_to_copy_file_path"),
			);
		}
	};
	switch (action.id) {
		case "show-in-canvas":
			onShowInCanvas?.();
			return;
		case "expand-image":
			onExpand?.();
			return;
		case "download":
			await downloadRemoteFile(remote, document.title);
			return;
		case "open-file":
			if (action.target) await openLocalTarget(action.target);
			return;
		case "open-folder":
			if (action.target) await revealLocalTarget(action.target);
			return;
		case "copy-file-path":
		case "copy-owner-path":
			if (action.target) await copyText(action.target);
			return;
		case "save-as":
			try {
				downloadBlob(await fetchRemoteFileBlob(document), saveName);
			} catch (error) {
				showErrorToast(
					bytesFailure(
						error,
						t("ui.notices.files.save_failed"),
						remote.deviceName,
					),
				);
			}
			return;
		case "copy-image":
			try {
				const png = await pngForClipboard(await fetchRemoteFileBlob(document));
				await navigator.clipboard.write([
					new ClipboardItem({ [png.type]: png }),
				]);
				showSuccessToast(t("ui.notices.files.image_copied"));
			} catch (error) {
				showErrorToast(
					bytesFailure(
						error,
						t("ui.notices.files.image_copy_failed"),
						remote.deviceName,
					),
				);
			}
			return;
	}
}

export const RemoteFileActionsMenu = ({
	document,
	mediaKind,
	saveName,
	onShowInCanvas,
	onExpand,
	open,
	onOpenChange,
	onCloseAutoFocus,
	triggerTabIndex,
	tooltip,
}: RemoteFileActionsMenuProps) => {
	useI18nLocale();
	const remote = document.remote ?? null;
	const landedPath = useLandedPath(remote);
	if (!remote) return null;
	const actions = remoteFileActions(remote, {
		mediaKind,
		canShowInCanvas: Boolean(onShowInCanvas),
		canExpand: Boolean(onExpand),
		landedPath,
	});
	if (actions.length === 0) return null;
	/*
	 * One reason, said once, as the menu's first line (design round 1, D1-4):
	 * every disabled entry of an unreadable row fails for the same owner-side
	 * reason. As a sublabel of one entry it read as that entry's, and Radix
	 * skips disabled entries, so a keyboard user never reached it. A readable
	 * row's lone disabled entry (Show in canvas above the size ceiling) keeps
	 * its own reason under it, since it is the only one that cannot run.
	 */
	const menuReason = remoteMenuReason(remote);
	return (
		<DropdownMenu open={open} onOpenChange={onOpenChange}>
			<Tooltip content={tooltip}>
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						size="icon-sm"
						className="bg-accent-wash"
						aria-label={t("ui.common.actions.actions_for_name", {
							name: document.title,
						})}
						tabIndex={triggerTabIndex}
						onClick={(event) => event.stopPropagation()}
					>
						<Ellipsis aria-hidden="true" />
					</Button>
				</DropdownMenuTrigger>
			</Tooltip>
			<DropdownMenuContent
				align="end"
				className="min-w-45 max-w-72"
				onClick={(event) => event.stopPropagation()}
				onCloseAutoFocus={onCloseAutoFocus}
			>
				{menuReason ? (
					<DropdownMenuLabel
						className="max-w-52 font-normal text-ink-muted text-meta"
						data-remote-menu-reason=""
					>
						{menuReason}
					</DropdownMenuLabel>
				) : null}
				{actions.map((action) => (
					<DropdownMenuItem
						key={action.id}
						disabled={action.disabledReason !== null}
						// The header's precedent for disabled-with-reason entries:
						// `ink-disabled` measured 2.08:1 on dark (D1-4).
						className="data-[disabled]:text-ink-muted"
						onSelect={() =>
							void performRemoteAction(action, {
								document,
								saveName,
								onShowInCanvas,
								onExpand,
							})
						}
						data-remote-action={action.id}
					>
						{ICONS[action.id]}
						<span className="flex min-w-0 flex-col">
							<span>{action.label}</span>
							{action.disabledReason && !menuReason ? (
								/* The reason is the explanation the table owes a disabled
								   entry; at `meta` size under the label it reads as a
								   sublabel, not a second action. */
								<span className="text-meta text-ink-dim">
									{action.disabledReason}
								</span>
							) : null}
						</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
};
