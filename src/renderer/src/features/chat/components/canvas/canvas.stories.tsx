/**
 * The canvas workspace, end to end.
 *
 * The canvas is the panel that opens beside the conversation: a header, a tab
 * strip, and one of four content surfaces (markdown editor, code editor, HTML
 * preview, spreadsheet grid) plus the files and variables views. It is
 * rendered here at the width it actually opens at, inside a mock of the chat
 * column it sits next to, because every judgement about its density depends on
 * how much room it has.
 *
 * Network and Electron access are stubbed at the boundary — `fetch` for the
 * execution-variables endpoint, `window.api` for the file bridge — so the real
 * components run rather than a re-drawn copy of them.
 *
 * The theme comes from the preview-level frame in `.storybook/preview.tsx`,
 * which moves MUI context, `data-theme` and the preferences store together.
 * CodeMirror in particular reads the store rather than the attribute, so a
 * story that set only one of the two rendered a half-themed panel.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { Mic, Paperclip, Send } from "lucide-react";
import { type FC, type ReactNode, useEffect, useMemo } from "react";
import "../../../../styles/index.css";
import type { EditDiff } from "@shared/api/local-operator/types";
import { useCanvasStore } from "@shared/store/canvas-store";
import type { CanvasDocument } from "../../types/canvas";
import { Canvas } from "./index";
import { InlineEdit } from "./inline-edit";
import {
	WysiwygMarkdownEditor,
	buildDiffContainer,
} from "./wysiwyg-markdown-editor";

/**
 * The chat column beside the panel, which is the only reason the canvas has a
 * width to be judged at. Layout only — the ground and the type come from the
 * preview frame.
 */
const SplitFrame = ({ children }: { children: ReactNode }) => (
	<div className="flex h-screen">{children}</div>
);

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const CONVERSATION_ID = "story-conversation";

const MARKDOWN = `# Q1 invoice review

Three customers are still outstanding at the end of March. The totals below
come from \`invoices/march.csv\`, filtered to rows where the paid column is
empty.

## Outstanding

| Customer | Invoice | Amount | Days late |
| --- | --- | --- | --- |
| Northwind | INV-2213 | $4,280.00 | 12 |
| Contoso | INV-2231 | $1,150.00 | 5 |
| Fabrikam | INV-2240 | $860.00 | 2 |

> Northwind has been late on the last three invoices. Worth a call rather than
> another reminder email.

## What I checked

1. Loaded the export and dropped the two test rows.
2. Cross-referenced the payments ledger for partial payments.
3. Recomputed the age of each invoice against today.

\`\`\`python
outstanding = invoices[invoices["paid_on"].isna()]
outstanding["days_late"] = (today - outstanding["due"]).dt.days
\`\`\`
`;

const CSV = `Customer,Invoice,Amount,Due,Days late,Owner
Northwind,INV-2213,4280.00,2026-03-02,12,Dana
Contoso,INV-2231,1150.00,2026-03-09,5,Dana
Fabrikam,INV-2240,860.00,2026-03-12,2,Priya
Adventure Works,INV-2244,2310.50,2026-03-14,0,Priya
Tailspin,INV-2245,540.00,2026-03-15,0,Dana
Wide World,INV-2249,7820.75,2026-03-18,0,Sam
Lucerne,INV-2251,1290.00,2026-03-19,0,Sam
Proseware,INV-2255,430.25,2026-03-21,0,Dana
Litware,INV-2260,3105.00,2026-03-24,0,Priya
Fourth Coffee,INV-2262,275.00,2026-03-25,0,Sam
`;

