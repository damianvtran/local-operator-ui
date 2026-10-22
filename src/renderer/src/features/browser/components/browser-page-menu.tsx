import { Button, Tooltip } from "@shared/components/ui";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "@shared/components/ui/dropdown-menu";
import { t } from "@shared/i18n";
import { chordCaption } from "@shared/keymap/keymap-chord";
import {
	chordPlatform,
	navigationShortcutLabel,
} from "@shared/navigation-gesture";
import {
	ArrowRight,
	FolderOpen,
	Home,
	MoreHorizontal,
	Printer,
	Search,
	ShieldCheck,
} from "lucide-react";
import type { FC } from "react";
import { useState } from "react";

/**
 * The page menu: what is left after the address row became permanent.
 *
 * THE ROW IS THE CONTROL SURFACE (S5). Back, Forward, Reload/Stop, Home, the
 * field, Approvals and the site mark all live in the row, so repeating them here
 * would be two affordances for one action — the thing "conventional browser
 * chrome" exists to avoid. What remains is what has no row control: Find, Print,
 * Reset zoom when it is off 100%, the downloads folder when one is known, and
 * Approvals — which is also the way back to site access when nothing is pending
 * (the row's Approvals control is always present and opens the same list).
 *
 * FOLDED CONTROLS COME BACK HERE. In a narrow pane the row sheds Home (below
 * 360px) and then Forward (below 300px) — see `browser-surface.tsx`'s width
 * tiers — and this menu is where those two actions remain reachable. They are
 * rendered only when the row has actually folded them, so the menu never
 * duplicates something visible beside it.
 *
 * WHY IT HIDES THE PAGE: the panel is a `DropdownMenuContent`, whose primitive
 * registers a MEASURED pause in the policy (`src/renderer/src/shared/
 * browser-view-policy.ts`). The row's bottom edge is the page's top edge, so a
 * panel opening downward from the trigger necessarily intersects the native view
 * — and the view must yield or the menu is partly invisible. Measuring (rather
 * than an unconditional `useSuppressBrowserView` here) is what keeps the rule
 * honest for every other menu in the app, including ones wholly inside the
 * chrome band.
 */
export interface BrowserPageMenuProps {
	disabled: boolean;
	canGoForward: boolean;
	pageZoom: number;
	waitingCount: number;
	downloadsDir: string | null;
	/** True when the row has folded Forward into this menu (narrow pane). */
	showForward: boolean;
	/** True when the row has folded Home into this menu (narrow pane). */
	showHome: boolean;
	onForward: () => void;
	onHome: () => void;
	onFind: () => void;
	onPrint: () => void;
	onResetZoom: () => void;
	onOpenDownloads: () => void;
	onOpenApprovals: () => void;
}

export const BrowserPageMenu: FC<BrowserPageMenuProps> = ({
	disabled,
	canGoForward,
	pageZoom,
	waitingCount,
	downloadsDir,
	showForward,
	showHome,
	onForward,
	onHome,
	onFind,
	onPrint,
	onResetZoom,
	onOpenDownloads,
	onOpenApprovals,
}) => {
	const [open, setOpen] = useState(false);
	const platform = chordPlatform();
	// The pointer is the only way a mouse user meets Find, Print and Zoom, so
	// each row that HAS a chord says it (UX U6).
	const forward = navigationShortcutLabel("forward", platform === "mac");
	const find = chordCaption("primary+f", platform).glyph;
	const zoomReset = chordCaption("primary+0", platform).glyph;
	const folded = showForward || showHome;
	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<Tooltip content={t("ui.browser.browser_url_bar.page_menu")} side="top">
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						size="icon-sm"
						className="shrink-0"
						aria-label={t("ui.browser.browser_url_bar.page_menu")}
						disabled={disabled}
						data-tour-tag="browser-page-menu"
					>
						<MoreHorizontal aria-hidden className="size-4" />
					</Button>
				</DropdownMenuTrigger>
			</Tooltip>
			<DropdownMenuContent align="end" sideOffset={4}>
				{folded && (
					<>
						{showForward && (
							<DropdownMenuItem
								disabled={!canGoForward}
								onSelect={onForward}
								data-tour-tag="browser-page-menu-forward"
							>
								<ArrowRight aria-hidden className="size-4" />
								{t("ui.browser.browser_url_bar.forward")}
								<DropdownMenuShortcut>{forward}</DropdownMenuShortcut>
							</DropdownMenuItem>
						)}
						{showHome && (
							<DropdownMenuItem
								onSelect={onHome}
								data-tour-tag="browser-page-menu-home"
							>
								<Home aria-hidden className="size-4" />
								{t("ui.browser.browser_url_bar.home")}
							</DropdownMenuItem>
						)}
						<DropdownMenuSeparator />
					</>
				)}
				<DropdownMenuItem onSelect={onFind} data-tour-tag="browser-find">
					<Search aria-hidden className="size-4" />
					{t("ui.browser.browser_url_bar.find_in_page")}
					<DropdownMenuShortcut>{find}</DropdownMenuShortcut>
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={onPrint} data-tour-tag="browser-print">
					<Printer aria-hidden className="size-4" />
					{t("ui.browser.browser_url_bar.print_page")}
				</DropdownMenuItem>
				{pageZoom !== 1 && (
					<DropdownMenuItem onSelect={onResetZoom} data-tour-tag="browser-zoom">
						{t("ui.browser.browser_url_bar.page_zoom_reset", {
							zoom: Math.round(pageZoom * 100),
						})}
						<DropdownMenuShortcut>{zoomReset}</DropdownMenuShortcut>
					</DropdownMenuItem>
				)}
				{downloadsDir && (
					<DropdownMenuItem
						onSelect={onOpenDownloads}
						data-tour-tag="browser-downloads-folder"
					>
						<FolderOpen aria-hidden className="size-4" />
						{t("ui.browser.browser_file_transfer_row.open_downloads_folder")}
					</DropdownMenuItem>
				)}
				<DropdownMenuSeparator />
				<DropdownMenuItem
					onSelect={onOpenApprovals}
					data-tour-tag="browser-approvals"
				>
					<ShieldCheck aria-hidden className="size-4" />
					{waitingCount > 0
						? t("ui.browser.browser_url_bar.approvals_waiting", {
								count: waitingCount,
							})
						: t("ui.browser.chrome.approvals")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
};
