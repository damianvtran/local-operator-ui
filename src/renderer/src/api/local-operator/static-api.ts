/**
 * Static API Client
 * Provides access to static file hosting endpoints
 */

/**
 * Get the URL for an image file from the static images endpoint
 *
 * @param baseUrl - The base URL of the Local Operator API
 * @param imagePath - The path to the image file on disk
 * @returns The URL to access the image via the static endpoint
 */
export const getImageUrl = (baseUrl: string, imagePath: string): string => {
	// Ensure the base URL doesn't end with a slash
	const normalizedBaseUrl = baseUrl.endsWith("/")
		? baseUrl.slice(0, -1)
		: baseUrl;

	// Remove the file:// protocol if present
	let normalizedPath = imagePath;
	if (normalizedPath.startsWith("file://")) {
		normalizedPath = normalizedPath.substring(7);
	}

	// Encode the image path to handle special characters
	const encodedPath = encodeURIComponent(normalizedPath);

	// Return the full URL to the static images endpoint
	return `${normalizedBaseUrl}/v1/static/images?path=${encodedPath}`;
};

/**
 * Get the URL for a video file from the static videos endpoint
 *
 * @param baseUrl - The base URL of the Local Operator API
 * @param videoPath - The path to the video file on disk
 * @returns The URL to access the video via the static endpoint
 */
export const getVideoUrl = (baseUrl: string, videoPath: string): string => {
	// Ensure the base URL doesn't end with a slash
	const normalizedBaseUrl = baseUrl.endsWith("/")
		? baseUrl.slice(0, -1)
		: baseUrl;

	// Remove the file:// protocol if present
	let normalizedPath = videoPath;
	if (normalizedPath.startsWith("file://")) {
		normalizedPath = normalizedPath.substring(7);
	}

	// Encode the video path to handle special characters
	const encodedPath = encodeURIComponent(normalizedPath);

	// Return the full URL to the static videos endpoint
	return `${normalizedBaseUrl}/v1/static/videos?path=${encodedPath}`;
};

/**
 * Static API methods
 */
export const StaticApi = {
	getImageUrl,
	getVideoUrl,
};
