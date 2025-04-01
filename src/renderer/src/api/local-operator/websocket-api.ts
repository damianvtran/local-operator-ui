/**
 * Local Operator API - WebSocket Endpoints
 *
 * This module provides a client for interacting with the WebSocket endpoints
 * of the Local Operator API. It allows subscribing to real-time updates for
 * specific message IDs and handling WebSocket connections.
 */

// Import AgentExecutionRecord type to use in UpdateMessage
import type { AgentExecutionRecord } from "./types";

// Using a browser-compatible EventEmitter implementation
class EventEmitter {
	private events: Record<string, Array<(...args: unknown[]) => void>> = {};

	public on(event: string, listener: (...args: unknown[]) => void): this {
		if (!this.events[event]) {
			this.events[event] = [];
		}
		this.events[event].push(listener);
		return this;
	}

	public emit(event: string, ...args: unknown[]): boolean {
		const listeners = this.events[event];
		if (!listeners || listeners.length === 0) {
			return false;
		}

		for (const listener of listeners) {
			listener(...args);
		}
		return true;
	}

	public removeListener(
		event: string,
		listener: (...args: unknown[]) => void,
	): this {
		const listeners = this.events[event];
		if (!listeners) {
			return this;
		}

		const index = listeners.indexOf(listener);
		if (index !== -1) {
			listeners.splice(index, 1);
		}
		return this;
	}

	public once(event: string, listener: (...args: unknown[]) => void): this {
		const onceWrapper = (...args: unknown[]) => {
			listener(...args);
			this.removeListener(event, onceWrapper);
		};
		return this.on(event, onceWrapper);
	}

	public removeAllListeners(event?: string): this {
		if (event) {
			delete this.events[event];
		} else {
			this.events = {};
		}
		return this;
	}
}

/**
 * Type definitions for WebSocket message types
 */
export type WebSocketMessageType =
	| "ping"
	| "pong"
	| "subscribe"
	| "unsubscribe"
	| "connection_established"
	| "subscription"
	| "unsubscription"
	| "update";

/**
 * Base interface for all WebSocket messages
 */
export type WebSocketMessage = {
	type: WebSocketMessageType;
	message_id?: string;
};

/**
 * Ping message to keep the connection alive
 */
export type PingMessage = WebSocketMessage & {
	type: "ping";
};

/**
 * Pong response to a ping message
 */
export type PongMessage = WebSocketMessage & {
	type: "pong";
};

/**
 * Message to subscribe to updates for a specific message ID
 */
export type SubscribeMessage = WebSocketMessage & {
	type: "subscribe";
	message_id: string;
};

/**
 * Message to unsubscribe from updates for a specific message ID
 */
export type UnsubscribeMessage = WebSocketMessage & {
	type: "unsubscribe";
	message_id: string;
};

/**
 * Message indicating a successful connection
 */
export type ConnectionEstablishedMessage = WebSocketMessage & {
	type: "connection_established";
	message_id: string;
	status: "connected";
};

/**
 * Message indicating a successful subscription
 */
export type SubscriptionMessage = WebSocketMessage & {
	type: "subscription";
	message_id: string;
	status: "subscribed";
};

/**
 * Message indicating a successful unsubscription
 */
export type UnsubscriptionMessage = WebSocketMessage & {
	type: "unsubscription";
	message_id: string;
	status: "unsubscribed";
};

/**
 * Message containing an update for a specific message ID
 * This extends the CodeExecutionResult from the backend
 */
/**
 * Message containing an update for a specific message ID
 * This extends the AgentExecutionRecord from the backend with additional fields
 */
export type UpdateMessage = WebSocketMessage &
	Omit<AgentExecutionRecord, "type"> & {
		type: "update";
		message_id: string;
	};

/**
 * Union type for all possible WebSocket messages
 */
export type WebSocketMessageUnion =
	| PingMessage
	| PongMessage
	| SubscribeMessage
	| UnsubscribeMessage
	| ConnectionEstablishedMessage
	| SubscriptionMessage
	| UnsubscriptionMessage
	| UpdateMessage;

