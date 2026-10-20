import { Spinner } from "@shared/components/common/spinner";
import {
	Badge,
	Button,
	Input,
	Tooltip,
	countLabel,
} from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { chordCaption } from "@shared/keymap/keymap-chord";
import { cn } from "@shared/lib/utils";
import { navigationShortcutLabel } from "@shared/navigation-gesture";
import {
	ArrowLeft,
	ArrowRight,
	File,
	FolderOpen,
	Globe,
	Home,
	Lock,
	LockOpen,
	Printer,
	RotateCw,
	Search,
	ShieldCheck,
	X,
} from "lucide-react";
import type {
	ChangeEvent,
	CompositionEvent,
	FC,
	KeyboardEvent,
	Ref,
	SyntheticEvent,
} from "react";
import {
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
	AddressHistoryScope,
} from "../../../../../shared/browser-address-history";
import { useAddressAutocomplete } from "../hooks/use-address-autocomplete";
import type { LoadFailureView } from "../hooks/use-browser-chrome";
import {
	type AddressCandidate,
	type InlineCompletion,
	addressIntent,
	canInlineComplete,
	isGeneratedSuffixSelected,
	moveActive,
	suggestAddresses,
	usableRawAddress,
} from "../model/address-autocomplete";
import { isSecurityLoadFailure, siteInfoForUrl } from "../model/site-info";

/**
 * The URL bar and the navigation controls. Design: docs/design/ui-browser-tab.md
 * 6.1 (the controls, and the typed-URL asymmetry), 11.2 (branding roles).
 *
 * THE DISPLAY RULE, which is the whole of §6.1's URL-bar paragraph: the field
 * shows the ACTIVE TAB'S LIVE URL, updated from navigation events, "never from
 * what was requested". So a redirect to a login page shows the login page, and a
 * failed navigation shows where the tab actually is rather than where it was
 * asked to go. The host publishes that live value (`chromeState().url`), and this
 * component never derives it from the last thing it sent.
 *
 * THE EDITING RULE, and why it is not optional: an incoming live URL must never
 * overwrite what the user is typing. A field that reverted mid-keystroke would
 * make typing a URL impossible on any page with a timer or a redirect. So the
 * draft takes over while the field is dirty, and returns to the live URL on
 * commit, on Escape, and on blur.
 *
 * THE TYPED-URL ASYMMETRY, stated in the UI because it is a real property of the
 * gate rather than a bug (§6.1, §9): the user typing their own URL is the
 * consent and is not gated, while the agent's navigation to the same origin still
 * prompts. The strip's consent bar says so in words when it appears, so a user
 * who can reach a site the agent cannot does not read it as a broken agent.
 *
 * Non-`http(s)` input is refused by the HOST, not by a second check here
 * (design 6.1's "mirroring `_BROWSER_SCHEMES`"): one implementation of the
 * scheme rule, and its refusal is what the band shows.
 *
 * THE APPROVALS CONTROL, and what it replaced (browser-approval-ux.md 4.3, 5).
 * The old control was a bare `Sites` label carrying a count of records with
 * `scope !== "deny"` — the number of things already GRANTED, which says nothing
 * about what is WAITING and is the wrong number to make a demand of. It becomes
 * an icon plus the label `Approvals`, `variant="outline" size="sm"` unchanged
 * (the "outline control" contrast row already covers the button itself), and the
 * number it carries is the live request count, drawn as the numbered badge of §5.
 * The approved count moves into the dock's header ("4 sites approved"), which is
 * where a fact that is not a demand belongs.
 *
 * The badge is a SIBLING rather than a child of the button, so the control's own
 * label is untouched and the number sits in the corner the operator asked for
 * ("at the corner of the button"). `aria-label` carries the same number as words,
 * so a screen reader hears "Approvals, 3 waiting" rather than a stranded digit.
 */

