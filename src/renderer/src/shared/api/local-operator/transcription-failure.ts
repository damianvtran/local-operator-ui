/**
 * One sentence per way a dictation can fail, chosen in one place.
 *
 * WHY this exists. Both surfaces that transcribe audio - the composer
 * (`message-input.tsx`) and the canvas's inline editor (`canvas/inline-edit.tsx`)
 * - answered every failure with the same literal: "Error transcribing audio.
 * Please try again." The server's own reason was already reaching the renderer
 * (`requestDesktopMediaOutcome` resolves `{status, kind: "error", detail}`,
 * `mediaError` turns it into an `Error`, and the call site logged it), and the
 * toast threw it away.
 *
 * That is not a cosmetic loss. The operator lost a day to it: the daemon relayed
 * the upstream provider's `insufficient_quota` refusal, the toast said "please
 * try again", and trying again could not work because the account had no credits.
 * A failure a person cannot act on is a failure the app has not reported.
 *
 * The raw text is NOT thrown away by this module: the error the caller catches
 * still carries the server's own message (`TranscriptionRequestError.message`),
 * which is what the call sites' `console.error` prints. What this module changes
 * is the sentence a person reads.
 */

/**
 * A refused transcription, carrying the two things the copy needs.
 *
 * `Error.message` keeps the server's own `detail` verbatim so the console and
 * any future log reader still sees it; `status` is carried separately because
 * `/health`-style prose cannot be the only evidence - the Radient refusal is an
 * HTTP 402 with a message we do not own the wording of.
 *
 * Typed as a class rather than a shape so a caller cannot mistake an unrelated
 * `Error` for one of these: the mapper below reads `status` only from this type
 * and treats every other throwable as "no status".
 */
export class TranscriptionRequestError extends Error {
	/** The HTTP status the relay saw, or null when nothing answered. */
	readonly status: number | null;

	constructor(status: number | null, detail: string) {
		super(detail);
		this.name = "TranscriptionRequestError";
		this.status = status;
	}
}

/**
 * The sentence for a transcription failure, in the reader's own terms.
 *
 * Four cases, in this order, because the order is the precedence: the status the
 * relay reported is evidence about THIS app's account, while the body it relayed
 * is the upstream provider's own words about a different account. A 402 body that
 * happens to mention quotas is still a Radient billing refusal.
 *
 * 1. 402 - Radient refused to pay for the request. Nothing the reader does with
 *    the provider fixes this one.
 * 2. 401/403 - the server answered and refused this app's credential, which is a
 *    re-sign-in rather than a retry.
 * 3. The upstream provider's out-of-credits family, named after the provider
 *    when its own error text names one.
 * 4. Anything else - the server's message, clipped. Never a raw dump: the body
 *    can be an endpoint URL plus a whole JSON document, and a toast is one line.
 */
export function transcriptionFailureMessage(error: unknown): string {
	const status =
		error instanceof TranscriptionRequestError ? error.status : null;
	if (status === 402) return OUT_OF_RADIENT_CREDITS;
	if (status === 401 || status === 403) return SIGN_IN_REFUSED;

	const detail = error instanceof Error ? error.message : "";
	const flat = flatten(detail);
	if (flat === "") return NO_DETAIL;
	if (OUT_OF_CREDITS.test(flat)) {
		const provider = upstreamProvider(flat);
		return provider === null
			? TRANSCRIPTION_ACCOUNT_OUT_OF_CREDITS
			: `Transcription failed: the ${provider} account is out of credits. Add credits to it, then try again.`;
	}
	if (REFUSED_SIGN_IN.test(flat)) return SIGN_IN_REFUSED;
	return `Transcription failed: ${clip(flat)}`;
}

/** Radient will not fund the request until the account is topped up. */
const OUT_OF_RADIENT_CREDITS =
	"Transcription failed: you're out of Radient credits. Add credits to continue.";

/**
 * The server answered and refused this app's bearer.
 *
 * One sentence for both the 401/403 arm and the body-says-so arm: a reader who
 * has to sign in again does not care which layer noticed.
 */
const SIGN_IN_REFUSED =
	"Transcription failed: the server refused this app's sign-in. Sign in to Radient again, then try again.";

/** A provider's out-of-credits refusal whose own text named no provider. */
const TRANSCRIPTION_ACCOUNT_OUT_OF_CREDITS =
	"Transcription failed: the transcription account is out of credits. Add credits to it, then try again.";

/** Nothing to quote, and no cause worth guessing at. */
const NO_DETAIL = "Transcription failed. Please try again.";

/**
 * The ways an upstream provider says "the account has no money on it".
 *
 * Deliberately a family rather than one string: the operator's case was OpenAI's
 * `insufficient_quota`, and every provider words this differently.
 */
const OUT_OF_CREDITS =
	/insufficient_quota|insufficient funds|no credits remaining|exceeded your current quota|out of credits|billing (?:hard )?limit|credit balance is too low/i;

/**
 * The ways an upstream provider says "the credential is not accepted".
 *
 * Only consulted when the body is what the reader has to go on - a 401/403 from
 * the relay's own layer never reaches here.
 */
const REFUSED_SIGN_IN =
	/unauthorized|invalid[ _-]?api[ _-]?key|incorrect api key|no api key|authentication|permission denied|forbidden/i;

/**
 * The upstream provider's name, as its own error text spells it.
 *
 * Reads the `"<Provider> API error (<code>): <message>"` shape the relay forwards
 * (the operator's body was `OpenAI API error (insufficient_quota): You have no
 * credits remaining...`). Narrow on purpose: a pattern that guessed at any
 * capitalised word would name the wrong actor in the sentence that tells the
 * reader where to go. No match means the copy names no provider at all.
 */
const UPSTREAM_PROVIDER =
	/^([A-Za-z][A-Za-z0-9&.+_-]*(?: [A-Za-z][A-Za-z0-9&.+_-]*){0,2}) API error\b/;

/** Where the sentence stops, before a toast becomes a document. */
const MAX_DETAIL_CHARS = 140;

/** The last space a clip may fall back to, so it does not cut mid-word. */
const MIN_CLIP_CHARS = 60;

/**
 * One line of prose.
 *
 * A relayed body can carry newlines and runs of indentation (a URL, then a JSON
 * document); a toast renders them as one run-on line, so the collapse happens
 * here rather than in CSS.
 */
function flatten(detail: string): string {
	return detail.replace(/\s+/g, " ").trim();
}

/** The provider named by an upstream error body, or null. */
function upstreamProvider(detail: string): string | null {
	return UPSTREAM_PROVIDER.exec(detail)?.[1] ?? null;
}

/**
 * The server's message, short enough to read.
 *
 * Clipped at a word boundary when one is available past `MIN_CLIP_CHARS`, and
 * always with a visible ellipsis: a silently cut sentence reads as the server's
 * own text, which is the one thing this must not be mistaken for.
 */
function clip(detail: string): string {
	if (detail.length <= MAX_DETAIL_CHARS) return detail;
	const cut = detail.slice(0, MAX_DETAIL_CHARS);
	const lastSpace = cut.lastIndexOf(" ");
	const head = lastSpace > MIN_CLIP_CHARS ? cut.slice(0, lastSpace) : cut;
	return `${head.trimEnd()}…`;
}
