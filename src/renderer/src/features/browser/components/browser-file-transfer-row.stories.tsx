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

const SAVED: TransferNoteView = {
	name: "receipt-1.pdf",
	count: 1,
	dir: DIR,
	outcome: "saved",
	reason: "",
	at: 1_789_000_000_000,
	direction: "download",
	site: "",
	refusal: null,
};

const REFUSED: TransferNoteView = {
	name: "setup.exe",
	count: 1,
	dir: DIR,
	outcome: "refused",
	reason:
		"refused: `setup.exe` is an executable/script type; nothing was saved",
	at: 1_789_000_000_001,
	direction: "download",
	site: "",
	refusal: { rule: "executable", bytes: 0, limit: 0 },
};

const OVER_CAP: TransferNoteView = {
	name: "huge.pdf",
	count: 1,
	dir: DIR,
	outcome: "refused",
	reason:
		"refused: `huge.pdf` is over the 256 MiB per-file download limit; nothing was saved (it is 268435457 bytes)",
	at: 1_789_000_000_002,
	direction: "download",
	site: "",
	refusal: { rule: "limit", bytes: 268_435_457, limit: 268_435_456 },
};

/** The state the round-1 walk found with nothing on screen at all (U3). */
const SENT: TransferNoteView = {
	name: "brief.pdf",
	count: 3,
	dir: "",
	outcome: "sent",
	reason: "",
	at: 1_789_000_000_003,
	direction: "upload",
	site: "forms.example",
	refusal: null,
};

/** A long name at the narrow window, which is the shape D3 asked to see: the name
 * elides and the consequence does not. */
const LONG_NAME: TransferNoteView = {
	name: "quarterly-financial-statements-and-notes-2026-q3-final-v7.pdf",
	count: 1,
	dir: DIR,
	outcome: "refused",
	reason:
		"refused: `quarterly-financial-statements-and-notes-2026-q3-final-v7.pdf` is an executable/script type; nothing was saved",
	at: 1_789_000_000_004,
	direction: "download",
	site: "",
	refusal: { rule: "executable", bytes: 0, limit: 0 },
};

const activity = (
	notes: TransferNoteView[],
	active: ActiveTransferView | null = null,
): TransferActivityView => ({ active, dir: DIR, notes });

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

/** The upload, which had no surface at all before this round (U3). */
export const Sent: Story = {
	args: { transfers: activity([SENT]), onReveal: () => {} },
};

/** The long name at the declared minimum window, which is the frame D3 asked for:
 * the name truncates, the rule truncates after it, and "Nothing was saved." stays. */
export const LongNameAtMinimumWindow: Story = {
	args: { transfers: activity([LONG_NAME]), onReveal: () => {} },
	render: (args) => (
		<div className="w-[800px] bg-canvas p-6">
			<BrowserFileTransferRow transfers={args.transfers} onReveal={() => {}} />
		</div>
	),
};

/** Nothing to say: the row is absent rather than empty. A host that predates the
 * feature sends no `transfers` at all, which is the same frame. */
export const Nothing: Story = {
	args: { transfers: undefined, onReveal: () => {} },
};
