import { useMediaQuery } from "@shared/hooks/use-media-query";
import { cn } from "@shared/lib/utils";
import { Info } from "lucide-react";
import { useEffect, useState } from "react";
import {
	COMPOSER_TIPS,
	TIP_ROTATE_INTERVAL_MS,
	advanceTipIndex,
	tipAt,
	tipRotationOrder,
} from "./composer-tips";

type Props = {
	/**
	 * Whether the composer holds a non-empty draft, in which case the clock is
	 * suspended and the current tip simply stays.
	 *
	 * The row keeps painting: hiding it would make the band's height move with
	 * what the user is typing, and the row is ambient rather than a claim about
	 * the draft. See the module comment for why the clock stops.
	 */
	suspended: boolean;
};

/**
 * The composer's ambient tip line: one fixed 20px row, immediately below the
 * composer box.
 *
 * Contract, in the module that owns the copy (`composer-tips.ts`): 12 s, one
 * line or none by WIDTH alone, not a control, no glyph of its own. What is
 * worth stating here is the two things that are properties of the RENDER rather
 * than of the copy.
 *
 * **The rotation is a text change on a slow timer, not an animation.** There is
 * no transition, no fade and no slide — and a fade would be worse than plain
 * motion: it would walk the sentence's ink down through the 4.5:1 floor in the
 * light brand palette mid-cycle, where `ink-dim` has only 0.45 of headroom.
 *
 * **The row is geometrically inert.** Its height is set by `h-5`, its content
 * never wraps (the `truncate` below is a backstop for the width arithmetic,
 * not the mechanism), and its presence is decided before it renders by the
 * caller's gate. So a tick cannot reflow the band, which is what stops a slow
 * timer from reading as motion.
 *
 * Not a control, and not announced: no `onClick`, no hover ground, no
 * `aria-live` and no `role="status"` — ordinary static text, in the register
 * the caller's container gives it.
 */
export const ComposerTipRow = ({ suspended }: Props) => {
	const [order] = useState(() => tipRotationOrder(COMPOSER_TIPS));
	const [index, setIndex] = useState(0);

	/*
	 * Read in JS because the thing being suppressed is a JS timer — exactly the
	 * case `use-media-query`'s docstring keeps the hook for. A `motion-reduce:`
	 * variant cannot stop an interval, and this row has no animation for one to
	 * cap in any case: the app's global cap (styles/index.css) is about
	 * durations, and a sentence that changes every 12 s is the kind of motion
	 * the preference exists to stop. So the answer the preference asks for here
	 * is different from the global cap's, and it is to not rotate at all: one
	 * entry is held for the life of the mount. Freezing a sentence strands
	 * nothing, because there is no keyframe to be stranded on.
	 */
	const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

	useEffect(() => {
		if (reduceMotion || suspended) return;
		const clock = window.setInterval(
			() => setIndex((current) => advanceTipIndex(current, order.length)),
			TIP_ROTATE_INTERVAL_MS,
		);
		return () => window.clearInterval(clock);
	}, [order, reduceMotion, suspended]);

	return (
		/*
		 * `data-lo-composer-tip` is the hook the geometry rig measures through
		 * (`scripts/composer-band-geometry.mjs`), on the same convention as
		 * `data-lo-composer-band` and `data-lo-suggestion-stack`: the row has no box
		 * of its own to see in a frame - it draws no border, no fill and no shadow -
		 * so its geometry is otherwise unreadable from a still, and every number the
		 * design record predicts about it would have to be taken on trust.
		 */
		<div
			data-lo-composer-tip={true}
			className={cn("flex h-5 items-center gap-1.5")}
		>
			{/*
			 * 12px is the size the icon ramp permits at an ink this quiet, and it
			 * is an existing call shape in the tree (app-updates-section.tsx:237).
			 * The stroke weight is lucide's default and is deliberately not
			 * restated: one pen at every size.
			 */}
			<Info size={12} aria-hidden="true" className="shrink-0 text-ink-dim" />
			<span className="truncate text-body-sm text-ink-dim">
				{tipAt(order, index)}
			</span>
		</div>
	);
};
