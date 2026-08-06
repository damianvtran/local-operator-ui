import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * `twMerge`, taught this app's four custom scales.
 *
 * tailwind-merge resolves conflicts from a built-in map of class groups. Any
 * token it does not recognise falls through to a validator, and the validator
 * for `text-*` is "assume it is a colour" — which puts `text-body-sm` in the
 * same conflict group as `text-ink`, so a component asking for both keeps only
 * one. Silently, and with the survivor depending on which came first:
 *
 *   twMerge("text-ink text-body-sm")     -> "text-body-sm"   // ink dropped
 *   twMerge("text-heading text-ink")     -> "text-ink"       // size dropped
 *
 * That is the whole reason this file is not a one-liner. The scales below are
 * the ones declared in `styles/index.css`; anything added there has to be
 * added here too, or it becomes a class that either cannot be overridden or
 * quietly eats its neighbour.
 *
 * @see src/renderer/src/styles/index.css — the `@theme` block these mirror
 */
const twMerge = extendTailwindMerge({
	extend: {
		classGroups: {
			// The type ramp. Without this every one of these reads as a colour.
			"font-size": [
				{
					text: [
						"display",
						"title",
						"heading",
						"body",
						"body-sm",
						"meta",
						"mono",
						"mono-sm",
					],
				},
			],
			// `xs`/`sm`/`md`/`lg` are already t-shirt sizes tailwind-merge knows;
			// `frame` is ours.
			rounded: [{ rounded: ["frame"] }],
			duration: [{ duration: ["instant", "fast", "base", "slow"] }],
			ease: [{ ease: ["out-quart", "out-expo", "in-out"] }],
			shadow: [{ shadow: ["overlay"] }],
		},
	},
});

/**
 * Merge Tailwind classes with correct precedence.
 *
 * `clsx` resolves conditionals and arrays; `twMerge` then drops earlier classes
 * that a later one overrides in the same property group, so a caller's
 * `className="p-6"` beats a component's built-in `p-4` instead of the pair
 * both landing and the winner depending on stylesheet order.
 *
 * Every component in this app that accepts `className` must route it through
 * here, or that override guarantee does not hold.
 */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
