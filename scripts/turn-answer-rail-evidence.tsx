/**
 * The turn-answer rail, photographed over the SHIPPED transcript.
 *
 * WHY THE REAL COMPONENT AND NOT A STORY. The defect is a class on one row,
 * decided by a backend key read through react-query; a story that passes the
 * classes in would prove the story. This page mounts `CanonicalTranscript`
 * with the settings query SEEDED (`?rail=on|off|absent`), so what the frame
 * shows is what the app paints for that answer.
 *
 * WHAT THE DRIVER READS BACK. jsdom cannot measure boxes, so the numbers come
 * from here: the outer row box, the marked div and the first prose element, for
 * every state. The claim the pair makes is that the PROSE box is identical
 * between rail off and rail on — the negative margin nets the rule and its
 * padding to zero — and that the outer row box is untouched in both.
 */
import { CanonicalTranscript } from "@renderer/features/chat/canonical/canonical-transcript";
import { backendSettingsKeys } from "@renderer/features/settings/components/backend-settings-section";
import { desktopKeys } from "@renderer/shared/api/local-operator/desktop-hooks";
import { applyThemeToDocument } from "@shared/themes";
import type { ThemeName } from "@shared/themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./turn-answer-rail-evidence.css";

const TS = 1_790_000_000_000;

/** The turn under the frame: a question, work, a peer receipt, the answer. */
const records = [
	{
		kind: "user",
		id: "user:1",
		ts: TS,
		text: "Which invoices were late last month, and what do we owe?",
		images: [],
	},
	{
		kind: "tool",
		id: "tool:1",
		ts: TS + 1_000,
		toolCallId: "tool:1",
		toolName: "bash",
		intent: null,
		args: { command: "lop usage --month 2026-08 --late" },
		phase: "done",
		argumentBytes: 36,
		output: "1042\n1088\n1103\n1177\n",
		isError: false,
		durationS: 0.4,
		startedAt: null,
		endedAt: null,
		images: [],
		added: 0,
		removed: 0,
		diff: null,
		stopped: false,
		neverSent: false,
		notRunReason: null,
	},
	{
		kind: "tool",
		id: "tool:2",
		ts: TS + 2_000,
		toolCallId: "tool:2",
		toolName: "read",
		intent: null,
		args: { path: "~/workspace/invoices-2026-08.csv" },
		phase: "done",
		argumentBytes: 40,
		output: "12 rows\n",
		isError: false,
		durationS: 0.2,
		startedAt: null,
		endedAt: null,
		images: [],
		added: 0,
		removed: 0,
		diff: null,
		stopped: false,
		neverSent: false,
		notRunReason: null,
	},
	{
		kind: "peer",
		id: "peer:1",
		ts: TS + 3_000,
		body: "window-collect: 140 records staged for the next batch.",
		sender: {
			pid: "",
			conversationName: "ingest-rail",
			cwd: "",
			sessionId: "",
			modelLabel: "",
		},
	},
	{
		kind: "assistant",
		id: "answer:1",
		ts: TS + 4_000,
		text: "Four invoices were late: 1042, 1088, 1103 and 1177.\n\nTogether they come to $18,420.00, and three of the four are more than 30 days old.",
		streaming: false,
		stopReason: null,
		error: false,
		settledAt: TS + 4_000,
	},
];

const transcript = {
	records,
	index: new Map(records.map((record, position) => [record.id, position])),
	generation: 1,
	oldestId: null,
	hasMore: false,
	argsByCall: new Map(),
};

type Box = { left: number; right: number; width: number };
type Measured = {
	ready: boolean;
	mode: string;
	theme: string;
	markedCount: number;
	answerStandaloneCount: number;
	classes: string;
	answerOuter: Box | null;
	answerMark: Box | null;
	answerProse: Box | null;
	toolOuter: Box | null;
};

declare global {
	interface Window {
		__railEvidence?: Measured;
	}
}

const box = (element: Element | null): Box | null => {
	if (!element) return null;
	const rect = element.getBoundingClientRect();
	return { left: rect.left, right: rect.right, width: rect.width };
};

function App() {
	const params = new URLSearchParams(window.location.search);
	const mode = params.get("rail") ?? "off";
	const theme = (params.get("theme") ?? "localOperatorDark") as ThemeName;

	useEffect(() => {
		applyThemeToDocument(theme);
		const raf = requestAnimationFrame(() => {
			const answer = document.querySelector('[data-record-id="answer:1"]');
			const mark = answer?.querySelector("[data-turn-answer]") ?? null;
			const prose = answer?.querySelector("p") ?? null;
			const tool = document.querySelector('[data-record-id="tool:1"]');
			window.__railEvidence = {
				ready: Boolean(answer && mark),
				mode,
				theme,
				markedCount: document.querySelectorAll("[data-turn-answer]").length,
				answerStandaloneCount: document.querySelectorAll(
					"[data-record-id][data-turn-answer]",
				).length,
				classes: String(mark?.className ?? ""),
				answerOuter: box(answer),
				answerMark: box(mark),
				answerProse: box(prose),
				toolOuter: box(tool),
			};
		});
		return () => cancelAnimationFrame(raf);
	});

	return (
		<div className="h-screen overflow-y-auto bg-canvas p-6">
			<CanonicalTranscript
				frontend={null}
				transcript={transcript as never}
				gate={null}
				waiting={false}
				starting={false}
				loadingOlder={false}
				onLoadOlder={async () => true}
				containerRef={{ current: document.body }}
				isSmallView={false}
				status="live"
				failure={null}
				awaitingHydration={false}
				onReconnect={() => undefined}
			/>
		</div>
	);
}

/*
 * ONE CLIENT, SEEDED BEFORE THE FIRST RENDER, so the query answers with the
 * frame's own state rather than resolving after it (an unseeded client is the
 * fail-closed path, which is the default frame's own arm but not the `on` one).
 */
const mode = new URLSearchParams(window.location.search).get("rail") ?? "off";
const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: false } },
});
queryClient.setQueryData(desktopKeys.capabilities, {
	desktop_available: true,
	features: { settings: 1 },
});
/*
 * `absent` is the old-backend skew the reading rule must survive: the plane
 * answers `settings: 1` while the registry carries no rail key.
 */
queryClient.setQueryData(backendSettingsKeys.all, {
	sections: [],
	settings:
		mode === "absent"
			? [{ key: "display.shimmer", value: true }]
			: [{ key: "display.turn_answer_rail", value: mode === "on" }],
});

createRoot(document.getElementById("root") as HTMLElement).render(
	<QueryClientProvider client={queryClient}>
		<App />
	</QueryClientProvider>,
);
