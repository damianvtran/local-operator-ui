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
 * desktop transport (`POST /__desktop`, which is where every op lands in
 * Storybook) and `window.api` for the file bridge — so the real components run
 * rather than a re-drawn copy of them. Each variables story answers a
 * different backend state through that one seam, which is what makes the
 * panel's states photographable at all.
 *
 * The theme comes from the preview-level frame in `.storybook/preview.tsx`,
 * which moves MUI context, `data-theme` and the preferences store together.
 * CodeMirror in particular reads the store rather than the attribute, so a
 * story that set only one of the two rendered a half-themed panel.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { fireEvent, screen, userEvent, waitFor, within } from "@storybook/test";
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
 *   the pair the old grid silently merged into one tile. This is also the only
 *   committed frame of `displayParent`: the line is shortened from the LEFT, so
 *   the segment that tells the two apart survives at the tile's width (design
 *   round 1, D1). The scan-state stories render this same fixture, so theirs show
 *   the line too.
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

/*
 * A session's namespace as the backend renders it.
 *
 * `editable` is the backend's own judgement, computed from the same table it
 * coerces writes with: `DataFrame` is memory the panel must list and cannot
 * replace, and the other six keep the edit affordance. Nothing here is a local
 * list of type names - the panel no longer has one.
 */
const VARIABLES = [
	{
		key: "outstanding",
		type: "DataFrame",
		value:
			"          Customer   Invoice   Amount        Due  days_late\n0        Northwind  INV-2213  4280.00 2026-03-02         12\n1          Contoso  INV-2231  1150.00 2026-03-09          5\n2         Fabrikam  INV-2240   860.00 2026-03-12          2",
		editable: false,
		truncated: false,
	},
	{
		key: "total_outstanding",
		type: "float",
		value: "6290.0",
		editable: true,
		truncated: false,
	},
	{
		key: "invoice_count",
		type: "int",
		value: "42",
		editable: true,
		truncated: false,
	},
	{
		key: "owners",
		type: "list",
		value: "['Dana', 'Priya', 'Sam']",
		editable: true,
		truncated: false,
	},
	{
		key: "ledger_path",
		type: "str",
		value: "/Users/dana/work/invoices/payments-ledger-2026.csv",
		editable: true,
		truncated: false,
	},
	{
		key: "thresholds",
		type: "dict",
		value:
			"{'late_days': 7, 'escalate_days': 30, 'minimum_amount': 100.0, 'currency': 'USD'}",
		editable: true,
		truncated: false,
	},
	{
		key: "sent_reminders",
		type: "bool",
		value: "False",
		editable: true,
		truncated: false,
	},
];

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});

/** The session id the variables stories read, in the wire's own shape (12 hex). */
const STORY_SESSION_ID = "8fd6c6a40934";

/** The dialog's name field, found by its label. */
const VARIABLE_KEY_LABEL = /Name \(key\)/;
/** The refusal the backend answers with, as the toast renders it. */
const REFUSAL_SENTENCE = /'secrets' is a name the session keeps/;

/**
 * Hold the shutter until the story says the frame is worth taking.
 *
 * The capturer polls `documentElement.dataset.capturePending` before it
 * screenshots (see `scripts/capture-evidence.mjs`), and a story that sets it on
 * mount keeps every theme's frame on the far side of its own interaction. Story
 * effects that end with a rendered result MUST use this: without it the shutter
 * races the effect, and the same story produces a frame with the result in one
 * theme and without it in the next. That is exactly what happened to
 * `VariablesWriteRefused` in design round 1 (D1): the toast was in seven themes'
 * frames and missing from five, so a frame named for the refusal did not
 * evidence one.
 */
const holdShutter = () => {
	document.documentElement.dataset.capturePending = "1";
};

/** Let the shutter go, once the state under test is on screen. */
const releaseShutter = () => {
	delete document.documentElement.dataset.capturePending;
};

/**
 * One answer from the stub, as the BACKEND would give it: a status plus the
 * envelope body. Refusals carry `detail.code`/`detail.message`, which is the
 * shape `desktopResult` lifts a write's sentence out of.
 *
 * It is not the shape the renderer receives. Both real transports - main's IPC
 * call and the dev server's `/__desktop` proxy - answer with
 * `{status: <backend status>, body: <this envelope>}`, so `respond` below wraps
 * every answer in that second layer. Skipping it is silent: the query resolves
 * `undefined` and React Query reports "data is undefined" over the panel's copy
 * for an unreachable backend, which is a picture of nothing this app ships.
 */
