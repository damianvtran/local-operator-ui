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
 * WHERE THE BUTTON SITS, AND WHY IT IS ABSOLUTE. The column owns its ground
 * from y0 (`panel-top-pad`, AGENTS.md "Panels run to the window edge"), and it
 * is rendered in `settings-page.tsx` - the box that wears the pad must be
 * visible beside the `panel-flush` root - so the button sits inside it, and the
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
import type { FC } from "react";
import { useSettingsEscapeClose } from "../settings-escape";

export const SettingsCloseButton: FC = () => {
	const closeSettings = useCloseSettings();
	return (
		<div className="pointer-events-none absolute end-4 top-[calc(var(--panel-top-pad,0px)_+_1rem)] z-10 sm:top-[calc(var(--panel-top-pad,0px)_+_1.5rem)] md:top-[calc(var(--panel-top-pad,0px)_+_2rem)]">
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
 * The column's chrome: the pinned button and the Esc scope. The COLUMN itself -
 * its ground marker, its `panel-top-pad` - lives in `settings-page.tsx` beside
 * the `panel-flush` root it belongs to, because a flush root pads nothing and
 * the pad has to be readable in the same file (the tree-wide guard
 * `scripts/lane-leading.test.mjs` exists for exactly that, and it caught this
 * split when the column lived here: round 4's merge gate). This component is
 * rendered inside that column and adds no box of its own.
 */
export const SettingsCloseChrome: FC = () => {
	const closeSettings = useCloseSettings();
	useSettingsEscapeClose(closeSettings);
	return <SettingsCloseButton />;
};
