/**
 * Component for displaying command output (stdout).
 *
 * Machine voice on `sunken` ground, no box chrome beyond the ground itself —
 * the ground is the boundary (§ 5: default to less chrome; the shadow the old
 * version drew is exactly what § 5's "almost certainly not" covers).
 */
import { USER_CONTENT_CLASS } from "@shared/analytics/autocapture-privacy";
import { cn } from "@shared/lib/utils";

import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import type { FC } from "react";

/**
 * Props for the OutputBlock component
 */
export type OutputBlockProps = {
	output: string;
	isUser: boolean;
};

export const OutputBlock: FC<OutputBlockProps> = ({ output }) => {
	useI18nLocale();
	if (!output) return null;

	return (
		<div className="mb-4 w-full">
			<span className="mb-1 block text-ink-dim text-meta">
				{t("ui.chat.transcript_copy.block.output")}
			</span>
			<pre
				// Code-execution output is user content (review round 1, Q2).
				className={cn(
					"flex max-h-[300px] w-full flex-col-reverse overflow-auto rounded-sm border border-hairline bg-sunken p-3 font-mono text-ink text-mono-sm",
					USER_CONTENT_CLASS,
				)}
			>
				{output}
			</pre>
		</div>
	);
};
