import { cn } from "@shared/lib/utils";
import { ArrowLeft, Bot } from "lucide-react";
import type { FC } from "react";

/**
 * Props for the PlaceholderView component
 */
type PlaceholderViewProps = {
	title: string;
	description: string;
	directionText?: string;
};

/**
 * PlaceholderView Component
 *
 * Displays a placeholder when no content is available
 */
export const PlaceholderView: FC<PlaceholderViewProps> = ({
	title,
	description,
	directionText,
}) => {
	return (
		<div
			className={cn(
				"flex h-full grow flex-col items-center justify-center bg-surface p-6",
			)}
		>
			<Bot size={48} className={cn("mb-4 text-ink-dim")} aria-hidden={true} />
			<h2 className={cn("mb-1 text-heading text-ink")}>{title}</h2>
			<p
				className={cn(
					"mb-4 max-w-[500px] text-center text-body-sm text-ink-muted",
				)}
			>
				{description}
			</p>
			{directionText && (
				<p className={cn("flex items-center gap-2 text-accent text-body-sm")}>
					<ArrowLeft size={16} aria-hidden={true} />
					{directionText}
				</p>
			)}
		</div>
	);
};