type DesktopAnswer = { status: number; body: unknown };

const ok = (result: unknown): DesktopAnswer => ({
	status: 200,
	body: { status: 200, message: "ok", result },
});

/**
 * One answer from a CODE-MEMORY route, in the shape those routes really send.
 *
 * This is the fix for review round 1's Q-2: the four routes answer
 * `result: {data: <state>, replayed: false}`, one level inside what
 * `desktopResult` hands back, and the stories used to answer `result: <state>` -
 * the single shape for which a read path that never unwraps `data` works. So a
 * green fixture certified a contract the backend does not send, and a frame of a
 * populated namespace looked right while the shipping panel read `undefined` and
 * rendered "Nothing stored yet" (C-01/Q-1/U1). Every variables answer goes
 * through here now, so no story can express a shape the routes never produce.
 *
 * `ok` is still what the capability probe uses: `/v1/capabilities` is a plain
 * route whose `result` IS the object, and it is deliberately not routed through
 * this.
 */
const variablesEnvelope = (data: unknown): DesktopAnswer =>
	ok({ data, replayed: false });

const refused = (
	status: number,
	code: string,
	message: string,
): DesktopAnswer => ({
	status,
	body: { detail: { code, message } },
});

/**
 * The transport's own response: the backend's status and envelope, wrapped.
 *
 * The HTTP status stays 200 because that is what both real transports return to
 * the renderer - a refusal is a `status` INSIDE the envelope, which is what
 * lets `desktopResult` lift `detail.message` and what keeps a 409 from being
 * mistaken for a dead backend.
 */
const respond = (answer: DesktopAnswer) =>
	json({ status: answer.status, body: answer.body });

const observed = (
	variables: unknown[],
	over: {
		runtime?: "running" | "absent";
		kernel?: "resident" | "absent";
		truncated?: boolean;
	} = {},
): DesktopAnswer =>
	variablesEnvelope({
		state: "observed",
		runtime: over.runtime ?? "running",
		kernel: over.kernel ?? "resident",
		variables,
		truncated: over.truncated ?? false,
	});

/**
 * What this story's desktop ops answer, replaced per story.
 *
 * `features` is the capabilities map. Leaving `session_variables` out of it is
 * what an older backend looks like, and it is a state worth photographing
 * rather than an error: the panel must offer the update instead of calling a
 * route that is not there. Everything else is answered by `op`, so a story can
 * put the panel in a state no live session can be talked into - a kernel that
 * was released after sitting idle, a namespace mutated while it was read.
 */
type DesktopAnswers = {
	list: () => DesktopAnswer;
	features?: Record<string, number>;
	write?: (op: string, request: Record<string, unknown>) => DesktopAnswer;
};

let desktopAnswers: DesktopAnswers = {
	features: { session_variables: 1 },
	list: () => observed(VARIABLES),
};

/**
 * `fetch` is stubbed rather than the hooks, so the schema, the transport, the
 * query cache and each component's own loading and error handling all run for
 * real. Every desktop op arrives at one place in Storybook - the transport
 * finds no `window.api.desktop` and posts the op's body to `/__desktop` - so
 * the answers are picked out of the body's `op`. Unmatched `/v1/` reads answer
 * with an empty envelope rather than failing, because a connection-refused
 * toast over every frame is not a state worth photographing.
 */
