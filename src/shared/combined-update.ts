export type CombinedUpdateTargets = { app: string; server: string };

export type CombinedUpdateFailure =
	| "busy"
	| "offer_changed"
	| "app_preparation_failed"
	| "server_failed"
	| "app_install_failed";

/** Accepted means the normal desktop installer owns the quit/relaunch, not that it finished. */
export type CombinedUpdateResult =
	| { status: "handoff" }
	| { status: CombinedUpdateFailure };
