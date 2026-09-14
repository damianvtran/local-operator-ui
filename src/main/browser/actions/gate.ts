import type { DriveableView } from "../electron-types";
import { BrowserHostError } from "../errors";
import { permittedScheme, settle } from "../settle";
import type { BrowserActionContext } from "./context";

/**
 * The per-hop origin gate for an agent-initiated navigation, and the navigation
 * itself. Design: docs/design/ui-browser-tab.md 6.1, 9.2, 12.1 (`Fetch.enable` /
 * `Fetch.requestPaused` / `Fetch.failRequest`, ported from the extension's
 * `withOriginGate`).
 *
 * WHY a per-hop gate and not just a check at command entry: a navigation is not
 * one request. `open https://approved.example` can be redirected — by the site,
 * by an SSO chain, by a link shortener — to an origin the user never approved,
 * and a host that only checks the URL it was handed has delegated the agent's
 * reach to whatever the first response says. Chromium pauses every Document-stage
 * request for us while the gate is installed, so each hop is decided on its own.
 *
 * WHY it is armed only AROUND an agent navigation and disarmed after: the user's
 * own browsing must not be gated by this. The gate is a property of an agent
 * command, not a standing policy on the tab — the extension makes the same choice
 * for the same reason (a human clicking a link needs no approval flow).
 *
 * The refusal is the code the session already knows: `origin_not_allowed`. A
 * refused hop fails that request with `BlockedByClient`, which makes the
 * navigation itself fail — so the caller reads a typed refusal naming the origin
 * rather than a page it did not ask for.
 */

export interface OriginGateResult {
	/** Origins refused during the gated operation, in hop order. */
	blocked: string[];
}

/**
 * Run `operation` with the Document-stage gate armed.
 *
 * `approved` answers whether a URL may proceed. It is the caller's closure over
 * the approval store, the requester and any one-shot grant consumed at command
 * entry, so the gate holds no policy of its own and the "decided once at entry"
 * rule (the extension's round-1 M1) is not accidentally re-litigated per hop.
 */
export async function withOriginGate<T>(
	ctx: BrowserActionContext,
	view: DriveableView,
	requester: string,
	approved: (url: URL) => boolean,
	operation: () => Promise<T>,
): Promise<T> {
	const contents = view.webContents;
	const blocked: string[] = [];
	const seen = new Set<string>();
	const unsubscribe = ctx.cdp.subscribe(contents.id, (method, params) => {
		if (method !== "Fetch.requestPaused") return;
		const requestId =
			typeof params.requestId === "string" ? params.requestId : "";
		if (!requestId) return;
		const rawUrl =
			typeof params.request === "object" && params.request !== null
				? (params.request as { url?: unknown }).url
				: undefined;
		let url: URL | null = null;
		try {
			url = rawUrl === undefined ? null : new URL(String(rawUrl));
		} catch {
			url = null;
		}
		const refuse = (origin: string): void => {
			if (!seen.has(origin)) {
				seen.add(origin);
				blocked.push(origin);
				ctx.log(
					`[browser] refused a navigation hop for ${requester}: ${origin} is not approved`,
				);
			}
			void ctx.cdp
				.send(contents, "Fetch.failRequest", {
					requestId,
					errorReason: "BlockedByClient",
				})
				.catch(() => {});
		};
		// A request whose URL we cannot parse is not a Document we should fetch.
		if (!url || !permittedScheme(url)) {
			refuse(String(rawUrl ?? "unparseable"));
			return;
		}
		if (approved(url)) {
			void ctx.cdp
				.send(contents, "Fetch.continueRequest", { requestId })
				.catch(() => {});
			return;
		}
		refuse(url.origin);
	});

	try {
		await ctx.cdp.send(contents, "Fetch.enable", {
			patterns: [{ resourceType: "Document", requestStage: "Request" }],
		});
		return await operation();
	} catch (error) {
		// A hop we refused explains the failure better than the navigation error it
		// caused, so it wins the response the caller reads.
		if (blocked.length) {
			throw new BrowserHostError(
				"origin_not_allowed",
				`the user has not approved ${blocked[0]} for agent access`,
				{ origin: blocked[0], blocked: blocked.slice() },
			);
		}
		throw error;
	} finally {
		unsubscribe();
		try {
			await ctx.cdp.send(contents, "Fetch.disable", {});
		} catch {
			// A view that closed mid-navigation needs no cleanup, and a failed
			// disable must not replace the operation's own outcome.
		}
	}
}

