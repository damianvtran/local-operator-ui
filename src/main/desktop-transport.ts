import {
	type DesktopResponse,
	desktopEndpoint,
	desktopRequestSchema,
} from "../shared/desktop-contract";

export async function requestDesktop(
	input: unknown,
	backendUrl: string,
	token: string | null,
): Promise<DesktopResponse> {
	const parsed = desktopRequestSchema.safeParse(input);
	if (!parsed.success) {
		// Zod errors can carry user input. IPC errors must never serialize a key.
		return { status: 422, body: { detail: "Invalid desktop operation." } };
	}
	const request = parsed.data;
	if (request.op !== "capabilities" && !token) {
		return {
			status: 503,
			body: {
				detail: "Restart with a desktop-managed backend to use these controls.",
			},
		};
	}
	const target = desktopEndpoint(request);
	try {
		const body =
			target.body === undefined ? undefined : JSON.stringify(target.body);
		if (body && Buffer.byteLength(body) > 262144) {
			return {
				status: 413,
				body: { detail: "This desktop request is too large." },
			};
		}
		const response = await fetch(new URL(target.path, backendUrl), {
			method: target.method,
			headers: {
				Accept: "application/json",
				...(body ? { "Content-Type": "application/json" } : {}),
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
			body,
			redirect: "error",
			signal: AbortSignal.timeout(20000),
		});
		const result = response.status === 204 ? null : await response.json();
		if (request.op === "capabilities" && !token && result?.result) {
			// A backend may support the protocol while this app does not own its
			// lifetime capability. Never turn that into an unauthenticated fallback.
			result.result.desktop_available = false;
		}
		return { status: response.status, body: result };
	} catch {
		return {
			status: 503,
			body: {
				detail:
					"The backend could not complete this request. Check its connection and try again.",
			},
		};
	}
}

export function trustedDesktopFrame(actual: string, expected: string): boolean {
	try {
		const current = new URL(actual);
		const trusted = new URL(expected);
		if (trusted.protocol === "file:") {
			return (
				current.protocol === "file:" && current.pathname === trusted.pathname
			);
		}
		return (
			["http:", "https:"].includes(trusted.protocol) &&
			current.origin === trusted.origin
		);
	} catch {
		return false;
	}
}
