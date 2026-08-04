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
 * `surface`. The body text is the semantic colour too, not `ink` — `ink` on a
 * semantic wash is the one pairing the contract does not measure, and a
 * callout reads better as a single-colour block anyway.
 *
 * Icons are supplied by variant rather than by the caller, so a warning always
 * looks like a warning. Pass `icon={null}` for a text-only callout.
 */
const alertVariants = cva(
	"flex w-full gap-3 rounded-md border p-3 text-body-sm",
	{
		variants: {
			variant: {
				neutral: "border-hairline bg-sunken text-ink-muted",
				success: "border-success-border bg-success-wash text-success",
				warning: "border-warning-border bg-warning-wash text-warning",
				danger: "border-danger-border bg-danger-wash text-danger",
				info: "border-info-border bg-info-wash text-info",
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
					<span className="mt-px flex shrink-0 [&_svg]:size-4">{glyph}</span>
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
