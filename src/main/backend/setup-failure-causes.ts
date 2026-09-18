/**
 * The failure classes a user can act on, matched on the error's own words.
 *
 * WHY THIS IS ITS OWN LEAF MODULE rather than a constant inside
 * `backend-installer.ts`, where it was written (review R2): the same publish does
 * not run only under the installer any more. The app-owned update path
 * (`update-service.ts`, `updateManagedPython` → `installEnvironmentInto`) creates
 * and populates an environment of its own, and a volume that fills during it
 * produced the generic sentence "The server update did not install ... No space
 * left on device" while the one actionable remedy this product already knows -
 * "free some space and retry" - sat behind the installer.
 *
 * A second table in the update path would be a second answer to "what does ENOSPC
 * mean to this user", and the two would drift the first time one was reworded, so
 * both callers ask this one. It is deliberately import-free: `update-service.ts`
 * cannot import `backend-installer.ts` (that module pulls the three platform
 * install scripts in as `?raw`, which the update-robustness bundle has no loader
 * for - measured, in this file's own earlier form), so the shared home has to be a
 * module with no dependencies of its own.
 *
 * Order is the decision, not an accident: a full disk is the one cause whose
 * remedy is the user's (`free space`), and it can look like a missing file, so it
 * is tested first.
 */
export const SETUP_FAILURE_CAUSES: Array<[RegExp, string]> = [
	[
		/ENOSPC|No space left|not enough (?:free )?space/i,
		"This Mac ran out of disk space while setting up the backend. Free some space and retry.",
	],
	[
		/Another Local Operator instance is preparing/i,
		"Another copy of Local Operator is setting up its backend right now. Retry in a moment.",
	],
	[
		/*
		 * The smoke arm only. `did not complete` used to be in here, and it is the
		 * phrase `prepareManagedPython` throws when the install callback returns
		 * false - a pip or network failure, where nothing was installed at all - so
		 * the user read "The backend was installed but did not start correctly" about
		 * an install that never happened (review round 2, N6). It now falls through
		 * to the generic cause, which is true of it, and the app's own sentence still
		 * follows under `The app recorded:`.
		 */
		/did not become healthy|Backend smoke|exited with/i,
		"The backend was installed but did not start correctly.",
	],
	[
		/ENOENT|no such file or directory|could not find|did not match its signed seed/i,
		"A file the setup needed was missing, which usually means the download or the copy did not finish.",
	],
];

/**
 * The actionable cause for a setup failure, or null when none of them match.
 *
 * Null is the honest answer for the failures this table does not describe, and it
 * is the caller's decision what to default to: the installer's dialog has its own
 * generic sentence, the update path already carries the app's own words about what
 * it did not do.
 */
export function setupFailureCause(error: unknown): string | null {
	const raw = error instanceof Error ? error.message : String(error);
	return (
		SETUP_FAILURE_CAUSES.find(([pattern]) => pattern.test(raw))?.[1] ?? null
	);
}
