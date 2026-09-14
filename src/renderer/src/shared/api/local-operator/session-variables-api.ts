/**
 * Local Operator API - session code-memory endpoints.
 *
 * Code memory is a session's eval namespace: the names its own cells have left
 * behind in the interpreter that ran them. It is read from the live kernel and
 * is never persisted, so these four ops are the only way to see it, and they
 * are session-addressed because a namespace belongs to a session's runtime.
 *
 * The legacy `/v1/agents/{id}/execution-variables` route this replaced could
 * not answer at all: it resolves through the agent registry, whose keys are
 * agent-directory UUIDs, while every caller here holds a canonical session id
 * (`~/.local-operator/sessions/<12hex>/`). It was deleted from the contract
 * rather than left beside this module, so a familiar-looking call cannot come
 * back and quietly 404 again.
 */
import { DesktopControlError, desktopResult } from "./desktop-api";

/**
 * The six writable types, as offered by the form's select.
 *
 * Exported from the transport module rather than restated in the dialog,
 * because the names are the backend's coercion table: `str`, not `string`,
 * which is the drift that shipped when the dialog offered `string`,
 * `boolean`, `object` and `array` while the worker could coerce none of them.
 * `editable` on each row comes from that same table server-side (see
 * `SessionVariable`), so the panel and the write path cannot disagree.
 */
export const VARIABLE_TYPES = [
	"str",
	"int",
	"float",
	"bool",
	"list",
	"dict",
] as const;

export type VariableType = (typeof VARIABLE_TYPES)[number];

/** A keystroke of the form: what the dialog collects, key included. */
export type VariableWrite = {
	key: string;
	value: string;
	type: VariableType;
};

/**
 * One name in the session's namespace.
 *
 * `type` is the Python type's own name and is NOT one of `VARIABLE_TYPES` in
 * general - a cell can leave a DataFrame, a function or a class behind, and the
 * panel must list it (a session full of helpers reading "Nothing stored yet"
 * would be the same lie this surface exists to stop). `editable` is computed by
 * the backend from the coercion table, which is why the panel has no local
 * list of its own to fall out of step with it. `truncated` means the backend
 * capped the rendered value; the panel's own 200/1000-character display
 * truncation is separate and unchanged.
 */
export type SessionVariable = {
	key: string;
	type: string;
	value: string;
	editable: boolean;
	truncated: boolean;
};

/**
 * What a read answers, discriminated by `state`.
 *
 * `busy` and `unsupported` carry no `variables` key BY DESIGN: there is no
 * namespace reading behind them, and an empty list would render as "nothing
 * stored yet" over a namespace nobody looked at. `variables: []` means
 * observed and empty, never unknown. `runtime` and `kernel` are separate facts
 * because they are separate sentences to a user: a chat that has not started
 * yet, versus one whose interpreter was released after sitting idle.
 */
export type SessionVariablesResult =
	| SessionVariablesObserved
	| { state: "busy" }
	| { state: "unsupported" };

/** The answer that actually carries a reading of the namespace. */
export type SessionVariablesObserved = {
	state: "observed";
	runtime: "running" | "absent";
	kernel: "resident" | "absent";
	variables: SessionVariable[];
	truncated: boolean;
};

/** Where a session's code memory is cached, keyed by the session it belongs to. */
export const sessionVariablesQueryKey = (sessionId: string | undefined) =>
	["desktop", "sessions", sessionId ?? "", "variables"] as const;

/** Read the session's code memory. */
export async function listSessionVariables(
	sessionId: string,
): Promise<SessionVariablesResult> {
	return desktopResult<SessionVariablesResult>({
		op: "sessions.variables.list",
		sessionId,
	});
}

/**
 * Create a name in the session's namespace.
 *
 * The backend refuses with 409 `already_exists`, `reserved_name`,
 * `invalid_value`, `too_large`, `no_kernel`, `kernel_busy` or `runtime_cold`;
 * `desktopResult` lifts the refusal's `message` onto the thrown error, which is
 * the sentence the panel toasts. Mutations never start a runtime or a kernel,
 * so a cold session is a refusal rather than a side effect.
 */
export async function createSessionVariable(
	sessionId: string,
	write: VariableWrite,
): Promise<SessionVariable> {
	const result = await desktopResult<{
		state: "ok";
		variable: SessionVariable;
	}>({
		op: "sessions.variables.create",
		sessionId,
		key: write.key,
		value: write.value,
		type: write.type,
	});
	return result.variable;
}

/** Replace an existing name's value and type. The key itself never changes. */
export async function updateSessionVariable(
	sessionId: string,
	write: VariableWrite,
): Promise<SessionVariable> {
	const result = await desktopResult<{
		state: "ok";
		variable: SessionVariable;
	}>({
		op: "sessions.variables.update",
		sessionId,
		key: write.key,
		value: write.value,
		type: write.type,
	});
	return result.variable;
}

/** Forget a name. The value disappears from the namespace the next cell sees. */
export async function deleteSessionVariable(
	sessionId: string,
	key: string,
): Promise<void> {
	await desktopResult<{ state: "ok" }>({
		op: "sessions.variables.delete",
		sessionId,
		key,
	});
}

/**
 * Whether a read failed because THIS BACKEND has no such route (404).
 *
 * A 404 here does not mean the session is gone: the capabilities gate has
 * already established that this build advertises the surface, so the route
 * itself is what is missing - a stale capabilities answer from a backend that
 * was updated out from under a running renderer. The panel answers it with the
 * same sentence the gate uses, because it is the same fix. Read from the typed
 * status rather than the message text, so a rewording cannot break it.
 */
export function isSessionVariablesMissing(error: unknown): boolean {
	return error instanceof DesktopControlError && error.status === 404;
}
