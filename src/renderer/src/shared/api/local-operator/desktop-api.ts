import { t } from "../../../../../i18n/messages";
import type {
	DesktopMediaRequest,
	DesktopMediaResponse,
	DesktopRequest,
	DesktopResponse,
} from "../../../../../shared/desktop-contract";
import {
	DESKTOP_DEADLINE_EXCEEDED_CODE,
	DESKTOP_FOREGROUND_REQUIRED_CODE,
	DESKTOP_FOREGROUND_REQUIRED_MESSAGE,
	DESKTOP_MACHINE_DETAIL,
	DESKTOP_REFUSAL_CODE,
	SERVE_RELOAD_FENCE_CODE,
	SERVE_RELOAD_FENCE_DETAIL,
	desktopDetailUpdateStalled,
	desktopDetailUpdating,
	desktopEndpoint,
	desktopRefusalCodeForStatus,
	desktopRequestDeadlineDetail,
	desktopRequestTimeoutMs,
	isDesktopRefusalCode,
	isServeReloadFence,
} from "../../../../../shared/desktop-contract";
import {
	SESSION_IS_REMOTE_CAUSE_BUILD_BEHIND,
	SESSION_IS_REMOTE_CODE,
} from "../../../../../shared/desktop-session-contract";
import { DESKTOP_STREAM_DETAIL } from "../../../../../shared/desktop-stream-notice";
import { appendJournalOrderIds } from "../../../../../shared/journal-order-query";
import {
	type SnapshotReceipt,
	deliverSnapshot,
	enterSnapshotRenderer,
} from "../../../../../shared/snapshot-receipt";
import {
	parseDelegatedCleanupNotice,
	useDelegatedCleanupNoticeStore,
} from "../../store/delegated-cleanup-notice-store";
import { desktopRefusalSentence } from "./desktop-refusal-copy";
import { recordedStreamCapabilityFlags } from "./desktop-stream-capabilities";

export type {
	AuthOperation,
	BackendSetting,
	BackendSettings,
	DesktopCapabilities,
	DesktopProvider,
	ProviderMethod,
	VoicePath,
	VoicePathResolution,
	VoicePathRung,
} from "../../../../../shared/desktop-contract";

/*
 * The renderer's own deadline for one op: the transport's deadline plus the margin
 * that covers an IPC round trip main can never report. DEFINED in the shared
 * contract (see `desktopRequestTimeoutMs` there for why), and re-exported from here
 * because this is where its callers import it from.
 */
export { desktopRequestTimeoutMs };

/*
 * THE TRANSPORT'S OWN SENTENCES, authored through the catalogue.
 *
 * `userFacingMessage` returns a `DesktopControlError.message` verbatim for any
 * error that is not a recognised refusal code, so these two sentences reach the
 * banner, the sidebar status feed and every toast exactly as they are built
 * here: English literals shipped as English in every locale (census B8). They are
 * FUNCTIONS, not constants, so the catalogue is read when the failure happens and
 * a locale switch is honoured - a module-level `t()` would freeze whichever
 * language was active at import.
 *
 * The English text is unchanged, and nothing reads these by prose: callers
 * classify by `status` / `code` / the error class (see `isForegroundRequired`),
 * never by comparing the message, which is what keeps a translated sentence from
 * changing any retry or precedence rule. The sentence is fixed at the moment the
 * failure is created; an error object that is kept and shown after a later
 * language change still speaks the language it was raised in.
 */
const desktopBackendOfflineMessage = () =>
	t("ui.common.errors.desktop_backend_offline");
const desktopBackendCompatibilityMessage = () =>
	t("ui.common.errors.desktop_backend_compatibility");

export async function desktopRequest(
	request: DesktopRequest,
): Promise<DesktopResponse> {
	// A rejected IPC call or a dead dev proxy means the request never reached a
	// backend, so there is no HTTP status to report. That is `status: null` --
	// stated here rather than left to fall out of a failed `instanceof` check in
	// the banner, which is how it happened to work before.
	if (window.api?.desktop) {
		try {
			// `ipcRenderer.invoke` settles only when main replies. Main's own fetch
			// deadline covers a backend that accepts and never answers, but nothing
			// covers main never replying at all -- a handler that throws before
			// responding, a crashed or unresponsive main process, or a renderer that
			// outlives its backend service. A `file://` renderer has no network stack
			// in this path either, so there is no ambient timeout to fall back on and
			// the promise stays pending forever. React Query cannot help: `retry`
			// needs a settled rejection, so a request that never settles never
			// retries and never reaches an error state. Every caller then sits on
			// `isLoading` permanently, which is what issue 89 saw as a Settings
			// spinner that never resolves. Bound it here, once, so every desktop
			// control fails honestly instead of hanging.
			return await withDeadline(window.api.desktop.request(request), request);
		} catch (cause) {
			if (cause instanceof DesktopControlError) throw cause;
			/*
			 * Main's own refusal, before the transport is blamed for it.
			 * `desktop-ipc.ts` refuses a read receipt from a window the user cannot
			 * see, and that rejection is not a transport failure: the backend was
			 * never asked, so reporting it as "could not reach the backend process"
			 * tells the reader something false about a perfectly reachable backend
			 * and leaves them nothing to do (QA round 1, Q2). It is re-thrown as
			 * authored copy carrying its own code, which is what makes it
			 * distinguishable from a real transport failure at every caller.
			 */
			if (isForegroundRefusal(cause))
				throw new UserFacingError(
					DESKTOP_FOREGROUND_REQUIRED_MESSAGE,
					DESKTOP_FOREGROUND_REQUIRED_CODE,
				);
			throw new DesktopControlError(
				null,
				desktopBackendOfflineMessage(),
				cause,
			);
		}
	}
	// The development server implements the same operation vocabulary and keeps
	// its bearer server-side. Production never injects a VITE/browser token.
	let response: Response;
	try {
		response = await fetch("/__desktop", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(request),
		});
	} catch (cause) {
		throw new DesktopControlError(null, desktopBackendOfflineMessage(), cause);
	}
	if (!response.ok)
		throw new DesktopControlError(
			response.status,
			desktopBackendCompatibilityMessage(),
		);
	return response.json();
}

/**
 * Reject with the transport's own unreachable state once the deadline passes.
 *
 * `status: null` is the same fact the catch blocks above report -- no backend
 * was reached and there is no HTTP status -- so the compatibility banner reads
 * a stalled control as "not answering" rather than "needs an update". The
 * pending IPC promise is left to settle or not on its own; there is no way to
 * cancel an `invoke`, and abandoning it is exactly the point.
 *
 * THE WHOLE REQUEST, NOT ITS OP, and the difference is a move killed 25 s after
 * it was sent (agent review round 1, F1). `desktopRequestDeadlineMs` sizes the
 * transfer from its own request -- 155 s offload, 425 s copy, 725 s for the wait
 * remedy -- and reads the shape, so a caller that hands it the op string gets the
 * 20 s control budget for the one op the contract documents as legitimately
 * taking minutes. The op form stays for a caller that only has an op (a story, a
 * test); this one has the request in hand.
 *
 * THE GIVE-UP CARRIES ITS CODE, and that is the second half of the same defect:
 * `deadline_exceeded` is one of the move's own unconfirmed codes, and the mesh
 * surface reads it to say "the request was sent, the outcome is unknown" instead
 * of rendering a refusal nobody made. A bare `DesktopControlError(null, …)` has
 * no code, so `meshRefusal` falls to `move_refused` with `unconfirmed: false` and
 * the surface claims a sent move changed nothing -- the inversion the unconfirmed
 * arm exists to prevent. `desktopRequestDeadlineDetail` is where that code and
 * its sentence are authored (`MESH_REFUSAL` vocabulary, one authority per fact).
 */
