import {
	consentClickTarget,
	noteConsentAttention,
} from "@shared/browser-consent-attention";
/**
 * The sidebar's browser notifications: one row per thing an agent's browser tab
 * is waiting on the user for.
 *
 * WHY (operator report 2026-11-15, "the browser is stealing the view"): a
 * password manager's prompt in an agent's tab used to switch the operator into
 * the browser from wherever he was. Waits are now listed here instead, and "the
 * user can then decide when they're able to interact with that". Rendering this
 * list moves nothing; a row's CLICK is the only thing that does
 * (`openBrowserAttention`), landing on the conversation's browser pane (or the
 * browser route for a tab no conversation owns) with the prompt visible.
 *
 * NOTHING RENDERS WITHOUT A ROW, so the sidebar's measured spacing (the 16px tier
 * between the destinations and the chat list) is untouched in the ordinary case.
 * The row shape is the destinations' own (`rowBase` in `sidebar-navigation.tsx`:
 * 32px tall, 8px radius, `bg-row-hover`, `text-body-sm`) on one line, so the
 * list reads as part of the sidebar rather than a banner on top of it. The
 * approvals corner popup and its badge stay inside the Browser view: these rows
 * are a door to them, not a second place to answer.
 */
import {
	type BrowserAttentionRow,
	attentionArrivals,
	openBrowserAttention,
} from "@shared/browser-user-attention";
import { t } from "@shared/i18n";
import { isolateLtr } from "@shared/i18n/isolate-ltr";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { AppWindow, KeyRound, ShieldQuestion } from "lucide-react";
import { type FC, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBrowserAttention } from "../hooks/use-browser-attention";
import { requesterLabel } from "./browser-consent-request";

/** The row's title: what is needed. */
export function attentionNeedLabel(row: BrowserAttentionRow): string {
	switch (row.kind) {
		case "passkey":
			return t("ui.browser.attention.passkey");
		case "popup":
			return t("ui.browser.attention.popup");
		case "site-access":
			return t("ui.browser.attention.site_access");
	}
}

/** The site as a host (the origin's scheme is noise in a 220px row), or the
 * fallback for a tab with no web address yet. Isolated LTR: a host name inside
 * an RTL sentence must not reorder. */
export function attentionSiteLabel(row: BrowserAttentionRow): string {
	if (!row.origin) return t("ui.browser.attention.no_site");
	try {
		return isolateLtr(new URL(row.origin).host);
	} catch {
		return isolateLtr(row.origin);
	}
}

/**
 * How many rows the sidebar draws before folding the rest into one "more" row.
 *
 * The rows share the column with the destinations and the chat list, and the
 * column never scrolls as a whole (`data-sidebar-shell`), so an uncapped list
 * — twelve pending approvals is a state the badge stories already draw — would
 * squeeze the chat list to nothing.
 *
 * TWO, NOT THREE (PR #1933 design review round 1, D1): with three two-line rows
 * the section measured ~178px at a 680px preview and left the chat list one
 * row, and a custody hold has no timer, so that squeeze could last as long as an
 * agent waits. Two single-line rows at the destinations' 32px pitch, plus the
 * heading and the fold, come to ~121px (`ATTENTION_SECTION_MAX_PX`), under a
 * quarter of the 600px minimum window height (`WINDOW_MIN_HEIGHT`).
 */
export const MAX_ATTENTION_ROWS = 2;

/**
 * The section's designed worst-case height, derived from the tokens it uses, so
 * the test can hold it to the quarter-of-the-sidebar budget: `pb-2` (8) +
 * heading (`text-meta` 12px × 1.45 line-height + `pb-1` 4 = 21.4) + two `h-8`
 * rows (64) + the fold `h-6` (24) + two `gap-0.5` (4) = 121.4px. The section's
 * `max-h-[25dvh]` is the backstop if text zoom ever grows it past that.
 */
export const ATTENTION_SECTION_MAX_PX = 8 + 12 * 1.45 + 4 + 2 * 32 + 24 + 2 * 2;

const ICONS = {
	passkey: KeyRound,
	popup: AppWindow,
	"site-access": ShieldQuestion,
} as const;

/** The row's three parts, as both the visible line and the names read aloud use
 * them. */
function rowParts(
	row: BrowserAttentionRow,
	sessions: Parameters<typeof requesterLabel>[1],
) {
	return {
		need: attentionNeedLabel(row),
		site: attentionSiteLabel(row),
		session: requesterLabel(row.sessionId, sessions, { short: true }),
	};
}

/**
 * The row's accessible name. A passkey hold says the agent is PAUSED (U4): that
 * is the fact that sets the urgency — the agent cannot continue until the user
 * answers — while a held popup or an approval leaves the agent free to work on.
 */
export function attentionOpenLabel(
	row: BrowserAttentionRow,
	parts: { need: string; site: string; session: string },
): string {
	return row.kind === "passkey"
		? t("ui.browser.attention.open_label_paused", parts)
		: t("ui.browser.attention.open_label", parts);
}

/** The live region's line for a row that just arrived (U4). */
export function attentionAnnouncement(
	row: BrowserAttentionRow,
	parts: { need: string; site: string; session: string },
): string {
	return row.kind === "passkey"
		? t("ui.browser.attention.announce_paused", parts)
		: t("ui.browser.attention.announce", parts);
}