/**
 * WebSocket connection status
 */
export type WebSocketConnectionStatus =
	| "connecting"
	| "connected"
	| "disconnected"
	| "reconnecting"
	| "error"
	| "failed";

/**
 * WebSocket connection options
 */
export type WebSocketConnectionOptions = {
	/** Auto reconnect on connection loss */
	autoReconnect?: boolean;
	/** Base reconnect interval in milliseconds */
	reconnectInterval?: number;
	/** Maximum number of reconnect attempts */
	maxReconnectAttempts?: number;
	/** Ping interval in milliseconds to keep connection alive */
	pingInterval?: number;
	/** Multiplier for exponential backoff */
	reconnectBackoffMultiplier?: number;
	/** Maximum reconnect delay in milliseconds */
	maxReconnectDelay?: number;
	/** Random jitter in milliseconds to add to reconnect delay */
	reconnectJitter?: number;
	/** Cooldown period in milliseconds after max reconnect attempts */
	reconnectCooldown?: number;
	/** Connection timeout in milliseconds */
	connectionTimeout?: number;
	/** Delay before sending any messages after connection in milliseconds */
	messageDelay?: number;
};

/**
 * Default WebSocket connection options
 */
const DEFAULT_CONNECTION_OPTIONS: WebSocketConnectionOptions = {
	autoReconnect: true,
	reconnectInterval: 3000, // Increased from 2000ms to 3000ms
	maxReconnectAttempts: 3, // Reduced from 5 to 3
	pingInterval: 30000,
	reconnectBackoffMultiplier: 2.0, // Increased from 1.5 to 2.0
	maxReconnectDelay: 30000,
	reconnectJitter: 1000, // Increased from 500ms to 1000ms
	reconnectCooldown: 60000,
	connectionTimeout: 5000, // 5 seconds
	messageDelay: 500, // 500ms
};

/**
 * WebSocket client for a specific message ID
 * Manages a single WebSocket connection and handles reconnection logic
 */
export class WebSocketClient extends EventEmitter {
	private ws: WebSocket | null = null;
	private messageId: string;
	private baseUrl: string;
	private status: WebSocketConnectionStatus = "disconnected";
	private options: WebSocketConnectionOptions;
	private reconnectAttempts = 0;
	private pingIntervalId: number | null = null;
	private reconnectTimeoutId: number | null = null;
	private cooldownTimeoutId: number | null = null;
	private subscriptions = new Set<string>();
	private isReconnecting = false;
	private lastErrorTime = 0;
	private consecutiveErrorCount = 0;

	/**
	 * Create a new WebSocket client for a specific message ID
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param messageId - The message ID to subscribe to
	 * @param options - Connection options
	 */
	constructor(
		baseUrl: string,
		messageId: string,
		options: WebSocketConnectionOptions = {},
	) {
		super();
		this.baseUrl = baseUrl;
		this.messageId = messageId;
		this.options = { ...DEFAULT_CONNECTION_OPTIONS, ...options };
		this.subscriptions.add(messageId);
	}

	/**
	 * Get the current connection status
	 */
	public getStatus(): WebSocketConnectionStatus {
		return this.status;
	}

