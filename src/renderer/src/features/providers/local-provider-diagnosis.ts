/**
 * What a failed local-model check MEANS, from the facts the backend exposes.
 *
 * ## Why (D1, onboarding friction 2026-11)
 *
 * PostHog, 30 days: 146 external users pressed "Check again" on the local-model
 * panel ("Run models on this computer"), 8.4 times each on average on Windows,
 * and 74 of them never sent a message. The panel's only failure sentence was
 * "<brand> isn't answering", and its only control re-ran the same probe, which
 * fails in milliseconds with the same words - so every press looked like
 * nothing happened. The fixes differ by cause, so the panel has to name it.
 *
 * ## What the backend can and cannot tell us
 *
 * - `POST /v1/auth/providers/{id}/probe` (core `server/routes/auth.py`)
 *   answers `reachable: false` when nothing answered, and `reachable: true`
 *   with `detail: "A server answered (<status>)."` when anything did. That
 *   status is the only machine fact in the detail, so it is read by its
 *   `(<3 digits>)` shape, never by the English around it; an unreadable detail
 *   is treated as a healthy answer, which is the probe's own reading.
 * - `GET /v1/models?provider=<id>` lists the models that server serves
 *   (`local_entries` in core `routes/models.py`), which separates "running"
 *   from "running with nothing pulled".
 * - "Not installed" and "installed but not running" are NOT distinguishable:
 *   both are "nothing answered at the address". So they share one diagnosis
 *   whose copy offers both next steps (download, or start it), rather than
 *   guessing one. A non-default address that nothing answers is reported as a
 *   possible wrong address, because the user changed it and may have mistyped.
 */

/** The address each local runtime listens on out of the box (core `LOCAL_PRESETS`). */
export const LOCAL_DEFAULT_PORTS: Readonly<Record<string, number>> = {
	ollama: 11434,
	lmstudio: 1234,
	vllm: 8000,
	llamacpp: 8080,
};

/** Where to get each runtime; the core's `LOCAL_PRESETS` homepages, Ollama's download page. */
export const LOCAL_DOWNLOAD_URLS: Readonly<Record<string, string>> = {
	ollama: "https://ollama.com/download",
	lmstudio: "https://lmstudio.ai",
	vllm: "https://vllm.ai",
	llamacpp: "https://github.com/ggml-org/llama.cpp",
};

/**
 * The first model we suggest pulling into Ollama.
 *
 * `qwen3:8b`: supports tool calling (the agent needs it; a chat-only model
 * answers but cannot act), ~5 GB, runs on a 16 GB laptop. Only Ollama has a
 * one-line pull, so only Ollama gets a command; other runtimes are told to load
 * a model in their own app.
 */
export const OLLAMA_RECOMMENDED_MODEL = "qwen3:8b";

export type LocalDiagnosis =
	/** Something answered with a 2xx and serves at least one model (or the list is unknown). */
	| { kind: "ready"; models: number | null }
	/** Running, and the model list is empty. */
	| { kind: "no_models" }
	/** Nothing answered at the runtime's default address: not installed or not started. */
	| { kind: "not_running" }
	/**
	 * Nothing answered at an address the user changed, or something answered
	 * but not as this runtime's API (a non-2xx status from `/models`).
	 */
	| { kind: "wrong_address"; status: number | null };

const STATUS_IN_DETAIL = /\((\d{3})\)/;

/** Whether `baseUrl` is this runtime's own out-of-the-box address. */
export function isDefaultLocalAddress(
	providerId: string,
	baseUrl: string | null,
): boolean {
	const port = LOCAL_DEFAULT_PORTS[providerId];
	if (port === undefined || !baseUrl) return false;
	try {
		const url = new URL(baseUrl);
		const loopback =
			url.hostname === "localhost" ||
			url.hostname === "127.0.0.1" ||
			url.hostname === "[::1]";
		return loopback && Number(url.port) === port;
	} catch {
		return false;
	}
}

export function diagnoseLocal(input: {
	providerId: string;
	baseUrl: string | null;
	probe: { reachable: boolean; detail: string };
	/** The served model count, or null when the list could not be read. */
	models: number | null;
}): LocalDiagnosis {
	const { probe } = input;
	if (!probe.reachable) {
		return isDefaultLocalAddress(input.providerId, input.baseUrl)
			? { kind: "not_running" }
			: { kind: "wrong_address", status: null };
	}
	const match = STATUS_IN_DETAIL.exec(probe.detail);
	const status = match ? Number(match[1]) : null;
	/*
	 * 401/403 is a running server that wants a token - still this runtime,
	 * still "running" (the probe's own rule). Any other non-2xx is something
	 * listening that does not serve `/models` here: the wrong address or the
	 * wrong program on that port.
	 */
	if (
		status !== null &&
		(status < 200 || status >= 300) &&
		status !== 401 &&
		status !== 403
	) {
		return { kind: "wrong_address", status };
	}
	if (input.models === 0) return { kind: "no_models" };
	return { kind: "ready", models: input.models };
}
