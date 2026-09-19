import type { CanonicalSessionRow } from "@shared/store/canonical-sessions-store";
import type { Meta, StoryObj } from "@storybook/react";
import { ChatSessionStatus } from "./chat-session-status";

/** Read/unread specimens, not a receipt transition. The receipt flow is the
 * isolated browser fixture; this matrix keeps every neighbouring status legible
 * under every Storybook theme — the registry's fifty-nine, which is the list the
 * `theme` control offers — without inventing a second glyph renderer.
 */
const meta = {
	title: "Chat/Session status",
	component: ChatSessionStatus,
} satisfies Meta<typeof ChatSessionStatus>;
export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The one status whose WORDS are part of the claim, in the catalogue's own
 * spelling (`session/catalog.py`'s `status`): the state's sentence with the
 * measured heartbeat age.
 *
 * It was missing from this file entirely — every specimen was built with
 * `label: code`, so the frame drew "wedged" where the app draws a sentence, and
 * the half of the row a reader actually reads could not be judged from any frame
 * in the review set (design D9). The rows whose label differs from their code are
 * the ones that carry one; the rest are legitimate token specimens.
 */
const WEDGED_LABEL = "Not answering · process alive (last heartbeat 4m ago)";

/** The statuses drawn as a PAIR at the top of `Neighbours`, in the app's words. */
const PAIR: [string, string][] = [
	["error", "Unseen error"],
	["wedged", WEDGED_LABEL],
];

/**
 * THE AMBER CLASS IN ONE COLUMN, which is design round 1's D4.
 *
 * The design's §1.5 asks whether the four marks a reader meets in one list —
 * needs-you, interrupted, not answering and error — can be told apart, and the
 * matrix below answers it only by CROSS-REFERENCING two columns: `approval` and
 * `interrupted` sit on the left, `answer` and `wedged` on the right, so the
 * closest pair (`≈`'s two waves against `Pause`'s two bars) never appears in one
 * place. The designer composed this strip from the frame's own pixels to check it,
 * which is the signal that the frame should have shown it: a claim about a COLUMN
 * cannot be read off a grid.
 *
 * FOUR ROWS, one per mark, in the order a list would sort them, each with the ink
 * role named beside it. THREE OF THE FOUR WEAR `warning` — that is the point of
 * the specimen rather than an accident of the fixture, and it is why the silhouette
 * carries the state: this product's own measurement records `warning` and `danger`
 * converging under deuteranopia, so colour alone separates nothing here.
 */
const AMBER_CLASS: [string, string, string][] = [
	["approval", "Approval needed", "needs you — CircleAlert, warning"],
	["interrupted", "Interrupted", "interrupted — Pause, warning"],
	["wedged", WEDGED_LABEL, "not answering — EqualApproximately, warning"],
	["error", "Failed", "error — CircleAlert, danger"],
];

export const AmberClass: Story = {
	args: { row: { session_id: "specimen" } },
	render: () => (
		<div className="bg-surface text-ink flex w-[430px] flex-col gap-3 p-6">
			{AMBER_CLASS.map(([code, label, note]) => (
				<div className="flex items-center gap-2" key={code}>
					<ChatSessionStatus
						row={
							{
								session_id: "specimen",
								status: { code, label },
							} as CanonicalSessionRow
						}
					/>
					<div className="flex min-w-0 flex-col">
						{/*
						 * NO `truncate`: this column's whole point is that the longest label in the
						 * app is readable in the frame (design round 2's D7 — the first version
						 * clipped it to "…(last heartbeat …", hiding the half the sentence exists
						 * for). The column is wide enough for the sentence now; what the line must
						 * not do is quietly re-clip it, so it is left to wrap rather than clipped.
						 */}
						<span>{label}</span>
						<span className="text-ink-muted text-meta">{note}</span>
					</div>
				</div>
			))}
		</div>
	),
};

export const Neighbours: Story = {
	args: { row: { session_id: "specimen" } },
	render: () => (
		<div className="bg-surface text-ink p-6 flex flex-col gap-4">
			{/*
			 * THE ADJACENCY IS THE FINDING, so it is drawn as a pair and read first.
			 *
			 * `wedged` and `error` rendered byte-identically before this change —
			 * the same `CircleAlert` in the same `text-danger` — and a sameness
			 * that has been REMOVED cannot be shown by the fixed state alone: a
			 * reader looking at one wave in amber has no way to see what it used
			 * to be indistinguishable from. The pair under one theme is the whole
			 * claim, and the two inks deliberately are NOT what separates them:
			 * this product's own palette measurement records `warning`/`danger`
			 * converging under deuteranopia, so the silhouette has to carry it
			 * with no help from colour.
			 */}
			<div className="flex flex-col gap-3 border-b border-hairline pb-4">
				{PAIR.map(([code, label]) => (
					<div className="flex items-center gap-2" key={code}>
						<ChatSessionStatus
							row={
								{
									session_id: "specimen",
									status: { code, label },
								} as CanonicalSessionRow
							}
						/>
						<span>{label}</span>
					</div>
				))}
			</div>
			{/* Every code twice, read and unread, beside its own name — the matrix. */}
			<div className="grid grid-cols-2 gap-4">
				{[true, false].flatMap((unseen) =>
					[
						"complete",
						"error",
						"busy",
						"answer",
						"approval",
						"wedged",
						"interrupted",
						"scheduled",
						"attached",
						"idle",
						"dormant",
						"unknown",
					].map((code) => {
						const label = code === "wedged" ? WEDGED_LABEL : code;
						const row = {
							session_id: "specimen",
							status: { code, label },
							attention: { unseen },
						} as CanonicalSessionRow;
						return (
							<div
								className="flex items-center gap-2"
								key={`${code}-${unseen}`}
							>
								<ChatSessionStatus row={row} />
								<span>
									{code}
									{label !== code ? ` — “${label}”` : ""} —{" "}
									{unseen ? "unread" : "read"}
								</span>
							</div>
						);
					}),
				)}
			</div>
		</div>
	),
};