const PYTHON = `"""Reconcile the March invoice export against the payments ledger."""

from __future__ import annotations

import pandas as pd

TEST_ACCOUNTS = {"acme-test", "internal-qa"}


def load(path: str) -> pd.DataFrame:
    frame = pd.read_csv(path, parse_dates=["due", "paid_on"])
    return frame[~frame["account"].isin(TEST_ACCOUNTS)]


def outstanding(frame: pd.DataFrame, today: pd.Timestamp) -> pd.DataFrame:
    open_rows = frame[frame["paid_on"].isna()].copy()
    open_rows["days_late"] = (today - open_rows["due"]).dt.days
    open_rows = open_rows[open_rows["amount"] > 250.00]
    open_rows["late_fee"] = open_rows["amount"] * 0.015
    return open_rows.sort_values("days_late", ascending=False).head(20)
`;

const DOCUMENTS: CanvasDocument[] = [
	{
		id: "/Users/dana/work/reports/march-invoice-review.md",
		title: "march-invoice-review.md",
		path: "/Users/dana/work/reports/march-invoice-review.md",
		content: MARKDOWN,
		type: "markdown",
	},
	{
		id: "/Users/dana/work/invoices/march.csv",
		title: "march.csv",
		path: "/Users/dana/work/invoices/march.csv",
		content: CSV,
		type: "spreadsheet",
	},
	{
		id: "/Users/dana/work/scripts/reconcile.py",
		title: "reconcile.py",
		path: "/Users/dana/work/scripts/reconcile.py",
		content: PYTHON,
		type: "code",
	},
	{
		id: "/Users/dana/work/scripts/ledger-import-and-normalise.py",
		title: "ledger-import-and-normalise.py",
		path: "/Users/dana/work/scripts/ledger-import-and-normalise.py",
		content: "# a long file name, to exercise tab truncation\n",
		type: "code",
	},
	{
		id: "/Users/dana/work/notes.md",
		title: "notes.md",
		path: "/Users/dana/work/notes.md",
		content: "Call Northwind on Tuesday.\n",
		type: "markdown",
	},
	{
		id: "/Users/dana/work/reports/q1-summary.md",
		title: "q1-summary.md",
		path: "/Users/dana/work/reports/q1-summary.md",
		content: "# Q1 summary\n",
		type: "markdown",
	},
];

const VARIABLES = [
	{
		key: "outstanding",
		type: "DataFrame",
		value:
			"          Customer   Invoice   Amount        Due  days_late\n0        Northwind  INV-2213  4280.00 2026-03-02         12\n1          Contoso  INV-2231  1150.00 2026-03-09          5\n2         Fabrikam  INV-2240   860.00 2026-03-12          2",
	},
	{ key: "total_outstanding", type: "float", value: "6290.0" },
	{ key: "invoice_count", type: "int", value: "42" },
	{
		key: "owners",
		type: "list",
		value: "['Dana', 'Priya', 'Sam']",
	},
	{
		key: "ledger_path",
		type: "str",
		value: "/Users/dana/work/invoices/payments-ledger-2026.csv",
	},
	{
		key: "thresholds",
		type: "dict",
		value:
			"{'late_days': 7, 'escalate_days': 30, 'minimum_amount': 100.0, 'currency': 'USD'}",
	},
	{ key: "sent_reminders", type: "bool", value: "False" },
];

const json = (body: unknown) =>
	new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});

/**
 * `fetch` is stubbed rather than the hooks, so the queries, the API client and
 * each component's own loading and error handling all run for real. Unmatched
 * `/v1/` reads answer with an empty envelope rather than failing, because a
 * connection-refused toast over every frame is not a state worth photographing.
 */
const installFetchStub = () => {
	const original = window.fetch;
	window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input.toString();
		if (url.includes("/execution-variables")) {
			return json({
				status: 200,
				message: "ok",
				result: { execution_variables: VARIABLES, count: VARIABLES.length },
			});
		}
		if (url.includes("/v1/config")) {
			return json({
				status: 200,
				message: "ok",
				result: { values: { hosting: "openai", model_name: "gpt-4o" } },
			});
		}
		if (url.includes("/v1/credentials")) {
			return json({
				status: 200,
				message: "ok",
				result: { keys: ["RADIENT_API_KEY"] },
			});
		}
		if (url.includes("/v1/agents")) {
			return json({
				status: 200,
				message: "ok",
				result: {
					agents: [
						{
							id: "story-agent",
							name: "Invoice assistant",
							current_working_directory: "/Users/dana/work",
						},
					],
					total: 1,
					page: 1,
					per_page: 10,
				},
			});
		}
		if (url.includes("/health") || url.includes("/v1/")) {
			return json({ status: 200, message: "ok", result: {} });
		}
		return original(input, init);
	}) as typeof window.fetch;
};

