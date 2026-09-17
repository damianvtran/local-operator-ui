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
 * any future log reader still sees it; `status` is carried separately because the
 * refusal's own status is evidence the body cannot supply - the Radient
 * out-of-credits refusal is an HTTP 402 whose message this app does not own the
 * wording of.
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
 * Four cases, in this order, BECAUSE THE ORDER IS THE PRECEDENCE and a case that
 * matches two families must be pinned by a test rather than by this comment
 * alone (review round 1, R5). The status the relay reported is evidence about
 * THIS app's account, while the body it relayed is the provider's own words about
 * a different account, so the status is consulted first.
 *
 * 1. 402 - Radient refused to pay for the request. Nothing the reader does with
 *    the provider fixes this one.
 * 2. 401/403 - the server answered and refused this app's credential, which is a
 *    re-sign-in rather than a retry.
 * 3. The provider's out-of-credits family, named after the provider when its own
 *    error text names one, and pointing at the destination that text gives.
 * 4. Anything else - the reason inside the server's message, then an action.
 *
 * WHY THE BODY FAMILIES ARE ORDERED THIS WAY, stated because a body can match
 * both ("Unauthorized: no credits remaining"): the credits family names a cause
 * and a cure, while "unauthorized" is a wrapper nearly every upstream refusal
 * arrives in, so the specific cause wins and the reader is told to top the
 * account up rather than to sign in again - a sign-in that would not help.
 */
export function transcriptionFailureMessage(error: unknown): string {
	const status =
		error instanceof TranscriptionRequestError ? error.status : null;
	if (status === 402) return OUT_OF_RADIENT_CREDITS;
	if (status === 401 || status === 403) return SIGN_IN_REFUSED;

	const detail = error instanceof Error ? error.message : "";
	const flat = flatten(detail);
	if (flat === "") return NO_REASON;
	if (OUT_OF_CREDITS.test(flat)) {
		const provider = upstreamProvider(flat);
		const destination = billingDestination(flat);
		/*
		 * The destination is the whole difference between an instruction and a
		 * shrug: the operator's own refusal carried
		 * `platform.openai.com/account/billing`, and the first cut of this copy
		 * dropped it in favour of "add credits to it", which names no surface and
		 * reads as if the account were the reader's own (review round 1, D1). A
		 * destination too long for a toast is not named at all - the neutral
		 * sentence below is better than half a URL.
		 */
		if (destination !== null)
			return provider === null
				? `Dictation failed: the account behind dictation is out of credits. Top it up at ${destination}, then try again.`
				: `Dictation failed: the ${provider} account behind dictation is out of credits. Top it up at ${destination}, then try again.`;
		return TRANSCRIPTION_ACCOUNT_OUT_OF_CREDITS;
	}
	if (REFUSED_SIGN_IN.test(flat)) return SIGN_IN_REFUSED;
	/*
	 * The reason's own full stop is dropped before the action is appended, and a
	 * CLIPPED reason takes a space instead: `… .` is not a sentence boundary,
	 * it is a rendering artefact.
	 */
	const reason = reasonFrom(flat);
	const end = reason.endsWith("…") ? " " : ". ";
	return `Dictation failed: ${reason.replace(TRAILING_FULL_STOP, "")}${end}${UNKNOWN_ACTION}`;
}

/** A quoted reason's own sentence end, which the action's own full stop replaces. */
const TRAILING_FULL_STOP = /\.$/;

/**
 * Radient will not fund the request until the account is topped up.
 *
 * The product's own words for this, reused rather than re-invented: the app
 * already has a low-credits surface titled "Running low on Radient credits?"
 * whose call to action is "Get more credits", and a third phrasing for the same
 * thing beside it makes the reader learn the same fact twice (review round 1,
 * D3).
 */
const OUT_OF_RADIENT_CREDITS =
	"Dictation failed: you're out of Radient credits. Get more credits, then try dictating again.";

/**
 * The server answered and refused this app's credential.
 *
 * One sentence for both the 401/403 arm and the body-says-so arm: a reader who
 * has to sign in again does not care which layer noticed.
 *
 * In the reader's terms rather than the machine's: "the server refused this
 * app's sign-in" was the product describing itself from the outside, in the one
 * sentence whose whole job is to make a person recognise their own credential
 * (review round 1, D4).
 */
const SIGN_IN_REFUSED =
	"Dictation failed: your Radient sign-in was refused. Sign in to Radient again, then try again.";

/**
 * A provider's out-of-credits refusal that names no destination.
 *
 * Account-neutral on purpose: the app cannot know whose account this is - the
 * relay holds the bearer - so it names the account by what it does rather than
 * implying it is the reader's own (review round 1, D1). "Top it up" is the only
 * action available when the body names no surface.
 */
const TRANSCRIPTION_ACCOUNT_OUT_OF_CREDITS =
	"Dictation failed: the account behind dictation is out of credits. Top it up, then try again.";

