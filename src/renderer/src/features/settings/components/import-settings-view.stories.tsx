import "../../../styles/index.css";

import type { Meta, StoryObj } from "@storybook/react";
import { type FC, useMemo, useState } from "react";
import { ImportSettingsView } from "./import-settings-view";
import type { ImportSettingsViewProps } from "./import-settings-view";
import type {
	ImportPreview,
	ImportProgress,
	ImportResult,
	ImportSession,
	ImportSource,
} from "./imports-api";

/**
 * Settings -> Import conversations, one frame per state the screen can paint.
 *
 * The view is the SHIPPED presentational half; these stories do not mock it.
 * They still supply callbacks because the screen owns selection and preview
 * policy in its container, and a story that mounted the container would need a
 * live backend to show an error or a finished job. The frames are therefore
 * evidence of the composition and copy, while the live app frames prove the
 * wiring.
 */
const meta = {
	title: "Settings/Import conversations",
	parameters: { layout: "fullscreen" },
} satisfies Meta;
export default meta;

type Story = StoryObj;

const sources: ImportSource[] = [
	{
		source: "claude",
		label: "Claude Code",
		root: "/home/user/.claude",
		detected: true,
		sessionCount: 3,
		availability: "full",
		detail: "projects and daemon job transcripts",
	},
	{
		source: "codex",
		label: "Codex",
		root: "/home/user/.codex",
		detected: true,
		sessionCount: 1203,
		availability: "metadata_only",
		detail: "state_5.sqlite; rollout bodies are missing",
	},
	{
		source: "omp",
		label: "omp",
		root: "/home/user/.omp/agent",
		detected: true,
		sessionCount: 9,
		availability: "full",
		detail: "sessions/**/*.jsonl",
	},
];

const sessions: ImportSession[] = [
	{
		source: "omp",
		sourceId: "omp-2f1a",
		title: "Refactor the transcript writer",
		cwd: "/Users/user/project",
		createdTs: 1_760_000_000,
		updatedTs: 1_760_100_000,
		messageCount: 42,
		compactionCount: 1,
		kind: "conversation",
		availability: "full",
		parentSourceId: null,
	},
	{
		source: "omp",
		sourceId: "omp-9b02",
		title: "Investigate a flaky test on CI",
		cwd: "/Users/user/project",
		createdTs: 1_759_000_000,
		updatedTs: 1_759_500_000,
		messageCount: 118,
		compactionCount: 2,
		kind: "conversation",
		availability: "full",
		parentSourceId: null,
	},
	{
		source: "omp",
		sourceId: "omp-4c77",
		title: "Index entry with no body",
		cwd: "/Users/user/archive",
		createdTs: 1_758_000_000,
		updatedTs: 1_758_100_000,
		messageCount: null,
		compactionCount: 0,
		kind: "conversation",
		availability: "metadata_only",
		parentSourceId: null,
	},
];

const preview: ImportPreview = {
	totalSessions: 2,
	totalMessages: 160,
	messageCountsEstimated: true,
	totalCompactions: 3,
	totalMemoryRecords: 4,
	projectedMemoryTokens: 1200,
	projectedGlobalTokens: 300,
	warnings: [
		{
			source: "omp",
			sessionId: "omp-9b02",
			code: "duplicate_result",
			message: "A duplicate tool result was collapsed.",
		},
	],
	instructionReviewPaths: [
		"/home/user/.local-operator/imports/instructions/omp.md",
	],
};

const progress: ImportProgress = {
	jobId: "imp-2b7d13c4e5f6",
	state: "running",
	phase: "importing",
	source: "omp",
	sessionId: "omp-9b02",
	completed: 1,
	total: 2,
	results: [
		{
			source: "omp",
			sourceId: "omp-2f1a",
			targetSessionId: "4a2e8f01b9c3",
			outcome: "imported",
			messages: 42,
			compactions: 1,
			redactions: 0,
			skipped: 0,
			warnings: [],
		},
	],
	warnings: [],
	error: "",
	startedAt: 1_760_200_000,
	updatedAt: 1_760_200_010,
};

