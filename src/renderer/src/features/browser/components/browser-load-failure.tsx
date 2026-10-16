import { Button } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { AlertTriangle } from "lucide-react";
import type { FC } from "react";
import type { LoadFailureView } from "../hooks/use-browser-chrome";

/**
 * What a failed navigation says, in the app's own chrome.
 *
 * Design: docs/design/ui-browser-tab.md 11.3 (the native view paints above all DOM),
 * 7.3 (a restored or retried load is a fresh navigation), and design round 1, D1.
 *
 * WHY THIS CANNOT BE THE PAGE'S OWN ERROR. A refused main-frame load leaves
 * Chromium's own surface in the view — blank, because Electron ships no error page
 * — so before this the user saw an empty white rectangle with a working address bar
 * and no way to tell a failure from a successfully loaded empty page, while the host
 * knew the code and the description all along. The reason is therefore painted HERE,
 * by the app, and the view is hidden while this is on screen (the same
 * hide-and-restore lever the overlay policy uses).
 *
 * WHY THE SENTENCE IS MAPPED AND THE CODE IS SHOWN. The raw net error is what a bug
 * report needs and it is also unreadable, so both are on screen: a sentence naming
 * what the user might do about it, and the machine's own words beneath it in
 * monospace. Where no sentence exists the panel says the one thing that is always
 * true rather than inventing a cause.
 *
 * WHY THE ADDRESS IS NOT REPEATED AS A CONTROL. The URL bar above is still holding
 * the attempted address and is still editable — that is the design's rule for the
 * bar (6.1), and focus-stealing a second copy of the address into this panel would
 * be a second place to edit the same value. The panel says where it is instead.
 */

// The net-error code is stable; the explanation follows the current language.
const failureSentences = (): Record<string, string> => ({
	ERR_NAME_NOT_RESOLVED: t(
		"ui.browser.browser_load_failure.that_address_does_not_resolve_check_the",
	),
	ERR_CONNECTION_REFUSED: t(
		"ui.browser.browser_load_failure.the_site_refused_the_connection_it_may",
	),
	ERR_CONNECTION_TIMED_OUT: t(
		"ui.browser.browser_load_failure.the_site_did_not_answer_in_time",
	),
	// THE RESTORE BOUNDARY'S OWN MARK (round-1 U3/D2): `host.ts` records this
	// description when a hydration the app started at relaunch never committed a
	// page and its bounded wait expired. That IS the quiet timeout, so it shares
	// the sentence above rather than falling to the generic one; a refusal the
	// network could name keeps its own code (the restore fallback never overwrites
	// one), and the parenthetical stays in the machine line for a bug report.
	"ERR_FAILED (restore)": t(
		"ui.browser.browser_load_failure.the_site_did_not_answer_in_time",
	),
	ERR_EMPTY_RESPONSE: t(
		"ui.browser.browser_load_failure.the_site_closed_the_connection_without_sending",
	),
	ERR_CONNECTION_RESET: t(
		"ui.browser.browser_load_failure.the_connection_was_reset_before_the_page",
	),
	ERR_INTERNET_DISCONNECTED: t(
		"ui.browser.browser_load_failure.this_machine_is_not_connected_to_the",
	),
	ERR_ADDRESS_UNREACHABLE: t(
		"ui.browser.browser_load_failure.that_address_is_not_reachable_from_this",
	),
	ERR_CERT_DATE_INVALID: t(
		"ui.browser.browser_load_failure.the_site_s_certificate_has_expired_or",
	),
	ERR_CERT_AUTHORITY_INVALID: t(
		"ui.browser.browser_load_failure.the_site_s_certificate_is_not_from",
	),
	ERR_SSL_PROTOCOL_ERROR: t(
		"ui.browser.browser_load_failure.the_secure_connection_could_not_be_established",
	),
});

/** The sentence for one refusal, or the one that is true of all of them. */
export function loadFailureSentence(description: string): string {
	return (
		failureSentences()[description] ??
		t("ui.browser.browser_load_failure.the_page_could_not_be_loaded")
	);
}

export interface BrowserLoadFailureProps {
	failure: LoadFailureView;
	onRetry: () => void;
}

export const BrowserLoadFailure: FC<BrowserLoadFailureProps> = ({
	failure,
	onRetry,
}) => {
	useI18nLocale();
	return (
		<div
			className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center"
			data-tour-tag="browser-load-failure"
		>
			<AlertTriangle aria-hidden className="size-6 text-warning" />
			<p className="text-title text-ink">
				{t("ui.browser.browser_load_failure.couldn_t_load_this_page")}
			</p>
			{/* THE SKIP IS THE PRODUCT'S RULE, SO THE PRODUCT SAYS IT (UX round 1, U2):
			    a tab that is still failed at quit is not restored next launch, and until
			    this line the only record of that rule was a `[browser]` log line. It sits
			    on the panel that owns the moment the user meets the failure, phrased as
			    the state it describes. */}
			<p className="max-w-lg text-body-sm text-ink-muted">
				{loadFailureSentence(failure.description)}{" "}
				{t(
					"ui.browser.browser_load_failure.try_again_or_correct_the_address_in",
				)}
			</p>
			{/* The raw refusal, in machine voice and on its own line: it is what a bug
			    report needs, and it is the one part of this panel that is not a
			    paraphrase. */}
			<p
				className="max-w-lg truncate font-mono text-mono-sm text-ink-dim"
				title={failure.url}
			>
				{failure.description} {failure.url}
			</p>
			<Button
				variant="primary"
				size="sm"
				onClick={onRetry}
				data-tour-tag="browser-load-failure-retry"
			>
				{t("ui.browser.browser_load_failure.try_again")}
			</Button>
		</div>
	);
};
