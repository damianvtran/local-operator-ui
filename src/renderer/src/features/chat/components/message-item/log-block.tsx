/**
 * Component for displaying log output.
 *
 * Same shape as OutputBlock; `[No logger output]` is a backend placeholder
 * with zero information, so it renders nothing.
 */

import type { FC } from "react";

/**
 * Props for the LogBlock component
 */
export type LogBlockProps = {
	log: string;
	isUser: boolean;
};

export const LogBlock: FC<LogBlockProps> = ({ log }) => {
	if (!log || log === "[No logger output]") return null;

	return (
		<div className="mb-4 w-full">
			<span className="mb-1 block text-ink-dim text-meta">Logs</span>
			<pre className="flex max-h-[200px] w-full flex-col-reverse overflow-auto whitespace-pre-wrap rounded-sm border border-hairline bg-sunken p-3 font-mono text-ink-muted text-mono-sm">
				{log}
			</pre>
		</div>
	);
};