const result: ImportResult = {
	jobId: "imp-2b7d13c4e5f6",
	state: "done",
	sessions: progress.results.concat({
		source: "omp",
		sourceId: "omp-9b02",
		targetSessionId: "6f0c1d9a2b4e",
		outcome: "imported",
		messages: 118,
		compactions: 2,
		redactions: 1,
		skipped: 0,
		warnings: ["A duplicate tool result was collapsed."],
	}),
	messages: 160,
	compactions: 3,
	memoryImported: 4,
	memorySkipped: 0,
	memoryReviewPath: "/home/user/.local-operator/imports/memory/omp.json",
	instructionReviewPath:
		"/home/user/.local-operator/imports/instructions/omp.md",
	redactions: 1,
	warnings: [],
	error: "",
};

const noop = () => undefined;
const copy = async () => true;

const Frame: FC<{ overrides: Partial<ImportSettingsViewProps> }> = ({
	overrides,
}) => {
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [confirmed, setConfirmed] = useState(false);
	const props = useMemo<ImportSettingsViewProps>(
		() => ({
			sources,
			activeSource: "omp",
			sessions,
			query,
			selected,
			preview: null,
			previewStale: false,
			previewError: null,
			confirmed,
			busy: null,
			error: null,
			progress: null,
			result: null,
			cancelling: false,
			onSelectSource: noop,
			onQueryChange: setQuery,
			onToggleSession: (id) =>
				setSelected((current) => {
					const next = new Set(current);
					if (next.has(id)) next.delete(id);
					else next.add(id);
					return next;
				}),
			onSelectAll: () =>
				setSelected(new Set(sessions.map((row) => row.sourceId))),
			onClearSelection: () => setSelected(new Set()),
			onConfirmChange: setConfirmed,
			onImport: noop,
			onCancel: noop,
			onRetry: noop,
			onImportAnother: noop,
			onRefresh: noop,
			selectionNotice: null,
			onCopyPath: copy,
			...overrides,
		}),
		[confirmed, overrides, query, selected],
	);
	return (
		<div className="min-h-screen bg-canvas p-8">
			<div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
				<ImportSettingsView {...props} />
			</div>
		</div>
	);
};

export const Loading: Story = {
	render: () => (
		<Frame overrides={{ sources: [], sessions: [], busy: "sources" }} />
	),
};

export const Empty: Story = {
	render: () => <Frame overrides={{ sources: [], sessions: [] }} />,
};

export const ErrorState: Story = {
	render: () => (
		<Frame
			overrides={{
				sources: [],
				sessions: [],
				error:
					"Could not read the source stores. Desktop controls could not reach the backend process.",
			}}
		/>
	),
};

export const Populated: Story = {
	render: () => <Frame overrides={{}} />,
};

export const Selected: Story = {
	render: () => (
		<Frame overrides={{ selected: new Set(["omp-2f1a", "omp-9b02"]) }} />
	),
};

export const Preview: Story = {
	render: () => (
		<Frame
			overrides={{
				selected: new Set(["omp-2f1a", "omp-9b02"]),
				preview,
				confirmed: false,
			}}
		/>
	),
};

export const Progress: Story = {
	render: () => <Frame overrides={{ progress }} />,
};

export const Cancelled: Story = {
	render: () => (
		<Frame
			overrides={{
				progress: {
					...progress,
					state: "cancelled",
					phase: "cancelled",
					completed: 1,
					total: 5,
				},
				result: {
					...result,
					state: "cancelled",
					sessions: progress.results,
					messages: 42,
					compactions: 1,
				},
				selected: new Set(["omp-2f1a", "omp-9b02"]),
				preview,
				confirmed: true,
			}}
		/>
	),
};

export const Result: Story = {
	render: () => (
		<Frame
			overrides={{
				progress,
				result,
				selected: new Set(["omp-2f1a", "omp-9b02"]),
				preview,
				confirmed: true,
			}}
		/>
	),
};
