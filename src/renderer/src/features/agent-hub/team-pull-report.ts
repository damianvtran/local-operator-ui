/**
 * What one team pull reports, from the WIRE's own fields.
 *
 * A MODULE OF ITS OWN, and the reason is the defect it documents: the shape
 * question — is `invalid_name` a flag or a name? — is answerable without a mounted
 * mutation, but the hook that owns the toast imports the app's config, and a
 * bundle of it cannot be imported by a node test without dragging that
 * initialisation in (measured: the import failed asynchronously with "Failed to
 * load configuration"). Pure reporting belongs where a test can reach it, and the
 * hook keeps only the toast.
 *
 * The three states are the local registry's own (`TeamImportOutcome`):
 *
 * 1. `invalid_name === true` — the published name broke the LOCAL rules and was
 *    replaced. A `warning`, not a success: the user asked for a name and got
 *    another. The name to quote is `renamed_from` (the published one), because the
 *    flag carries no name of its own.
 * 2. `renamed_from` alone — a pure collision: this machine already holds that
 *    name, so the team landed under a derived one.
 * 3. neither — the team kept its published name.
 *
 * Read through `=== true` rather than a cast, so a server that sent the field in
 * some other shape cannot make this throw: an unexpected value falls to the
 * `renamed_from` arm, which is the honest reading of "the name changed" — and a
 * crash, which is what the first revision did, is not an acceptable answer to an
 * unexpected one either.
 */

/** What a pull reports, and at which level. */
export type TeamPullReport = {
	level: "success" | "warning";
	message: string;
};

/**
 * The sentence one pull reports, from the wire's own fields.
 *
 * The name to quote comes from `renamed_from` in BOTH arms that mention a name:
 * the flag says the difference includes an unusable spelling, and the published
 * name is what the user last saw.
 */
export const describePulledTeam = (
	stored:
		| { name?: string; renamed_from?: string; invalid_name?: unknown }
		| undefined,
	requestedName?: string,
): TeamPullReport => {
	const storedName = stored?.name?.trim() || requestedName?.trim() || "Team";
	const publishedName = stored?.renamed_from?.trim() || null;
	const spellingWasAdjusted = stored?.invalid_name === true;

	if (spellingWasAdjusted && publishedName) {
		return {
			level: "warning",
			message: `Pulled "${storedName}". The published name "${publishedName}" is not usable locally, so the team was stored as "${storedName}".`,
		};
	}
	if (publishedName) {
		return {
			level: "success",
			message: `Pulled "${storedName}" (you already have a team called "${publishedName}").`,
		};
	}
	return { level: "success", message: `Pulled team "${storedName}".` };
};
