import { BrandMark } from "@shared/components/common/brand-mark";
import { useLayoutEffect, useRef } from "react";
import { trackNewChatHorizon } from "./new-chat-horizon-motion";
import "./new-chat-horizon.css";

export function NewChatHorizon({ quiet }: { quiet: boolean }) {
	const scene = useRef<HTMLCanvasElement>(null);
	useLayoutEffect(() => {
		const canvas = scene.current;
		// The full splash is the input surface, not the measured content strip.
		// Paint before the first frame, even while that strip's ref is settling.
		const paper = canvas?.closest<HTMLElement>("[data-lo-composer-splash]");
		if (canvas && paper) {
			return trackNewChatHorizon(paper, canvas, quiet, import.meta.env?.DEV);
		}
	}, [quiet]);

	return (
		<div aria-hidden="true" className="new-chat-horizon">
			<canvas
				className="new-chat-horizon__scene"
				data-quiet={quiet ? "" : undefined}
				data-lo-horizon-motion="still"
				ref={scene}
			/>
			{/* Also the first-send driver's splash selector. Keep the canonical
			    mark stationary as the front and back strands cross around it. */}
			<span
				data-lo-empty-mark=""
				className="new-chat-horizon__mark relative flex"
			>
				<BrandMark className="size-10" tone="ink-muted" treatment="engraved" />
			</span>
		</div>
	);
}
