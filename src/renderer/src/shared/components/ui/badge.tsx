import { cn } from "@shared/lib/utils";
import { type VariantProps, cva } from "class-variance-authority";
import { Slot } from "radix-ui";
import { type HTMLAttributes, forwardRef } from "react";

/**
 * Badge — a small, static label. Not a control: if it can be clicked or
 * dismissed it is a button or a chip, and it should look like one.
 *
 * Every variant is a `wash` fill with the matching semantic ink, which is the
 * exact triple the contrast contract verifies (`fill` + `border` + `ink`
 * against `canvas` and `surface`). Solid semantic fills are absent on purpose:
 * there is no `onSuccess` role to put on top of one.
 *
 * `attention` is the one variant whose edge is NOT its own semantic border, and
 * the reason is measured rather than aesthetic: `warningBorder` clears 2.51-2.98:1
 * on graded grounds in seven palettes, so it cannot be the boundary of a count
 * drawn on a control whose ground moves. It is `ink-muted` now, and that is a
 * CHANGE MADE BY MEASUREMENT (operator round, 2026-09-23): the role it used to be,
 * `border-control`, clears 3:1 on `canvas` (3.13 worst) and `surface` (3.26 worst)
 * but NOT on the row grounds the rail draws the badge on - 2.77:1 on `row-selected`
 * and 2.92:1 on `row-hover`, with twelve of the fifty-nine palettes under the
 * 3:1 non-text floor and the fill contributing nothing to the boundary (1.00-1.75:1
 * over the fifty-nine, worst on `canvas` in oneDark; the 1.19 this paragraph used to
 * quote is the two brand palettes' own worst, on `row-selected`, not the sweep's). A
 * badge whose fill merges with its ground has its edge as its whole boundary, so the
 * boundary role has to clear the floor wherever the badge can sit - and the four
 * grounds named in `contrast-contract.mjs`'s row for this mark (`canvas`, `surface`,
 * `row-selected`, `row-hover`) are what "wherever" means. Over those four, read with
 * that file's own ratio from `scripts/palette-source.mjs`: `ink` 7.16:1 at worst,
 * `ink-muted` 5.63, `accent` 4.24, `border-control` 2.77. (The 7.10 and 5.53 this
 * paragraph used to quote are the `sunken` worsts - a ground the badge is never
 * drawn on, which the same row states.) So `ink-muted` is the quietest role that
 * clears the floor, and the quietest is the right one for a boundary that is not
 * trying to be read as a message.
 *
 * `size="count"` is the numbered-badge geometry, ON THE PRIMITIVE rather than
 * copy-pasted at each call site: three hosts had the same
 * `h-4 min-w-4 justify-center px-1 tabular-nums` string and had already drifted
 * (two added `ring-2 ring-canvas`, one did not, and only one capped its digits).
 * The CAP stays a caller's decision because it is a geometry fact about the host
 * (`countLabel` below), not a property of the badge, and the ring stays one too:
 * the rail cannot paint one, because its badge's ring would be clipped by the
 * rail's own `overflow-x-hidden`.
 *
 * `shape="pill"` is one of the three places `rounded-full` is allowed.
 */
const badgeVariants = cva(
	[
		"inline-flex w-fit shrink-0 items-center gap-1 border px-2 py-0.5",
		"whitespace-nowrap font-medium text-meta",
		"[&_svg]:pointer-events-none [&_svg]:size-3 [&_svg]:shrink-0",
	],
	{
		variants: {
			variant: {
				neutral: "border-hairline bg-sunken text-ink-muted",
				accent: "border-accent bg-accent-wash text-accent",
				success: "border-success-border bg-success-wash text-success",
				warning: "border-warning-border bg-warning-wash text-warning",
				danger: "border-danger-border bg-danger-wash text-danger",
				info: "border-info-border bg-info-wash text-info",
				outline: "border-control bg-transparent text-ink",
				attention: "border-ink-muted bg-warning-wash text-ink",
			},
			shape: {
				rounded: "rounded-sm",
				pill: "rounded-full",
			},
			size: {
				/** Fixed height, a minimum width, and tabular digits so the mark does not
				 * change width as the count is decided down. */
				count: "h-4 min-w-4 justify-center px-1 tabular-nums",
			},
		},
		defaultVariants: { variant: "neutral", shape: "rounded" },
	},
);

export type BadgeProps = HTMLAttributes<HTMLSpanElement> &
	VariantProps<typeof badgeVariants> & {
		/** Render the single child element instead of a `span`. */
		asChild?: boolean;
	};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
	({ className, variant, shape, size, asChild = false, ...props }, ref) => {
		const Comp = asChild ? Slot.Root : "span";
		return (
			<Comp
				ref={ref}
				className={cn(badgeVariants({ variant, shape, size }), className)}
				{...props}
			/>
		);
	},
);
Badge.displayName = "Badge";

/**
 * How a count is spelled inside an `attention` badge: the number, or a cap.
 *
 * ONE PLACE, because the same number was spelled three ways: the chat header
 * capped at `9+`, the URL bar printed every digit, and the rail did neither - so
 * the same count read `9+` on one surface and `12` on another. The cap is still
 * the CALLER's argument rather than a constant, because it is a geometry fact
 * about the host and not a property of the badge: `9+` exists where the mark sits
 * on a 32px icon button with 12px of room before it walks back over the glyph
 * (`chatHeader`), and where it does not, the true number is what the operator
 * asked to see. The ACCESSIBLE NAME never goes through this: a control that says
 * `9+` and announces the exact number is the rule the header already keeps.
 */
export function countLabel(count: number, cap?: number): string {
	if (cap === undefined || count <= cap) return String(count);
	return `${cap}+`;
}

export { badgeVariants };
