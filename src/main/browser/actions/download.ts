import { BrowserHostError } from "../errors";
import { CAPS } from "../vendor/driver/file-transfer.tables.gen";
import type { BrowserActionContext } from "./context";
import { numberParam, stringParam } from "./context";
import { pageOf } from "./gate";
import { click } from "./input";

/**
 * `download`: arm one tab, optionally start the page's own download, and report
 * what landed where.
 * Design: docs/design/browser-file-transfer.md §6.1, §6.2, §7.3, §10.2, §10.3,
 * §11.4.
 *
 * WHY THE SELECTOR IS OPTIONAL. A page starts a download in one of two ways: the
 * agent clicks a link or button, or the page has already started one (a POST
 * response with `Content-Disposition`, a redirect chain that ends in a file).
 * Arming without a selector serves the second; arming with one serves the first
 * and is the shape the 2026-09-18 receipts case needs. The click goes through
 * `click` rather than a second click implementation, so ref resolution, the epoch
 * rule and the navigation settle are the ones this host already enforces.
 *
 * WHY THIS ACTION IS NOT IN `NAVIGATION_ACTIONS`, which is a decision rather than
 * an omission. The dispatcher arms the per-hop `Fetch` gate for the actions that
 * can navigate, and the criterion fits (this clicks). It is deliberately not
 * applied here because the gate decides DOCUMENT-stage requests, and a download
 * from a page is routinely a cross-origin URL the tab was never approved for —
 * a signed S3 or CDN link. Gating it would refuse exactly the downloads the
 * feature exists to make possible, for a navigation the user does not see.
 * What still holds is the entry-and-result authorization every document-scoped
 * action gets: if the click navigated to an unapproved origin, the result check
 * refuses this call's answer instead of describing a document the agent never had.
 *
 * WHY THE RESULT CARRIES A `reason` AND NOT AN ERROR (§6.2). A page that starts
 * no download, a name the host refused, a file over the cap: each is a DECISION
 * with a payload, and an already-released daemon DROPS a frame carrying an
 * `ErrorCode` it does not know — so a policy answer that travelled as an error
 * would arrive as a mystery timeout. `ok: true` plus a reason is the honest
 * shape, and it is what lets this host say more than a code and a message would.
 */
export async function download(
	ctx: BrowserActionContext,
	params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const record = ctx.registry.requireSurface(params.tab);
	const dir = stringParam(params, "dir");
	if (!dir) {
		// The directory is the one thing this action cannot default. Falling back to
		// the user's own Downloads folder would be the behaviour the pre-feature
		// refusal existed to prevent (§4(a)), and `tempfile.gettempdir()`'s shared,
		// world-readable equivalent is the other rejected root (§1.4).
		throw new BrowserHostError(
			"internal",
			"download needs the harness-composed directory to write into",
			{ param: "dir" },
		);
	}
	const timeoutS = clampTimeout(numberParam(params, "timeout_s"));
	const selector = stringParam(params, "selector");

	// ARM BEFORE THE CLICK, and this order is load-bearing: a download that starts
	// synchronously inside the click would otherwise arrive at a tab with no arm and
	// be CANCELLED by the pre-feature default, which is a race that would look like
	// an intermittent failure on fast files. The arm is INSIDE the `try` (review round
	// 2, R2-6) so the `finally` really does cover "whatever happened": an `arm` that
	// threw part-way — a directory this host cannot create is now a typed refusal
	// rather than an untyped escape — cannot leave a capture nobody will release.
	try {
		const arm = ctx.downloads.arm(record.tabId, dir, timeoutS * 1000);
		if (selector) await click(ctx, params);
		const result = await arm.done();
		ctx.registry.touch(record);
		return {
			files: result.files,
			armed: result.armed,
			reason: result.reason,
			// The page's own identity, as every other action reports it: a caller that
			// named a selector wants to know what it was looking at when the file
			// started, and a click can have moved the page.
			...pageOf(record.view),
		};
	} finally {
		// Released whatever happened: a click that refused (element not found, a
		// navigation the gate blocked) must not leave the tab able to write files
		// nobody is waiting for.
		ctx.downloads.forget(record.tabId);
	}
}

/** The wait, clamped to the harness's own window.
 *
 * The default and the ceiling are the GENERATED ones (`browser_files.
 * DOWNLOAD_TIMEOUT_S` / `DOWNLOAD_TIMEOUT_MAX_S`, emitted into the vendored
 * tables), not a number spelled here: the two hosts and the tool layer have to
 * agree on how long a download may take, and a second constant is how they stop
 * agreeing. A caller that asks for longer than the ceiling gets the ceiling — the
 * daemon's 120 s budget for this method is above it deliberately (§6.1). */
function clampTimeout(requested: number | undefined): number {
	const wanted = requested === undefined ? CAPS.downloadTimeoutS : requested;
	if (!Number.isFinite(wanted) || wanted <= 0) return CAPS.downloadTimeoutS;
	return Math.min(wanted, CAPS.downloadTimeoutMaxS);
}
