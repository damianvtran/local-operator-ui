/**
 * Backend Module Index
 *
 * This file exports all backend-related modules for easy importing.
 */

export {
	LocalOperatorStartupMode,
	BackendServiceManager,
	showErrorDialog,
	// The quit path's failsafe derives from these bounds rather than restating
	// them, so they are part of the module's surface (review round 3, F12). The
	// console term this list used to carry is gone with the execs it bounded: the
	// launcher is resolved synchronously now, by `globalConsoleScript`.
	OWNED_STOP_WORST_MS,
	READINESS_POLL_INTERVAL_MS,
} from "./backend-service";
export {
	INTERPRETER_RESOLUTION_WORST_MS,
	/*
	 * And the term that took the console one's place, exported for the same reason:
	 * `checkLocalOperatorExists` runs the launcher now (`probeGlobalLauncher`), and
	 * the quit path's failsafe has to outlast it (see `LAUNCHER_PROBE_WORST_MS`).
	 */
	LAUNCHER_PROBE_WORST_MS,
} from "./owned-serve-launch";
export { BackendInstaller } from "./backend-installer";
export { LogFileType, Logger, logger } from "./logger";
export type { BackendConfig } from "./config";
export { backendConfig, apiConfig } from "./config";
