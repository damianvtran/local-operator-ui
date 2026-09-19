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