export interface BrowserUrlBarProps {
	/** Chrome focus only; never a window activation. */
	inputRef?: Ref<HTMLInputElement>;
	pageZoom?: number;
	onFind?: () => void;
	/**
	 * Home (LOH-13): return the active tab to the browser's start state.
	 * Optional like `onFind` so a host without the intent (a story, a test
	 * harness) renders no control rather than a dead one; the real surface
	 * always passes it. It carries no URL — main owns the start state.
	 */
	onHome?: () => void;
	/**
	 * The active tab's recorded load failure, when its last navigation failed
	 * (U1). The site-info register reads it for exactly one purpose: an https
	 * page whose own load failed - above all on a certificate error - must not
	 * keep the closed lock. Optional so a host without the projection (a
	 * story, a harness) renders the scheme register as before.
	 */
	loadFailure?: LoadFailureView | null;
	onResetZoom?: () => void;
	/** Print the active page (LOH-13 slice C). A toolbar button beside Find
	 * rather than a new menu: the url bar is where this app's other
	 * page-scoped human controls (find, zoom reset) already live, and the
	 * frozen brief invents no print menu. Optional like `onFind` so a host
	 * without the intent renders no control rather than a dead one. The
	 * action itself is main's `webContents.print` with the OS dialog as the
	 * consent (`page-controls.ts`). */
	onPrint?: () => void;
	/** The active tab. A typed draft belongs to ONE tab: see `draft` below. */
	tabId: number | null;
	url: string;
	/** Where the user asked to go, while the tab has not committed it. Shown as the
	 * placeholder and never as the value: see the comment on `askedFor` below. */
	pendingUrl: string | null;
	loading: boolean;
	canGoBack: boolean;
	canGoForward: boolean;
	disabled: boolean;
	/** `expectedTabId` is the tab this draft belongs to, so main can refuse a commit
	 * that raced a tab switch. */
	onNavigate: (url: string, expectedTabId?: number) => void;
	onBack: () => void;
	onForward: () => void;
	onReload: () => void;
	onStop: () => void;
	onOpenApprovals: () => void;
	/** How many requests are waiting for an answer. Zero draws no badge at all —
	 * the honest rendering of "nothing is being asked" (§3.3). */
	waitingCount: number;
	/** The Approvals control itself, so the dock can return focus to it when Escape
	 * closes the dock. A ref rather than a callback because the surface owns both
	 * ends of that exchange. */
	triggerRef?: Ref<HTMLButtonElement>;
	/**
	 * The directory the host writes downloads into, or null when it has never
	 * written one.
	 *
	 * WHY THE FOLDER IS REACHABLE FROM HERE AT ALL (review round 1, U2, D2). The
	 * strip's row is a NOTIFICATION: it is dismissed by a press and it retires by
	 * age (U7), and both of those are right for a line about what just happened —
	 * but until this control existed, the row was also the ONLY route to the files,
	 * so dismissing it made the user's download unreachable from inside the app.
	 * The row carries the path now, and this is the durable half: one control that
	 * opens the same directory main opens, for as long as the host has written
	 * anything, whether or not any row is on screen.
	 *
	 * It renders ONLY when a directory exists: a control that opens a folder a build
	 * cannot have written is a promise the app cannot keep, and the honest degrade
	 * for a host that predates the feature is no control at all.
	 */
	downloadsDir: string | null;
	/** The newest save into that directory, and how many have been saved in this app
	 * run (review round 2, U12; the count's premise corrected in round 3, M-1). Rides
	 * the same projection as `downloadsDir` so the control cannot describe a save the
	 * row does not have; `null` when nothing has been saved yet, which leaves the label
	 * as it was. */
	downloadsRecent?: { name: string; count: number } | null;
	/** Open that directory. Takes no path — main decides which one. */
	onOpenDownloads: () => void;
	/**
	 * The surface's display scope for local address suggestions. `scopeKey` is the
	 * primitive identity of that scope (a host builds `{ sessionId }` fresh each
	 * render, so the object cannot be a dependency). Optional so a host without
	 * the history IPC renders a plain URL field rather than a dead list.
	 */
	addressScope?: AddressHistoryScope;
	addressScopeKey?: string;
	/** The bounded local history read. Failure degrades to plain editing. */
	addressHistory?: (
		request: AddressHistoryRequest,
	) => Promise<AddressHistoryResponse>;
	/** Main's projection invalidations, used to refresh the snapshot while focused. */
	onStateChanged?: (callback: () => void) => () => void;
}