	/**
	 * Connect to the WebSocket endpoint
	 *
	 * @returns Promise that resolves when the connection is established
	 */
	public connect(): Promise<void> {
		// If we're already connected or connecting, return a resolved promise
		if (
			this.ws &&
			(this.ws.readyState === WebSocket.OPEN ||
				this.ws.readyState === WebSocket.CONNECTING)
		) {
			console.log(
				`WebSocket for ${this.messageId} is already connected or connecting`,
			);
			return Promise.resolve();
		}

		// If we're in a cooldown period, return a rejected promise
		if (this.status === "failed") {
			const error = new Error(
				`WebSocket connection failed after ${this.options.maxReconnectAttempts} attempts. In cooldown period.`,
			);
			console.error(error.message);
			return Promise.reject(error);
		}

		// If we're already reconnecting, return a rejected promise
		if (this.isReconnecting) {
			const error = new Error("WebSocket reconnection already in progress");
			console.error(error.message);
			return Promise.reject(error);
		}

		// Check for rapid connection attempts (more than 3 in 1 second)
		const now = Date.now();
		if (now - this.lastErrorTime < 1000) {
			this.consecutiveErrorCount++;
			if (this.consecutiveErrorCount > 3) {
				console.warn(
					`Too many connection attempts in a short period for ${this.messageId}. Entering cooldown for ${this.options.reconnectCooldown}ms.`,
				);
				this.enterCooldown();
				return Promise.reject(
					new Error(
						`Too many connection attempts for ${this.messageId}. In cooldown period.`,
					),
				);
			}
		} else {
			this.consecutiveErrorCount = 0;
		}
		this.lastErrorTime = now;

		this.status = "connecting";
		this.emit("status", this.status);

		// Normalize the base URL to use ws:// or wss:// protocol
		const wsBaseUrl = this.baseUrl.replace(/^http/, "ws");
		const wsUrl = `${wsBaseUrl}/v1/ws/${this.messageId}`;
		console.log(`Connecting to WebSocket URL: ${wsUrl}`);

		return new Promise((resolve, reject) => {
			// Set a connection timeout
			const connectionTimeoutId = this.options.connectionTimeout
				? window.setTimeout(() => {
						if (this.status === "connecting") {
							console.error(
								`WebSocket connection timeout for ${this.messageId} after ${this.options.connectionTimeout}ms`,
							);

							// Clean up the WebSocket if it exists
							if (this.ws) {
								this.ws.onopen = null;
								this.ws.onmessage = null;
								this.ws.onclose = null;
								this.ws.onerror = null;
								this.ws.close();
								this.ws = null;
							}

							this.status = "error";
							this.emit("status", this.status);
							this.emit(
								"error",
								new Error(
									`Connection timeout after ${this.options.connectionTimeout}ms`,
								),
							);

							reject(
								new Error(
									`Connection timeout after ${this.options.connectionTimeout}ms`,
								),
							);

							// Attempt to reconnect if enabled
							if (this.options.autoReconnect && !this.isReconnecting) {
								this.reconnect();
							}
						}
					}, this.options.connectionTimeout)
				: null;

			try {
				// Clean up any existing WebSocket
				if (this.ws) {
					console.log(`Cleaning up existing WebSocket for ${this.messageId}`);
					this.ws.onopen = null;
					this.ws.onmessage = null;
					this.ws.onclose = null;
					this.ws.onerror = null;
					this.ws.close();
					this.ws = null;
				}

				// Create a new WebSocket
				console.log(`Creating new WebSocket for ${this.messageId}`);
				this.ws = new WebSocket(wsUrl);

				// Set up event handlers
				this.ws.onopen = () => {
					const timestamp = new Date().toISOString().substring(11, 23);
					console.log(
						`[${timestamp}] WebSocket opened for ${this.messageId} (readyState: ${this.ws?.readyState})`,
					);

					// Clear the connection timeout
					if (connectionTimeoutId !== null) {
						clearTimeout(connectionTimeoutId);
					}

					this.status = "connected";
					this.reconnectAttempts = 0;
					this.isReconnecting = false;
					this.emit("status", this.status);
					this.emit("connected");

					// Add a small delay before sending any messages
					// This helps ensure the connection is fully established
					if (this.options.messageDelay) {
						const delayMs = this.options.messageDelay;
						console.log(
							`[${timestamp}] Delaying WebSocket message handling for ${delayMs}ms for ${this.messageId}`,
						);
						setTimeout(() => {
							const newTimestamp = new Date().toISOString().substring(11, 23);
							console.log(
								`[${newTimestamp}] Starting ping interval for ${this.messageId} after delay`,
							);
							if (this.ws?.readyState === WebSocket.OPEN) {
								this.startPingInterval();
								resolve();
							} else {
								console.warn(
									`[${newTimestamp}] WebSocket not open after delay for ${this.messageId} (readyState: ${this.ws?.readyState})`,
								);
								if (
									this.ws?.readyState === WebSocket.CLOSED ||
									this.ws?.readyState === WebSocket.CLOSING
								) {
									reject(
										new Error(
											`WebSocket closed during connection delay for ${this.messageId}`,
										),
									);
								} else {
									// Still try to resolve if it's in CONNECTING state
									resolve();
								}
							}
						}, delayMs);
					} else {
						this.startPingInterval();
						resolve();
					}
				};

				this.ws.onmessage = (event) => {
					try {
						const message = JSON.parse(event.data) as WebSocketMessageUnion;
						console.log(
							`Received WebSocket message for ${this.messageId}:`,
							message.type,
						);
						this.handleMessage(message);
					} catch (error) {
						console.error(
							`Error parsing WebSocket message for ${this.messageId}:`,
							error,
						);
					}
				};

				this.ws.onclose = (event) => {
					const timestamp = new Date().toISOString().substring(11, 23);
					console.log(
						`[${timestamp}] WebSocket closed for ${this.messageId} with code ${event.code}, reason: ${event.reason || "No reason provided"}`,
					);

					// Log additional context about the close
					console.log(
						`[${timestamp}] WebSocket close context - Current status: ${this.status}, isReconnecting: ${this.isReconnecting}, reconnectAttempts: ${this.reconnectAttempts}`,
					);

					// Clear the connection timeout
					if (connectionTimeoutId !== null) {
						clearTimeout(connectionTimeoutId);
					}

					this.stopPingInterval();

					// Only handle if we're not already disconnected
					if (this.status !== "disconnected" && this.status !== "failed") {
						this.status = "disconnected";
						this.emit("status", this.status);
						this.emit("disconnected", event);

						// Attempt to reconnect if enabled
						if (this.options.autoReconnect && !this.isReconnecting) {
							console.log(
								`[${timestamp}] Auto-reconnecting WebSocket for ${this.messageId}`,
							);
							this.reconnect();
						} else {
							console.log(
								`[${timestamp}] Not reconnecting WebSocket for ${this.messageId} - autoReconnect: ${this.options.autoReconnect}, isReconnecting: ${this.isReconnecting}`,
							);
						}
					} else {
						console.log(
							`[${timestamp}] WebSocket already in ${this.status} state for ${this.messageId}, not changing status`,
						);
					}
				};

				this.ws.onerror = (event) => {
					// Format the error properly - WebSocket error events don't have useful toString()
					const timestamp = new Date().toISOString().substring(11, 23);
					const errorMessage = `WebSocket connection error for ${this.messageId}`;
					console.error(`[${timestamp}] ${errorMessage}`, event);

					// Log additional context about the error
					console.log(
						`[${timestamp}] WebSocket error context - readyState: ${this.ws?.readyState}, status: ${this.status}, isReconnecting: ${this.isReconnecting}`,
					);

					// Clear the connection timeout
					if (connectionTimeoutId !== null) {
						clearTimeout(connectionTimeoutId);
					}

					// Create a proper Error object
					const formattedError = new Error(errorMessage);

					this.status = "error";
					this.emit("status", this.status);
					this.emit("error", formattedError);

					// If the WebSocket is already closed or closing, don't try to close it again
					if (
						this.ws &&
						(this.ws.readyState === WebSocket.OPEN ||
							this.ws.readyState === WebSocket.CONNECTING)
					) {
						console.log(
							`[${timestamp}] Closing WebSocket after error for ${this.messageId}`,
						);
						try {
							this.ws.close();
						} catch (closeError) {
							console.error(
								`[${timestamp}] Error closing WebSocket after error for ${this.messageId}:`,
								closeError,
							);
						}
					}

					reject(formattedError);
				};
			} catch (error) {
				console.error(`Error creating WebSocket for ${this.messageId}:`, error);

				// Clear the connection timeout
				if (connectionTimeoutId !== null) {
					clearTimeout(connectionTimeoutId);
				}

				this.status = "error";
				this.emit("status", this.status);
				this.emit("error", error);
				reject(error);
			}
		});
	}