function withDeadline(
	pending: Promise<DesktopResponse>,
	request: DesktopRequest,
): Promise<DesktopResponse> {
	/*
	 * THE TIMEOUT, NOT THE DEADLINE, and the name says so (agent review round 2, NIT).
	 * `desktopRequestTimeoutMs` is `desktopRequestDeadlineMs + DESKTOP_DEADLINE_MARGIN_MS`
	 * (155 s offload becomes 160 s), and this value feeds BOTH the timer and the sentence
	 * the give-up carries - so "the app waits up to 160 seconds" is what the process
	 * actually did. Named `deadlineMs` it read as the smaller number while holding the
	 * larger one, which is how the round-2 reading of line 145 concluded the copy and the
	 * timer disagreed by the margin; they are the same value.
	 */
	const timeoutMs = desktopRequestTimeoutMs(request);
	let timer: ReturnType<typeof setTimeout>;
	return Promise.race([
		pending,
		new Promise<never>((_, reject) => {
			timer = setTimeout(() => {
				const detail = desktopRequestDeadlineDetail(request.op, timeoutMs);
				reject(
					new DesktopControlError(null, detail.message, undefined, detail.code),
				);
			}, timeoutMs);
		}),
	]).finally(() => clearTimeout(timer));
}

/**
 * A desktop control that came back non-2xx, carrying the STATUS as well as the
 * message. Callers used to get a bare `Error`, so "the backend is old" (404),
 * "it is not running" (503), and "this app cannot authenticate to it" (401)
 * were indistinguishable -- and the compatibility banner asserted the first for
 * all three, offering an "Update backend" action that fixes only one of them.
 */
/**
 * What the transport says when a refusal carried NO sentence of its own.
 *
 * Exported because it is also the one reliable signal that separates "the backend
 * sent prose" from "nothing crossed the wire" - `DesktopControlError.detail` cannot
 * answer that on its own: it is set only when the body's `detail` is an OBJECT, so a
 * `{detail: "..."}` payload carries its sentence in `message` and leaves the field
 * undefined (QA round 3, Q-4). A second literal at the reader would be a second
 * thing to drift from this one.
 */
/* Stable missing-prose sentinel: error state and its consumers compare this
 * value, so only the presentation path may translate it. */
export const DESKTOP_REFUSAL_PLACEHOLDER =
	"This server did not answer the request for its desktop controls.";

const desktopRefusalPlaceholder = (): string =>
	t("ui.common.errors.desktop_refusal_placeholder");

export class DesktopControlError extends Error {
	/**
	 * The HTTP status, or `null` when the request never produced one.
	 *
	 * `null` is a REAL state, not an absence: the IPC call rejected, or the
	 * transport returned no response at all, so the backend was never reached.
	 * It is typed and set here rather than left to a caller's `instanceof`
	 * fallback, because the banner reads exactly this field to tell "the
	 * backend is old" (404) from "it is not running" (null/503) from "this app
	 * cannot authenticate" (401/403). A transport failure previously surfaced
	 * as a bare `Error`, which carried no status and only landed on
	 * "unreachable" because the `instanceof` check failed and the status
	 * defaulted to null -- the right answer reached by accident, and one that
	 * would have broken silently the moment that default changed.
	 */
	readonly status: number | null;

	/**
	 * The underlying transport failure, when there was one.
	 *
	 * Carried explicitly rather than through `Error.cause`: this project targets
	 * ES2020, where that option does not exist.
	 */
	readonly cause?: unknown;
	/** Vetted backend rejection category, distinct from connectivity status. */
	readonly code?: string;
	/**
	 * How long the backend asked this app to wait before repeating the request,
	 * when its answer carried `detail.retry_after_ms` (today only the typed
	 * `runtime_busy` refusal; see `RUNTIME_BUSY_CODE`). Read from the BODY rather
	 * than the `Retry-After` header because main's relay forwards the body and
	 * not the headers, and the backend states the two together with the body
	 * field the more precise of them.
	 */
	readonly retryAfterMs?: number;
	/**
	 * The refusal body's own object, when the backend sent one.
	 *
	 * KEPT (additively) for the one caller that needs a field BEYOND the code and
	 * the sentence: a configuration run's single-flight refusal answers 409 with
	 * the ACTIVE run's `session_id`, and the UI has to re-attach to that id rather
	 * than error. Without this field the id would be unrecoverable — the error
	 * carries only the machine code and the message — and the only alternative
	 * would be parsing an id out of prose the backend owns and may reword (the
	 * mistake `interrupt-turn.ts` records for the old Stop control).
	 *
	 * Typed `unknown` on purpose: this is a transport class, not a vocabulary, and
	 * a caller that reads it owns the narrowing (see `activeRunIdFromRefusal`).
	 */
	readonly detail?: unknown;

	constructor(
		status: number | null,
		message: string,
		cause?: unknown,
		code?: string,
		retryAfterMs?: number,
		detail?: unknown,
	) {
		super(message);
		this.name = "DesktopControlError";
		this.status = status;
		this.cause = cause;
		this.code = code;
		this.retryAfterMs = retryAfterMs;
		this.detail = detail;
	}
}

/**
 * A failure whose `message` is a sentence we wrote for the user.
 *
 * Client-side refusals (the unconfirmed-send guard) never reach the transport,
 * so they cannot be a `DesktopControlError` - but their copy is authored just
 * the same, and `userFacingMessage` has to be able to tell them apart from a
 * runtime exception that merely happens to be an `Error`. The marker is the
 * class, not a duck-typed `code`: Node's own errors carry string `code`s
 * (`ENOENT`, `ERR_INVALID_ARG_TYPE`), so trusting that field would let a crash
 * message through as copy, which is the defect this exists to prevent.
 */
export class UserFacingError extends Error {
	/** Vetted rejection category, read the same way as `DesktopControlError.code`. */
	readonly code?: string;

	constructor(message: string, code?: string) {
		super(message);
		this.name = "UserFacingError";
		this.code = code;
	}
}

/**
 * Whether a caught failure is the Local Operator server updating itself, so a
 * surface should say "updating, back in a moment" rather than report a fault.
 *
 * Two shapes, deliberately kept apart:
 *  - `code === serverUpdating`: the daemon's reload fence refused the request
 *    BEFORE any handler ran (main rewrote the fence answer into this code), so
 *    the request was definitively not processed and repeating it is safe;
 *  - any other code carrying main's display-only `detail.updating` hint
 *    (`markUpdating`): a follow-on failure inside the update window. Its code -
 *    and so every retry/outcome rule - is unchanged; only the sentence is.
 *
 * Callers that decide whether a REPEAT is safe must key on the code, never on
 * this predicate: the second shape includes `transport.failed`, whose outcome
 * is unknown.
 */
export function isServerUpdatingError(error: unknown): boolean {
	if (
		!(error instanceof DesktopControlError || error instanceof UserFacingError)
	)
		return false;
	if (error.code === DESKTOP_REFUSAL_CODE.serverUpdating) return true;
	return (
		error instanceof DesktopControlError && desktopDetailUpdating(error.detail)
	);
}

/**
 * Whether a caught failure is a reload-fence answer main relayed after the
 * server-update window's cap ran out (`desktopDetailUpdateStalled`). Its code is
 * `transport.failed` and its sentence that code's own; only the compatibility
 * banner reads this, to keep speaking where the strip has no row (review M2).
 */
export function isServerUpdateStalledError(error: unknown): boolean {
	return (
		error instanceof DesktopControlError &&
		desktopDetailUpdateStalled(error.detail)
	);
}

