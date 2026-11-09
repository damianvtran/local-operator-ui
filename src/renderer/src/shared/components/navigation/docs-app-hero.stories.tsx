/**
 * The marketing hero is a reproducible state of the desktop shell, not an image
 * assembled from individual panes. Reuse the library's world and real shell so
 * capability-gated navigation and the right-edge rail follow the current app.
 * Manager conversation + parallel reviewer/writer + shared plan are the point
 * of this scene; the separate Subagents scene shows their later progress.
 */
import { deriveRunDetails } from "@features/chat/components/run-details/run-detail-model";
import * as runFixtures from "@features/chat/components/run-details/run-details.fixtures";
import type { Meta, StoryObj } from "@storybook/react";
import { docsLibraryKit } from "./docs-library.stories";

const meta: Meta = {
	title: "Docs/App hero",
	parameters: { layout: "fullscreen" },
};
export default meta;

const {
	AppShell,
	CONVERSATION_ID,
	assistant,
	at,
	installFetch,
	installWorldBridge,
	tool,
	useMacChrome,
	useStagedDraft,
	user,
} = docsLibraryKit;

const records = [
	user(
		"hero-user",
		"Reconcile the March invoices in `invoices/march.csv` — who still owes us, and write the summary to `reports/unpaid-march.md`.",
		65,
	),
	tool({
		id: "hero-read",
		ts: at(64),
		toolName: "read",
		intent: "Reading the March invoice export",
		args: { path: "invoices/march.csv" },
		output: "452 invoice rows loaded; grouped by customer and payment status.",
		durationS: 0.04,
	}),
	tool({
		id: "hero-sum",
		ts: at(64),
		toolName: "bash",
		intent: "Summing the unpaid rows by customer",
		args: { command: "python reconcile.py --group customer" },
		output: "Contoso: 4820.00\nFabrikam: 1150.00\nTotal: 5970.00",
		durationS: 1.3,
	}),
	assistant(
		"hero-result",
		"Two customers are outstanding at the end of March: **Contoso** — 4,820.00, and **Fabrikam** — 1,150.00, for **5,970.00** in total. Two Contoso rows are marked pending rather than unpaid and I have left them out of the total until you say otherwise. A writer is drafting `reports/unpaid-march.md` while a reviewer checks the arithmetic against the ledger export.",
		63,
	),
];

function HeroScene() {
	useMacChrome();
	useStagedDraft(
		CONVERSATION_ID,
		"Chase Contoso for the outstanding balance — draft the reminder email and show it to me before it sends.",
	);
	return (
		<AppShell
			records={records}
			rightPane="run"
			runPanelWidth={420}
			details={deriveRunDetails(runFixtures.bothInFlight())}
		/>
	);
}

export const Scene: StoryObj = {
	render: () => {
		installWorldBridge();
		installFetch();
		return <HeroScene />;
	},
};
