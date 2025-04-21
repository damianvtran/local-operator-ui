/**
 * Local Operator API - Jobs Endpoints
 */
import type {
	CRUDResponse,
	JobCleanupResult,
	JobDetails,
	JobListResult,
	JobStatus,
} from "./types";

/**
 * Jobs API client for the Local Operator API
 */
export const JobsApi = {
	/**
	 * Get job status
	 * Retrieves the status and result of an asynchronous job.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param jobId - The ID of the chat job to retrieve
	 * @returns Promise resolving to the job details
	 */
	async getJobStatus(
		baseUrl: string,
		jobId: string,
	): Promise<CRUDResponse<JobDetails>> {
		const response = await fetch(`${baseUrl}/v1/jobs/${jobId}`, {
			method: "GET",
			headers: {
				Accept: "application/json",
			},
		});

		if (!response.ok) {
			throw new Error(
				`Get job status request failed: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<CRUDResponse<JobDetails>>;
	},

	/**
	 * Cancel job
	 * Cancels a running or pending job.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param jobId - The ID of the job to cancel
	 * @returns Promise resolving to the cancellation response
	 */
	async cancelJob(baseUrl: string, jobId: string): Promise<CRUDResponse> {
		const response = await fetch(`${baseUrl}/v1/jobs/${jobId}`, {
			method: "DELETE",
			headers: {
				Accept: "application/json",
			},
		});

		if (!response.ok) {
			throw new Error(
				`Cancel job request failed: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<CRUDResponse>;
	},

	/**
	 * List jobs
	 * Lists all jobs, optionally filtered by agent ID and/or status.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param agentId - Filter jobs by agent ID (optional)
	 * @param status - Filter jobs by status (optional)
	 * @returns Promise resolving to the jobs list response
	 */
	async listJobs(
		baseUrl: string,
		agentId?: string,
		status?: JobStatus,
	): Promise<CRUDResponse<JobListResult>> {
		const url = new URL(`${baseUrl}/v1/jobs`);

		if (agentId) {
			url.searchParams.append("agent_id", agentId);
		}

		if (status) {
			url.searchParams.append("status", status);
		}

		const response = await fetch(url.toString(), {
			method: "GET",
			headers: {
				Accept: "application/json",
			},
		});

		if (!response.ok) {
			throw new Error(
				`List jobs request failed: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<CRUDResponse<JobListResult>>;
	},

	/**
	 * Cleanup old jobs
	 * Removes jobs older than the specified age.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param maxAgeHours - Maximum age of jobs to keep in hours (default: 24)
	 * @returns Promise resolving to the cleanup response
	 */
	async cleanupJobs(
		baseUrl: string,
		maxAgeHours = 24,
	): Promise<CRUDResponse<JobCleanupResult>> {
		const url = new URL(`${baseUrl}/v1/jobs/cleanup`);
		url.searchParams.append("max_age_hours", maxAgeHours.toString());

		const response = await fetch(url.toString(), {
			method: "POST",
			headers: {
				Accept: "application/json",
			},
		});

		if (!response.ok) {
			throw new Error(
				`Cleanup jobs request failed: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<CRUDResponse<JobCleanupResult>>;
	},
};
