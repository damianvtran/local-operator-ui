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
	LockOpen,
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
	type InlineCompletion,
	addressIntent,
	canInlineComplete,
	isGeneratedSuffixSelected,
	moveActive,
	suggestAddresses,
	usableRawAddress,
} from "../model/address-autocomplete";
import { isSecurityLoadFailure, siteInfoForUrl } from "../model/site-info";
import { useAddressOverlayMirror } from "../overlay/use-address-overlay-mirror";

/**
 * The browser's address chrome, in the two placements S4b defines.
 *
 * `popout` is the product chrome: a 37px field row painted over the tab strip
 * while raised, with the navigation controls and the page menu beside it. The
 * suggestion rows are NOT here — they are the native child at the strip's
 * width — so this component owns the input, DOM focus, IME, undo, the keys and
 * the accessible combobox, exactly as S3 established.
 *
 * `bar` is the Tier 2 fallback (design §6): an in-flow 41px row with Back,
 * Forward, Reload/Stop, Home and the field, no dock and no suggestions. One
 * component for both, so ids, order and key handling cannot drift between the
 * product and the fallback.
 *
 * THE DISPLAY RULE: the field shows the tab's LIVE url, never the requested one.
 * THE EDITING RULE: an incoming live url never overwrites a draft.
 */

export interface BrowserUrlBarProps {
	inputRef?: Ref<HTMLInputElement>;
	placement: "popout" | "bar";
	tabId: number | null;
	url: string;
	pendingUrl: string | null;
	loading: boolean;
	canGoBack: boolean;
	canGoForward: boolean;
	disabled: boolean;
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
	/** Raise seed: the printable character that opened the popout, if any. */
	seed?: string;
	selectOnMount?: boolean;
	/** One Escape / a committed navigation lowers the row. */
	onDismiss?: () => void;
	onCommitted?: () => void;
	addressScope?: AddressHistoryScope;
	addressScopeKey?: string;
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
	if (!url) return "";
	return url.replace(HTTP_SCHEME, "").replace(TRAILING_SLASH, "");
}