/**
 * Navigate a view and wait for the page that actually arrives.
 *
 * `loadURL` starts the navigation; the settle reports where it ended up, so a
 * redirect, a login wall or a consent interstitial shows in the result rather
 * than hiding behind what the agent asked for. The settle is armed BEFORE the
 * load, because a navigation can finish before `loadURL`'s promise resolves and
 * a listener attached afterwards would wait forever.
 *
 * THE SETTLE OWNS THE OUTCOME, and the load's promise is deliberately NOT given
 * a ceiling of its own. Awaiting `loadURL` first (inside a 35 s deadline, 5 s
 * more than the 30 s budget both sides publish) is what made the typed
 * `nav_timeout` unreachable: Electron's `loadURL` promise resolves when the
 * frame stops being busy and NEVER resolves for a server that accepts the
 * connection and then answers nothing, so on exactly the hung-page input the
 * deadline always won and the model read a generic
 * `internal` + `data.stalled` with no remedy (QA round 1, Q1). With the settle
 * as the authority, a hung page ends at its own `timeoutMs` — which is
 * `COMMAND_TIMEOUTS_S.goto`, the number the session client already budgets for
 * plus its own 5 s slack — with the typed code `settle.ts` and the design's
 * failure table both promise.
 */
export async function navigateView(
	ctx: BrowserActionContext,
	view: DriveableView,
	url: URL,
	requester: string,
	approved: (candidate: URL) => boolean,
	timeoutMs = 30_000,
): Promise<{ url: string; title: string }> {
	const contents = view.webContents;
	return withOriginGate(ctx, view, requester, approved, async () => {
		const settled = settle(contents, timeoutMs);
		// Both arms are started before either is awaited, so a load that finishes
		// before the settle's listeners are armed cannot be missed.
		await Promise.race([settled, loadFailure(contents.loadURL(url.href))]);
		return { url: contents.getURL(), title: contents.getTitle() };
	});
}

/**
 * A promise that settles only when `loadURL` fails OUTRIGHT.
 *
 * The resolve arm is a promise that never settles, because a resolved
 * `loadURL` is not a navigation result here: the settle reports what actually
 * arrived, and it is the only thing that knows about `did-fail-load`'s typed
 * `nav_failed` and its own `nav_timeout`. The reject arm is real and keeps the
 * failures no event describes — a view torn down under the call, an
 * `ERR_ABORTED` — visible instead of hanging to the settle's ceiling.
 *
 * `Promise.race` attaches a reaction to BOTH promises, so whichever arm loses
 * is still handled: an abandoned settle clears its own listeners and timer in
 * `finish()`, and a late `loadURL` rejection cannot surface as an unhandled
 * rejection in the main process.
 */
function loadFailure(load: Promise<void>): Promise<never> {
	return load.then(
		() => new Promise<never>(() => {}),
		(error: unknown) => {
			throw error;
		},
	);
}

/** The page the view is showing right now. Always reported from the view, never
 * from what was requested: a redirect, an interstitial or a login wall must show
 * up in the result (the tool's `_page_line` rule). */
export function pageOf(view: DriveableView): { url: string; title: string } {
	return {
		url: view.webContents.isDestroyed() ? "" : view.webContents.getURL(),
		title: view.webContents.isDestroyed() ? "" : view.webContents.getTitle(),
	};
}
