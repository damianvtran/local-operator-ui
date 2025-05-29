import type {
	ActionType,
	ExecutionType,
} from "@shared/api/local-operator/types";

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
	task_classification?: string;
	action?: ActionType;
	execution_type?: ExecutionType;
	is_streamable?: boolean;
	is_complete?: boolean;
	conversation_id?: string;
	content?: string;
	file_path?: string;
	replacements?: string;
	agent?: string;
	learnings?: string;
	thinking?: string;
};
