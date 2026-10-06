import { backendLoadErrorMessage } from "@shared/api/local-operator/backend-error";
import { PublicHubError } from "@shared/api/radient/agents-api";

/**
 * The sentence a PUBLIC-HUB read renders when it fails.
 *
 * The hub's public listing is the one read in this app that does not ride the
 * local server (it is anonymous — see `listPublicTeams`), and the shared
 * `backendLoadErrorMessage` cannot say so: `backendErrorKind` reads a status off
 * a `DesktopControlError` and nothing else, while a `PublicHubError` carries its
 * own `status` (null for a request that never got an answer). Every hub failure
 * therefore fell through to `unreachable` and told the reader **"The Local
 * Operator server is not answering."** — naming a machine that was answering
 * fine — and threw away the transport's own accurate sentence ("The public hub
 * answered 503."). Design round 1, D1 and QA round 1, Q1 are the same finding,
 * seen from two directions.
 *
 * `PublicHubError` already authors a truthful, complete sentence for each way it
 * can fail, so this renders that and nothing else. The `lead` is kept for the
 * OTHER arm: an error that is not a `PublicHubError` at all — a selector's, a
 * bug in this app — is what the shared diagnosis and its remedy are for.
 */
export const publicHubFailureMessage = (
	lead: string,
	error: unknown,
): string =>
	error instanceof PublicHubError
		? error.message
		: backendLoadErrorMessage(lead, error);
