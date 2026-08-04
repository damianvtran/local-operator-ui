import {
	Button,
	type ButtonProps,
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import {
	type ComponentPropsWithoutRef,
	type FC,
	type ReactNode,
	forwardRef,
} from "react";

/**
 * Props for the BaseDialog component
 */
export type BaseDialogProps = {
	/**
	 * Whether the dialog is open
	 */
	open: boolean;
	/**
	 * Callback when the dialog is closed
	 */
	onClose: () => void;
	/**
	 * Title of the dialog
	 */
	title: ReactNode;
	/**
	 * Content of the dialog
	 */
	children: ReactNode;
	/**
	 * Actions to display at the bottom of the dialog
	 * If not provided, no actions will be displayed
	 */
	actions?: ReactNode;
	/**
	 * Maximum width of the dialog
	 * @default "sm"
	 */
	maxWidth?: "xs" | "sm" | "md" | "lg" | "xl" | false;
	/**
	 * Whether the dialog should take up the full width
	 * @default false
	 */
	fullWidth?: boolean;
	/**
	 * Additional props to pass to the Dialog component
	 */
	dialogProps?: Record<string, unknown>;
	/**
	 * Data tour tag for the dialog
	 */
	dataTourTag?: string;
};

/**
 * The `maxWidth` steps, kept at their old breakpoint names because five
 * feature dialogs pass them. The pixel targets are MUI's own
 * (444/600/900/1200/1536) rounded to the nearest Tailwind step, so nothing
 * visibly resizes; `false` means "as wide as the viewport allows".
 */
const MAX_WIDTHS = {
	xs: "max-w-md",
	sm: "max-w-xl",
	md: "max-w-4xl",
	lg: "max-w-6xl",
	xl: "max-w-7xl",
} as const;

/**
 * Base dialog component with consistent styling
 *
 * This component provides a foundation for all dialogs in the application
 * to ensure a consistent look and feel.
 *
 * The panel, scrim, close button, focus trap, Escape handling and
 * close-on-outside-click all come from the `Dialog` primitive. Only the
 * header/body/footer split and the width steps live here.
 */
export const BaseDialog: FC<BaseDialogProps> = ({
	open,
	onClose,
	title,
	children,
	actions,
	maxWidth = "sm",
	fullWidth = false,
	dialogProps = {},
	dataTourTag,
}) => {
	/*
	 * `className` is lifted out of the escape hatch and merged: spread after
	 * the base classes it would replace them wholesale, dropping the height
	 * cap and width steps the panel relies on.
	 */
	const { className: dialogClassName, ...restDialogProps } =
		dialogProps as Partial<ComponentPropsWithoutRef<typeof DialogContent>>;

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) {
					onClose();
				}
			}}
		>
			<DialogContent
				className={cn(
					// Cap the panel rather than the body so the header and footer stay
					// put and only the content between them scrolls.
					"max-h-[calc(100vh-4rem)]",
					fullWidth ? "w-full" : "w-auto min-w-80",
					maxWidth === false
						? "max-w-[calc(100vw-4rem)]"
						: MAX_WIDTHS[maxWidth],
					dialogClassName,
				)}
				/*
				 * Escape hatch. The record is spread untyped onto the content panel
				 * rather than rejected, so callers can pass content-level props
				 * (aria attributes, onInteractOutside, onOpenAutoFocus) without this
				 * component having to know about each one.
				 */
				{...restDialogProps}
			>
				<DialogHeader className="shrink-0">
					{/*
					 * Always a flex row: several dialogs pass an icon plus a label as
					 * `title`, and this is the gap they used to get from a wrapper.
					 */}
					<DialogTitle className="flex items-center gap-3">{title}</DialogTitle>
				</DialogHeader>
				{/* `min-h-0` is what lets this shrink below its content and scroll. */}
				<div className="min-h-0 overflow-y-auto" data-tour-tag={dataTourTag}>
					{children}
				</div>
				{actions && <DialogFooter className="shrink-0">{actions}</DialogFooter>}
			</DialogContent>
		</Dialog>
	);
};

/**
 * Props shared by the dialog action buttons.
 */
export type DialogButtonProps = Omit<ButtonProps, "variant"> & {
	/**
	 * Icon rendered before the label. Kept from the previous signature because
	 * feature dialogs pass a `Spinner` through it while submitting.
	 */
	startIcon?: ReactNode;
};

type ActionButtonProps = DialogButtonProps & {
	variant: NonNullable<ButtonProps["variant"]>;
};

/**
 * The shared dialog action button. `min-w-25` is the one thing it adds over
 * the primitive: a row of dialog buttons whose widths track their labels reads
 * as ragged, and 100px was the old floor.
 */
const ActionButton = forwardRef<HTMLButtonElement, ActionButtonProps>(
	({ startIcon, children, className, ...props }, ref) => (
		<Button
			ref={ref}
			size="lg"
			className={cn("min-w-25", className)}
			{...props}
		>
			{startIcon}
			{children}
		</Button>
	),
);
ActionButton.displayName = "ActionButton";

/**
 * Primary action button for dialogs
 */
export const PrimaryButton = forwardRef<HTMLButtonElement, DialogButtonProps>(
	(props, ref) => <ActionButton ref={ref} variant="primary" {...props} />,
);
PrimaryButton.displayName = "PrimaryButton";

/**
 * Secondary action button for dialogs
 */
export const SecondaryButton = forwardRef<HTMLButtonElement, DialogButtonProps>(
	(props, ref) => <ActionButton ref={ref} variant="secondary" {...props} />,
);
SecondaryButton.displayName = "SecondaryButton";

/**
 * Danger action button for dialogs
 */
export const DangerButton = forwardRef<HTMLButtonElement, DialogButtonProps>(
	(props, ref) => <ActionButton ref={ref} variant="danger" {...props} />,
);
DangerButton.displayName = "DangerButton";
