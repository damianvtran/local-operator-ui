import { Button } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { KeyRound, X } from "lucide-react";
import type { FC } from "react";
import { useEffect, useRef, useState } from "react";
import {
	PASSKEY_NOTICE_TTL_MS,
	type PasskeyNoticeView,
} from "../../../../../shared/browser-passkey-notice";

/**
 * Recovery for a pending or NotAllowed passkey request. A configured device-bound
 * authenticator does not make a user's synced/manager credentials available.
 * Design: docs/design/browser-challenges-and-passkeys.md section 3.6.
 *
 * WHY A BAND AND NOT A DIALOG. The chooser (`browser-webauthn-dialog.tsx`) is a
 * modal because it asks a question with a deadline. This is a fact the user can
 * act on or ignore, and a modal would also have to suppress the native page view
 * to be visible at all. It sits in the same strip as the file-transfer row for the
 * reason that row gives: it is outside the page rectangle, so it is the one place
 * a notice is reliably visible, and it takes no focus (the page keeps whatever
 * the user was doing; nothing here steals a keystroke).
 *
 * WHAT IT MAY CLAIM. Pending and rejected requests have distinct copy.
 * NotAllowedError cannot distinguish a native cancellation from an unavailable
 * credential, so it offers optional recovery, never a diagnosis or an alert.
 * Opening externally does not transfer the embedded browser's login session.
 * The site shown is the requesting FRAME's
 * origin as main read it, never a string from the page; a request from an embedded
 * frame, or from an agent-driven tab, says so.
 *
 * THE ACTIONS. "Open in system browser" opens the tab's page through main's
 * vetted door. On an AGENT tab's notice the primary action is "Continue in your
 * own tab": password-manager extensions cannot open their passkey prompt inside
 * an agent-driven tab (main refuses extension subframes there so an agent can
 * never drive one), so the recovery is the same page in a tab the user owns, on
 * the same profile, after which the agent can carry on signed in. Neither action
 * sends a URL (the bridge carries a tab id and the notice's identity only), so
 * this component cannot be the place a URL is chosen.
 */

export interface BrowserPasskeyNoticeProps {
	notice: PasskeyNoticeView | null | undefined;
	onOpen: (notice: PasskeyNoticeView) => void;
	onDismiss: (notice: PasskeyNoticeView) => void;
	/** Opens the agent tab's page in a new user tab. Rendered only when the
	 * notice is an agent tab's: a user tab already runs extension frames.
	 * Resolves true once the user's tab exists. */
	onContinueInUserTab?: (notice: PasskeyNoticeView) => Promise<boolean>;
	/** Where focus rests after a successful continue (review U2). The new tab is
	 * activated, this notice unmounts, and the button that held focus goes with
	 * it, which dropped a keyboard user to <body>. Called only when focus was on
	 * this notice or has already fallen to <body>, so a user who moved on to the
	 * composer meanwhile keeps their place. */
	restFocus?: () => void;
	/** Opens lop://extensions in the current tab (review U4: the extension
	 * route gets a control, not just words). Omitted when the active tab is not
	 * the user's, since the browser's own pages open only in user tabs. */
	onOpenExtensions?: () => void;
	/** An installed, turned-on password manager's name (review U10): the hint
	 * then says to open and sign in to it rather than to add one. */
	passwordManagerName?: string | null;
}

/** `host[:port]` of an origin. The scheme is dropped because WebAuthn only runs
 * in a secure context, so it adds length and no information; a value that does
 * not parse is shown as given rather than hidden. */
export function siteOf(origin: string): string {
	try {
		return new URL(origin).host || origin;
	} catch {
		return origin;
	}
}

