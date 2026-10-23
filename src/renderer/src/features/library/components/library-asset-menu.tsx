/**
 * The per-asset overflow menu: the actions a card or a preview row offers
 * without first selecting the asset.
 *
 * WHY IT IS NOT `file-actions-menu.tsx`: that component is a path-only menu
 * with hardcoded English copy, and a Library asset is not always a path - a
 * generated image is a digest-only artifact with no Finder row behind it. This
 * menu keeps the same primitive and the same stopPropagation rule (the trigger
 * sits inside a selectable card) while carrying the library-specific actions:
 * provenance links, tag/metadata editing, and the two copy verbs.
 *
 * THE PROVENANCE ENTRIES ARE ONE PER OCCURRENCE. An asset seen in three
 * conversations is one row with three occurrences, so "Open source
 * conversation" is a submenu when there is more than one. The chat route has no
 * message-anchor parameter yet, so the link names the conversation; the
 * occurrence's `first_seq`/`last_seq` travel in the model for the surface that
 * gains one.
 */

import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
	Tooltip,
} from "@shared/components/ui";
import { t } from "@shared/i18n";
import { showErrorToast, showSuccessToast } from "@shared/utils/toast-manager";
import {
	ClipboardCopy,
	Download,
	Ellipsis,
	FolderOpen,
	Hash,
	Heart,
	MessagesSquare,
	Pencil,
	Tags,
} from "lucide-react";
import type { FC } from "react";
import type { DesktopLibraryAsset } from "../../../../../shared/desktop-control-contract";
import { saveAssetCopy } from "../library-download";

export type LibraryAssetMenuProps = {
	asset: DesktopLibraryAsset;
	/** Select the asset, then open the composer focused. */
	onAsk: () => void;
	onEditMetadata: () => void;
	onEditTags: () => void;
	onToggleFavorite: () => void;
	/** Open the chat route for one occurrence's conversation. */
	onOpenConversation: (sessionId: string) => void;
	/** Narrow the listing to one source conversation. */
	onFilterSession: (sessionId: string) => void;
	/**
	 * Where the trigger lives. The card overlays it on the thumbnail; the
	 * preview puts it in the action row. Only the class differs.
	 */
	triggerClassName?: string;
};

export const LibraryAssetMenu: FC<LibraryAssetMenuProps> = ({
	asset,
	onAsk,
	onEditMetadata,
	onEditTags,
	onToggleFavorite,
	onOpenConversation,
	onFilterSession,
	triggerClassName,
}) => {
	const copy = async (value: string, receipt: string) => {
		try {
			await navigator.clipboard.writeText(value);
			showSuccessToast(receipt);
		} catch {
			showErrorToast(t("ui.library.menu.copy_failed"));
		}
	};

	const saveCopy = async () => {
		try {
			await saveAssetCopy(asset);
			showSuccessToast(t("ui.library.menu.saved_a_copy"));
		} catch {
			showErrorToast(t("ui.library.menu.save_failed"));
		}
	};

	const revealable = Boolean(asset.ref.type === "path" && asset.ref.path);
	const occurrences = asset.occurrences;

	return (
		<DropdownMenu>
			<Tooltip content={t("ui.library.menu.asset_actions")}>
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={t("ui.library.menu.asset_actions_label", {
							name: asset.name || asset.derived_name,
						})}
						className={triggerClassName}
						onClick={(event) => event.stopPropagation()}
						data-library-asset-menu=""
					>
						<Ellipsis aria-hidden="true" />
					</Button>
				</DropdownMenuTrigger>
			</Tooltip>
			<DropdownMenuContent
				align="end"
				className="min-w-52"
				onClick={(event) => event.stopPropagation()}
			>
				{occurrences.length === 1 ? (
					<DropdownMenuItem
						onSelect={() => onOpenConversation(occurrences[0].session_id)}
					>
						<MessagesSquare aria-hidden="true" />
						<span>{t("ui.library.menu.open_source_conversation")}</span>
					</DropdownMenuItem>
				) : occurrences.length > 1 ? (
					<DropdownMenuSub>
						<DropdownMenuSubTrigger>
							<MessagesSquare aria-hidden="true" />
							<span>{t("ui.library.menu.open_source_conversation")}</span>
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent className="min-w-60">
							{occurrences.map((occurrence) => (
								<DropdownMenuItem
									key={`${occurrence.session_id}:${occurrence.first_seq}`}
									onSelect={() => onOpenConversation(occurrence.session_id)}
								>
									<span className="truncate">
										{occurrence.session_title || occurrence.session_id}
									</span>
								</DropdownMenuItem>
							))}
						</DropdownMenuSubContent>
					</DropdownMenuSub>
				) : null}
				<DropdownMenuItem onSelect={onAsk}>
					<MessagesSquare aria-hidden="true" />
					<span>{t("ui.library.menu.ask_about_asset")}</span>
				</DropdownMenuItem>
				{occurrences.length > 0 && (
					<DropdownMenuItem
						onSelect={() => onFilterSession(occurrences[0].session_id)}
					>
						<FolderOpen aria-hidden="true" />
						<span>{t("ui.library.menu.show_from_conversation")}</span>
					</DropdownMenuItem>
				)}
				<DropdownMenuSeparator />
				<DropdownMenuItem onSelect={onToggleFavorite}>
					{/* The user's favourite is a HEART; the star is reserved for the
					    librarian's `highlighted` (see the card's own marks). */}
					<Heart
						aria-hidden="true"
						className={asset.favorite ? "fill-current text-accent" : undefined}
					/>
					<span>
						{asset.favorite
							? t("ui.library.menu.unfavorite")
							: t("ui.library.menu.favorite")}
					</span>
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={onEditMetadata}>
					<Pencil aria-hidden="true" />
					<span>{t("ui.library.menu.edit_metadata")}</span>
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={onEditTags}>
					<Tags aria-hidden="true" />
					<span>{t("ui.library.menu.edit_tags")}</span>
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				{asset.ref.path ? (
					<DropdownMenuItem
						onSelect={() =>
							void copy(
								asset.ref.path as string,
								t("ui.library.menu.path_copied"),
							)
						}
					>
						<ClipboardCopy aria-hidden="true" />
						<span>{t("ui.library.menu.copy_path")}</span>
					</DropdownMenuItem>
				) : null}
				<DropdownMenuItem
					onSelect={() =>
						void copy(asset.id, t("ui.library.menu.asset_id_copied"))
					}
				>
					<Hash aria-hidden="true" />
					<span>{t("ui.library.menu.copy_asset_id")}</span>
				</DropdownMenuItem>
				{revealable ? (
					<DropdownMenuItem
						onSelect={() => {
							if (asset.ref.path) window.api.showItemInFolder(asset.ref.path);
						}}
					>
						<FolderOpen aria-hidden="true" />
						<span>{t("ui.library.menu.reveal_in_finder")}</span>
					</DropdownMenuItem>
				) : (
					<DropdownMenuItem onSelect={() => void saveCopy()}>
						<Download aria-hidden="true" />
						<span>{t("ui.library.menu.download")}</span>
					</DropdownMenuItem>
				)}
				{/* A digest-only artifact has no Finder row and no session file id;
				    the content route's attachment disposition is the honest copy. */}
				{asset.ref.type === "artifact" && (
					<DropdownMenuItem onSelect={() => void saveCopy()}>
						<Download aria-hidden="true" />
						<span>{t("ui.library.menu.save_a_copy")}</span>
					</DropdownMenuItem>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
};
