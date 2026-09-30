export const COMPANION_CHAT_MAX_CHARS = 16_000;

export interface CompanionChatMessage {
	id: string;
	role: "user" | "assistant";
	text: string;
}

export interface CompanionChatSnapshot {
	destination?: "chief-of-staff";
	sessionId: string | null;
	title: string;
	messages: CompanionChatMessage[];
	status: "idle" | "loading" | "working" | "attention" | "error";
	error: string | null;
	canSend: boolean;
	/** An unconfirmed send may only retry this exact text. */
	pendingText?: string;
	/** The admitted question, available before its transcript echo arrives. */
	activeQuestion?: { id: string; text: string };
}

export interface CompanionChatSendResult {
	accepted: boolean;
	snapshot: CompanionChatSnapshot;
}