export const BrowserUrlBar: FC<BrowserUrlBarProps> = ({
	inputRef,
	placement,
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
	onHome,
	loadFailure = null,
	menu,
	overlayMode,
	anchor,
	seed,
	selectOnMount = false,
	onDismiss,
	onCommitted,
	addressScope = "all",
	addressScopeKey = "all",
	addressHistory,
	onStateChanged,
}) => {
	useI18nLocale();
	const [typed, setTyped] = useState<{
		tabId: number | null;
		text: string;
	} | null>(() =>
		placement === "popout" && seed !== undefined ? { tabId, text: seed } : null,
	);
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
	 * `bar` is the Tier 2 fallback (an in-flow row, no dock, no suggestions);
	 * `suspend` is the Tier 1 child-unavailable state (the field works, the list
	 * does not). Neither may fetch history it has no surface for, because a
	 * query with no presenter is work whose result nobody sees.
	 */
	const suggestionsEnabled =
		placement === "popout" &&
		overlayMode === "popout" &&
		addressHistory !== undefined;
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
		// The popout has done its job. The bar placement has nothing to close.
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
		rows: suggestions.candidates.map((candidate) => ({
			text: candidate.displayText,
			title: candidate.title ?? "",
			key: candidate.url,
		})),
		noticeKind: autocomplete.error
			? "error"
			: hint
				? "hint"
				: raw.length === 0
					? "empty"
					: "no_match",
		noticeText: listNotice,
		label: t("ui.browser.browser_url_bar.address_suggestions_label"),
		anchor,
		onCommit: (index) => {
			const candidate = suggestions.candidates[index];
			if (candidate) commit(candidate.url);
		},
		onDismiss: () => onDismiss?.(),
	});

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
	const blur = (event: FocusEvent<HTMLInputElement>): void => {
		if (!activeRef.current) return;
		autocomplete.onBlur();
		/*
		 * A NULL `relatedTarget` IS AMBIGUOUS (design §4, F6): it can be a click on
		 * the native page, a click on the child row, or the window losing
		 * activation. Main resolves the first two (page focus, child mouse-down
		 * focus-back), and a window deactivation must NOT throw the draft away. So
		 * the popout only drops the draft when focus moves to a node the document
		 * can name; the surface's own focusout decides whether that node is still
		 * inside the popout.
		 */
		if (placement === "popout" && event.relatedTarget === null) {
			// The draft survives a window deactivation, but a generated suffix is
			// not part of what the user typed: the field must show the raw draft
			// when it comes back, not a proposal nobody accepted.
			clearGenerated();
			setHint(false);
			return;
		}
		setAcceptedTarget(null);
		setDraft(null);
		clearGenerated();
		setDismissedForText(null);
		setHint(false);
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
			/*
			 * ONE STAGE in the popout (design §4). The old two-stage Escape existed
			 * to let an accepted inline suffix survive the list's dismissal, but in
			 * the popout the only commitment is Enter or a row, so there is nothing
			 * to preserve: Escape discards the draft and lowers the whole field row.
			 */
			abandon();
			onDismiss?.();
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
	// has already selected, or swap a same-length set for different URLs. Reset
	// the active row and the viewport's offset together: an active descendant
	// naming a vanished row and a scroll offset belonging to the previous set are
	// the same stale state, and the URL KEY catches swaps the count cannot.
	const candidateKey = suggestions.candidates
		.map((candidate) => candidate.url)
		.join("\n");
	// biome-ignore lint/correctness/useExhaustiveDependencies: `candidateKey` is the trigger, not a value the body reads - the URL SET changing is what must reset the selection and the scroll, and a same-length swap changes no count.
	useEffect(() => {
		// UNCONDITIONAL (review A-4): a same-length swap can leave the old index
		// inside the new range while naming a row the new query never ranked
		// there. `aria-activedescendant` would then point at a row the user never
		// saw, and Enter would commit that unseen destination. A changed SET is a
		// new list; nothing in it is selected yet.
		setActiveIndex(-1);
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

	// The raise's own focus contract (design §4): Cmd+L selects the live URL, a
	// typed seed leaves the caret after the character, and a click on the strip
	// trigger starts with the field ready rather than needing a second click.
	// biome-ignore lint/correctness/useExhaustiveDependencies: mount-only; the seed and the selection are the reason this instance was mounted.
	useLayoutEffect(() => {
		const element = inputEl.current;
		if (!element || placement !== "popout") return;
		element.focus({ preventScroll: true });
		if (seed !== undefined) {
			const end = element.value.length;
			element.setSelectionRange(end, end);
		} else if (selectOnMount) {
			element.select();
		}
	}, []);

	// Tier 1 is a fact the user must be told once, not a silent missing list.
	useEffect(() => {
		if (placement === "popout" && overlayMode === "suspend")
			setAnnouncement(
				t("ui.browser.browser_url_bar.address_suggestions_unavailable"),
			);
	}, [placement, overlayMode]);

	return (
		<div
			/* A CHROME BAND: it is the strip's own row when raised, and an in-flow
			   row only in the Tier 2 fallback. */
			data-glass-region="chrome"
			className={cn(
				"flex w-full items-center gap-1 border-control border-b bg-elevated px-2 py-1",
				placement === "popout" && "h-[37px]",
			)}
			data-tour-tag="browser-url-bar"
			data-placement={placement}
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
			<div className="relative min-w-0 grow">
				<Tooltip content={siteInfoLabel} side="top">
					<span
						role="img"
						// biome-ignore lint/a11y/noNoninteractiveTabindex: focus is taken only to be READ (the tooltip is the origin in words); the mark has no action.
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
				<Input
					ref={setInputEl}
					inputSize={placement === "popout" ? "sm" : "md"}
					aria-keyshortcuts={address.aria}
					value={value}
					disabled={disabled}
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
						overlayMode === "suspend" && placement === "popout"
							? t("ui.browser.browser_url_bar.address_suggestions_unavailable")
							: loading && !live
								? (pendingUrl ?? undefined)
								: undefined
					}
					data-tour-tag="browser-address"
					data-address-editing={editing ? "true" : "false"}
					data-address-loading={autocomplete.loading ? "true" : "false"}
					data-address-suppressed={suppressed ? "true" : "false"}
					data-address-candidates={String(suggestions.candidates.length)}
					className={cn(
						"pr-7 pl-8 focus-visible:outline-offset-1!",
						editing && "font-mono text-mono-sm",
					)}
				/>
				{loading && !editing && (
					<span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">
						<Spinner size="xs" />
					</span>
				)}
			</div>
			{menu}
			{/* THE ACCESSIBLE LIST lives in the parent and is clipped, never in flow:
			    the visual rows are the native child, which is `aria-hidden`. One
			    option per mirrored row keeps `aria-activedescendant` and the row
			    the user actually presses naming the same candidate. */}
			{listVisible && suggestions.candidates.length > 0 && (
				<div className="sr-only" data-tour-tag="browser-address-suggestions">
					<span id={listLabelId}>
						{t("ui.browser.browser_url_bar.address_suggestions_label")}
					</span>
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
							// biome-ignore lint/a11y/useFocusableInteractive: DOM focus stays in the input; the active option is announced through aria-activedescendant.
							// biome-ignore lint/a11y/useSemanticElements: a type-to-filter combobox list cannot be a native <select>.
							<div
								key={candidate.url}
								id={optionId(index)}
								// biome-ignore lint/a11y/useSemanticElements: a type-to-filter combobox list cannot be a native <select>.
								role="option"
								aria-selected={index === activeIndex}
								data-address-suggestion
								data-address-suggestion-url={candidate.url}
							>
								{candidate.displayText}
							</div>
						))}
					</div>
				</div>
			)}
			{suggestions.candidates.length === 0 && (
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
