import { config } from "./app-config";

/**
 * API client configuration derived from the app config
 */
export const apiConfig = {
	baseUrl: config.VITE_LOCAL_OPERATOR_API_URL,
	radientBaseUrl: config.VITE_RADIENT_SERVER_BASE_URL,
	radientClientId: config.VITE_RADIENT_CLIENT_ID,
};
