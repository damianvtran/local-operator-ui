import type {
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