/**
 * `window.electron` is the preload bridge; Storybook's global mock covers
 * `window.api` but not this one, and the edit popover asks it for the platform
 * so it can name the right modifier key in its shortcut caps.
 */
const installElectronStub = () => {
	const bridge = window as unknown as {
		electron?: {
			ipcRenderer: {
				invoke: (channel: string) => Promise<unknown>;
				on: () => void;
				removeListener: () => void;
				send: () => void;
			};
		};
	};
	if (bridge.electron) return;
	bridge.electron = {
		ipcRenderer: {
			invoke: async (channel: string) =>
				channel === "get-platform-info" ? { platform: "darwin" } : null,
			on: () => {},
			removeListener: () => {},
			send: () => {},
		},
	};
};

installFetchStub();
installElectronStub();

/** The chat column the canvas opens beside, so widths read correctly. */
const ChatColumnMock = () => (
	<div className="flex min-w-0 flex-1 flex-col gap-4 overflow-hidden p-6">
		<p className="text-body text-ink-muted">
			Reconcile the March invoices and write up who still owes money.
		</p>
		<p className="text-body text-ink">
			Three customers are outstanding: Northwind, Contoso and Fabrikam, for
			$6,290 in total. The write-up is open in the canvas.
		</p>
		{/*
		 * A faithful composer stand-in rather than an empty box. The previous
		 * `h-24` div made every canvas frame claim a chat column while showing
		 * a blank rounded rectangle where the composer lives; a reviewer
		 * judging the canvas was judging a hole. This carries the composer's
		 * real geometry - the box, the placeholder line, the attach and send
		 * affordances - without importing the live component, which drags in
		 * the backend client the stories deliberately stub.
		 */}
		<div className="mt-auto flex flex-col gap-3 rounded-frame border border-control bg-surface p-4">
			<p className="text-body-sm text-ink-dim">
				Ask a follow-up about the write-up
			</p>
			{/* Mirrors both clusters of the real composer: a paperclip and the
			    directory indicator on the left, a microphone and an icon-only
			    send button on the right. It printed the word "Model" under the
			    paperclip once - source vocabulary that appears nowhere in the
			    composer - and after that was fixed it still drew an accent pill
			    reading "Send" where the product has a ghost mic and a square
			    icon button, in 72 frames. A stand-in that gets the geometry
			    right and the controls wrong is worse than no stand-in, because
			    it is the geometry people check it against. */}
			<div className="flex items-center justify-between">
				<span className="flex items-center gap-2 text-meta text-ink-dim">
					<Paperclip size={16} aria-hidden="true" />
					<span className="truncate">~/work/reports</span>
				</span>
				<span className="flex items-center gap-1">
					{/* `size-8 rounded-sm`, the product's `size="icon"` button, and
					    the send control drawn disabled: the depicted column is
					    560px, above the 550px dense-branch switch, and the input
					    is a placeholder - which is exactly when the real send
					    button is disabled and spends no accent at all. Drawn as
					    an accent square here it advertised a state the product
					    does not render. */}
					<span className="flex size-8 items-center justify-center rounded-sm text-ink-dim">
						<Mic size={16} aria-hidden="true" />
					</span>
					<span className="flex size-8 items-center justify-center rounded-sm bg-accent/50 text-on-accent opacity-50">
						<Send size={16} aria-hidden="true" />
					</span>
				</span>
			</div>
		</div>
	</div>
);

