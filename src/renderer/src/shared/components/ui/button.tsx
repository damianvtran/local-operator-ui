import { cn } from "@shared/lib/utils";
import { type VariantProps, cva } from "class-variance-authority";
import { Slot } from "radix-ui";
import { type ButtonHTMLAttributes, forwardRef } from "react";

/**
 * The button.
 *
 * ## Why the `cva` variant order is `size` then `variant`
 *
 * `cva` emits variant groups in declaration order, and `cn` resolves conflicts
 * last-one-wins. `link` has to neutralise the box its size gave it (`h-auto`,
 * `p-0`), so `variant` must be emitted after `size` or a link would render as
 * a 32px-tall padded box. Nothing else overlaps: sizes own the box, variants
 * own the colour.
 *
 * ## Why `danger` is not a solid red fill
 *
 * The palette contract has no `onDanger` role, so a solid danger fill would
 * have to guess its own ink — which is the failure mode this port exists to
 * remove, since MUI's `augmentColor` guessed it twelve different ways. The
 * `danger` / `dangerWash` / `dangerBorder` triple is the shape the contrast
 * contract actually verifies, so destructive reads as a red-bordered control
 * that fills with the danger wash rather than as a red slab.
 *
 * ## Pressed states, and why only `primary` gets `accent-active`
 *
 * The palette contract ships exactly one pressed colour, `accentActive`, and
 * it is authored as a **ground** — the thing `onAccent` is designed to sit on
 * top of. `primary` is therefore the only variant that may take it. The other
 * five build their pressed step out of roles used in the capacity they were
 * authored for, because borrowing a fill role as an ink is how a control ends
 * up at 3.55:1 while every token in it is individually "fine".
 *
 * - `secondary` presses down the ground ramp: hover steps up
 *   `surface -> elevated`, active drops to `sunken`. Grounds used as grounds.
 *   The two ends stay clear of each other in every palette (elevated/sunken
 *   measures 1.17:1 at worst), so hover and pressed are never the same pixel.
 * - `outline` and `danger` have no fill of their own to move, so the edge
 *   deepens instead: the muted `-border` role steps to the full role colour
 *   while the wash stays put. `accent` and `danger` are both floored as text
 *   at 4.5:1, so as a 3:1 structural edge they are far clear (5.04:1 and
 *   4.72:1 at worst).
 * - `ghost` has neither fill nor edge at rest, so its ink carries the press:
 *   `ink-muted -> ink` on hover, `accent` on press. Branding § 2 spends the
 *   accent on "primary action, active state, focus ring", and this is that
 *   middle one. It lands on `accent`, which is floored as an ink, and not on
 *   `accent-active`, which is not.
 * - `link` does not change colour at all. It thickens its own underline. A
 *   text link has no fill, no edge and no ground to step, so the only colour
 *   move left would be an ink the palette does not have — and underline
 *   weight is the established pressed affordance for a link anyway. The ink
 *   stays on `accent`/`accent-hover`, both of which already clear their
 *   floors.
 *
 * Each pressed rule restates its own properties instead of leaning on the
 * hover ones. A keyboard user holding Space matches `:active` without ever
 * matching `:hover`, so a pressed state written as a delta from hover does
 * not exist for them — and "it is only visible while the button is held" is
 * not a reason to let one slide, since that is the moment the user is looking
 * hardest at what they just clicked, and a motor-impaired user holds it far
 * longer than a quick mouse click. Tailwind emits `hover` before `active`
 * before `disabled`, so the three resolve in that priority without
 * `!important`.
 *
 * ## Focus
 *
 * The ring itself is not declared here. `styles/index.css` gives every
 * `:focus-visible` element a 2px accent outline at 2px offset, and a
 * per-component ring would be a second source of truth for the same pixel.
 *
 * The two dense sizes pull the *offset* in to 1px, and only the offset. A 2px
 * ring at 2px offset bleeds 4px past a 28px control on every side; in a
 * toolbar of icon-sm buttons that ring lands on top of both neighbours, so
 * the focused control reads as three controls. Nothing else about the ring
 * changes, which keeps the accent colour and the 2px weight single-sourced.
 *
 * ## The size ramp: 28 / 32 / 36
 *
 * One 4px step apart, each paired with one step of the type scale — 12px
 * `meta`, 13px `body-sm`, 14px `body`. The previous large was 38px, a
 * half-step off the 4px ramp, and the cost of that showed up as four call
 * sites hardcoding `h-9.5` onto other controls to line up with it. An
 * off-ramp control height does not stay contained; it propagates.
 *
 * Horizontal padding is exactly twice the icon-to-label gap at every size
 * (8/4, 12/6, 16/8). That ratio is what makes an icon read as part of its
 * label rather than as a second object sharing the box: the space inside the
 * pair has to be visibly tighter than the space around it.
 *
 * ## Radius: controls are 6px
 *
 * The app's radius assignment is controls 6, floating panels 10, cards and
 * dialogs 14 — chosen by the size of the object, not by novelty. A 10px
 * corner on a 32px control eats a third of its height and reads as a
 * lozenge; every desktop tool that feels precise sits at 4-6. All six sizes
 * take the same 6px, so a button, an input and a select trigger sitting in
 * one row agree with each other.
 */
