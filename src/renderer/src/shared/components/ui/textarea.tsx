import { cn } from "@shared/lib/utils";
import { type TextareaHTMLAttributes, forwardRef } from "react";

/**
 * Multi-line text input.
 *
 * Same boundary rule as `Input`: `border-control` is the sole edge, because it
 * is the only thing marking where the field is. Resize is vertical only — a
 * horizontally resizable textarea escapes every layout it is placed in, and
 * this app is mostly fixed-width panels.
 */
export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
	({ className, ...props }, ref) => (
		<textarea
			ref={ref}
			className={cn(
				"min-h-20 w-full resize-y rounded-md border border-control bg-surface px-3 py-2",
				"text-body-sm text-ink placeholder:text-ink-dim",
				"transition-colors duration-fast ease-out-quart",
				"aria-invalid:border-danger",
				"disabled:resize-none disabled:border-hairline disabled:bg-sunken disabled:text-ink-disabled",
				"disabled:placeholder:text-ink-disabled",
				className,
			)}
			{...props}
		/>
	),
);
Textarea.displayName = "Textarea";
