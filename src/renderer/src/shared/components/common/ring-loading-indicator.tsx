import { Spinner } from "@shared/components/common/spinner";
import type { FC } from "react";

/**
 * Props for the RingLoadingIndicator component.
 */
type RingLoadingIndicatorProps = {
	size?: number;
};

/*
 * What used to be a bespoke four-part animation — two counter-rotating rings, a
 * pulsing outer ring and a glowing accent core with `box-shadow` keyframes —
 * is now one indivisible thing. Three of those four parts were decoration, and
 * the glow was a shadow this app no longer uses for in-flow elements. The
 * loading state the rings existed to show is carried by `Spinner`.
 *
 * The public props are kept on purpose. Chat renders this while an agent is
 * thinking, at `size={30}` inline in a message and `size={68}` as an empty
 * state, and its owner is migrating those files right now — a prop break there
 * is a regression mid-conversation. The numbers map onto the nearest `Spinner`
 * size step rather than being rendered literally, because the four sizes are
 * the affordance and a 30px spinner at 32px is not a visual regression.
 */
const SIZE_STEPS = [
	{ max: 15, size: "xs" },
	{ max: 17, size: "sm" },
	{ max: 24, size: "md" },
] as const;

/**
 * The loading indicator shown while the agent is thinking.
 *
 * @param {RingLoadingIndicatorProps} props - The props for the component.
 * @param {number} [props.size=30] - Approximate diameter in px, mapped onto the
 *   nearest `Spinner` size step.
 */
export const RingLoadingIndicator: FC<RingLoadingIndicatorProps> = ({
	size = 30,
}) => {
	const step = SIZE_STEPS.find((s) => size <= s.max)?.size ?? "lg";

	return (
		/* No outer margin: both call sites already centre it inside their own
		   container, and an outer margin here stacks with whatever they set. */
		<div className="flex items-center justify-center">
			<Spinner size={step} label="Loading" />
		</div>
	);
};

RingLoadingIndicator.displayName = "RingLoadingIndicator";
