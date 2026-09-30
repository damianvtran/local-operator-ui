/*
 * `desktopResult` as a counter, for `agents-config-probe-cadence.test.mjs`.
 *
 * WHY A STUB AND NOT THE DESKTOP BRIDGE. The fact under test is how many
 * `sessions.get` calls the run's recovery probe makes as the transcript streams
 * — a COUNT, not a result. Everything else this module exports is the real
 * module's (`userFacingMessage` and `DesktopControlError` are used by the hook
 * itself), so the only thing replaced is the call the measurement is about.
 *
 * The answer is `streaming: true` so the probe never settles: a settled run
 * stops polling, which would flatten the count for a reason that has nothing to
 * do with the cadence under test.
 */
export * from "../src/renderer/src/shared/api/local-operator/desktop-api";

export const calls = [];

export async function desktopResult(request) {
	calls.push({ ...request });
	if (request?.op === "sessions.get") {
		return { payload: { frontend: { streaming: true } } };
	}
	if (request?.op === "profiles.list") return { profiles: [] };
	if (request?.op === "teams.list") return { teams: [] };
	return {};
}
