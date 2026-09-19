import { Button } from "@shared/components/ui";
import { AlertTriangle, Download, Upload, X } from "lucide-react";
import type { FC } from "react";
import { useEffect, useState } from "react";
import type {
	ActiveTransferView,
	TransferActivityView,
	TransferNoteView,
	TransferRefusalView,
} from "../hooks/use-browser-chrome";

/**
 * The file-transfer row: what the host is downloading or sent, where it went, and
 * what it refused.
 * Design: docs/design/browser-file-transfer.md §16.4 (the smallest honest surface),
 * §11.4 (no reveal from the tool), and docs/design/ui-browser-tab.md §9.2 (why this
 * lives in the strip and not over the page).
 *
 * WHY A ROW AND NOT A LIST WITH PER-FILE ACTIONS (§16.4's recommendation, which
 * this implements): the app's browser tab has no file-list UI, and adding one is a
 * second feature with its own security surface. What makes the capability HONEST
 * is the pair the row carries: the state (a transfer is happening, one was refused,
 * one left) and a way for the USER to open the directory downloads went into.
 *
 * WHY IT NARRATES BOTH DIRECTIONS, which is the one place this change grew beyond
 * §16.4 (review round 1, U3). An upload was the more dangerous verb with the
 * smaller surface: the round-1 walk showed three files leaving the machine with
 * `notes: []`, no row and no toast, and the published frames showed the strip
 * narrating an unrelated DOWNLOAD refusal while they left. One line naming what
 * went where is not the per-file list the design rules out. The row therefore
 * names its direction in words — "Download refused" / "3 files were attached to
 * …" — because a sentence about "the limit" alone is readable as a statement about
 * the other verb (review round 1, D2, which is exactly what frames 04/05 showed).
 *
 * WHY THE COPY IS COMPOSED HERE RATHER THAN PRINTED FROM THE HOST'S SENTENCE
 * (review round 1, D1 and D3). The host's `reason` is written for the TOOL RESULT:
 * it names exact byte counts, which is right for a model reading a refusal on its
 * own, and wrong for a person — "268435457 bytes, over the 268435456 byte limit"
 * is the same number in every human unit, so it reads as a self-contradiction by
 * construction, and at the app's minimum window the consequence at the END of that
 * sentence is the first thing `truncate` eats. So the note carries the RULE and its
 * numbers, and this component writes the human sentence from them: the name and the
 * rule are the parts allowed to elide, and the consequence is `shrink-0` so it
 * never does. What must not happen is paraphrase — every clause below is the host's
 * own rule in the host's own words, minus the `refused:` prefix and the backticks
 * the tool result carries (deviation 5).
 *
 * WHY THE REFUSAL IS THE LOUD HALF. A saved file is a completed action and gets one
 * quiet line (branding § 7). A refusal is the opposite: it is the case where the
 * user's expectation and the host's decision disagree. So a refusal takes
 * `danger-wash`, an icon, AND the row's strongest ink role — `ink`, not
 * `ink-muted` (review round 1, D5: the component painted `ink-muted` while the
 * contrast contract's own row declared `ink`, so its green output described a
 * pairing that did not ship, and `inkMuted` on `dangerWash` measures 5.49:1 in
 * kanagawaLotus, under the 5.5 floor this repo sets for that role).
 *
 * WHY IT RENDERS IN THE STRIP AND NOT IN THE BAND. The consent band's own mount is
 * driven by a pending or resolved approval (`browser-surface.tsx`), and a transfer
 * usually happens with no approval pending at all — so a row inside that component
 * would be invisible exactly when it is needed.
 */

/** How long a decided transfer stays on screen, from the host's own timestamp.
 *
 * WHY IT HAS A LIFE AT ALL (review round 1, U7 and D2): a sentence with no age
 * that never leaves reads an hour later as something that just happened, and the
 * round-1 frames showed exactly that — `04`/`05` still narrating the previous
 * case's refusal under a page the user had since replaced. What it must NOT take
 * away is the route to the files (U2), which is why the folder is also reachable
 * from the chrome's own control for as long as the host has written anything: this
 * row is a notification, and the directory is the durable thing.
 *
 * A refusal gets the longer window because it is the loud half — it is the one
 * state a user may need to act on (a file that did not arrive). */
const NOTE_TTL_MS = 2 * 60_000;
const REFUSAL_TTL_MS = 5 * 60_000;

