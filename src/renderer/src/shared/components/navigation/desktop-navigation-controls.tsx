import { sidebarToggleCap } from "@features/chat/chat-sidebar-layout";
import { paletteDoorLabel } from "@features/command-palette/palette-shortcut";
import { Button, Tooltip } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { isolateLtr } from "@shared/i18n/isolate-ltr";
import { ShortcutText } from "@shared/i18n/shortcut-text";
import { useTextDirection } from "@shared/i18n/use-document-direction";
import { useI18nLocale } from "@shared/i18n/use-locale";
import {
	MAC_PLATFORM,
	navigationShortcutLabel,
} from "@shared/navigation-gesture";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import {
	ArrowLeft,
	ArrowRight,
	PanelLeft,
	PanelRight,
	Search,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useDesktopNavigationAvailability } from "./desktop-navigation-router";

export function DesktopNavigationControls({
	expanded,
	routeOwnsSidebar,
	toggleSidebar,
}: {
	expanded: boolean;
	routeOwnsSidebar: boolean;
	toggleSidebar: () => void;
}) {
	useI18nLocale();
	const rtl = useTextDirection() === "rtl";
	const isMac = MAC_PLATFORM.test(navigator.platform);
	const navigate = useNavigate();
	const { canBack, canForward } = useDesktopNavigationAvailability();
	const backLabel = t("ui.browser.browser_url_bar.back");
	const forwardLabel = t("ui.browser.browser_url_bar.forward");
	const sidebarLabel = expanded
		? t("ui.shell.sidebar_navigation.collapse_sidebar")
		: t("ui.shell.sidebar_navigation.expand_sidebar");
	const primary = isMac ? "Meta" : "Control";
	const sidebarChord = isolateLtr(sidebarToggleCap(isMac));
	const backChord = isolateLtr(navigationShortcutLabel("back", isMac));
	const forwardChord = isolateLtr(navigationShortcutLabel("forward", isMac));
	const paletteChords = {
		everything: isolateLtr(paletteDoorLabel("everything", isMac)),
		chats: isolateLtr(paletteDoorLabel("chats", isMac)),
	};
	const Sidebar = rtl ? PanelRight : PanelLeft;
	const Back = rtl ? ArrowRight : ArrowLeft;
	const Forward = rtl ? ArrowLeft : ArrowRight;
	const style =
		"size-7 shrink-0 text-ink-muted aria-disabled:text-ink-disabled aria-disabled:hover:bg-transparent";

	// Keep endpoints focusable: a keyboard user who reaches either end must
	// not have focus thrown into the route that just mounted underneath them.
	// These tips sit over shell/Browser chrome, above the native browser body.
	return (
		<div data-desktop-navigation="" data-titlebar-no-drag="">
			<Tooltip
				content={
					routeOwnsSidebar ? (
						sidebarLabel
					) : (
						<ShortcutText text={`${sidebarLabel} (${sidebarChord})`} />
					)
				}
			>
				<Button
					variant="ghost"
					size="icon-sm"
					className={style}
					type="button"
					data-desktop-sidebar-toggle=""
					aria-label={sidebarLabel}
					aria-expanded={expanded}
					aria-disabled={routeOwnsSidebar}
					aria-keyshortcuts={routeOwnsSidebar ? undefined : `${primary}+B`}
					onClick={() => {
						if (!routeOwnsSidebar) toggleSidebar();
					}}
				>
					<Sidebar aria-hidden="true" />
				</Button>
			</Tooltip>
			<Tooltip content={<ShortcutText text={`${backLabel} (${backChord})`} />}>
				<Button
					variant="ghost"
					size="icon-sm"
					className={style}
					type="button"
					data-desktop-back=""
					aria-label={backLabel}
					aria-keyshortcuts={`${primary}+[`}
					aria-disabled={!canBack}
					onClick={() => {
						if (canBack) navigate(-1);
					}}
				>
					<Back aria-hidden="true" />
				</Button>
			</Tooltip>
			<Tooltip
				content={<ShortcutText text={`${forwardLabel} (${forwardChord})`} />}
			>
				<Button
					variant="ghost"
					size="icon-sm"
					className={style}
					type="button"
					data-desktop-forward=""
					aria-label={forwardLabel}
					aria-keyshortcuts={`${primary}+]`}
					aria-disabled={!canForward}
					onClick={() => {
						if (canForward) navigate(1);
					}}
				>
					<Forward aria-hidden="true" />
				</Button>
			</Tooltip>
			<Tooltip
				content={
					<ShortcutText
						text={t(
							"ui.shell.sidebar_navigation.search_tooltip",
							paletteChords,
						)}
					/>
				}
			>
				<Button
					variant="ghost"
					size="icon-sm"
					className={style}
					type="button"
					data-command-palette-trigger=""
					aria-label={t(
						"ui.shell.sidebar_navigation.search_accessible",
						paletteChords,
					)}
					aria-keyshortcuts={isMac ? "Meta+P" : "Control+P"}
					onClick={() => useUiPreferencesStore.getState().openCommandPalette()}
				>
					<Search aria-hidden="true" />
				</Button>
			</Tooltip>
		</div>
	);
}
