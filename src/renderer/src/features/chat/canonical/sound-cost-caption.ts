const LEGACY_COST_CAPTION =
	/Cost \$[0-9]+(?:\.[0-9]+)? \((?:billed|estimated[^)]*)\)\.?/;

/** Keep settlement provenance: a quote or an absent amount is not a charge. */
export function soundCostCaption(
	details: unknown,
	output?: string | null,
): string | null {
	// Older durable rows retained only text. Preserve the tool's own labelled
	// cost sentence verbatim rather than guessing its billing basis or amount.
	const legacy = output?.match(LEGACY_COST_CAPTION)?.[0] ?? null;
	if (!details || typeof details !== "object") return legacy;
	const result = details as Record<string, unknown>;
	const amount = result.cost_usd;
	const basis = result.billing_basis;
	if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0)
		return legacy;
	if (basis !== "billed" && basis !== "estimated") return null;
	/*
	 * A CHARGED CALL MUST NOT PRINT AS $0. Four decimals is the receipt's
	 * precision, and trimming them is what keeps `$0.002` from reading as
	 * `$0.0020` (design D5) - but amounts below the half-unit of that precision
	 * (`(0, 0.00005)`) trim to "0" and would render a real charge
	 * indistinguishably from an uncharged call. The bound is stated instead of
	 * rounded up, because rounding would overstate what was taken.
	 */
	const rounded = Number(amount.toFixed(4));
	const printed = rounded === 0 && amount > 0 ? "<$0.0001" : `$${rounded}`;
	return `Cost ${printed} (${basis}).`;
}
