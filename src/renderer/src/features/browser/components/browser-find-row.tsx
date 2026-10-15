import { Button, Input, Tooltip } from "@shared/components/ui";
import { chordCaption } from "@shared/keymap/keymap-chord";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { BrowserChrome } from "../hooks/use-browser-chrome";

/** In flow ABOVE browser-content: native WebContentsView paints above all DOM,
 * so this is not a floating panel and never needs hide-on-hover suppression.
 * Main owns query/count and fences the tab id. Unmount on switch never restores
 * old focus: only an explicit Escape/Close may return it to the original control.
 * There is no motion to override in reduced-motion mode. */
export function BrowserFindRow({ chrome }: { chrome: BrowserChrome }) {
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
			target instanceof HTMLElement && target !== document.body ? target : null;
		// DOM focus only, never window show/raise/activation. The native key door
		// already applied window-raise.ts's guarded focus when it came from a page.
		input.current?.focus({ preventScroll: true });
		input.current?.select();
	}, [tabId]);
	if (!find) return null;
	const close = async () => {
		await chrome.pageControl(find.tabId, "close");
		if (active.current !== find.tabId) return;
		if (previous.current?.isConnected)
			previous.current.focus({ preventScroll: true });
		else await window.api?.browser.focusPage();
	};
	const step = (forward: boolean) =>
		chrome.pageControl(find.tabId, "search", find.query, forward, true);
	return (
		<div
			data-tour-tag="browser-find-row"
			className="flex shrink-0 items-center gap-2 border-control border-b bg-elevated px-2 py-1"
		>
			<Input
				ref={input}
				aria-label="Find in page"
				value={find.query}
				maxLength={4096}
				className="min-w-0 max-w-72 flex-1 focus-visible:outline-offset-1!"
				onChange={(event) =>
					void chrome.pageControl(find.tabId, "search", event.target.value)
				}
				onKeyDown={(event) => {
					if (event.nativeEvent.isComposing) return;
					if (event.key === "Escape") {
						event.preventDefault();
						event.stopPropagation();
						void close();
					} else if (event.key === "Enter") {
						event.preventDefault();
						void step(!event.shiftKey);
					}
				}}
			/>
			<output
				aria-live="polite"
				aria-atomic="true"
				className="min-w-20 text-body-sm text-ink-muted"
			>
				{find.query
					? find.matches
						? `${find.ordinal} of ${find.matches}`
						: "No matches"
					: ""}
			</output>
			<Tooltip side="top" content={`Previous match (${previousChord.glyph})`}>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Previous match"
					aria-keyshortcuts={previousChord.aria}
					disabled={!find.matches}
					onClick={() => void step(false)}
				>
					<ChevronUp aria-hidden className="size-4" />
				</Button>
			</Tooltip>
			<Tooltip side="top" content={`Next match (${nextChord.glyph})`}>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Next match"
					aria-keyshortcuts={nextChord.aria}
					disabled={!find.matches}
					onClick={() => void step(true)}
				>
					<ChevronDown aria-hidden className="size-4" />
				</Button>
			</Tooltip>
			<Tooltip side="top" content={`Close find (${closeChord.glyph})`}>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Close find"
					aria-keyshortcuts={closeChord.aria}
					onClick={() => void close()}
				>
					<X aria-hidden className="size-4" />
				</Button>
			</Tooltip>
		</div>
	);
}
