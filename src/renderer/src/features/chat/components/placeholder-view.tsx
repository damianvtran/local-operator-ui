import { cn } from "@shared/lib/utils";
import { ArrowLeft } from "lucide-react";
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
 * The pane before a conversation exists.
 *
 * Three deliberate subtractions from what was here:
 *
 * - **The 48px robot is gone.** A large glyph floating above a heading is the
 *   most recognisable template in AI-product design and it told the reader
 *   nothing they could not read in the next line. Type hierarchy carries an
 *   empty state on its own — this is Things', Linear's and Cron's treatment.
 * - **The ground is `canvas`,** the same ground the conversation uses, so
 *   selecting an agent does not repaint the pane a different colour.
 * - **The hint is not accent.** § 2 spends the accent about three times per
 *   screen on things you act on; a sentence pointing at the sidebar is not one
 *   of them, and dimming it is what lets the title read first.
 */
export const PlaceholderView: FC<PlaceholderViewProps> = ({
	title,
	description,
	directionText,
}) => {
	return (
		<div
			className={cn(
				"flex h-full grow flex-col items-center justify-center bg-canvas p-6",
			)}
		>
			<div className={cn("flex max-w-[420px] flex-col items-center gap-2")}>
				<h2 className={cn("text-ink text-title")}>{title}</h2>
				<p className={cn("text-center text-body text-ink-muted")}>
					{description}
				</p>
				{directionText && (
					<p
						className={cn(
							"mt-4 flex items-center gap-2 text-ink-dim text-body-sm",
						)}
					>
						<ArrowLeft size={14} aria-hidden={true} />
						{directionText}
					</p>
				)}
			</div>
		</div>
	);
};
