import type {
	DesktopMediaRequest,
	DesktopMediaResponse,
	DesktopRequest,
	DesktopResponse,
} from "../../../../../shared/desktop-contract";

export type {
	AuthOperation,
	BackendSetting,
	BackendSettings,
	DesktopCapabilities,
	DesktopProvider,
	ProviderMethod,
} from "../../../../../shared/desktop-contract";

/**
 * How long the renderer waits for ANY desktop control before calling it dead.
 *
 * Deliberately longer than the main process's own 20s `fetch` deadline in
 * `desktop-transport.ts`, so a backend that answers slowly is still reported by
 * the layer that actually knows the HTTP status. This bound only covers the
 * case main can never report: the IPC round trip itself never settling.
 *
 * It does NOT cover `desktopMedia`, whose transport allows 120s for speech and
 * agent-ZIP transfers; that path is bounded separately and is not routed here.
 */
const DESKTOP_REQUEST_TIMEOUT_MS = 30000;

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
			return await withDeadline(window.api.desktop.request(request));
		} catch (cause) {
			if (cause instanceof DesktopControlError) throw cause;
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
 */
function withDeadline(
	pending: Promise<DesktopResponse>,
): Promise<DesktopResponse> {
	let timer: ReturnType<typeof setTimeout>;
	return Promise.race([
		pending,
		new Promise<never>((_, reject) => {
			timer = setTimeout(
				() =>
					reject(
						new DesktopControlError(
							null,
							"Desktop controls could not reach the backend process.",
						),
					),
				DESKTOP_REQUEST_TIMEOUT_MS,
			);
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

	constructor(
		status: number | null,
		message: string,
		cause?: unknown,
		code?: string,
	) {
		super(message);
		this.name = "DesktopControlError";
		this.status = status;
		this.cause = cause;
		this.code = code;
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
	return error instanceof DesktopControlError ||
		error instanceof UserFacingError
		? error.message
		: fallback;
}

export async function desktopResult<T>(request: DesktopRequest): Promise<T> {
	const response = await desktopRequest(request);
	const envelope = response.body as {
		result?: T;
		detail?: string | { code?: string; message?: string };
	} | null;
	if (response.status < 200 || response.status >= 300) {
		throw new DesktopControlError(
			response.status,
			typeof envelope?.detail === "string"
				? envelope.detail
				: typeof envelope?.detail?.message === "string"
					? envelope.detail.message
					: "This backend does not support the requested desktop control. Update the backend and try again.",
			undefined,
			typeof envelope?.detail === "object" ? envelope.detail?.code : undefined,
		);
	}
	return envelope?.result as T;
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
	const source = new EventSource(`/__desktop/stream?${query}`);
	source.onmessage = (message) => {
		onEvent({ kind: "data", data: message.data });
	};
	source.onerror = () => {
		if (source.readyState === EventSource.CLOSED) {
			onEvent({ kind: "error", detail: "The event stream ended." });
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
		return { status: response.status, kind: "error", detail };
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
	if (result.kind === "error") return new Error(result.detail);
	return new Error("The media request returned an unexpected response.");
}