	/**
	 * Disconnect from the WebSocket endpoint
	 */
	public disconnect(): void {
		// Prevent multiple disconnections
		if (this.status === "disconnected" || this.status === "failed") {
			console.log(
				`WebSocket for ${this.messageId} already disconnected, skipping`,
			);
			return;
		}

		// Clear all timeouts and intervals
		this.clearTimeouts();

		// Update status before closing to prevent reconnection attempts
		this.status = "disconnected";
		this.emit("status", this.status);
		this.isReconnecting = false;

		// Only attempt to close if we have a valid WebSocket
		if (this.ws) {
			try {
				// Check if the WebSocket is in a state where it can be closed
				if (
					this.ws.readyState === WebSocket.OPEN ||
					this.ws.readyState === WebSocket.CONNECTING
				) {
					console.log(`Closing WebSocket for ${this.messageId}`);
					this.ws.close();
				}
			} catch (error) {
				console.error(`Error closing WebSocket for ${this.messageId}:`, error);
			} finally {
				// Always null out the WebSocket reference
				this.ws = null;
			}
		}
	}

	/**
	 * Subscribe to updates for a specific message ID
	 *
	 * @param messageId - The message ID to subscribe to
	 */
	public subscribe(messageId: string): void {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			this.subscriptions.add(messageId);
			return;
		}

