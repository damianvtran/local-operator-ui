/**
 * Local Operator API Types
 * Generated from OpenAPI specification v0.3.7
 */

/**
 * Configuration metadata
 */
export type ConfigMetadata = {
  /** When the configuration was created */
  created_at: string;
  /** When the configuration was last modified */
  last_modified: string;
  /** Description of the configuration */
  description: string;
};

/**
 * Configuration values
 */
export type ConfigValues = {
  /** Maximum number of messages to keep in conversation history */
  conversation_length: number;
  /** Maximum number of messages to show in detail view */
  detail_length: number;
  /** Maximum number of learning history items to keep */
  max_learnings_history: number;
  /** Hosting provider (e.g., 'openrouter') */
  hosting: string;
  /** Model name to use (e.g., 'openai/gpt-4o-mini') */
  model_name: string;
  /** Whether to automatically save conversations */
  auto_save_conversation: boolean;
};

/**
 * Configuration response
 */
export type ConfigResponse = {
  /** Configuration version */
  version: string;
  /** Configuration metadata */
  metadata: ConfigMetadata;
  /** Configuration values */
  values: ConfigValues;
};

/**
 * Configuration update request
 */
export type ConfigUpdate = {
  /** Maximum number of messages to keep in conversation history */
  conversation_length?: number;
  /** Maximum number of messages to show in detail view */
  detail_length?: number;
  /** Maximum number of learning history items to keep */
  max_learnings_history?: number;
  /** Hosting provider (e.g., 'openrouter') */
  hosting?: string;
  /** Model name to use (e.g., 'openai/gpt-4o-mini') */
  model_name?: string;
  /** Whether to automatically save conversations */
  auto_save_conversation?: boolean;
};

/**
 * Enum representing the different roles in a conversation with an AI model.
 * Used to track who sent each message in the conversation history.
 * Maps to the standard roles used by LangChain message types.
 */
export type ConversationRole = 
  | "system" 
  | "user" 
  | "assistant" 
  | "human" 
  | "ai" 
  | "function" 
  | "tool" 
  | "chat";

/**
 * Enum representing the possible states of a job.
 */
export type JobStatus = 
  | "pending" 
  | "processing" 
  | "completed" 
  | "failed" 
  | "cancelled";

/**
 * A record of a conversation with an AI model.
 */
export type ConversationRecord = {
  /** The content of the message */
  content: string;
  /** The role of the sender of the message */
  role: ConversationRole;
  /** Whether this message should be summarized */
  should_summarize?: boolean;
  /** Whether this message is temporary/ephemeral */
  ephemeral?: boolean;
  /** Whether this message has been summarized */
  summarized?: boolean;
  /** Whether this message is a system prompt */
  is_system_prompt?: boolean;
  /** When this message was created */
  timestamp?: string;
};

/**
 * Options for controlling the chat generation.
 */
export type ChatOptions = {
  /** 
   * Controls randomness in responses. Higher values like 0.8 make output more
   * random, while lower values like 0.2 make it more focused and deterministic.
   * Default: 0.8
   */
  temperature?: number;
  /**
   * Controls cumulative probability of tokens to sample from. Higher values (0.95) keep
   * more options, lower values (0.1) are more selective. Default: 0.9
   */
  top_p?: number;
  /**
   * Limits tokens to sample from at each step. Lower values (10) are more selective,
   * higher values (100) allow more variety. Default: 40
   */
  top_k?: number;
  /**
   * Maximum tokens to generate. Model may generate fewer if response completes
   * before reaching limit. Default: 4096
   */
  max_tokens?: number;
  /**
   * List of strings that will stop generation when encountered. Default: None
   */
  stop?: string[];
  /**
   * Reduces repetition by lowering likelihood of repeated tokens.
   * Range from -2.0 to 2.0. Default: 0.0
   */
  frequency_penalty?: number;
  /**
   * Increases diversity by lowering likelihood of prompt tokens.
   * Range from -2.0 to 2.0. Default: 0.0
   */
  presence_penalty?: number;
  /**
   * Random number seed for deterministic generation. Default: None
   */
  seed?: number;
};

