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
 * rule are the parts allowed to elide — the name yielding first, and the rule only
 * past its `24ch` floor, so the reason survives the narrowest window (review round
 * 3, D14) — and the consequence is `shrink-0` so it never does. What must not happen is paraphrase — every clause below is the host's
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
	/** How to name the tab a decision belongs to, when it is not the one on screen
	 * (review round 1, D2). The surface owns the tab list, so it owns the words; a
	 * decision taken elsewhere is LABELLED rather than hidden, because an agent's tab
	 * is created inactive and hiding it would take the file off screen entirely.
	 *
	 * THE SECOND ARGUMENT IS THE KIND THE HOST RECORDED FOR THAT DECISION (review
	 * round 2, U10): a tab can be CLOSED while its note is still on screen, and the
	 * caller then has no record to resolve — so the note's own `ownerKind` is what
	 * lets the label stay true ("on the agent's tab" is still true of a closed agent
	 * tab) instead of pointing at a tab that does not exist. `null` is "the host
	 * could not say", which the surface renders the generic way rather than guessing. */
	tabLabel?: (tabId: number, ownerKind: "user" | "agent" | null) => string;
}

export const BrowserFileTransferRow: FC<BrowserFileTransferRowProps> = ({
	transfers,
	onReveal,
	tabLabel,
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
	// D14: one string, rendered AND carried as the rule span's `title`, so the
	// clause a narrow row clips is still recoverable from the span itself.
	const rule = refusing ? ruleCopy(latest?.refusal ?? null) : "";
	// WHOSE DECISION THIS IS, when it is not the tab on screen. `null` means no tab is
	// active, which is not the same as "another tab" — there is nothing for the row to
	// contradict, so it says nothing.
	const owner =
		active || latest
			? awayLabel(
					transfers,
					active?.tabId ?? latest?.tabId,
					// Mid-flight the tab is live, so the surface resolves the kind from its own
					// list; once DECIDED, the note's own recorded kind is what survives the tab
					// being closed (review round 2, U10).
					active ? null : (latest?.ownerKind ?? null),
					tabLabel,
				)
			: "";

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
				//
				// THE TICKING HALF IS OUT OF THE LIVE REGION (review round 2, U8). The row is
				// `<output aria-live="polite">`, so every change inside it is a queued
				// announcement: the progress line repaints on a 250 ms cadence and UX round 2
				// measured 15 mutation records / 6 distinct texts in 2.5 s — ~2.4 announcements
				// per second for as long as a transfer runs (minutes, at a 256 MiB cap), with
				// the sentence that MATTERS ("… was saved to …", "Download refused — …")
				// queued behind them. `aria-hidden` on the moving number is this repo's own
				// rule, stated verbatim in `trace/working-line.tsx`: a screen-reader user gets
				// "running 3 tools" once when the phase changes, "not the clock read out every
				// second — which is why the clock and the spinner are both `aria-hidden` inside
				// it." The state transition is what is worth announcing, not the byte count.
				//
				// AND THE DIRECTORY IS NAMED HERE TOO (review round 2, D12). D8's remediation
				// said the reveal is live "in every state — including mid-flight, where the row
				// now says which directory it opens", and mid-flight it did not: the path was
				// rendered only in the decided branch, so a press during the write opened a
				// directory whose newest file is a partial under its final name, unexplained.
				// The path is long by nature and this line has no room to spare at the app's
				// minimum window, so it rides the row's own `title` — the same fact, stated
				// where the row can afford it.
				<p
					className="flex min-w-0 grow items-baseline gap-1 text-body-sm text-ink-muted"
					title={transfers.dir ?? undefined}
				>
					<span className="shrink-0">Downloading</span>
					<span className="min-w-0 truncate font-mono text-mono-sm">
						{active.name}
					</span>
					<span aria-hidden className="shrink-0">
						{progressCopy(active)}
					</span>
				</p>
			) : refusing ? (
				// NAME AND RULE ELIDE, CONSEQUENCE DOES NOT (D3): the name truncates, the
				// rule clause truncates after it, and the outcome sits in a `shrink-0` span
				// so the half a reader needs is the half that survives.
				//
				// THE NAME IS CAPPED, NOT MERELY SHRINKABLE (review round 2, D11). It used to
				// be `min-w-0 truncate` alone, which lets a long name eat the line: design
				// round 2 measured the rule span at 74 px with the clipped word `is an exec…`,
				// and that clause is the only statement of WHY the file was refused — so
				// clipping it to a fragment costs the sentence its reason. The saved branch
				// already caps its own name (`max-w-[32ch] shrink-0 truncate`) so the path keeps
				// its room; the refusal caps its own for the same reason.
				//
				// AND THE NAME IS THE SPAN THAT YIELDS (design round 3, D14). The cap on its
				// own was an ABSOLUTE one: `max-w-[32ch] shrink-0` measured 237.5 logical px at
				// BOTH the specimen's width and the app's default window, so every px of
				// narrowing was taken by the rule span — 168 px down to 22 px, reading `is …`.
				// The rule is the only statement of WHY, so the reason is the protected half
				// now, in the specimen design round 3 measured: `min(24ch,50%)` floors it at
				// 194.8 px there — more than the 180 px clause it renders — while the name
				// yields (it carries `shrink`, and it yields FIRST rather than not at all: its
				// own `min(6ch,20%)` floor is what stops a squeezed row from dropping the name
				// to zero width, which is a state that reads as a layout bug rather than as a
				// clip). The whole rule rides the span's own `title` (the vehicle D17 is about;
				// it is stated here because a clipped rule is otherwise unrecoverable).
				//
				// WHY BOTH SHARES ARE PROPORTIONAL RATHER THAN `32ch`/`24ch` ALONE (measured on
				// the app at its minimum window, `G8c`). The specimen is not the tightest case
				// this row has to survive: the app's own 800 px window spends ~248 px of it on
				// the navigation rail, so the strip's paragraph there measures a fraction of the
				// specimen's — the rig read it at 269 px, where the label (`Download refused —`,
				// 125 px), the consequence (`Nothing was saved.`, 118 px) and the age (58 px)
				// already exceed it between them, so no division of the name and the rule can
				// put that sentence on one line there. An absolute floor would paint the reason
				// further past the row's own controls; a proportional one keeps the reason at
				// least as much room as the name at every width, and leaves the rest to the
				// layout problem that state actually has (a sentence too long for the row, which
				// is the design round's to rearrange, not this flex row's).
				<p className="flex min-w-0 grow items-baseline gap-1 text-body-sm text-ink">
					<span className="shrink-0">Download refused —</span>
					<span className="max-w-[min(32ch,45%)] min-w-[min(6ch,20%)] shrink truncate font-mono text-mono-sm">
						{name}
					</span>
					<span className="min-w-[min(24ch,50%)] truncate" title={rule}>
						{rule}
					</span>
					{latest && (
						<span className="shrink-0">
							{outcomeCopy(latest.outcome, latest.refusal)}
						</span>
					)}
					{latest && (
						// A REFUSAL SAYS HOW OLD IT IS (review round 2, U9). It is the loud half,
						// the half a user may have to act on, and deliberately the longest-lived
						// (5 minutes against 2 for a decided transfer) — so the row with the most
						// reason to be read carefully was the only one that could not say whether
						// it happened now or five minutes ago. The TTL asymmetry stays.
						// `aria-hidden` for the reason the progress span carries it (U8): this
						// number changes on the 15 s tick, and a live region that re-announces a
						// refusal every quarter minute is the same flood, slower. The refusal is
						// announced ONCE, when it settles; the age is a staleness cue for the
						// glance that finds it still on screen.
						<span aria-hidden className="shrink-0 text-ink-dim">
							· {ageCopy(now, latest.at)}
						</span>
					)}
				</p>
			) : (
				<p className="flex min-w-0 grow items-baseline gap-1 text-body-sm text-ink-muted">
					{/* THE NAME KEEPS ITS OWN SPACE HERE, which is the one place this row's
					    layout differs from the refusal's: a DECIDED transfer is one quiet line
					    (branding § 7) and the file's name is what the reader is looking for, so
					    the path — which is long by nature — is the part that gives way. The
					    refusal's sentence is a different problem (D3) and is handled below. */}
					<span className="max-w-[32ch] shrink-0 truncate font-mono text-mono-sm">
						{name}
					</span>
					{sending && (latest?.count ?? 1) > 1 && (
						// AN UPLOAD NAMES WHAT LEFT, NOT ONLY HOW MANY (review round 2, U11). The
						// line used to say `3 files were attached to …`, so a user whose assistant
						// attached three files out of a twelve-file folder could not tell which
						// three left the machine from anything on screen — and upload is the more
						// dangerous verb in this design's own words. Naming the first and counting
						// the rest keeps ONE line and ONE decision (§16.4's rule is against a
						// per-file LIST with per-file actions, which this is not) while saying what
						// actually went.
						<span className="shrink-0 text-ink-dim">
							+ {latest.count - 1} more
						</span>
					)}
					<span className="shrink-0">
						{sending
							? (latest?.count ?? 1) > 1
								? "were attached to"
								: "was attached to"
							: "was saved to"}
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
					<span aria-hidden className="shrink-0 text-ink-dim">
						· {ageCopy(now, latest?.at ?? now)}
					</span>
				</p>
			)}

			{/* WHOSE DECISION THIS IS, when it is another tab's (review round 1, D2): the
			    sentence must not read as a statement about the page the user is on. */}
			{owner && <span className="shrink-0 text-ink-dim">{owner}</span>}

			{/* The reveal is pointless for an upload (there is no file of ours on disk),
			    and for a download it is live in every state — including mid-flight, where
			    the row now says which directory it opens (review round 2, D12: it said so
			    only AFTER the decision until this round, so the claim D8's remediation made
			    was true of the settled states and not of the one it named). The in-flight
			    clause carries the directory as the row's own `title` rather than a span,
			    because at the app's minimum window this line has no room for a path. */}
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

/** How a decision that belongs to another tab is named, or "" when it is this
 * tab's own (or when no tab is active at all). */
function awayLabel(
	transfers: TransferActivityView,
	tabId: number | undefined,
	ownerKind: "user" | "agent" | null,
	tabLabel:
		| ((tabId: number, ownerKind: "user" | "agent" | null) => string)
		| undefined,
): string {
	if (tabId === undefined || transfers.activeTabId === null) return "";
	if (transfers.activeTabId === tabId) return "";
	return tabLabel ? tabLabel(tabId, ownerKind) : "on another tab";
}

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
		case "overrun":
			// The runtime cap (review round 2, R2-5): its own rule rather than `limit`,
			// because the file DID exist for a moment — the clause says when the limit
			// was passed, and `outcomeCopy` then says the partial was discarded rather
			// than that nothing was saved.
			return `went over the ${formatBytes(refusal.limit)} per-file download limit while it was being written.`;
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
	if (
		refusal?.rule === "interrupted" ||
		refusal?.rule === "deadline" ||
		// The runtime cap's write existed on disk before it was cancelled, so
		// "nothing was saved" is the wrong half of the truth for it (R2-5).
		refusal?.rule === "overrun"
	) {
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