/** What the durable folder control says it opens (review round 2, U12).
 *
 * WHY IT IS A SENTENCE AND NOT A LIST: §16.4's rule is against a per-file list with
 * per-file actions, and this control has one action — open the folder. Naming the
 * newest file and how many have been saved in this app run is what turns an icon
 * into an answer to "did anything arrive while I was reading Chat", which is the
 * state U12 is about. The count is the host's own SESSION total rather than a window
 * over its note buffer, which is why the wording can promise "this session" — the
 * first draft derived it from the notes and the summary vanished after four later
 * decisions, which is exactly when a user would be looking for it. */
function downloadsLabel(
	recent: { name: string; count: number } | null,
): string {
	if (!recent)
		return t("ui.browser.browser_file_transfer_row.open_downloads_folder");
	return recent.count > 1
		? t("ui.browser.browser_url_bar.newest_download", {
				name: recent.name,
				count: recent.count,
			})
		: t("ui.browser.browser_url_bar.latest_download", { name: recent.name });
}

/** `about:blank` is what a new tab starts on and is what a browser shows as an
 * EMPTY bar. Rendering the literal string would make every new tab look like it
 * had navigated somewhere. */
export function displayUrl(url: string): string {
	return url === "about:blank" ? "" : url;
}

/**
 * One alternative row.
 *
 * `onMouseDown` prevents default so pressing a row does not blur the field (the
 * blur path deliberately dismisses without navigating); the click is then the
 * single commit. The row is never a tab stop: the input keeps DOM focus and
 * `aria-activedescendant` names the active row.
 */
const AddressSuggestionRow: FC<{
	candidate: AddressCandidate;
	active: boolean;
	optionId: string;
	onActivate: () => void;
}> = ({ candidate, active, optionId, onActivate }) => {
	return (
		// biome-ignore lint/a11y/useFocusableInteractive: focus stays in the address input; the active option is announced through aria-activedescendant.
		// biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard is handled on the input, not on the option.
		// biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: a combobox option cannot be a native <option> here.
		// biome-ignore lint/a11y/useSemanticElements: a type-to-filter combobox option cannot be a native <option>.
		<div
			id={optionId}
			// biome-ignore lint/a11y/useSemanticElements: a type-to-filter combobox option cannot be a native <option>.
			role="option"
			aria-selected={active}
			data-address-suggestion
			data-address-suggestion-url={candidate.url}
			onMouseDown={(event) => event.preventDefault()}
			onClick={onActivate}
			className={cn(
				"relative flex items-baseline gap-3 px-3 py-2",
				active
					? cn(
							"bg-accent-wash",
							// The 2px accent bar is the second, non-luminance signal for the row
							// Enter will use — the same pair the composer's completion lists use.
							"before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent",
						)
					: "hover:bg-row-hover",
			)}
		>
			<span className="min-w-0 truncate font-mono text-mono-sm text-ink">
				{candidate.displayText}
			</span>
			{candidate.title && (
				<span className="min-w-0 flex-1 truncate text-body-sm text-ink-muted">
					{candidate.title}
				</span>
			)}
		</div>
	);
};

