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
		 *
		 * AND THE INSTRUCTION IS CONDITIONAL, because the sentence's own subject says
		 * the account need not be the reader's (round 2, D9): this app cannot tell a
		 * bring-your-own-key install from a relay install - the relay holds the bearer -
		 * so it cannot know whose account it is naming. A flat "Top it up" asked a
		 * reader the sentence itself had just excluded to go and fund a third-party
		 * account, which is the actionability defect this whole change exists to delete,
		 * one clause down. "If it's yours" is what makes it true for both readers, and
		 * the closing retry is spent on it rather than kept: at 4 lines this was the
		 * tallest toast in the set and ended on a one-word widow (round 2, D10).
		 */
		if (destination !== null)
			return provider === null
				? `Dictation failed: the account behind dictation is out of credits. If it's yours, top it up at ${destination}.`
				: `Dictation failed: the ${provider} account behind dictation is out of credits. If it's yours, top it up at ${destination}.`;
		return TRANSCRIPTION_ACCOUNT_OUT_OF_CREDITS;
	}
	if (REFUSED_SIGN_IN.test(flat)) return SIGN_IN_REFUSED;
	/*
	 * The reason's own full stop is dropped before the action is appended, and a
	 * CLIPPED reason takes a space instead: `… .` is not a sentence boundary,
	 * it is a rendering artefact.
	 */
	const reason = lowerOpening(reasonFrom(flat));
	const end = reason.endsWith("…") ? " " : ". ";
	return `Dictation failed: ${reason.replace(TRAILING_FULL_STOP, "")}${end}${UNKNOWN_ACTION}`;
}

/**
 * The reason's own opening capital, lowered into the family's shape.
 *
 * Every sibling sentence starts lowercase after `Dictation failed: ` (round 2,
 * D11), and a passed-through reason does not: the relayed body's own sentence
 * begins with a capital, and quoting it verbatim is what made this frame the one
 * place the family's shape broke. The reason is still the server's words - only its
 * first letter moves, and only when doing so cannot corrupt them: a word with a
 * capital anywhere but its first letter is a brand or an acronym (`OpenAI API
 * error`, `HTTP 500`, `JSON`), and "openAI" is not the provider's name. Those keep
 * their own case and take the family's shape from the same colon every sibling has.
 */
function lowerOpening(reason: string): string {
	const [word] = OPENING_WORD.exec(reason) ?? [];
	if (word === undefined || word.length < 2) return reason;
	/*
	 * A capital ANYWHERE BUT THE FIRST LETTER is the tell, and it is checked over the
	 * whole word rather than the leading run of lowercase letters: the first cut of
	 * this rule matched `OpenAI` as `Open`, found no capital inside that prefix, and
	 * rendered the provider as "openAI".
	 */
	if (INTERNAL_CAPITAL.test(word.slice(1))) return reason;
	if (!OPENING_CAPITAL.test(word)) return reason;
	return reason[0].toLowerCase() + reason.slice(1);
}

/** The reason's first word, which is the whole of what this rule inspects. */
const OPENING_WORD = /^[\p{L}\p{N}'’-]+/u;
/** A capital or a digit past the first letter: a brand or an acronym's own spelling. */
const INTERNAL_CAPITAL = /[\p{Lu}\p{N}]/u;
/** A word opening in a capital, the only shape this rule lowers. */
const OPENING_CAPITAL = /^\p{Lu}/u;

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
	"Dictation failed: you're out of Radient credits. Get more credits, then try again.";

/**
 * The server answered and refused this app's credential.
 *
 * One sentence for both the 401/403 arm and the body-says-so arm: a reader who
 * has to sign in again does not care which layer noticed.
 *
 * In the reader's terms rather than the machine's: "the server refused this
 * app's sign-in" was the product describing itself from the outside, in the one
 * sentence whose whole job is to make a person recognise their own credential
 * (review round 1, D4). The doubled "again" the first revision of this sentence
 * carried ("Sign in to Radient again, then try again", round 2's D12) is gone with
 * it: the credential was refused, so the action is the sign-in, and the retry is
 * the family's one closing verb.
 */
const SIGN_IN_REFUSED =
	"Dictation failed: your Radient sign-in was refused. Sign in to Radient, then try again.";

/**
 * A provider's out-of-credits refusal that names no destination.
 *
 * Account-neutral on purpose: the app cannot know whose account this is - the
 * relay holds the bearer - so it names the account by what it does rather than
 * implying it is the reader's own (review round 1, D1), and the one action
 * available when the body names no surface is conditional for the same reason
 * (round 2, D9): "top it up" is advice the reader can take only if the account is
 * theirs, and the sentence has just said it may not be.
 */
const TRANSCRIPTION_ACCOUNT_OUT_OF_CREDITS =
	"Dictation failed: the account behind dictation is out of credits. If it's yours, top it up.";

/**
 * Nothing to quote, and no cause worth guessing at.
 *
 * NOT the sentence this change deletes, and not a near-clone of it either: "try
 * again" as the whole advice is precisely what cost the operator a day, so the
 * absence of a reason is stated as the absence it is (review round 1, D7). Its own
 * prefix is the family's colon rather than a comma (round 2, D12): one shape for
 * the five sentences that open `Dictation failed:` reads as one voice.
 */
const NO_REASON =
	"Dictation failed: the server gave no reason. Try again, or report it with the app's log.";

/**
 * What to do about a failure whose cause the app cannot name.
 *
 * The raw body stays on `error.message` for the logs and for support, so the toast
 * does not have to carry it - but it does have to say what to do with it (review
 * round 1, D2), and WHERE it goes (round 2, D8). The first revision named "the
 * console detail", and the app as shipped has no console: DevTools are
 * `isDev`-only (`src/main/index.ts`, both the `devTools` option and the View menu
 * item), so the reader could not open the surface the sentence named. What does
 * hold the detail is the app's own log - the main process forwards renderer
 * warnings and errors to a durable file (`console-message` -> `LogFileType.BACKEND`,
 * which is the `backend-service.log` support already asks for), so the sentence
 * names the artifact that exists.
 */
const UNKNOWN_ACTION = "Try again, or report it with the app's log.";

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
 * MEASURED, not chosen: at 1280x720 CSS the toast is Sonner's default 356 CSS px
 * wide with a text column of about 318 px, which holds 43-44 characters of this
 * type at this line height - so the fallback's fixed halves (`Dictation failed: `
 * and the action) take most of two lines, and the bound keeps the ordinary failure
 * at the three lines the re-captured frame shows. The earlier revision of this
 * comment derived the same bound from a wrong measurement ("83.2 CSS px against a
 * 40 px one-line toast", "about 50 characters", which described the toast at a
 * `devicePixelRatio` of 2.5 rather than the 2 the frames are shot at); the bound
 * itself was never in question, and the reason it is 80 rather than 50 is that a
 * reason clipped mid-phrase is worse than a third line.
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
