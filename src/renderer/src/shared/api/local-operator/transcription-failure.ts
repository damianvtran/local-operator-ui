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

import { t } from "../../../../../i18n";
import {
	DESKTOP_REFUSAL_CODE,
	isDesktopRefusalCode,
} from "../../../../../shared/desktop-contract";

/**
 * A refused transcription, carrying the three things the copy and the retry
 * policy need.
 *
 * `Error.message` keeps the server's own `detail` verbatim so the console and
 * any future log reader still sees it; `status` is carried separately because the
 * refusal's own status is evidence the body cannot supply - the Radient
 * out-of-credits refusal is an HTTP 402 whose message this app does not own the
 * wording of.
 *
 * `code` is the third: a media refusal the DESKTOP PLANE composed rather than one
 * the daemon answered ("this app holds no token", "the server did not answer")
 * arrives on the same wire and with a status of its own, so the code travels
 * beside it. Without it a pairing fact wearing a 503 would be read as a temporary
 * server fault and retried twice before the sentence that names the real fix
 * (#1087 review: `isTransientTranscriptionFailure` must never retry what the
 * plane refused).
 *
 * Typed as a class rather than a shape so a caller cannot mistake an unrelated
 * `Error` for one of these: the mapper below reads `status` only from this type
 * and treats every other throwable as "no status".
 *
 * `status` is a plain number, not `number | null`: the one production
 * constructor (`transcription-api.ts`) always passes the relay's own numeric
 * status, including the 503 the desktop plane composes for a transport failure.
 * A `null` arm used to sit in the classifier for "nothing answered"; nothing
 * could reach it (#1087 review round 1, NIT 1), and an arm no production shape
 * can produce is a shape pinned by a test rather than by the app.
 */
export class TranscriptionRequestError extends Error {
	/** The HTTP status the relay saw. */
	readonly status: number;

	/** The pairing/link refusal this was, when the desktop plane wrote it. */
	readonly code?: string;