/**
 * Request body for chat generation endpoint.
 */
export type ChatRequest = {
  /** Name of the hosting service to use for generation */
  hosting: string;
  /** Name of the model to use for generation */
  model: string;
  /** The prompt to generate a response for */
  prompt: string;
  /** Optional list of previous messages for context */
  context?: ConversationRecord[];
  /** Optional generation parameters to override defaults */
  options?: ChatOptions;
};

/**
 * Request body for agent chat generation endpoint.
 */
export type AgentChatRequest = {
  /** Name of the hosting service to use for generation */
  hosting: string;
  /** Name of the model to use for generation */
  model: string;
  /** The prompt to generate a response for */
  prompt: string;
  /** Whether to stream the response token by token. Default: False */
  stream?: boolean;
  /** Optional generation parameters to override defaults */
  options?: ChatOptions;
  /**
   * Whether to persist the conversation history by continuously updating the agent's
   * conversation history with each new message. Default: False
   */
  persist_conversation?: boolean;
  /**
   * The ID of the user message that this job is responding to.  This will assign
   * the ID to the new message in the conversation history such that it will not be
   * duplicated on refresh.
   */
  user_message_id?: string;
};

/**
 * Statistics about token usage for the chat request.
 */
export type ChatStats = {
  /** Total number of tokens used in prompt and completion */
  total_tokens: number;
  /** Number of tokens in the prompt */
  prompt_tokens: number;
  /** Number of tokens in the completion */
  completion_tokens: number;
};

/**
 * Response from chat generation endpoint.
 */
export type ChatResponse = {
  /** The generated text response */
  response: string;
  /** List of all messages including the new response */
  context: ConversationRecord[];
  /** Token usage statistics */
  stats: ChatStats;
};

/**
 * Response from health check endpoint.
 */
export type HealthCheckResponse = {
  /** HTTP status code */
  status: number;
  /** Health check message */
  message: string;
};

/**
 * Data required to create a new agent.
 */
export type AgentCreate = {
  /** Agent's name */
  name: string;
  /** 
   * The security prompt for the agent. Allows a user to explicitly specify 
   * the security context for the agent's code security checks.
   */
  security_prompt?: string;
  /** The hosting environment for the agent. Defaults to 'openrouter'. */
  hosting?: string;
  /** The model to use for the agent. Defaults to 'openai/gpt-4o-mini'. */
  model?: string;
  /** The description of the agent. */
  description?: string;
};

/**
 * Data for updating an existing agent.
 */
export type AgentUpdate = {
  /** Agent's name */
  name?: string;
  /** 
   * The security prompt for the agent. Allows a user to explicitly specify 
   * the security context for the agent's code security checks.
   */
  security_prompt?: string;
  /** The hosting environment for the agent. Defaults to 'openrouter'. */
  hosting?: string;
  /** The model to use for the agent. Defaults to 'openai/gpt-4o-mini'. */
  model?: string;
  /** The description of the agent. */
  description?: string;
};

/**
 * Schema for getting an agent conversation.
 */
export type AgentGetConversationResult = {
  /** ID of the agent involved in the conversation */
  agent_id: string;
  /** Date of the last message in the conversation */
  last_message_datetime: string;
  /** Date of the first message in the conversation */
  first_message_datetime: string;
  /** List of messages in the conversation */
  messages?: ConversationRecord[];
  /** Current page number */
  page: number;
  /** Number of messages per page */
  per_page: number;
  /** Total number of messages in the conversation */
  total: number;
  /** Total number of messages queried */
  count: number;
};

/**
 * Standard response schema for CRUD operations.
 */
export type CRUDResponse<T = unknown> = {
  /** HTTP status code */
  status: number;
  /** Outcome message of the operation */
  message: string;
  /** The resulting data, which can be an object, paginated list, or empty. */
  result?: T;
};

