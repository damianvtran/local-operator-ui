import { BrandMark } from "@shared/components/common/brand-mark";
import { memo, useLayoutEffect, useRef } from "react";
import { trackNewChatHorizon } from "./new-chat-horizon-motion";
import "./new-chat-horizon.css";

/*
 * MEMOIZED because its parent, the composer, re-renders on every keystroke
 * while this splash is up, and these three booleans do not change with the
 * text. Without it each keypress re-rendered the canvas host and the mark
 * (measured: `NewChatHorizon` and `BrandMark` once per keystroke) during the
 * very frames the helix is trying to paint.
 */
export const NewChatHorizon = memo(function NewChatHorizon({
	quiet,
	dimmed,
	suppressed,
}: {
	quiet: boolean;
	dimmed: boolean;
	suppressed: boolean;
}) {
	const scene = useRef<HTMLCanvasElement>(null);
	const controller = useRef<ReturnType<typeof trackNewChatHorizon>>(undefined);
	// Presentation updates must not tear down the controller: its one entrance
	// and permanent pressure fallback belong to the keyed draft, not an effect run.
	useLayoutEffect(
		() => () => {
			controller.current?.dispose();
			controller.current = undefined;
		},
		[],
	);
	useLayoutEffect(() => {
		if (controller.current) {
			controller.current.setPresentation(quiet, suppressed);
			return;
		}
		const canvas = scene.current;
		// The full splash is the input surface, not the measured content strip.
		// Paint before the first frame, even while that strip's ref is settling.
		const paper = canvas?.closest<HTMLElement>("[data-lo-composer-splash]");
		if (canvas && paper) {
			controller.current = trackNewChatHorizon(
				paper,
				canvas,
				quiet,
				import.meta.env?.DEV,
				suppressed,
			);
		}
	}, [quiet, suppressed]);

	return (
		<div
			aria-hidden="true"
			className="new-chat-horizon"
			data-lo-horizon-suppressed={suppressed ? "" : undefined}
		>
			<canvas
				className="new-chat-horizon__scene"
				data-quiet={dimmed ? "" : undefined}
				data-lo-horizon-motion="still"
				ref={scene}
			/>
			{/* Also the first-send driver's splash selector. Keep the canonical
			    mark stationary as the front and back strands cross around it. */}
			<span
				data-lo-empty-mark={suppressed ? undefined : ""}
				className="new-chat-horizon__mark relative flex"
			>
				<BrandMark className="size-10" tone="ink-muted" treatment="engraved" />
			</span>
		</div>
	);
});