		const message: SubscribeMessage = {
			type: "subscribe",
			message_id: messageId,
		};

		try {
			this.ws.send(JSON.stringify(message));
			this.subscriptions.add(messageId);
		} catch (error) {
			console.error("Error subscribing to message:", error);
		}
	}

	/**
	 * Unsubscribe from updates for a specific message ID
	 *
	 * @param messageId - The message ID to unsubscribe from
	 */
	public unsubscribe(messageId: string): void {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			this.subscriptions.delete(messageId);
			return;
		}

		const message: UnsubscribeMessage = {
			type: "unsubscribe",
			message_id: messageId,
		};

		try {
			this.ws.send(JSON.stringify(message));
			this.subscriptions.delete(messageId);
		} catch (error) {
			console.error("Error unsubscribing from message:", error);
		}
	}

	/**
	 * Send a ping message to keep the connection alive
	 */
	private sendPing(): void {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			return;
		}

		const message: PingMessage = {
			type: "ping",
		};

		try {
			this.ws.send(JSON.stringify(message));
		} catch (error) {
			console.error("Error sending ping:", error);
			// If we can't send a ping, the connection is probably dead
			this.disconnect();
			if (this.options.autoReconnect) {
				this.reconnect();
			}
		}
	}

	/**
	 * Start the ping interval to keep the connection alive
	 */
	private startPingInterval(): void {
		this.stopPingInterval();

		if (this.options.pingInterval) {
			this.pingIntervalId = window.setInterval(() => {
				this.sendPing();
			}, this.options.pingInterval);
		}
	}

	/**
	 * Stop the ping interval
	 */
	private stopPingInterval(): void {
		if (this.pingIntervalId !== null) {
			clearInterval(this.pingIntervalId);
			this.pingIntervalId = null;
		}
	}

	/**
	 * Clear all timeouts and intervals
	 */
	private clearTimeouts(): void {
		this.stopPingInterval();

		if (this.reconnectTimeoutId !== null) {
			clearTimeout(this.reconnectTimeoutId);
			this.reconnectTimeoutId = null;
		}

		if (this.cooldownTimeoutId !== null) {
			clearTimeout(this.cooldownTimeoutId);
			this.cooldownTimeoutId = null;
		}
	}

	/**
	 * Enter a cooldown period after max reconnect attempts
	 */
	private enterCooldown(): void {
		this.clearTimeouts();
		this.status = "failed";
		this.emit("status", this.status);
		this.emit("reconnect_failed");

		// Set a timeout to reset the status after the cooldown period
		if (this.options.reconnectCooldown) {
			this.cooldownTimeoutId = window.setTimeout(() => {
				this.status = "disconnected";
				this.emit("status", this.status);
				this.reconnectAttempts = 0;
				this.isReconnecting = false;
				this.consecutiveErrorCount = 0;
			}, this.options.reconnectCooldown);
		}
	}

	/**
	 * Calculate the delay for the next reconnection attempt
	 * Uses exponential backoff with jitter
	 */
	private calculateReconnectDelay(): number {
		const {
			reconnectInterval,
			reconnectBackoffMultiplier,
			maxReconnectDelay,
			reconnectJitter,
		} = this.options;

		// Calculate base delay with exponential backoff
		let delay = reconnectInterval || 2000;
		if (reconnectBackoffMultiplier && this.reconnectAttempts > 0) {
			delay = delay * reconnectBackoffMultiplier ** this.reconnectAttempts;
		}

		// Cap at maximum delay
		if (maxReconnectDelay) {
			delay = Math.min(delay, maxReconnectDelay);
		}

		// Add jitter to prevent thundering herd
		if (reconnectJitter) {
			const jitter = Math.random() * reconnectJitter;
			delay = delay + jitter;
		}

		return delay;
	}

	/**
	 * Attempt to reconnect to the WebSocket endpoint
	 */
	private reconnect(): void {
		// If we're already reconnecting, don't start another reconnection
		if (this.isReconnecting) {
			console.log(
				`Already reconnecting for ${this.messageId}, skipping duplicate reconnect`,
			);
			return;
		}

		// If we've reached the maximum number of reconnect attempts, enter cooldown
		if (
			this.options.maxReconnectAttempts !== undefined &&
			this.reconnectAttempts >= this.options.maxReconnectAttempts
		) {
			console.log(
				`Maximum reconnect attempts (${this.options.maxReconnectAttempts}) reached for ${this.messageId}, entering cooldown`,
			);
			this.enterCooldown();
			return;
		}

		this.isReconnecting = true;
		this.status = "reconnecting";
		this.emit("status", this.status);
		this.emit("reconnecting", this.reconnectAttempts + 1);

		// Calculate delay with exponential backoff and jitter
		const delay = this.calculateReconnectDelay();

		console.log(
			`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1}/${this.options.maxReconnectAttempts}) for ${this.messageId}`,
		);

		// Set a timeout to reconnect
		this.reconnectTimeoutId = window.setTimeout(() => {
			// Check if we're still in a valid state to reconnect
			if (this.status === "disconnected" || this.status === "reconnecting") {
				this.reconnectAttempts++;
				this.reconnectTimeoutId = null;

				// Attempt to connect
				this.connect().catch((error) => {
					console.error(
						`Reconnection attempt ${this.reconnectAttempts} failed for ${this.messageId}:`,
						error,
					);

					// If this was the last attempt, enter cooldown
					if (
						this.reconnectAttempts >= (this.options.maxReconnectAttempts || 0)
					) {
						this.enterCooldown();
					} else if (this.status !== "failed") {
						// Otherwise, try again (unless we've entered cooldown)
						this.isReconnecting = false;
						this.reconnect();
					}
				});
			} else {
				console.log(
					`Skipping reconnect for ${this.messageId} because status is ${this.status}`,
				);
				this.isReconnecting = false;
				this.reconnectTimeoutId = null;
			}
		}, delay);
	}

	/**
	 * Handle incoming WebSocket messages
	 *
	 * @param message - The parsed WebSocket message
	 */
	private handleMessage(message: WebSocketMessageUnion): void {
		this.emit("message", message);

		switch (message.type) {
			case "pong":
				this.emit("pong");
				break;

			case "connection_established":
				this.emit("connection_established", message);

				// Resubscribe to all subscriptions
				for (const messageId of this.subscriptions) {
					if (messageId !== this.messageId) {
						this.subscribe(messageId);
					}
				}
				break;

			case "subscription":
				this.emit("subscription", message);
				break;

			case "unsubscription":
				this.emit("unsubscription", message);
				break;

			default:
				// For update messages and other types
				if (message.message_id) {
					this.emit(`update:${message.message_id}`, message);
				}
				break;
		}
	}
}

