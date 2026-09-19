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
 * WHY the gate is scoped to the MAIN frame, and what it cost to learn: CDP's
 * `Document` resource type covers SUBFRAME documents, not only navigation hops.
 * Measured on Electron 44.3.0 / Chromium 152, two loopback origins, the app's own
 * gate shape armed with `patterns: [{ resourceType: "Document" }]` and only A
 * approved:
 *
 *   PAUSED type=Document frameId=<main>      CONTINUE http://127.0.0.1:<A>/top.html
 *   PAUSED type=Document frameId=<subframe>  REFUSE   http://127.0.0.1:<B>/frame.html
 *
 * So for the whole time an agent navigation was in flight, every cross-origin
 * iframe document was failed with `BlockedByClient`: Cloudflare's Turnstile
 * widget (`challenges.cloudflare.com`), SSO frames, embedded logins, payment
 * frames. That is the real cause of "the captcha never passes" — the human's
 * click lands on a widget whose own document was refused before it ever ran, and
 * it also worsened the same pages the approval system exists to make reachable.
 *
 * The security property is unchanged: a MAIN-frame document is still decided hop
 * by hop, including every hop of a redirect chain, because the main frame's own
 * id is what the paused request is compared against.
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
 * The main frame's CDP frame id, or null when it cannot be read, plus whether
 * this read enabled the `Page` domain.
 *
 * `Page.getFrameTree` is the only in-band way to learn which frame is the top
 * one, and the id it returns is STABLE across a cross-origin main-frame
 * navigation — measured, because the fix depends on it: the same id
 * (`31E4C824…`) came back before the load, on the top-level document's own
 * paused request, and again on a cross-origin navigation of that frame.
 *
 * WHY `Page.enable` FIRST: `getFrameTree` answers for a target that has a
 * document, and the app's every path calls `cdp.attach` immediately before the
 * gate arms — and `attach` itself loads `about:blank` when a view has never
 * navigated (see `cdp.ts`), so a gate that runs has something to read. The
 * measurement that makes this non-optional: on a target with no document at
 * all, `Page.enable` never answers (90 s, no reply).
 *
 * WHY THE CALLER IS TOLD WHETHER IT ENABLED THE DOMAIN: nothing else consumes
 * `Page` — `log-capture.ts` routes only `Runtime` and `Log` — so leaving it on
 * costs event volume for the rest of an agent tab's life, and the always-attached
 * debugger domain is one of the untested discriminators for the Cloudflare stall
 * (`docs/design/browser-challenges-and-passkeys.md` § 2.2(b)). An experiment that
 * measures "the debugger attachment" has to know whether `Page` was part of it,
 * so the gate disables what it enabled rather than leaving that to inference.
 *
 * A null answer is NOT an error to surface: the caller falls back to deciding
 * every paused Document, which is the stricter rule and the behaviour this gate
 * had before frame discrimination existed.
 */
export interface MainFrameRead {
	mainFrameId: string | null;
	/** True when `Page` may be enabled because of THIS read, and therefore owes a
	 * `Page.disable`. Set as soon as the enable resolves rather than at the end of
	 * the read: `Page.enable` is what turned the domain on, so a `getFrameTree`
	 * that fails afterwards must still report the debt (agent review round 2, R3).
	 * False for a read whose enable never resolved — including one whose reply
	 * never came inside the send's bound, where the domain's state is unknown and
	 * the disable is therefore sent anyway (it is idempotent). */
	pageEnabled: boolean;
}

async function resolveMainFrameId(
	ctx: BrowserActionContext,
	contents: DriveableView["webContents"],
): Promise<MainFrameRead> {
	let pageEnabled = false;
	try {
		await ctx.cdp.send(contents, "Page.enable", {});
		pageEnabled = true;
		const tree = await ctx.cdp.send<{
			frameTree?: { frame?: { id?: unknown } };
		}>(contents, "Page.getFrameTree", {});
		const id = tree?.frameTree?.frame?.id;
		return {
			mainFrameId: typeof id === "string" && id ? id : null,
			pageEnabled,
		};
	} catch {
		return { mainFrameId: null, pageEnabled };
	}
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
	const frameTree = await resolveMainFrameId(ctx, contents);
	const mainFrameId = frameTree.mainFrameId;
	if (mainFrameId === null) {
		ctx.log(
			`[browser] could not read the frame tree for ${requester}; this navigation is gated on every Document request, which may refuse cross-origin frames the page needs${
				// The domain's state travels with the fallback because it is not
				// inferable from the failure: an enable that resolved and a read that
				// did not left `Page` armed, an enable that never resolved did not
				// (agent review round 2, R3).
				frameTree.pageEnabled ? " (the Page domain may still be enabled)" : ""
			}`,
		);
	}
	/** Requests whose frame could not be attributed to the main frame, counted so
	 * the log can say the strict fallback actually ran rather than leaving a reader
	 * to infer it. */
	let unattributed = 0;
	const unsubscribe = ctx.cdp.subscribe(contents.id, (method, params) => {
		if (method !== "Fetch.requestPaused") return;
		const requestId =
			typeof params.requestId === "string" ? params.requestId : "";
		if (!requestId) return;
		const frameId = typeof params.frameId === "string" ? params.frameId : "";
		/*
		 * A paused document that is NOT the main frame is not a navigation hop: it is
		 * a subframe's own document (a captcha widget, an SSO frame, an embedded
		 * login, an ad), and the agent's approval of the top-level origin says nothing
		 * about it — grounding every page the agent can load on a rule about iframes
		 * is what broke the widget in the first place. The frame ATTRIBUTION is what
		 * decides this, never the URL: a subframe on the approved origin is continued
		 * for the same reason a subframe elsewhere is.
		 *
		 * An EMPTY frame id with a readable frame tree is the unattributed case and
		 * keeps the strict decision, because a request this gate cannot place is not
		 * evidence that it is a subframe; the count below is reported so the fallback
		 * is visible if it ever runs.
		 */
		if (mainFrameId !== null && frameId && frameId !== mainFrameId) {
			void ctx.cdp
				.send(contents, "Fetch.continueRequest", { requestId })
				.catch(() => {});
			return;
		}
		if (mainFrameId !== null && !frameId) unattributed += 1;
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
		if (unattributed > 0) {
			ctx.log(
				`[browser] ${unattributed} paused document request(s) during ${requester}'s navigation carried no frame id; they were gated as navigation hops`,
			);
		}
		try {
			await ctx.cdp.send(contents, "Fetch.disable", {});
		} catch {
			// A view that closed mid-navigation needs no cleanup, and a failed
			// disable must not replace the operation's own outcome.
		}
		// Only what this call enabled: `Page` is otherwise left exactly as the gate
		// found it, so nothing else in the host inherits a debugger domain it did not
		// ask for (finding 5).
		if (frameTree.pageEnabled) {
			try {
				await ctx.cdp.send(contents, "Page.disable", {});
			} catch {
				// Same rule as above.
			}
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