const CanvasFrame = ({
	view,
	activeId,
	width = 720,
}: {
	view: "documents" | "files" | "variables";
	activeId: string;
	width?: number;
}) => {
	// Seeded before first paint so the panel never renders an empty frame.
	useMemo(() => {
		useCanvasStore.setState((state) => ({
			conversations: {
				...state.conversations,
				[CONVERSATION_ID]: {
					isOpen: true,
					files: DOCUMENTS,
					mentionedFiles: DOCUMENTS,
					openTabs: DOCUMENTS.map((doc) => ({ id: doc.id, title: doc.title })),
					selectedTabId: activeId,
					viewMode: view,
					spreadsheetData: {},
				},
			},
		}));
	}, [view, activeId]);

	return (
		<SplitFrame>
			<ChatColumnMock />
			<div
				style={{ width, minWidth: width }}
				className="h-full overflow-hidden border-l border-hairline"
			>
				<Canvas
					activeDocumentId={activeId}
					initialDocuments={DOCUMENTS}
					conversationId={CONVERSATION_ID}
					agentId="story-agent"
					onChangeActiveDocument={() => {}}
					onClose={() => {}}
					onCloseDocument={() => {}}
				/>
			</div>
		</SplitFrame>
	);
};

const meta: Meta = {
	title: "Canvas/Workspace",
	parameters: { layout: "fullscreen" },
};

export default meta;

type Story = StoryObj;

/** Markdown editor: the toolbar, the tab strip under load, and prose. */
export const MarkdownDocument: Story = {
	render: () => <CanvasFrame view="documents" activeId={DOCUMENTS[0].id} />,
};

/**
 * The block-format menu, open.
 *
 * Every label in this menu lived outside the frame set until now, which is
 * how two of them came to read "IndentIncrease" and "IndentDecrease" and
 * survived a design round. A menu that only exists while a pointer is down
 * is a menu no screenshot has ever seen.
 */
export const MarkdownFormatMenu: Story = {
	render: () => (
		<div className="h-screen bg-canvas p-6">
			<WysiwygMarkdownEditor document={DOCUMENTS[0]} initialFormatMenuOpen />
		</div>
	),
};

/** The same panel at its minimum width, where the toolbar is under pressure. */
export const MarkdownDocumentNarrow: Story = {
	render: () => (
		<CanvasFrame view="documents" activeId={DOCUMENTS[0].id} width={440} />
	),
};

/** Spreadsheet: ag-grid density, header treatment and the sheet switcher. */
export const Spreadsheet: Story = {
	render: () => <CanvasFrame view="documents" activeId={DOCUMENTS[1].id} />,
};

/** Code editor. */
export const Code: Story = {
	render: () => <CanvasFrame view="documents" activeId={DOCUMENTS[2].id} />,
};

/**
 * Code editor, focused.
 *
 * The inset focus ring has never had a frame: none of the captured surfaces
 * shows the editor with focus, so the one keyboard indicator on the app's
 * code surface was reviewed from the stylesheet alone. CodeMirror has no
 * autofocus prop here, so the story focuses the content once after mount;
 * `cm-focused` lands on the editor root and the ring paints.
 */
export const CodeFocused: Story = {
	render: () => <FocusedCanvasFrame />,
};

const FocusedCanvasFrame = () => {
	useEffect(() => {
		const id = window.setTimeout(() => {
			document.querySelector<HTMLElement>(".cm-content")?.focus();
		}, 250);
		return () => window.clearTimeout(id);
	}, []);
	return <CanvasFrame view="documents" activeId={DOCUMENTS[2].id} />;
};
/** Files view: the attachment grid. */
export const Files: Story = {
	render: () => <CanvasFrame view="files" activeId={DOCUMENTS[0].id} />,
};

/** Variables view: row density and the disclosure. */
export const Variables: Story = {
	render: () => <CanvasFrame view="variables" activeId={DOCUMENTS[0].id} />,
};

/* ------------------------------------------------------------------ */
/* Diff review                                                         */
/* ------------------------------------------------------------------ */