/**
 * WebSocket manager for the Local Operator API
 * Manages multiple WebSocket connections for different message IDs
 */
export class WebSocketManager {
	private baseUrl: string;
	private clients: Map<string, WebSocketClient> = new Map();
	private healthClient: WebSocketClient | null = null;
	private defaultOptions: WebSocketConnectionOptions;

	/**
	 * Create a new WebSocket manager
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param options - Default connection options for all clients
	 */
	constructor(
		baseUrl: string,
		options: WebSocketConnectionOptions = DEFAULT_CONNECTION_OPTIONS,
	) {
		this.baseUrl = baseUrl;
		this.defaultOptions = options;
	}

	/**
	 * Get or create a WebSocket client for a specific message ID
	 *
	 * @param messageId - The message ID to subscribe to
	 * @param options - Connection options for this specific client
	 * @returns The WebSocket client
	 */
	public getClient(
		messageId: string,
		options?: WebSocketConnectionOptions,
	): WebSocketClient {
		if (!this.clients.has(messageId)) {
			const client = new WebSocketClient(
				this.baseUrl,
				messageId,
				options || this.defaultOptions,
			);
			this.clients.set(messageId, client);
		}

		const client = this.clients.get(messageId);
		if (!client) {
			throw new Error(`WebSocket client for message ID ${messageId} not found`);
		}
		return client;
	}