/**
 * The sentence to show a user for a caught failure, or `fallback`.
 *
 * A thrown value is only copy when we know who wrote it. `DesktopControlError`
 * carries either the backend's own `detail` or a sentence this transport wrote
 * for a case it recognises, and `UserFacingError` is copy by construction -
 * everything else is a runtime exception whose `message` is a stack-trace
 * fragment. Rendering that states the failure in the language of the crash
 * rather than the user's: with the backend stopped the composer read
 * "TypeError: fetch failed", which tells the user nothing and nothing to do
 * (branding section 8: an error that only quotes an exception is unfinished).
 *
 * Lives beside `DesktopControlError` because this is the one place that knows
 * which messages are authored; a second copy of that judgement elsewhere is
 * how a raw exception finds its way back to the screen.
 */
export function userFacingMessage(error: unknown, fallback: string): string {
	/*
	 * THE SERVER IS UPDATING: checked before the pairing translation below, because
	 * inside main's server-update window a plane-closed 503 or a transport failure
	 * is the update's own tail (a claimed daemon not yet re-claimed, a reset as the
	 * old image exec'd), and its pairing sentence is the false alarm the operator
	 * reported. Only the SENTENCE changes - `error.code` is untouched, so every
	 * retry and outcome rule keyed on it reads exactly what it read before.
	 */
	if (isServerUpdatingError(error))
		return desktopRefusalSentence(DESKTOP_REFUSAL_CODE.serverUpdating);
	if (
		error instanceof DesktopControlError ||
		error instanceof UserFacingError
	) {
		/*
		 * A REFUSAL of the pairing family is composed from its code, never echoed.
		 *
		 * `error.message` for one of these is whatever the DAEMON chose to say about
		 * it - the photographed sidebar line was the server's own prose about the
		 * desktop app's ownership - and rendering that as this app's diagnosis is the
		 * defect § 5.1 exists to remove. The code is the machine fact; the sentence is
		 * this app's. Every one of the nine surfaces that can receive a desktop error
		 * reaches the sentence through HERE, which is why the translator lives here
		 * rather than at nine call sites.
		 */
		if (isDesktopRefusalCode(error.code))
			return desktopRefusalSentence(error.code);
		if (error.message === DESKTOP_REFUSAL_PLACEHOLDER)
			return desktopRefusalPlaceholder();
		return error.message;
	}
	return fallback;
}

/**
 * The refusal code a non-2xx answer carries, from the answer itself.
 *
 * A code the TRANSPORT declared (main's own two synthesised refusals) wins, and
 * otherwise the status names one only on a route the desktop plane has to admit:
 * a 503 on `/v1/desktop/` is the plane refusing to serve this app, while the
 * same status on `/v1/tools/speech` is that route's own failure. Telling those
 * apart is the whole point of asking the path - and an app-authored 503 whose
 * sentence we recognise is translated as the app's own fact rather than as the
 * daemon's, which the development proxy (which does not declare a code) needs.
 */
function desktopErrorMessageCode(
	request: DesktopRequest,
	status: number,
	detail: string | null,
	declared: string | undefined,
): string | undefined {
	/*
	 * A code the transport DECLARED always wins, whatever it is: the envelope's
	 * `detail.code` is the server's own category (`unresolved_attachment`, a
	 * `store_busy`, the deadline's `deadline_exceeded`), and re-deriving one from the
	 * status instead would throw away a distinction the answering process made -
	 * which is how a profile conflict's category was lost. The status names a code
	 * only on a route the desktop plane has to admit, and only for the two statuses
	 * that plane uses to refuse this app.
	 *
	 * The app's own two machine sentences are recognised as well, because the
	 * development proxy forwards a refusal body without declaring a code, and "this
	 * app holds no credential" must not be read as "the plane is shut".
	 */
	/*
	 * The reload fence, for a transport that did not rewrite it - the development
	 * proxy forwards the daemon's body verbatim, and a future backend may declare
	 * `serve_reloading` itself. Main already rewrites both into `serverUpdating`.
	 */
	if (declared === SERVE_RELOAD_FENCE_CODE && status === 503)
		return DESKTOP_REFUSAL_CODE.serverUpdating;
	if (typeof declared === "string") return declared;
	if (detail === SERVE_RELOAD_FENCE_DETAIL && status === 503)
		return DESKTOP_REFUSAL_CODE.serverUpdating;
	if (detail === DESKTOP_MACHINE_DETAIL.noCredential)
		return DESKTOP_REFUSAL_CODE.noCredential;
	if (detail === DESKTOP_MACHINE_DETAIL.transportFailed)
		return DESKTOP_REFUSAL_CODE.transportFailed;
	return desktopRefusalCodeForStatus(desktopEndpoint(request).path, status);
}

export async function desktopResult<T>(request: DesktopRequest): Promise<T> {
	const response = await desktopRequest(request);
	const envelope = response.body as {
		result?: T;
		detail?:
			| string
			| {
					code?: string;
					message?: string;
					text?: string;
					params?: unknown;
					retry_after_ms?: number;
			  };
	} | null;
	if (response.status < 200 || response.status >= 300) {
		/*
		 * The sentence a user reads, from whichever shape the answering server wrote
		 * it in. Three have crossed this wire: a bare string (the oldest), an object
		 * with `message` (the refusal bodies that followed), and the core's i18n
		 * envelope `{code, params, text}` (RFC §2.6) - whose `text` is exactly the
		 * sentence string-only readers display, so a settings load, save or reset
		 * refused by a newer server would otherwise fall to the placeholder below
		 * instead of the server's own words. For an object, `text` is read before
		 * `message`: a body carrying both is the newer contract, and the envelope's
		 * `code` already reaches the error through `desktopErrorMessageCode`.
		 */
		const detail =
			typeof envelope?.detail === "string"
				? envelope.detail
				: typeof envelope?.detail?.text === "string"
					? envelope.detail.text
					: typeof envelope?.detail?.message === "string"
						? envelope.detail.message
						: null;
		throw new DesktopControlError(
			response.status,
			/*
			 * A refusal whose body carried neither a code nor a message. It used to
			 * say "Update the backend and try again", which is the one instruction
			 * this whole change removes for a pairing condition - and a bare 404 from
			 * a server that predates a route is exactly that (design round 1, D7).
			 * The app states what it observed and stops.
			 */
			detail ?? DESKTOP_REFUSAL_PLACEHOLDER,
			undefined,
			desktopErrorMessageCode(
				request,
				response.status,
				detail,
				typeof envelope?.detail === "object"
					? envelope.detail?.code
					: undefined,
			),
			typeof envelope?.detail === "object" &&
				typeof envelope.detail?.retry_after_ms === "number" &&
				Number.isFinite(envelope.detail.retry_after_ms)
				? envelope.detail.retry_after_ms
				: undefined,
			// The body object itself, for the one caller that needs a field beyond the
			// code and the sentence (see the field's own note).
			typeof envelope?.detail === "object" ? envelope.detail : undefined,
		);
	}
	if (request.op === "sessions.list") {
		liftDelegatedCleanupNotice(envelope?.result);
	}
	return envelope?.result as T;
}

/**
 * Take the delegated-cleanup notice out of a `sessions.list` answer, if it
 * carries one.
 *
 * At the transport, not in any one caller, because `sessions.list` has five
 * callers (the sidebar head, the tail and scoped pages, the destination
 * pickers, the mesh store) and the field rides EVERY answer the server serves
 * while the store is unacknowledged - so whichever caller asks first carries
 * it, and a notice lifted only by the sidebar would be silently dropped by
 * whichever picker won the race. The store keeps it until the reader dismisses
 * it; the write half of that dismissal is `dismissDelegatedCleanupNotice`
 * below.
 */
function liftDelegatedCleanupNotice(result: unknown): void {
	if (typeof result !== "object" || result === null) return;
	const notice = parseDelegatedCleanupNotice(
		(result as { delegated_cleanup_notice?: unknown }).delegated_cleanup_notice,
	);
	if (notice) useDelegatedCleanupNoticeStore.getState().receive(notice);
}