	constructor(status: number, detail: string, code?: string) {
		super(detail);
		this.name = "TranscriptionRequestError";
		this.status = status;
		this.code = code;
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
 * 4. The transient class (`isTransientTranscriptionFailure`) FOR THE ONE SHAPE it
 *    was written for - a 5xx wrapped around a JSON document, which is how #1087
 *    arrived: the only failure a person fixes by doing the same thing again, and
 *    the one the client has already retried.
 * 5. Anything else - the reason inside the server's message, then an action.
 *
 * WHY THE TRANSIENT CLASS NO LONGER ANSWERS FOR EVERY 5xx (review round 1, gap b).
 * It used to be asked first, and because "is this retryable" answers TRUE for the
 * whole 5xx band it rewrote EVERY 5xx into the one sentence - the provider's own
 * `Could not decode the audio file.`, `The audio could not be decoded.`, and a 5xx
 * that sent no words at all all came out as "the transcription service had a
 * temporary fault". That is a diagnosis the app has not made: a 500 carrying a
 * reason HAS told us what went wrong, and discarding the reason to announce the
 * class is the same loss of the server's words this module was written to end,
 * pointed the other way. Retryability and sayability are different questions, and
 * the class answers only the first. A 5xx with a real sentence is quoted below;
 * one with an empty body states the absence; the class's sentence is kept for the
 * relay's own wrapper, whose "Upstream responded 500: {...}" is scaffolding rather
 * than a reason a reader can use.
 *
 * Both orderings matter and both are load-bearing: the named families sit above
 * the transient check because a refusal carried by a gateway is still a refusal,
 * and the transient check sits above the generic quote because the wrapper text
 * quotes as noise.
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
	if (status === 402) return outOfRadientCredits();
	if (status === 401 || status === 403) return signInRefused();

	const detail = error instanceof Error ? error.message : "";
	const flat = flatten(detail);
	/*
	 * THE FAULT THAT IS NOBODY'S DECISION (#1087). A 502 from the relay is the
	 * daemon saying it could not finish the request at the upstream hop, and the
	 * body it relays carries that hop's own status. The operator's case was a 500
	 * from the billing-account check - a fault that clears on its own - and it
	 * reached the reader as `Dictation failed: transcription failed upstream.
	 * Upstream responded 500: {"error":"failed to check billing account"...`,
	 * clipped mid-JSON, with "report it with the app's log" as the action: a
	 * transient fault wearing a permanent refusal's clothes.
	 *
	 * The client retries this class (`createTranscriptionWithRetry`), so by the
	 * time this sentence is on screen the retries are spent, and the two things
	 * left to say are that the fault was temporary and that trying again is the
	 * action.
	 *
	 * IT IS ASKED HERE, after every named family and before the generic quote - see
	 * the precedence note above. What reaches it is the relayed 5xx wrapped around a
	 * JSON document, which is the shape #1087 arrived in and the one this sentence
	 * was written for.
	 *
	 * RETRYABILITY AND SAYABILITY ARE DIFFERENT QUESTIONS, and only the first is the
	 * class's to answer. `isTransientTranscriptionFailure` says yes to the whole 5xx
	 * band because that is the band a retry can help, so gating this sentence on it
	 * alone made EVERY 5xx say "temporary fault" - a provider's own "Could not
	 * decode the audio file." included, which has diagnosed itself and whose words
	 * the reader needs. The guard is therefore the wrapper shape, not the class
	 * alone: a 5xx carrying a real sentence is quoted below, a 5xx carrying the
	 * relay's scaffolding and a JSON document gets this sentence, and an empty body
	 * states the absence rather than inventing a cause it was not given - the
	 * invariant `transcription-failure-copy.test.mjs` pins, which a PR fixing
	 * retries has no business rewriting.
	 */
	if (flat === "") {
		return noReason();
	}
	if (
		UPSTREAM_STATUS_ONLY.test(flat) &&
		isTransientTranscriptionFailure(error)
	) {
		return upstreamTemporary();
	}
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
				? t("ui.common.errors.dictation_credits_destination", { destination })
				: t("ui.common.errors.dictation_provider_credits_destination", {
						provider,
						destination,
					});
		return t("ui.common.errors.dictation_account_credits");
	}
	if (REFUSED_SIGN_IN.test(flat)) return signInRefused();
	/*
	 * The reason's own full stop is dropped before the action is appended, and a
	 * CLIPPED reason takes a space instead: `… .` is not a sentence boundary,
	 * it is a rendering artefact.
	 */
	const reason = lowerOpening(reasonFrom(flat)).replace(TRAILING_FULL_STOP, "");
	return reason.endsWith("…")
		? t("ui.common.errors.dictation_unknown_clipped", { reason })
		: t("ui.common.errors.dictation_unknown", { reason });
}

/**
 * Whether a failed transcription is worth sending again exactly as it stands.
 *
 * The audio is still here, so a retry costs a request and nothing of the user's:
 * `TranscriptionApi.createTranscriptionWithRetry` re-sends the same take, and the
 * composer keeps it for a manual retry once the automatic ones are spent. Before
 * #1087 nothing retried: a transient upstream 500 arrived as a permanent-looking
 * refusal and the take sat in state with no control that could reach it, so the
 * user's only route was to record again.
 *
 * It answers TRUE for a 5xx the daemon or the upstream hop produced. The daemon
 * documents the split (`stt/errors.py`, `failure_status_and_detail`): 502 is "the
 * upstream call failed" - a provider fault, a Radient edge rejection, or a
 * transport failure that never reached the upstream - 402 is a credit/quota
 * decision, and 500 is left for its own internal faults. A 503/504 is the same
 * class one hop out (the desktop relay's own transport refusal carries a CODE and
 * is excluded above; a bare gateway 503 is time-fixable). The upstream's own 5xx
 * also reaches the client INSIDE the body (`Upstream responded 500: ...`) when it
 * rides a different carrier, which is the second half of the answer.
 *
 * It answers FALSE first, and deliberately, for every REFUSAL: a decision does
 * not become temporary by riding a gateway status. Four shapes say so - a refusal
 * the desktop plane composed (its `code`), the 402/401/403 statuses, the two body
 * families above, and the daemon's own 4xx wordings relayed through a 502 (`The
 * transcription request was refused upstream (HTTP 400)`, `Upstream responded
 * 403: ...`, `refused the request (403)`). Retrying those spends the reader's
 * time and the account's rate limit on a request that cannot start working.
 *
 * THE RULE READS AS ONE GATE, NOT THREE (review round 1, gap b). The first cut
 * named 401/402/403 as its 4xx exclusions and left the real ceiling to the last
 * line (`status >= 500`), so 404, 409 and 422 were in fact already refused - but
 * a reader who stopped at the exclusion list would believe the opposite, and a
 * later edit that moved that last line would quietly make them retryable. The 4xx
 * band is now stated once, as a range, in the place the reader looks for it.
 * Enumerating the DENIED statuses was the wrong shape of rule: it can only be
 * right about the codes someone remembered. Enumerating the RETRIED ones cannot be
 * wrong about a code nobody thought of, and the ceiling is deliberately narrow -
 * if a 4xx ever turns out to clear on its own (429 with a Retry-After is the
 * arguable one), that is a new fact and it should have to be added here on
 * purpose, with the test's sweep updated to say why.
 */
