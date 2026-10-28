import { useConsentAttention } from "@shared/browser-consent-attention";
import {
	registerBrowserViewRect,
	useBrowserViewSuppressed,
	useSuppressBrowserView,
	useSuppressedOverlayIds,
} from "@shared/browser-view-policy";
import { Spinner } from "@shared/components/common/spinner";
import { Badge, countLabel } from "@shared/components/ui";
import { Button, Tooltip } from "@shared/components/ui";
import { currentLocale, resolveLanguage, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { AlertTriangle, Globe, ShieldCheck, X } from "lucide-react";
import type { FC } from "react";
import {
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	type AddressController,
	useBrowserChords,
} from "../hooks/use-browser-chords";
import {
	type BrowserTabView,
	useBrowserChrome,
} from "../hooks/use-browser-chrome";
import {
	originOfUrl,
	requestsInScope,
	useApprovalQueue,
} from "../model/approval-queue-model";
import { browserBridge } from "../model/browser-projection-store";
import { browserOverlaySuppressing } from "../model/self-suppression";
import { browserOwnStateFor } from "../model/start-page";
import {
	type SurfaceScope,
	scopeFromKey,
	scopeKey,
	tabsInScope,
} from "../model/tab-index-model";
import { sessionDisplayName } from "../model/tab-index-model";
import { useApprovalsDockWidth } from "../model/use-approvals-dock-width";
import { BrowserApprovalsDock } from "./browser-approvals-dock";
import { defaultApprovalHeaderLabel } from "./browser-approvals-tray";
import { BrowserConsentBar } from "./browser-consent-bar";
import { requesterLabel } from "./browser-consent-request";
import { BrowserFileTransferRow } from "./browser-file-transfer-row";
import { BrowserFindRow } from "./browser-find-row";
import { BrowserHandOverDialog } from "./browser-hand-over-dialog";
import { BrowserLoadFailure } from "./browser-load-failure";
import { BrowserNewTab } from "./browser-new-tab";
import { BrowserPageMenu } from "./browser-page-menu";
import { BrowserTabStrip } from "./browser-tab-strip";
import {
	type AddressDismissIntent,
	type AddressFocusRequest,
	BrowserUrlBar,
} from "./browser-url-bar";

/**
 * The browser surface: everything that exists once per host.
 * Design: docs/design/ui-browser-tab.md 11.1 (one `WebContentsView` per tab),
 * 11.2 (who owns the rectangle), 11.3 (the layering consequence), 11.4 (focus),
 * 11.6 (popups — amended by docs/design/browser-oauth-popups.md), 11.8 (human
 * takeover), 11.9 (a route now,
 * a panel later); docs/design/browser-approval-ux.md 2 (the band is the
 * interactive surface), 4 (the surfaces), 7.1 (one implementation, two hosts).
 *
 * WHY THIS IS A COMPONENT AND NOT A ROUTE. The operator's question ("what is the
 * agent in THIS conversation doing") is conversational, not global, so the feature
 * is going to be hosted twice: the route the rail points at, and a pane inside a
 * conversation (PR 2). Everything that is once per host lives here — the rect
 * reporter, the view-visibility policy, the error notice, the tray, the
 * dock, the tab strip and URL bar wiring — and the only thing a host chooses is
 * its two scopes, its evidence tags, and its header wording. Re-implementing the
 * strip and the tray per host is rejected for the same reason `branding.md`
 * refuses a second button implementation: they would drift.
 *
 * TWO SCOPES, NOT ONE (spec §7.2, and QA round 1's Q1 is why this is a pair).
 * `tabScope` answers "which tabs does this host show", and the pane's header
 * switch is what changes it. `requestScope` answers "whose approvals does this
 * host show", and NOTHING in this component may let the first answer the second:
 * a request belongs to a conversation by WHO ASKED (spec 7.2), so on the pane's
 * All-tabs side the tray still shows only this conversation's requests - and,
 * the half that matters, an entry never leaves the queue model's input because
 * the user pressed the switch, which is what made the surface print
 * `Withdrawn by the agent` over a request that was still pending.
 *
 * PR 1 shipped these as one `scope` prop (spec §9, item 1) because the only host
 * was the route, where the two questions have the same answer. They do not in a
 * pane, and one prop could not express the difference: the tabs are scoped by
 * SESSION, the requests by REQUESTER, and the switch moves only the first. A tab
 * with no session attribution is not any conversation's and appears only under
 * `"all"` (design 7.3), in the tab scope alone.
 *
 * THE LAYOUT CONTRACT, which is the part with a rule behind every line: the
 * renderer owns layout, so this component measures the element where the page
 * should go and reports `{x, y, width, height}` to main, which applies it with
 * `view.setBounds` to the ACTIVE tab only. Everything that can move the rectangle
 * goes through one `ResizeObserver` plus a window `resize` listener: window
 * resize, the rail collapsing or expanding (the rail is a flex sibling, so this
 * element's box changes), route changes away and back (the observer fires on
 * mount and the cleanup reports null), and — new here — the dock opening or
 * closing, because the dock is a flex sibling of the content element rather than
 * an overlay (§4.2). That last one is why the dock needs no suppression: the page
 * narrows and the host re-bounds the view on the next measurement.
 *
 * WHY A NULL RECT ON UNMOUNT, rather than only hiding the view: this owns the only
 * thing that knows where the native view belongs, so the moment it unmounts
 * nothing does. Main treats a null rect as "nowhere to paint" and hides every
 * view, so leaving the surface cannot leave a page painting over the rest of the
 * app. One host is mounted at a time, so there is exactly one rect reporter
 * (design 7.3), and the handover is a required test.
 *
 * FOCUS (design 11.4): nothing here focuses anything except the approvals dock,
 * whose opening moves focus to its own header (§4.2's keyboard contract) and whose
 * Escape returns focus to the Approvals control that opened it. Creating a view and
 * setting its bounds does not focus; `view.webContents.focus()` is never called,
 * and the repo's window-mode guard scans `src/main/` for the forbidden calls. An
 * agent `open` does not activate the new tab either — main appends it and marks it,
 * and this component only ever reflects the active tab main reports.
 *
 * HUMAN TAKEOVER (design 11.8): every tab in the strip is the user's. They can
 * click it, type a URL, reload, go back, and interact with the page directly. No
 * lock, no modal claim, no "agent busy" state — the safety mechanism for the
 * concurrent case is main's per-tab command lane and the epoch-stamped refs, not
 * a UI lock, so there is nothing to render for it here.
 */

/** The rect in CSS pixels, rounded, because Electron positions a native view in
 * device-independent pixels and a fractional origin shows as a seam. */

function measure(element: HTMLElement): {
	x: number;
	y: number;
	width: number;
	height: number;
} {
	const rect = element.getBoundingClientRect();
	return {
		x: Math.round(rect.left),
		y: Math.round(rect.top),
		width: Math.round(rect.width),
		height: Math.round(rect.height),
	};
}

export interface BrowserSurfaceProps {
	/** Which tabs this host shows. See the header comment. A host may pass a fresh
	 * object on every render: the surface keys its filters on the scope's VALUE (see
	 * `scopeKey` for the loop that naivety caused), so identity is free here. */
	tabScope: SurfaceScope;
	/**
	 * Whose approvals this host shows. Per host and NOT per switch: the route counts
	 * every request, and a conversation host counts the ones its own agent raised,
	 * whichever list its strip is showing (spec 7.2).
	 *
	 * It also has to be the scope the deck's words agree with: a host that hands
	 * down a conversation here must hand down the sentence for it too, which is the
	 * other half of `approvalHeaderLabel` (`browser-pane.tsx` states the pair).
	 */
	requestScope: SurfaceScope;
	/**
	 * The conversation THIS HOST belongs to, or `null` for a host that is not one.
	 *
	 * SEPARATE FROM `tabScope`, and the design's R1 is the reason: `tabScope` is a
	 * LENS over the pool (which tabs are listed) and this is an ORIGIN (which
	 * conversation the host is). The scope switch changes the first and must never
	 * change the second — a lens that changed what `New tab` did would mean a tab
	 * opened while reading All tabs could not be found after switching back to This
	 * conversation, which is the half-truth class this feature's copy standard
	 * exists to prevent.
	 *
	 * So a tab the user opens here is attributed to this conversation, and the pane
	 * on a DRAFT (`sessionId === null`) opens an unattributed tab like the route's,
	 * because a draft is not a conversation to attribute anything to.
	 */
	hostSessionId: string | null;
	/**
	 * This host IS the whole page (the `/browser` route), as opposed to a pane inside
	 * a conversation's rail slot. Window glass needs the fact explicitly: a page that
	 * is its own column clears the `<main>` backing (`data-glass-split`), and a pane
	 * in a conversation must NOT, or the conversation column behind it loses its
	 * ground. It is NOT derivable from `hostSessionId === null`: the rail pane on a
	 * session-less chat (a draft) also has a null session (QA round 2, Q2-1: the
	 * conversation column read alpha 0.00 with that pane open).
	 */
	isRoutePage?: boolean;
	/** This host's own evidence tag, so a run can say which host it drove (§9's
	 * item 4: the hosts never co-mount, but a test has to know which one it is
	 * driving, and PR 2's pane passes its own). */
	surfaceTag: string;
	/** The dock's evidence tag, per host, for the same reason. */
	dockSurfaceTag: string;
	/** The tray header's wording, because the sentence is a fact about the REQUEST
	 * scope: the route counts every request, and the pane counts only the requests
	 * this conversation's agent raised and has to say so (spec 7.2, interface 3).
	 *
	 * A HOST MUST KEEP THIS IN STEP WITH `requestScope`, not with `tabScope`: a
	 * conversation host whose request scope is `"all"` - the pane on a draft, where
	 * there is no conversation to be "this" one - that hands down the conversation's
	 * sentence prints a claim about a conversation that does not exist (UX round 1,
	 * U4). The pane passes the pair together for exactly that reason. */
	approvalHeaderLabel?: (count: number) => string;
	/**
	 * The way out of a scope that has nothing in it, when the host HAS other tabs to
	 * show (spec 7.2).
	 *
	 * Absent on the route, where there is no narrower list to widen: a host whose
	 * tab scope is `"all"` already shows everything, so its empty state has nothing
	 * to offer and says the plain truth ("No tabs are open."). The pane passes it,
	 * and the surface renders
	 * the action only for a conversation scope — a host that has no other scope is a
	 * host that must not offer one.
	 */
	onShowAllTabs?: () => void;
}

const DEFAULT_APPROVAL_HEADER = defaultApprovalHeaderLabel;

/**
 * The card's row label. `requesterLabel` deliberately names an unnamed session
 * in the app's own words ("The agent in an untitled chat"), which leaves two
 * untitled sessions indistinguishable; two rows then differ only by expiry (U10).
 * Appending a short session discriminator to THAT fallback is the one piece of
 * identity left; a named conversation still shows its title and nothing else.
 */
function cardRequesterLabel(
	id: string,
	sessions: ReadonlyArray<{ session_id: string; title?: string | null }>,
): string {
	const label = requesterLabel(id, sessions);
	return sessionDisplayName(id, sessions) === id
		? `${label} · ${id.slice(-4)}`
		: label;
}

export const BrowserSurface: FC<BrowserSurfaceProps> = ({
	tabScope,
	requestScope,
	hostSessionId,
	isRoutePage = false,
	surfaceTag,
	dockSurfaceTag,
	approvalHeaderLabel = DEFAULT_APPROVAL_HEADER,
	onShowAllTabs,
}) => {
	const tabPanelId = useId();
	/**
	 * WHY BOTH: `useId()` names this surface's tab panel elements (main's redesign,
	 * used at four sites below), and `useI18nLocale()` subscribes this component to
	 * locale changes so its extracted copy re-renders when the user switches
	 * language. They are independent concerns and neither replaces the other.
	 */
	useI18nLocale();
	const chrome = useBrowserChrome();
	/**
	 * The conversation list, read ONCE here and handed to the strip, which needs it
	 * for a group chip's name (design R3).
	 *
	 * WHY THE HOST READS IT rather than the strip: this is the same rule the
	 * hand-over dialog and the consent card already follow — a store read belongs to
	 * the component that owns the layout, and the strip has three hosts serving it.
	 * The selector is the narrow one (`state.sessions`) so a projection tick that
	 * changes anything else in that store cannot re-render the strip through it.
	 */
	const sessions = useCanonicalSessionsStore((state) => state.sessions);
	/**
	 * What the two `New tab` controls call themselves, from ONE rule.
	 *
	 * The label has to name where the tab will land, because that is the only thing
	 * the user cannot see: in a conversation the tab is attributed to it and will
	 * appear in This conversation, on the route or a draft it is attributed to
	 * nothing and will not. A label that said `New tab` in both places would leave
	 * the difference to be discovered by switching the scope and finding the tab
	 * gone, which is exactly the surprise R1 exists to remove.
	 *
	 * `"New tab in this conversation"` is long for the strip's `+`, and that is
	 * what `aria-label` is for: the glyph is unchanged and the accessible name is
	 * the sentence.
	 */
	const newTabLabel = hostSessionId
		? t("ui.browser.browser_surface.new_tab_in_this_conversation")
		: t("ui.browser.browser_surface.new_tab");
	const suppressed = useBrowserViewSuppressed();
	const suppressedBy = useSuppressedOverlayIds();
	/**
	 * Whether something OTHER than this surface's own state pages is covering the
	 * content area.
	 *
	 * The surface registers in the SAME registry every dialog, menu and tooltip
	 * uses (that is the point: one policy), but the start page and the failure
	 * panel are the browser, not an overlay over it. Two consumers need the
	 * difference: the paused note below (an overlay's note must never hide the
	 * browser's own panel) and main's shortcut ownership, which is told the reason
	 * with the hide so Cmd+L/T/R survive those two states. The id list lives in
	 * `model/self-suppression`, shared with the chord hook that filters the same
	 * snapshot.
	 */
	const overlaySuppressing = browserOverlaySuppressing(suppressedBy);
	const contentRef = useRef<HTMLDivElement | null>(null);
	/**
	 * The row the page and the dock share. Its width decides whether the side
	 * layout still has room for both; measuring the row (not the viewport) is
	 * what makes the pane's narrow width behave, including in a wide window.
	 */
	const { fullWidth: dockFullWidth, attachDockRow } = useApprovalsDockWidth();
	const approvalsTriggerRef = useRef<HTMLButtonElement | null>(null);
	/* The ⋯ trigger: at narrow widths the Approvals control is folded, so the
	   dock has no shield to return focus to and falls back to the menu it came
	   from (round-2 Q2-2). */
	const pageMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
	const [dockOpen, setDockOpen] = useState(false);

	/* A menu-opened dock mounts while Radix is still closing; the heading focus is
	   re-requested once the menu has handed focus back (round 3, U13). */
	const [dockFocusRequest, setDockFocusRequest] = useState(0);

	/** Which request's card is expanded. View state, defaulting to the attention
	 * entry and then to the oldest — exactly the band's rule before this feature
	 * (spec 4.1), never a second copy of main's queue. */
	const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
	const [handOverTab, setHandOverTab] = useState<BrowserTabView | null>(null);
	const [busy, setBusy] = useState(false);

	/**
	 * The scope, held by IDENTITY as well as by value.
	 *
	 * WHY THIS ONE LINE MATTERS, and it is a real defect rather than tidiness: every
	 * memo and every effect below keys on `scope`'s identity — the tab memo, the
	 * request memo, and the queue model's own effects — and the queue model's clock
	 * tick re-renders this component. A host that rebuilds its scope object per render
	 * (the pane does: `{ sessionId }` in its own render body) therefore produced a new
	 * filtered ARRAY per render, which re-ran the model's effect, which published the
	 * clock, which re-rendered — a render loop whose period is the microsecond it
	 * takes to run it, on a surface that still paints and so looks fine in a frame.
	 *
	 * The fix belongs HERE rather than only in the caller, because this component owns
	 * the model and the model's contracts are its to keep: it derives its own stable
	 * scope from the scope's VALUE (the route's `"all"`, or the session id, both
	 * primitives) and hands that to everything downstream, so no host can trip it.
	 */
	const scopeField = scopeKey(tabScope);
	const stableScope = useMemo<SurfaceScope>(
		() => scopeFromKey(scopeField),
		[scopeField],
	);
	/** The requests' scope, stabilised by the same rule and for the same reason - the
	 * queue model keys on its identity, and the pane hands this one down per session
	 * rather than per render. */
	const requestScopeField = scopeKey(requestScope);
	const stableRequestScope = useMemo<SurfaceScope>(
		() => scopeFromKey(requestScopeField),
		[requestScopeField],
	);

	const state = chrome.state;
	/**
	 * WHICH SURFACE THE SHIELD DESCRIBES. The native card (S6b) is the product
	 * path when the launch built it; the DOM dock is the fallback. One boolean
	 * feeds the button's selected style, aria-expanded and toggle, so the two
	 * states cannot disagree.
	 */
	const nativeApprovalsCard = state?.approvalsCard;
	const approvalsOpen = nativeApprovalsCard?.available
		? Boolean(nativeApprovalsCard.open)
		: dockOpen;
	/*
	 * THE CARD'S LOCALE FOLLOWS THE APP, INCLUDING WHEN IT AUTO-PRESENTS (U5).
	 * The renderer is the only side that resolves the locale, so it pushes the
	 * resolved tag and direction to main whenever the route mounts or the locale
	 * changes; without this the card rendered in `en` until the first explicit
	 * open, because only `open()` carried the context.
	 */
	const locale = currentLocale();
	/*
	 * THE MODE COMES FROM THE APP'S OWN SIGNAL, not from the palette's name (F3):
	 * nine shipped light palettes (alucard, catppuccinLatte, iceberg,
	 * kanagawaLotus, linen, paper, rosePineDawn, sage, tokyoNightDay) do not
	 * contain "light", and the old substring test painted all of them dark. The
	 * exact palette name travels too, so the card paints in the user's palette
	 * rather than localOperatorLight/Dark.
	 */
	const cardPalette =
		typeof document !== "undefined"
			? (document.documentElement.dataset.theme ?? null)
			: null;
	const cardTheme =
		typeof document !== "undefined" &&
		document.documentElement.classList.contains("dark")
			? "dark"
			: "light";
	/*
	 * WHO ASKED, resolved by the side that has the session titles (F2). The queue
	 * carries only `requesterSessionId`; main cannot name a conversation, and the
	 * queue's `requester` is an authority boundary. The map is memoised on the
	 * ids so a projection tick with the same queue does not restart the card's
	 * measurement.
	 */
	const requesterIdsKey = (state?.pendingConsent ?? [])
		.map((row) => row.requesterSessionId ?? "")
		.filter(Boolean)
		.join("|");
	const requesterLabels = useMemo(() => {
		// The labels are catalogue text; touching the locale makes a language
		// switch invalidate this map (requesterLabel has no locale parameter).
		void locale;
		const labels: Record<string, string> = {};
		for (const id of requesterIdsKey.split("|")) {
			if (id && !labels[id]) labels[id] = cardRequesterLabel(id, sessions);
		}
		return labels;
		// `locale` is a dependency because `requesterLabel` formats through the
		// catalogue: a language switch must relabel the map, not only re-push it.
	}, [requesterIdsKey, sessions, locale]);
	useEffect(() => {
		if (!nativeApprovalsCard?.available) return;
		void window.api?.browser.setApprovalsCardContext({
			locale,
			dir: resolveLanguage(locale).dir,
			theme: cardTheme,
			palette: cardPalette,
			requesterLabels,
		});
	}, [
		nativeApprovalsCard?.available,
		locale,
		cardTheme,
		cardPalette,
		requesterLabels,
	]);
	/*
	 * KEYBOARD ENTRY IS THE SHIELD, AND CLOSING MUST GIVE IT BACK (U1). Close and
	 * Escape focus the page in main; the shield is app DOM, not page content, so
	 * the trigger button is focused here on the true→false transition. Without
	 * this a keyboard user who opened the card had no way back into the chrome.
	 */
	const cardWasOpen = useRef(false);
	useEffect(() => {
		const isOpen = Boolean(nativeApprovalsCard?.open);
		if (cardWasOpen.current && !isOpen) {
			approvalsTriggerRef.current?.focus();
		}
		cardWasOpen.current = isOpen;
	}, [nativeApprovalsCard?.open]);

	// The scope filter, applied to the projection the strip, the URL bar and the
	// waiting chips all read. `state?.tabs` is a fresh array per projection, so the
	// filter is memoised on it rather than on `state`.
	const allTabs = state?.tabs;
	const tabs = useMemo(
		() => tabsInScope(allTabs ?? [], stableScope),
		[allTabs, stableScope],
	);
	const activeTab =
		tabs.find((tab) => tab.tabId === state?.activeTabId) ?? null;
	const addressRef = useRef<HTMLInputElement>(null);
	/**
	 * THE PERMANENT ROW'S FOCUS DOOR (S5).
	 *
	 * There is no second placement and no "raise": the field is always mounted, so
	 * every entry point (Cmd+L, a printable seed, the start page's mount) asks the
	 * row to take focus with a NONCE. `returnTo` is the origin of that request, and
	 * it is what decides where Escape/Enter hand focus back.
	 */
	const [focusRequest, setFocusRequest] = useState<AddressFocusRequest | null>(
		null,
	);
	const focusNonce = useRef(0);
	const returnTo = useRef<"page" | "chrome">("chrome");
	/** The row's box: the anchor the native suggestion child hangs from, and the
	 * width that decides which controls fold into the overflow menu. */
	const rowRef = useRef<HTMLDivElement | null>(null);
	const [anchor, setAnchor] = useState<{ x: number; width: number } | null>(
		null,
	);
	const [rowWidth, setRowWidth] = useState(0);

	/*
	 * ONE OWN-STATE FACT, TWO CONSUMERS (convergence round). The page menu and the
	 * chord hook must agree on "this tab has no page to control": a start
	 * projection (`""` included), a settled `about:blank`, or a failed load. In
	 * particular `about:blank` while a submitted navigation is loading is NOT
	 * own-state — the menu is enabled there, so the chords must be too.
	 */
	const navFailure = state?.navFailure ?? null;
	const onStartPage = browserOwnStateFor(activeTab, chrome.pendingUrl);
	const browserOwnState = onStartPage || navFailure !== null;

	const chordRootRef = useRef<HTMLDivElement | null>(null);
	/**
	 * WHERE A DISMISSED EDIT HANDS FOCUS BACK.
	 *
	 * Escape and Enter on an untouched seed are a return to the PAGE whenever one
	 * is presented (operator report, 2026-10-24): the field took the caret from
	 * the page it was editing, and the request's origin cannot answer where it
	 * belongs afterwards — a click into the field records `chrome` even with a
	 * page right below it, which parked a keyboard user on the chord root behind
	 * the page. The own-state test is the page fact, not the origin: a start page,
	 * a settled `about:blank` or a failed load has nothing to type into, so the
	 * chord root is still right. A committed navigation keeps the request-origin
	 * rule; a main-decided dismissal never reaches this callback, because main
	 * (or the press) has already put focus where it belongs. */
	const returnBrowserFocus = useCallback(
		(intent?: AddressDismissIntent) => {
			if (intent === "escape" || intent === "cancel") {
				if (browserOwnState) {
					chordRootRef.current?.focus({ preventScroll: true });
					return;
				}
				void browserBridge()
					?.focusPage()
					.catch(() => {});
				return;
			}
			if (returnTo.current === "page") {
				void browserBridge()
					?.focusPage()
					.catch(() => {});
				return;
			}
			chordRootRef.current?.focus({ preventScroll: true });
		},
		[browserOwnState],
	);

	const raiseAddress = useCallback(
		(options?: { origin?: "page" | "chrome"; seed?: string }) => {
			returnTo.current = options?.origin ?? "chrome";
			focusNonce.current += 1;
			setFocusRequest({
				nonce: focusNonce.current,
				seed: options?.seed,
				selectAll: options?.seed === undefined,
			});
		},
		[],
	);

	const addressController = useRef<AddressController>({
		raise: raiseAddress,
	});
	addressController.current = {
		raise: raiseAddress,
	};

	const {
		root: chordRoot,
		closeTab,
		findReturnToPage,
		openFind,
	} = useBrowserChords(
		chrome,
		tabs,
		hostSessionId,
		addressController,
		browserOwnState,
	);

	// The ROW's own band, remeasured on anything that can move it: the child list
	// is positioned by main from this anchor, and a stale width would paint it
	// under the wrong part of the row. The same measurement feeds the fold tiers
	// (Home at <360, Forward at <300), so the menu can never show a duplicate of a
	// control the row is currently painting.
	useLayoutEffect(() => {
		const element = rowRef.current;
		if (!element) return;
		const measureAnchor = (): void => {
			const rect = element.getBoundingClientRect();
			setAnchor({ x: Math.round(rect.left), width: Math.round(rect.width) });
			setRowWidth(Math.round(rect.width));
		};
		measureAnchor();
		const observer = new ResizeObserver(measureAnchor);
		observer.observe(element);
		window.addEventListener("resize", measureAnchor);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", measureAnchor);
		};
	}, []);

	// THE ONE CLOCK (spec 3.3). The queue model owns the 1s interval and the
	// ordinal, so the tray, the dock, the tab chips and the badge cannot disagree.
	//
	// THE REQUESTS' OWN SCOPE, which is NOT the one above. `requestsInScope` filters
	// a different field (the requester) from `tabsInScope` (the tab's session), and a
	// host hands down the two separately: that is what makes the pane's tray count
	// this conversation's live requests while its strip shows every tab, and the
	// route count every request, from the same component and the same model.
	const requests = state?.pendingConsent;
	const pendingRequests = useMemo(
		() => requestsInScope(requests ?? [], stableRequestScope),
		[requests, stableRequestScope],
	);
	const queue = useApprovalQueue(pendingRequests, tabs);

	// ---- layout: report the rectangle ---------------------------------------
	// `useLayoutEffect` so the first report lands before the browser paints: with
	// a passive effect the view would appear one frame after the chrome, which is
	// a flash of the placeholder under it.
	useLayoutEffect(() => {
		const element = contentRef.current;
		if (!element) return;
		const report = (): void => chrome.setContentRect(measure(element));
		report();
		// The SAME box, offered to the overlay policy: an overlay that is only
		// sometimes over the page (every shared `Tooltip`) decides whether it needs
		// the view hidden by overlapping THIS rect, not a copy of it that could drift.
		const unregisterRect = registerBrowserViewRect(() => measure(element));
		const observer = new ResizeObserver(report);
		observer.observe(element);
		// Also on window resize: a monitor switch changes the device pixel ratio
		// without necessarily changing this element's CSS box (design 11.2 names
		// "devicePixelRatio changes on a monitor switch" as a source of rect
		// change), and the observer cannot see that.
		window.addEventListener("resize", report);
		return () => {
			unregisterRect();
			observer.disconnect();
			window.removeEventListener("resize", report);
			// The surface is going away: nothing knows where the view belongs now.
			chrome.setContentRect(null);
		};
	}, [chrome.setContentRect]);

	// A banner click names the pending request; the band is already rendering it,
	// so the only job here is to make sure this surface is showing current state.
	useEffect(() => {
		const api = window.api?.browser;
		if (!api) return;
		return api.onConsentAttention(() => void chrome.refresh());
	}, [chrome.refresh]);

	const runBusy = useCallback(async (action: () => Promise<void>) => {
		setBusy(true);
		try {
			await action();
		} finally {
			setBusy(false);
		}
	}, []);

	// A banner click names the request it was raised for, and the shell has already
	// navigated here (see `shared/browser-consent-attention`). This surface's part is
	// to SELECT it — the band shows THAT request rather than the oldest.
	//
	// IT DOES NOT DECIDE WHEN THE MEMORY IS DROPPED, and that is deliberate (UX round
	// 1, U1): a surface sees one scope, so this one read "not in my list" as "gone" for
	// a request that belongs to no conversation here and cleared the memory before the
	// router had mounted the surface the click was for. The shell owns that question
	// now (`use-consent-attention-lifetime.ts`, called once in `app.tsx`); every
	// surface only reads the answer.
	const attention = useConsentAttention();
	const named = attention
		? pendingRequests.find((entry) => entry.entryId === attention)
		: undefined;
	// An attention click moves the selection, but a LOCAL selection is not thrown
	// away by an unrelated refresh: only a named request takes the selection over.
	useEffect(() => {
		if (named) setSelectedEntryId(named.entryId);
	}, [named]);

	const selectedRow =
		queue.rows.find((row) => row.request.entryId === selectedEntryId) ??
		queue.rows[0] ??
		null;
	const pendingSelected = selectedRow?.request ?? null;

	const decide = useCallback(
		(
			entryId: string,
			decision: Parameters<typeof chrome.respondToConsent>[1],
		) => {
			// Told to the model before the IPC leaves, so the row this answer came from
			// is not reported as "withdrawn by the agent" when the projection drops it
			// (spec 3.4: an answered request is excluded from the expiry memory).
			queue.noteDecision(entryId);
			void runBusy(() => chrome.respondToConsent(entryId, decision));
		},
		[chrome.respondToConsent, queue.noteDecision, runBusy],
	);

	/*
	 * THE BAND CAN UNMOUNT UNDER THE PRESSED CONTROL, so focus is handed on rather
	 * than dropped (UX round 2, U11). Answering the LAST request leaves the band
	 * nothing to render - a user decision writes no resolved row, that memory is for
	 * expiry and withdrawal - and the pressed control goes with it, so
	 * `document.activeElement` fell to `<body>` and a keyboard user restarted from the
	 * top of the document. The Approvals control is where `closeDock` sends focus too;
	 * this is the same "task finished" moment.
	 *
	 * ON THE TRANSITION, NOT ON A FRAME OF THE CLICK (review round 3, MINOR). The first
	 * version scheduled this in `requestAnimationFrame` from the click handler and
	 * bailed unless focus was already unowned - but the band is rendered from the
	 * projection, `noteDecision` writes only a ref, so at the next frame the pressed
	 * button was normally still mounted and still focused (Chromium focuses a button on
	 * click) and the guard returned. The band then unmounted when the IPC push landed,
	 * and focus fell to `<body>` exactly as before: the handoff only fired when the
	 * round trip beat the frame. Observing the band empty is the reliable signal, since
	 * it is the event that actually removes the focused node.
	 *
	 * Still guarded on focus being genuinely unowned and the dock being closed: an
	 * expiry elsewhere, or a user whose attention is on the page, must not have the
	 * control grabbed out from under them. `bandWasShowing` keeps a first mount with an
	 * empty queue from stealing focus on load.
	 */
	const bandShowing = queue.rows.length > 0 || queue.resolved.length > 0;
	const bandWasShowing = useRef(false);
	useEffect(() => {
		const wasShowing = bandWasShowing.current;
		bandWasShowing.current = bandShowing;
		if (bandShowing || !wasShowing) return;
		if (dockOpen) return;
		if (document.activeElement !== document.body) return;
		(approvalsTriggerRef.current ?? pageMenuTriggerRef.current)?.focus();
	}, [bandShowing, dockOpen]);

	const closeDock = useCallback(() => {
		setDockOpen(false);
		// Escape and the close button both return focus to the control that opened
		// the dock (spec 4.2's keyboard contract), so a keyboard user is not dropped
		// at the top of the document.
		(approvalsTriggerRef.current ?? pageMenuTriggerRef.current)?.focus();
	}, []);

	const currentOrigin = activeTab ? originOfUrl(activeTab.url) : null;
	// A failed load leaves Chromium's own surface in the view - blank, because
	// Electron ships no error page - so the reason can only be painted here, and the
	// view has to go away for this panel to be visible at all (design 11.3). That is
	// the same hide-and-restore lever the overlay policy uses; the id says which
	// reason applied, so a paused page is never mistaken for a broken one.
	// WHICH OF THE TWO EXPLANATIONS THE USER GETS WHEN BOTH ARE TRUE.
	//
	// A dialog can be open over a tab whose last load failed, and the two states say
	// different things: one is about something the user has just opened, the other
	// about the page underneath. The overlay wins, because it is the user's own
	// immediate action and its copy is a promise about what closing it does - a
	// promise that stays true here, since closing the dialog reveals the failure
	// panel. Letting the panel win instead left "close it to bring the page back"
	// unreachable in exactly the state it was written for.
	//
	// `overlaySuppressing` (above) is the filter, and it must stay one: every
	// registration THIS component makes is the browser itself, so a filter that
	// read one of them as "a dialog is open" would hide the state it registers for.
	// The list lives in `model/self-suppression` because the chord hook needs the
	// same answer; a second copy here is the drift that module prevents.
	const showingFailure =
		navFailure !== null &&
		state !== null &&
		tabs.length > 0 &&
		!overlaySuppressing;
	// Registered for the failure whether or not the panel is the thing on screen:
	// while an overlay is up the view is hidden anyway, and releasing the
	// registration behind a dialog would restore a blank Chromium surface over it.
	useSuppressBrowserView(
		navFailure !== null,
		"browser-state",
		"browser-load-failure",
	);

	// THE START PAGE (LOH-13 slice B). A fresh or Home-returned tab sits on
	// `about:blank`, whose native surface is a bare blank rectangle with no
	// way to tell it from a loaded empty page. While the ACTIVE tab is on that
	// start state the renderer paints its own start surface instead, so the
	// view is suppressed by the same lever as the failure panel — registered
	// whenever the state holds, shown only when no overlay owns the moment
	// (an open dialog's paused note keeps precedence, exactly as it does over
	// the failure panel). No URL is loaded and no origin is created — this is
	// DOM under a hidden view, and the tab's own `about:blank` is untouched.
	//
	// WHAT ENDS IT. The gate reads the facts MAIN owns about the tab it is
	// actually on — its url, its own per-tab `loading` — PLUS its own pending note
	// for that same tab (`chrome.pendingUrl`, F3/F4 round 3).
	//
	// THE PENDING TERM IS BACK, AND IT IS NOT THE ROUND-2 BUG. Round 2 removed it
	// because the note then outlived a refused attempt (F1): cleared only by a
	// landed non-blank url, it stayed set with the tab back on `about:blank`, so the
	// start page was suppressed for good behind a blank view. Two things changed and
	// make the term correct rather than dangerous. First, the note is RELEASED when
	// an attempt is refused (`navigate` in the hook), when a read lands a non-blank
	// page for that same tab (`refresh`), and by the explicit `home`/`stop`
	// controls — so it can no longer outlive its attempt. A start-state read
	// deliberately does NOT release it: an accepted navigate looks identical to an
	// idle start state until main pushes `did-start-loading`, so releasing there
	// would clear a legitimate submit (F4). Second, it is KEYED to the tab that
	// made it (F3), so the hook only reports it for the active tab, and neither the
	// round-2 leak across tabs nor a fresh tab reading another tab's state is
	// possible.
	//
	// WHY IT IS NEEDED AT ALL (F4). Without it the start page lingered over an
	// ACCEPTED navigation for the window between the user's submit and main's own
	// `loading` push: the last projection still said `about:blank` and
	// `loading:false` for that tab, so a page the user had just launched was
	// painted over by the start surface. The note is set synchronously on submit, so
	// it closes exactly that window.
	// `onStartPage` is derived above with `browserOwnState`, so the row's menu and
	// the chord hook cannot disagree about which tabs have a page to control.
	const showingNewTab =
		onStartPage && navFailure === null && !overlaySuppressing;

	// ---- the overlay policy -------------------------------------------------
	// One boolean → one IPC call → `setVisible(false)` on open and `(true)` on
	// close (design 11.3). The strip and the URL bar are outside the view's rect,
	// so they stay painted and the screen never looks empty. The approvals dock is
	// deliberately NOT part of this: it narrows the content rect instead, which is
	// the whole reason the queue lives in a dock rather than a sheet (spec §2).
	//
	// `ownPage` is the reason half: the view is hidden EITHER so an overlay can
	// paint OR so the browser's own start/failure state can. It is a property of
	// the STATE, not of `overlaySuppressing` — an overlay opened ON the start page
	// is still a start page, and main must keep refusing page controls there
	// (QA Q3-1: deriving it from the overlay filter turned the own-state refusal
	// off the moment the ⋯ menu opened).
	useEffect(() => {
		chrome.setViewVisible(
			!suppressed,
			suppressed && !overlaySuppressing,
			suppressed && browserOwnState,
		);
	}, [chrome.setViewVisible, suppressed, overlaySuppressing, browserOwnState]);

	const overlayHealth = state?.addressOverlay;
	const overlayMode: "popout" | "suspend" =
		overlayHealth?.mode === "popout" ? "popout" : "suspend";

	/*
	 * THE START PAGE HAS ONE FIELD NOW (S5, ruling 2). It used to centre its own
	 * input and Go button because the omnibox was hidden at rest. With a permanent
	 * row those would be two address fields for one value, so the row takes focus
	 * when the start state becomes current — a new tab, a Home press, a closed
	 * tab's replacement — and it is seeded from `refusedUrl` when a navigation was
	 * refused, which is the same "keep the address to correct" contract the start
	 * page's own field used to carry.
	 *
	 * The effect is armed on the TRANSITION into the start state, not on every
	 * render: a user who tabs away from the row to read the page must not have
	 * focus pulled back. A later refused URL re-seeds once per distinct value.
	 */
	const startFocusArmed = useRef(false);
	const lastRefusedSeed = useRef<string | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the transition and the refused address are the triggers.
	useEffect(() => {
		/* KEYED ON `onStartPage`, NOT `showingNewTab` (round-1 MINOR-1): the latter
		   also drops while an overlay suppresses the view, so closing any dialog on a
		   new tab pulled focus into the row a second time. The start STATE did not
		   change when the dialog opened, and it must not re-arm when it closes. */
		if (!onStartPage) {
			startFocusArmed.current = false;
			lastRefusedSeed.current = null;
			return;
		}
		const seed = chrome.refusedUrl ?? undefined;
		if (
			startFocusArmed.current &&
			(seed === undefined || seed === lastRefusedSeed.current)
		)
			return;
		startFocusArmed.current = true;
		lastRefusedSeed.current = seed ?? null;
		raiseAddress({ origin: "chrome", seed });
	}, [onStartPage, chrome.refusedUrl]);
	/*
	 * WHETHER THE OPAQUE WEBVIEW IS WHAT THE BARS SIT ABOVE. Window glass keys the
	 * route host's paint on this: with a live page the chrome band and the native
	 * surface cover the host, so it paints nothing and the band stays the sidebar's
	 * raw rung; on the start page, a failure or a loading state the host keeps its
	 * pane paint, which is the ground those surfaces were designed on.
	 */
	const glassLivePage =
		navFailure === null && !onStartPage && state?.activeTabId != null;
	useSuppressBrowserView(onStartPage, "browser-state", "browser-start-page");

	// A reachable IPC bridge is not a ready browser. In particular, startup's
	// empty projection must not offer New tab or claim the saved tabs are gone.
	const availability = state?.availability;
	if (availability && availability.status !== "ready") {
		return (
			<output
				className="flex h-full flex-col items-center justify-center gap-3 bg-elevated p-6 text-center"
				aria-live="polite"
				aria-busy={availability.status !== "unavailable"}
				data-tour-tag="browser-availability"
				data-browser-status={availability.status}
			>
				{availability.status === "unavailable" ? (
					<>
						<span className="flex items-center gap-2">
							<AlertTriangle className="size-6 text-warning" />
							<span className="text-title text-ink">
								{t("ui.browser.browser_surface.browser_unavailable")}
							</span>
						</span>
						<p className="max-w-sm text-body text-ink-muted">
							{availability.message}
						</p>
						{availability.canRetry ? (
							<Button
								variant="primary"
								size="sm"
								onClick={() => void chrome.retry()}
								data-tour-tag="browser-availability-retry"
							>
								{t("ui.browser.browser_surface.try_again")}
							</Button>
						) : null}
					</>
				) : (
					<>
						<Spinner size="lg" />
						<p className="text-body text-ink-muted">
							{availability.status === "retrying"
								? t("ui.browser.browser_surface.startup_retry", {
										attempt: availability.attempt,
										maximum: availability.maxAttempts,
									})
								: t("ui.browser.browser_surface.starting_browser")}
						</p>
					</>
				)}
			</output>
		);
	}

	if (!chrome.available) {
		return (
			<div className="flex h-full items-center justify-center bg-elevated p-6">
				<p className="text-body text-ink-muted">
					{t("ui.browser.browser_surface.the_browser_is_only_available_in_the")}
				</p>
			</div>
		);
	}

	return (
		/* The body's ground is the PANE's (`canvas/index.tsx`): this surface is the
		   inside of the drawer, so it wears the drawer's rung rather than the
		   conversation's, and the strip/client area above and below are continuous
		   with it. */
		<div
			ref={(node) => {
				chordRoot(node);
				chordRootRef.current = node;
			}}
			// A programmatic rest-stop, not a control (UX U9): the keyboard close parks
			// focus here so the chord keeps its owner when the closing tab button
			// unmounts. `outline-none!` because Chromium counts a scripted `.focus()`
			// after keyboard input as focus-visible, which drew the app's 2px ring
			// around the whole pane with nothing actionable inside it. `!` because the
			// ring is the unlayered `html :focus-visible` rule, which outranks utilities
			// (docs/branding.md section 8); docs/branding.md / index.css allow
			// `outline-none` exactly when "focus is moved there programmatically and a
			// ring would be noise". Every focusable CHILD keeps its own ring.
			tabIndex={-1}
			/*
			 * THE ROUTE HOST IS A FULL-HEIGHT PANEL and the pane host is not. On the
			 * route the pane's ground reaches y0 (`panel-flush` cancels the shell's
			 * ordinary-content pad). Its chrome child owns the titlebar clearance so
			 * the reserved lane, tab track and permanent address row share one paint
			 * owner instead of exposing the pane ground above the tab track. In the
			 * slot the enclosing `browser-pane.tsx` column already pads from y0, so
			 * `h-full` is right and a second pad here would double it. Both hosts stay
			 * `relative` so the surface's own absolutes never escape to an unrelated
			 * ancestor.
			 */
			className={
				isRoutePage
					? "panel-flush relative flex min-h-0 flex-1 flex-col bg-elevated outline-none!"
					: "relative flex h-full min-h-0 flex-col bg-elevated outline-none!"
			}
			/* The pane ground of the Browser ROUTE (inside the pane slot the enclosing
			   `pane` region already owns the alpha and this one is cleared as nested).
			   `data-glass-split` only on the route host: nothing may paint beneath the
			   page, or its alpha would be the stack of the backing and the pane. */
			data-glass-region="pane"
			data-glass-split={isRoutePage ? "" : undefined}
			data-glass-chrome-live={isRoutePage && glassLivePage ? "" : undefined}
			data-tour-tag={surfaceTag}
		>
			{/* ROUTE CHROME IS ONE OWNER: S5's permanent address row belongs in the
			    same band as the strip, and the titlebar clearance must paint on that
			    band rather than on the elevated pane. In a pane the enclosing column
			    already owns the pad and alpha, so this wrapper adds neither. */}
			<div
				className={isRoutePage ? "panel-top-pad bg-sunken" : undefined}
				data-glass-region={isRoutePage ? "chrome" : undefined}
				data-browser-route-chrome={isRoutePage ? "" : undefined}
			>
				{/* THE STRIP CONSUMES THESE TWO HANDS, so they are passed through rather than
			    `void`-ed: a close's own outcome is what bounds its caret restore (review
			    round 2, A-2), and discarding it here would leave the one caller that needs
			    the answer with nothing to read. Every other chrome call stays fired-and-
			    forgotten, which is what `void` says. */}
				<div className="relative">
					<BrowserTabStrip
						tabPanelId={tabPanelId}
						tabs={tabs}
						sessions={sessions}
						activeTabId={state?.activeTabId ?? null}
						waiting={queue.waiting}
						onActivate={(tabId) => void chrome.activateTab(tabId)}
						onClose={closeTab}
						onCloseTabs={(intent) => chrome.closeTabs(intent)}
						onNewTab={() => void chrome.newTab(hostSessionId)}
						onReorder={(ids) => chrome.reorderTabs(ids)}
						onTabAction={(id, action) => {
							void chrome.actOnTab(id, action).then((outcome) => {
								// A failed navigation still retains an active plain-user copy. Reveal
								// an actual destination, never a refusal that created none; do not
								// copy conversation association just to make the failure inspectable.
								if (
									outcome?.tabId != null &&
									action === "duplicate" &&
									tabScope !== "all"
								)
									onShowAllTabs?.();
							});
						}}
						newTabLabel={newTabLabel}
						onHandOver={(tab) => setHandOverTab(tab)}
						onRevokeHandOver={(tabId) => void chrome.revokeHandOver(tabId)}
						onShowTabActionsMenu={chrome.showTabActionsMenu}
					/>
				</div>
				{/* THE PERMANENT ADDRESS ROW (S5, LOH-13). One 37px in-flow band
			    between the strip and the page: Back, Forward, Reload/Stop, Home, the
			    field with its site mark, the fixed 28px Approvals control and the
			    overflow menu. `rowRef` is the anchor the native suggestion child hangs
			    from and the width that decides which controls fold; it replaces
			    `stripRef` because the row is what the list is attached to now. */}
				<BrowserUrlBar
					rootRef={rowRef}
					inputRef={addressRef}
					tabId={state?.activeTabId ?? null}
					url={state?.url ?? ""}
					pendingUrl={chrome.pendingUrl}
					loading={Boolean(state?.loading)}
					canGoBack={Boolean(state?.canGoBack)}
					canGoForward={Boolean(state?.canGoForward)}
					disabled={tabs.length === 0}
					hideForward={rowWidth > 0 && rowWidth < 300}
					hideHome={rowWidth > 0 && rowWidth < 360}
					startPage={onStartPage}
					placeholder={
						onStartPage
							? t("ui.browser.browser_new_tab.address_placeholder")
							: undefined
					}
					suggestionsUnavailable={browserOwnState}
					narrow={rowWidth > 0 && rowWidth < 360}
					onNavigate={(url, expectedTabId) =>
						void chrome.navigate(url, expectedTabId)
					}
					onBack={() => void chrome.history("back")}
					onForward={() => void chrome.history("forward")}
					onReload={() => void chrome.reload()}
					onStop={() => void chrome.stop()}
					onHome={() => void chrome.home()}
					loadFailure={state?.navFailure ?? null}
					overlayMode={overlayMode}
					anchor={anchor}
					focusRequest={focusRequest}
					onDismiss={returnBrowserFocus}
					onCommitted={returnBrowserFocus}
					menu={
						<>
							{/* APPROVALS IS A FIXED 28px ROW CONTROL (S5 ruling 1 and 7):
						    mounted with its space reserved, because a control that appears
						    and disappears would reflow the field every time an agent asked
						    for a site. Below a 300px row it FOLDS into ⋯ (round-1 D5): the
						    field would otherwise fall under its text floor, and the menu
						    item already carries the count. At this width that item is the
						    ONLY route into a dock whose 25px column is unreadable; that is
						    deferred to S6 (D11/U17), not fixed by widening here. Its ring
						    rides the ROW ground,
						    not `canvas`, or the halo reads as a lighter box against the
						    strip it overhangs (D6). */}
							{!(rowWidth > 0 && rowWidth < 300) && (
								<span className="relative flex shrink-0 items-center">
									<Tooltip
										side="top"
										align="end"
										content={t("ui.browser.chrome.approvals")}
									>
										<Button
											ref={approvalsTriggerRef}
											variant={
												queue.count > 0 || approvalsOpen ? "outline" : "ghost"
											}
											size="icon-sm"
											className={approvalsOpen ? "bg-row-selected" : undefined}
											onClick={() => {
												/*
												 * S6b: when the host built the native card, the shield
												 * opens THAT surface (focused) instead of the DOM dock;
												 * the dock is the fallback for a launch without it.
												 * The locale/direction are resolved in the renderer
												 * because main has no catalogue (UX U2).
												 */
												if (nativeApprovalsCard?.available) {
													if (nativeApprovalsCard.open) {
														void window.api?.browser.closeApprovalsCard();
													} else {
														const locale = currentLocale();
														void window.api?.browser.openApprovalsCard({
															locale,
															dir: resolveLanguage(locale).dir,
														});
													}
													return;
												}
												setDockOpen((open) => !open);
											}}
											aria-expanded={approvalsOpen}
											aria-label={
												queue.count > 0
													? t("ui.browser.browser_url_bar.approvals_waiting", {
															count: queue.count,
														})
													: t("ui.browser.chrome.approvals")
											}
											data-tour-tag="browser-approvals"
										>
											<ShieldCheck aria-hidden className="size-3.5" />
										</Button>
									</Tooltip>
									{queue.count > 0 && (
										<span className="pointer-events-none absolute -top-0.5 -right-0.5">
											{/* 2px per side: half the 4px gap above the control, so the
										    badge's 2px ring stays inside the row (D6b). */}
											<Badge
												variant="attention"
												shape="pill"
												size="count"
												className="ring-2 ring-elevated"
												aria-hidden="true"
												data-tour-tag="browser-approvals-badge"
											>
												{countLabel(queue.count, 99)}
											</Badge>
										</span>
									)}
								</span>
							)}
							<BrowserPageMenu
								disabled={tabs.length === 0}
								canGoForward={Boolean(state?.canGoForward)}
								pageZoom={state?.pageControls?.zoom ?? 1}
								waitingCount={queue.count}
								downloadsDir={chrome.state?.transfers?.dir ?? null}
								showForward={rowWidth > 0 && rowWidth < 300}
								showHome={rowWidth > 0 && rowWidth < 360}
								onForward={() => void chrome.history("forward")}
								onHome={() => void chrome.home()}
								onFind={() => void openFind("chrome")}
								onPrint={() => {
									if (state?.activeTabId != null)
										void chrome.pageControl(state.activeTabId, "print");
								}}
								onResetZoom={() => {
									if (state?.activeTabId != null)
										void chrome.pageControl(state.activeTabId, "reset");
								}}
								onOpenDownloads={() => void chrome.revealDownloads()}
								onOpenApprovals={() => {
									const opening = !dockOpen;
									setDockOpen(opening);
									return opening;
								}}
								onDockOpened={() => setDockFocusRequest((n) => n + 1)}
								triggerRef={pageMenuTriggerRef}
								showApprovalsFolded={rowWidth > 0 && rowWidth < 300}
								canControlPage={!browserOwnState && activeTab !== null}
							/>
						</>
					}
					// Suggestions are one list for the field: persistent history is
					// session-agnostic, so there is no display scope to pass.
					addressHistory={(request) => chrome.addressHistory(request)}
					onStateChanged={chrome.onStateChanged}
				/>
			</div>
			<BrowserFindRow chrome={chrome} returnToPage={findReturnToPage} />
			{state?.pageControls?.notice && (
				<output
					aria-live="polite"
					className="shrink-0 border-control border-b bg-elevated px-2 py-1 text-body-sm text-ink-muted"
				>
					{state.pageControls.notice}
				</output>
			)}
			{/* The transfer row sits in the SAME strip as the consent band, and ABOVE
			    the band deliberately: a refusal is the case a human has
			    to see, and the band's own visibility is driven by a pending approval, which
			    a transfer usually does not have. Rendering it as the band's child would
			    make the row invisible in exactly the common case (§16.4). It is scoped to
			    the ACTIVE tab by the host (review round 1, D2), so the strip can no longer
			    narrate a decision taken in another one. */}
			<BrowserFileTransferRow
				transfers={chrome.state?.transfers}
				onReveal={() => void chrome.revealDownloads()}
				// The tab list lives here, so the WORDS for a decision taken elsewhere do too
				// (review round 1, D2). An agent's tab is created inactive, so the row keeps
				// showing the decision and names whose it is rather than dropping it.
				tabLabel={(tabId, ownerKind) => {
					// THE TAB LIST FIRST, THE NOTE'S OWN RECORD SECOND (review round 2, U10): a tab
					// that has been CLOSED has no record here, and "· on another tab" about a tab
					// that no longer exists is a marker pointing at nothing — the one thing a
					// marker whose whole job is honesty about whose action this was must not be.
					// The kind the host recorded with the decision is still true of a closed tab,
					// so it is what the label falls back to; `null` (the host could not say) keeps
					// the old wording rather than inventing a kind.
					const owner =
						state?.tabs.find((tab) => tab.tabId === tabId)?.owner ?? ownerKind;
					return owner === "agent"
						? t("ui.browser.browser_surface.on_the_agent_s_tab")
						: t("ui.browser.browser_surface.on_another_tab");
				}}
			/>
			{/* The band renders while there is anything to say: a live request, or a
			    resolved row the user is still reading (spec 3.4's bounded memory). One
			    pending request and no resolved rows is the common case and the tray then
			    renders the card alone, which is the band the user already knows. */}
			{!nativeApprovalsCard?.available &&
				(queue.rows.length > 0 || queue.resolved.length > 0) && (
					// `aria-live` because this band appears without the user's action: the
					// agent navigated, and the prompt must be announced rather than merely
					// painted (design 9.2's whole reason for the bar).
					<div aria-live="polite">
						<BrowserConsentBar
							rows={queue.rows}
							resolved={queue.resolved}
							selectedEntryId={selectedRow?.request.entryId ?? null}
							onSelect={setSelectedEntryId}
							busy={busy}
							onDecide={decide}
							dockOpen={dockOpen}
							onToggleDock={() => setDockOpen((open) => !open)}
							headerLabel={approvalHeaderLabel}
						/>
					</div>
				)}
			{chrome.error && (
				<output
					className="flex items-center gap-2 border-control border-b bg-danger-wash px-3 py-1.5"
					data-tour-tag="browser-error"
				>
					<p className="min-w-0 grow text-body-sm text-ink">{chrome.error}</p>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={t("ui.browser.browser_surface.dismiss")}
						// An explicit dismissal, rather than a `refresh()` that happened to
						// succeed: a refusal is the user's to clear once they have read it,
						// and re-reading the projection must not be able to erase it (R6).
						onClick={() => chrome.dismissError()}
					>
						<X aria-hidden className="size-3.5" />
					</Button>
				</output>
			)}

			{/* The content row: the page area and the dock are FLEX SIBLINGS, so the
			    content element — and the rectangle reported from it — narrows when the
			    dock opens. That is the design's whole point (`spec 2`): a native view
			    cannot be CSS-scaled or overlaid, so the dock is in flow, and the
			    `ResizeObserver` above re-reports on the same frame. */}
			<div className="flex min-h-0 grow" ref={attachDockRow}>
				{/* The content rect. The native view paints ABOVE this element, so
				    everything below is visible only while the view is hidden — which is
				    exactly why the treatment is a page title and one line rather than a
				    full screen: it is what the user sees in the gap, and looking like a
				    deliberate paused state is the difference between "a dialog is open"
				    and "the browser broke" (design 11.3). */}
				<div
					ref={contentRef}
					// `min-w-0` because the content element is now a flex SIBLING of the dock: a
					// flex item's default `min-width: auto` refuses to shrink below its content, so
					// the dock would push the column wider instead of narrowing it and the
					// reported rect would never change (spec §4.2). The 240px floor the design
					// also names is a PANE-layout decision, not this class's: in a pane narrower
					// than ~520px the dock takes the whole width and the page is given none
					// (spec §4.4), which is PR 2's layout to choose.
					/* The viewport host: the native page view paints over it, so its own
					   ground is cleared and the pane above owns the alpha. */
					data-glass-region="pane-leaf"
					className={cn(
						"relative min-h-0 min-w-0 grow bg-elevated",
						// At full width the content is displaced to zero: clip its own
						// states so a centered empty/failure message cannot paint over the
						// panel that displaced it. The panel is in flow, not on top.
						dockFullWidth && "overflow-hidden",
					)}
					data-tour-tag="browser-content"
					id={tabPanelId}
					role="tabpanel"
					aria-labelledby={
						tabs.some((tab) => tab.tabId === state?.activeTabId)
							? `${tabPanelId}-tab-${state?.activeTabId}`
							: undefined
					}
					aria-label={
						tabs.some((tab) => tab.tabId === state?.activeTabId)
							? undefined
							: newTabLabel
					}
					/* The suppression reason on the element that is always here, so a run — or a
					   support session — reads WHY the page is hidden rather than inferring it
					   from whatever happens to be on screen. The paused note carries the same
					   attribute; the failure panel is a different element, and a reason that is
					   only readable in one of the two states is the state that gets misread. */
					data-suppressed-by={suppressedBy}
				>
					{!state && (
						<div className="flex h-full items-center justify-center">
							<Spinner
								size="lg"
								label={t("ui.browser.browser_surface.loading_browser")}
							/>
						</div>
					)}
					{state && tabs.length === 0 && (
						// ONE ACTION, ONE LABEL (design round 3, D19), and the label now names WHERE the
						// tab will land (design R1): the strip's own `+` carries the same
						// `aria-label`, so the word the user is told to look for is the word they find
						// in both branches — and in a conversation it says the tab is this
						// conversation's, which is the one thing about the action they cannot see.
						// The EMPHASIS differs between this branch and the next - primary when there
						// is nothing else to do, outline when the real next move is to pick a tab
						// above - and that is deliberate rather than an inconsistency to iron out.
						//
						// TWO ACTIONS IN THE SCOPED BRANCH, and they are two DIFFERENT actions rather
						// than the same one twice (spec 7.2): `Show all tabs` widens the LIST and
						// `New tab` opens a page. The first is the primary one here, because the
						// state this copy exists for is the half-truth case - three tabs are open
						// and none of them is this conversation's - and the honest next move there
						// is to look at what IS open, not to open a fourth. It is rendered only when
						// the host actually HAS a wider scope to offer, so the route's own empty
						// state keeps its single action.
						<div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center @max-[330px]/bpane:px-4">
							<Globe aria-hidden className="size-6 text-ink-dim" />
							{tabScope === "all" ? (
								<p className="text-body text-ink-muted">
									{t("ui.browser.browser_surface.no_tabs_are_open")}
								</p>
							) : (
								<p className="text-body text-ink-muted">
									{t(
										"ui.browser.browser_surface.no_browser_tabs_in_this_conversation_yet",
									)}
								</p>
							)}
							{/* `flex-wrap justify-center`: the two buttons are ~282px side by
							    side and a pane can be 220px (the 800px window, with the panel
							    rail taking its 44px), where the row clipped both edges
							    ("Show all tabs" and "New tab in this conversation" cut,
							    scrollWidth 251 vs clientWidth 220 - design round 2, D13).
							    Wrapping stacks them only when they do not fit. The side
							    padding drops from 24 to 16px at the same 330px threshold as the
							    bar's title shed (`bpane` container, so a route host without the
							    pane's container is untouched): the 900px window's 320px pane has a
							    288px content box at 16px, which fits the 282px pair, where 24px
							    (272px) would have stacked a layout that drew side by side before. */}
							<div className="flex flex-wrap items-center justify-center gap-2">
								{tabScope !== "all" && onShowAllTabs && (
									<Button
										variant="primary"
										size="sm"
										onClick={onShowAllTabs}
										data-tour-tag="browser-scope-show-all"
									>
										{t("ui.browser.browser_surface.show_all_tabs")}
									</Button>
								)}
								<Button
									variant={tabScope === "all" ? "primary" : "outline"}
									size="sm"
									onClick={() => void chrome.newTab(hostSessionId)}
									/* Named for the driver: this is the empty host's ONLY way to
									   open a tab, so it is the control a run has to press to prove
									   that a tab opened in a conversation is ATTRIBUTED to it (R1).
									   A tour tag rather than a class, like every other drivable
									   control here. */
									data-tour-tag="browser-surface-new-tab"
								>
									{newTabLabel}
								</Button>
							</div>
						</div>
					)}
					{state && tabs.length > 0 && !activeTab && (
						// A tab can be closed while another is left (the agent's, typically) and the
						// registry then has no active tab at all: without this the page area is
						// blank with nothing saying why, and the only way out — pressing a tab in
						// the strip — is something nothing suggests (review round 2, U4).
						<div className="flex h-full flex-col items-center justify-center gap-3">
							<Globe aria-hidden className="size-6 text-ink-dim" />
							<p className="text-body text-ink-muted">
								{t("ui.browser.browser_surface.no_tab_is_selected_pick_a_tab")}
							</p>
							<Button
								variant="outline"
								size="sm"
								onClick={() => void chrome.newTab(hostSessionId)}
							>
								{newTabLabel}
							</Button>
						</div>
					)}
					{suppressed && overlaySuppressing && state && tabs.length > 0 && (
						<output
							className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center"
							data-tour-tag="browser-paused"
							data-suppressed-by={suppressedBy}
						>
							<p className="max-w-lg truncate text-title text-ink">
								{state.title ||
									activeTab?.title ||
									t("ui.browser.browser_surface.this_page")}
							</p>
							<p className="text-body-sm text-ink-muted">
								{t(
									"ui.browser.browser_surface.paused_while_a_dialog_menu_or_panel",
								)}
							</p>
						</output>
					)}
					{showingNewTab && (
						/*
						 * KEYED BY TAB (F3, round 3). The field's draft is mount-local state, so a
						 * tab switch that kept this component mounted would carry the previous
						 * tab's typed text into the new tab's field — the same cross-tab leak the
						 * hook's note keying closes one layer up, and it has to be closed here too
						 * because this is where the text actually lives. A key change remounts the
						 * component, so each tab gets its own field seeded from its own
						 * `refusedUrl` (which is itself already filtered to the active tab).
						 */
						<BrowserNewTab key={activeTab?.tabId ?? "none"} />
					)}
					{showingFailure && navFailure && (
						<BrowserLoadFailure
							failure={navFailure}
							onRetry={() => void chrome.reload()}
						/>
					)}
				</div>
				<BrowserApprovalsDock
					open={nativeApprovalsCard?.available ? false : dockOpen}
					fullWidth={dockFullWidth}
					focusRequest={dockFocusRequest}
					rows={queue.rows}
					resolved={queue.resolved}
					selectedEntryId={pendingSelected?.entryId ?? null}
					onSelect={setSelectedEntryId}
					busy={busy}
					onDecide={decide}
					approvals={state?.approvals ?? []}
					currentOrigin={currentOrigin}
					onRevoke={(origin) =>
						void runBusy(() => chrome.revokeApproval(origin))
					}
					onRevokeAll={() => void runBusy(() => chrome.revokeAllApprovals())}
					onForgetSite={(origin) =>
						void runBusy(() => chrome.forgetSite(origin))
					}
					onClearData={(what) => void runBusy(() => chrome.clearData(what))}
					onClose={closeDock}
					surfaceTag={dockSurfaceTag}
				/>
			</div>
			<BrowserHandOverDialog
				open={handOverTab !== null}
				tab={handOverTab}
				busy={busy}
				onClose={() => setHandOverTab(null)}
				onConfirm={(tabId, sessionId) => {
					setHandOverTab(null);
					void runBusy(() => chrome.handOver(tabId, sessionId));
				}}
			/>
		</div>
	);
};
