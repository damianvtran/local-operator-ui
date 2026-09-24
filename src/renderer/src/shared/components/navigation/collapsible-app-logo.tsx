import brandMark from "@assets/brand-mark.png";
import type { FC } from "react";

type CollapsibleAppLogoProps = {
	expanded: boolean;
};

/**
 * The application logo in the sidebar: mark alone when collapsed, mark plus
 * wordmark when expanded.
 *
 * Three things were deliberately dropped from the previous version rather than
 * translated. The `cursor: pointer` promised a click target that never existed
 * — the component has no handler and never had one. The accent `drop-shadow`
 * glow and the 1.5s `box-shadow` pulse on hover were a second, decorative use
 * of the accent on a surface that already spends it on the active nav item, and
 * the pulse's `rgba(var(--primary-rgb), …)` needed the primary colour parsed
 * out of hex at render time to exist at all. The `scale(1.12) rotate(5deg)`
 * hover went because nothing in this app lifts, scales or rotates on hover.
 *
 * What remains is a logo, which is all it ever needed to be. It carries no
 * padding or alignment of its own: the rail's header owns where it sits, which
 * is the only place that knows the rail is 48px tall and inset 20px.
 *
 * The mark is 24px and the wordmark is `text-body` — one step down from the
 * `text-heading` it was. A 32px mark beside a 16px semibold wordmark made the
 * header the heaviest thing on a rail whose job is to be quiet, and it sat two
 * steps above the 13px destinations underneath it.
 *
 * THE MARK IS THE LINE GLYPH, PAINTED IN INK, not the app icon (chat redesign,
 * design round 1, N2). The app icon is a near-white filled disc with the figure
 * drawn on it: on a dark sidebar that disc was the brightest object in the
 * column, brighter than any text, and on the light palettes it was a pale disc
 * on a pale ground. `brand-mark.png` is the same figure cut from the packaged
 * transparent artwork (`resources/local-operator-icon-2-dark-clear.png`,
 * trimmed and centred), used as a MASK over `bg-ink` - so it takes the
 * palette's own ink in every theme, reads at the wordmark's weight rather than
 * above it, and needs no per-theme asset.
 */
export const CollapsibleAppLogo: FC<CollapsibleAppLogoProps> = ({
	expanded,
}) => (
	<div className="flex min-w-0 items-center gap-2">
		{/* Named only when collapsed: expanded, the wordmark beside it already
		    says "Local Operator", and an alt text would announce it twice. */}
		<span
			role={expanded ? undefined : "img"}
			aria-label={expanded ? undefined : "Local Operator"}
			aria-hidden={expanded ? true : undefined}
			data-brand-mark=""
			className="size-6 shrink-0 bg-ink"
			style={{
				maskImage: `url(${brandMark})`,
				WebkitMaskImage: `url(${brandMark})`,
				maskSize: "contain",
				WebkitMaskSize: "contain",
				maskRepeat: "no-repeat",
				WebkitMaskRepeat: "no-repeat",
				maskPosition: "center",
				WebkitMaskPosition: "center",
			}}
		/>
		{expanded && (
			<span className="truncate font-semibold text-body text-ink">
				Local Operator
			</span>
		)}
	</div>
);