export function isTransientTranscriptionFailure(error: unknown): boolean {
	/*
	 * A PAIRING REFUSAL IS NOT A SERVER FAULT. The desktop plane composes these
	 * itself (`desktop-api.ts` -> `mediaError`): no credential, a refused
	 * credential, or a plane that does not accept controls. They carry statuses
	 * that overlap the gateway class (503 above all), and retrying them cannot fix
	 * the pairing they name.
	 *
	 * `transport.failed` IS NOT ONE OF THEM (#1087 review round 1, F3). The
	 * desktop contract says so explicitly (`desktop-contract.ts`, on
	 * `DESKTOP_REFUSAL_CODE.transportFailed`): a refused socket or a reset
	 * establishes nothing about the daemon's plane, so it is the one failure whose
	 * own class is "ask again". Excluding the whole code table made a daemon
	 * restart strand the take with no attempt and no control - #1087's exact
	 * symptom, one transport hop along. Only the three pairing codes are refused
	 * here; the transport code falls through to the 5xx allow-list below.
	 */
	if (!(error instanceof TranscriptionRequestError)) return false;
	if (
		isDesktopRefusalCode(error.code) &&
		error.code !== DESKTOP_REFUSAL_CODE.transportFailed
	)
		return false;
	const status = error.status;
	/*
	 * EVERY 4xx IS FINAL, and said as a range rather than as the three statuses
	 * this rule used to name. The relay re-frames an upstream 4xx as its own
	 * 4xx or as a 502 carrying the refusal in the body, so a 4xx that reaches
	 * here is still a decision about THIS request - the one question a retry
	 * cannot re-ask and get a different answer to.
	 */
	if (status >= 400 && status <= 499) return false;
	const flat = flatten(error.message);
	if (OUT_OF_CREDITS.test(flat) || REFUSED_SIGN_IN.test(flat)) return false;
	if (UPSTREAM_REFUSAL.test(flat)) return false;
	/*
	 * THE ALLOW-LIST: a 5xx. There is no "no status" arm here because there is no
	 * such shape: the relay always reports a status, and a thrown transport error
	 * reaches the renderer as the desktop plane's own 503 (handled above).
	 */
	return status >= 500 && status <= 599;
}

/**
 * What a TRANSIENT fault says, and the only sentence in the set whose action is
 * a retry.
 *
 * The class is the one failure a person can fix by doing the same thing again,
 * so the sentence names the fault as temporary and then names the action - a
 * retry, which the composer hands back as a control on the retained take. It says
 * "the transcription service" rather than the upstream hop because the retried
 * class includes the daemon's own 5xx (`stt/errors.py` leaves 500 for its internal
 * faults); naming a hop the failure may not have reached would be a diagnosis the
 * app cannot make. It does not quote the body either: the truncated JSON that used
 * to stand here was the diagnostic, and it read as a refusal. That body still
 * reaches the console and the app's log on `error.message`.
 *
 * THE SENTENCE IS KEYED AND READ AT CALL TIME (#1087 review round 1, D5). The
 * control beside it was already `ui.common.actions.retry`, so an English sentence
 * with a translated button was the one mixed-language row in the family. `t()` is
 * called inside the function rather than at module load: a module-scope lookup
 * would freeze whichever locale the bundle happened to evaluate under.
 */
function upstreamTemporary(): string {
	return t("ui.chat.composer.dictation_failed_transient");
}

