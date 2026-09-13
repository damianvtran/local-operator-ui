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
import type { MentionScanHandle } from "../../canonical/use-mentioned-files";
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

/*
 * The Files view's fixture, and every state the grid has rules about.
 *
 * A tile's layout depends on more than its own document: the second line
 * appears only when two VISIBLE tiles share a basename, and the missing receipt
 * only for a document whose probe said the bytes are gone. So the fixture has
 * to carry a collision, a deletion and one of each viewer kind, or the story
 * renders the easy case and proves nothing about the other three.
 *
 * - two `summary.md` in different directories: the basename-collision line, and
 *   the pair the old grid silently merged into one tile.
 * - `february.csv` with `availability: "missing"`: the receipt, and a tile that
 *   must keep its place rather than being filtered out.
 * - `q1-invoice-review.pdf`, `dashboard.png`, `todo.txt`: a PDF (its own new
 *   viewer), an image, and a `.txt` - the type the app used to refuse and hand
 *   to the OS instead of opening in its own editor.
 *
 * One caveat for whoever captures frames from this story: the image tile's
 * thumbnail comes from the backend's static route, as every image thumbnail in
 * this panel does, so with no backend listening the PNG tile renders its name,
 * its directory line and a broken image box. That is a fixture artifact, not
 * the panel's behaviour - which is why the design's PDF and image frames come
 * from the real app rather than from the storybook sweep.
 */
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
	{
		id: "/Users/dana/work/reports/summary.md",
		title: "summary.md",
		path: "/Users/dana/work/reports/summary.md",
		content: "",
		type: "markdown",
		availability: "present",
	},
	{
		id: "/Users/dana/work/archive/summary.md",
		title: "summary.md",
		path: "/Users/dana/work/archive/summary.md",
		content: "",
		type: "markdown",
		availability: "present",
	},
	{
		id: "/Users/dana/work/invoices/february.csv",
		title: "february.csv",
		path: "/Users/dana/work/invoices/february.csv",
		content: "",
		type: "spreadsheet",
		availability: "missing",
	},
	{
		id: "/Users/dana/work/reports/q1-invoice-review.pdf",
		title: "q1-invoice-review.pdf",
		path: "/Users/dana/work/reports/q1-invoice-review.pdf",
		content: "",
		type: "pdf",
		availability: "present",
		sizeBytes: 348_512,
	},
	{
		id: "/Users/dana/work/shots/dashboard.png",
		title: "dashboard.png",
		path: "/Users/dana/work/shots/dashboard.png",
		content: "",
		type: "image",
		availability: "present",
		sizeBytes: 96_204,
	},
	{
		id: "/Users/dana/work/notes/todo.txt",
		title: "todo.txt",
		path: "/Users/dana/work/notes/todo.txt",
		content: "",
		type: "text",
		availability: "present",
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
					    button is disabled and spends no accent at all - it draws
					    `bg-sunken text-ink-disabled`, a neutral chip, which is
					    what this copies.

					    Every glyph is 16, which is what the product RENDERS
					    rather than what its source asks for: composer icons sit
					    inside `<Button size="icon">`, and `button.tsx` puts
					    `[&_svg]:size-4` on that variant, which overrides the
					    SVG's own width and height. So the `size={iconSize}` and
					    `Math.round(iconSize * 0.8)` in `message-input.tsx` never
					    reach the screen, and copying those numbers here - as an
					    earlier version of this comment did, from the source -
					    drew a composer the app does not draw. Bare spans have no
					    such rule, so the attribute is the rendered size. */}
					<span className="flex size-8 items-center justify-center rounded-sm text-ink-dim">
						<Mic size={16} aria-hidden="true" />
					</span>
					<span className="flex size-8 items-center justify-center rounded-sm bg-sunken text-ink-disabled">
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
	scan = null,
	mentionedFiles = DOCUMENTS,
}: {
	view: "documents" | "files" | "variables";
	activeId: string;
	width?: number;
	/**
	 * The completeness state of the Files scan, for the stories that exist to show
	 * what the panel head says while it is paging, when it stops short, and when it
	 * stops short having found nothing.
	 */
	scan?: MentionScanHandle | null;
	/**
	 * What the Files grid holds, for the one state it holds nothing in: a scan that
	 * stopped short with no file mention inside the messages it read. The panel
	 * must still render its head there - the count of what was searched and the one
	 * action that reads the rest - so the story has to be able to seed an empty grid
	 * (`canvas-file-viewer`'s empty-state guard, round 2 R2-1).
	 */
	mentionedFiles?: CanvasDocument[];
}) => {
	// Seeded before first paint so the panel never renders an empty frame.
	useMemo(() => {
		useCanvasStore.setState((state) => ({
			conversations: {
				...state.conversations,
				[CONVERSATION_ID]: {
					isOpen: true,
					files: DOCUMENTS,
					mentionedFiles,
					openTabs: DOCUMENTS.map((doc) => ({ id: doc.id, title: doc.title })),
					selectedTabId: activeId,
					viewMode: view,
					spreadsheetData: {},
				},
			},
		}));
	}, [view, activeId, mentionedFiles]);

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
					scan={scan}
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
						fileContent="Three customers are still outstanding at the end of March."
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
						fileContent="Three customers are still outstanding at the end of March."
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

/* ------------------------------------------------------------------ */
/* The four media viewers                                              */
/* ------------------------------------------------------------------ */

/**
 * Bytes for the four media viewers, so their stories are REVIEWABLE.
 *
 * The three viewers that read over IPC cannot render in Storybook without a
 * `readFileBytes` answer, and a viewer story that shows only its "Opening…"
 * state is a story nobody can judge. The bytes are built here rather than
 * committed as assets: a one-page PDF, a 2s 440Hz WAV and a canvas-drawn PNG are
 * each a dozen lines and none of them is a binary blob in the repository that a
 * reviewer has to trust.
 *
 * This is a FIXTURE, not a claim about the app: in the app the bytes come from
 * the main process, and the frames that prove the real read path are live-app
 * frames. `preview.tsx`'s global mock is installed by the decorator, which runs
 * after this module is imported, so the stub is installed per render rather than
 * at import time (an import-time install would be overwritten by the decorator).
 */
const VIEWER_CONVERSATION_ID = "story-viewer-conversation";

/** A minimal but valid one-page PDF, with its xref offsets computed as it is built. */
const pdfBytes = (): Uint8Array => {
	const chunks: string[] = [];
	const offsets: number[] = [];
	const push = (text: string) => {
		chunks.push(text);
	};
	const startObject = () => {
		offsets.push(chunks.join("").length);
	};
	// `%PDF-1.4` and a binary comment line, which tell a viewer this is a PDF.
	push("%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n");

	const object = (body: string) => {
		startObject();
		push(body);
	};

	object("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
	object("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
	object(
		"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 220] " +
			"/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n",
	);
	const content =
		"BT /F1 18 Tf 40 140 Td (Local Operator) Tj ET\n" +
		"BT /F1 12 Tf 40 110 Td (Files panel - PDF viewer) Tj ET\n" +
		"0.2 0.4 0.9 rg 40 60 340 12 re f\n";
	object(
		`4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`,
	);
	object(
		"5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
	);

	const xrefOffset = chunks.join("").length;
	push("xref\n0 6\n0000000000 65535 f \n");
	for (const offset of offsets)
		push(`${String(offset).padStart(10, "0")} 00000 n \n`);
	push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

	const text = chunks.join("");
	const out = new Uint8Array(text.length);
	for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
	return out;
};

/** A 320x200 PNG, drawn here so the frame shows a picture rather than a box. */
const pngBytes = (): Uint8Array => {
	const canvas = document.createElement("canvas");
	canvas.width = 320;
	canvas.height = 200;
	const context = canvas.getContext("2d");
	if (!context) return new Uint8Array();
	const gradient = context.createLinearGradient(0, 0, 320, 200);
	gradient.addColorStop(0, "#1f6feb");
	gradient.addColorStop(1, "#7ee787");
	context.fillStyle = gradient;
	context.fillRect(0, 0, 320, 200);
	context.fillStyle = "rgba(255,255,255,0.92)";
	context.font = "16px sans-serif";
	context.fillText("dashboard.png", 16, 32);
	const base64 = canvas.toDataURL("image/png").split(",")[1] ?? "";
	return base64ToBytes(base64);
};

/** Two seconds of 440Hz, as a real RIFF/WAVE file the audio element can decode. */
const wavBytes = (): Uint8Array => {
	const sampleRate = 8000;
	const samples = sampleRate * 2;
	const buffer = new ArrayBuffer(44 + samples * 2);
	const view = new DataView(buffer);
	const ascii = (offset: number, text: string) => {
		for (let i = 0; i < text.length; i += 1)
			view.setUint8(offset + i, text.charCodeAt(i));
	};
	ascii(0, "RIFF");
	view.setUint32(4, 36 + samples * 2, true);
	ascii(8, "WAVE");
	ascii(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	ascii(36, "data");
	view.setUint32(40, samples * 2, true);
	for (let i = 0; i < samples; i += 1)
		view.setInt16(
			44 + i * 2,
			Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 12000),
			true,
		);
	return new Uint8Array(buffer);
};

const base64ToBytes = (base64: string): Uint8Array => {
	const binary = atob(base64);
	const out = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
	return out;
};

/** One stub, answering by extension, installed once per render. */
const installViewerBytes = () => {
	const api = (window as unknown as { api?: Record<string, unknown> }).api;
	if (!api) return;
	const cache = new Map<string, Uint8Array>();
	const bytesFor = (path: string): Uint8Array | null => {
		const key = path.endsWith(".pdf")
			? "pdf"
			: path.endsWith(".png")
				? "png"
				: path.endsWith(".wav")
					? "wav"
					: null;
		if (!key) return null;
		const cached = cache.get(key);
		if (cached) return cached;
		const built =
			key === "pdf" ? pdfBytes() : key === "png" ? pngBytes() : wavBytes();
		cache.set(key, built);
		return built;
	};
	api.readFileBytes = async (path: string) => {
		const bytes = bytesFor(path);
		if (!bytes)
			return { success: false, code: "not-found", error: `No file at ${path}` };
		return { success: true, data: bytes, sizeBytes: bytes.byteLength };
	};
};

const viewerDocument = (
	path: string,
	title: string,
	type: CanvasDocument["type"],
	sizeBytes: number,
): CanvasDocument => ({
	id: path,
	title,
	path,
	content: "",
	type,
	availability: "present",
	sizeBytes,
	lastAgentModified: 1_760_000_000_000,
});

const PDF_DOCUMENT = viewerDocument(
	"/Users/dana/work/reports/q1-invoice-review.pdf",
	"q1-invoice-review.pdf",
	"pdf",
	1024,
);
const IMAGE_DOCUMENT = viewerDocument(
	"/Users/dana/work/shots/dashboard.png",
	"dashboard.png",
	"image",
	3200,
);
const AUDIO_DOCUMENT = viewerDocument(
	"/Users/dana/work/audio/tone.wav",
	"tone.wav",
	"audio",
	32_044,
);
const VIDEO_DOCUMENT = viewerDocument(
	"/Users/dana/work/clips/clip.mp4",
	"clip.mp4",
	"video",
	48_000,
);

/**
 * One document, opened, in the dock at its real width.
 *
 * A separate frame from `CanvasFrame` because these stories are about the VIEWER
 * surface rather than the panel: the tabs hold one document, the view is
 * `documents`, and the file list is the same one entry so a reviewer sees what a
 * user sees after clicking a tile.
 */
const ViewerFrame = ({ document }: { document: CanvasDocument }) => {
	useMemo(() => {
		installViewerBytes();
		useCanvasStore.setState((state) => ({
			conversations: {
				...state.conversations,
				[VIEWER_CONVERSATION_ID]: {
					isOpen: true,
					files: [document],
					mentionedFiles: [document],
					openTabs: [{ id: document.id, title: document.title }],
					selectedTabId: document.id,
					viewMode: "documents",
					spreadsheetData: {},
				},
			},
		}));
	}, [document]);

	return (
		<SplitFrame>
			<ChatColumnMock />
			<div
				style={{ width: 720, minWidth: 720 }}
				className="h-full overflow-hidden border-l border-hairline"
			>
				<Canvas
					activeDocumentId={document.id}
					initialDocuments={[document]}
					conversationId={VIEWER_CONVERSATION_ID}
					agentId="story-agent"
					onChangeActiveDocument={() => {}}
					onClose={() => {}}
					onCloseDocument={() => {}}
				/>
			</div>
		</SplitFrame>
	);
};

/**
 * PDF, in Chromium's viewer over a blob URL, under our own name bar.
 *
 * Proof that the frame is real rather than an empty blob: the page counter is
 * gone by design (`#toolbar=0`, see `pdf-preview`), so the document itself -
 * heading, subheading and the accent rule - is drawn by Chromium from the bytes.
 */
export const PdfViewer: Story = {
	render: () => <ViewerFrame document={PDF_DOCUMENT} />,
};

/** Image, with the name bar every media viewer now carries. */
export const ImageViewer: Story = {
	render: () => <ViewerFrame document={IMAGE_DOCUMENT} />,
};

/** Audio: a real 2s waveform the platform player can seek and play. */
export const AudioViewer: Story = {
	render: () => <ViewerFrame document={AUDIO_DOCUMENT} />,
};

/**
 * Video, in the one state this harness can honestly produce.
 *
 * The video viewer is the viewer that reads over the BACKEND's Range route
 * rather than over IPC (a blob would pull a whole video through structured
 * clone before the first frame), so with no backend listening it shows its own
 * failure state. That state is part of the surface - the chrome bar, the name,
 * the `Open in default app` action and the sentence - so it is captured; the
 * playable frame comes from the live app.
 */
export const VideoViewer: Story = {
	render: () => <ViewerFrame document={VIDEO_DOCUMENT} />,
};

/**
 * The Files panel mid-scan.
 *
 * The panel pages the conversation's own older history when it opens, and this
 * is what that reads as: the count that is already known, and a line saying that
 * earlier messages are still being read. Sized to the panel, not a picture of an
 * empty grid.
 */
export const FilesScanning: Story = {
	render: () => (
		<CanvasFrame
			view="files"
			activeId={DOCUMENTS[0].id}
			scan={{
				active: true,
				scanned: 1180,
				hasMore: true,
				paging: true,
				stopped: false,
				resume: () => {},
			}}
		/>
	),
};

/**
 * The Files panel stopped at its scan budget.
 *
 * The honest end of the scan: the head states which messages were searched, and
 * the action that searches the rest sits beside it. Nothing is dropped silently
 * - this frame and the one above it are the difference between a bound that is
 * disclosed and a bound that lies.
 */
export const FilesScanStopped: Story = {
	render: () => (
		<CanvasFrame
			view="files"
			activeId={DOCUMENTS[0].id}
			scan={{
				active: true,
				scanned: 2400,
				hasMore: true,
				paging: false,
				stopped: true,
				resume: () => {},
			}}
		/>
	),
};

/**
 * The Files panel stopped at its scan budget with nothing to show.
 *
 * The state the panel used to lie about: no file mention inside the messages the
 * scan read, and earlier messages it never reached. The grid is empty and the
 * head is the whole surface - which is the point, because the head is where the
 * count of what was searched and the only `Search earlier messages` action live.
 * An empty grid here is NOT "no files yet": that line belongs to a conversation
 * whose transcript has been read, and it carries no route to the rest of it
 * (round 2, R2-1).
 */
export const FilesScanStoppedEmpty: Story = {
	render: () => (
		<CanvasFrame
			view="files"
			activeId={DOCUMENTS[0].id}
			mentionedFiles={[]}
			scan={{
				active: true,
				scanned: 2400,
				hasMore: true,
				paging: false,
				stopped: true,
				resume: () => {},
			}}
		/>
	),
};
