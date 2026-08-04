/**
 * Layout pieces for the chat options sidebar and its settings sections.
 *
 * These used to be MUI styled components; they are now thin Tailwind
 * wrappers so the sidebar and its sections share one visual language
 * without each re-deriving spacing, radii, and ink roles.
 */

import { Button } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { FC, HTMLAttributes, ReactNode } from "react";

export const SidebarContainer: FC<HTMLAttributes<HTMLDivElement>> = ({
	className,
	...props
}) => (
	<div
		className={cn("flex h-full w-[380px] flex-col bg-surface", className)}
		{...props}
	/>
);

export const SidebarHeader: FC<HTMLAttributes<HTMLDivElement>> = ({
	className,
	...props
}) => (
	<div
		className={cn(
			"flex items-center justify-between border-hairline border-b px-6 py-4",
			className,
		)}
		{...props}
	/>
);

export const HeaderTitle: FC<HTMLAttributes<HTMLDivElement>> = ({
	className,
	...props
}) => <div className={cn("flex flex-col gap-0.5", className)} {...props} />;

export const CloseButton: FC<
	Omit<HTMLAttributes<HTMLButtonElement>, "children"> & {
		children?: ReactNode;
		onClick?: () => void;
	}
> = ({ className, children, onClick }) => (
	<Button
		variant="ghost"
		size="icon"
		onClick={onClick}
		className={className}
		aria-label="Close"
	>
		{children}
	</Button>
);

export const SidebarContent: FC<HTMLAttributes<HTMLDivElement>> = ({
	className,
	...props
}) => (
	<div className={cn("grow overflow-y-auto px-6 py-4", className)} {...props} />
);

export const SectionTitle: FC<HTMLAttributes<HTMLHeadingElement>> = ({
	className,
	...props
}) => (
	<h3
		className={cn(
			"mb-4 mt-6 flex items-center font-semibold text-heading text-ink",
			className,
		)}
		{...props}
	/>
);

/**
 * TitleIcon is shared by call sites that each pass a different icon, so it
 * wraps an arbitrary lucide component rather than styling one directly.
 */
export const TitleIcon: FC<{ icon: LucideIcon }> = ({ icon: Icon }) => (
	<span className="mr-2 flex items-center rounded-sm bg-accent-wash p-1 text-accent">
		<Icon size={16} aria-hidden="true" />
	</span>
);

export const InfoButton: FC<HTMLAttributes<HTMLButtonElement>> = ({
	className,
	children,
}) => (
	<Button
		variant="ghost"
		size="icon-sm"
		className={cn("ml-1 text-accent", className)}
		aria-label="More info"
		type="button"
		tabIndex={0}
	>
		{children}
	</Button>
);

/**
 * The panel holding the hosting/model selects. Sunken ground separates it
 * from the sidebar surface; the hairline edge marks it as a grouping.
 */
export const ModelHostingSection: FC<HTMLAttributes<HTMLDivElement>> = ({
	className,
	...props
}) => (
	<div
		className={cn(
			"mb-4 rounded-md border border-hairline bg-sunken p-4",
			className,
		)}
		{...props}
	/>
);

/**
 * The "not set yet" card used by the unset-* settings. One border-control
 * edge; nothing else separates it from its neighbours.
 */
export const UnsetContainer: FC<HTMLAttributes<HTMLDivElement>> = ({
	className,
	...props
}) => (
	<div
		className={cn(
			"mb-4 flex flex-col rounded-md border border-control bg-surface p-4",
			className,
		)}
		{...props}
	/>
);

export const LabelWrapper: FC<HTMLAttributes<HTMLDivElement>> = ({
	className,
	...props
}) => <div className={cn("mb-2", className)} {...props} />;

export const LabelText: FC<HTMLAttributes<HTMLSpanElement>> = ({
	className,
	...props
}) => (
	<span
		className={cn(
			"mb-1 flex items-center font-medium text-body-sm text-ink",
			className,
		)}
		{...props}
	/>
);

export const DescriptionText: FC<HTMLAttributes<HTMLSpanElement>> = ({
	className,
	...props
}) => (
	<span
		className={cn("mb-3 text-body-sm text-ink-muted", className)}
		{...props}
	/>
);
