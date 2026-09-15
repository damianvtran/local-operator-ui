/**
 * Where this process writes its log files.
 *
 * Why this is its own module, with no Electron import: the decision is a plain
 * string, so `scripts/logger-log-dir.test.mjs` can bundle this file and assert
 * the rules in-process, the same reason `src/main/window-mode.ts` and
 * `src/main/dev-driver.ts` import nothing from Electron either. `logger.ts` owns
 * the platform default and asks this module only whether the launch overrode it.
 *
 * Why the override exists at all. The default log directory is the user's real
 * home, and Electron's `home` is the OS account's home — neither the `HOME`
 * environment variable nor a scratch `--user-data-dir` redirects it. Measured: a
 * harness run's dead backend port (`Backend service configured with port 61654…`)
 * appeared in the operator's own
 * `~/Library/Application Support/Local Operator/logs/backend-service.log`. Every
 * other path a driver run could touch is redirected (profile, config dir, cwd,
 * backend URL), so the logs were the one place a run left marks on the operator's
 * machine; `scripts/renderer-driver.mjs` sets this variable to its scratch tree.
 *
 * The variable has NO default. A launch that did not set it resolves exactly the
 * path this app has always resolved, so nothing about a normal launch's logging
 * changes: this is an override, not a new setting.
 */

export const LOG_DIR_ENV = "LOCAL_OPERATOR_LOG_DIR";

/**
 * The requested log directory, or `null` for "use the app's own default".
 *
 * Absolute only. A relative value would be resolved against a working directory
 * that a driver run deliberately keeps outside the checkout, which is how a run
 * ends up writing `logs/` somewhere nobody looks — and unlike the dev driver's
 * frames directory there is no useful relative meaning to honour here. A value
 * that was set and refused says so on stdout, in the spirit of the window mode
 * and the dev driver: the alternative is a run whose logs were expected in one
 * place and are in another, discovered much later.
 */
export function logDirOverride(value: string | undefined): string | null {
	const requested = value?.trim();
	if (requested === undefined || requested === "") return null;
	if (requested.startsWith("/")) return requested;
	console.warn(
		`[logger] ${LOG_DIR_ENV}=${requested} is not an absolute path; the default log directory is used instead`,
	);
	return null;
}
