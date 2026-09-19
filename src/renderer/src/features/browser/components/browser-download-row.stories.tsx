import type { Meta, StoryObj } from "@storybook/react";
import type {
	DownloadActivityView,
	DownloadNoteView,
} from "../hooks/use-browser-chrome";
import { BrowserDownloadRow } from "./browser-download-row";

/**
 * The download row's own states, for the review round that has to judge its copy
 * without a native window (design §12.3, §16.4).
 *
 * WHY SPECIMENS RATHER THAN THE ROUTE. The row renders in the chrome band, which is
 * ordinary DOM — it is the native PAGE VIEW under it that no browser tool can reach,
 * so the surface a design review can be shown is this one. The live frames come from
 * `scripts/browser-file-transfer-proof.mjs`, which drives the real host; these exist
 * so the copy and the two grounds can be judged against each other, in every theme,
 * without a running download.
 *
 * THE NOTES ARE THE HOST'S OWN WORDS, copied from what `DownloadArmer.note` records
 * so a specimen cannot show a sentence the host would never produce — including the
 * `refused:` prefix, which the row strips for display and the tool result keeps.
 */

const SAVED: DownloadNoteView = {
	name: "receipt-1.pdf",
	outcome: "saved",
	reason: "",
	at: 1_789_000_000_000,
};

const REFUSED: DownloadNoteView = {
	name: "setup.exe",
	outcome: "refused",
	reason:
		"refused: `setup.exe` is an executable/script type; nothing was saved",
	at: 1_789_000_000_001,
};

const OVER_CAP: DownloadNoteView = {
	name: "huge.pdf",
	outcome: "refused",
	reason:
		"refused: `huge.pdf` is 268435457 bytes, over the 268435456 byte per-file limit",
	at: 1_789_000_000_002,
};

const activity = (
	notes: DownloadNoteView[],
	active: string | null = null,
): DownloadActivityView => ({
	active,
	dir: "/Users/someone/Library/Application Support/Local Operator/browser/downloads/20260918-120000-session1",
	notes,
});

const meta = {
	title: "Browser/Download row",
	component: BrowserDownloadRow,
} satisfies Meta<typeof BrowserDownloadRow>;
export default meta;
type Story = StoryObj<typeof meta>;

const inBand = (downloads: DownloadActivityView | undefined) => (
	<div className="bg-canvas p-6">
		<BrowserDownloadRow downloads={downloads} onReveal={() => {}} />
	</div>
);

/** A download running: the row is the only place the user learns one is happening. */
export const Downloading: Story = {
	args: { downloads: activity([], "receipt-3.pdf"), onReveal: () => {} },
	render: (args) => inBand(args.downloads),
};

/** The completed case, which is one quiet line on the page's own ground: a save is
 * a finished action, and branding § 7 gives a finished action no card and no fill. */
export const Saved: Story = {
	args: { downloads: activity([SAVED]), onReveal: () => {} },
	render: (args) => inBand(args.downloads),
};

/** The refusal, which is the loud half: `danger-wash` and an icon, because this is
 * the case where the user's expectation and the host's decision disagree. */
export const Refused: Story = {
	args: { downloads: activity([REFUSED]), onReveal: () => {} },
	render: (args) => inBand(args.downloads),
};

/** The refusal whose words carry a number rather than a class, which is the case
 * the cap exists for. */
export const OverCap: Story = {
	args: { downloads: activity([OVER_CAP]), onReveal: () => {} },
	render: (args) => inBand(args.downloads),
};

/** Nothing to say: the row is absent rather than empty. A host that predates the
 * feature sends no `downloads` at all, which is the same frame. */
export const Nothing: Story = {
	args: { downloads: undefined, onReveal: () => {} },
	render: (args) => inBand(args.downloads),
};