const buttonVariants = cva(
	[
		"inline-flex shrink-0 select-none items-center justify-center",
		"whitespace-nowrap font-medium",
		// Colour-only transition. Hover is a colour step: nothing lifts, scales
		// or translates.
		"transition-colors duration-fast ease-out-quart",
		"[&_svg]:pointer-events-none [&_svg]:shrink-0",
	],
	{
		variants: {
			size: {
				sm: "h-7 gap-1 rounded-sm px-2 text-meta [&_svg]:size-3.5 focus-visible:outline-offset-1",
				md: "h-8 gap-1.5 rounded-sm px-3 text-body-sm [&_svg]:size-4",
				lg: "h-9 gap-2 rounded-sm px-4 text-body [&_svg]:size-4",
				icon: "size-8 rounded-sm [&_svg]:size-4",
				"icon-sm":
					"size-7 rounded-sm [&_svg]:size-3.5 focus-visible:outline-offset-1",
				"icon-lg": "size-9 rounded-sm [&_svg]:size-5",
			},
			variant: {
				primary: [
					"bg-accent text-on-accent",
					"hover:bg-accent-hover active:bg-accent-active",
					"disabled:bg-sunken disabled:text-ink-disabled",
				],
				secondary: [
					"border border-control bg-surface text-ink",
					"hover:bg-elevated active:bg-sunken",
					"disabled:border-hairline disabled:bg-sunken disabled:text-ink-disabled",
				],
				outline: [
					"border border-control text-ink",
					"hover:bg-accent-wash active:border-accent active:bg-accent-wash",
					"disabled:border-hairline disabled:bg-transparent disabled:text-ink-disabled",
				],
				ghost: [
					"text-ink-muted",
					"hover:bg-accent-wash hover:text-ink",
					"active:bg-accent-wash active:text-accent",
					"disabled:bg-transparent disabled:text-ink-disabled",
				],
				danger: [
					"border border-danger-border text-danger",
					"hover:bg-danger-wash active:border-danger active:bg-danger-wash",
					"disabled:border-hairline disabled:bg-transparent disabled:text-ink-disabled",
				],
				link: [
					"h-auto rounded-xs p-0 text-accent underline-offset-4",
					"hover:text-accent-hover hover:underline",
					"active:underline active:decoration-2",
					"disabled:text-ink-disabled disabled:no-underline",
				],
			},
		},
		defaultVariants: { variant: "secondary", size: "md" },
	},
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
	VariantProps<typeof buttonVariants> & {
		/**
		 * Render the single child element instead of a `button`, keeping every
		 * class and handler. This is how a button becomes a router `Link` or an
		 * anchor without a second styling path existing for the same look.
		 */
		asChild?: boolean;
	};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
	({ className, variant, size, asChild = false, type, ...props }, ref) => {
		// Branched rather than aliased to one `Comp` because the two elements do
		// not take the same props: `type` is meaningful on a button and invalid
		// on the anchor or Link that `asChild` usually renders.
		if (asChild) {
			return (
				<Slot.Root
					ref={ref}
					className={cn(buttonVariants({ variant, size }), className)}
					{...props}
				/>
			);
		}

		return (
			<button
				ref={ref}
				// Default to `button`. An untyped button inside a form submits it,
				// and that only shows up on the one screen that has a form.
				type={type ?? "button"}
				className={cn(buttonVariants({ variant, size }), className)}
				{...props}
			/>
		);
	},
);
Button.displayName = "Button";

export { buttonVariants };
