import localOperatorIcon from "@assets/icon.png";
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
 */
export const CollapsibleAppLogo: FC<CollapsibleAppLogoProps> = ({
	expanded,
}) => (
	<div className="flex min-w-0 items-center gap-2">
		{/* Named only when collapsed: expanded, the wordmark beside it already
		    says "Local Operator", and an alt text would announce it twice. */}
		<img
			src={localOperatorIcon}
			alt={expanded ? "" : "Local Operator"}
			loading="eager"
			className="size-6 shrink-0"
		/>
		{expanded && (
			<span className="truncate font-semibold text-body text-ink">
				Local Operator
			</span>
		)}
	</div>
);
