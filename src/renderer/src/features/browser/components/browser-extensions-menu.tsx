import {
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
} from "@shared/components/ui/dropdown-menu";
import { t } from "@shared/i18n";
import { Puzzle, Settings2, Store } from "lucide-react";
import type { FC } from "react";
import type { ExtensionSummary } from "../../../../../shared/browser-extensions";

/** The icon from the verified package, or a neutral glyph. Icons arrive as
 * bounded data: URLs from main, never a remote or chrome-extension:// URL. */
export const ExtensionIcon: FC<{
	extension: ExtensionSummary;
	size?: string;
}> = ({ extension, size = "size-4" }) =>
	extension.iconDataUrl ? (
		<img
			src={extension.iconDataUrl}
			alt=""
			aria-hidden
			className={`${size} shrink-0`}
		/>
	) : (
		<Puzzle aria-hidden className={`${size} shrink-0`} />
	);

export interface BrowserExtensionsSubmenuProps {
	extensions: ExtensionSummary[];
	onOpenPopup: (extension: ExtensionSummary) => void;
	onManage: () => void;
	onOpenStore: () => void;
}

/**
 * "Extensions" submenu of the page menu (design §4.3): one row per installed
 * extension, then Manage and the store. A row opens the extension's action
 * popup only when main reports one it can open (`hasPopup`: loaded, enabled,
 * declares a popup); otherwise the row is shown disabled so state stays visible
 * rather than hidden. Toolbar buttons/pinning are out of scope for v1.
 */
export const BrowserExtensionsSubmenu: FC<BrowserExtensionsSubmenuProps> = ({
	extensions,
	onOpenPopup,
	onManage,
	onOpenStore,
}) => (
	<DropdownMenuSub>
		<DropdownMenuSubTrigger data-tour-tag="browser-extensions-menu">
			<Puzzle aria-hidden className="size-4" />
			{t("ui.browser.extensions.menu_extensions")}
		</DropdownMenuSubTrigger>
		<DropdownMenuSubContent className="max-w-72">
			{extensions.length === 0 ? (
				<DropdownMenuItem disabled>
					{t("ui.browser.extensions.menu_none")}
				</DropdownMenuItem>
			) : (
				extensions.map((extension) => (
					<DropdownMenuItem
						key={extension.id}
						disabled={!extension.hasPopup}
						onSelect={() => onOpenPopup(extension)}
					>
						<ExtensionIcon extension={extension} />
						<span className="truncate">{extension.name}</span>
					</DropdownMenuItem>
				))
			)}
			<DropdownMenuSeparator />
			<DropdownMenuItem
				onSelect={onManage}
				data-tour-tag="browser-extensions-manage"
			>
				<Settings2 aria-hidden className="size-4" />
				{t("ui.browser.extensions.menu_manage")}
			</DropdownMenuItem>
			<DropdownMenuItem
				onSelect={onOpenStore}
				data-tour-tag="browser-extensions-store"
			>
				<Store aria-hidden className="size-4" />
				{t("ui.browser.extensions.menu_store")}
			</DropdownMenuItem>
		</DropdownMenuSubContent>
	</DropdownMenuSub>
);
