import type { Meta, StoryObj } from "@storybook/react";
import type {
	ActiveTransferView,
	TransferActivityView,
	TransferNoteView,
} from "../hooks/use-browser-chrome";
import { BrowserFileTransferRow } from "./browser-file-transfer-row";

/**
 * The transfer row's own states, for the review round that has to judge its copy
 * without a native window (design §12.3, §16.4).
 *
 * WHY SPECIMENS RATHER THAN THE ROUTE. The row renders in the chrome band, which is
 * ordinary DOM — it is the native PAGE VIEW under it that no browser tool can reach,
 * so the surface a design review can be shown is this one. The live frames come from
 * `scripts/browser-file-transfer-proof.mjs`, which drives the real host; these exist
 * so the copy and the two grounds can be judged against each other, in every theme,
 * without a running transfer.
 *
 * THE NOTES ARE THE HOST'S OWN FACTS, copied from what `DownloadArmer.note` records,
 * so a specimen cannot show a sentence the host could never produce. The ROW's copy
 * is composed from `refusal.rule` and its numbers (see the component's header), so
 * these specimens are also the place the human sentence is judged — the `reason`
 * here is the tool result's, and the row does not print it.
 */

const DIR =
	"/Users/someone/Library/Application Support/Local Operator/browser/downloads/20260919-120000-session1";

/** WHEN THESE DECISIONS HAPPENED, RELATIVE TO THE RENDER (review round 2, D10).
 *
 * WHY IT IS NOT A CONSTANT ANY MORE, and this is the finding rather than a tidy-up:
 * every note used to carry a frozen `at` (`1_789_000_000_000` = 2026-09-10), and the
 * TTL this change added makes the component return `null` once `now - at` passes it
 * (2 min for a decided transfer, 5 for a refusal). So on the round-2 head EVERY
 * decided specimen painted an empty ground — `--downloading` was the only one with
 * no note to gate on — and the 800px minimum-window state that D3's fix rests on had
 * no rendered artifact anywhere: every committed app frame is the 1380px window and
 * the story that was to cover 800px was invisible. A relative `at` is also what keeps
 * the specimens alive as the calendar moves past them.
 *
 * Five seconds back, so the row reads `just now` — the age the row composes itself
 * (U7/U9) — rather than sitting exactly on the boundary of the TTL. */
const AT = Date.now() - 5_000;

const SAVED: TransferNoteView = {
	name: "receipt-1.pdf",
	count: 1,
	dir: DIR,
	outcome: "saved",
	reason: "",
	at: AT,
	direction: "download",
	site: "",
	refusal: null,
	tabId: 7,
	ownerKind: "user",
};

const REFUSED: TransferNoteView = {
	name: "setup.exe",
	count: 1,
	dir: DIR,
	outcome: "refused",
	reason:
		"refused: `setup.exe` is an executable/script type; nothing was saved",
	at: AT,
	direction: "download",
	site: "",
	refusal: { rule: "executable", bytes: 0, limit: 0 },
	tabId: 7,
	ownerKind: "user",
};

const OVER_CAP: TransferNoteView = {
	name: "huge.pdf",
	count: 1,
	dir: DIR,
	outcome: "refused",
	reason:
		"refused: `huge.pdf` is over the 256 MiB per-file download limit; nothing was saved (it is 268435457 bytes)",
	at: AT,
	direction: "download",
	site: "",
	refusal: { rule: "limit", bytes: 268_435_457, limit: 268_435_456 },
	tabId: 7,
	ownerKind: "user",
};

/** THE RUNTIME CAP, which is its own rule (review round 2, R2-5): a write that was
 * already on disk when the limit was passed and was cancelled, so the row says the
 * partial was discarded rather than that nothing was saved. Its own specimen
 * because the copy differs from `OverCap`'s by exactly the clause this rule exists
 * to get right. */
const OVERRUN: TransferNoteView = {
	name: "endless.bin",
	count: 1,
	dir: DIR,
	outcome: "refused",
	reason:
		"refused: `endless.bin` went over the 256 MiB per-file download limit while it was being written; it was cancelled and the partial file was discarded",
	at: AT,
	direction: "download",
	site: "",
	refusal: { rule: "overrun", bytes: 268_435_457, limit: 268_435_456 },
	tabId: 7,
	ownerKind: "user",
};

/** The state the round-1 walk found with nothing on screen at all (U3). */
const SENT: TransferNoteView = {
	name: "brief.pdf",
	count: 3,
	dir: "",
	outcome: "sent",
	reason: "",
	at: AT,
	direction: "upload",
	site: "forms.example",
	refusal: null,
	tabId: 7,
	ownerKind: "user",
};

