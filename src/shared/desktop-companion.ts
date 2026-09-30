import type { CompanionChatSnapshot } from "./companion-chat";
import type { CompanionAppearance } from "./companion-skin";

export type CompanionMood =
	| "idle"
	| "working"
	| "attention"
	| "complete"
	| "error"
	| "offline";

export interface CompanionNotification {
	sessionId: string;
	title: string;
	kind: "approval" | "answer" | "wedged" | "error" | "interrupted" | "complete";
	label: string;
	key: string;
}

export interface CompanionState {
	mood: CompanionMood;
	label: string;
	sessionId: string | null;
	taskTitle?: string;
	notifications: CompanionNotification[];
}

export const COMPANION_OFFLINE: CompanionState = {
	mood: "offline",
	label: "Connecting",
	sessionId: null,
	notifications: [],
};

const notificationLabels: Record<CompanionNotification["kind"], string> = {
	approval: "Needs approval",
	answer: "Has a question",
	wedged: "Check chat",
	error: "Needs attention",
	interrupted: "Paused",
	complete: "Finished",
};

const notificationPriority: Record<CompanionNotification["kind"], number> = {
	approval: 6,
	answer: 6,
	wedged: 5,
	error: 5,
	interrupted: 4,
	complete: 2,
};

function record(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: null;
}

/** Read the catalogue's authoritative status, never infer work from old receipts. */
export function companionStateFromCatalogue(body: unknown): CompanionState {
	const result = record(record(body)?.result);
	const rows = result?.sessions;
	if (
		!Array.isArray(rows) ||
		(Array.isArray(result?.degraded) && result.degraded.length > 0)
	) {
		return { ...COMPANION_OFFLINE, label: "Status unavailable" };
	}
	let winner: Omit<CompanionState, "notifications"> = {
		mood: "idle",
		label: "Ready",
		sessionId: null,
	};
	const notifications: CompanionNotification[] = [];
	const seen = new Set<string>();
	let priority = 0;
	for (const value of rows) {
		const row = record(value);
		if (!row || row.archived === true) continue;
		const id = typeof row.id === "string" && row.id.trim() ? row.id : null;
		if (!id || seen.has(id)) continue;
		seen.add(id);
		const code = record(row.status)?.code;
		const attention = record(row.attention);
		const unseen = attention?.unseen === true;
		const title =
			typeof row.name === "string"
				? row.name.replace(/\s+/g, " ").trim().slice(0, 160)
				: "";
		let state: Omit<CompanionState, "notifications">;
		let kind: CompanionNotification["kind"] | undefined;
		let rank: number;
		if (code === "approval" || code === "answer") {
			state = { mood: "attention", label: "Needs you", sessionId: id };
			kind = code;
			rank = notificationPriority[kind];
		} else if (code === "wedged" || (code === "error" && unseen)) {
			state = {
				mood: "error",
				label: "Check chat",
				sessionId: id,
			};
			kind = code;
			rank = notificationPriority[kind];
		} else if (code === "interrupted" && unseen) {
			state = { mood: "attention", label: "Paused", sessionId: id };
			kind = code;
			rank = notificationPriority[kind];
		} else if (code === "busy" || code === "delegating") {
			state = { mood: "working", label: "Working", sessionId: id };
			rank = 3;
		} else if (code === "complete" && unseen) {
			state = { mood: "complete", label: "Finished", sessionId: id };
			kind = code;
			rank = notificationPriority[kind];
		} else if (
			typeof code !== "string" ||
			![
				"idle",
				"recent",
				"attached",
				"dormant",
				"scheduled",
				"complete",
				"error",
				"interrupted",
			].includes(code)
		) {
			state = { mood: "offline", label: "Status unavailable", sessionId: id };
			rank = 1;
		} else continue;
		if (kind) {
			const statusKey =
				typeof row.status_epoch === "string" &&
				row.status_epoch.length > 0 &&
				typeof row.status_revision === "number" &&
				Number.isSafeInteger(row.status_revision) &&
				row.status_revision >= 0
					? [row.status_epoch, row.status_revision]
					: null;
			const token =
				(kind === "complete" || kind === "error" || kind === "interrupted") &&
				typeof attention?.completion_token === "string"
					? attention.completion_token
					: null;
			notifications.push({
				sessionId: id,
				title: title || "Untitled task",
				kind,
				label: notificationLabels[kind],
				key: JSON.stringify([
					id,
					kind,
					kind === "approval" || kind === "answer" || kind === "wedged"
						? statusKey
						: token,
				]),
			});
		}
		if (rank > priority) {
			winner = state;
			if (title) winner.taskTitle = title;
			priority = rank;
		}
	}
	notifications.sort(
		(a, b) => notificationPriority[b.kind] - notificationPriority[a.kind],
	);
	return { ...winner, notifications };
}

export interface CompanionPreferences {
	enabled: boolean;
	introduced: boolean;
	character: string;
	/** Intended position at 100% size; temporary chat/work-area clamping is not saved. */
	position?: { x: number; y: number };
}

export function companionPreferences(value: unknown): CompanionPreferences {
	const saved = record(value);
	const point = record(saved?.position);
	return {
		enabled: saved?.enabled === true,
		introduced:
			typeof saved?.introduced === "boolean"
				? saved.introduced
				: typeof saved?.enabled === "boolean",
		character:
			typeof saved?.character === "string" ? saved.character : "sprout",
		...(typeof point?.x === "number" &&
		Number.isFinite(point.x) &&
		typeof point.y === "number" &&
		Number.isFinite(point.y)
			? { position: { x: Math.round(point.x), y: Math.round(point.y) } }
			: {}),
	};
}

export const COMPANION_SIZE = { width: 132, height: 136 };
export const COMPANION_CHAT_SIZE = { width: 316, height: 194 };
export const COMPANION_DRAG_THRESHOLD = 6;

export function clampCompanionPosition(
	point: { x: number; y: number },
	area: { x: number; y: number; width: number; height: number },
	size = COMPANION_SIZE,
): { x: number; y: number } {
	return {
		x: Math.round(
			Math.max(
				area.x,
				Math.min(point.x, area.x + Math.max(0, area.width - size.width)),
			),
		),
		y: Math.round(
			Math.max(
				area.y,
				Math.min(point.y, area.y + Math.max(0, area.height - size.height)),
			),
		),
	};
}

export interface CompanionChatView {
	open: boolean;
	snapshot: CompanionChatSnapshot;
}

export type CompanionMotion = "rest" | "falling" | "landing";
export type CompanionActivity = "snack" | "bounce" | "guess";

export interface CompanionBridge {
	onMotion(listener: (motion: CompanionMotion) => void): () => void;
	setReducedMotion(reduced: boolean): void;
	getChat(): Promise<CompanionChatView>;
	onChat(listener: (view: CompanionChatView) => void): () => void;
	sendMessage(text: string): Promise<boolean>;
	newChat(): void;
	collapseChat(): void;
	expandChat(): void;
	openTask(): void;
	showMenu(): void;
	showNotifications(): void;
	/** Intrinsic height in CSS pixels; main applies the companion's zoom factor. */
	resizeChat(height: number): void;
	getState(): Promise<CompanionState>;
	onState(listener: (state: CompanionState) => void): () => void;
	getAppearance(): Promise<CompanionAppearance>;
	onAppearance(listener: (appearance: CompanionAppearance) => void): () => void;
	openChat(): void;
	hide(): void;
	setInteractive(interactive: boolean): void;
	drag(phase: "start" | "move" | "end" | "cancel"): void;
	nudge(direction: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown"): void;
}
