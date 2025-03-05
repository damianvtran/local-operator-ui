/**
 * Local Operator API - Credentials Endpoints
 */
import type { CredentialListResult, CredentialUpdate, CRUDResponse } from './types';

/**
 * Credentials API client for the Local Operator API
 */
export const CredentialsApi = {
  /**
   * List credentials
   * Retrieve a list of credential keys (without their values).
   * 
   * @param baseUrl - The base URL of the Local Operator API
   * @returns Promise resolving to the credentials list response
   */
  async listCredentials(baseUrl: string): Promise<CRUDResponse<CredentialListResult>> {
    const response = await fetch(`${baseUrl}/v1/credentials`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`List credentials request failed: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<CRUDResponse<CredentialListResult>>;
  },

  /**
   * Update a credential
   * Update an existing credential or create a new one with the provided key and value.
   * 
   * @param baseUrl - The base URL of the Local Operator API
   * @param credentialUpdate - The credential key and value to update
   * @returns Promise resolving to the update response
   */
  async updateCredential(baseUrl: string, credentialUpdate: CredentialUpdate): Promise<CRUDResponse> {
    const response = await fetch(`${baseUrl}/v1/credentials`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(credentialUpdate),
    });

    if (!response.ok) {
      throw new Error(`Update credential request failed: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<CRUDResponse>;
  },
};
