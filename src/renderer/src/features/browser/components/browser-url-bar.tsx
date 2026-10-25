import { Spinner } from "@shared/components/common/spinner";
import { Button, Input, Tooltip } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { chordCaption } from "@shared/keymap/keymap-chord";
import { cn } from "@shared/lib/utils";
import { navigationShortcutLabel } from "@shared/navigation-gesture";
import {
	ArrowLeft,
	ArrowRight,
	File,
	Globe,
	Home,
	Lock,
	LockKeyholeOpen,
	RotateCw,
	X,
} from "lucide-react";
import type {
	ChangeEvent,
	CompositionEvent,
	FC,
	FocusEvent,
	KeyboardEvent,
	ReactNode,
	Ref,
	SyntheticEvent,
} from "react";
import {
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type {
	AddressHistoryRequest,
	AddressHistoryResponse,
} from "../../../../../shared/browser-address-history";
import { useAddressAutocomplete } from "../hooks/use-address-autocomplete";
import type { LoadFailureView } from "../hooks/use-browser-chrome";
import {
	type AddressRow,
	type InlineCompletion,
	addressIntent,
	canInlineComplete,
	isGeneratedSuffixSelected,
	moveActive,
	rowTarget,
	searchUrl,
	suggestAddresses,
	usableRawAddress,
} from "../model/address-autocomplete";
import { isSecurityLoadFailure, siteInfoForUrl } from "../model/site-info";
import { useAddressOverlayMirror } from "../overlay/use-address-overlay-mirror";

const FILE_SCHEME = /^file:/i;

/**
 * A press inside a portalled overlay is chrome interacting with chrome, not a
 * press into the page behind the row. The selector is the established one for
 * "this node is not where its trigger lives" (see `ask-drawer` and
 * `use-inline-edit`); the address row's own overflow menu and every tooltip
 * render through it.
 */
function isPortalledChromeTarget(target: Node): boolean {
	const element = target instanceof Element ? target : target.parentElement;
	return (
		element !== null &&
		element.closest("[data-radix-popper-content-wrapper]") !== null
	);
}

/**
 * The browser's address row: ONE placement, permanently in flow between the tab
 * strip and the page (S5, LOH-13).
 *
 * The row is 37px (4px pad + 28px controls + 4px pad + the 1px rule) and holds
 * Back, Forward, Reload/Stop, Home, the address field with its site mark, the
 * fixed 28px Approvals control and the overflow menu. The suggestion rows are
 * NOT here — they are the native child anchored to this row — so this component
 * owns the input, DOM focus, IME, undo, the keys and the accessible combobox,
 * exactly as S3 established.
 *
 * THERE IS NO SECOND PLACEMENT ANY MORE. The S4b popout and its Tier 2 in-flow
 * fallback both existed because the field was only mounted while raised; with a
 * permanent field there is nothing to raise, nothing to fall back to, and one
 * code path instead of two views of the same row.
 *
 * THE DISPLAY RULE: the field shows the tab's LIVE url, never the requested one.
 * THE EDITING RULE: an incoming live url never overwrites a draft.
 */

/**
 * A request from the surface to move focus into the row.
 *
 * The row is always mounted now, so "raise" is not a mount and the old
 * mount-only selection effect has nothing to run on. Cmd+L, a printable seed
 * and the start page's mount all emit a NONCE, and the row applies the request
 * in a layout effect: focus, then either seed the draft (caret at end) or
 * select the live URL. A nonce rather than a boolean so a second Cmd+L while
 * the row already has focus still re-selects.
 */
export interface AddressFocusRequest {
	nonce: number;
	seed?: string;
	selectAll: boolean;
}

/**
 * Why the row gave an edit up without navigating.
 *
 * `escape` (Escape) and `cancel` (Enter on an untouched seed) are the reader
 * leaving the field: the surface requests page focus whenever one is presented,
 * regardless of where the request that raised the field came from, and falls
 * back to the chord root on the start page. The row cannot know whether the tab
 * has a page, so it names the intent and the surface decides.
 */
export type AddressDismissIntent = "escape" | "cancel";

export interface BrowserUrlBarProps {
	/** The row root, for the surface's anchor measurement (the native suggestion
	 * child hangs from this box). Its own element rather than a wrapper so the
	 * "exactly one element between strip and page" predicate is literally true. */
	rootRef?: Ref<HTMLDivElement>;
	inputRef?: Ref<HTMLInputElement>;
	tabId: number | null;
	url: string;
	pendingUrl: string | null;
	loading: boolean;
	canGoBack: boolean;
	canGoForward: boolean;
	disabled: boolean;
	/** Narrow-pane fold tiers (design §8): below 360px Home moves into the
	 * overflow menu, below 300px Forward does too. Back and Reload/Stop never
	 * fold — they are the two controls a stuck page needs. */
	hideForward?: boolean;
	hideHome?: boolean;
	onNavigate: (url: string, expectedTabId?: number) => void;
	onBack: () => void;
	onForward: () => void;
	onReload: () => void;
	onStop: () => void;
	onHome?: () => void;
	loadFailure?: LoadFailureView | null;
	/** The popout's ⋯ menu, rendered after the field. */
	menu?: ReactNode;
	/** `popout` mirrors rows into the native child; `suspend` is Tier 1, where
	 * the field works and the list does not. */
	overlayMode: "popout" | "suspend";
	/** The strip's measured band for the projection. */
	anchor: { x: number; width: number } | null;
	/** A focus/seed request from the surface; see `AddressFocusRequest`. */
	focusRequest?: AddressFocusRequest | null;
	/** The active tab is the start page: Reload and Home act on nothing there, so
	 * they are disabled rather than offering a press with no visible effect. */
	startPage?: boolean;
	/** The field's placeholder when empty (the start page's `example.com`). */
	placeholder?: string;
	/** The row is too narrow for the hint sentence to sit beside typed text: keep
	 * it as the field's description only (round 3, U18). */
	narrow?: boolean;
	/** The view is hidden for a browser-owned state (start page, load failure), so
	 * main refuses suggestion projections. The field says so once the user types,
	 * rather than leaving a silent dead list. */
	suggestionsUnavailable?: boolean;
	/** Escape or Enter on an untouched draft: abandon the draft and hand focus
	 * back. The intent is escape or cancel; the surface requests page focus for
	 * both whenever a page is presented, and falls back to the chord root on the
	 * start page / own state. */
	onDismiss?: (intent: AddressDismissIntent) => void;
	/** A commit happened: return focus per the surface's origin rule. */
	onCommitted?: () => void;
	addressHistory?: (
		request: AddressHistoryRequest,
	) => Promise<AddressHistoryResponse>;
	onStateChanged?: (listener: () => void) => () => void;
}

/** Top-level because a function-scope regex literal is rebuilt on every call;
 * Biome's performance rule is about exactly that. */
const HTTP_SCHEME = /^https?:\/\//;
const TRAILING_SLASH = /\/$/;

/** The display spelling of a URL: the scheme and a bare trailing slash go. */
export function displayUrl(url: string): string {
	if (!url || url === "about:blank") {
		// A blank tab has no address to show; the row's placeholder carries the start
		// page's hint (one field since S5).
		return "";
	}
	return url.replace(HTTP_SCHEME, "").replace(TRAILING_SLASH, "");
}

export const BrowserUrlBar: FC<BrowserUrlBarProps> = ({
	rootRef,
	inputRef,
	tabId,
	url,
	pendingUrl,
	loading,
	canGoBack,
	canGoForward,
	disabled,
	hideForward = false,
	hideHome = false,
	startPage = false,
	onNavigate,
	onBack,
	onForward,
	onReload,
	onStop,
	onHome,
	loadFailure = null,
	menu,
	overlayMode,
	anchor,
	focusRequest = null,
	placeholder,
	narrow = false,
	suggestionsUnavailable = false,
	onDismiss,
	onCommitted,
	addressHistory,
	onStateChanged,
}) => {
	useI18nLocale();
	/**
	 * The row's own box. `rootRef` is the surface's anchor handle and the same
	 * node; keeping an internal ref means the outside-press rule still knows where
	 * the row is when the component renders without one (stories, the DOM tests).
	 */
	const rowEl = useRef<HTMLDivElement | null>(null);
	/** Stable across renders: a callback ref with a new identity detaches and
	 * re-attaches on every render, which also re-runs the surface's anchor
	 * measurement. */
	const setRowEl = useCallback(
		(node: HTMLDivElement | null): void => {
			rowEl.current = node;
			if (typeof rootRef === "function") rootRef(node);
			else if (rootRef)
				(rootRef as { current: HTMLDivElement | null }).current = node;
		},
		[rootRef],
	);
	/**
	 * A pane narrower than main's list floor cannot host a usable child, so main
	 * refuses the projection and the field is all there is. Without this the
	 * mirror re-projected the same refused frame about sixty times a second and
	 * never told the user why (nit round 1, MINOR-5): the refusal is now a state,
	 * and the field announces the field-only answer. ANY anchor width change
	 * clears it, because that is the one fact that can make the child usable
	 * again.
	 */
	const [narrowAnchor, setNarrowAnchor] = useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the width is the trigger; reading it is the point.
	useEffect(() => {
		setNarrowAnchor(false);
	}, [anchor?.width]);
	const mode: "popout" | "suspend" =
		narrowAnchor || overlayMode !== "popout" ? "suspend" : "popout";
	const [typed, setTyped] = useState<{
		tabId: number | null;
		text: string;
	} | null>(null);
	/** Whether the current draft came from the user at all. Focus seeds the
	 * field with the live URL; that seed is not a query (UX U1), and only a
	 * `change`/composition/undo can make it one. */
	const [edited, setEdited] = useState(false);
	const draft = typed && typed.tabId === tabId ? typed.text : null;
	const setDraft = (
		next: string | null | ((current: string | null) => string | null),
	): void => {
		const resolved = typeof next === "function" ? next(draft) : next;
		setTyped(resolved === null ? null : { tabId, text: resolved });
	};

	/*
	 * Address suggestions are a snapshot for THIS focused edit. `addressHistory`
	 * is absent outside Electron (a story, a static render), and the field then
	 * behaves exactly as it did before this feature: no list, no dead control.
	 */
	/**
	 * The list exists only where there is something that can paint it.
	 *
	 * `suspend` is the Tier 1 child-unavailable state (the field works, the list
	 * does not; Windows and Linux stay here). It must not fetch history it has no
	 * surface for, because a query with no presenter is work whose result nobody
	 * sees.
	 */
	const suggestionsEnabled = mode === "popout" && addressHistory !== undefined;
	const inputEl = useRef<HTMLInputElement | null>(null);

	/**
	 * False once THIS popout/bar is unmounting. React removes the focused input
	 * during an unmount, which fires a blur; running the blur handler then would
	 * schedule state on a component that no longer exists (and leaves an `act()`
	 * waiting for a render that can never happen). The popout closing is the
	 * surface's decision, not a blur event's.
	 */
	const activeRef = useRef(true);
	useLayoutEffect(() => {
		activeRef.current = true;
		return () => {
			activeRef.current = false;
		};
	}, []);
	const setInputEl = (node: HTMLInputElement | null): void => {
		inputEl.current = node;
		if (typeof inputRef === "function") inputRef(node);
		else if (inputRef)
			(inputRef as { current: HTMLInputElement | null }).current = node;
	};
	const [completion, setCompletion] = useState<InlineCompletion | null>(null);
	const completionRef = useRef<InlineCompletion | null>(null);
	completionRef.current = completion;
	const [activeIndex, setActiveIndex] = useState(-1);
	/** The row the user explicitly arrowed to, and the query it belonged to.
	 * A late answer for the SAME query keeps that row selected when it is still
	 * present; a new query (or a vanished row) falls back to the default. */
	const explicitSelection = useRef<{ query: string; key: string } | null>(null);
	/** The destination an accepted suffix came from. The field's text after
	 * acceptance is the display spelling (no scheme), which is not enough to
	 * navigate: Enter must use the canonical HTTP(S) target the suggestion was
	 * built from, or a typed `127.0.0.1:8080` gets HTTPS-upgraded and fails. */
	const [acceptedTarget, setAcceptedTarget] = useState<{
		tabId: number | null;
		raw: string;
		targetUrl: string;
	} | null>(null);
	const [dismissedForText, setDismissedForText] = useState<string | null>(null);
	const [composing, setComposing] = useState(false);
	const composingRef = useRef(false);
	const [caretRequest, setCaretRequest] = useState(0);
	const [announcement, setAnnouncement] = useState("");
	const listId = useId();
	const listLabelId = `${listId}-label`;
	const noticeId = `${listId}-notice`;
	const siteDescId = `${listId}-site`;
	const unavailableId = `${listId}-unavailable`;
	const optionId = (index: number): string => `${listId}-option-${index}`;
	/** User edits only. Accepting a generated suffix is deliberately NOT an edit
	 * here: undo must return the text the user typed, not the model's proposal. */
	const undoRef = useRef<{ stack: string[]; redo: string[] }>({
		stack: [],
		redo: [],
	});
	const wasListOpen = useRef(false);
	/*
	 * The chord captions (issue #675's round-1 review, U5): the product caps
	 * every other chord on the control that owns it (`sidebarToggleCap`,
	 * `paletteDoorLabel`), and these two buttons are the nearest affordances
	 * the gesture has. `aria-keyshortcuts` is the machine-readable half; the
	 * tooltip is the visible one. The `aria-label`s stay the action alone —
	 * `scripts/run-panel-navigation.test.mjs` selects them by exact string.
	 */
	const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
	// Glyph AND `aria-keyshortcuts` from the same chord id (design D-PR5).
	const reload = chordCaption("primary+r", isMac ? "mac" : "linux");
	const address = chordCaption("primary+l", isMac ? "mac" : "linux");
	const backChord = navigationShortcutLabel("back", isMac);
	const forwardChord = navigationShortcutLabel("forward", isMac);
	/**
	 * Where the user asked to go, held only while the tab has not committed it.
	 *
	 * NOT the field's value — the design is explicit that the bar shows the tab's
	 * LIVE url, "never from what was requested" (6.1), and it is the LIVE url that
	 * makes a redirect or a login wall visible rather than hidden behind the intent.
	 * But an uncommitted navigation leaves the tab on `about:blank`, so a strict
	 * live-only field goes BLANK for as long as a slow page takes to respond —
	 * measured in `scripts/browser-chrome-proof.mjs`, which is how this was found.
	 * A placeholder is not a value: it says "this is what you asked for, and the tab
	 * is not there yet", which is the honest form of the same information.
	 */
	// SITE-INFO (LOH-13, gap 1): classified from the tab's LIVE url — the same
	// value the field displays — and never from a requested URL, so a redirect
	// re-reads here the moment the projection does. Read-only: it is not a
	// button and nothing in the consent gate reads it.
	const siteInfo = siteInfoForUrl(url, loadFailure);
	// The unverified wording splits on WHY (see isSecurityLoadFailure): a
	// certificate failure is an identity claim that failed, any other recorded
	// failure is a load that never completed - both revoke "secure", and the
	// tooltip must not dress the second up as the first.
	const siteInfoLabel =
		siteInfo.kind === "secure"
			? t("ui.browser.browser_url_bar.site_secure", {
					origin: siteInfo.origin,
				})
			: siteInfo.kind === "not-secure"
				? t("ui.browser.browser_url_bar.site_not_secure", {
						origin: siteInfo.origin,
					})
				: siteInfo.kind === "unverified"
					? loadFailure && isSecurityLoadFailure(loadFailure)
						? t("ui.browser.browser_url_bar.site_unverified_certificate", {
								origin: siteInfo.origin,
							})
						: t("ui.browser.browser_url_bar.site_unverified", {
								origin: siteInfo.origin,
							})
					: siteInfo.kind === "file"
						? t("ui.browser.browser_url_bar.site_file")
						: t("ui.browser.browser_url_bar.site_internal");
	const SiteInfoIcon =
		siteInfo.kind === "secure"
			? Lock
			: siteInfo.kind === "not-secure" || siteInfo.kind === "unverified"
				? LockKeyholeOpen
				: siteInfo.kind === "file"
					? File
					: Globe;
	// Warning emphasis is a colour STEP, not a second colour (D1, brief
	// section 2.3): the two kinds that must read as a warning sit at text-ink
	// (12.8:1 dark / 15.23:1 light on surface) while the resting kinds stay
	// at text-ink-muted, so emphasis comes from the step rather than a hue
	// this register does not otherwise use.
	const siteInfoWarns =
		siteInfo.kind === "not-secure" || siteInfo.kind === "unverified";
	const live = displayUrl(url);
	// `draft === null` means "not editing". Kept as null rather than as a boolean
	// plus a string so there is no state where the flag says editing and the value
	// is stale — and so a live URL that changes while the field is pristine needs no
	// effect to be picked up: the live value IS the value.
	//
	// THE RAW/COMPLETION SPLIT is what keeps a generated suffix from ever being
	// mistaken for typed text: the draft is user-authored, the completion is a
	// separate overlay the field renders into the real input and selects. Every
	// commit path reads `targetUrl` from the completion, never the displayed value.
	const raw = draft ?? live;
	/*
	 * AN UNTOUCHED DRAFT IS NOT A QUERY (UX U1). The popout mounts with the live
	 * URL as its draft and fully selected. That text is the page's address, not
	 * something the user typed into the suggestion field: treating it as a query
	 * put `Search DuckDuckGo for "intranet/wiki"` first and selected, so Cmd+L
	 * then Enter sent an internal hostname to a third party. The empty query is
	 * the top-history list; Enter on this state dismisses, and only text the
	 * user edited can become a search.
	 */
	const untouchedDraft = draft !== null && !edited;
	// Only user-authored text is a query. A Cmd+L field seeded with the live URL
	// has not been typed into, and a printable-character seed HAS (that is how
	// the popout opened).
	const query = edited ? raw : "";
	// The hook needs `query`, and it must stay above every conditional return:
	// the order of hooks is the component's identity.
	const autocomplete = useAddressAutocomplete({
		tabId,
		query,
		requestHistory:
			addressHistory ??
			(() =>
				Promise.reject(
					new Error(t("ui.browser.errors.address_history_unavailable")),
				)),
		subscribe: onStateChanged ?? (() => () => {}),
		enabled: suggestionsEnabled,
	});
	const currentCompletion =
		completion && completion.raw === raw ? completion : null;
	const value = currentCompletion ? currentCompletion.text : raw;
	const editing = draft !== null;
	/** The unavailable-suggestions sentence, shown wherever the list cannot be. */
	const hintShown =
		(mode === "suspend" && !editing) ||
		(suggestionsUnavailable && editing && raw.length > 0);
	/*
	 * THE ONE LIVE PATH FOR THE SENTENCE (round-4 Q4-2). The hint itself is a
	 * description, not a live region: a region that also carried text on mount
	 * would speak twice in suspend, where `announcement` already exists and was
	 * measured saying "1 suggestion available" while the field was actually
	 * unavailable. Route the sentence through that existing polite region, which
	 * announces the transition once and is silent otherwise.
	 */
	useEffect(() => {
		if (!hintShown) return;
		setAnnouncement(
			t("ui.browser.browser_url_bar.address_suggestions_unavailable"),
		);
	}, [hintShown]);
	const hintPainted = hintShown && !narrow;
	const suggestions = useMemo(
		() =>
			suggestAddresses(autocomplete.entries, query, {
				inlineShown: currentCompletion !== null,
			}),
		[autocomplete.entries, query, currentCompletion],
	);
	/** The header must be true for the rows it sits over: a search row or an
	 * open-tab row under "From your history" is a false claim (design D1), so the
	 * mixed list gets its own sentence. Empty uses the mixed/neutral sentence. */
	const listLabel = t(
		suggestions.rows.length > 0 &&
			suggestions.rows.every(
				(row) => row.kind === "candidate" && row.candidate.source === "history",
			)
			? "ui.browser.browser_url_bar.address_suggestions_label"
			: "ui.browser.browser_url_bar.address_suggestions_label_mixed",
	);
	/**
	 * Row copy. The model owns no user-facing strings, and a live-tab row is
	 * marked in its TITLE line rather than by a section heading: the native
	 * overlay's row protocol is uniform height and S4b owns it, so a heading row
	 * would be a selectable row the child cannot paint in its own model.
	 */
	const rowText = (row: AddressRow): string =>
		row.kind === "search"
			? t("ui.browser.browser_url_bar.address_search_row", {
					query: row.query,
				})
			: row.candidate.displayText;
	const rowSubtitle = (row: AddressRow): string => {
		if (row.kind === "search") return "";
		if (row.candidate.source !== "tab") return row.candidate.title;
		return row.candidate.title.length > 0
			? t("ui.browser.browser_url_bar.address_suggestion_open_tab", {
					title: row.candidate.title,
				})
			: t("ui.browser.browser_url_bar.address_suggestion_open_tab_untitled");
	};
	const rowKey = (row: AddressRow): string =>
		row.kind === "search" ? `search:${row.targetUrl}` : row.candidate.url;
	/** The option spoken by assistive tech. A tab row appends its source mark:
	 * the native child is `aria-hidden`, so without this the open-tab/history
	 * distinction would be sighted-only (design D6). */
	const rowAccessibleText = (row: AddressRow): string => {
		const text = rowText(row);
		if (row.kind !== "candidate" || row.candidate.source !== "tab") return text;
		const source = rowSubtitle(row);
		return source.length > 0 ? `${text} — ${source}` : text;
	};
	/**
	 * A REFUSED INPUT IS ITS OWN FACT, and it is announced whatever the history
	 * read is doing: it explains what Enter will not do, not what the list holds.
	 */
	const refusedInput =
		suggestions.intent === "blocked" ||
		// The FILE_SCHEME arm must read the USER's text, not the focus seed: a
		// `file:` live URL is a page you are on, not an address typed into the
		// field, and announcing the refusal on focus alone was false (R1-2).
		(edited && FILE_SCHEME.test(raw.trim()));
	// A dismissal suppresses the list until the text changes. Without this, the
	// first Escape restored the raw text but left the rows on screen — the copy
	// promised a dismissal the layout did not perform.
	const suppressed = dismissedForText !== null && dismissedForText === raw;
	/*
	 * THE EMPTY STATE IS NOT A PANEL (operator decision, 2026-10-24).
	 *
	 * Focus used to raise the native suggestion child and paint "No browsing
	 * history yet." over the page for a field with nothing to suggest — one press
	 * into permanent chrome and the page was covered by a list nobody asked for,
	 * whose only exit was a dismissal that had to be invented. A focused field
	 * with an empty history now shows nothing: no child, no notice, no
	 * `aria-expanded`.
	 *
	 * The notice survives where it explains something: a NON-EMPTY query with no
	 * match, an unavailable read, and a refused input. The old empty-string arm of
	 * `listNotice` is therefore unreachable from this component (the catalogue
	 * entry stays; it is not this change's to delete).
	 */
	const listVisible =
		suggestionsEnabled &&
		editing &&
		!composing &&
		!suppressed &&
		(autocomplete.error ||
			refusedInput ||
			suggestions.rows.length > 0 ||
			(query.length > 0 && !autocomplete.loading));
	const listNotice = autocomplete.error
		? t("ui.browser.browser_url_bar.address_suggestions_unavailable")
		: refusedInput
			? t("ui.browser.browser_url_bar.address_suggestions_blocked")
			: query.length === 0
				? t("ui.browser.browser_url_bar.address_suggestions_empty")
				: t("ui.browser.browser_url_bar.address_suggestions_no_match");

	/**
	 * THE LIST IS INSET TO THE FIELD, NOT THE PANE.
	 *
	 * The alternatives are a sibling of the toolbar and must stay IN FLOW (a
	 * portal or `position: fixed` list paints UNDER the native page view, see
	 * the list's own note below), so without this they take the pane's full
	 * width and their rows are wider than the field they belong to.
	 *
	 * The inset is READ OFF THE ADDRESS FIELD rather than derived from the
	 * controls' widths: what sits around the field changes at runtime (the
	 * downloads folder appears once the host knows one, the zoom reset only
	 * while the page is zoomed, the Approvals control widens with its label),
	 * so any hard-coded pixel budget is wrong the first time one of them
	 * changes. Margins keep the row in the flow, and the observer re-measures
	 * on a pane resize or a control appearing - neither of which re-renders
	 * this component.
	 *
	 * Sub-pixel values are kept: an inset rounded to integers can leave a 1px
	 * gutter on one side at a fractional pane width.
	 *
	 * THE DOCK IS ALWAYS MOUNTED, so this runs on mount and the margins are in
	 * place in the CLOSED state too. Measuring only while open would be enough
	 * for the rows but not for the dock's own box: the closed blank band would
	 * span the pane and then snap to the field's bounds on the first keystroke.
	 */
	/**
	 * WHY THE OPTIONS VIEWPORT IS RESET ON EVERY QUERY CHANGE (review A-1/Q-1):
	 * the 75px viewport is smaller than the list, so a `scrollTop` left over from
	 * the previous query would open the next result set part-way down - top rows
	 * hidden, no active row, and nothing on screen explaining the offset. The
	 * reset is unconditional (a caret moved to the start leaves no active row,
	 * and a background refresh can replace the set without any keystroke), which
	 * is why it does not ride on the active-row scroll effect.
	 */
	/** Record USER-AUTHORED text only. Accepting a suffix is not an edit, so it
	 * never enters this stack: undo must return what the user typed. */
	const recordEdit = (next: string): void => {
		const undo = undoRef.current;
		if (undo.stack.length === 0) undo.stack.push(raw);
		if (undo.stack[undo.stack.length - 1] !== next) {
			undo.stack.push(next);
			undo.redo = [];
		}
	};

	const clearGenerated = (): void => {
		setCompletion(null);
		setActiveIndex(-1);
	};

	/**
	 * Whether this edit was given up without a commit. Read by `compositionEnd`:
	 * the browser can deliver a late `compositionend` after a press/main dismissal
	 * has already blurred the field, and its interim value belongs to a draft the
	 * row no longer owns. Cleared on the next `focus()`, which is what makes the
	 * next edit ordinary again.
	 */
	const editDismissedRef = useRef(false);
	const abandon = (): void => {
		// THE EDIT ENDED, NOT JUST ITS DRAFT. The DOM input otherwise stays
		// `document.activeElement` after focus was handed to the page, and paints
		// the focus outline over a field nobody is editing (design round 1, D1).
		// `abandon()` has already cleared the draft, so the null-`relatedTarget`
		// blur branch below only clears the generated suffix.
		editDismissedRef.current = true;
		setAcceptedTarget(null);
		setDraft(null);
		clearGenerated();
		setDismissedForText(null);
		inputEl.current?.blur();
	};
	/** The listener below must run the LATEST abandonment without re-subscribing
	 * on every render; `abandon` changes identity each time. */
	const abandonRef = useRef(abandon);
	abandonRef.current = abandon;

	/*
	 * A REAL POINTER PRESS OUTSIDE THE ROW ENDS THE EDIT (operator report,
	 * 2026-10-24).
	 *
	 * Neither existing dismissal covers it: a press on non-focusable chrome (a
	 * panel's prose, the workspace ground, the tab strip's empty band) produces no
	 * blur at all, and a blur with a NULL `relatedTarget` is deliberately kept —
	 * that value is also a native page click and a window deactivation. The press
	 * itself is the one signal that names where the user went, so it is read in
	 * the CAPTURE phase (a control that stops propagation is still a press) and
	 * the edit is abandoned exactly as Escape abandons it.
	 *
	 * WHAT IS EXCLUDED, and why: the row's own box (pressing the field, a row
	 * control or the accessible list is not leaving), and portalled chrome — a
	 * Radix menu or tooltip content lives outside the row in the DOM but is part
	 * of it in the interface. No `onDismiss` is called: the press has already
	 * decided where the caret goes, and moving it would steal that decision.
	 *
	 * IT LISTENS WHILE THE FIELD IS EDITING, NOT ONLY WHILE THE LIST IS VISIBLE
	 * (review round 1, R1-1): the list is closed during IME composition and before
	 * the first history answer, and a press in either window used to reach nothing,
	 * so `compositionend` or the late answer re-raised the child after focus had
	 * left. Attaching on `editing` also costs nothing when the list is closed: the
	 * press calls the same abandonment (draft, completion, dismissed state, DOM
	 * focus) and the child is never shown.
	 */
	useEffect(() => {
		if (!editing) return;
		const onPointerDown = (event: PointerEvent): void => {
			const target = event.target;
			if (!(target instanceof Node)) return;
			if (rowEl.current?.contains(target)) return;
			if (isPortalledChromeTarget(target)) return;
			abandonRef.current();
		};
		document.addEventListener("pointerdown", onPointerDown, true);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown, true);
		};
	}, [editing]);

	const commit = (target: string): void => {
		setAcceptedTarget(null);
		// An explicit candidate, an accepted suffix or a typed address. The
		// expected tab is the draft's own, so main refuses a commit that raced a
		// tab switch instead of loading the new tab with the old address.
		onNavigate(target, tabId ?? undefined);
		setDraft(null);
		clearGenerated();
		setDismissedForText(null);
		// A commit ends the edit: drop DOM focus (the surface then returns it per
		// its origin rule) and refuse a late composition commit.
		editDismissedRef.current = true;
		inputEl.current?.blur();
		onCommitted?.();
	};

	/** Right/End accept the generated suffix WITHOUT navigating. */
	const acceptSuffix = (): void => {
		const current = completionRef.current;
		if (!current) return;
		setAcceptedTarget({
			tabId,
			raw: current.text,
			targetUrl: current.targetUrl,
		});
		setDraft(current.text);
		clearGenerated();
		setDismissedForText(null);
		setCaretRequest((count) => count + 1);
	};

	const undoEdit = (): void => {
		setAcceptedTarget(null);
		setEdited(true);
		const undo = undoRef.current;
		if (undo.stack.length <= 1) return;
		undo.redo.push(undo.stack.pop() as string);
		setDraft(undo.stack[undo.stack.length - 1]);
		clearGenerated();
		setDismissedForText(null);
		setCaretRequest((count) => count + 1);
	};

	const redoEdit = (): void => {
		setAcceptedTarget(null);
		setEdited(true);
		const undo = undoRef.current;
		const next = undo.redo.pop();
		if (next === undefined) return;
		undo.stack.push(next);
		setDraft(next);
		clearGenerated();
		setDismissedForText(null);
		setCaretRequest((count) => count + 1);
	};

	/**
	 * S4b's native list mirror.
	 *
	 * The field row is parent DOM and the list is a native child at the strip's
	 * width. This hook sends only display strings and the strip's measured band;
	 * a row click comes back as `{seq,index}` and is re-validated against the
	 * candidates this renderer still has before it reaches `commit()`.
	 */
	useAddressOverlayMirror({
		enabled: suggestionsEnabled,
		tabId,
		visible: listVisible,
		active: activeIndex,
		rows: suggestions.rows.map((row) => ({
			text: rowText(row),
			title: rowSubtitle(row),
			key: rowKey(row),
		})),
		noticeKind: autocomplete.error
			? "error"
			: query.length === 0 && !refusedInput
				? "empty"
				: "no_match",
		noticeText: listNotice,
		label: listLabel,
		anchor,
		onCommit: (index) => {
			// The child sends back only `{seq,index}`; the destination is resolved
			// here, against the SAME row list the child painted, so the visible row
			// and the committed row cannot disagree.
			const target = rowTarget(suggestions, index);
			if (target) commit(target);
		},
		onDismiss: () => {
			// MAIN DECIDED THE LIST COMES DOWN (page focus, page pointer, navigation).
			// Abandoning the edit HERE is what stops the next projection frame from
			// re-raising the child: the mirror is `listVisible`, which is `editing`,
			// and a callback that only returned focus left the field editing.
			// Measured on the baseline: with a `page` origin the focus return is a
			// no-op in an unfocused window, so the draft survived and re-projected.
			//
			// IT IS FOCUS-NEUTRAL, DELIBERATELY: for a page click main has just
			// focused the page, and the surface's origin rule (chrome for a field
			// click) would then focus the chord root and take focus OUT of the page
			// the user just pressed. The press already chose the target, and a
			// navigation/tab change chose its own. No `onDismiss` here.
			abandon();
		},
		onUnavailable: () => setNarrowAnchor(true),
	});

	/**
	 * Ordinary typing is the ONLY change that regenerates a completion.
	 *
	 * Paste, drop, deletion and undo/redo clear it and wait for the next eligible
	 * keystroke (the proposal's matrix). The dismissed mark is cleared as soon as
	 * the text differs from the text the user dismissed.
	 */
	const change = (event: ChangeEvent<HTMLInputElement>): void => {
		/*
		 * A LATE IME `input` AFTER THE EDIT ENDED IS NOT AN EDIT (review round 2,
		 * R2-1). `compositionend` is not the only event that can arrive after a
		 * press/commit/Enter blurred the field: Chromium can deliver the `input`
		 * that commits the composition before (or after) it, and this handler used
		 * to write `edited`/`draft` and re-raise the child with nothing focused.
		 * The ownership test is shared with `compositionEnd`.
		 *
		 * THE VALUE IS RESTORED HERE because there is no state write to re-render
		 * from once the edit is over: the browser has already written the late text
		 * into the DOM, and the blurred field would keep it until something else
		 * rendered.
		 */
		if (
			editDismissedRef.current ||
			document.activeElement !== event.currentTarget
		) {
			event.currentTarget.value = raw;
			return;
		}
		setAcceptedTarget(null);
		setEdited(true);
		const next = event.target.value;
		const input = event.currentTarget;
		const inputType = (event.nativeEvent as InputEvent).inputType ?? "";
		setDraft(next);
		// IME intermediate values are not user edits to preserve; the composition's
		// final value is recorded once, at `compositionEnd`.
		if (!composingRef.current) recordEdit(next);
		if (composingRef.current || inputType !== "insertText") {
			clearGenerated();
			return;
		}
		const stillDismissed = dismissedForText === next;
		if (dismissedForText !== null && !stillDismissed) setDismissedForText(null);
		const eligible = canInlineComplete({
			raw: next,
			selectionStart: input.selectionStart,
			selectionEnd: input.selectionEnd,
			composing: false,
			dismissedForText: stillDismissed ? next : null,
			completionText: null,
		});
		const ranked = suggestAddresses(autocomplete.entries, next);
		setCompletion(eligible ? ranked.inline : null);
		setActiveIndex(-1);
	};

	/** A cursor move that is not the generated suffix cancels the completion
	 * without touching the raw draft. Collapsed at the end is ordinary typing, not
	 * a move, and must not clear the completion the change just made. */
	const select = (event: SyntheticEvent<HTMLInputElement>): void => {
		const input = event.currentTarget;
		const current = completionRef.current;
		if (!current) return;
		if (
			input.selectionStart === input.selectionEnd &&
			input.selectionStart === input.value.length
		)
			return;
		if (
			isGeneratedSuffixSelected({
				raw: current.raw,
				selectionStart: input.selectionStart,
				selectionEnd: input.selectionEnd,
				completionText: current.text,
			})
		)
			return;
		clearGenerated();
	};

	const compositionStart = (): void => {
		composingRef.current = true;
		setComposing(true);
		clearGenerated();
	};

	const compositionEnd = (event: CompositionEvent<HTMLInputElement>): void => {
		composingRef.current = false;
		setComposing(false);
		/*
		 * A LATE COMMIT AFTER THE EDIT ENDED IS NOT AN EDIT (review round 1, R1-1).
		 * `compositionend` can arrive after an outside press or a main dismissal has
		 * already blurred the field (a blur can even commit the IME), and its value
		 * then belongs to a draft this row has given up. Adopting it re-seeded
		 * `edited`/`draft` and could raise the suggestion child after focus had left.
		 * Only a field that still owns focus and an un-dismissed edit may adopt; the
		 * same ownership test guards `change()` (review round 2, R2-1).
		 */
		if (
			editDismissedRef.current ||
			document.activeElement !== event.currentTarget
		)
			return;
		const next = event.currentTarget.value;
		setEdited(true);
		setDraft(next);
		recordEdit(next);
		clearGenerated();
	};

	const focus = (): void => {
		editDismissedRef.current = false;
		if (draft === null) setEdited(false);
		setDraft((current) => current ?? live);
		undoRef.current = { stack: [live], redo: [] };
		clearGenerated();
		setDismissedForText(null);
		autocomplete.onFocus();
	};

	/** BLUR NEVER NAVIGATES. This is the first interaction rule the feature had to
	 * change: with suggestions on screen, clicking the page is a dismissal, not a
	 * commitment of text the user never accepted. */
	const blur = (event: FocusEvent<HTMLInputElement>): void => {
		if (!activeRef.current) return;
		autocomplete.onBlur();
		/*
		 * A NULL `relatedTarget` IS AMBIGUOUS (design §4, F6): it can be a click on
		 * the native page, a click on the child row, or the window losing
		 * activation. Main resolves the first two (page focus, child mouse-down
		 * focus-back), and a window deactivation must NOT throw the draft away. So
		 * the row only drops the draft when focus moves to a node the document can
		 * name.
		 */
		if (event.relatedTarget === null) {
			// The draft survives a window deactivation, but a generated suffix is
			// not part of what the user typed: the field must show the raw draft
			// when it comes back, not a proposal nobody accepted.
			clearGenerated();
			return;
		}
		setAcceptedTarget(null);
		setDraft(null);
		clearGenerated();
		setDismissedForText(null);
	};

	const keyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
		if (event.nativeEvent.isComposing || composingRef.current) return;
		const input = event.currentTarget;
		const current =
			completionRef.current && completionRef.current.raw === raw
				? completionRef.current
				: null;
		const suffixSelected =
			current !== null &&
			isGeneratedSuffixSelected({
				raw: current.raw,
				selectionStart: input.selectionStart,
				selectionEnd: input.selectionEnd,
				completionText: current.text,
			});

		if (event.key === "Enter") {
			event.preventDefault();
			// An untouched seed is the live URL, not a commitment: Enter with NO
			// highlighted row abandons the draft, returns focus and navigates
			// NOTHING (UX U1/U9). The active-row check comes FIRST in the next
			// branch: Cmd+L then ArrowDown is an explicit choice of a history row,
			// and Enter must commit it whatever the draft state (U8).
			if (untouchedDraft && activeIndex < 0) {
				abandon();
				onDismiss?.("cancel");
				return;
			}
			// The classification and the commit path agree here: blocked text and a
			// non-web scheme are refused BEFORE anything can navigate them, with
			// the same sentence the list already shows (UX U5).
			if (refusedInput) {
				setAnnouncement(
					t("ui.browser.browser_url_bar.address_suggestions_blocked"),
				);
				return;
			}
			if (activeIndex >= 0) {
				const target = rowTarget(suggestions, activeIndex);
				if (target) {
					commit(target);
					return;
				}
			}
			if (
				acceptedTarget !== null &&
				acceptedTarget.tabId === tabId &&
				acceptedTarget.raw === raw
			) {
				commit(acceptedTarget.targetUrl);
				return;
			}
			if (current) {
				commit(current.targetUrl);
				return;
			}
			const next = usableRawAddress(raw);
			if (!next) {
				abandon();
				// THE KEYBOARD MUST LAND SOMEWHERE. Abandoning without the surface's
				// handoff left focus on `<body>`: the upshot was a dead keyboard after
				// Enter on a blank/control-char draft (review round 2, U3-2). Same
				// cancel intent as untouched Enter; the surface sends it to the page
				// when one is presented, else to the chord root.
				onDismiss?.("cancel");
				return;
			}
			// ENTER PRECEDENCE, in the code's own order: (1) a highlighted row
			// commits that row — the search row searches, a candidate row
			// navigates; (2) an accepted suffix commits its canonical target;
			// (3) a displayed inline completion commits its canonical target;
			// (4) with none of those, search intent commits the DuckDuckGo URL;
			// (5) otherwise the raw text is navigated (or, equal to the live URL,
			// dismisses). The search row is normally highlighted by default, so
			// (4) is the safety net for a dismissal that left no row selected.
			if (addressIntent(next) === "search") {
				commit(searchUrl(next));
				return;
			}
			if (next !== live) commit(next);
			else {
				setDraft(null);
				clearGenerated();
			}
			return;
		}

		if (event.key === "Escape") {
			event.preventDefault();
			/*
			 * ONE STAGE in the row (design §4). The old two-stage Escape existed to
			 * let an accepted inline suffix survive the list's dismissal, but the only
			 * commitment is Enter or a row, so there is nothing to preserve: Escape
			 * discards the draft and returns focus.
			 */
			abandon();
			/* ESCAPE IS A RETURN TO THE PAGE when one is presented (operator
			 * report, 2026-10-24): the field took the caret from the page, and the
			 * request's origin does not answer where it should go back to — a click
			 * into the field is chrome origin even with a page right below it. The
			 * surface reads the intent and decides (own-state falls back to the
			 * chord root); this row cannot see whether the tab has a page. */
			onDismiss?.("escape");
			return;
		}

		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			// Arrow keys move over the UNIFIED rows, search row included: a key that
			// skips the first row makes the highlighted row and the row the user
			// believes they are on disagree.
			if (suggestions.rows.length === 0) return;
			event.preventDefault();
			const nextIndex = moveActive(
				activeIndex,
				event.key === "ArrowDown" ? 1 : -1,
				suggestions.rows.length,
			);
			const selected = suggestions.rows[nextIndex];
			explicitSelection.current = selected
				? { query, key: rowKey(selected) }
				: null;
			// An arrow starts explicit row navigation: the field must stop showing
			// a suffix that names a different destination than the highlighted row
			// Enter will commit (UX U6). Clearing the completion makes the inline
			// target a row again, so resolve the selection BY KEY in the expanded
			// list rather than keeping an index that now points at a different row.
			if (current) {
				setCompletion(null);
				const expanded = suggestAddresses(autocomplete.entries, query, {
					inlineShown: false,
				}).rows;
				const expandedIndex = selected
					? expanded.findIndex((row) => rowKey(row) === rowKey(selected))
					: -1;
				setActiveIndex(expandedIndex);
			} else {
				setActiveIndex(nextIndex);
			}
			return;
		}

		if (event.key === "ArrowRight" || event.key === "End") {
			if (suffixSelected) {
				event.preventDefault();
				acceptSuffix();
				return;
			}
			if (current) clearGenerated();
			return;
		}

		if (event.key === "ArrowLeft" || event.key === "Home") {
			if (current) clearGenerated();
			return;
		}

		if (event.key === "Backspace" || event.key === "Delete") {
			if (suffixSelected) {
				event.preventDefault();
				setDraft(current.raw);
				clearGenerated();
				setDismissedForText(current.raw);
				setCaretRequest((count) => count + 1);
			}
			return;
		}

		if (event.key === "Tab") {
			// Tab moves focus; it never commits an unaccepted suffix. Clear the
			// generated text first so the blurred value is the draft.
			if (current || listVisible) {
				clearGenerated();
				setDismissedForText(raw);
			}
			return;
		}

		const primary = event.metaKey || event.ctrlKey;
		if (primary && !event.altKey && (event.key === "z" || event.key === "Z")) {
			event.preventDefault();
			if (event.shiftKey) redoEdit();
			else undoEdit();
			return;
		}
		if (
			event.ctrlKey &&
			!event.metaKey &&
			(event.key === "y" || event.key === "Y")
		) {
			event.preventDefault();
			redoEdit();
		}
	};

	// A background refresh can shrink the alternatives under a row the keyboard
	// has already selected, or swap a same-length set for different URLs. Reset
	// the active row and the viewport's offset together: an active descendant
	// naming a vanished row and a scroll offset belonging to the previous set are
	// the same stale state, and the URL KEY catches swaps the count cannot.
	const candidateKey = suggestions.rows
		.map((row) =>
			row.kind === "search" ? `search:${row.targetUrl}` : row.candidate.url,
		)
		.join("\n");
	// biome-ignore lint/correctness/useExhaustiveDependencies: `candidateKey` is the trigger, not a value the body reads - the URL SET changing is what must reset the selection and the scroll, and a same-length swap changes no count.
	useEffect(() => {
		// AN EXPLICIT SELECTION SURVIVES A LATE ANSWER for the same query (UX U4):
		// the user arrowed to a row while the previous list was still on screen,
		// and the answer that lands afterwards must not snap the highlight back to
		// the search row. Keep it when the same row key is still in the set.
		const prior = explicitSelection.current;
		if (prior && prior.query === query) {
			const index = suggestions.rows.findIndex(
				(row) => rowKey(row) === prior.key,
			);
			if (index >= 0) {
				setActiveIndex(index);
				return;
			}
		}
		// Otherwise (review A-4) a changed SET is a new list: a same-length swap
		// can leave the old index naming a row the new query never ranked, and
		// Enter would commit that unseen destination. The search row is the
		// default when present; no explicit selection otherwise.
		explicitSelection.current = null;
		setActiveIndex(suggestions.rows[0]?.kind === "search" ? 0 : -1);
	}, [candidateKey]);

	// The completion is REAL SELECTED TEXT, set here rather than overlaid: the
	// user's next keystroke replaces the selection, and Right accepts it.
	useLayoutEffect(() => {
		const element = inputEl.current;
		if (!element || document.activeElement !== element) return;
		if (currentCompletion) {
			element.setSelectionRange(
				currentCompletion.raw.length,
				currentCompletion.text.length,
				"forward",
			);
			return;
		}
		if (caretRequest === 0) return;
		const end = element.value.length;
		element.setSelectionRange(end, end);
	}, [currentCompletion, caretRequest]);

	// Polite, and only on an OPEN transition: a count per keystroke is the
	// per-keystroke spam the proposal forbids. The list's own live region carries
	// empty/error states too.
	useEffect(() => {
		if (listVisible && !wasListOpen.current) {
			if (autocomplete.error) {
				setAnnouncement(
					t("ui.browser.browser_url_bar.address_suggestions_unavailable"),
				);
			} else if (suggestions.rows.length > 0 && !suggestionsUnavailable) {
				setAnnouncement(
					t("ui.browser.browser_url_bar.address_suggestions_available", {
						count: suggestions.rows.length,
					}),
				);
			} else if (!autocomplete.loading && !suggestionsUnavailable) {
				setAnnouncement(listNotice);
			}
		} else if (!listVisible && wasListOpen.current) {
			setAnnouncement("");
		}
		wasListOpen.current = listVisible;
	}, [
		listVisible,
		autocomplete.error,
		autocomplete.loading,
		listNotice,
		suggestions.rows.length,
		suggestionsUnavailable,
	]);

	// THE FOCUS CONTRACT, ON A NONCE (S5). The row is permanently mounted, so a
	// raise cannot be "this instance mounted": Cmd+L selects the live URL, a typed
	// seed leaves the caret after the character, and a second Cmd+L re-selects. A
	// seed also makes the draft USER-AUTHORED (`edited`), which is what keeps it
	// from being read as an untouched live URL.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the nonce is the trigger; reading the seed and selection is the point.
	useLayoutEffect(() => {
		const element = inputEl.current;
		if (!element) return;
		element.focus({ preventScroll: true });
		if (focusRequest?.seed !== undefined) {
			setEdited(true);
			setDraft(focusRequest.seed);
			const end = focusRequest.seed.length;
			element.setSelectionRange(end, end);
		} else if (focusRequest?.selectAll) {
			element.select();
		}
	}, [focusRequest?.nonce]);

	// Tier 1 is a fact the user must be told once, not a silent missing list.
	useEffect(() => {
		if (mode === "suspend")
			setAnnouncement(
				t("ui.browser.browser_url_bar.address_suggestions_unavailable"),
			);
	}, [mode]);

	return (
		<div
			ref={setRowEl}
			/* A CHROME BAND, permanent and in flow between the strip and the page:
			   4px pad + 28px controls + 4px pad + the 1px rule = 37px. The rule is
			   `border-control` rather than `hairline` because it is the only separator
			   against a white page (3.30:1 dark / 3.92:1 light; hairline would be
			   1.23:1 and fail as an edge). */
			data-glass-region="chrome"
			className="flex h-[37px] w-full items-center gap-1 border-control border-b bg-elevated px-2 py-1"
			data-tour-tag="browser-url-bar"
		>
			<Tooltip
				content={t("ui.browser.browser_url_bar.back_shortcut", {
					shortcut: backChord,
				})}
			>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={t("ui.browser.browser_url_bar.back")}
					aria-keyshortcuts={backChord}
					disabled={disabled || !canGoBack}
					onClick={onBack}
					data-tour-tag="browser-back"
				>
					<ArrowLeft aria-hidden className="size-4" />
				</Button>
			</Tooltip>
			{!hideForward && (
				<Tooltip
					content={t("ui.browser.browser_url_bar.forward_shortcut", {
						shortcut: forwardChord,
					})}
				>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={t("ui.browser.browser_url_bar.forward")}
						aria-keyshortcuts={forwardChord}
						disabled={disabled || !canGoForward}
						onClick={onForward}
						data-tour-tag="browser-forward"
					>
						<ArrowRight aria-hidden className="size-4" />
					</Button>
				</Tooltip>
			)}
			{loading ? (
				<Tooltip content={t("ui.browser.browser_url_bar.stop_loading")}>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={t("ui.browser.browser_url_bar.stop_loading")}
						disabled={disabled || startPage}
						onClick={onStop}
						data-tour-tag="browser-stop"
					>
						<X aria-hidden className="size-4" />
					</Button>
				</Tooltip>
			) : (
				<Tooltip content={`Reload (${reload.glyph})`}>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={t("ui.browser.browser_url_bar.reload")}
						aria-keyshortcuts={reload.aria}
						disabled={disabled || startPage}
						onClick={onReload}
						data-tour-tag="browser-reload"
					>
						<RotateCw aria-hidden className="size-4" />
					</Button>
				</Tooltip>
			)}
			{onHome && !hideHome && (
				<Tooltip content={t("ui.browser.browser_url_bar.home")} side="top">
					<Button
						type="button"
						size="icon-sm"
						variant="ghost"
						className="text-ink-muted hover:bg-control-hover hover:text-ink"
						aria-label={t("ui.browser.browser_url_bar.home")}
						disabled={disabled || startPage}
						onClick={onHome}
						data-tour-tag="browser-home"
					>
						<Home aria-hidden className="size-4" />
					</Button>
				</Tooltip>
			)}
			<div className="@container/addressfield relative min-w-0 grow">
				<Tooltip content={siteInfoLabel} side="top">
					{/* NOT A TAB STOP (round-1 U4): the mark has no action, so it is
					    described from the field (`aria-describedby`) and keeps its
					    pointer tooltip, without a keyboard stop between Home and the
					    field for the same information. */}
					<span
						role="img"
						aria-label={siteInfoLabel}
						data-site-info={siteInfo.kind}
						className={cn(
							"absolute top-1/2 left-2 z-10 flex -translate-y-1/2 items-center",
							siteInfoWarns ? "text-ink" : "text-ink-muted",
						)}
					>
						<SiteInfoIcon aria-hidden className="size-3.5" />
					</span>
				</Tooltip>
				<span id={siteDescId} className="sr-only">
					{siteInfoLabel}
				</span>
				<Input
					ref={setInputEl}
					inputSize="sm"
					aria-keyshortcuts={address.aria}
					value={value}
					disabled={disabled}
					role="combobox"
					aria-autocomplete="both"
					aria-expanded={listVisible}
					aria-controls={
						listVisible && suggestions.rows.length > 0 ? listId : undefined
					}
					aria-describedby={
						[
							siteDescId,
							hintShown ? unavailableId : null,
							listVisible && suggestions.rows.length === 0 ? noticeId : null,
						]
							.filter(Boolean)
							.join(" ") || undefined
					}
					aria-activedescendant={
						activeIndex >= 0 && suggestions.rows[activeIndex]
							? optionId(activeIndex)
							: undefined
					}
					dir="ltr"
					onChange={change}
					onKeyDown={keyDown}
					onSelect={select}
					onCompositionStart={compositionStart}
					onCompositionEnd={compositionEnd}
					onFocus={focus}
					onBlur={blur}
					spellCheck={false}
					autoComplete="off"
					aria-label={t("ui.browser.browser_url_bar.address")}
					placeholder={
						loading && !live ? (pendingUrl ?? undefined) : placeholder
					}
					data-tour-tag="browser-address"
					data-address-editing={editing ? "true" : "false"}
					data-address-loading={autocomplete.loading ? "true" : "false"}
					data-address-suppressed={suppressed ? "true" : "false"}
					data-address-candidates={String(suggestions.candidates.length)}
					data-address-rows={String(suggestions.rows.length)}
					className={cn(
						"pr-7 pl-8 focus-visible:outline-offset-1!",
						editing ? "font-mono text-mono-sm" : "text-ellipsis",
						/* A LONG ADDRESS MUST NOT RUN UNDER THE HINT (Q5-1): the pill
						   reserves its own trailing run in the field's CONTENT box, so
						   the text scrolls in the space that remains. Below the narrow
						   breakpoint the pill is `sr-only` and needs no reservation. */
						hintPainted &&
							/* FIELD width is the gate, not row width (Q5-1): the pill
							   and its run only exist in a field of at least 342 px; the
							   clamp keeps a 160 px field floor above that. */
							"@[342px]/addressfield:pr-[min(378px,max(0px,calc(100%-10rem)))]",
					)}
				/>
				{loading && !editing && (
					<span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">
						<Spinner size="xs" />
					</span>
				)}
				{/* TIER 1 IS TOLD, NOT HINTED (UX U5), and the telling lives INSIDE the
				    field. Beside it was a second control-shaped box that cost the field
				    width every time the list was unavailable (S4b U5); the permanent row
				    cannot afford that, and the sentence belongs to the field that still
				    works. `pointer-events-none` keeps the input clickable underneath. */}
				{hintShown && (
					<span
						id={unavailableId}
						/* AT reaches it through `aria-describedby`; the suspend copy is
						   already announced by the field's own status sentence, so this
						   node must not be a second live region (round 3, U18). Below the
						   width the sentence can share with typed text it is description
						   only, never painted over the address. */
						className={
							narrow
								? "sr-only"
								: "hidden pointer-events-none absolute top-1/2 right-7 max-w-[45%] -translate-y-1/2 truncate rounded-sm bg-elevated px-1 text-meta text-ink-dim @[342px]/addressfield:block"
						}
						data-tour-tag="browser-address-unavailable"
					>
						{t("ui.browser.browser_url_bar.address_suggestions_unavailable")}
					</span>
				)}
			</div>
			{menu}
			{/* THE ACCESSIBLE LIST lives in the parent and is clipped, never in flow:
			    the visual rows are the native child, which is `aria-hidden`. One
			    option per mirrored row keeps `aria-activedescendant` and the row
			    the user actually presses naming the same candidate. */}
			{listVisible && suggestions.rows.length > 0 && (
				<div className="sr-only" data-tour-tag="browser-address-suggestions">
					<span id={listLabelId}>{listLabel}</span>
					{/* biome-ignore lint/a11y/useFocusableInteractive: DOM focus stays in the input; the listbox is reached through aria-activedescendant. */}
					{/* biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: a listbox cannot be a native <select> and must stay a list of options. */}
					{/* biome-ignore lint/a11y/useSemanticElements: a type-to-filter combobox list cannot be a native <select>. */}
					<div
						id={listId}
						// biome-ignore lint/a11y/useSemanticElements: a type-to-filter combobox list cannot be a native <select>.
						role="listbox"
						aria-labelledby={listLabelId}
						data-address-suggestions-list
					>
						{suggestions.rows.map((row, index) => (
							// biome-ignore lint/a11y/useFocusableInteractive: DOM focus stays in the input; the active option is announced through aria-activedescendant.
							// biome-ignore lint/a11y/useSemanticElements: a type-to-filter combobox list cannot be a native <select>.
							<div
								key={
									row.kind === "search"
										? `search:${row.targetUrl}`
										: row.candidate.url
								}
								id={optionId(index)}
								// biome-ignore lint/a11y/useSemanticElements: a type-to-filter combobox list cannot be a native <select>.
								role="option"
								aria-selected={index === activeIndex}
								data-address-suggestion
								data-address-suggestion-search={
									row.kind === "search" ? "true" : undefined
								}
								data-address-suggestion-source={
									row.kind === "candidate" ? row.candidate.source : undefined
								}
								data-address-suggestion-url={
									row.kind === "search" ? undefined : row.candidate.url
								}
							>
								{rowAccessibleText(row)}
							</div>
						))}
					</div>
				</div>
			)}
			{suggestions.rows.length === 0 && (
				<span id={noticeId} className="sr-only">
					{listNotice}
				</span>
			)}
			{/* biome-ignore lint/a11y/useSemanticElements: a politer live region is a role=status span. */}
			<span className="sr-only" role="status" aria-live="polite">
				{announcement}
			</span>
		</div>
	);
};
