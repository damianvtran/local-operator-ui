import { Button } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { Fingerprint } from "lucide-react";
import type { FC, MouseEvent } from "react";
import { useState } from "react";
import type { PasskeyCustodyView } from "../../../../../shared/browser-passkey-notice";
import type { PasskeyCustodyReturnOutcome } from "../hooks/use-browser-chrome";

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
 * WHY THE COPY IS NEUTRAL. 1Password's notification frame hosts its passkey
 * prompts AND its generic "save this login?" prompt, and custody admits both, so
 * the band says "password manager prompt", never "passkey" alone (review
 * U4/D2/R4). It warns that returning with the prompt still open reloads the page
 * (main's fail-closed release, U3/D1), and it never promises the agent carries
 * on by itself: a turn that ended on the custody refusal needs asking again (U6).
 *
 * BUSY UNTIL THE HOLD IS GONE. A release that has to reload first answers
 * `reloading` at once while the band stays up until the new document commits;
 * re-enabling the button then is what invited a second press and a second
 * reload (review U2). So the button stays busy for THAT hold (`at`) until the
 * band goes away or a newer hold replaces it; a refusal re-enables it (the
 * toast says why).
 *
 * Same strip position and takes-no-focus rule as the passkey notice
 * (`browser-passkey-notice.tsx`): outside the page rectangle, polite live region.
 * The warning wash and the primary button are the register of a state that
 * BLOCKS until the user acts, so it does not read like the passive notice
 * (review D4).
 */
export interface BrowserPasskeyCustodyProps {
	custody: PasskeyCustodyView | null | undefined;
	onReturn: (
		custody: PasskeyCustodyView,
		trusted: boolean,
	) => Promise<PasskeyCustodyReturnOutcome | undefined> | undefined;
}

export const BrowserPasskeyCustody: FC<BrowserPasskeyCustodyProps> = ({
	custody,
	onReturn,
}) => {
	useI18nLocale();
	// The hold (`at`) whose return is in progress. Keyed by identity rather than
	// a boolean so a NEWER hold on the same tab starts with a live button.
	const [returningAt, setReturningAt] = useState<number | null>(null);
	if (!custody) return null;
	const returning = returningAt === custody.at;
	const handleReturn = (event: MouseEvent<HTMLButtonElement>) => {
		if (returning) return;
		const at = custody.at;
		setReturningAt(at);
		void Promise.resolve(onReturn(custody, event.nativeEvent.isTrusted))
			.then((outcome) => {
				// `reloading`: stay busy, the band leaves when the hold lifts.
				if (outcome !== "reloading") setReturningAt(null);
			})
			.catch(() => setReturningAt(null));
	};
	return (
		<output
			aria-live="polite"
			aria-label={t("ui.browser.browser_passkey_custody.label")}
			data-tour-tag="browser-passkey-custody"
			className="flex flex-wrap items-center gap-x-3 gap-y-2 border-control border-b bg-warning-wash px-3 py-1.5"
		>
			<Fingerprint aria-hidden className="size-4 shrink-0 text-warning" />
			<p className="min-w-0 grow basis-64 text-body-sm text-ink">
				<span className="font-medium">
					{t("ui.browser.browser_passkey_custody.message")}
				</span>{" "}
				{t("ui.browser.browser_passkey_custody.explanation")}
			</p>
			<div className="ml-auto flex shrink-0 items-center gap-1">
				<Button
					variant="primary"
					size="sm"
					onClick={handleReturn}
					disabled={returning}
					aria-busy={returning || undefined}
					data-tour-tag="browser-passkey-custody-return"
				>
					{returning
						? t("ui.browser.browser_passkey_custody.returning")
						: t("ui.browser.browser_passkey_custody.return_to_agent")}
				</Button>
			</div>
		</output>
	);
};
