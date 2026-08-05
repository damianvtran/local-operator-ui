/**
 * Component for displaying command output (stdout).
 *
 * Machine voice on `sunken` ground, no box chrome beyond the ground itself —
 * the ground is the boundary (§ 5: default to less chrome; the shadow the old
 * version drew is exactly what § 5's "almost certainly not" covers).
 */

import type { FC } from "react";

/**
 * Props for the OutputBlock component
 */
export type OutputBlockProps = {
	output: string;
	isUser: boolean;
};

export const OutputBlock: FC<OutputBlockProps> = ({ output }) => {
	if (!output) return null;

	return (
		<div className="mb-4 w-full">
			<span className="mb-1 block text-ink-dim text-meta">Output</span>
			<pre className="flex max-h-[300px] w-full flex-col-reverse overflow-auto rounded-sm border border-hairline bg-sunken p-3 font-mono text-ink text-mono-sm">
				{output}
			</pre>
		</div>
	);
};