/**
 * Validation error details
 */
export type ValidationError = {
  /** Location of the error */
  loc: (string | number)[];
  /** Error message */
  msg: string;
  /** Error type */
  type: string;
};

/**
 * HTTP validation error response
 */
export type HTTPValidationError = {
  /** List of validation errors */
  detail: ValidationError[];
};

/**
 * Agent list response
 */
export type AgentListResult = {
  /** Total number of agents */
  total: number;
  /** Current page number */
  page: number;
  /** Number of agents per page */
  per_page: number;
  /** List of agents */
  agents: AgentDetails[];
};

/**
 * Detailed information about an AI agent
 * Contains all properties needed to identify, display, and interact with an agent
 */
export type AgentDetails = {
  /** Unique identifier for the agent */
  id: string;
  /** Display name of the agent */
  name: string;
  /** ISO timestamp when the agent was created */
  created_date: string;
  /** Version string of the agent software */
  version: string;
  /** Security constraints applied to the agent */
  security_prompt: string;
  /** Provider/platform where the agent is hosted (e.g., 'openrouter') */
  hosting: string;
  /** Full model identifier including provider and model name (e.g., 'openai/gpt-4o-mini') */
  model: string;
  /** Human-readable description of the agent's purpose and capabilities */
  description: string;
  /** Content of the most recent message from this agent */
  last_message?: string;
  /** ISO timestamp of when the last message was sent */
  last_message_datetime?: string;
};

/**
 * Job details
 */
export type JobDetails = {
  /** Job ID */
  id: string;
  /** Associated agent ID */
  agent_id: string;
  /** Job status */
  status: JobStatus;
  /** Original prompt */
  prompt: string;
  /** Model used */
  model: string;
  /** Hosting environment */
  hosting: string;
  /** Creation timestamp */
  created_at: string;
  /** Start timestamp */
  started_at?: string;
  /** Completion timestamp */
  completed_at?: string;
  /** Job result (for completed jobs) */
  result?: {
    /** Generated response */
    response: string;
    /** Conversation context */
    context: ConversationRecord[];
    /** Token usage statistics */
    stats: ChatStats;
  };
};

/**
 * Job list response
 */
export type JobListResult = {
  /** List of jobs */
  jobs: JobDetails[];
  /** Total count of jobs matching criteria */
  count: number;
};

/**
 * Job cleanup result
 */
export type JobCleanupResult = {
  /** Number of jobs removed */
  removed_count: number;
};

/**
 * Agent execution history record
 */
export type AgentExecutionRecord = {
  /** ID of the execution, this is a uuidv4 string */
  id: string;
  /** Code that was executed */
  code: string;
  /** Standard output from the execution */
  stdout: string;
  /** Standard error output from the execution */
  stderr: string;
  /** Logging information */
  logging: string;
  /** Status message about the execution */
  message: string;
  /** Formatted print output */
  formatted_print: string;
  /** Role of the execution (e.g., system) */
  role: string;
  /** Execution status (success, error, etc.) */
  status: string;
  /** Timestamp of when the execution occurred */
  timestamp: string;
};

/**
 * Agent execution history result
 */
export type AgentExecutionHistoryResult = {
  /** ID of the agent */
  agent_id: string;
  /** List of execution records */
  history: AgentExecutionRecord[];
  /** Timestamp of the first execution */
  first_execution_datetime: string;
  /** Timestamp of the last execution */
  last_execution_datetime: string;
  /** Current page number */
  page: number;
  /** Number of executions per page */
  per_page: number;
  /** Total number of executions */
  total: number;
  /** Number of executions returned */
  count: number;
};

/**
 * Credential list result
 */
export type CredentialListResult = {
  /** List of credential keys */
  keys: string[];
};

/**
 * Credential update request
 */
export type CredentialUpdate = {
  /** Credential key */
  key: string;
  /** Credential value */
  value: string;
};