/** How often the row re-reads the clock, so its age is not frozen at first paint. */
const AGE_TICK_MS = 15_000;

export interface BrowserFileTransferRowProps {
	transfers: TransferActivityView | undefined;
	/** Open the directory the host wrote into. Takes no path by design — `main`
	 * decides which one, so a renderer bug cannot point `openPath` anywhere. */
	onReveal: () => void;
}

export const BrowserFileTransferRow: FC<BrowserFileTransferRowProps> = ({
	transfers,
	onReveal,
}) => {
	// The newest decision is what the row speaks about when nothing is in flight.
	const latest = transfers?.notes[0] ?? null;
	const [dismissed, setDismissed] = useState<number | null>(null);
	const [now, setNow] = useState(() => Date.now());

	// The clock the row ages by. One interval while a note is on screen, and none
	// when there is nothing to age — a tick that outlives the row is a timer nobody
	// can see (this app's own toast module records the same rule).
	useEffect(() => {
		if (!latest) return;
		const timer = setInterval(() => setNow(Date.now()), AGE_TICK_MS);
		return () => clearInterval(timer);
	}, [latest]);

	if (!transfers || (!transfers.active && !latest)) return null;
	if (!transfers.active && latest) {
		// Dismiss is per-decision, not per-mount: a dismissal sticks until something
		// NEW happens, which is what makes the row a notification rather than a toggle
		// the user has to keep closing. `latest.at` is the host's own timestamp, so two
		// decisions in the same millisecond still compare equal and the row stays hidden
		// only while they are genuinely the same decision.
		if (dismissed === latest.at) return null;
		const ttl = latest.outcome === "refused" ? REFUSAL_TTL_MS : NOTE_TTL_MS;
		if (now - latest.at > ttl) return null;
	}

	const active = transfers.active;
	const refusing = !active && latest?.outcome === "refused";
	const sending = !active && latest?.outcome === "sent";
	const direction = active ? "download" : (latest?.direction ?? "download");
	const name = active?.name ?? latest?.name ?? "";

	return (
		<output
			aria-live="polite"
			aria-label="File transfer"
			data-tour-tag="browser-file-transfer-row"
			className={
				refusing
					? "flex items-center gap-2 border-control border-b bg-danger-wash px-3 py-1.5"
					: "flex items-center gap-2 border-control border-b bg-surface px-3 py-1.5"
			}
		>
			{refusing ? (
				<AlertTriangle aria-hidden className="size-4 shrink-0 text-ink" />
			) : sending ? (
				<Upload aria-hidden className="size-4 shrink-0 text-ink-muted" />
			) : (
				<Download aria-hidden className="size-4 shrink-0 text-ink-muted" />
			)}

			{active ? (
				// IN FLIGHT, WITH PROGRESS (review round 1, U6): one static line on a 40 MB
				// file is indistinguishable from a hung one, and the per-file cap is 256 MiB.
				<p className="flex min-w-0 grow items-baseline gap-1 text-body-sm text-ink-muted">
					<span className="shrink-0">Downloading</span>
					<span className="min-w-0 truncate font-mono text-mono-sm">
						{active.name}
					</span>
					<span className="shrink-0">{progressCopy(active)}</span>
				</p>
			) : refusing ? (
				// NAME AND RULE ELIDE, CONSEQUENCE DOES NOT (D3): the name truncates, the
				// rule clause truncates after it, and the outcome sits in a `shrink-0` span
				// so the half a reader needs is the half that survives.
				<p className="flex min-w-0 grow items-baseline gap-1 text-body-sm text-ink">
					<span className="shrink-0">Download refused —</span>
					<span className="min-w-0 truncate font-mono text-mono-sm">
						{name}
					</span>
					<span className="min-w-0 truncate">
						{ruleCopy(latest?.refusal ?? null)}
					</span>
					{latest && (
						<span className="shrink-0">
							{outcomeCopy(latest.outcome, latest.refusal)}
						</span>
					)}
				</p>
			) : (
				<p className="flex min-w-0 grow items-baseline gap-1 text-body-sm text-ink-muted">
					<span className="min-w-0 truncate font-mono text-mono-sm">
						{sending && (latest?.count ?? 1) > 1
							? `${latest?.count} files`
							: name}
					</span>
					<span className="shrink-0">
						{sending ? "were attached to" : "was saved to"}
					</span>
					{/* WHERE IT WENT, WHICH THE ROW NEVER SAID (review round 1, D4 and U2).
					    Rendered from the host's own path, mono, and truncated FROM THE LEFT so
					    the tail — the session's quarantine directory, which is the part that
					    identifies it — is the part that survives. This is also what makes the
					    reveal below a labelled action rather than a blind click into a path only
					    `main` knows. */}
					<span
						dir="rtl"
						className="min-w-0 truncate font-mono text-mono-sm"
						title={sending ? latest?.site : latest?.dir}
					>
						<bdi dir="ltr">{sending ? latest?.site : latest?.dir}</bdi>
					</span>
					<span className="shrink-0 text-ink-dim">
						· {ageCopy(now, latest?.at ?? now)}
					</span>
				</p>
			)}

			{/* The reveal is pointless for an upload (there is no file of ours on disk),
			    and for a download it is live in every state — including mid-flight, where
			    the row now says which directory it opens, which is what D8 asked for
			    instead of hiding a control the user may want. */}
			{direction === "download" && (
				<Button
					variant="outline"
					size="sm"
					aria-label="Open downloads folder"
					onClick={onReveal}
				>
					Open folder
				</Button>
			)}
			{!active && latest && (
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={
						sending ? "Dismiss upload notice" : "Dismiss download notice"
					}
					onClick={() => setDismissed(latest.at)}
				>
					<X aria-hidden className="size-3.5" />
				</Button>
			)}
		</output>
	);
};