/**
 * Nothing to quote, and no cause worth guessing at.
 *
 * NOT the sentence this change deletes, and not a near-clone of it either: "try
 * again" as the whole advice is precisely what cost the operator a day, so the
 * absence of a reason is stated as the absence it is (review round 1, D7).
 */
const NO_REASON =
	"Dictation failed, and the server gave no reason. Try again, or report it with the console detail.";

/**
 * What to do about a failure whose cause the app cannot name.
 *
 * The raw body is already on the console (`console.error` at both call sites),
 * so the toast does not have to carry it - but it does have to say what to do
 * with it (review round 1, D2).
 */
const UNKNOWN_ACTION = "Try again, or report it with the console detail.";

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
 * the relay's own layer never reaches here. Checked AFTER the credits family; see
 * the mapper's own note on why that order is the precedence.
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
 * reader where to go. No match means the copy names the provider generically.
 */
const UPSTREAM_PROVIDER =
	/^([A-Za-z][A-Za-z0-9&.+_-]*(?: [A-Za-z][A-Za-z0-9&.+_-]*){0,2}) API error\b/;

/** The destination a refusal gives, if it gives one. */
const DESTINATION_URL = /\bhttps?:\/\/[^\s"'<>),]+/;

/** What the scheme in front of a destination costs a toast that cannot link. */
const URL_SCHEME = /^https?:\/\//;

/** A destination's own closing punctuation, which is not part of the address. */
const TRAILING_PUNCTUATION = /[.,;:]+$/;

/**
 * How long a destination may be before the sentence stops naming it.
 *
 * A URL the toast cannot show in full is not a destination: the reader would get
 * a truncated host to retype. When the body's own pointer is longer than this the
 * copy falls back to the account-neutral sentence, which promises nothing.
 */
const MAX_DESTINATION_CHARS = 40;

/**
 * Where the reason stops, before a toast becomes a document.
 *
 * MEASURED, not chosen: the toast's text column holds about 50 characters, the
 * sentence's fixed halves (`Dictation failed: ` and the action) take 67, and the
 * frames this replaces were four-line dumps of URL and JSON punctuation (review
 * round 1, D2, which measured 83.2 CSS px against a 40 px one-line toast).
 * Bounding the reason here keeps the ordinary failure the height of its
 * predecessor.
 */
const MAX_DETAIL_CHARS = 80;

/** The last space a clip may fall back to, so it does not cut mid-word. */
const MIN_CLIP_CHARS = 40;

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
 * Where the refusal itself tells the reader to go, or null.
 *
 * Scheme-stripped because the toast has no link slot: `platform.openai.com/...`
 * is what a person can act on, and `https://` in front of it is 8 characters of
 * a three-line box spent on nothing.
 */
function billingDestination(detail: string): string | null {
	const match = DESTINATION_URL.exec(detail)?.[0];
	if (match === undefined) return null;
	const stripped = match
		.replace(URL_SCHEME, "")
		.replace(TRAILING_PUNCTUATION, "");
	if (stripped === "" || stripped.length > MAX_DESTINATION_CHARS) return null;
	return stripped;
}

/**
 * The reason inside the server's own answer, without the relay's wrapper.
 *
 * Two shapes arrive here. A JSON body - the provider's own document, forwarded
 * verbatim - carries its reason in one field, and dumping the document instead
 * is how the frame showed four lines of punctuation with the answer buried on
 * line three and clipped (review round 1, D2). A prose body is quoted as it
 * stands, minus the `POST <url> returned 400 ` the relay puts in front of it.
 */
function reasonFrom(detail: string): string {
	const quoted = quotedMessage(detail);
	if (quoted !== null) return clip(flatten(quoted));
	const unwrapped = detail.replace(RELAY_WRAPPER, "").trim();
	return clip(unwrapped === "" ? detail : unwrapped);
}

/** The relay's own framing of a failed request, which names no cause. */
const RELAY_WRAPPER =
	/^(?:GET|POST|PUT|PATCH|DELETE|HEAD)\s+\S+\s+returned\s+\d{3}\s*/i;

/**
 * The `message` a JSON body carries, when the body is JSON.
 *
 * `error.message` first (`{"error":{"message":...}}`, what every provider this
 * relay fronts sends), then a bare `message`. Returns null for anything that is
 * not a JSON object at all, so a prose body keeps its own words.
 */
function quotedMessage(detail: string): string | null {
	const start = detail.indexOf("{");
	const end = detail.lastIndexOf("}");
	if (start === -1 || end <= start) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(detail.slice(start, end + 1));
	} catch {
		return null;
	}
	const record = parsed as { message?: unknown; error?: unknown } | null;
	if (typeof record?.message === "string" && record.message.trim() !== "")
		return record.message;
	const nested = (record?.error ?? null) as { message?: unknown } | null;
	if (typeof nested?.message === "string" && nested.message.trim() !== "")
		return nested.message;
	return null;
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
