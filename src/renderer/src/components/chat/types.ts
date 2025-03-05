// Message types
export type MessageRole = 'user' | 'assistant';

export type Message = {
  id: string;
  role: MessageRole;
  timestamp: Date;
  attachments?: string[]; // URLs to attachments
  code?: string;
  stdout?: string;
  stderr?: string;
  logging?: string;
  message?: string;
  formatted_print?: string;
  status?: string;
}