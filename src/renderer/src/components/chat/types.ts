// Message types
export type MessageRole = "user" | "assistant" | "system";

export type Message = {
	id: string;
	role: MessageRole;
	timestamp: Date;
	files?: string[]; // URLs to attachments
	code?: string;
	stdout?: string;
	stderr?: string;
	logging?: string;
	message?: string;
	formatted_print?: string;
	status?: string;
};
