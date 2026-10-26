/**
 * The file actions ONE callout shares between its row and its thumbnail tile.
 *
 * The row grammar and the image grid are two presentations of one file set, so
 * they must offer the same doors (canvas open / OS open / reveal / path copy)
 * through ONE implementation: a second copy of the resolution seam or of the
 * item list beside the first is the defect `image-actions-menu.tsx` names for
 * its own sibling pair ("the shell ... is the established one, so two menus in
 * one transcript cannot drift apart"), applied here inside one block.
 *
 * `withTarget` is the row's original resolution seam, unchanged: journal paths
 * stay portable until an action is chosen, and every action resolves against
 * the session's cwd through `probeFiles` before it runs — a failed probe is the
 * app's own refusal toast, never an unrooted path (see `file-kind.ts`'s
 * "resolve only at the action boundary" note in `supplement-row.tsx`).
 *
 * THE OVERLAY TRIGGER exists because a tile carries this menu over ARBITRARY
 * PICTURE PIXELS. The bare ellipsis the row draws was measured illegible there
 * (1.63:1 light over a dark picture, 1.81:1 inverse); the tile's trigger is
 * therefore the floored chip `image-actions-menu.tsx` established — `inkMuted`
 * on `accentWash`, asserted in `scripts/contrast-contract.mjs` ("image actions
 * trigger"), with the contract site pinned for this file too. The REVEAL (hover
 * / focus / open) belongs to the surface that owns it: the row's group or the
 * tile's overlay wrapper.
 */

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
import { showErrorToast } from "@shared/utils/toast-manager";
import {
	ClipboardCopy,
	Ellipsis,
	File as FileIcon,
	FileImage,
	FileSpreadsheet,
	FileText,
	FolderOpen,
	LayoutGrid,
} from "lucide-react";
import { memo, useCallback, useState } from "react";
import type { CanvasPane } from "../utils/canvas-pane";
import { fileKind } from "../utils/file-kind";
import { openLocalTarget, revealLocalTarget } from "../utils/link-open";
import { opensInCanvas } from "../utils/open-in-canvas";

/** The type glyph for one callout row, from the shared file classifier. */
export function FileGlyph({ path }: { path: string }) {
	const kind = fileKind(path);
	switch (kind) {
		case "image":
			return <FileImage aria-hidden="true" className="size-3.5 shrink-0" />;
		case "spreadsheet":
			return (
				<FileSpreadsheet aria-hidden="true" className="size-3.5 shrink-0" />
			);
		case "markdown":
		case "text":
		case "document":
			return <FileText aria-hidden="true" className="size-3.5 shrink-0" />;
		default:
			return <FileIcon aria-hidden="true" className="size-3.5 shrink-0" />;
	}
}

/** Whether this pane can show this path at all (the shared predicate). */
function opened(pane: CanvasPane | null, path: string): boolean {
	try {
		return opensInCanvas(pane, path);
	} catch {
		return false;
	}
}

/**
 * The per-file action plumbing both presentations share: the resolution seam
 * (`withTarget`), the canvas-first press, and the pane's own verdict on whether
 * "Open in canvas" may be offered.
 */
export function useFileTargets(
	actionPath: string,
	cwd?: string | null,
	pane?: CanvasPane | null,
) {
	/*
	 * Journal paths deliberately retain their portable spelling. Resolve only at
	 * the action boundary, using the session's cwd (never Electron's launch cwd).
	 * Every action consumes the same main-process identity seam, including the
	 * disclosure tail; a failed probe must not fall back to an unrooted path.
	 */
	const withTarget = useCallback(
		async (action: (path: string) => unknown) => {
			try {
				const [file] = await window.api.probeFiles(
					[actionPath],
					cwd ?? undefined,
				);
				if (!file?.resolved.startsWith("/")) {
					throw new Error("File path has no session working directory");
				}
				await action(file.resolved);
			} catch {
				showErrorToast(t("ui.chat.highlights.file_resolution_failed"));
			}
		},
		[actionPath, cwd],
	);
	const canOpenInCanvas = opened(pane ?? null, actionPath);
	const press = useCallback(() => {
		void withTarget(async (path) => {
			if (canOpenInCanvas && pane && (await pane.openInCanvas(path))) return;
			await openLocalTarget(path);
		});
	}, [withTarget, canOpenInCanvas, pane]);
	return { canOpenInCanvas, press, withTarget };
}