export const BrowserUrlBar: FC<BrowserUrlBarProps> = ({
	inputRef,
	tabId,
	url,
	pendingUrl,
	loading,
	canGoBack,
	canGoForward,
	disabled,
	onNavigate,
	onBack,
	onForward,
	onReload,
	onStop,
	onOpenApprovals,
	waitingCount,
	triggerRef,
	downloadsDir,
	downloadsRecent,
	onOpenDownloads,
	pageZoom = 1,
	onFind,
	onPrint,
	onHome,
	loadFailure = null,
	onResetZoom,
	addressScope = "all",
	addressScopeKey = "all",
	addressHistory,
	onStateChanged,
}) => {
	/**
	 * THE DRAFT BELONGS TO ITS TAB (UX r1 U1). The keyboard can change the active
	 * tab (Cmd+2, Ctrl+Tab, Cmd+W, Cmd+T, Cmd+Shift+T) while this field still has
	 * focus, so a bare string would keep showing tab A's text over tab B and the
	 * blur that follows would commit it INTO tab B, navigating it away. Pairing the
	 * text with the tab it was typed for makes a tab change discard the draft by
	 * construction: no effect, no reset call, and no state in which the field says
	 * one tab while the host is on another. It also matches Chrome and Safari,
	 * where an omnibox draft is per-tab. Precisely: a switch HIDES the draft, it
	 * does not erase it, so returning to that tab while this field still has
	 * focus shows the old text again (and blur commits it there, to the tab it
	 * was typed for). It is only ever lost by an edit, Enter, Escape or blur.
	 */
	useI18nLocale();
	const [typed, setTyped] = useState<{
		tabId: number | null;
		text: string;
	} | null>(null);
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
	const suggestionsEnabled = addressHistory !== undefined;
	const autocomplete = useAddressAutocomplete({
		tabId,
		scope: addressScope,
		scopeKey: addressScopeKey,
		requestHistory:
			addressHistory ??
			(() => Promise.reject(new Error("address history is unavailable"))),
		subscribe: onStateChanged ?? (() => () => {}),
		enabled: suggestionsEnabled,
	});
	const inputEl = useRef<HTMLInputElement | null>(null);
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
	const [hint, setHint] = useState(false);
	const [announcement, setAnnouncement] = useState("");
	const listId = useId();
	const listLabelId = `${listId}-label`;
	const noticeId = `${listId}-notice`;
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
	const find = chordCaption("primary+f", isMac ? "mac" : "linux");
	const resetZoom = chordCaption("primary+0", isMac ? "mac" : "linux");
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
				? LockOpen
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
	const currentCompletion =
		completion && completion.raw === raw ? completion : null;
	const value = currentCompletion ? currentCompletion.text : raw;
	const editing = draft !== null;
	const suggestions = useMemo(
		() => suggestAddresses(autocomplete.entries, raw),
		[autocomplete.entries, raw],
	);
	const hasResult =
		suggestions.inline !== null || suggestions.candidates.length > 0;
	// A dismissal suppresses the list until the text changes. Without this, the
	// first Escape restored the raw text but left the rows on screen — the copy
	// promised a dismissal the layout did not perform.
	const suppressed = dismissedForText !== null && dismissedForText === raw;
	const listVisible =
		suggestionsEnabled &&
		editing &&
		!composing &&
		!suppressed &&
		(autocomplete.error ||
			suggestions.candidates.length > 0 ||
			hint ||
			(!autocomplete.loading &&
				!autocomplete.error &&
				!hasResult &&
				suggestions.intent !== "blocked"));

	/** The one line the list shows when it has no rows. Separate from the empty
	 * field's copy: a filtered no-match and "nothing here yet" are different
	 * facts, and an error must not look like an empty history. */
	const listNotice = autocomplete.error
		? t("ui.browser.browser_url_bar.address_suggestions_unavailable")
		: hint
			? t("ui.browser.browser_url_bar.address_required")
			: raw.length === 0
				? t("ui.browser.browser_url_bar.address_suggestions_empty")
				: t("ui.browser.browser_url_bar.address_suggestions_no_match");

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

	const abandon = (): void => {
		setAcceptedTarget(null);
		setDraft(null);
		clearGenerated();
		setHint(false);
		setDismissedForText(null);
	};

	const commit = (target: string): void => {
		setAcceptedTarget(null);
		// An explicit candidate, an accepted suffix or a typed address. The
		// expected tab is the draft's own, so main refuses a commit that raced a
		// tab switch instead of loading the new tab with the old address.
		onNavigate(target, tabId ?? undefined);
		setDraft(null);
		clearGenerated();
		setHint(false);
		setDismissedForText(null);
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
		setHint(false);
		setDismissedForText(null);
		setCaretRequest((count) => count + 1);
	};

	const undoEdit = (): void => {
		setAcceptedTarget(null);
		const undo = undoRef.current;
		if (undo.stack.length <= 1) return;
		undo.redo.push(undo.stack.pop() as string);
		setDraft(undo.stack[undo.stack.length - 1]);
		clearGenerated();
		setHint(false);
		setDismissedForText(null);
		setCaretRequest((count) => count + 1);
	};

	const redoEdit = (): void => {
		setAcceptedTarget(null);
		const undo = undoRef.current;
		const next = undo.redo.pop();
		if (next === undefined) return;
		undo.stack.push(next);
		setDraft(next);
		clearGenerated();
		setHint(false);
		setDismissedForText(null);
		setCaretRequest((count) => count + 1);
	};

	/**
	 * Ordinary typing is the ONLY change that regenerates a completion.
	 *
	 * Paste, drop, deletion and undo/redo clear it and wait for the next eligible
	 * keystroke (the proposal's matrix). The dismissed mark is cleared as soon as
	 * the text differs from the text the user dismissed.
	 */
	const change = (event: ChangeEvent<HTMLInputElement>): void => {
		setAcceptedTarget(null);
		const next = event.target.value;
		const input = event.currentTarget;
		const inputType = (event.nativeEvent as InputEvent).inputType ?? "";
		setDraft(next);
		setHint(false);
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
		const next = event.currentTarget.value;
		setDraft(next);
		recordEdit(next);
		clearGenerated();
	};

	const focus = (): void => {
		setDraft((current) => current ?? live);
		undoRef.current = { stack: [live], redo: [] };
		clearGenerated();
		setDismissedForText(null);
		setHint(false);
		autocomplete.onFocus();
	};

	/** BLUR NEVER NAVIGATES. This is the first interaction rule the feature had to
	 * change: with suggestions on screen, clicking the page is a dismissal, not a
	 * commitment of text the user never accepted. */
	const blur = (): void => {
		setAcceptedTarget(null);
		setDraft(null);
		clearGenerated();
		setDismissedForText(null);
		setHint(false);
		autocomplete.onBlur();
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
			const candidate =
				activeIndex >= 0 ? suggestions.candidates[activeIndex] : null;
			if (candidate) {
				commit(candidate.url);
				return;
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
				return;
			}
			// No search provider exists, and inventing one is a separate product
			// decision: a natural-language query gets a localized hint, not a
			// network request and not a made-up origin.
			if (addressIntent(next) === "search") {
				setHint(true);
				clearGenerated();
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
			const acceptedHere =
				acceptedTarget !== null &&
				acceptedTarget.tabId === tabId &&
				acceptedTarget.raw === raw;
			// Escape dismisses the list; it does not discard an accepted suffix.
			// If it did, Right+Escape+Enter would fall back to the display text and
			// lose the canonical HTTP target the suffix carried.
			if (current || listVisible || acceptedHere) {
				clearGenerated();
				setHint(false);
				setDismissedForText(raw);
				return;
			}
			abandon();
			return;
		}

		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			if (suggestions.candidates.length === 0) return;
			event.preventDefault();
			setActiveIndex(
				moveActive(
					activeIndex,
					event.key === "ArrowDown" ? 1 : -1,
					suggestions.candidates.length,
				),
			);
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
				setHint(false);
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
	// has already selected. Reset rather than leave an active descendant naming
	// an option that no longer exists.
	useEffect(() => {
		setActiveIndex((index) =>
			index >= suggestions.candidates.length ? -1 : index,
		);
	}, [suggestions.candidates.length]);

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
			} else if (hint) {
				setAnnouncement(t("ui.browser.browser_url_bar.address_required"));
			} else if (suggestions.candidates.length > 0) {
				setAnnouncement(
					t("ui.browser.browser_url_bar.address_suggestions_available", {
						count: suggestions.candidates.length,
					}),
				);
			} else if (!autocomplete.loading) {
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
		hint,
		listNotice,
		suggestions.candidates.length,
	]);

	return (
		<>
			{/* The bar's ground is the PANE's (`canvas/index.tsx`): it is the first row of
			    the drawer's body, so it wears the drawer's rung and is continuous with the
			    content area below it, with the strip's own rule the only line above. */}
			<div
				/* A CHROME BAND with the strip above it: on the Browser route it wears the
				 * app sidebar's paint (surface at its floor, raw over the desktop); inside a
				 * conversation's rail pane it clears into the pane's own alpha (one
				 * alpha-owning layer). */
				data-glass-region="chrome"
				className="flex items-center gap-1 border-control border-b bg-elevated px-2 py-1"
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
				{/* One control that changes role rather than two buttons: a browser
			    shows stop while loading and reload otherwise, and two buttons where
			    only one is ever enabled is a control that lies about its own state. */}
				{loading ? (
					<Tooltip content={t("ui.browser.browser_url_bar.stop_loading")}>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={t("ui.browser.browser_url_bar.stop_loading")}
							disabled={disabled}
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
							disabled={disabled}
							onClick={onReload}
							data-tour-tag="browser-reload"
						>
							<RotateCw aria-hidden className="size-4" />
						</Button>
					</Tooltip>
				)}
				{onHome && (
					<Tooltip
						content={t("ui.browser.browser_url_bar.home_destination")}
						side="top"
					>
						<Button
							type="button"
							size="icon-sm"
							variant="ghost"
							className="text-ink-muted hover:bg-control-hover hover:text-ink"
							aria-label={t("ui.browser.browser_url_bar.home")}
							disabled={disabled}
							onClick={onHome}
							data-tour-tag="browser-home"
						>
							<Home aria-hidden className="size-4" />
						</Button>
					</Tooltip>
				)}
				{downloadsDir && (
					// The durable route to the files (review round 1, U2): the strip's row can
					// be dismissed or age out, and this is what makes that allowed. Placed with
					// the navigation controls rather than beside Approvals because it is a
					// browser affordance, not a consent one.
					//
					// AND IT CARRIES THE NEWEST SAVE (review round 2, U12). An icon-only control
					// answers "where do downloads go" and nothing else, so a user who was in Chat
					// when the transfer happened had no way in the app to learn that anything
					// arrived — the row is the only account of it and the row retires. The label
					// now names the newest file and how many this session has saved, on HOVER and on
					// FOCUS (the same tooltip mechanism the rest of the toolbar uses, so a keyboard
					// user reaches it by tabbing). It is still not a per-file list (§16.4) and it
					// still opens the same directory: the sentence is the row's own facts, moved to
					// the one surface that outlives it.
					//
					// AND THE COUNT IS THE SESSION TOTAL, not the note window this first draft of
					// the sentence was worded for (review round 3, M-1). The host keeps its summary
					// for the life of the process and writes it from the same call that writes the
					// note (`downloads.ts`, the `note` writer), so the tooltip can promise "this
					// session" and does — `downloadsLabel` below states the same premise. The
					// draft's "recently rather than this session" rationale was left behind when the
					// count moved, and it contradicted the copy the user reads.
					<Tooltip content={downloadsLabel(downloadsRecent ?? null)}>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={t(
								"ui.browser.browser_file_transfer_row.open_downloads_folder",
							)}
							onClick={onOpenDownloads}
							data-tour-tag="browser-downloads-folder"
						>
							<FolderOpen aria-hidden className="size-4" />
						</Button>
					</Tooltip>
				)}
				{onFind && (
					<Tooltip
						content={t("ui.browser.browser_url_bar.find_in_page_shortcut", {
							shortcut: find.glyph,
						})}
						side="top"
					>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={t("ui.browser.browser_url_bar.find_in_page")}
							aria-keyshortcuts={find.aria}
							disabled={disabled}
							onClick={onFind}
							data-tour-tag="browser-find"
						>
							<Search aria-hidden className="size-4" />
						</Button>
					</Tooltip>
				)}
				{onPrint && (
					<Tooltip
						content={t("ui.browser.browser_url_bar.print_page")}
						side="top"
					>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={t("ui.browser.browser_url_bar.print_page")}
							disabled={disabled}
							onClick={onPrint}
							data-tour-tag="browser-print"
						>
							<Printer aria-hidden className="size-4" />
						</Button>
					</Tooltip>
				)}
				{pageZoom !== 1 && (
					<Tooltip
						content={t("ui.browser.browser_url_bar.reset_page_zoom_shortcut", {
							shortcut: resetZoom.glyph,
						})}
						side="top"
					>
						<Button
							variant="ghost"
							size="sm"
							aria-label={t("ui.browser.browser_url_bar.page_zoom_reset", {
								zoom: Math.round(pageZoom * 100),
							})}
							aria-keyshortcuts={resetZoom.aria}
							onClick={onResetZoom}
							data-tour-tag="browser-zoom"
						>
							{Math.round(pageZoom * 100)}%
						</Button>
					</Tooltip>
				)}
				<div className="relative min-w-0 grow">
					{/* SITE-INFO, INSIDE THE FIELD'S LEFT EDGE (the frozen design brief
				    places the security/origin register there, not as a toolbar
				    button): a read-only mark, so it is a labelled span the tooltip
				    can hang from - never a button, because pressing it does nothing
				    and a control that does nothing misleads. Its tooltip opens
				    above the field like Back/Reload's, over empty chrome, so the
				    native page view cannot cover it. The field's own left padding
				    makes room for it. */}
					<Tooltip content={siteInfoLabel} side="top">
						{/* Keyboard-reachable WITHOUT becoming a control (m1/U2): tabIndex
					    makes the mark a Tab stop so its tooltip - the origin in words -
					    is reachable without a pointer (Radix opens on focus), while
					    role/absence of any handler keep it read-only: it takes focus
					    only to be read, and pressing keys on it does nothing. */}
						<span
							role="img"
							// biome-ignore lint/a11y/noNoninteractiveTabindex: focus is taken only to be READ (the tooltip is the origin in words); the mark has no action, and a button that does nothing would mislead.
							tabIndex={0}
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

					{/* NO VISIBLE TOOLTIP ON THIS FIELD (design D-PR9, UX U10). The field sits
				    directly above the content rect, and every placement of a DOM tooltip
				    that clears the chrome band (below the field) lands INSIDE the rect
				    the native page view covers: `shared/browser-view-policy.ts` states
				    that a `WebContentsView` paints above all DOM, so with a page showing
				    the panel would be invisible, and a headless `capturePage` frame
				    (which excludes the view) cannot show that. The alternatives are worse:
				    above the field it covers the active tab's title (measured in the round-1
				    re-capture), and hiding the view on every hover flashes the page. The
				    chord copy stays machine-readable through `aria-keyshortcuts`, the
				    field is labelled "Address", and the Back, Reload and tab tooltips
				    (all over empty chrome, above the content rect) still show their
				    chords. `scripts/browser-chord-renderer.test.mjs` pins that no tooltip
				    wraps this field. */}
					<Input
						ref={setInputEl}
						aria-keyshortcuts={address.aria}
						value={value}
						disabled={disabled}
						// Combobox semantics: DOM focus stays here and the active row is
						// announced through aria-activedescendant. `aria-autocomplete="both"`
						// states the two affordances that actually exist: an inline selected
						// suffix and an in-flow list.
						role="combobox"
						aria-autocomplete="both"
						aria-expanded={listVisible}
						aria-controls={
							listVisible && suggestions.candidates.length > 0
								? listId
								: undefined
						}
						aria-describedby={
							listVisible && suggestions.candidates.length === 0
								? noticeId
								: undefined
						}
						aria-activedescendant={
							activeIndex >= 0 && suggestions.candidates[activeIndex]
								? optionId(activeIndex)
								: undefined
						}
						// Addresses are machine text and stay LTR in an RTL chrome; a URL
						// reversed by the bidi algorithm is a different string.
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
						// Only while the tab has nothing to show: the moment it commits, the
						// live value replaces this and the placeholder is gone.
						placeholder={
							loading && !live ? (pendingUrl ?? undefined) : undefined
						}
						data-tour-tag="browser-address"
						data-address-editing={editing ? "true" : "false"}
						data-address-loading={autocomplete.loading ? "true" : "false"}
						data-address-suppressed={suppressed ? "true" : "false"}
						data-address-candidates={String(suggestions.candidates.length)}
						// Offset 1, not the global 2 (design D-PR4): the toolbar's `py-1` + `gap-1`
						// is exactly the global ring's offset + width, so Cmd+L (now the routine
						// way to focus this field) drew the ring flush against the strip rule,
						// the toolbar rule and the Approvals border. `!` because the global ring
						// rule is unlayered and outranks a utility; `Input` `sm` does the same.
						className={cn(
							"pr-7 pl-8 focus-visible:outline-offset-1!",
							editing && "font-mono text-mono-sm",
						)}
					/>
					{/* THE IN-FIELD LOADING SPINNER (brief 2.4: "in-field spinner + the
				    omnibox placeholder showing the destination"). The field's `pr-7`
				    already reserved this slot and nothing occupied it, so the whole
				    loading signal lived in the strip - which a user looking at the
				    field they just typed into does not see. It is a read-only mark,
				    not a control: `pointer-events-none` and `aria-hidden`, because
				    the strip's own per-tab spinner and the stop button's
				    "Stop loading" label are what carry the state for a screen
				    reader. Hidden while the field is being edited so it never sits
				    over the caret. */}
					{loading && !editing && (
						<span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">
							<Spinner size="xs" />
						</span>
					)}
				</div>
				{/* The quiet icon still needs a sighted name. End-aligned/top keeps
                this shared tooltip in chrome, not under the native page view. */}
				<div className="relative shrink-0">
					<Tooltip
						side="top"
						align="end"
						content={t("ui.browser.chrome.approvals")}
					>
						<Button
							ref={triggerRef}
							variant={waitingCount > 0 ? "outline" : "ghost"}
							size={waitingCount > 0 ? "sm" : "icon-sm"}
							onClick={onOpenApprovals}
							disabled={disabled}
							// `pr-5` so the badge, which sits over the control's top-right corner, never
							// covers the label (§5.1). `pr-4` cleared one digit by 16px and TWO by
							// only ~6px, and two is the reachable maximum (the queue cap is 16), so
							// the reserve is sized for the worst case rather than the common one
							// (design round 3, D17: at two digits the badge's left arc came within 6px
							// of the last glyph of `Approvals`).
							className={waitingCount > 0 ? "pr-5" : undefined}
							aria-label={
								waitingCount > 0
									? t("ui.browser.browser_url_bar.approvals_waiting", {
											count: waitingCount,
										})
									: t("ui.browser.chrome.approvals")
							}
							data-tour-tag="browser-approvals"
						>
							<ShieldCheck aria-hidden className="size-3.5" />
							{waitingCount > 0 &&
								t("ui.browser.browser_approvals_dock.approvals")}
						</Button>
					</Tooltip>
					{waitingCount > 0 && (
						// POSITION IS THE OPERATOR'S — "at the corner of the button" — but it no
						// longer paints OUTSIDE the surface (design round 2, D3). It used to sit on
						// the control's outer corner (`-translate-y-1/2 translate-x-1/2`), which
						// put 7px of it past the bar's own `px-2` box; the Approvals control is
						// the bar's last element and that box is the window's right edge, so in
						// the running app the far arc of the circle was outside the window and
						// only the numeral survived (measured in situ at 1380x868: the fill
						// reached the frame's last pixel column). The offset is inward now, and
						// the ring names the ground behind the badge so the overlap reads as an
						// object on top of the control rather than a notch cut out of its stroke.
						// `rounded-full` and `tabular-nums` so the count does not change width as
						// it is decided down.
						<span className="pointer-events-none absolute -top-1.5 -right-1.5">
							<Badge
								variant="attention"
								shape="pill"
								size="count"
								className="ring-2 ring-canvas"
								data-tour-tag="browser-approvals-badge"
							>
								{countLabel(waitingCount)}
							</Badge>
						</span>
					)}
				</div>
			</div>
			{/*
			 * THE ALTERNATIVES ARE IN FLOW, not a dropdown. The page is a native
			 * `WebContentsView`, so a `position: fixed`/portal list would paint UNDER it;
			 * this sibling is measured into the surface's content rectangle by the same
			 * ResizeObserver as every other chrome row, and the page starts below it.
			 *
			 * NO TAB STOP, NO FOCUS TRAP: DOM focus stays in the input, the active row
			 * is exposed through `aria-activedescendant`, and rows commit on click with
			 * `onMouseDown` preventing the blur that would otherwise dismiss the list.
			 */}
			{listVisible && (
				<div
					className="border-control border-b bg-elevated"
					data-tour-tag="browser-address-suggestions"
				>
					<div
						id={listLabelId}
						className="truncate border-hairline border-b px-3 py-1 text-meta text-ink-muted"
					>
						{t("ui.browser.browser_url_bar.address_suggestions_label")}
					</div>
					{suggestions.candidates.length > 0 ? (
						<>
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
								{suggestions.candidates.map((candidate, index) => (
									<AddressSuggestionRow
										key={candidate.url}
										candidate={candidate}
										active={index === activeIndex}
										optionId={optionId(index)}
										onActivate={() => commit(candidate.url)}
									/>
								))}
							</div>
						</>
					) : (
						<div
							id={noticeId}
							className="px-3 py-2 text-body-sm text-ink-muted"
						>
							{listNotice}
						</div>
					)}
				</div>
			)}
			{/* Polite and announcement-only: the list itself is described by its own
			    label, and a count per keystroke is the spam the proposal forbids. */}
			{/* biome-ignore lint/a11y/useSemanticElements: a politer live region is a role=status span; <output> is a form-result element with different semantics. */}
			<span className="sr-only" role="status" aria-live="polite">
				{" "}
				{announcement}
			</span>
		</>
	);
};
