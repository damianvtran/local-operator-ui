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
	paperSelector = "[data-lo-composer-splash]",
}: {
	quiet: boolean;
	dimmed: boolean;
	suppressed: boolean;
	/**
	 * The ancestor that is the helix's "paper": the surface whose pointer moves
	 * steer it and whose size it measures. The composer splash by default; the
	 * first-run stage passes `[data-lo-onboarding-stage]` so the whole window
	 * steers the helix there, the way the whole splash does on new chat. A
	 * selector rather than an element ref because the controller is created in a
	 * layout effect that resolves it with `closest`, before any ref of the
	 * parent's has settled.
	 */
	paperSelector?: string;
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
	// `paperSelector` is read once, at creation: the controller owns its paper for
	// its whole life, and no caller swaps surfaces under a live helix.
	// biome-ignore lint/correctness/useExhaustiveDependencies: read once at creation, see above.
	useLayoutEffect(() => {
		if (controller.current) {
			controller.current.setPresentation(quiet, suppressed);
			return;
		}
		const canvas = scene.current;
		// The full splash is the input surface, not the measured content strip.
		// Paint before the first frame, even while that strip's ref is settling.
		const paper = canvas?.closest<HTMLElement>(paperSelector);
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
