/**
 * `/failovers` — the pure decisions.
 *
 * Presentational code shows a verdict; this file makes it. The panel's one
 * loud fact is whether the model serving the session is the one that was
 * selected, and a rule that important belongs where a test (and a reviewer
 * comparing it with the TUI) can read it without scrolling through JSX.
 */

export type FailoverModel = { provider: string; model_id: string };

export type ServingVerdict = {
	/** `warning` only when a measured difference is in force. */
	tone: "neutral" | "warning";
	note: string;
};

/**
 * What the Serving card says about the selected/effective pair.
 *
 * Three states, and the third is the panel's reason for existing:
 *
 * - **No model recorded** — either side is `null`. The pair cannot be compared,
 *   so this is NOT a quiet "same as selected": nothing was measured to compare.
 * - **Same as selected** — the neutral state.
 * - **Failover is in force** — the two differ. `warning` because it states a
 *   measured condition, which is the only thing tone is allowed to state.
 */
export function servingVerdict(
	selected: FailoverModel | null | undefined,
	effective: FailoverModel | null | undefined,
): ServingVerdict {
	if (!selected || !effective) {
		return { tone: "neutral", note: "No model recorded" };
	}
	if (modelLabel(selected) === modelLabel(effective)) {
		return { tone: "neutral", note: "Same as selected" };
	}
	return { tone: "warning", note: "Failover is in force" };
}

/** `provider/model_id`, or `none` when nothing was recorded. */
export function modelLabel(model: FailoverModel | null | undefined): string {
	if (!model) return "none";
	return `${model.provider}/${model.model_id}`;
}

/** One configured chain, in a stable order so two frames of it agree. */
export type ChainRow = { key: string; hops: string[] };

/**
 * The configured chains as rows, sorted by key.
 *
 * The payload is an object, so its key order is the producer's; sorting here
 * makes a screenshot reproducible and stops a chain moving between two frames
 * of the same panel. The hops are rendered VERBATIM — they arrive as display
 * labels with the effort already folded in, so re-composing them would spell
 * one hop two ways across the picker and the settings file.
 */
export function chainRows(chains: Record<string, string[]>): ChainRow[] {
	return Object.keys(chains)
		.sort((a, b) => a.localeCompare(b))
		.map((key) => ({ key, hops: chains[key] ?? [] }));
}
