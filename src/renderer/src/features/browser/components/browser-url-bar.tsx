import { Badge, Button, Input, Tooltip } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import {
	ArrowLeft,
	ArrowRight,
	FolderOpen,
	Loader2,
	RotateCw,
	ShieldCheck,
	X,
} from "lucide-react";
import type { FC, KeyboardEvent, Ref } from "react";
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
	if (!recent) return "Open downloads folder";
	return recent.count > 1
		? `Open downloads folder — ${recent.name} was the newest saved there (${recent.count} this session)`
		: `Open downloads folder — ${recent.name} was saved there`;
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
	onOpenApprovals,
	waitingCount,
	triggerRef,
	downloadsDir,
	downloadsRecent,
	onOpenDownloads,
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
						aria-label="Open downloads folder"
						onClick={onOpenDownloads}
						data-tour-tag="browser-downloads-folder"
					>
						<FolderOpen aria-hidden className="size-4" />
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
			    repeating it is noise rather than help. The dock it opens explains what
			    the count means. */}
			<div className="relative shrink-0">
				<Button
					ref={triggerRef}
					variant="outline"
					size="sm"
					onClick={onOpenApprovals}
					disabled={disabled}
					// `pr-5` so the badge, which sits over the control's top-right corner, never
					// covers the label (§5.1). `pr-4` cleared one digit by 16px and TWO by
					// only ~6px, and two is the reachable maximum (the queue cap is 16), so
					// the reserve is sized for the worst case rather than the common one
					// (design round 3, D17: at two digits the badge's left arc came within 6px
					// of the last glyph of `Approvals`).
					className="pr-5"
					aria-label={
						waitingCount > 0
							? `Approvals, ${waitingCount} waiting`
							: "Approvals"
					}
					data-tour-tag="browser-approvals"
				>
					<ShieldCheck aria-hidden className="size-3.5" />
					Approvals
				</Button>
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
							className="h-4 min-w-4 justify-center px-1 tabular-nums ring-2 ring-canvas"
							data-tour-tag="browser-approvals-badge"
						>
							{waitingCount}
						</Badge>
					</span>
				)}
			</div>
		</div>
	);
};
