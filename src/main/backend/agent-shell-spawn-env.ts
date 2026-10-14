/**
 * The agent-shell markers, stripped from the environment the app hands the
 * backend it spawns.
 *
 * WHY THIS EXISTS. Three names travel in the process environment of anything
 * started from an agent's `bash` tool: `LOCAL_OPERATOR_AGENT_SHELL`,
 * `LOCAL_OPERATOR_AGENT_MAY_DELEGATE` and `LOCAL_OPERATOR_ALLOW_NESTED_SESSION`.
 * Core reads them at session-build time and STAMPS a session it decides an
 * agent's shell opened as `origin.json = {"origin": "agent-shell"}`, which every
 * listing filters out of the operator's own surfaces.
 *
 * The desktop app is long-lived and outlives the session that launched it: it
 * inherits `{ ...process.env }` (see `backend-service.ts`'s `shellEnv`), and it
 * spawns its backend with a copy of that environment. When the app was started
 * from an agent's shell — how this repository tells agents to measure, and how
 * the operator's own app is often launched — the markers rode through into the
 * `lop serve` backend, and every session THAT backend minted for the operator's
 * New Chat was stamped `agent-shell` and hidden from the sidebar, the phone list
 * and the `/resume` picker (operator, 2026-10-13). A chat the operator opened
 * must never be stamped as machine-started, so the app's own responsibility, one
 * level above core's `lop serve` strip, is that its backend is never handed the
 * markers at all.
 *
 * DEFENSE IN DEPTH, not a duplicate fix. Core strips the same three at its SERVE
 * entry point (`local_operator/agent_shell.py`'s
 * `drop_agent_shell_marker_from_environ`, called from `cli.serve_command`), so
 * the leak is already closed for anything that reaches a real `lop serve`. This
 * covers the app's side of the contract — its backend is meant to be a plain
 * daemon hosting the operator's chats — and it covers the paths core's strip
 * does not: a launcher this app starts that is not (yet) the striped entry
 * point, and any future spawn added here that would otherwise carry the markers.
 *
 * KEEP THE NAMES IN SYNC with `local_operator/agent_shell.py`. They are a
 * wire between two runtimes (this one cannot import the other), which is why
 * `scripts/agent-shell-spawn-env.test.mjs` asserts the two spell the same set.
 */

/** The two markers the `bash` tool sets on every command it runs. */
export const AGENT_SHELL_ENV = "LOCAL_OPERATOR_AGENT_SHELL";
export const MAY_DELEGATE_ENV = "LOCAL_OPERATOR_AGENT_MAY_DELEGATE";

/**
 * The documented escape hatch harness and QA runs set to drive the real CLI.
 * Dropped here too: it is one of the three facts that make core decide a session
 * is machine-started (`agent_shell.agent_shell_opened_run`), and a long-lived
 * app that inherited a harness's escape would waive the refusal for the
 * operator's own chats and hide them — the same regression by a different name.
 */
export const ALLOW_NESTED_SESSION_ENV = "LOCAL_OPERATOR_ALLOW_NESTED_SESSION";

/** Every name that must not reach the backend the app spawns. */
export const AGENT_SHELL_MARKERS = [
	AGENT_SHELL_ENV,
	MAY_DELEGATE_ENV,
	ALLOW_NESTED_SESSION_ENV,
] as const;

/**
 * Return a copy of `env` with every agent-shell marker removed.
 *
 * Removed with `delete` rather than set to `undefined`: a key PRESENT with an
 * undefined value and a key ABSENT read the same to Node's spawn, but the
 * assertions here (and any log that prints the object) should see the names
 * gone, not emptied. Unrelated variables — `PATH`, the desktop token, the
 * notification switch — pass through untouched: this drops three names and
 * nothing else.
 */
export function withoutAgentShellMarker(
	env: Record<string, string | undefined>,
): Record<string, string | undefined> {
	const stripped = { ...env };
	for (const name of AGENT_SHELL_MARKERS) {
		delete stripped[name];
	}
	return stripped;
}
