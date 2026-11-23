/**
 * The Settings page's close affordances: the pinned button, and the Esc scope
 * that wraps the content column.
 *
 * WHY ONE COMPONENT. The button and Esc must land on the SAME action, and the
 * guards that decide whether Esc is the page's to take belong to the same box
 * the press bubbles through. Splitting them across the page's JSX would let the
 * next edit change one and not the other; `useCloseSettings` is the one action
 * and `useSettingsEscapeClose` is the one predicate.
 *
 * WHERE THE BUTTON SITS, AND WHY IT IS ABSOLUTE. The column owns its ground
 * from y0 (`panel-top-pad`, AGENTS.md "Panels run to the window edge"), and the
 * scroller inside it clips at the content edge. A button placed in the
 * scrolling flow would scroll away with the page, so it is pinned to the
 * column's top inline-end corner, 16px in, and level with the page's `h1`
 * (28px display, 1.2 line height). The three top offsets restate the scroller's
 * own responsive padding (`p-4 / sm:p-6 / md:p-8`) plus the window-controls
 * strip the column pads by - the one number an absolutely positioned child of a
 * padded box does NOT inherit.
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
		<div className="pointer-events-none absolute end-4 top-[calc(var(--panel-top-pad,0px)_+_1rem)] z-10 sm:top-[calc(var(--panel-top-pad,0px)_+_1.5rem)] md:top-[calc(var(--panel-top-pad,0px)_+_2rem)]">
			<BrowserSafeTooltip
				content={t(
					"ui.settings.navigation.settings_page.close_settings_shortcut",
				)}
				side="bottom"
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
 * The content column: its ground, its Esc scope, the button above it, and the
 * scroller the page passes in as children.
 */
export const SettingsContentSurface: FC<{ children: ReactNode }> = ({
	children,
}) => {
	const closeSettings = useCloseSettings();
	const onKeyDown = useSettingsEscapeClose(closeSettings);
	return (
		<div
			data-glass-region="canvas-content"
			/*
			 * THE CONTENT COLUMN OWNS ITS GROUND FROM y0 (operator, 2026-11-04:
			 * "a section above the settings in the titlebar area that isn't
			 * properly filled"). The root is `data-glass-split`, so under window
			 * glass the root and `<main>` paint nothing and `canvas-content` alone
			 * paints the canvas. That marker used to sit on the `panel-scroll`
			 * scroller, whose pad is a MARGIN - so the painted box began below the
			 * strip and the desktop showed through above it. The ground now lives
			 * on this full-height column, which pads with `panel-top-pad` (the box
			 * that wears the pad is the box that paints, AGENTS.md "Panels run to
			 * the window edge"), the same shape as Library and Agents. The scroller
			 * inside starts below the padding, so its clip is still the content
			 * edge and scrolled text never paints into the strip. `relative` is the
			 * close button's containing block.
			 */
			className="panel-top-pad relative flex min-h-0 min-w-0 flex-1 flex-col"
			onKeyDown={onKeyDown}
		>
			<SettingsCloseButton />
			{children}
		</div>
	);
};
