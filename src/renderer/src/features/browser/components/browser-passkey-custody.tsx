import { Button } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { Fingerprint } from "lucide-react";
import type { FC, MouseEvent } from "react";
import { useState } from "react";
import type { PasskeyCustodyView } from "../../../../../shared/browser-passkey-notice";

/**
 * The band that says an agent-driven tab is in the USER's hands for a passkey
 * prompt, and the one control that hands it back.
 * Main side and the security rules: `src/main/browser/extensions/passkey-custody.ts`.
 *
 * WHY IT EXISTS. A password manager's passkey prompt is now allowed to appear in
 * an agent tab, but only while the agent is locked out of that tab. The user
 * needs to know two things the page cannot tell them: that the prompt is theirs
 * to answer (the agent cannot see or press it), and that the agent is waiting on
 * them. Nothing here answers the prompt; the prompt itself is the page's.
 *
 * WHY "RETURN TO AGENT" IS EXPLICIT rather than automatic when the prompt
 * closes: main cannot tell a finished sign-in from a prompt the user has not got
 * to yet, and a timer would hand the tab back with the provider's frame still in
 * it. So the agent resumes when the user says so. The click's `isTrusted` goes to
 * main, which refuses a synthetic one.
 *
 * Same strip and same takes-no-focus rule as the passkey notice
 * (`browser-passkey-notice.tsx`): outside the page rectangle, polite live region.
 */
export interface BrowserPasskeyCustodyProps {
	custody: PasskeyCustodyView | null | undefined;
	onReturn: (
		custody: PasskeyCustodyView,
		trusted: boolean,
	) => Promise<void> | void;
}

export const BrowserPasskeyCustody: FC<BrowserPasskeyCustodyProps> = ({
	custody,
	onReturn,
}) => {
	useI18nLocale();
	// Main ignores a second release for the same hold; disabling keeps a double
	// click from reaching it at all.
	const [returning, setReturning] = useState(false);
	if (!custody) return null;
	const handleReturn = (event: MouseEvent<HTMLButtonElement>) => {
		if (returning) return;
		setReturning(true);
		void Promise.resolve(onReturn(custody, event.nativeEvent.isTrusted))
			.catch(() => {})
			.finally(() => setReturning(false));
	};
	return (
		<output
			aria-live="polite"
			aria-label={t("ui.browser.browser_passkey_custody.label")}
			data-tour-tag="browser-passkey-custody"
			className="flex flex-wrap items-center gap-x-3 gap-y-2 border-control border-b bg-surface px-3 py-1.5"
		>
			<Fingerprint aria-hidden className="size-4 shrink-0 text-ink-muted" />
			<p className="min-w-0 grow basis-64 text-body-sm text-ink">
				{t("ui.browser.browser_passkey_custody.message")}{" "}
				<span className="text-ink-muted">
					{t("ui.browser.browser_passkey_custody.explanation")}
				</span>
			</p>
			<div className="ml-auto flex shrink-0 items-center gap-1">
				<Button
					variant="outline"
					size="sm"
					onClick={handleReturn}
					disabled={returning}
					aria-busy={returning || undefined}
					data-tour-tag="browser-passkey-custody-return"
				>
					{t("ui.browser.browser_passkey_custody.return_to_agent")}
				</Button>
			</div>
		</output>
	);
};
