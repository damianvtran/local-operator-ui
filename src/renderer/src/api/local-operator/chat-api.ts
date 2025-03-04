/**
 * Local Operator API - Chat Endpoints
 */
import type { ChatRequest, ChatResponse } from './types';

/**
 * Chat API client for the Local Operator API
 */
export const ChatApi = {
  /**
   * Process chat request
   * Accepts a prompt and optional context/configuration, returns the model response and conversation history.
   * 
   * @param baseUrl - The base URL of the Local Operator API
   * @param request - The chat request
   * @returns Promise resolving to the chat response
   */
  async processChat(baseUrl: string, request: ChatRequest): Promise<ChatResponse> {
    const response = await fetch(`${baseUrl}/v1/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`Chat request failed: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<ChatResponse>;
  },

  /**
   * Process chat request using a specific agent
   * Accepts a prompt and optional context/configuration, retrieves the specified agent from the registry,
   * applies it to the operator and executor, and returns the model response and conversation history.
   * 
   * @param baseUrl - The base URL of the Local Operator API
   * @param agentId - ID of the agent to use for the chat
   * @param request - The chat request
   * @returns Promise resolving to the chat response
   */
  async chatWithAgent(baseUrl: string, agentId: string, request: ChatRequest): Promise<ChatResponse> {
    const response = await fetch(`${baseUrl}/v1/chat/agents/${agentId}/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`Chat with agent request failed: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<ChatResponse>;
  },

  /**
   * Process chat request asynchronously
   * Accepts a prompt and optional context/configuration, starts an asynchronous job to process the request
   * and returns a job ID.
   * 
   * @param baseUrl - The base URL of the Local Operator API
   * @param request - The chat request
   * @returns Promise resolving to the job ID
   */
  async processChatAsync(baseUrl: string, request: ChatRequest): Promise<string> {
    const response = await fetch(`${baseUrl}/v1/chat/async`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`Async chat request failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    // The API doesn't specify the exact response format, but we assume it contains a job ID
    return result.job_id || result.id;
  },
};
