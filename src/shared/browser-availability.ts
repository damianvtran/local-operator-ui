/** Readiness is presentation, never permission or ownership. Optional on chrome
 * projections for compatibility with an older host. A non-ready empty projection
 * must not be rendered as the healthy, user-actionable empty-tab state. */
export type BrowserAvailability = {
	status: "starting" | "retrying" | "ready" | "unavailable";
	attempt: number;
	maxAttempts: number;
	message: string | null;
	/** Whether the renderer may offer a retry control for this state. True only
	 * when the window is open and no host is running, so the control cannot race
	 * an in-flight attempt or a live host. Keeps the recovery affordance on the
	 * typed projection rather than a separate channel the renderer would have to
	 * guess about. */
	canRetry: boolean;
};