/** What a transfer in flight says about itself.
 *
 * A response with no declared length gets "N so far" rather than a percentage: the
 * host reports `total: 0` for exactly that case (a chunked body, the shape the
 * runtime cap exists for), and inventing a denominator would be a progress bar that
 * lies. */
function progressCopy(active: ActiveTransferView): string {
	if (active.total <= 0) return `(${formatBytes(active.received)} so far)…`;
	const percent = Math.floor((active.received / active.total) * 100);
	return `(${percent}%, ${formatBytes(active.received)} of ${formatBytes(active.total)})…`;
}

/** The rule clause of a refusal: the part that may elide when the row is narrow.
 *
 * Every clause is the host's own rule in the host's own words (see this file's
 * header on copy), so a reader comparing the row with the tool result finds the
 * same rule — the row only drops the marks a terminal sentence carries and states
 * the limit as a unit, because two raw byte counts one apart are unreadable. */
function ruleCopy(refusal: TransferRefusalView | null): string {
	switch (refusal?.rule) {
		case "executable":
			return "is an executable/script type.";
		case "limit":
			return `is over the ${formatBytes(refusal.limit)} per-file download limit.`;
		case "count":
			return `was not saved: this call has already saved its limit of ${refusal.limit} files.`;
		case "write":
			return "could not be saved: the download folder could not be written to.";
		case "deadline":
			return `did not finish within ${refusal.limit}s and was cancelled.`;
		case "interrupted":
			return "did not finish.";
		default:
			return "was refused.";
	}
}

/** The consequence, in a `shrink-0` span: never the part of the sentence that
 * elides (D3). */
function outcomeCopy(
	outcome: TransferNoteView["outcome"],
	refusal: TransferRefusalView | null,
): string {
	if (outcome !== "refused") return "";
	// A partial that a cancel removed is the one case where "nothing was saved"
	// would be true but insufficient: what the user needs to know is that the file
	// they may have seen appear is gone.
	if (refusal?.rule === "interrupted" || refusal?.rule === "deadline") {
		return "The partial file was discarded.";
	}
	return "Nothing was saved.";
}

/** An age a person reads, so a line that is still on screen says how stale it is
 * (review round 1, U7). */
function ageCopy(now: number, at: number): string {
	const seconds = Math.max(0, Math.round((now - at) / 1000));
	if (seconds < 30) return "just now";
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.round(minutes / 60);
	return `${hours} h ago`;
}

/** A byte count in the unit the caps are stated in (`MiB`), one decimal below ten
 * so a progress line moves, and rounded UP above it so a size is never understated
 * in a sentence that is about a limit. */
function formatBytes(bytes: number): string {
	const MiB = 1024 * 1024;
	if (bytes >= 10 * MiB) return `${Math.round(bytes / MiB)} MiB`;
	if (bytes >= MiB) return `${(bytes / MiB).toFixed(1)} MiB`;
	if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
	return `${bytes} bytes`;
}