/**
 * Acknowledge the one-time delegated-cleanup notice for the STORE.
 *
 * WHY DISMISSAL WRITES. The route's GET is a non-consuming peek: the field
 * rides every `sessions.list` answer until this op lands, which is what lets a
 * second window still meet the notice after the first one saw it. The reader's
 * dismissal is the event that flips `notice_acknowledged`, so it is HALF local
 * (the stored copy clears) and half wire (this call).
 *
 * NEVER REJECTS, on purpose. The local clear is what the reader asked for and
 * it is already applied; a failed ack only means the field stays on the wire
 * and a later answer re-lifts the notice - the at-least-once direction a
 * once-per-store notice wants if anything. So a failure here is swallowed
 * rather than shown: there is no action for the reader to take, and a scary
 * banner about a notice they just dismissed is worse than the reappearance it
 * cannot prevent.
 */
async function acknowledgeDelegatedCleanupNotice(): Promise<void> {
	try {
		await desktopResult({ op: "delegated_cleanup_notice.ack" });
	} catch {
		// Deliberately swallowed: the dismissal is the promise this call makes,
		// and it is kept (see above).
	}
}

/**
 * The reader dismissed the notice: clear the stored copy, then acknowledge it
 * for the store.
 *
 * The ONE dismissal path, so the two halves cannot diverge: every caller that
 * drops the notice (the band's dismiss control, the tests) goes through here
 * and the ack cannot be forgotten. The local clear is synchronous - the band
 * is gone on this render - and the ack rides the same desktop request plumbing
 * as every other op, tolerating failure as {@link acknowledgeDelegatedCleanupNotice}
 * states.
 */
export async function dismissDelegatedCleanupNotice(): Promise<void> {
	useDelegatedCleanupNoticeStore.getState().dismiss();
	await acknowledgeDelegatedCleanupNotice();
}

/**
 * Whether the failure is a read this app stopped waiting for.
 *
 * The transport answers 504 plus `DESKTOP_DEADLINE_EXCEEDED_CODE` when it runs
 * out of its own budget for an op, which is the one failure a retry cannot
 * repair: the query behind it is still executing on the backend, so asking
 * again adds a second scan on top of the first. Callers that read the ledger
 * use this to decide against a retry.
 *
 * The CODE is the check, and the bare status is not: this app's own 504 always
 * carries it (`desktop-transport.ts`, the only place one is produced), so a 504
 * that arrives without it came from something else in the path — a proxy or an
 * upstream gateway — and is an ordinary failure that keeps its retry rather
 * than silently losing it (review round 1, N2).
 */
export function isDeadlineExceeded(error: unknown): boolean {
	return (
		error instanceof DesktopControlError &&
		error.code === DESKTOP_DEADLINE_EXCEEDED_CODE
	);
}

/**
 * Whether a history failure means the agent itself is gone, as opposed to
 * the backend being unreachable or refusing. Reads the typed status rather
 * than the message text, so a future rewording cannot break it.
 */
export function isAgentNotFound(error: unknown): boolean {
	return error instanceof DesktopControlError && error.status === 404;
}

/**
 * Whether the failure is the backend not answering at all, which is the one
 * case where "try again once the local server is running" is true. Same
 * reading of the status as the compatibility banner: `null` is a transport
 * that never produced a response, 503 is the relay saying it could not.
 * Anything else is the server answering, and that copy would be false.
 */
export function isServerUnreachable(error: unknown): boolean {
	if (!(error instanceof DesktopControlError)) return false;
	return error.status === null || error.status === 503;
}

/**
 * Whether the failure is the read-receipt SKEW deferral: the receipt's
 * conversation lives on another device and that device could not take the
 * write because its build predates the receipt op — or, on a fleet whose
 * daemon predates the `cause` field, because the answer cannot say which arm
 * it was.
 *
 * KEYED ON THE CAUSE WHEN THE ANSWER CARRIES ONE, THE CODE WHEN IT DOES NOT.
 * The cause rides the refusal body itself (`DesktopControlError.detail`, the
 * field whose own doc says the reader owns the narrowing — the
 * `activeRunIdFromRefusal` pattern), and `owner_build_behind` is deliberately
 * the ONLY token the quiet treatment matches: the route's other two arms
 * (`unreachable`, `refused`) name a state a reader can act on and keep the
 * notices they had, while a mixed fleet's older daemon answers `code` alone
 * and must not turn the skew back into the unknown failure the raw echo made
 * of it (a rollout is exactly when that fleet exists).
 *
 * THIS IS THE CLASS the receipt loop defers on (`use-completion-view.ts`) and
 * the one `refusalOf` in `features/chat/read-ack-notice.ts` buckets as
 * `remote`; both read it HERE so the loop cannot defer on a class the words do
 * not know, or the reverse.
 */
export function isRemoteReceiptDeferral(error: unknown): boolean {
	if (!(error instanceof DesktopControlError)) return false;
	const cause = (error.detail as { cause?: unknown } | undefined)?.cause;
	if (typeof cause === "string" && cause.length > 0)
		return cause === SESSION_IS_REMOTE_CAUSE_BUILD_BEHIND;
	return error.code === SESSION_IS_REMOTE_CODE;
}

/**
 * Whether a caught failure is main's refusal to send a read receipt from a
 * window the user cannot see.
 *
 * Reads the CLASS and the CODE, never the message: `UserFacingError` is copy by
 * construction and the code is the vetted category the transport attached when
 * it classified the refusal, so a reworded sentence cannot be mistaken for a
 * refusal by any caller. The point of asking is that a refusal and a transport
 * failure want different sentences and different next moves — a refusal means
 * the backend was never asked and the reader's move is to bring the window
 * forward, while "could not reach the backend process" is true only of the
 * other one (QA round 1, Q2).
 */
export function isForegroundRequired(error: unknown): boolean {
	return (
		error instanceof UserFacingError &&
		error.code === DESKTOP_FOREGROUND_REQUIRED_CODE
	);
}

/**
 * Whether a rejection from main is that refusal, read off its message.
 *
 * A message match, in the ONE place it is unavoidable, and the reason is the
 * boundary rather than convenience: `ipcRenderer.invoke` rebuilds main's
 * rejection as a plain `Error` — it prefixes the method name and drops every
 * other field, `code` included — so a refusal arrives as text and nothing else.
 * The text it is matched against is the shared constant the producer refuses
 * with, so this compares against the one authority for that sentence rather
 * than guessing what main might say. It is contained HERE so that no caller has
 * to match strings: every caller of `desktopRequest` receives the classified
 * error instead, which is what "fix it at the source" means for this defect.
 */
function isForegroundRefusal(cause: unknown): boolean {
	return (
		cause instanceof Error &&
		cause.message.includes(DESKTOP_FOREGROUND_REQUIRED_MESSAGE)
	);
}

export async function desktopControlResponse(
	request: DesktopRequest,
): Promise<Response> {
	const response = await desktopRequest(request);
	return new Response(
		response.status === 204 ? null : JSON.stringify(response.body),
		{
			status: response.status,
			headers: { "Content-Type": "application/json" },
		},
	);
}

