import {
	consentClickTarget,
	noteConsentAttention,
} from "@shared/browser-consent-attention";
import { shellCustodyHandoffs } from "@shared/browser-passkey-custody-handoff";
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
 * 8px radius, `bg-row-hover`, `text-body-sm`) with a second meta line, so the
 * list reads as part of the sidebar rather than a banner on top of it. The
 * approvals corner popup and its badge stay inside the Browser view: these rows
 * are a door to them, not a second place to answer.
 */
import {
	type BrowserAttentionRow,
	openBrowserAttention,
} from "@shared/browser-user-attention";
import { t } from "@shared/i18n";
import { isolateLtr } from "@shared/i18n/isolate-ltr";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { AppWindow, KeyRound, ShieldQuestion } from "lucide-react";
import type { FC } from "react";
import { useLocation, useNavigate } from "react-router-dom";
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
 * squeeze the chat list to nothing. Three keeps the common case (one hold, one
 * popup, one approval) fully listed; the rest are one click away in the
 * Browser view, which lists every approval.
 */
export const MAX_ATTENTION_ROWS = 3;

const ICONS = {
	passkey: KeyRound,
	popup: AppWindow,
	"site-access": ShieldQuestion,
} as const;

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
	const { pathname } = useLocation();
	if (rows.length === 0) return null;

	const open = (row: BrowserAttentionRow) =>
		openBrowserAttention(row, {
			target: (sessionId) => consentClickTarget(sessionId, sessions),
			currentView: () => {
				const store = useCanonicalSessionsStore.getState();
				return {
					pathname,
					activeSessionId: store.activeSessionId ?? null,
					activeDraftKey: store.activeDraftKey ?? null,
					browserPaneOpen: useUiPreferencesStore.getState().isBrowserPaneOpen,
				};
			},
			beginCustodyHandoff: (hold, target, current) => {
				shellCustodyHandoffs.begin(hold, target, current);
			},
			openTab: (tabId) => {
				void window.api?.browser?.openUserAttention?.(tabId);
			},
			noteConsent: noteConsentAttention,
			setActiveSession,
			setBrowserPaneOpen,
			navigate,
		});

	return (
		<section
			data-browser-attention=""
			aria-label={t("ui.browser.attention.heading")}
			className="flex shrink-0 flex-col gap-0.5 px-2 pb-2"
		>
			<h3 className="truncate px-2 pb-1 font-medium text-ink-dim text-meta uppercase tracking-wide">
				{t("ui.browser.attention.heading")}
			</h3>
			<ul className="flex flex-col gap-0.5">
				{rows.slice(0, MAX_ATTENTION_ROWS).map((row) => {
					const Icon = ICONS[row.kind];
					const need = attentionNeedLabel(row);
					const site = attentionSiteLabel(row);
					const session = requesterLabel(row.sessionId, sessions, {
						short: true,
					});
					return (
						<li key={row.key}>
							<button
								type="button"
								data-browser-attention-row={row.kind}
								aria-label={t("ui.browser.attention.open_label", {
									need,
									site,
									session,
								})}
								onClick={() => open(row)}
								className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-start text-ink-muted transition-colors duration-fast ease-out-quart hover:bg-row-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
							>
								<Icon
									size={16}
									aria-hidden="true"
									className="mt-0.5 shrink-0 text-accent"
								/>
								<span className="flex min-w-0 flex-col">
									<span className="truncate text-body-sm text-ink">{need}</span>
									<span className="truncate text-meta text-ink-dim">
										{t("ui.browser.attention.detail", { site, session })}
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
							className="flex w-full items-center rounded-md px-2 py-1 text-start text-meta text-ink-dim transition-colors duration-fast ease-out-quart hover:bg-row-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
