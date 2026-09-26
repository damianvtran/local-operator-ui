import brandMark from "@assets/brand-mark.png";
import { cn } from "@shared/lib/utils";
import type { CSSProperties, FC } from "react";

/**
 * The app's mark IN ITS BUBBLE: a filled disc with the figure knocked out of it,
 * which is the shape of the app icon itself (`resources/icon.png`).
 *
 * WHY THE BUBBLE AND NOT THE BARE GLYPH. Design round 1's N2 replaced the sidebar's
 * icon with the bare line figure because the packaged icon is a near-WHITE disc -
 * the brightest object in a dark column. The operator's call on the preview
 * (2026-09-24) was the other half of that trade: "have the version of the icon in
 * the bubble not on its own, I think that looks better". So the disc comes back,
 * and N2's complaint is answered by where its COLOUR comes from rather than by
 * dropping the shape: the disc is painted with an ink ROLE (`tone`), never with a
 * fixed white, so it reads at the weight of the text beside it in every one of the
 * 59 palettes (light on the dark palettes, dark on the light ones - which is the
 * packaged icon's own dark/light pair).
 *
 * HOW, AND THE CONSTRAINT THAT DECIDES IT. Two mask layers composited with
 * `exclude`: a full-box layer (the disc, clipped round by `rounded-full`) minus the
 * figure (`brand-mark.png`, the same trimmed artwork the bare glyph used). The
 * figure is therefore a HOLE, and whatever ground the mark sits on shows through it
 * - `surface` in the sidebar, `canvas` on the empty state - with no second colour
 * to choose per surface and no per-theme asset. A two-element version (a disc span
 * with a masked span inside it) would need the figure painted in the ground's role,
 * which is a different role at each call site and wrong the moment the mark sits
 * on a selected or hovered row. `mask-composite` is standard in the Chromium this
 * app pins (Electron 44), and the `-webkit-` spelling is `xor` for the same
 * operation.
 *
 * THE FIGURE'S SCALE is the packaged icon's: the figure's bounding box is 507 of
 * the disc's 1024 px (measured with `magick ... -format %@`), so it is drawn at
 * 50% of the disc's height and centred, which keeps the mark recognisably the app
 * icon rather than a new drawing of it.
 *
 * ONE COMPONENT for every place the mark leads a surface (the sidebar's brand row,
 * its collapsed 56px strip, and the empty chat's greeting), so the three cannot
 * drift into three treatments - which is what they were before this file: a mask
 * over `bg-ink` in the sidebar and a copy of the same inline style over
 * `bg-ink-muted` in the composer.
 */
type BrandMarkProps = {
	/** Tailwind size class for the disc, e.g. `size-6`. */
	className?: string;
	/**
	 * The ink role that paints the disc. `ink` where the mark sits beside the
	 * wordmark at text weight; `ink-muted` where it is decoration above a greeting
	 * that carries the screen's loudest ink (§H).
	 */
	tone?: "ink" | "ink-muted";
	/**
	 * The accessible name, or none. Unnamed marks are `aria-hidden`: every current
	 * site has visible text beside it that already says "Local Operator" or means it.
	 */
	label?: string;
};

const TONE_CLASS: Record<NonNullable<BrandMarkProps["tone"]>, string> = {
	ink: "bg-ink",
	"ink-muted": "bg-ink-muted",
};

/*
 * Static, so every render hands React the same object: the mask never changes
 * with props, only the disc's size and fill do.
 */
const DISC_MINUS_FIGURE: CSSProperties = {
	maskImage: `linear-gradient(#000, #000), url(${brandMark})`,
	WebkitMaskImage: `linear-gradient(#000, #000), url(${brandMark})`,
	maskSize: "100% 100%, auto 50%",
	WebkitMaskSize: "100% 100%, auto 50%",
	maskRepeat: "no-repeat",
	WebkitMaskRepeat: "no-repeat",
	maskPosition: "center",
	WebkitMaskPosition: "center",
	maskComposite: "exclude",
	WebkitMaskComposite: "xor",
};

export const BrandMark: FC<BrandMarkProps> = ({
	className,
	tone = "ink",
	label,
}) => (
	<span
		role={label ? "img" : undefined}
		aria-label={label}
		aria-hidden={label ? undefined : true}
		data-brand-mark=""
		className={cn(
			"inline-block shrink-0 rounded-full",
			TONE_CLASS[tone],
			className,
		)}
		style={DISC_MINUS_FIGURE}
	/>
);
