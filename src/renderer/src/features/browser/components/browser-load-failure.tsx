import { Button } from "@shared/components/ui";
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

const SENTENCE: Record<string, string> = {
	ERR_NAME_NOT_RESOLVED: "That address does not resolve. Check the spelling.",
	ERR_CONNECTION_REFUSED:
		"The site refused the connection. It may be down, or refusing this app.",
	ERR_CONNECTION_TIMED_OUT: "The site did not answer in time.",
	ERR_EMPTY_RESPONSE:
		"The site closed the connection without sending a response.",
	ERR_CONNECTION_RESET: "The connection was reset before the page arrived.",
	ERR_INTERNET_DISCONNECTED: "This machine is not connected to the network.",
	ERR_ADDRESS_UNREACHABLE: "That address is not reachable from this machine.",
	ERR_CERT_DATE_INVALID:
		"The site's certificate has expired or is not yet valid.",
	ERR_CERT_AUTHORITY_INVALID:
		"The site's certificate is not from an authority this app trusts.",
	ERR_SSL_PROTOCOL_ERROR: "The secure connection could not be established.",
};

/** The sentence for one refusal, or the one that is true of all of them. */
export function loadFailureSentence(description: string): string {
	return SENTENCE[description] ?? "The page could not be loaded.";
}

export interface BrowserLoadFailureProps {
	failure: LoadFailureView;
	onRetry: () => void;
}

export const BrowserLoadFailure: FC<BrowserLoadFailureProps> = ({
	failure,
	onRetry,
}) => {
	return (
		<div
			className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center"
			data-tour-tag="browser-load-failure"
		>
			<AlertTriangle aria-hidden className="size-6 text-warning" />
			<p className="text-title text-ink">Couldn't load this page</p>
			<p className="max-w-lg text-body-sm text-ink-muted">
				{loadFailureSentence(failure.description)} Try again, or correct the
				address in the bar above — it is still yours to edit.
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
				Try again
			</Button>
		</div>
	);
};
