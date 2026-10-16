import { Button, Input, Tooltip } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { chordCaption } from "@shared/keymap/keymap-chord";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { type RefObject, useEffect, useRef } from "react";
import type { BrowserChrome } from "../hooks/use-browser-chrome";

/** In flow ABOVE browser-content: native WebContentsView paints above all DOM,
 * so this is not a floating panel and never needs hide-on-hover suppression.
 * Main owns query/count and fences the tab id. Unmount on switch never restores
 * old focus: only an explicit Escape/Close may return it to the original control.
 * There is no motion to override in reduced-motion mode. */
export function BrowserFindRow({
	chrome,
	returnToPage,
}: { chrome: BrowserChrome; returnToPage?: RefObject<boolean> }) {
	useI18nLocale();
	const find = chrome.state?.pageControls?.find;
	const tabId = find?.tabId;
	const active = useRef(chrome.state?.activeTabId);
	active.current = chrome.state?.activeTabId;
	const platform = navigator.platform.toUpperCase().includes("MAC")
		? "mac"
		: "linux";
	const nextChord = chordCaption("enter", platform);
	const previousChord = chordCaption("shift+enter", platform);
	const closeChord = chordCaption("escape", platform);
	const input = useRef<HTMLInputElement>(null);
	const previous = useRef<HTMLElement | null>(null);
	useEffect(() => {
		if (tabId == null) return;
		const target = document.activeElement;
		previous.current =
			target instanceof HTMLElement &&
			target.closest(
				"[data-tour-tag=browser-route], [data-tour-tag=browser-pane]",
			)
				? target
				: null;
		// DOM focus only, never window show/raise/activation. The native key door
		// already applied window-raise.ts's guarded focus when it came from a page.
		input.current?.focus({ preventScroll: true });
		input.current?.select();
	}, [tabId]);
	if (!find) return null;
	const close = async () => {
		await chrome.pageControl(find.tabId, "close");
		if (active.current !== find.tabId) return;
		// A native-page Cmd+F must return to that page, not the app document's
		// stale activeElement (which can still be an old composer/address input).
		if (returnToPage?.current) await window.api?.browser.focusPage();
		else if (previous.current?.isConnected)
			previous.current.focus({ preventScroll: true });
		else await window.api?.browser.focusPage();
	};
	const step = (forward: boolean) =>
		chrome.pageControl(
			find.tabId,
			"search",
			input.current?.value ?? find.query,
			forward,
			true,
		);
	return (
		<div
			data-tour-tag="browser-find-row"
			className="@container/bfind flex shrink-0 flex-wrap items-center gap-2 border-control border-b bg-elevated px-2 py-1"
			onKeyDown={(event) => {
				if (event.nativeEvent.isComposing || event.key !== "Escape") return;
				event.preventDefault();
				event.stopPropagation();
				void close();
			}}
		>
			<Input
				ref={input}
				aria-label={t("ui.browser.browser_find_row.find_in_page")}
				placeholder={t("ui.browser.browser_find_row.find_in_page")}
				// A native editor draft, not a value bounced through asynchronous IPC:
				// React's controlled-value restore could otherwise lose the next key
				// before main acknowledges the previous one. Tab identity remounts it;
				// closing removes it, so drafts cannot leak across tabs/reopens.
				key={find.tabId}
				defaultValue={find.query}
				maxLength={4096}
				className="min-w-32 max-w-72 flex-1 focus-visible:outline-offset-1!"
				onChange={(event) =>
					void chrome.pageControl(find.tabId, "search", event.target.value)
				}
				onKeyDown={(event) => {
					if (event.nativeEvent.isComposing) return;
					if (event.key === "Enter") {
						event.preventDefault();
						void step(!event.shiftKey);
					}
				}}
			/>
			<output
				aria-live="polite"
				aria-atomic="true"
				className="order-1 min-w-0 max-w-full text-body-sm text-ink-muted @max-[480px]/bfind:order-2 @max-[480px]/bfind:basis-full"
			>
				{find.query
					? find.pending
						? t("ui.browser.browser_find_row.searching")
						: find.unreported
							? t(
									"ui.browser.browser_find_row.no_result_reported_press_enter_to_search_again",
								)
							: find.matches
								? t("ui.browser.browser_find_row.match_position", {
										ordinal: find.ordinal,
										matches: find.matches,
									})
								: t("ui.browser.browser_find_row.no_matches")
					: ""}
			</output>
			{/* Keep controls together; the longest recovery message yields a row in
			    a narrow pane instead of stealing the editor/Close target's width. */}
			<div className="order-2 flex shrink-0 items-center gap-2 @max-[480px]/bfind:order-1">
				<Tooltip
					side="top"
					content={t("ui.browser.browser_find_row.previous_match_shortcut", {
						shortcut: previousChord.glyph,
					})}
				>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={t("ui.browser.browser_find_row.previous_match")}
						aria-keyshortcuts={previousChord.aria}
						disabled={!find.query || find.pending}
						onClick={() => void step(false)}
					>
						<ChevronUp aria-hidden className="size-4" />
					</Button>
				</Tooltip>
				<Tooltip
					side="top"
					content={t("ui.browser.browser_find_row.next_match_shortcut", {
						shortcut: nextChord.glyph,
					})}
				>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={t("ui.browser.browser_find_row.next_match")}
						aria-keyshortcuts={nextChord.aria}
						disabled={!find.query || find.pending}
						onClick={() => void step(true)}
					>
						<ChevronDown aria-hidden className="size-4" />
					</Button>
				</Tooltip>
				<Tooltip
					side="top"
					content={t("ui.browser.browser_find_row.close_find_shortcut", {
						shortcut: closeChord.glyph,
					})}
				>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={t("ui.browser.browser_find_row.close_find")}
						aria-keyshortcuts={closeChord.aria}
						onClick={() => void close()}
					>
						<X aria-hidden className="size-4" />
					</Button>
				</Tooltip>
			</div>
		</div>
	);
}