/** A long name at the narrow window, which is the shape D3 asked to see: the name
 * elides and the consequence does not. Since design round 3 (D14) the name is also
 * the span that YIELDS, so at 800 px the name is heavily clipped and the reason
 * beside it reads in full — the same fixture now photographs both halves. */
const LONG_NAME: TransferNoteView = {
	name: "quarterly-financial-statements-and-notes-2026-q3-final-v7.pdf",
	count: 1,
	dir: DIR,
	outcome: "refused",
	reason:
		"refused: `quarterly-financial-statements-and-notes-2026-q3-final-v7.pdf` is an executable/script type; nothing was saved",
	at: AT,
	direction: "download",
	site: "",
	refusal: { rule: "executable", bytes: 0, limit: 0 },
	tabId: 7,
	ownerKind: "user",
};

const activity = (
	notes: TransferNoteView[],
	active: ActiveTransferView | null = null,
): TransferActivityView => ({
	active,
	dir: DIR,
	notes,
	activeTabId: 7,
	recent: null,
});

const meta = {
	title: "Browser/File transfer row",
	component: BrowserFileTransferRow,
} satisfies Meta<typeof BrowserFileTransferRow>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A download running, with the progress the round-1 walk asked for (U6): the bar
 * was one static line for the whole of a 40 MB transfer. */
export const Downloading: Story = {
	args: {
		transfers: activity([], {
			name: "receipt-3.pdf",
			received: 14_680_064,
			total: 41_943_040,
			tabId: 7,
		}),
		onReveal: () => {},
	},
};

/** A response that declared no length: the case the runtime cap exists for, and the
 * one where a percentage would be a progress bar that lies. */
export const DownloadingUnknownSize: Story = {
	args: {
		transfers: activity([], {
			name: "chunked.bin",
			received: 8_388_608,
			total: 0,
			tabId: 7,
		}),
		onReveal: () => {},
	},
};

/** The completed case, which is one quiet line on the page's own ground, and the
 * first state that says WHERE the file went (D4/U2). */
export const Saved: Story = {
	args: { transfers: activity([SAVED]), onReveal: () => {} },
};

/** The refusal, which is the loud half: `danger-wash`, an icon, and the row's
 * strongest ink role (D5). */
export const Refused: Story = {
	args: { transfers: activity([REFUSED]), onReveal: () => {} },
};

/** The refusal whose rule carries a number: the limit is a unit and the file's own
 * size is not restated beside it (D1). */
export const OverCap: Story = {
	args: { transfers: activity([OVER_CAP]), onReveal: () => {} },
};

/** The RUNTIME cap's copy (review round 2, R2-5): the same limit, reached while the
 * file was being written, so the consequence clause is the discard rather than
 * "Nothing was saved." */
export const OverCapWhileWriting: Story = {
	args: { transfers: activity([OVERRUN]), onReveal: () => {} },
};

/** The upload, which had no surface at all before this round (U3). */
export const Sent: Story = {
	args: { transfers: activity([SENT]), onReveal: () => {} },
};

/** The long name at the declared minimum window, which is the frame D3 asked for:
 * the consequence stays whole and the RULE beside it stays legible at this width.
 * Since design round 4 (D16) that is the WRAP's doing rather than a floor's.
 *
 * THIS STORY IS NOT THE APP'S MINIMUM WINDOW, and round 5's R5-3 was the sentence
 * here claiming it was: the specimen renders inside `w-[800px] p-6`, so its row is
 * 752 px and its paragraph ~576 px — the app's own 800 px window leaves the strip
 * 268.7 px, because the shell around it (a 220 px rail, the owner label, two controls)
 * takes the rest. Both are worth rendering, and they are not the same width; the rig's
 * `G8c` measures the APP at 269 px, which is the state D16 was filed about. */
export const LongNameAtMinimumWindow: Story = {
	args: { transfers: activity([LONG_NAME]), onReveal: () => {} },
	render: (args) => (
		<div className="w-[800px] bg-canvas p-6">
			<BrowserFileTransferRow transfers={args.transfers} onReveal={() => {}} />
		</div>
	),
};

/** A decision taken on ANOTHER tab (D2): the strip says whose it is rather than
 * appearing to describe the page on screen. This is the state the row is in for the
 * common agent case — an agent tab is created inactive, so its download belongs to a
 * tab the user is not looking at — and it is rendered rather than hidden, because
 * hiding it would take the file off screen entirely (which is U3's complaint). */
export const OtherTabsTransfer: Story = {
	args: {
		transfers: {
			...activity([{ ...SAVED, tabId: 3 }]),
			activeTabId: 7,
		},
		onReveal: () => {},
		tabLabel: () => "· on the agent's tab",
	},
};

/** Nothing to say: the row is absent rather than empty. A host that predates the
 * feature sends no `transfers` at all, which is the same frame. */
export const Nothing: Story = {
	args: { transfers: undefined, onReveal: () => {} },
};
