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
	| "error";

/**
 * WebSocket connection options
 */
export type WebSocketConnectionOptions = {
	/** Auto reconnect on connection loss */
	autoReconnect?: boolean;
	/** Reconnect interval in milliseconds */
	reconnectInterval?: number;
	/** Maximum number of reconnect attempts */
	maxReconnectAttempts?: number;
	/** Ping interval in milliseconds to keep connection alive */
	pingInterval?: number;
};

/**
 * Default WebSocket connection options
 */
const DEFAULT_CONNECTION_OPTIONS: WebSocketConnectionOptions = {
	autoReconnect: true,
	reconnectInterval: 2000,
	maxReconnectAttempts: 5,
	pingInterval: 30000,
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
	private subscriptions = new Set<string>();

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
		if (
			this.ws &&
			(this.ws.readyState === WebSocket.OPEN ||
				this.ws.readyState === WebSocket.CONNECTING)
		) {
			return Promise.resolve();
		}

		this.status = "connecting";
		this.emit("status", this.status);

		// Normalize the base URL to use ws:// or wss:// protocol
		const wsBaseUrl = this.baseUrl.replace(/^http/, "ws");
		const wsUrl = `${wsBaseUrl}/v1/ws/${this.messageId}`;

		return new Promise((resolve, reject) => {
			try {
				this.ws = new WebSocket(wsUrl);

				this.ws.onopen = () => {
					this.status = "connected";
					this.reconnectAttempts = 0;
					this.emit("status", this.status);
					this.emit("connected");
					this.startPingInterval();
					resolve();
				};

				this.ws.onmessage = (event) => {
					try {
						const message = JSON.parse(event.data) as WebSocketMessageUnion;
						this.handleMessage(message);
					} catch (error) {
						console.error("Error parsing WebSocket message:", error);
					}
				};

				this.ws.onclose = () => {
					this.stopPingInterval();

					if (this.status !== "disconnected") {
						this.status = "disconnected";
						this.emit("status", this.status);
						this.emit("disconnected");

						if (this.options.autoReconnect) {
							this.reconnect();
						}
					}
				};

				this.ws.onerror = (error) => {
					this.status = "error";
					this.emit("status", this.status);
					this.emit("error", error);
					reject(error);
				};
			} catch (error) {
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
		this.status = "disconnected";
		this.emit("status", this.status);

		this.stopPingInterval();

		if (this.ws) {
			this.ws.close();
			this.ws = null;
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

		this.ws.send(JSON.stringify(message));
		this.subscriptions.add(messageId);
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

		this.ws.send(JSON.stringify(message));
		this.subscriptions.delete(messageId);
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

		this.ws.send(JSON.stringify(message));
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
	 * Attempt to reconnect to the WebSocket endpoint
	 */
	private reconnect(): void {
		if (
			this.options.maxReconnectAttempts !== undefined &&
			this.reconnectAttempts >= this.options.maxReconnectAttempts
		) {
			this.status = "disconnected";
			this.emit("status", this.status);
			this.emit("reconnect_failed");
			return;
		}

		this.status = "reconnecting";
		this.emit("status", this.status);
		this.emit("reconnecting", this.reconnectAttempts + 1);

		setTimeout(() => {
			this.reconnectAttempts++;
			this.connect().catch(() => {
				// Error handling is done in the connect method
			});
		}, this.options.reconnectInterval);
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
		await client.connect();
		return client;
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

		await this.healthClient.connect();
		return this.healthClient;
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