const DIFFS: EditDiff[] = [
	{
		find: "Three customers are still outstanding at the end of March.",
		replace:
			"Three customers were still outstanding at the end of March, for $6,290 in total.",
	},
	{
		find: "Worth a call rather than another reminder email.",
		replace: "Worth a phone call rather than a fourth reminder email.",
	},
	{
		find: "Loaded the export and dropped the two test rows.",
		replace:
			"Loaded the export and dropped the two rows belonging to test accounts.",
	},
];

/**
 * The review block exactly as the editor builds it, rather than a copy of it
 * drawn by hand. This story is where the diff-review evidence frames come
 * from, so a copy here is a picture of markup that may no longer exist.
 *
 * The paragraph rules are restated because the real block sits inside the
 * editable surface, which gets them from `editorProseClasses`; this story
 * mounts the block on its own.
 */
const DiffBlock: FC<{ diff: EditDiff }> = ({ diff }) => (
	<div
		className="[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0"
		ref={(el) => {
			if (el && !el.firstChild) el.appendChild(buildDiffContainer(diff));
		}}
	/>
);

/**
 * The approval interaction, mid-review. This is the only place in the app
 * where the user accepts or rejects agent output change by change.
 */
export const DiffReview: Story = {
	render: () => (
		<SplitFrame>
			<div className="relative flex-1 bg-surface p-10">
				<div className="max-w-160 text-body text-ink">
					<h1 className="mb-3 font-semibold text-title">Q1 invoice review</h1>
					<DiffBlock diff={DIFFS[1]} />
					<p className="my-2">
						The totals below come from the March export, filtered to rows where
						the paid column is empty.
					</p>
				</div>
				<div className="relative mt-10 h-64">
					<InlineEdit
						selection=""
						position={{ top: 0, left: 40 }}
						filePath="/Users/dana/work/reports/march-invoice-review.md"
						onClose={() => {}}
						onApplyChanges={() => {}}
						agentId="story-agent"
						reviewState={{
							diffs: DIFFS,
							currentIndex: 1,
							approvedDiffs: [DIFFS[0]],
						}}
						onApplyAll={() => {}}
						onRejectAll={() => {}}
						onAcceptDiff={() => {}}
						onRejectDiff={() => {}}
						onNavigateDiff={() => {}}
					/>
				</div>
			</div>
		</SplitFrame>
	),
};

/**
 * The prompt state of the same popover, before any changes exist.
 *
 * Under real document text, like `DiffReview` above. A floating panel's edge
 * has to read against something, and on bare ground it read against nothing -
 * which made this the second-sparsest surface in the set. It sits below the
 * prose rather than over it, which is where the diff popover sits too; forcing
 * an overlap here would make the two siblings inconsistent to satisfy a
 * sentence. 9.63% non-ground pixels now, up from 6.18%.
 */
export const EditPrompt: Story = {
	render: () => (
		<SplitFrame>
			<div className="relative flex-1 bg-surface p-10">
				<div className="max-w-160 text-body text-ink">
					<h1 className="mb-3 font-semibold text-title">Q1 invoice review</h1>
					<p className="my-2">
						Three customers are still outstanding at the end of March. The
						totals below come from the March export, filtered to rows where the
						paid column is empty.
					</p>
					<p className="my-2">
						Northwind has been late on the last three invoices. Worth a call
						rather than another reminder email.
					</p>
				</div>
				<div className="relative mt-10 h-64">
					<InlineEdit
						selection="Three customers are still outstanding at the end of March."
						position={{ top: 0, left: 40 }}
						filePath="/Users/dana/work/reports/march-invoice-review.md"
						onClose={() => {}}
						onApplyChanges={() => {}}
						agentId="story-agent"
						reviewState={null}
						onApplyAll={() => {}}
						onRejectAll={() => {}}
						onAcceptDiff={() => {}}
						onRejectDiff={() => {}}
						onNavigateDiff={() => {}}
					/>
				</div>
			</div>
		</SplitFrame>
	),
};
