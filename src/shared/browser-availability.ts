/** Readiness is presentation, never permission or ownership. Optional on chrome
 * projections for compatibility with an older host. A non-ready empty projection
 * must not be rendered as the healthy, user-actionable empty-tab state. */
export type BrowserAvailability = {
	status: "starting" | "retrying" | "ready" | "unavailable";
	attempt: number;
	maxAttempts: number;
	message: string | null;
};