export const BrowserPasskeyNotice: FC<BrowserPasskeyNoticeProps> = ({
	notice,
	onOpen,
	onDismiss,
	onContinueInUserTab,
	restFocus,
	onOpenExtensions,
	passwordManagerName,
}) => {
	useI18nLocale();
	// The click's in-flight state (review R1/U4). Main refuses a second continue
	// for the same tab too; disabling here keeps the double click from reaching
	// it and from toasting that refusal.
	const [continuing, setContinuing] = useState(false);
	const rootRef = useRef<HTMLOutputElement | null>(null);
	// Aged on THIS clock too: main stops projecting a notice at the same TTL, but
	// nothing pushes a projection at the moment of expiry, so without a timer an
	// idle strip would keep describing a request from minutes ago.
	const [expired, setExpired] = useState(false);
	const at = notice?.at;
	useEffect(() => {
		setExpired(false);
		if (at === undefined) return;
		const remaining = Math.max(0, at + PASSKEY_NOTICE_TTL_MS - Date.now());
		const timer = setTimeout(() => setExpired(true), remaining);
		return () => clearTimeout(timer);
	}, [at]);

	if (!notice || expired) return null;
	const who =
		notice.ownerKind === "agent"
			? notice.embedded
				? "agentFrame"
				: "agent"
			: notice.embedded
				? "userFrame"
				: "user";
	const continueInUserTab =
		notice.ownerKind === "agent" ? onContinueInUserTab : undefined;
	const startContinue = (callback: NonNullable<typeof continueInUserTab>) => {
		if (continuing) return;
		setContinuing(true);
		void callback(notice)
			.then((continued) => {
				if (!continued) return;
				// Read after the await: by now the switch has usually unmounted this
				// notice, and focus has fallen to <body>.
				const active = document.activeElement;
				if (
					!active ||
					active === document.body ||
					rootRef.current?.contains(active)
				)
					restFocus?.();
			})
			.catch(() => {})
			// A no-op once unmounted; on a refusal it re-enables the button.
			.finally(() => setContinuing(false));
	};

	return (
		<output
			ref={rootRef}
			aria-live="polite"
			aria-label={t("ui.browser.browser_passkey_notice.passkey_request")}
			data-tour-tag="browser-passkey-notice"
			className="flex flex-wrap items-center gap-x-3 gap-y-2 border-control border-b bg-surface px-3 py-1.5"
		>
			<KeyRound aria-hidden className="size-4 shrink-0 text-ink-muted" />
			<p className="min-w-0 grow basis-64 text-body-sm text-ink">
				{t(
					notice.outcome === "not-allowed"
						? "ui.browser.browser_passkey_notice.not_allowed"
						: "ui.browser.browser_passkey_notice.message",
					{ who, site: siteOf(notice.origin) },
				)}{" "}
				{/* D3: ONE hint. With the Extensions action present the recovery
				    route replaces the generic "usual browser or password manager"
				    sentence; the system-browser button still offers that route. */}
				<span className="text-ink-muted">
					{continueInUserTab
						? t("ui.browser.browser_passkey_notice.agent_explanation")
						: !onOpenExtensions
							? t("ui.browser.browser_passkey_notice.explanation")
							: passwordManagerName
								? t("ui.browser.extensions.passkey_recovery_installed", {
										name: passwordManagerName,
									})
								: t("ui.browser.extensions.passkey_recovery")}
				</span>
			</p>
			<div className="ml-auto flex shrink-0 items-center gap-1">
				{onOpenExtensions && (
					<Button
						variant="outline"
						size="sm"
						onClick={onOpenExtensions}
						data-tour-tag="browser-passkey-notice-extensions"
					>
						{t("ui.browser.extensions.passkey_open_extensions")}
					</Button>
				)}
				{continueInUserTab && (
					<Button
						variant="outline"
						size="sm"
						onClick={() => startContinue(continueInUserTab)}
						disabled={continuing}
						aria-busy={continuing || undefined}
						data-tour-tag="browser-passkey-notice-continue"
					>
						{t("ui.browser.browser_passkey_notice.continue_in_own_tab")}
					</Button>
				)}
				<Button variant="ghost" size="sm" onClick={() => onOpen(notice)}>
					{t("ui.browser.browser_passkey_notice.open_in_system_browser")}
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={t("ui.browser.browser_passkey_notice.dismiss")}
					onClick={() => onDismiss(notice)}
				>
					<X aria-hidden className="size-3.5" />
				</Button>
			</div>
		</output>
	);
};
