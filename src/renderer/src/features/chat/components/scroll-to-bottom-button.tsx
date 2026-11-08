import { Button } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { ArrowDown } from "lucide-react";
import { useCallback } from "react";
import type { FC } from "react";

/**
 * Props for the ScrollToBottomButton component
 */
type ScrollToBottomButtonProps = {
	/**
	 * Whether the button should be visible
	 */
	visible: boolean;

	/**
	 * Callback function to scroll to the bottom
	 */
	onClick: () => void;

	/**
	 * Optional className for additional styling
	 */
	className?: string;

	/**
	 * True when messages arrived while the reader was scrolled up. The
	 * button grows a label so the reader learns there is something new
	 * without the transcript moving under them.
	 */
	hasNewActivity?: boolean;
};

/**
 * ScrollToBottomButton Component
 *
 * A minimal floating button that appears when the user scrolls up in chat.
 *
 * The button is positioned absolutely within its container, allowing it to
 * move with the container rather than being fixed on the screen.
 */
export const ScrollToBottomButton: FC<ScrollToBottomButtonProps> = ({
	visible,
	onClick,
	className,
	hasNewActivity = false,
}) => {
	useI18nLocale();
	const handleClick = useCallback(() => {
		onClick();
	}, [onClick]);

	return (
		<div
			/*
			 * ANCHORED TO THE COMPOSER'S TOP EDGE, which is the whole of D15 (chat
			 * redesign §G5). It used to be placed by a `bottom` DISTANCE from whatever
			 * ancestor happened to be positioned - 160px, or 120 in the small view - and
			 * that number is the defect: a composer whose height is a function of its
			 * content (a staged attachment, a reply preview, eight lines of prose) is
			 * taller than the constant as soon as it grows, so the disc landed ON the
			 * attachment row and on the control row in the frames the round measured.
			 *
			 * `bottom-full` puts the wrapper's bottom edge on its container's TOP edge,
			 * so the disc is above the panel at every height, with no measurement and no
			 * constant to drift; `mb-3` is §G5's 12px step. The container is the
			 * composer's own anchoring wrapper (`message-input.tsx`, the `relative`
			 * element the popups anchor to as well), so the composer is the floor and
			 * the disc can never be inside it.
			 */
			data-lo-scroll-to-bottom=""
			className={cn(
				"pointer-events-none absolute end-3 bottom-full z-40 mb-3 flex items-center justify-end",
				"transition-opacity duration-base ease-out-quart",
				visible ? "opacity-100" : "opacity-0",
				className,
			)}
			aria-hidden={!visible}
		>
			{/*
			 * `tonal`, not `secondary` (QA round 2, Q3). This control is itself a
			 * floating surface - it leaves the flow over moving text, wears the one
			 * shadow and carries the marker - so it separates by ground and shadow
			 * like every other floating panel, never by a stroke; `secondary` drew a
			 * 1px `border-control` ring. The ground is `bg-elevated`, overriding
			 * `tonal`'s `bg-sunken` (twMerge keeps the last `bg-*`; the variant's
			 * hover `surface` / pressed `hairline` ramp is untouched). `tonal`'s
			 * sunken face was designed for a button on an `elevated` panel; this
			 * disc floats over `canvas`, where sunken sits darker than the ground at
			 * 1.06:1 and read as a hole, not a control (design round 3, D10).
			 * `elevated` lifts it lighter than the ground, like its sibling floating
			 * surfaces. It deliberately carries no `data-glass-overlay`: that rule is
			 * unlayered and sets `background-color`, so on glass it would erase the
			 * hover/press ramp. It stays opaque `elevated` on glass and is named in
			 * `DEFERRED_PANELS` (`glass-overlay.test.mjs` O-7) instead. Under forced colors, where the shadow is dropped, the
			 * `[data-lo-floating]` rule in `styles/index.css` gives it its CanvasText
			 * edge.
			 */}
			<Button
				variant="tonal"
				size={hasNewActivity ? "sm" : "icon"}
				data-lo-floating=""
				className={cn(
					"rounded-full bg-elevated shadow-overlay",
					/*
					 * Pointer events follow VISIBILITY here, not the wrapper.
					 *
					 * The wrapper above disables them (`pointer-events-none`) and this button
					 * re-enabled them unconditionally, which is the right thing for the visible
					 * state and a trap for the invisible one: hit-testing ignores opacity, so
					 * hidden the button was a real 32x32 target sitting somewhere over the
					 * transcript. Where it sat was wherever `bottomDistance` put it, and in this
					 * component's own use that band is the composer: at the column floor the
					 * composer's status row lands on it, and `elementFromPoint` at the goal
					 * chip's centre answered "Scroll to bottom" - pressing the chip there did
					 * nothing at all, in the width this row was designed for (QA round 1, Q1;
					 * the same hidden button also covered part of the expanded goal body at
					 * the wide column).
					 *
					 * `invisible` on the wrapper was the other candidate and is rejected: the
					 * wrapper fades out (`transition-opacity`), and `visibility: hidden` takes
					 * effect immediately, so the fade would be replaced by a pop. The pointer
					 * switch is the half that matters: seconds after the state changes, the
					 * fading control is not something the user is aiming at.
					 *
					 * The same hidden control is also what made the completion receipt
					 * fragile before it was fixed in the probe: `elementFromPoint` at the
					 * last row's bottom edge answered "Scroll to bottom", so an unread
					 * completion refused to clear for as long as the conversation stayed
					 * open. Both halves are needed -- the overlay was a bug and the
					 * single-sample probe was fragile about it.
					 */
					visible ? "pointer-events-auto" : "pointer-events-none",
				)}
				aria-label={
					hasNewActivity
						? t("ui.chat.scroll_to_bottom.label_new_activity")
						: t("ui.chat.scroll_to_bottom.label")
				}
				onClick={handleClick}
				tabIndex={visible ? 0 : -1}
			>
				<ArrowDown aria-hidden="true" />
				{hasNewActivity
					? t("ui.chat.page_chrome.scroll_to_bottom.new_activity")
					: null}
			</Button>
		</div>
	);
};
