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
		/*
		 * THE INSPECTED CONNECTION, and it goes above the unreachable-index entry
		 * for the reason that entry's own note gives for its own position: a TLS
		 * failure IS a network failure to the reader, and the general sentence that
		 * follows ("check the connection and retry") is the wrong remedy for it -
		 * the connection works for every other application on the machine, and
		 * retrying it never helps.
		 *
		 * BOTH CLIENTS' WORDS ARE MATCHED, because both are on the install path and
		 * they fail with different sentences for the same cause: uv says
		 * `invalid peer certificate: UnknownIssuer`, pip says
		 * `SSLError(SSLCertVerificationError(...))` / "There was a problem
		 * confirming the ssl certificate" (both captured against a deliberately
		 * untrusted local CA on macOS, not quoted from memory). Neither
		 * sentence matched anything in this table before, so the user got the
		 * app's generic words with no remedy in them at all.
		 *
		 * THE REMEDY NAMES THE STORE, and that is the half this change made true:
		 * the install now passes `--system-certs`/`UV_SYSTEM_CERTS` to uv, so a root
		 * that IS in the platform store is trusted, and the sentence a user can act
		 * on is "your network's root is not in that store yet".
		 */
		/invalid peer certificate|UnknownIssuer|SSLError|SSLCertVerificationError|CERTIFICATE_VERIFY_FAILED|problem confirming the ssl certificate|certificate is not trusted/i,
		"Local Operator could not verify the package index's secure connection, which is usually a network that inspects it (a corporate proxy or firewall). Ask IT for the root certificate and add it to your system certificate store - this app already trusts that store - then retry.",
	],
	[
		/*
		 * THE UNREACHABLE INDEX, and it goes above the file one on purpose.
		 *
		 * pip's "Could not find a version that satisfies the requirement" matched the
		 * file pattern's `could not find` and was therefore reported to the user as a
		 * missing file whose download or copy did not finish - sending them to look for
		 * a broken download when the actual remedy was the network (UX U4, measured on
		 * a first-run install against an unreachable index). `No matching
		 * distribution` is the same failure under pip's other name for it; the last two
		 * are pip's and the resolver's own words for "the network is the problem".
		 */
		/Could not find a version|No matching distribution|ConnectionError|connection error|Temporary failure in name resolution|Failed to establish a new connection/i,
		"Local Operator could not reach the package index, which is usually the network or a proxy. Check the connection and retry.",
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
		/ENOENT|no such file or directory|did not match its signed seed/i,
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
