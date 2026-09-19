import { Button } from "@shared/components/ui";
import { AlertTriangle, Download, X } from "lucide-react";
import type { FC } from "react";
import { useState } from "react";
import type {
	DownloadActivityView,
	DownloadNoteView,
} from "../hooks/use-browser-chrome";

/**
 * The download row: what the host is downloading, where it put it, and what it
 * refused.
 * Design: docs/design/browser-file-transfer.md §16.4 (the smallest honest surface),
 * §11.4 (no reveal from the tool), and docs/design/ui-browser-tab.md §9.2 (why this
 * lives in the strip and not over the page).
 *
 * WHY A ROW AND NOT A LIST WITH PER-FILE ACTIONS (§16.4's recommendation, which
 * this implements): the app's browser tab has no file-list UI, and adding one is a
 * second feature with its own security surface — the design doc for this tab says
 * so in as many words. What makes the capability HONEST is the pair the row
 * carries: the state (a download is happening, or one was refused) and a way for
 * the USER to open the directory it went into. Everything else about the file is
 * in the tool result the agent quotes and in `audit.jsonl`.
 *
 * WHY THE REFUSAL IS THE LOUD HALF. A saved file is a completed action and gets one
 * quiet line (branding § 7). A refusal is the opposite: it is the case where the
 * user's expectation and the host's decision disagree, and it is the only place
 * the words in `reason` (which name the class, the size or the cap) reach a human.
 * So a refusal takes `danger-wash` and an icon, and a save takes the page's own
 * ground.
 *
 * WHY IT RENDERS IN THE STRIP AND NOT IN THE BAND. The consent band's own mount is
 * driven by a pending or resolved approval (`browser-surface.tsx`), and a download
 * usually happens with no approval pending at all — so a row inside that component
 * would be invisible exactly when it is needed. It renders as a sibling row in the
 * same region, which is the region the band's own docstring describes: the chrome
 * that appears without the user's action.
 */

export interface BrowserDownloadRowProps {
	downloads: DownloadActivityView | undefined;
	/** Open the directory the host wrote into. Takes no path by design — `main`
	 * decides which one, so a renderer bug cannot point `openPath` anywhere. */
	onReveal: () => void;
}

export const BrowserDownloadRow: FC<BrowserDownloadRowProps> = ({
	downloads,
	onReveal,
}) => {
	// The newest decision is what the row speaks about when nothing is in flight.
	const latest = downloads?.notes[0] ?? null;
	const [dismissed, setDismissed] = useState<number | null>(null);
	if (!downloads || (!downloads.active && !latest)) return null;
	// Dismiss is per-decision, not per-mount: a dismissal sticks until something
	// NEW happens, which is what makes the row a notification rather than a toggle
	// the user has to keep closing. `latest.at` is the host's own timestamp, so two
	// decisions in the same millisecond still compare equal and the row stays hidden
	// only while they are genuinely the same decision.
	if (!downloads.active && latest && dismissed === latest.at) return null;

	const refusing = !downloads.active && latest?.outcome === "refused";
	const name = downloads.active ?? latest?.name ?? "";

	return (
		<output
			aria-live="polite"
			data-tour-tag="browser-download-row"
			className={
				refusing
					? "flex items-center gap-2 border-control border-b bg-danger-wash px-3 py-1.5"
					: "flex items-center gap-2 border-control border-b bg-surface px-3 py-1.5"
			}
		>
			{refusing ? (
				<AlertTriangle aria-hidden className="size-4 shrink-0 text-ink-muted" />
			) : (
				<Download aria-hidden className="size-4 shrink-0 text-ink-muted" />
			)}
			<p className="min-w-0 grow truncate text-body-sm text-ink-muted">
				{downloads.active ? (
					<>
						Downloading{" "}
						<span className="font-mono text-mono-sm">{downloads.active}</span>
						{"…"}
					</>
				) : refusing ? (
					<span>{reasonCopy(latest)}</span>
				) : (
					<>
						<span className="font-mono text-mono-sm">{name}</span>
						<span> was saved to the agent's download folder.</span>
					</>
				)}
			</p>
			<Button variant="outline" size="sm" onClick={onReveal}>
				Open folder
			</Button>
			{!downloads.active && latest && (
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Dismiss"
					onClick={() => setDismissed(latest.at)}
				>
					<X aria-hidden className="size-3.5" />
				</Button>
			)}
		</output>
	);
};

/**
 * The refusal's own sentence, as the row shows it.
 *
 * WHY THERE IS A TRANSFORM AT ALL, and it is one transform rather than a rewrite: the
 * host writes its `reason` for the TOOL RESULT, which is read on its own and read
 * next to a monospace path, so it opens with `refused:` and it wraps file names in
 * backticks — a terminal convention this app's chrome does not use (branding § 7:
 * monospace is machine voice, and a sentence about what happened is not machine
 * voice). What the row must not do is paraphrase: the words after those two marks are
 * the host's own, byte for byte, because they name the rule that fired.
 *
 * The `refused:` prefix is dropped here rather than not written by the host: the
 * tool result IS the place that word belongs (it is what tells a model the call was
 * refused rather than empty), and a second copy of the sentence written for the row
 * would be a second thing to keep true.
 */
function reasonCopy(latest: DownloadNoteView | null): string {
	if (!latest) return "";
	return latest.reason.replace(/^refused:\s*/, "").replace(/`/g, "");
}
