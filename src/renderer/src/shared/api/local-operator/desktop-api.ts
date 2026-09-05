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

export async function desktopRequest(
	request: DesktopRequest,
): Promise<DesktopResponse> {
	if (window.api?.desktop) return window.api.desktop.request(request);
	// The development server implements the same operation vocabulary and keeps
	// its bearer server-side. Production never injects a VITE/browser token.
	const response = await fetch("/__desktop", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(request),
	});
	if (!response.ok)
		throw new Error("Desktop controls need a compatible backend connection.");
	return response.json();
}

export async function desktopResult<T>(request: DesktopRequest): Promise<T> {
	const response = await desktopRequest(request);
	const envelope = response.body as { result?: T; detail?: string } | null;
	if (response.status < 200 || response.status >= 300) {
		throw new Error(
			typeof envelope?.detail === "string"
				? envelope.detail
				: "This backend does not support the requested desktop control. Update the backend and try again.",
		);
	}
	return envelope?.result as T;
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
