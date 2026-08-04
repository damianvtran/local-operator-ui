import { cn } from "@shared/lib/utils";
import type { FC } from "react";

/**
 * Props for the RawInfoView component
 */
type RawInfoViewProps = {
	content: string;
};

/**
 * RawInfoView Component
 *
 * Displays raw information about the conversation in a monospace format.
 *
 * The nested inner panel is gone: monospace on a `sunken` ground already reads
 * as machine output, so the box drawn around it carried no information.
 */
export const RawInfoView: FC<RawInfoViewProps> = ({ content }) => {
	return (
		<div className={cn("grow overflow-auto bg-sunken p-6")}>
			<h2 className={cn("mb-3 text-heading text-ink")}>Raw information</h2>
			<pre
				className={cn(
					"overflow-auto whitespace-pre-wrap font-mono text-ink-muted text-mono-sm",
				)}
			>
				{content}
			</pre>
		</div>
	);
};