const installFetchStub = () => {
	const original = window.fetch;
	window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input.toString();
		if (url.includes("/__desktop")) {
			const request = JSON.parse(String(init?.body ?? "{}")) as {
				op?: string;
			};
			if (request.op === "capabilities") {
				return respond(
					ok({
						// The wire shape `DesktopCapabilities` declares, all four
						// fields: `desktopFeatureEnabled` reads `desktop_available`
						// AND the feature's version, so a reply that omitted either
						// would gate every surface off rather than one.
						desktop_contract: 1,
						desktop_available: true,
						desktop_auth: "bearer",
						features: desktopAnswers.features ?? {},
					}),
				);
			}
			if (request.op === "sessions.variables.list") {
				return respond(desktopAnswers.list());
			}
			if (request.op?.startsWith("sessions.variables.")) {
				return respond(
					desktopAnswers.write?.(request.op, request) ??
						variablesEnvelope({ state: "ok" }),
				);
			}
			return respond(ok({}));
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
	variables,
	sessionId = STORY_SESSION_ID,
}: {
	view: "documents" | "files" | "variables";
	activeId: string;
	width?: number;
	/**
	 * What this frame's desktop ops answer, replaced per frame.
	 *
	 * A module-level slot rather than a prop drilled into the panel: the panel
	 * reaches the backend through the transport, and the transport is what the
	 * stub stands in for - so a story expresses a backend state, not a
	 * component's prop. Set during render, after the import-time install, so
	 * one story cannot leak its state into the next.
	 */
	variables?: DesktopAnswers;
	/**
	 * The canonical session the code-memory panel reads, or `null` for a staged
	 * draft. `conversationId` stays set either way, because that is the pair the
	 * real `chat-content` passes: a draft has a canvas-store key (its draft key)
	 * and no session, and the panel must not confuse the two.
	 */
	sessionId?: string | null;
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
	// The story's backend state, installed before anything can ask for it.
	useMemo(() => {
		if (variables) desktopAnswers = variables;
	}, [variables]);

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
					sessionId={sessionId ?? undefined}
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

/**
 * A namespace with a kernel behind it that has not been written to yet.
 *
 * "Nothing stored yet" is only true once there IS an interpreter holding the
 * nothing: the New control belongs here, and its absence in
 * `VariablesNoKernel` beside it is the whole distinction.
 */
export const VariablesEmptyWithKernel: Story = {
	render: () => (
		<CanvasFrame
			view="variables"
			activeId={DOCUMENTS[0].id}
			variables={{
				features: { session_variables: 1 },
				list: () => observed([]),
			}}
		/>
	),
};

/**
 * No kernel at all - the interpreter was released after sitting idle, or the
 * chat has not run code yet.
 *
 * The panel must NOT say "nothing stored yet" here, because nobody read a
 * namespace: there is no namespace. It also must not offer New, because a write
 * never spawns a runtime or a kernel (see the design's write semantics), so the
 * control could only fail.
 */
export const VariablesNoKernel: Story = {
	render: () => (
		<CanvasFrame
			view="variables"
			activeId={DOCUMENTS[0].id}
			variables={{
				features: { session_variables: 1 },
				list: () => observed([], { kernel: "absent" }),
			}}
		/>
	),
};

/**
 * A staged draft: no session, so there is nothing to ask about.
 *
 * The answer below is a LOUD failure on purpose. "The panel shows the right
 * sentence" is not the same evidence as "the panel made no call": if a draft
 * ever reaches the backend, this frame shows a 500 rather than the copy it
 * would have shown anyway. The same trick is why `VariablesBackendTooOld`
 * refuses instead of answering.
 */
export const VariablesDraft: Story = {
	render: () => (
		<CanvasFrame
			view="variables"
			activeId={DOCUMENTS[0].id}
			sessionId={null}
			variables={{
				features: { session_variables: 1 },
				list: () =>
					refused(
						500,
						"draft_read_attempted",
						"A draft has no session, so this read must never happen.",
					),
			}}
		/>
	),
};

/**
 * A cell is running, so the namespace cannot be read this instant.
 *
 * This is not an error state and must never look like one: the reading is
 * simply not available yet. The frame shows the quiet affordance with no list
 * to keep, which is the state a session reaches before it has ever been read;
 * the "keep the previous list while it re-reads" half needs a live session and
 * is photographed in the app, not here.
 */
export const VariablesBusy: Story = {
	render: () => (
		<CanvasFrame
			view="variables"
			activeId={DOCUMENTS[0].id}
			variables={{
				features: { session_variables: 1 },
				list: () => variablesEnvelope({ state: "busy" }),
			}}
		/>
	),
};

/**
 * A runtime that answered `unsupported`: it has code memory, but no way to
 * hand it over (an older runtime behind a current backend).
 *
 * Distinct from the older-backend state below - the route exists here, and
 * "update the backend" would be the wrong sentence.
 */
export const VariablesUnsupported: Story = {
	render: () => (
		<CanvasFrame
			view="variables"
			activeId={DOCUMENTS[0].id}
			variables={{
				features: { session_variables: 1 },
				list: () => variablesEnvelope({ state: "unsupported" }),
			}}
		/>
	),
};

/**
 * A backend that predates the surface: it advertises other features and not
 * this one, and the panel must offer the update rather than call a route that
 * is not there.
 *
 * The `list` answer refuses too, for the same reason `VariablesDraft`'s does -
 * the capabilities gate is supposed to make the call unnecessary, and a frame
 * that only showed the copy would not prove it did.
 */
export const VariablesBackendTooOld: Story = {
	render: () => (
		<CanvasFrame
			view="variables"
			activeId={DOCUMENTS[0].id}
			variables={{
				features: { lifecycle: 1 },
				list: () =>
					refused(
						404,
						"not_found",
						"This backend has no code-memory route, so this read must never happen.",
					),
			}}
		/>
	),
};

/**
 * A write the backend refuses, in the backend's own words.
 *
 * The form is driven rather than faked: the play function opens the real
 * dialog, types a name the session reserves, submits, and waits for the toast -
 * so what is photographed is the refusal path end to end through the mutation
 * hook, not a hand-drawn toast.
 */
export const VariablesWriteRefused: Story = {
	render: () => (
		<CanvasFrame
			view="variables"
			activeId={DOCUMENTS[0].id}
			variables={{
				features: { session_variables: 1 },
				list: () => observed(VARIABLES),
				write: () =>
					refused(
						409,
						"reserved_name",
						"'secrets' is a name the session keeps for its own tools.",
					),
			}}
		/>
	),
	play: async ({ canvasElement }) => {
		// Held from the first line: the whole point of this story is the state
		// AFTER the refusal, and the capturer must not photograph the dialog
		// mid-submission.
		holdShutter();
		// Only the trigger is inside the frame: the dialog and the toast both
		// render through portals at the document root, so `screen` is what can
		// see them.
		const canvas = within(canvasElement);
		await userEvent.click(
			await canvas.findByRole("button", { name: "New variable" }),
		);
		/*
		 * `fireEvent.change` rather than `userEvent.type`: the value is not what
		 * this frame is about, and typing it costs seven keystroke rounds that
		 * the shutter - which fires as soon as the theme lands, ~700 ms after
		 * mount - can land in the middle of. The first version of this story
		 * photographed the dialog with the name typed and no refusal yet.
		 * `change` sets the same React state in one event.
		 */
		fireEvent.change(await screen.findByLabelText(VARIABLE_KEY_LABEL), {
			target: { value: "secrets" },
		});
		await userEvent.click(
			await screen.findByRole("button", { name: "Create" }),
		);
		// The assertion is also the wait: the story is not "done" until the
		// refusal has been rendered, and the toast is what this frame is for.
		await screen.findByText(REFUSAL_SENTENCE);
		// ...and the refusal ALSO marks the field it is about, which is the other
		// half of UX round 1's U3: the same sentence, beside the control the user
		// has to change, instead of only in a toast that floats past.
		await screen.findByText(REFUSAL_SENTENCE, { selector: "p" });
		releaseShutter();
	},
};

/**
 * The backend answered, and the answer was a failure this panel cannot name.
 *
 * Design round 1 (D3) found this branch unframed and still carrying advice that
 * this PR exists to retire: "Check that Local Operator is running" is false
 * whenever the backend answered at all, which is the case here. The state is
 * reachable (a 5xx, a proxy that answered instead of the backend, a bearer the
 * backend rejected) and it is the one state whose copy a reviewer had to
 * imagine, so it is rendered.
 *
 * The stub refuses rather than answering a 404: a 404 is its own branch
 * (`VariablesBackendTooOld`), and a frame cannot tell the two apart if both
 * stories answer with the same status.
 */
export const VariablesBackendUnreachable: Story = {
	render: () => (
		<CanvasFrame
			view="variables"
			activeId={DOCUMENTS[0].id}
			variables={{
				features: { session_variables: 1 },
				list: () =>
					refused(
						503,
						"backend_unavailable",
						"The backend did not answer in time.",
					),
			}}
		/>
	),
};

/**
 * A namespace the owner could not list at all: one value bigger than the whole
 * reading budget.
 *
 * `truncated: true` with nothing to show is a real answer from the backend
 * (recorded during remediation from PR #1101's own budget rule), and the frozen
 * state table has no row for it - so the panel must not borrow the empty one,
 * which would state that the namespace is empty when it is only unlistable.
 */
export const VariablesTruncated: Story = {
	render: () => (
		<CanvasFrame
			view="variables"
			activeId={DOCUMENTS[0].id}
			variables={{
				features: { session_variables: 1 },
				list: () => observed([], { truncated: true }),
			}}
		/>
	),
};

/**
 * The row actions, revealed the way the keyboard reveals them.
 *
 * Design round 1 (D5) could not judge whether the hidden-until-hover actions
 * read as intentional, because no frame contained them: at rest they are
 * `opacity-0` with pointer events off, and a still cannot hover. Focus can be
 * drawn, and `group-focus-within` is what makes them keyboard-reachable in the
 * first place - so the frame shows the second row focused, with its Copy, Edit
 * and Delete controls drawn beside the value they act on.
 */
export const VariablesRowActions: Story = {
	render: () => (
		<CanvasFrame
			view="variables"
			activeId={DOCUMENTS[0].id}
			variables={{
				features: { session_variables: 1 },
				list: () => observed(VARIABLES),
			}}
		/>
	),
	play: async ({ canvasElement }) => {
		holdShutter();
		const canvas = within(canvasElement);
		// The second row: the first is the uneditable DataFrame, which has its own
		// story below.
		const edits = await canvas.findAllByRole("button", { name: "Edit variable" });
		edits[1].focus();
		await waitFor(() => {
			if (document.activeElement !== edits[1]) throw new Error("not focused");
		});
		releaseShutter();
	},
};

/**
 * The row the backend says cannot be edited, focused.
 *
 * `outstanding` is a DataFrame with `editable: false`, and the question D5 asks
 * of it is whether the absence of an editable control reads as a rule rather
 * than as breakage: the Edit control is drawn `aria-disabled` with a tooltip
 * naming the reason (a plain `disabled` button would swallow the tooltip), and
 * Delete stays available because a value the panel cannot re-coerce can still be
 * removed.
 */
export const VariablesUneditableRow: Story = {
	render: () => (
		<CanvasFrame
			view="variables"
			activeId={DOCUMENTS[0].id}
			variables={{
				features: { session_variables: 1 },
				list: () => observed(VARIABLES),
			}}
		/>
	),
	play: async ({ canvasElement }) => {
		holdShutter();
		const canvas = within(canvasElement);
		const edits = await canvas.findAllByRole("button", { name: "Edit variable" });
		edits[0].focus();
		await waitFor(() => {
			if (document.activeElement !== edits[0]) throw new Error("not focused");
		});
		releaseShutter();
	},
};

/**
 * The delete confirmation, opened through the real control.
 *
 * Also unrendered before this round (D5). The play drives the row's own Delete
 * button - focus first, because the control only exists for a pointer or a
 * keyboard, then the click - so the dialog in the frame is the component the
 * app ships, not a mock of it.
 */
export const VariablesDeleteConfirm: Story = {
	render: () => (
		<CanvasFrame
			view="variables"
			activeId={DOCUMENTS[0].id}
			variables={{
				features: { session_variables: 1 },
				list: () => observed(VARIABLES),
			}}
		/>
	),
	play: async ({ canvasElement }) => {
		holdShutter();
		const canvas = within(canvasElement);
		const deletes = await canvas.findAllByRole("button", {
			name: "Delete variable",
		});
		deletes[1].focus();
		await userEvent.click(deletes[1]);
		await screen.findByRole("dialog");
		releaseShutter();
	},
};

/*
 * A populated list, then `busy` over it, has NO story here on purpose.
 *
 * Design round 1 (D2) asked for the transition, and it cannot be a fixture: the
 * retention rule is about a query that already holds a reading when the next one
 * comes back `busy`, and this environment gives a story no way to provoke that
 * second read. The app provokes it by coming back to the window, and this
 * app's query-core (5.73.3) wires that to `visibilitychange` - but dispatching
 * the event from a play function, and from the page over CDP, both left the
 * reader at one call (measured, not assumed: a counter on the stub read 1
 * before and 1 after). A story that cannot reach the state it is named for is
 * worse than no story, so the transition is photographed in the live app, where
 * a real cell is running and the lease keeps the kernel resident - see
 * `docs/evidence/session-code-memory/README.md`.
 */

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
