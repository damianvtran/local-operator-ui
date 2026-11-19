import { type MessageKey, t } from "../../i18n";

/** The catalogue keys the cause table may name: only the setup-cause sentences. */
export type SetupCauseKey = Extract<
	MessageKey,
	`ui.installer.setup_cause.${string}`
>;

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
 * both callers ask this one. It stays free of anything platform-bound:
 * `update-service.ts` cannot import `backend-installer.ts` (that module pulls the
 * three platform install scripts in as `?raw`, which the update-robustness bundle
 * has no loader for - measured, in this file's own earlier form), so the shared
 * home has to be a module with no platform dependencies of its own. Its one
 * import is the catalogue translator (`../../i18n`), which the update path already
 * bundles.
 *
 * THE TABLE HOLDS CATALOGUE KEYS, NOT SENTENCES (i18n slice S1): both callers
 * put the cause in front of a person - the installer window and the
 * `backend-update-error` panel - so the sentence is resolved through `t()` at the
 * moment it is read, in the locale in force then. The patterns stay English on
 * purpose: they match the machine's own words (errno, pip, the TLS stack).
 *
 * Order is the decision, not an accident: a full disk is the one cause whose
 * remedy is the user's (`free space`), and it can look like a missing file, so it
 * is tested first.
 */
export const SETUP_FAILURE_CAUSES: Array<[RegExp, SetupCauseKey]> = [
	[
		/ENOSPC|No space left|not enough (?:free )?space/i,
		"ui.installer.setup_cause.disk_full",
	],
	[
		/*
		 * THE CLOCK, OR A CERTIFICATE THAT REALLY EXPIRED - the two this text cannot
		 * tell apart, and it goes ABOVE the verification entry because the raw text of
		 * a python expiry failure carries `CERTIFICATE_VERIFY_FAILED` as well as
		 * "certificate has expired", so the entry below would otherwise answer first.
		 *
		 * WHY IT EXISTS (review round 1, R1-3): the verification entry used to carry a
		 * bare `SSLError` alternative, and every SSL-shaped failure matched it -
		 * including this one and the two that are not trust problems at all - so the
		 * user was told to "ask IT for the root certificate" for an expired
		 * certificate. A wrong clock is the one cause on this list the user can fix
		 * alone, and nothing in the previous sentence mentioned it.
		 */
		/certificate has expired|certificate is not yet valid|not valid at this time/i,
		"ui.installer.setup_cause.clock_or_expired",
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
		 * THE PATTERN IS THE VERIFICATION WORDS ONLY (review round 1, R1-3): a bare
		 * `SSLError` also carried `SSLError(1, '[SSL: WRONG_VERSION_NUMBER]')` - a
		 * proxy answering plain HTTP - and `SSLEOFError` - a handshake that was
		 * aborted early - and answering either with a certificate remedy is
		 * misdirection. Those now fall through to the generic cause instead.
		 *
		 * THE REMEDY NAMES THE STORE, and it is true of BOTH clients as they ship
		 * (review round 1, R1-2): uv needs `--system-certs`/`UV_SYSTEM_CERTS`, which
		 * the three install scripts now pass, and pip has read the platform store BY
		 * DEFAULT since 24.2 (`truststore`; both pips these installs produce are
		 * newer - uv's seed ships 26.x and the bundled interpreter's ensurepip 25.x)
		 * - so a root added to the store is trusted by the uv path AND by the pip
		 * fallback, and the sentence is not asking the user to do something that then
		 * fails. The three scripts' notes that said the pip fallback "resolves
		 * against certifi" were true only of pip before 24.2 and are corrected
		 * beside this.
		 */
		/invalid peer certificate|UnknownIssuer|SSLCertVerificationError|CERTIFICATE_VERIFY_FAILED|certificate verify failed|problem confirming the ssl certificate|certificate is not trusted/i,
		"ui.installer.setup_cause.tls_interception",
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
		"ui.installer.setup_cause.unreachable",
	],
	[
		/Another Local Operator instance is preparing/i,
		"ui.installer.setup_cause.locked",
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
		"ui.installer.setup_cause.not_started",
	],
	[
		/ENOENT|no such file or directory|did not match its signed seed/i,
		"ui.installer.setup_cause.file_missing",
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
	const key = SETUP_FAILURE_CAUSES.find(([pattern]) => pattern.test(raw))?.[1];
	return key === undefined ? null : t(key);
}
