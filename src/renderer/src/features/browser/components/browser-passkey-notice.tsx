import { Button } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { KeyRound, X } from "lucide-react";
import type { FC } from "react";
import { useEffect, useState } from "react";
import {
	PASSKEY_NOTICE_TTL_MS,
	type PasskeyNoticeView,
} from "../../../../../shared/browser-passkey-notice";

/**
 * The passkey notice: a page in the browser asked for a passkey and this browser
 * has no provider to answer, so the page's request is probably stuck.
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
 * WHAT IT MAY CLAIM. Only what main can stand behind: a passkey request from THIS
 * origin was still unanswered after a few seconds, and this browser has no passkey
 * provider. It does not say the request failed (it did not; the page's promise is
 * untouched) and it does not say "unsupported" about Touch ID or a USB key, which
 * are unmeasured (design section 3.5). The site shown is the requesting FRAME's
 * origin as main read it, never a string from the page; a request from an embedded
 * frame, or from an agent-driven tab, says so.
 *
 * THE ONE ACTION opens the tab's page in the system browser through main's vetted
 * door. The URL is not sent from here (the bridge carries a tab id and the
 * notice's identity only), so this component cannot be the place a URL is chosen.
 */

export interface BrowserPasskeyNoticeProps {
	notice: PasskeyNoticeView | null | undefined;
	onOpen: (notice: PasskeyNoticeView) => void;
	onDismiss: (notice: PasskeyNoticeView) => void;
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
}) => {
	useI18nLocale();
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

	return (
		<output
			aria-live="polite"
			aria-label={t("ui.browser.browser_passkey_notice.passkey_request")}
			data-tour-tag="browser-passkey-notice"
			className="flex flex-wrap items-center gap-x-3 gap-y-2 border-control border-b bg-surface px-3 py-1.5"
		>
			<KeyRound aria-hidden className="size-4 shrink-0 text-ink-muted" />
			<p className="min-w-0 grow basis-64 text-body-sm text-ink">
				{t("ui.browser.browser_passkey_notice.message", {
					who,
					site: siteOf(notice.origin),
				})}{" "}
				<span className="text-ink-muted">
					{t("ui.browser.browser_passkey_notice.explanation")}
				</span>
			</p>
			<div className="ml-auto flex shrink-0 items-center gap-1">
				<Button variant="outline" size="sm" onClick={() => onOpen(notice)}>
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
