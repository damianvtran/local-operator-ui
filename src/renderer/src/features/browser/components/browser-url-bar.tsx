import { Button, Input, Tooltip } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { ArrowLeft, ArrowRight, Loader2, RotateCw, X } from "lucide-react";
import type { FC, KeyboardEvent } from "react";
import { useState } from "react";

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
 * (design 6.1's "mirroring `_BROWSER_URL_SCHEMES`"): one implementation of the
 * scheme rule, and its refusal is what the band shows.
 */

export interface BrowserUrlBarProps {
	url: string;
	/** Where the user asked to go, while the tab has not committed it. Shown as the
	 * placeholder and never as the value: see the comment on `askedFor` below. */
	pendingUrl: string | null;
	loading: boolean;
	canGoBack: boolean;
	canGoForward: boolean;
	disabled: boolean;
	onNavigate: (url: string) => void;
	onBack: () => void;
	onForward: () => void;
	onReload: () => void;
	onStop: () => void;
	onOpenSites: () => void;
	/** How many sites an agent may act on as the user, for the Sites button. */
	approvalCount: number;
}

/** `about:blank` is what a new tab starts on and is what a browser shows as an
 * EMPTY bar. Rendering the literal string would make every new tab look like it
 * had navigated somewhere. */
export function displayUrl(url: string): string {
	return url === "about:blank" ? "" : url;
}

export const BrowserUrlBar: FC<BrowserUrlBarProps> = ({
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
	onOpenSites,
	approvalCount,
}) => {
	const [draft, setDraft] = useState<string | null>(null);
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
	const live = displayUrl(url);
	// `draft === null` means "not editing". Kept as null rather than as a boolean
	// plus a string so there is no state where the flag says editing and the value
	// is stale — and so a live URL that changes while the field is pristine needs no
	// effect to be picked up: the live value IS the value.
	const value = draft ?? live;
	const editing = draft !== null;

	const commit = (): void => {
		// A blank field is not a navigation: clearing the bar and clicking away must
		// not load anything, and `next` being undefined (not editing) does nothing.
		const next = draft?.trim();
		if (next && next !== live) onNavigate(next);
		setDraft(null);
	};

	const keyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
		if (event.key === "Enter") {
			event.preventDefault();
			commit();
			return;
		}
		if (event.key === "Escape") {
			// Escape abandons the edit rather than navigating: it is the one key a
			// user reaches for when they have typed the wrong thing.
			event.preventDefault();
			setDraft(null);
		}
	};

	return (
		<div
			className="flex items-center gap-1 border-control border-b bg-canvas px-2 py-1"
			data-tour-tag="browser-url-bar"
		>
			<Tooltip content="Back">
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Back"
					disabled={disabled || !canGoBack}
					onClick={onBack}
					data-tour-tag="browser-back"
				>
					<ArrowLeft aria-hidden className="size-4" />
				</Button>
			</Tooltip>
			<Tooltip content="Forward">
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Forward"
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
				<Tooltip content="Stop loading">
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Stop loading"
						disabled={disabled}
						onClick={onStop}
						data-tour-tag="browser-stop"
					>
						<X aria-hidden className="size-4" />
					</Button>
				</Tooltip>
			) : (
				<Tooltip content="Reload">
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Reload"
						disabled={disabled}
						onClick={onReload}
						data-tour-tag="browser-reload"
					>
						<RotateCw aria-hidden className="size-4" />
					</Button>
				</Tooltip>
			)}
			<div className="relative min-w-0 grow">
				<Input
					value={value}
					disabled={disabled}
					onChange={(event) => setDraft(event.target.value)}
					onKeyDown={keyDown}
					onFocus={() => setDraft((current) => current ?? live)}
					onBlur={commit}
					spellCheck={false}
					autoComplete="off"
					aria-label="Address"
					// Only while the tab has nothing to show: the moment it commits, the
					// live value replaces this and the placeholder is gone.
					placeholder={loading && !live ? (pendingUrl ?? undefined) : undefined}
					data-tour-tag="browser-address"
					className={cn("pr-7", editing && "font-mono text-mono-sm")}
				/>
				{loading && (
					// The loading state, in the field rather than only on the reload
					// button: a page that takes ten seconds says so where the eye
					// already is.
					<Loader2
						aria-hidden
						className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 animate-spin text-ink-dim"
					/>
				)}
			</div>
			{/* No tooltip here: the button already carries a visible label, and a tooltip
			    repeating it is noise rather than help. The sheet it opens explains what
			    the count means. */}
			<Button
				variant="outline"
				size="sm"
				onClick={onOpenSites}
				disabled={disabled}
				data-tour-tag="browser-sites"
			>
				Sites
				{approvalCount > 0 && (
					<span className="text-ink-dim">{approvalCount}</span>
				)}
			</Button>
		</div>
	);
};
