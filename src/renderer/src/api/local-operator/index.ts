/**
 * Local Operator API Client
 * Generated from OpenAPI specification v0.3.7
 */

import { HealthApi } from './health-api';
import { ChatApi } from './chat-api';
import { AgentsApi } from './agents-api';
import { JobsApi } from './jobs-api';

// Export all API clients
export { HealthApi } from './health-api';
export { ChatApi } from './chat-api';
export { AgentsApi } from './agents-api';
export { JobsApi } from './jobs-api';

// Export all types
export * from './types';

// Type for API methods
type ApiMethod = (...args: unknown[]) => Promise<unknown>;

/**
 * LocalOperatorClient - Main client for the Local Operator API
 * Provides a unified interface to all API endpoints
 */
export class LocalOperatorClient {
  private baseUrl: string;

  /**
   * Create a new Local Operator API client
   * 
   * @param baseUrl - The base URL of the Local Operator API
   */
  constructor(baseUrl: string) {
    // Ensure the base URL doesn't end with a slash
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  }

  /**
   * Get the Health API client
   */
  get health() {
    const api = { ...HealthApi };
    // Bind the base URL to all methods
    for (const key of Object.keys(api)) {
      const typedKey = key as keyof typeof HealthApi;
      const method = api[typedKey] as ApiMethod;
      (api as Record<string, ApiMethod>)[key] = (...args: unknown[]) => 
        method(this.baseUrl, ...args);
    }
    return api;
  }

  /**
   * Get the Chat API client
   */
  get chat() {
    const api = { ...ChatApi };
    // Bind the base URL to all methods
    for (const key of Object.keys(api)) {
      const typedKey = key as keyof typeof ChatApi;
      const method = api[typedKey] as ApiMethod;
      (api as Record<string, ApiMethod>)[key] = (...args: unknown[]) => 
        method(this.baseUrl, ...args);
    }
    return api;
  }

  /**
   * Get the Agents API client
   */
  get agents() {
    const api = { ...AgentsApi };
    // Bind the base URL to all methods
    for (const key of Object.keys(api)) {
      const typedKey = key as keyof typeof AgentsApi;
      const method = api[typedKey] as ApiMethod;
      (api as Record<string, ApiMethod>)[key] = (...args: unknown[]) => 
        method(this.baseUrl, ...args);
    }
    return api;
  }

  /**
   * Get the Jobs API client
   */
  get jobs() {
    const api = { ...JobsApi };
    // Bind the base URL to all methods
    for (const key of Object.keys(api)) {
      const typedKey = key as keyof typeof JobsApi;
      const method = api[typedKey] as ApiMethod;
      (api as Record<string, ApiMethod>)[key] = (...args: unknown[]) => 
        method(this.baseUrl, ...args);
    }
    return api;
  }
}

/**
 * Create a new Local Operator API client
 * 
 * @param baseUrl - The base URL of the Local Operator API
 * @returns A new Local Operator API client instance
 */
export const createLocalOperatorClient = (baseUrl: string): LocalOperatorClient => {
  return new LocalOperatorClient(baseUrl);
};
