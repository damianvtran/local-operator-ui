import { cn } from "@shared/lib/utils";
import { type VariantProps, cva } from "class-variance-authority";
import {
	CircleAlert,
	CircleCheck,
	Info,
	type LucideIcon,
	TriangleAlert,
} from "lucide-react";
import { type HTMLAttributes, type ReactNode, forwardRef } from "react";

/**
 * Callout for a semantic message.
 *
 * Each variant is one of the four triples the contrast contract verifies:
 * `XWash` fill, `XBorder` edge, `X` ink, checked against `canvas` and
 * `surface`.
 *
 * ## The mark carries identity, the body carries the message
 *
 * The body is `ink`, not the semantic colour. The semantic colour on its own
 * wash does pass the contract, but the contract measures it as a *badge*
 * colour — a short label, at 12px, on its own tint. An Alert body is a
 * sentence or two of prose, rendered at 18 call sites across 15 components,
 * two of which (`FloatingAlert`, the connectivity banner) are themselves
 * shared. Measured on `bg-*-wash` across all twelve palettes, the semantic
 * inks floor at 4.54:1 (`success`, localOperatorLight) while `ink` on the
 * same washes floors at 8.15:1 (`info`, tokyoNight) — per semantic, 8.33 vs
 * 4.54 for success, 8.39 vs 4.65 for warning, 8.62 vs 4.62 for danger, and
 * 8.15 vs 4.64 for info. Rendering the message in the semantic colour made
 * the sentence the user is meant to read the faintest text in the box, and it
 * did so at every call site at once. "A callout reads better as a
 * single-colour block" was the justification for that, and it is not worth
 * halving the legibility of the only part of a callout that says anything.
 *
 * Identity comes instead from the icon, the border and the title, which is
 * what the semantic colour is good at. Those keep it via `data-alert-mark`,
 * and they keep their own floor: the title is exactly the badge-sized use the
 * contract measures, so it clears 4.5:1 on its wash in all twelve palettes.
 * `neutral` follows the same rule with no hue to spend — `ink` mark over an
 * `ink-muted` body, which floors at 6.33:1 on `sunken`.
 *
 * The same reasoning, and the same measurement, is written out at
 * `features/chat/components/trace/agent-question.tsx`.
 *
 * Icons are supplied by variant rather than by the caller, so a warning always
 * looks like a warning. Pass `icon={null}` for a text-only callout.
 */
const alertVariants = cva(
	"flex w-full gap-3 rounded-md border p-3 text-body-sm",
	{
		variants: {
			variant: {
				neutral:
					"border-hairline bg-sunken text-ink-muted [&_[data-alert-mark]]:text-ink",
				success:
					"border-success-border bg-success-wash text-ink [&_[data-alert-mark]]:text-success",
				warning:
					"border-warning-border bg-warning-wash text-ink [&_[data-alert-mark]]:text-warning",
				danger:
					"border-danger-border bg-danger-wash text-ink [&_[data-alert-mark]]:text-danger",
				info: "border-info-border bg-info-wash text-ink [&_[data-alert-mark]]:text-info",
			},
		},
		defaultVariants: { variant: "info" },
	},
);

const DEFAULT_ICONS: Record<
	NonNullable<VariantProps<typeof alertVariants>["variant"]>,
	LucideIcon | null
> = {
	neutral: null,
	success: CircleCheck,
	warning: TriangleAlert,
	danger: CircleAlert,
	info: Info,
};

export type AlertProps = HTMLAttributes<HTMLDivElement> &
	VariantProps<typeof alertVariants> & {
		/** Override the variant's icon, or pass `null` to drop it. */
		icon?: ReactNode | null;
	};

export const Alert = forwardRef<HTMLDivElement, AlertProps>(
	({ className, variant, icon, children, ...props }, ref) => {
		const resolved = variant ?? "info";
		const DefaultIcon = DEFAULT_ICONS[resolved];
		const glyph =
			icon === undefined ? (
				DefaultIcon ? (
					<DefaultIcon className="size-4" aria-hidden={true} />
				) : null
			) : (
				icon
			);

		return (
			<div
				ref={ref}
				// `role="alert"` is not set here: it interrupts a screen reader the
				// moment the node mounts, which is right for a submit failure and
				// wrong for a callout that was on the page all along. Callers that
				// render one in response to an action pass `role="alert"` themselves.
				className={cn(alertVariants({ variant }), className)}
				{...props}
			>
				{glyph ? (
					<span
						data-alert-mark=""
						className="mt-px flex shrink-0 [&_svg]:size-4"
					>
						{glyph}
					</span>
				) : null}
				<div className="flex min-w-0 flex-col gap-1">{children}</div>
			</div>
		);
	},
);
Alert.displayName = "Alert";

export const AlertTitle = forwardRef<
	HTMLParagraphElement,
	HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
	<p
		ref={ref}
		// The variant paints the mark slots rather than the title painting
		// itself, so a title cannot drift out of step with the icon beside it.
		data-alert-mark=""
		className={cn("font-medium text-body-sm", className)}
		{...props}
	/>
));
AlertTitle.displayName = "AlertTitle";

export const AlertDescription = forwardRef<
	HTMLParagraphElement,
	HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
	<p ref={ref} className={cn("text-body-sm", className)} {...props} />
));
AlertDescription.displayName = "AlertDescription";

export { alertVariants };