	/**
	 * Connect to the WebSocket endpoint for a specific message ID
	 *
	 * @param messageId - The message ID to subscribe to
	 * @param options - Connection options for this specific client
	 * @returns Promise that resolves to the WebSocket client
	 */
	public async connect(
		messageId: string,
		options?: WebSocketConnectionOptions,
	): Promise<WebSocketClient> {
		const client = this.getClient(messageId, options);
		try {
			await client.connect();
			return client;
		} catch (error) {
			console.error(
				`Failed to connect WebSocket for message ID ${messageId}:`,
				error,
			);
			throw error;
		}
	}

	/**
	 * Disconnect from the WebSocket endpoint for a specific message ID
	 *
	 * @param messageId - The message ID to disconnect from
	 */
	public disconnect(messageId: string): void {
		const client = this.clients.get(messageId);

		if (client) {
			client.disconnect();
			this.clients.delete(messageId);
		}
	}

	/**
	 * Disconnect all WebSocket clients
	 */
	public disconnectAll(): void {
		for (const client of this.clients.values()) {
			client.disconnect();
		}

		this.clients.clear();

		if (this.healthClient) {
			this.healthClient.disconnect();
			this.healthClient = null;
		}
	}

	/**
	 * Connect to the health check WebSocket endpoint
	 *
	 * @param options - Connection options for the health client
	 * @returns Promise that resolves to the health WebSocket client
	 */
	public async connectHealth(
		options?: WebSocketConnectionOptions,
	): Promise<WebSocketClient> {
		if (!this.healthClient) {
			// For health endpoint, we use a special client
			const wsBaseUrl = this.baseUrl.replace(/^http/, "ws");
			const healthClient = new WebSocketClient(
				wsBaseUrl,
				"health",
				options || this.defaultOptions,
			);

			this.healthClient = healthClient;
		}

		try {
			await this.healthClient.connect();
			return this.healthClient;
		} catch (error) {
			console.error("Failed to connect to health WebSocket:", error);
			throw error;
		}
	}

	/**
	 * Disconnect from the health check WebSocket endpoint
	 */
	public disconnectHealth(): void {
		if (this.healthClient) {
			this.healthClient.disconnect();
			this.healthClient = null;
		}
	}
}

/**
 * WebSocket API client for the Local Operator API
 */
export const WebSocketApi = {
	/**
	 * Create a new WebSocket manager
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param options - Default connection options for all clients
	 * @returns A new WebSocket manager
	 */
	createManager(
		baseUrl: string,
		options?: WebSocketConnectionOptions,
	): WebSocketManager {
		return new WebSocketManager(baseUrl, options);
	},
};
