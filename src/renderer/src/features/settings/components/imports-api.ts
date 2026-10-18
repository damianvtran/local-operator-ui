/**
 * The Settings import surface's only door to the backend.
 *
 * Everything here calls the typed desktop control plane; the renderer never
 * builds a URL, holds a bearer, or touches a foreign store. The wire is
 * snake_case because that is the core's durable manifest vocabulary, and the
 * mapping to the screen's camelCase view models happens once, here, so a
 * component cannot grow a second interpretation of the same payload.
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";

export type ImportSourceName = "claude" | "codex" | "omp";
export type ImportAvailability = "full" | "metadata_only" | "unsupported";
export type ImportSessionKind = "conversation" | "subagent";

export type ImportSource = {
	source: ImportSourceName;
	label: string;
	root: string;
	detected: boolean;
	sessionCount: number;
	availability: ImportAvailability;
	detail: string;
};

export type ImportSession = {
	source: ImportSourceName;
	sourceId: string;
	title: string;
	cwd: string;
	createdTs: number;
	updatedTs: number;
	messageCount: number | null;
	compactionCount: number;
	kind: ImportSessionKind;
	availability: ImportAvailability;
	parentSourceId: string | null;
};

export type ImportRequest = {
	sources: ImportSourceName[];
	sessionIds: Record<string, string[]>;
	includeMemory?: boolean;
	includeInstructions?: boolean;
};

export type ImportWarning = {
	source: string;
	sessionId: string;
	code: string;
	message: string;
};

export type ImportPreview = {
	totalSessions: number;
	totalMessages: number;
	messageCountsEstimated: boolean;
	totalCompactions: number;
	totalMemoryRecords: number;
	projectedMemoryTokens: number;
	projectedGlobalTokens: number;
	warnings: ImportWarning[];
	instructionReviewPaths: string[];
};

export type ImportOutcome =
	| "imported"
	| "resumed"
	| "skipped_already_imported"
	| "metadata_only"
	| "failed"
	| "cancelled";

export type ImportSessionResult = {
	source: string;
	sourceId: string;
	targetSessionId: string;
	outcome: ImportOutcome;
	messages: number;
	compactions: number;
	redactions: number;
	skipped: number;
	warnings: string[];
};

export type ImportProgress = {
	jobId: string;
	state: "queued" | "running" | "done" | "failed" | "cancelled";
	phase: string;
	source: string;
	sessionId: string;
	completed: number;
	total: number;
	results: ImportSessionResult[];
	warnings: ImportWarning[];
	error: string;
	startedAt: number;
	updatedAt: number;
	result?: ImportResult;
};

export type ImportResult = {
	jobId: string;
	state: "done" | "cancelled" | "failed";
	sessions: ImportSessionResult[];
	messages: number;
	compactions: number;
	memoryImported: number;
	memorySkipped: number;
	memoryReviewPath: string;
	instructionReviewPath: string;
	redactions: number;
	warnings: ImportWarning[];
	error: string;
};

type RawSource = {
	source: ImportSourceName;
	label: string;
	root: string;
	detected: boolean;
	session_count: number;
	availability: ImportAvailability;
	detail: string;
};

type RawSession = {
	source: ImportSourceName;
	source_id: string;
	title: string | null;
	cwd: string | null;
	created_ts: number;
	updated_ts: number;
	message_count: number | null;
	compaction_count: number;
	kind: ImportSessionKind;
	availability: ImportAvailability;
	parent_source_id: string | null;
};

type RawWarning = {
	source: string;
	session_id: string;
	code: string;
	message: string;
};

type RawPreview = {
	total_sessions: number;
	total_messages: number;
	message_counts_estimated: boolean;
	total_compactions: number;
	total_memory_records: number;
	projected_memory_tokens: number;
	projected_global_tokens: number;
	warnings: RawWarning[];
	instruction_review_paths: string[];
};

type RawSessionResult = {
	source: string;
	source_id: string;
	target_session_id: string;
	outcome: ImportOutcome;
	messages: number;
	compactions: number;
	redactions: number;
	skipped: number;
	warnings: string[];
};

type RawResult = {
	job_id: string;
	state: "done" | "cancelled" | "failed";
	sessions: RawSessionResult[];
	messages: number;
	compactions: number;
	memory_imported: number;
	memory_skipped: number;
	memory_review_path: string;
	instruction_review_path: string;
	redactions: number;
	warnings: RawWarning[];
	error: string;
};

type RawJob = {
	job_id: string;
	state: ImportProgress["state"];
	phase: string;
	source: string;
	session_id: string;
	completed: number;
	total: number;
	results: RawSessionResult[];
	warnings: RawWarning[];
	error: string;
	started_at: number;
	updated_at: number;
	result?: RawResult;
};

const mapWarning = (warning: RawWarning): ImportWarning => ({
	source: warning.source,
	sessionId: warning.session_id,
	code: warning.code,
	message: warning.message,
});

const mapSessionResult = (row: RawSessionResult): ImportSessionResult => ({
	source: row.source,
	sourceId: row.source_id,
	targetSessionId: row.target_session_id,
	outcome: row.outcome,
	messages: row.messages,
	compactions: row.compactions,
	redactions: row.redactions,
	skipped: row.skipped,
	warnings: row.warnings,
});

const mapResult = (raw: RawResult): ImportResult => ({
	jobId: raw.job_id,
	state: raw.state,
	sessions: raw.sessions.map(mapSessionResult),
	messages: raw.messages,
	compactions: raw.compactions,
	memoryImported: raw.memory_imported,
	memorySkipped: raw.memory_skipped,
	memoryReviewPath: raw.memory_review_path,
	instructionReviewPath: raw.instruction_review_path,
	redactions: raw.redactions,
	warnings: raw.warnings.map(mapWarning),
	error: raw.error,
});

export async function fetchImportSources(): Promise<ImportSource[]> {
	const result = await desktopResult<{ sources: RawSource[] }>({
		op: "imports.sources",
	});
	return result.sources.map((source) => ({
		source: source.source,
		label: source.label,
		root: source.root,
		detected: source.detected,
		sessionCount: source.session_count,
		availability: source.availability,
		detail: source.detail,
	}));
}

export async function fetchImportSessions(
	source: ImportSourceName,
	includeSubagents = false,
): Promise<ImportSession[]> {
	const result = await desktopResult<{ sessions: RawSession[] }>({
		op: "imports.sessions",
		source,
		includeSubagents,
	});
	return result.sessions.map((session) => ({
		source: session.source,
		sourceId: session.source_id,
		title: session.title ?? "",
		cwd: session.cwd ?? "",
		createdTs: session.created_ts,
		updatedTs: session.updated_ts,
		messageCount: session.message_count,
		compactionCount: session.compaction_count,
		kind: session.kind,
		availability: session.availability,
		parentSourceId: session.parent_source_id,
	}));
}

export async function previewImport(
	request: ImportRequest,
): Promise<ImportPreview> {
	const result = await desktopResult<RawPreview>({
		op: "imports.preview",
		sources: request.sources,
		sessionIds: request.sessionIds,
		includeMemory: request.includeMemory ?? true,
		includeInstructions: request.includeInstructions ?? true,
	});
	return {
		totalSessions: result.total_sessions,
		totalMessages: result.total_messages,
		messageCountsEstimated: result.message_counts_estimated,
		totalCompactions: result.total_compactions,
		totalMemoryRecords: result.total_memory_records,
		projectedMemoryTokens: result.projected_memory_tokens,
		projectedGlobalTokens: result.projected_global_tokens,
		warnings: result.warnings.map(mapWarning),
		instructionReviewPaths: result.instruction_review_paths,
	};
}

export async function startImport(request: ImportRequest): Promise<string> {
	const result = await desktopResult<{ job_id: string }>({
		op: "imports.start",
		sources: request.sources,
		sessionIds: request.sessionIds,
		includeMemory: request.includeMemory ?? true,
		includeInstructions: request.includeInstructions ?? true,
	});
	return result.job_id;
}

export async function fetchImportJob(jobId: string): Promise<ImportProgress> {
	const raw = await desktopResult<RawJob>({
		op: "imports.status",
		jobId,
	});
	return {
		jobId: raw.job_id,
		state: raw.state,
		phase: raw.phase,
		source: raw.source,
		sessionId: raw.session_id,
		completed: raw.completed,
		total: raw.total,
		results: raw.results.map(mapSessionResult),
		warnings: raw.warnings.map(mapWarning),
		error: raw.error,
		startedAt: raw.started_at,
		updatedAt: raw.updated_at,
		result: raw.result ? mapResult(raw.result) : undefined,
	};
}

export async function cancelImport(jobId: string): Promise<void> {
	await desktopResult<unknown>({ op: "imports.cancel", jobId });
}
