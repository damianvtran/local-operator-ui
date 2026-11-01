/**
 * Select the one compiled app document, never a URL substring or window order.
 * Hash routes may change; origin, exact encoded path and empty query may not.
 * Used for BOTH native-window and renderer-CDP discovery, which are then tied
 * to the same WebContents by an independently injected per-run nonce.
 */
export function selectTrustedRenderer(candidates, expectedUrl) {
	const expected = new URL(expectedUrl);
	if (expected.protocol !== "file:" || expected.search || expected.hash)
		throw new Error("expected identity must be a bare built file URL");
	const matches = candidates.filter((candidate) => {
		if (typeof candidate.url !== "string") return false;
		try {
			const actual = new URL(candidate.url);
			actual.hash = "";
			return actual.href === expected.href;
		} catch {
			return false;
		}
	});
	if (matches.length > 1)
		throw new Error("ambiguous trusted renderer identity");
	return matches[0] ?? null;
}
