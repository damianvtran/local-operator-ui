import { MessageInput } from "@shared/components/composer/message-input";
import { useConversationInputStore } from "@shared/store/conversation-input-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import { useLayoutEffect, useState } from "react";
import type {
	CanonicalFrontendState,
	PendingAsk,
} from "../../../../../../src/shared/desktop-session-contract";
import { EMPTY_DRAFTS } from "../ask-queue";
import type { Message } from "../types/message";
import { AskDrawer } from "./asks/ask-drawer";
import { deriveRunDetails } from "./run-details";
import { RunPanel, type RunPanelProps } from "./run-details/run-panel";
import "./story-electron-shim";

const meta = {
	title: "Chat/Composer placement",
	parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const messages: Message[] = [
	{ id: "story-placement-message", role: "system", timestamp: new Date(0) },
];
const draft =
	"Review the March invoices and flag anything that needs a second look.";
const cwd = "/Users/you/Projects/invoices";
const rightWidth = 380;
const emptySlot = {
	isRunPanelOpen: false,
	isAskDrawerOpen: false,
	askDrawerEvictedPane: null,
	runPanelReveal: null,
} as const;
const cancel = async () => ({
	ok: false as const,
	detail: "The example does not cancel work.",
});
const readOnly = {
	mcpServers: [],
	mcpGrantRunning: false,
	mcpRemedy: {
		press: () => undefined,
		pressKey: async () => false,
		cancel: () => undefined,
		reload: async () => false,
		pendingName: null,
		failureFor: () => null,
		clearFailure: () => undefined,
		refusalFor: () => null,
	},
	monitorControls: { cancel },
	wakeControls: { cancel },
	jobControls: { cancel },
	wakeAida: {
		capability: false,
		statusResolved: false,
		sessionId: null,
		name: "Aida",
	},
	sessionId: null,
	pulses: {},
	// The transcript capability is present; these synthetic jobs have no child session to open.
	childrenOpenable: true,
	olderTransportDown: false,
	paneWidth: rightWidth,
	readerChildId: null,
	onReaderChildChange: () => undefined,
} satisfies Omit<RunPanelProps, "details" | "onClose">;
const model = {
	provider: "openrouter",
	model_id: "openai/gpt-5-mini",
	display_name: "OpenAI: GPT-5 mini",
	reasoning: true,
	reasoning_effort: "medium",
	reasoning_efforts: ["minimal", "low", "medium", "high"],
	reasoning_default_effort: null,
	context_window: 400_000,
	max_context_window: null,
};

// Adapt the wire-shaped rows from ComposerStatusRow's activity, ask and loop
// stories. Use the production derivation so the counts can't disagree with the
// rows behind them. No fixture row is registered with the desktop runtime.
function fixture(
	now: number,
	goalAndLoop: boolean,
	activity: "running" | "pending" | "empty",
) {
	const minute = 60_000;
	const created = now - 12 * minute;
	const askTimeout = activity === "pending" ? 15 : 60;
	const asks: PendingAsk[] =
		activity === "empty"
			? []
			: [
					{
						ask_id: "story-placement-ask",
						created_at: created,
						expires_at: created + askTimeout * minute,
						timeout_s: askTimeout * 60,
						urgent: activity === "pending",
						status: "open",
						delivered: false,
						questions: [
							{
								id: "duplicate-invoices",
								question:
									"Which duplicate invoices should I include in the report?",
								options: [
									{
										label: "All duplicates",
										description: "Include every match",
									},
									{
										label: "Unresolved only",
										description: "Skip resolved matches",
									},
								],
								recommended: 1,
							},
						],
					},
				];
	const jobs = [
		{ id: "child-1", type: "task", label: "Audit the March invoices" },
		{ id: "child-2", type: "task", label: "Summarise the findings" },
		{ id: "job-1", type: "bash", label: "bash: check-invoice-totals" },
	].map((row) => ({
		...row,
		status: activity === "pending" ? "queued" : "running",
		start_time: created / 1000,
		settled_at: null,
	}));
	const todos = [
		{
			name: "Reconcile invoices",
			items: [
				{ text: "Collect the March invoices", status: "done" },
				{ text: "Match each invoice to the ledger", status: "pending" },
				{ text: "Review duplicate entries", status: "blocked" },
			],
		},
	];
	const wakes = [
		{
			id: "wake-1",
			message: "Check the reconciliation progress",
			next_due_at: now + 12 * minute,
			created_at: created,
			every_ms: null,
			remaining: null,
			limit: null,
			fired_count: 0,
		},
	];
	const monitors = [
		{
			id: "monitor-1",
			name: "March invoice import",
			tool: "bash",
			arguments: {},
			every_ms: minute,
			until_at: null,
			description: "Watch for new invoices",
			created_at: created,
			next_due_at: now + minute,
			last_check_at: now - minute,
			checks: 1,
			deliveries: 0,
			consecutive_failures: 0,
			disabled: false,
			disabled_reason: "",
		},
	];
	const goal = goalAndLoop
		? "Reconcile the March invoices against the ledger and report any discrepancies."
		: "";
	const frontend = {
		// Match PopulatedRail's readings so placement is tested with the shelf full.
		context_tokens: 41_000,
		context_window: 400_000,
		context_is_estimate: false,
		cost_knowledge: "unknown",
		child_costs: {},
		selected_model: model,
		effective_model: model,
		active_duration_s: 372,
		activity_started_at: null,
		asks,
		asks_open: asks.length,
		asks_truncated: false,
		goal,
		loop: goalAndLoop
			? { status: "running", completed: 2, iterations: 5, goal, reason: "" }
			: null,
	} as CanonicalFrontendState;
	return {
		frontend,
		runDetails: deriveRunDetails(
			activity === "empty"
				? { jobs: [], todos: [], nowMs: now }
				: { jobs, todos, wakes, monitors, nowMs: now },
		),
	};
}

function Placement({
	width = 900,
	goalAndLoop = false,
	activity = "running",
	initialPane,
}: {
	width?: number;
	goalAndLoop?: boolean;
	activity?: "running" | "pending" | "empty";
	initialPane?: "asks" | "run";
}) {
	const [now] = useState(Date.now);
	const askOpen = useUiPreferencesStore((s) => s.isAskDrawerOpen);
	const runOpen = useUiPreferencesStore((s) => s.isRunPanelOpen);
	const setAskOpen = useUiPreferencesStore((s) => s.setAskDrawerOpen);
	const setRunOpen = useUiPreferencesStore((s) => s.setRunPanelOpen);
	const [drafts, setDrafts] = useState(EMPTY_DRAFTS);
	const { frontend, runDetails } = fixture(now, goalAndLoop, activity);
	const conversation = `story-composer-placement-${width}-${goalAndLoop}-${activity}-${initialPane ?? "closed"}`;
	useLayoutEffect(() => {
		useConversationInputStore.getState().setCurrentInput(conversation, draft);
		// The same store actions as ChatPage keep asks and run details mutually
		// exclusive; mounting the two independently could show an impossible frame.
		useUiPreferencesStore.setState({
			...emptySlot,
			isAskDrawerOpen: initialPane === "asks",
			isRunPanelOpen: initialPane === "run",
			askDrawerScope: "session",
		});
		return () => useUiPreferencesStore.setState(emptySlot);
	}, [conversation, initialPane]);

	return (
		<div className="flex items-start bg-canvas p-6">
			<div className="@container/chatcol min-w-0" style={{ width }}>
				<MessageInput
					isLoading={false}
					isSmallView={width < 550}
					messages={messages}
					conversationId={conversation}
					cwd={cwd}
					cwdWritePath={{
						kind: "move",
						commit: async () => ({
							kind: "settled",
							receipt: {
								cwd,
								label: "~/Projects/invoices",
								outcome: "cold",
								will_wait: false,
							},
							sentence: "The example does not change directories.",
						}),
					}}
					sessionStatus={{ frontend, onCommand: () => undefined }}
					runDetails={runDetails}
					askExpanded={askOpen}
					onAskToggle={(next, options) => setAskOpen(next, "session", options)}
					recordingProbe={{
						canUseRadientSpeech: true,
						speechBlock: "checking",
					}}
					onSendMessage={async () => false}
				/>
			</div>
			{runOpen || askOpen ? (
				<div
					className="flex h-[560px] max-w-[45%] shrink-0 flex-col"
					style={{ width: rightWidth }}
				>
					{runOpen ? (
						<RunPanel
							{...readOnly}
							details={runDetails}
							onClose={() => setRunOpen(false)}
						/>
					) : (
						<AskDrawer
							frontend={frontend}
							scope="session"
							onClose={(options) => setAskOpen(false, "session", options)}
							nowMs={now}
							drafts={drafts}
							onDraftChange={(askId, next) =>
								setDrafts((previous) => ({ ...previous, [askId]: next }))
							}
							onAnswer={() => undefined}
							onDecline={() => undefined}
						/>
					)}
				</div>
			) : null}
		</div>
	);
}

export const Activity: Story = { render: () => <Placement /> };

export const GoalAndLoop: Story = { render: () => <Placement goalAndLoop /> };

export const Compact: Story = {
	render: () => <Placement width={393} goalAndLoop />,
	play: async ({ canvasElement }) => {
		const row = canvasElement.querySelector<HTMLElement>(
			"[data-composer-status-row]",
		);
		await expect(row).toBeVisible();
		if (!row) return;
		const bounds = row.getBoundingClientRect();
		for (const button of within(row).getAllByRole("button")) {
			const target = button.getBoundingClientRect();
			await expect(target.left).toBeGreaterThanOrEqual(bounds.left);
			await expect(target.right).toBeLessThanOrEqual(bounds.right);
		}
	},
};

export const QuestionOpen: Story = {
	render: () => <Placement width={680} goalAndLoop initialPane="asks" />,
};

export const RunDetailsOpen: Story = {
	render: () => <Placement width={680} goalAndLoop initialPane="run" />,
	play: async ({ canvasElement }) => {
		const job = await within(canvasElement).findByText(
			"bash: check-invoice-totals",
		);
		const mark = job.closest("li")?.querySelector("svg");
		await expect(mark).toBeVisible();
		if (!mark) return;
		// The mark belongs to the label line, not above it like a second heading.
		const labelBounds = job.getBoundingClientRect();
		const markBounds = mark.getBoundingClientRect();
		const markCenter = (markBounds.top + markBounds.bottom) / 2;
		await expect(markCenter).toBeGreaterThan(labelBounds.top);
		await expect(markCenter).toBeLessThan(labelBounds.bottom);
	},
};

export const Pending: Story = {
	render: () => <Placement width={680} activity="pending" initialPane="asks" />,
};

export const Empty: Story = {
	render: () => <Placement activity="empty" />,
	play: async ({ canvasElement }) => {
		await expect(within(canvasElement).getByRole("form")).toBeVisible();
		await expect(
			canvasElement.querySelector("[data-composer-status-row]"),
		).not.toBeInTheDocument();
		const canvas = within(canvasElement);
		const draft = canvas.getByRole("combobox", { name: "Message" });
		const field = draft.closest(".composer-dock-field");
		if (!field) throw new Error("Missing draft focus wrapper");
		const expectUnboxedDraft = async () => {
			await expect(draft).toHaveFocus();
			await expect(getComputedStyle(field).outlineStyle).toBe("none");
			await expect(getComputedStyle(field).borderInlineStartWidth).toBe("0px");
			await expect(getComputedStyle(field).backgroundColor).toBe(
				"rgba(0, 0, 0, 0)",
			);
			const draftStyle = getComputedStyle(draft);
			await expect(draftStyle.outlineStyle).toBe("none");
			await expect(draftStyle.caretColor).toBe(draftStyle.color);
		};
		draft.focus();
		await expectUnboxedDraft();
		draft.blur();
		await userEvent.click(draft);
		await expectUnboxedDraft();
		await userEvent.tab();
		await expect(
			canvas.getByRole("button", { name: "Attach file" }),
		).toHaveFocus();
		await userEvent.tab({ shift: true });
		await expectUnboxedDraft();
	},
};