/**
 * The sentence a surface shows when it can spend the retained take (#1087).
 *
 * THE ROW AND THE TOAST SAY DIFFERENT THINGS ON PURPOSE (design round 1, D1). The
 * toast has no control, so its sentence ends by naming the action the reader must
 * take somewhere else ("Try again."). The row sits beside a `Retry` control and
 * gets its own sentence instead: that the take survived the failure, and that the
 * control is what sends it again. Repeating the toast's imperative under a second
 * label 11px away named the same action twice and left the one fact this state
 * exists for - the recording is still here - unsaid.
 *
 * Anything outside the transient class gets the toast's own sentence, so a caller
 * may use this unconditionally and still show the refusal it was given.
 */
export function transcriptionFailureRowMessage(error: unknown): string {
	if (isTransientTranscriptionFailure(error)) {
		return t("ui.chat.composer.dictation_failed_transient_take_kept");
	}
	return transcriptionFailureMessage(error);
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
const outOfRadientCredits = (): string =>
	t("ui.common.errors.dictation_radient_credits");

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
const signInRefused = (): string =>
	t("ui.common.errors.dictation_sign_in_refused");

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

/**
 * The relayed 5xx wrapped around a JSON document, which is scaffolding and not a
 * reason.
 *
 * #1087's body is `Upstream responded 500: {"error":"failed to check billing
 * account"}`: the clause names the hop and the status, and the document is the
 * provider's diagnostic rather than a sentence for a person. Quoting it is what
 * put four lines of clipped punctuation in the toast, and quoting it back
 * unchanged (the other half of review round 1, gap b) is what made the fix stop
 * firing on the case it was written for. A 5xx shaped this way therefore counts as
 * having no usable reason, and takes the class's own sentence; the words still
 * reach the console and the app's log on `error.message`.
 */
const UPSTREAM_STATUS_ONLY =
	/upstream\s+(?:responded|returned)\s+5\d\d\s*:?\s*\{/i;

/**
 * The daemon's wordings for a 4xx REFUSAL from the upstream hop.
 *
 * Three spellings, one per route through `stt/errors.py`: the legacy route's
 * `refused upstream (HTTP 400)`, the direct-provider rungs' `refused the request
 * (403)` / `refused the API key stored for it (HTTP 401)`, and the trailing
 * clause's `Upstream responded 403: ...`. Matched narrowly rather than as "any
 * 4xx in the text" because a provider's JSON error body can carry numbers of its
 * own, and a false positive here would refuse to retry a fault that would have
 * cleared.
 *
 * THE RELAYED BODY'S OWN CODE IS MATCHED TOO (#1087 review round 1, F7). A
 * provider's refusal can arrive re-wrapped as the daemon's 502 with none of the
 * three wordings above, e.g. `{"error":{"code":400,"message":"bad audio"}}`;
 * without this arm that document was retried twice as a temporary server fault.
 * The match is on a `code` field holding a 4xx number, which is the one place a
 * provider states the class machine-readably, and the boundary keeps a 5-digit
 * number out of it.
 */
const UPSTREAM_REFUSAL =
	/refused upstream\s*\(HTTP\s*4\d\d\)|upstream\s+(?:responded|returned)\s+4\d\d|\((?:HTTP\s*)?4\d\d\)|["']code["']\s*:\s*4\d\d\b/i;

/**
 * Nothing to quote, and no cause worth guessing at.
 *
 * NOT the sentence this change deletes, and not a near-clone of it either: "try
 * again" as the whole advice is precisely what cost the operator a day, so the
 * absence of a reason is stated as the absence it is (review round 1, D7). Its own
 * prefix is the family's colon rather than a comma (round 2, D12): one shape for
 * the five sentences that open `Dictation failed:` reads as one voice.
 */
const noReason = (): string => t("ui.common.errors.dictation_no_reason");

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

/**
 * What a SUCCESSFUL transcription that returned no words says (UX round 1,
 * U3). The request did not fail - the take simply held no speech - so this is
 * shown as info, not as an error, and the remedy it names is the one that can
 * actually help (speak nearer the microphone) rather than "try again", which
 * claims the request failed.
 *
 * Before this, an empty transcript was a SILENT no-op on the exact flow this
 * change teaches: the strip disappeared, the box was unchanged, and nothing
 * said whether the app had heard anything at all - a user reads that as a
 * broken gesture.
 */
export const emptyTranscriptionMessage = (): string =>
	t("ui.common.errors.dictation_empty");
