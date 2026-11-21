/**
 * Component for displaying log output.
 *
 * Same shape as OutputBlock; `[No logger output]` is a backend placeholder
 * with zero information, so it renders nothing.
 */
import { USER_CONTENT_CLASS } from "@shared/analytics/autocapture-privacy";
import { cn } from "@shared/lib/utils";

import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import type { FC } from "react";

/**
 * Props for the LogBlock component
 */
export type LogBlockProps = {
	log: string;
	isUser: boolean;
};

export const LogBlock: FC<LogBlockProps> = ({ log }) => {
	useI18nLocale();
	if (!log || log === "[No logger output]") return null;

	return (
		<div className="mb-4 w-full">
			<span className="mb-1 block text-ink-dim text-meta">
				{t("ui.chat.transcript_copy.block.logs")}
			</span>
			<pre
				// Execution logs are user content (review round 1, Q2).
				className={cn(
					"flex max-h-[200px] w-full flex-col-reverse overflow-auto whitespace-pre-wrap rounded-sm border border-hairline bg-sunken p-3 font-mono text-ink-muted text-mono-sm",
					USER_CONTENT_CLASS,
				)}
			>
				{log}
			</pre>
		</div>
	);
};