export type FileActionsMenuProps = {
	/** The REAL path every action uses; see `useFileTargets`. */
	actionPath: string;
	/** What to call this file in the trigger's accessible name. */
	label: string;
	cwd?: string | null;
	pane?: CanvasPane | null;
	/**
	 * The trigger a tile wears rather than the row's: the floored chip described
	 * in this module's header, for a menu floating over picture pixels.
	 */
	overlay?: boolean;
};

/**
 * The one file-actions menu: trigger plus the four entries, riding the app's
 * existing file plumbing (`withTarget`'s probe + the IPC open/reveal doors)
 * rather than a second implementation.
 */
export const FileActionsMenu = memo(function FileActionsMenu({
	actionPath,
	label,
	cwd,
	pane,
	overlay = false,
}: FileActionsMenuProps) {
	useI18nLocale();
	const { canOpenInCanvas, withTarget } = useFileTargets(actionPath, cwd, pane);
	const [copied, setCopied] = useState(false);
	const ariaLabel = `Actions for ${label || "this file"}`;
	return (
		<DropdownMenu>
			<Tooltip content="File actions">
				<DropdownMenuTrigger asChild={true}>
					{overlay ? (
						/*
						 * The same chip `image-actions-menu.tsx` measured and set for a
						 * trigger over arbitrary picture pixels (`bg-accent-wash` on the
						 * ghost button): the bare ellipsis failed the 3:1 icon floor over
						 * a dark picture (1.63:1 measured), and this pair is the one the
						 * contrast contract asserts ("image actions trigger").
						 */
						<Button
							variant="ghost"
							size="icon-sm"
							className="bg-accent-wash"
							aria-label={ariaLabel}
						>
							<Ellipsis aria-hidden="true" />
						</Button>
					) : (
						<button
							type="button"
							className="flex size-6 shrink-0 items-center justify-center text-ink-dim opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
							aria-label={ariaLabel}
						>
							<Ellipsis aria-hidden="true" className="size-3.5" />
						</button>
					)}
				</DropdownMenuTrigger>
			</Tooltip>
			<DropdownMenuContent align="end" className="min-w-45">
				{canOpenInCanvas && (
					<DropdownMenuItem
						onSelect={() => {
							void withTarget((path) => pane?.openInCanvas(path));
						}}
					>
						<LayoutGrid aria-hidden="true" />
						<span>
							{t("ui.chat.canonical.supplement.file_actions.open_in_canvas")}
						</span>
					</DropdownMenuItem>
				)}
				<DropdownMenuItem
					onSelect={() => {
						void withTarget(openLocalTarget);
					}}
				>
					<FileIcon aria-hidden="true" />
					<span>
						{t("ui.chat.canonical.supplement.file_actions.open_in_default_app")}
					</span>
				</DropdownMenuItem>
				<DropdownMenuItem
					onSelect={() => {
						void withTarget(revealLocalTarget);
					}}
				>
					<FolderOpen aria-hidden="true" />
					<span>
						{t("ui.chat.canonical.supplement.file_actions.reveal_in_finder")}
					</span>
				</DropdownMenuItem>
				<DropdownMenuItem
					onSelect={() => {
						void navigator.clipboard
							.writeText(actionPath)
							.then(() => setCopied(true))
							.catch(() =>
								showErrorToast(t("ui.notices.files.copy_path_failed")),
							);
					}}
				>
					<ClipboardCopy aria-hidden="true" />
					<span>{copied ? "Copied" : "Copy file path"}</span>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
});
