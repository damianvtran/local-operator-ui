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
	DESKTOP_REFUSAL_SENTENCE,
	desktopEndpoint,
	desktopRefusalCodeForStatus,
	desktopRequestDeadlineDetail,
	desktopRequestTimeoutMs,
	isDesktopRefusalCode,
} from "../../../../../shared/desktop-contract";
import {
	SESSION_IS_REMOTE_CAUSE_BUILD_BEHIND,
	SESSION_IS_REMOTE_CODE,
} from "../../../../../shared/desktop-session-contract";
import { DESKTOP_STREAM_DETAIL } from "../../../../../shared/desktop-stream-notice";
import {
	parseDelegatedCleanupNotice,
	useDelegatedCleanupNoticeStore,
} from "../../store/delegated-cleanup-notice-store";

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
				"Desktop controls could not reach the backend process.",
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
		throw new DesktopControlError(
			null,
			"Desktop controls could not reach the backend process.",
			cause,
		);
	}
	if (!response.ok)
		throw new DesktopControlError(
			response.status,
			"Desktop controls need a compatible backend connection.",
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
export const DESKTOP_REFUSAL_PLACEHOLDER =
	"This server did not answer the request for its desktop controls.";

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
			return DESKTOP_REFUSAL_SENTENCE[error.code];
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
	if (typeof declared === "string") return declared;
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
			| { code?: string; message?: string; retry_after_ms?: number };
	} | null;
	if (response.status < 200 || response.status >= 300) {
		const detail =
			typeof envelope?.detail === "string"
				? envelope.detail
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
 */
export function subscribeDesktopStream(
	args: { sessionId: string; epoch?: string; afterSeq?: number },
	onEvent: (event: {
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
	}) => void,
): () => void {
	const native = window.api?.desktop?.stream;
	if (native) {
		const subscription = native.subscribe(args, onEvent);
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
		if (type.includes("application/json")) {
			try {
				const body = (await response.json()) as { detail?: unknown };
				if (typeof body.detail === "string") detail = body.detail;
			} catch {
				// Keep the generic detail.
			}
		}
		return {
			status: response.status,
			kind: "error",
			detail,
			// The development proxy forwards a refusal body without declaring a code, so
			// only the app's OWN machine sentence can be recognised here - and telling
			// "this app holds no credential" apart from "the plane is shut" is exactly
			// the distinction the code exists for (see `desktopErrorMessageCode`).
			code:
				detail === DESKTOP_MACHINE_DETAIL.noCredential
					? DESKTOP_REFUSAL_CODE.noCredential
					: undefined,
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
				DESKTOP_REFUSAL_SENTENCE[result.code],
				result.code,
			);
		return new Error(result.detail);
	}
	return new Error("The media request returned an unexpected response.");
}