export async function openAuthorization(
	operationId: string,
	reopen = false,
): Promise<void> {
	if (window.api?.desktop)
		return window.api.desktop.openAuthorization(operationId, reopen);
	const operation = await desktopResult<{ auth_url: string | null }>({
		op: "auth.status",
		id: operationId,
	});
	if (!operation.auth_url)
		throw new Error("This sign-in is no longer waiting for a browser.");
	const url = new URL(operation.auth_url);
	if (
		url.username ||
		url.password ||
		(url.protocol !== "https:" &&
			!(
				url.protocol === "http:" &&
				["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
			))
	) {
		throw new Error("The provider returned an invalid sign-in address.");
	}
	window.open(url.href, "_blank", "noopener,noreferrer");
}

/**
 * Subscribe to the authenticated canonical session stream.
 *
 * Two transports, one surface: Electron's main-process relay (which attaches
 * the bearer itself) or, in browser development, the server-side
 * `/__desktop/stream` proxy (which does the same). EventSource against the
 * backend directly is never an option — it cannot send the bearer, and an
 * unauthenticated fallback would be a silent security downgrade.
 *
 * THIS ENTRY POINT ALSO ADOPTS A PREWARM (see `prewarmSessionStream`): the click
 * path asks the desktop plane for the target's stream before React is asked to
 * render anything, and this is where the pane's own subscription picks that
 * connection up instead of opening a second one. A caller that cannot be
 * served by the prewarm gets exactly the subscription it always got.
 *
 * `onDecision` reports WHICH of those two happened, synchronously, because the
 * open trace's `request` stage has to tell them apart: an adopted connection was
 * asked for at the CLICK, so the click's stamp is the honest one and the pane
 * must not write a later time over it; a subscription that had to open its own
 * connection asked for it NOW, and there the click's stamp (a fallback) is a
 * lie that the pane's ask corrects.
 */
export function subscribeDesktopStream(
	args: DesktopStreamArgs,
	onEvent: (event: DesktopStreamEvent) => void,
	onDecision?: (decision: DesktopStreamDecision) => void,
): () => void {
	const claim = takePrewarmedStream(args);
	if (claim.record) {
		onDecision?.("adopted");
		logPrewarmDecision(
			args.sessionId,
			"adopted",
			"none",
			negotiationOf(args),
			null,
		);
		return adoptPrewarmedStream(claim.record, onEvent);
	}
	/*
	 * A PREWARM NOBODY CLAIMED IS RETIRED BY THE NEXT CONVERSATION'S SUBSCRIPTION
	 * (QA round 1, M1). A prewarm left unclaimed belongs to a switch that did not
	 * land - and this, some other conversation's pane, is the view that did. Holding
	 * it would keep a second live stream beside the one on screen for up to the TTL,
	 * the one window where "exactly one subscription" was not true. Nothing is lost
	 * when the prewarm's own pane arrives next: that call adopts above and never
	 * reaches this line.
	 */
	if (prewarmed) discardPrewarm();
	onDecision?.("requested");
	logPrewarmDecision(
		args.sessionId,
		"requested",
		claim.refusal,
		negotiationOf(args),
		claim.held,
	);
	return openStreamTransport(args, onEvent);
}

/**
 * Which of the two things one {@link subscribeDesktopStream} call did: it
 * ADOPTED the click's prewarm, or it asked the transport for a connection
 * itself. See that function's doc for why the open trace needs the difference.
 */
export type DesktopStreamDecision = "adopted" | "requested";

/** One event from a session stream, in the shape both transports deliver. */
export type DesktopStreamEvent = {
	receipt?: SnapshotReceipt;
	kind: "data" | "error" | "end";
	data?: string;
	detail?: string;
	/**
	 * The HTTP status that refused the stream, when one did.
	 *
	 * Only main can see it: it is the process that carries the bearer and
	 * makes the fetch. A 404 is the one refusal that is about the SESSION
	 * rather than about the transport — the desktop plane answers it for an id
	 * this machine does not have — and the click path reaches exactly that case
	 * without validating the id first (it deliberately spends no `sessions.get`
	 * on the latency path). Without the code the panel can only render transport
	 * text for a conversation that is simply gone.
	 */
	status?: number;
};

/** What one stream subscription asks the desktop plane for. */
export type DesktopStreamArgs = {
	sessionId: string;
	epoch?: string;
	afterSeq?: number;
	/**
	 * The open-frame negotiation (`docs/DESKTOP_API.md`, "The open frame").
	 * This renderer sends it only once it has read the capability, and the
	 * snapshot page it governs is the one this subscription carries: a caller
	 * that sets it must read `runs`/`runs_state`/`head_cut` off `view.history`.
	 * Absent keeps today's page, byte for byte.
	 */
	openFrame?: boolean;
	journalOrder?: boolean;
	orderIds?: string[];
	/**
	 * The complete peer-source declaration, forwarded on the same rule as
	 * `openFrame`: only this renderer's own negotiation may say it reads the
	 * complete-contract family (the peer-origin wakes and the recovery
	 * delta's declared keys), and the caller scopes it to a conversation on
	 * another device whose subscription already declared it. Absent — a local
	 * conversation, or a peer opened before the catalogue placed it — keeps
	 * the subscription's shape exactly as it was.
	 */
	peerJournalSource?: boolean;
};

/**
 * HOW LONG AN UNCLAIMED PREWARM IS KEPT, and why that number.
 *
 * The prewarm exists because the pane's own subscription is opened from a
 * PASSIVE effect, and a passive effect is flushed in a task of its own - behind
 * whatever the renderer already has queued. Measured on the operator's app
 * (2026-11-08, 21 switches, `[open-trace]` in the backend log): the click's
 * React commit landed in 38-400 ms every time, while the subscription request
 * landed 209-16,584 ms after the click - the same work, delayed by the queue in
 * front of it. So the wait this timer has to survive is that queue, and its
 * distribution is what sets the bound: max observed 18.4 s, and this is three
 * times that, because a bound that only covers yesterday's worst sample is a
 * timer that turns into a silent second subscription the first time the machine
 * is busier.
 *
 * A prewarm that nobody claims costs one open stream until this fires. That is
 * the trade: one connection held for at most a minute, against a conversation
 * that paints a frame's worth of milliseconds after the click that asked for it.
 */
const PREWARM_TTL_MS = 60_000;

/**
 * How many events a prewarm buffers before it gives up.
 *
 * A snapshot is ONE event, and the frames after it are deltas, so an unclaimed
 * prewarm's buffer is small in the ordinary case. The bound is here because a
 * prewarm can sit for up to `PREWARM_TTL_MS` against a live conversation, and
 * an unbounded buffer would be a leak with a timer on it. Overflow DISCARDS the
 * prewarm rather than dropping the oldest events: a stream whose snapshot fell
 * off the front would paint a conversation missing its history, and the pane
 * then opens an ordinary subscription - slower, and correct.
 */
const PREWARM_MAX_EVENTS = 512;

/** The negotiation flags a prewarm may reuse, as every real subscription asks.
 *
 * TWO KINDS OF FACT, from two different sources, and the prewarm must take each
 * from the source that OWNS it.
 *
 * `openFrame` and `journalOrder` are CAPABILITIES: the projection of the desktop
 * capabilities answer through `desktopFeatureEnabled`, which is exactly what the
 * pane derives its own subscription's flags from (`chat-page.tsx`). The prewarm
 * therefore reads them off that answer (`recordedStreamCapabilityFlags`),
 * recorded where it arrives - the SAME source the pane reads, never a
 * neighbour's request. Inheriting them from the last subscription instead is
 * what broke adoption on every app session's first click: the inheritance is
 * all-`false` until a subscription has run, so the prewarm asked undeclared, the
 * pane asked declared, and `takePrewarmedStream` correctly refused - costing the
 * feature its benefit and dropping a live stream (`desktop-stream-capabilities.ts`
 * carries the CI measurement).
 *
 * The per-visit parts of a subscription (the reconnect cursor and the journal
 * order ids) are NOT prewarmed for a mirror-image reason: they are read from the
 * conversation the renderer is about to leave, so a prewarm could not send them
 * and the adopter refuses to accept one that would have.
 *
 * `peerJournalSource` is NEITHER of those. It is that capability AND-ed with a
 * fact about one conversation - the catalogue placing it on another device
 * (`remoteOwnedId`) - so it is per-CONVERSATION, and the click path supplies the
 * target's own half (`remoteOwned`) rather than inheriting the departed pane's.
 * Inheritance here declared the complete contract for local conversations the
 * module's own rule says must not declare it (agent review round 1, MINOR 1). */
type StreamNegotiation = {
	openFrame: boolean;
	journalOrder: boolean;
	peerJournalSource: boolean;
};

function negotiationOf(args: DesktopStreamArgs): StreamNegotiation {
	return {
		openFrame: args.openFrame === true,
		journalOrder: args.journalOrder === true,
		peerJournalSource: args.peerJournalSource === true,
	};
}

type PrewarmedStream = {
	sessionId: string;
	negotiation: StreamNegotiation;
	buffered: DesktopStreamEvent[];
	/** Set once a subscriber adopts it; from then on events go straight through. */
	live: ((event: DesktopStreamEvent) => void) | null;
	/**
	 * Set when the transport said the stream is over (`error`/`end`) before anyone
	 * claimed it. A connection whose daemon side is gone is not a prewarm - it is
	 * a failure waiting to be replayed - so it is retired where it dies and refused
	 * here as a second line of defence.
	 */
	ended: boolean;
	disposeTransport: () => void;
};

let prewarmed: PrewarmedStream | null = null;
let prewarmTimer: ReturnType<typeof setTimeout> | null = null;

function discardPrewarm(): void {
	if (prewarmTimer !== null) {
		clearTimeout(prewarmTimer);
		prewarmTimer = null;
	}
	const record = prewarmed;
	prewarmed = null;
	if (!record) return;
	record.live = null;
	record.buffered = [];
	record.disposeTransport();
}

/**
 * The conversation the unclaimed prewarm is holding a stream for, or `null` when
 * there is none.
 *
 * Read by the click path's route watch (`open-conversation.ts`), which retires a
 * prewarm the navigation walked away from instead of leaving the connection open
 * until the TTL (agent review round 1, NIT 1).
 */
export function prewarmedSessionStreamId(): string | null {
	return prewarmed?.sessionId ?? null;
}

/**
 * Retire the unclaimed prewarm IF it is for `sessionId`.
 *
 * Scoped by id on purpose: the prewarm is one-at-a-time and a newer click replaces
 * it, so a late report about an older switch must not close the newer one's
 * connection. Anything not matching is someone else's intent and is left alone.
 */
export function discardPrewarmedStream(sessionId: string): void {
	if (!sessionId || prewarmed?.sessionId !== sessionId) return;
	discardPrewarm();
}

/**
 * Ask the desktop plane for `sessionId`'s stream NOW, from the click that chose
 * it, and hold what comes back until the pane subscribes.
 *
 * THE DEFECT THIS EXISTS FOR. `useCanonicalSession` opens its subscription from
 * a passive effect, which React flushes in a task of its own. On the operator's
 * machine that flush was measured 0.2-16.6 s after the click (`[open-trace]`:
 * `routed` and the previous pane's stream teardown both landed in 38-400 ms, so
 * the commit was never the slow part), while the daemon answered the request in
 * 190-400 ms whenever it arrived. The switch therefore spent its seconds with
 * NO REQUEST IN FLIGHT, which is why the app looked stalled and the backend
 * looked idle. Issuing the request in the click's own task removes the queue from
 * that path entirely - the answer is already arriving while the commit runs.
 *
 * ONE PREWARM AT A TIME, deliberately: a burst of clicks disposes the previous
 * target's connection rather than accumulating one stream per row pressed. The
 * cost of a wrong guess is one connection held for a moment, never a paint: the
 * adopter's own generation and connection guards still decide what reaches the
 * view, exactly as they do for a subscription opened by the effect.
 */
export function prewarmSessionStream(
	sessionId: string,
	options?: {
		/**
		 * Whether the catalogue places THIS conversation on another device
		 * (`remoteOwnedId`, read by the click path). One half of the complete-contract
		 * declaration; the other half is the app's capability, taken below.
		 *
		 * Absent is "not proven remote" - fail-closed, like every other negotiation
		 * read here - so a local target never declares the contract.
		 */
		remoteOwned?: boolean;
	},
): void {
	if (!sessionId) return;
	if (prewarmed?.sessionId === sessionId) return;
	discardPrewarm();
	/*
	 * THE FLAGS ARE THE PANE'S OWN; ONLY THE DECLARATION IS THE TARGET'S.
	 *
	 * Read from the capabilities answer this app received (the pane's source),
	 * so the prewarm phrases the request the pane is about to phrase. No answer
	 * yet is all-`false`, which is also what the pane passes then
	 * (`desktopFeatureEnabled(undefined, ...)`), so the two agree in that case too.
	 *
	 * `peerJournalSource` is that capability AND-ed with the click's own answer
	 * about THIS conversation: copied from the departed pane it declared the
	 * complete contract for a local target (agent review round 1, MINOR 1 - the
	 * probe saw `peerJournalSource: true` on a local target's request).
	 */
	const capabilities = recordedStreamCapabilityFlags();
	const negotiation: StreamNegotiation = {
		openFrame: capabilities?.openFrame === true,
		journalOrder: capabilities?.journalOrder === true,
		peerJournalSource:
			capabilities?.peerJournalSource === true && options?.remoteOwned === true,
	};
	/*
	 * Whether the record died while the transport was still being opened: an
	 * overflow, or a terminal `error`/`end`. The dispose handle only exists once
	 * `openStreamTransport` returns, so a death during that call has nothing to
	 * close yet - this flag is what makes the handover close it rather than leaving
	 * an unclaimed stream behind.
	 */
	let retired = false;
	const record: PrewarmedStream = {
		sessionId,
		negotiation,
		buffered: [],
		live: null,
		ended: false,
		disposeTransport: () => {},
	};
	record.disposeTransport = openStreamTransport(
		{
			sessionId,
			...(negotiation.openFrame ? { openFrame: true } : {}),
			...(negotiation.journalOrder ? { journalOrder: true } : {}),
			...(negotiation.peerJournalSource ? { peerJournalSource: true } : {}),
		},
		(event) => {
			if (record.live) {
				deliverSnapshot(event.receipt, "live");
				record.live(event);
				return;
			}
			/*
			 * A DEAD STREAM IS NOT A PREWARM (agent review round 1, MINOR 2). The handler
			 * used to buffer `error`/`end` and keep the record, so a click inside the TTL
			 * adopted a dead connection: it replayed the failure into the pane and paid
			 * the first retry backoff where a fresh subscribe would simply have asked.
			 * Retired here, the next click opens its own connection and nothing replays.
			 */
			if (event.kind === "error" || event.kind === "end") {
				record.ended = true;
				retired = true;
				discardPrewarm();
				return;
			}
			if (record.buffered.length >= PREWARM_MAX_EVENTS) {
				retired = true;
				discardPrewarm();
				return;
			}
			if (event.receipt) event.receipt.bufferedAt = performance.now();
			record.buffered.push(event);
		},
	);
	if (retired) {
		record.disposeTransport();
		return;
	}
	prewarmed = record;
	const timer = setTimeout(() => {
		if (prewarmed === record) discardPrewarm();
	}, PREWARM_TTL_MS);
	/*
	 * A DIAGNOSTIC TIMER MUST NOT OUTLIVE ITS HOST. In Electron's renderer this is
	 * a DOM timer and `unref` does not exist; in the node test host it does, and a
	 * 60 s timer that nothing else is waiting on keeps the process alive for a
	 * minute after the last assertion (measured: one suite at 61.7 s, all of it
	 * this timer). Guarded rather than assumed, because the two hosts spell their
	 * timer handles differently.
	 */
	if (typeof (timer as { unref?: () => void }).unref === "function")
		(timer as unknown as { unref: () => void }).unref();
	prewarmTimer = timer;
}

/**
 * Why a prewarm could not serve `args`.
 *
 * `none` is "there was no prewarm at all" - an ordinary subscription, a
 * reconnect, a background pane - which is not a decision worth a log line. The
 * rest are refusals of a prewarm that WAS held for this conversation, i.e. cases
 * where the click spent a connection the pane then had to replace.
 *
 * `negotiation` is the class this module was fixed for: the two requests
 * disagreed about a capability flag.
 */
type PrewarmRefusal =
	| "none"
	| "other-session"
	| "ended"
	| "resuming"
	| "negotiation";

/**
 * The prewarm `args` may adopt, or why it cannot.
 *
 * A prewarm is only usable when the caller wants EXACTLY what it asked for: the
 * same conversation, the same capability negotiation, and no reconnect cursor
 * or journal order ids - the two per-visit facts a prewarm cannot know, because
 * at click time the renderer still holds the conversation being left. Anything
 * else is a subscription the prewarm could not have phrased, so it is left for
 * the TTL (a different conversation the user moved past, which a newer prewarm
 * or the timer will retire) or refused here.
 *
 * THE REFUSAL IS RETURNED RATHER THAN DROPPED (agent review remediation round 2).
 * The guard is correctness and stays exactly as strict; what was missing is the
 * record of WHICH rule fired, because the first-click defect it hid was invisible
 * in every artefact the app produced.
 */
function takePrewarmedStream(args: DesktopStreamArgs):
	| {
			record: PrewarmedStream;
			refusal: null;
			held: StreamNegotiation;
	  }
	| {
			record: null;
			refusal: PrewarmRefusal;
			/**
			 * What the prewarm actually asked for, when one was held for THIS conversation.
			 *
			 * Reported back because a refusal DISPOSES the record: by the time the caller
			 * writes its diagnostic line, the negotiation it needs to compare against is
			 * gone. `null` when nothing was held, or when it belonged to another
			 * conversation (whose flags are not this call's business).
			 */
			held: StreamNegotiation | null;
	  } {
	const record = prewarmed;
	if (!record) return { record: null, refusal: "none", held: null };
	if (record.ended) {
		discardPrewarm();
		return { record: null, refusal: "ended", held: record.negotiation };
	}
	if (record.sessionId !== args.sessionId)
		return { record: null, refusal: "other-session", held: null };
	const wanted = negotiationOf(args);
	const resuming =
		args.epoch !== undefined ||
		args.afterSeq !== undefined ||
		(args.orderIds?.length ?? 0) > 0;
	if (resuming) {
		discardPrewarm();
		return { record: null, refusal: "resuming", held: record.negotiation };
	}
	if (
		wanted.openFrame !== record.negotiation.openFrame ||
		wanted.journalOrder !== record.negotiation.journalOrder ||
		wanted.peerJournalSource !== record.negotiation.peerJournalSource
	) {
		discardPrewarm();
		return { record: null, refusal: "negotiation", held: record.negotiation };
	}
	return { record, refusal: null, held: record.negotiation };
}

/**
 * The session id as it may appear in a log line, or `?`.
 *
 * THE SAME RULE THE OPEN TRACE APPLIES (`open-trace.ts`): ids are opaque tokens,
 * so anything else must never reach the durable log as free text. Spelled here
 * rather than imported because that module belongs to the chat feature and this
 * one is its transport.
 */
const LOG_SESSION_ID_SHAPE = /^[A-Za-z0-9_-]{1,80}$/;

/** The prefix `grep` finds every prewarm decision by, beside `[open-trace]`. */
const PREWARM_TRACE_PREFIX = "[stream-prewarm]";

/**
 * ONE LINE PER PREWARM DECISION - adoption, or the reason a held prewarm was
 * refused - at warn level, which is the channel that reaches the app's log.
 *
 * WHY IT EXISTS. This PR's own native lane failed on a defect nothing could see:
 * `model-uncertainty` showed two click-time `/events` attempts (61 and 69), the
 * first abandoned with its snapshot unconsumed, and no artefact said why -
 * `onDecision` had the answer and was consumed for the trace's `request` stamp,
 * then dropped. So the decision is written where the operator's `[open-trace]`
 * lines land: `console.warn` from the renderer, which main forwards to the app
 * log (`src/main/index.ts`, `console-message` -> `LogFileType.BACKEND`).
 *
 * WHAT IT COSTS. At most one line per switch: `adopted`, or a refusal of a
 * prewarm that WAS held for this conversation. A subscription with no prewarm
 * behind it (`refusal: "none"` - reconnects, background panes, the mini view)
 * writes nothing, so ordinary traffic stays silent.
 *
 * The flags print in the fixed order `openFrame,journalOrder,peerJournalSource`;
 * `caps=absent` means no capabilities answer had arrived, which is the other
 * way the two requests can legitimately agree on "no flags".
 */
function logPrewarmDecision(
	sessionId: string,
	decision: DesktopStreamDecision,
	refusal: PrewarmRefusal,
	asked: StreamNegotiation,
	prewarmedNegotiation: StreamNegotiation | null,
): void {
	if (decision === "requested" && refusal === "none") return;
	const id = LOG_SESSION_ID_SHAPE.test(sessionId) ? sessionId : "?";
	const flags = (n: StreamNegotiation) =>
		[
			n.openFrame ? "1" : "0",
			n.journalOrder ? "1" : "0",
			n.peerJournalSource ? "1" : "0",
		].join(",");
	const parts = [
		PREWARM_TRACE_PREFIX,
		`session=${id}`, // i18n: ignore developer log trace field, machine text
		`decision=${decision}`, // i18n: ignore developer log trace field, machine text
	];
	if (decision === "requested") {
		parts.push(`why=${refusal}`, `asked=${flags(asked)}`);
		if (prewarmedNegotiation)
			parts.push(`prewarm=${flags(prewarmedNegotiation)}`);
		if (refusal === "negotiation")
			parts.push(
				`caps=${recordedStreamCapabilityFlags() ? "recorded" : "absent"}`,
			);
	}
	console.warn(parts.join(" "));
}

/**
 * Hand a prewarm to the subscriber that claimed it, and replay what it already
 * received.
 *
 * THE REPLAY IS DEFERRED BY A MICROTASK, and that is a correctness requirement
 * rather than politeness. `subscribeDesktopStream`'s caller assigns the dispose
 * handle only AFTER this returns (`dispose = subscribeDesktopStream(...)`), so a
 * frame replayed synchronously could reach a handler that tears the subscription
 * down on a 404 - and that teardown would find no handle to close, leaving the
 * adopted transport alive forever. One microtask is long enough for the caller
 * to store its handle and far shorter than any transport hop.
 */
function adoptPrewarmedStream(
	record: PrewarmedStream,
	onEvent: (event: DesktopStreamEvent) => void,
): () => void {
	const buffered = record.buffered;
	record.buffered = [];
	record.live = onEvent;
	if (prewarmTimer !== null) {
		clearTimeout(prewarmTimer);
		prewarmTimer = null;
	}
	if (prewarmed === record) prewarmed = null;
	let disposed = false;
	queueMicrotask(() => {
		if (disposed) return;
		for (const event of buffered) {
			deliverSnapshot(event.receipt, "replay");
			onEvent(event);
		}
	});
	return () => {
		if (disposed) return;
		disposed = true;
		record.live = null;
		record.disposeTransport();
	};
}

/**
 * Open the stream on whichever transport this build has.
 *
 * It no longer records anything for the next click: the prewarm's negotiation
 * comes from the capabilities answer (`desktop-stream-capabilities.ts`), because
 * a request's own flags are not where that answer lives - and treating them as
 * if they were is what made the first click of every app session miss the
 * prewarm entirely.
 */
function openStreamTransport(
	args: DesktopStreamArgs,
	onEvent: (event: DesktopStreamEvent) => void,
): () => void {
	const native = window.api?.desktop?.stream;
	if (native) {
		const subscription = native.subscribe(args, (event) => {
			// contextBridge may freeze copied values. Own only the diagnostic
			// envelope; never mutate the native event or its raw SSE data.
			const received = event.receipt
				? { ...event, receipt: { ...event.receipt } }
				: event;
			enterSnapshotRenderer(received.receipt);
			// A prewarm overwrites this at its live/replay boundary; a direct
			// subscription has no buffering or adoption stage.
			deliverSnapshot(received.receipt, "direct");
			onEvent(received);
		});
		return () => subscription.dispose();
	}
	const query = new URLSearchParams({ session: args.sessionId });
	if (args.epoch) query.set("epoch", args.epoch);
	if (args.afterSeq !== undefined)
		query.set("after_seq", String(args.afterSeq));
	/*
	 * The additive `frontend_replace=1` negotiation, the same one main's relay
	 * sends (remediation contract § C): this renderer's reducer consumes the
	 * `frontend.replace` frame, so every subscription THIS build opens says so.
	 * The proxy forwards it; an older backend ignores it.
	 */
	query.set("frontend_replace", "1");
	/*
	 * The same forwarded open-frame negotiation main's relay sends, and forwarded
	 * for the same reason: this proxy must not claim on a renderer's behalf that
	 * a page counted in paintable rows will be understood.
	 */
	// `diff_bindings=1` rides with the open frame, as main's relay sends it
	// (`desktop-stream.ts` carries the reasoning).
	if (args.openFrame === true) {
		query.set("open_frame", "1");
		query.set("diff_bindings", "1");
	}
	// Browser development must negotiate the same source facts as main's relay;
	// otherwise a real cold quiet correction is silently filtered out here.
	if (args.journalOrder === true) {
		query.set("journal_order", "1");
		/*
		 * Set BEFORE the ids: the dev proxy re-validates and re-composes the
		 * query, and its own `appendJournalOrderIds` sizes the ids' budget against
		 * everything already present — the same order `desktop-contract`'s
		 * builders use, so one stream has one spelling on every transport.
		 */
		if (args.peerJournalSource === true) query.set("peer_journal_source", "1");
		appendJournalOrderIds(query, "/__desktop/stream", args.orderIds ?? []);
	}
	const source = new EventSource(`/__desktop/stream?${query}`);
	source.onmessage = (message) => {
		onEvent({ kind: "data", data: message.data });
	};
	source.onerror = () => {
		if (source.readyState === EventSource.CLOSED) {
			// The SAME machine vocabulary main's relay emits, from the shared module: the
			// notice the reader sees must not depend on which transport delivered the
			// failure (design round 1, D1). EventSource exposes no status code, so this
			// path can only say the stream failed to stay open.
			onEvent({ kind: "error", detail: DESKTOP_STREAM_DETAIL.ended });
			source.close();
		}
		// CONNECTING is EventSource's own retry; leave it alone.
	};
	return () => {
		source.close();
		onEvent({ kind: "end" });
	};
}

/**
 * Binary/multipart relay for the legacy media routes (speech, transcription,
 * agent ZIP import). Electron routes bytes through main's typed relay; browser
 * development posts them to the server-side `/__desktop/media` proxy. Either
 * way the bearer stays out of the renderer, and a missing relay is an honest
 * error rather than an unauthenticated direct call.
 */
export async function desktopMedia(
	request: DesktopMediaRequest,
	bytes: Uint8Array | null,
): Promise<DesktopMediaResponse> {
	const native = window.api?.desktop?.media;
	if (native) return native(request, bytes);
	const response = await fetch("/__desktop/media", {
		method: "POST",
		headers: {
			"x-desktop-media": JSON.stringify(request),
			"Content-Type": "application/octet-stream",
		},
		body: bytes ? new Blob([bytes as BlobPart]) : undefined,
	});
	const type = response.headers.get("content-type") ?? "";
	if (!response.ok) {
		let detail = "The media request failed.";
		let declaredCode: string | undefined;
		let declaredParams: Record<string, unknown> | undefined;
		if (type.includes("application/json")) {
			try {
				const body = (await response.json()) as { detail?: unknown };
				// The reload fence, forwarded raw by the development proxy (main's relay
				// rewrites it already): read before the generic arms below.
				if (isServeReloadFence(response.status, body))
					declaredCode = DESKTOP_REFUSAL_CODE.serverUpdating;
				const raw = body?.detail;
				if (typeof raw === "string") {
					detail = raw;
				} else if (typeof raw === "object" && raw !== null) {
					/*
					 * The core's i18n envelope `{code, params, text}` (RFC §2.6), the
					 * sibling ladder of `desktopResult`'s: `text` is exactly the sentence
					 * string-shaped readers display, and `code` is the answering process's
					 * own category - a code the transport DECLARED always wins, the same
					 * precedence `desktopErrorMessageCode` documents. A body carrying both
					 * `text` and `message` is the newer contract, so `text` is read first;
					 * `message` stays as the older object shape's fallback.
					 */
					const envelope = raw as {
						code?: unknown;
						text?: unknown;
						message?: unknown;
					};
					if (typeof envelope.text === "string" && envelope.text.trim()) {
						detail = envelope.text;
					} else if (
						typeof envelope.message === "string" &&
						envelope.message.trim()
					) {
						detail = envelope.message;
					}
					if (typeof envelope.code === "string" && declaredCode === undefined)
						declaredCode = envelope.code;
					const params = (raw as { params?: unknown }).params;
					if (
						typeof params === "object" &&
						params !== null &&
						!Array.isArray(params)
					)
						declaredParams = params as Record<string, unknown>;
				}
			} catch {
				// Keep the generic detail.
			}
		}
		return {
			status: response.status,
			kind: "error",
			detail,
			// A code the refusal DECLARED wins; otherwise the development proxy forwards
			// a refusal body without declaring one, so only the app's OWN machine
			// sentence can be recognised here - and telling "this app holds no
			// credential" apart from "the plane is shut" is exactly the distinction the
			// code exists for (see `desktopErrorMessageCode`).
			code:
				declaredCode !== undefined && isDesktopRefusalCode(declaredCode)
					? declaredCode
					: detail === DESKTOP_MACHINE_DETAIL.noCredential
						? DESKTOP_REFUSAL_CODE.noCredential
						: undefined,
			// The upload's own refusal, as main's relay forwards it (dev-proxy twin).
			...(request.op === "notification_sounds.upload" &&
			declaredCode !== undefined
				? {
						refusal: {
							code: declaredCode.slice(0, 64),
							...(declaredParams ? { params: declaredParams } : {}),
						},
					}
				: {}),
		};
	}
	if (type.includes("application/json")) {
		return {
			status: response.status,
			kind: "json",
			body: await response.json(),
		};
	}
	return {
		status: response.status,
		kind: "bytes",
		mimeType: type || "application/octet-stream",
		data: new Uint8Array(await response.arrayBuffer()),
	};
}

/** Throws a user-readable error for a non-success media result. */
export function mediaError(result: DesktopMediaResponse): Error {
	if (result.kind === "error") {
		/*
		 * A media refusal of the pairing family is composed from its code, exactly as
		 * the JSON transport's is: the two media ops under `/v1/desktop/` are refused
		 * by the same plane, and the app's own no-credential refusal is a pairing fact
		 * ("this app holds no token") rather than a media failure. Everything else
		 * keeps the server's own detail, which is where a media-specific reason
		 * belongs.
		 */
		if (isDesktopRefusalCode(result.code))
			return new UserFacingError(
				desktopRefusalSentence(result.code),
				result.code,
			);
		return new Error(result.detail);
	}
	return new Error("The media request returned an unexpected response.");
}