/**
 * A polite live region that reads out a wait when it ARRIVES (PR #1933 round 1,
 * U4). Mounted by the sidebar in BOTH its forms — the collapsed rail shows only
 * the badge, and a screen-reader user there needs the news just as much — and
 * always rendered, even with nothing waiting: a live region only announces
 * changes to a node that was already in the tree. `sr-only` is absolutely
 * positioned, so it is not a flex item and adds no gap to the column.
 */
export const BrowserAttentionAnnouncer: FC = () => {
	const { rows } = useBrowserAttention();
	const sessions = useCanonicalSessionsStore((state) => state.sessions);
	const seen = useRef<ReadonlySet<string> | null>(null);
	const [announcement, setAnnouncement] = useState("");
	useEffect(() => {
		const { arrivals, seen: next } = attentionArrivals(seen.current, rows);
		seen.current = next;
		// The newest arrival is the one the user has not heard; several at once
		// (a burst of approvals) would be noise read in full, and the badge and
		// the rows carry the rest.
		const newest = arrivals.at(-1);
		if (newest)
			setAnnouncement(
				attentionAnnouncement(newest, rowParts(newest, sessions)),
			);
	}, [rows, sessions]);
	return (
		<span
			data-browser-attention-announcer=""
			className="sr-only"
			aria-live="polite"
			aria-atomic="true"
		>
			{announcement}
		</span>
	);
};

export const BrowserAttentionRows: FC = () => {
	const { rows } = useBrowserAttention();
	const sessions = useCanonicalSessionsStore((state) => state.sessions);
	const setActiveSession = useCanonicalSessionsStore(
		(state) => state.setActiveSession,
	);
	const setBrowserPaneOpen = useUiPreferencesStore(
		(state) => state.setBrowserPaneOpen,
	);
	const navigate = useNavigate();
	if (rows.length === 0) return null;

	const open = (row: BrowserAttentionRow) =>
		openBrowserAttention(row, {
			target: (sessionId) => consentClickTarget(sessionId, sessions),
			// An older main (or a missing bridge) answers nothing: treat that as
			// "not opened", so the view does not move to a tab nobody brought up.
			openTab: async (tabId) =>
				(await window.api?.browser?.openUserAttention?.(tabId)) === true,
			noteConsent: noteConsentAttention,
			setActiveSession,
			setBrowserPaneOpen,
			navigate,
		});

	return (
		<section
			data-browser-attention=""
			aria-label={t("ui.browser.attention.heading")}
			className="flex max-h-[25dvh] shrink-0 flex-col overflow-y-auto px-2 pb-2"
		>
			<h3 className="truncate px-2 pb-1 font-medium text-ink-dim text-meta uppercase tracking-wide">
				{t("ui.browser.attention.heading")}
			</h3>
			<ul className="flex flex-col gap-0.5">
				{rows.slice(0, MAX_ATTENTION_ROWS).map((row) => {
					const Icon = ICONS[row.kind];
					const parts = rowParts(row, sessions);
					return (
						<li key={row.key}>
							{/*
							 * ONE LINE AT THE DESTINATIONS' 32px PITCH (D1). The need leads;
							 * then the conversation BEFORE the site (D2) as separate spans,
							 * so a long host truncates before the conversation's name does,
							 * and no format string has to fix an order per locale. The
							 * `title` carries all three for a pointer user when the 220px
							 * column cuts them; the accessible name carries them too.
							 */}
							<button
								type="button"
								data-browser-attention-row={row.kind}
								aria-label={attentionOpenLabel(row, parts)}
								title={`${parts.need} — ${parts.session} · ${parts.site}`}
								onClick={() => void open(row)}
								className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-start text-ink-muted transition-colors duration-fast ease-out-quart hover:bg-row-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
							>
								<Icon
									size={16}
									aria-hidden="true"
									className="shrink-0 text-accent"
								/>
								<span className="min-w-0 max-w-[60%] shrink-0 truncate text-body-sm text-ink">
									{parts.need}
								</span>
								<span
									aria-hidden="true"
									className="flex min-w-0 flex-1 items-baseline text-meta text-ink-dim"
								>
									<span className="min-w-0 shrink truncate">
										{parts.session}
									</span>
									{/* Padding, not spaces: a flex item's edge whitespace collapses, which
									    drew "Aida·login…" run together (measured in Storybook). */}
									<span className="shrink-0 px-1">·</span>
									<span className="min-w-0 shrink-[4] truncate">
										{parts.site}
									</span>
								</span>
							</button>
						</li>
					);
				})}
				{rows.length > MAX_ATTENTION_ROWS && (
					<li>
						<button
							type="button"
							data-browser-attention-more=""
							onClick={() => navigate("/browser")}
							className="flex h-6 w-full items-center rounded-md px-2 text-start text-meta text-ink-dim transition-colors duration-fast ease-out-quart hover:bg-row-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
						>
							{t("ui.browser.attention.more", {
								count: rows.length - MAX_ATTENTION_ROWS,
								countText: String(rows.length - MAX_ATTENTION_ROWS),
							})}
						</button>
					</li>
				)}
			</ul>
		</section>
	);
};
