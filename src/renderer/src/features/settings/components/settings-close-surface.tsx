/**
 * The Settings page's close affordances: the pinned button, and the Esc scope
 * that lives as long as the page does.
 *
 * WHY ONE COMPONENT. The button and Esc must land on the SAME action, and the
 * guards that decide whether Esc is the page's to take belong to the same box
 * the press bubbles through. Splitting them across the page's JSX would let the
 * next edit change one and not the other; `useCloseSettings` is the one action
 * and `useSettingsEscapeClose` is the one predicate.
 *
 * WHERE THE ESC SCOPE SITS, AND WHY NOT HERE. It is a document listener, not an
 * `onKeyDown` on this column: the round-1 reviews measured Esc dead from the
 * gear, a rail row and `<body>`, which are the page's normal focus states
 * (R1/D1/U1/Q-1). The predicate is target-based, so the listener can live where
 * focus is without weakening any owner's claim; see `settings-escape.ts`.
 *
 * WHERE THE BUTTON SITS, AND WHY IT IS ABSOLUTE. Settings renders inside the
 * shared inset (`WorkspaceFrame variant="full-height"`), whose
 * `data-workspace-safe-content` column already pays the top clearance below
 * the window-controls strip. `SettingsCloseColumn` below is the box inside that
 * clearance, beside the one scroller, so its top IS the scroller's top: a
 * button placed in the scrolling flow would scroll away with the page, so it is
 * pinned to this box's top inline-end corner, 16px in on both axes - level
 * with the search field, the first visible row (the compact page header is
 * screen-reader only), because the scroller pads by a flat `py-4`.
 *
 * Before the inset rollout (#2067 on main) the column owned its ground from y0
 * with `panel-top-pad`, and the offsets had to add `--panel-top-pad` back in
 * because an absolutely positioned child does not inherit its parent's
 * padding. Inside the frame that clearance is above this box, so adding it here
 * would push the button a whole strip below the search field.
 *
 * RTL is free: the offset is `end-4`, and the X glyph is symmetric. Windows and
 * Linux are free too, by a different mechanism: their caption buttons draw into
 * the client area's top 40px, and every non-chat route gets `data-chrome-route-
 * band` above its columns there (`app.tsx`), so this column starts below them -
 * and a Linux layout with LEADING controls turns that same 40px into the
 * column's own `--panel-top-pad`.
 */
import { BrowserSafeTooltip } from "@shared/components/ui/browser-safe-tooltip";
import { useCloseSettings } from "@shared/hooks/use-settings-route";
import { t } from "@shared/i18n";
import { X } from "lucide-react";
import type { FC, ReactNode } from "react";
import { useSettingsEscapeClose } from "../settings-escape";

export const SettingsCloseButton: FC = () => {
	const closeSettings = useCloseSettings();
	return (
		<div className="pointer-events-none absolute end-4 top-4 z-10">
			<BrowserSafeTooltip
				content={t(
					"ui.settings.navigation.settings_page.close_settings_shortcut",
				)}
				/* Left, not below: a panel under the glyph covered the search
				   field's top-right corner at every width (design round 1, D4). */
				side="left"
				align="end"
			>
				<button
					type="button"
					data-settings-close=""
					onClick={closeSettings}
					aria-label={t("ui.settings.navigation.settings_page.close_settings")}
					aria-keyshortcuts="Escape"
					className="pointer-events-auto flex size-8 items-center justify-center rounded-sm text-ink-muted transition-colors duration-fast ease-out-quart hover:bg-row-hover hover:text-ink"
				>
					<X size={16} aria-hidden="true" />
				</button>
			</BrowserSafeTooltip>
		</div>
	);
};

/**
 * The column's chrome: the pinned button and the Esc scope, adding no box of
 * its own. Rendered by `SettingsCloseColumn`, which supplies the containing
 * block.
 */
export const SettingsCloseChrome: FC = () => {
	const closeSettings = useCloseSettings();
	useSettingsEscapeClose(closeSettings);
	return <SettingsCloseButton />;
};

/**
 * The box the close chrome is pinned in, shared by the populated page and the
 * three page-level states (loading, error, no config) so the X and Esc exist in
 * every state and never move when the config arrives (#2067 rounds 1-2:
 * D2, D7/M5).
 *
 * WHY IT CARRIES NO PAD AND NO GROUND. Settings sits inside `WorkspaceFrame
 * variant="full-height"`, which owns the `canvas-content` ground and the even
 * inset, and the `data-workspace-safe-content` column around this box owns the
 * top clearance. A second `panel-top-pad` or `canvas-content` marker here would
 * double-stack both; `scripts/lane-leading.test.mjs` forbids that. `relative`
 * is the button's containing block; the page's one scroller is this box's
 * child, never its parent, so the button stays pinned and there is no second
 * scroll region.
 */
export const SettingsCloseColumn: FC<{ children: ReactNode }> = ({
	children,
}) => (
	<div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
		<SettingsCloseChrome />
		{children}
	</div>
);
