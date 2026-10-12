/**
 * Static API Client
 * Provides access to static file hosting endpoints
 */

import { desktopRequest } from "./desktop-api";

/**
 * The static families a signed URL can name.
 *
 * The core's signed string is `<route>\n<raw path>\n<exp>` with the route as
 * this exact word (`docs/DESKTOP_API.md`, the token/signed-URL contract), so
 * these are not a spelling this app chose - they are held to the core's
 * vocabulary the same way the request schema does.
 */
export type StaticRoute = "images" | "videos" | "audio" | "html";

/** A signed static URL minted by the core, for one route and path. */
export type SignedStaticUrl = {
	/** Absolute, ready for a `src`; the core answers origin-relative. */
	url: string;
	/** Epoch seconds the signature stops verifying at. */
	exp: number;
};

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
 * Get the URL for an audio file from the static audio endpoint
 *
 * @param baseUrl - The base URL of the Local Operator API
 * @param audioPath - The path to the audio file on disk
 * @returns The URL to access the audio via the static endpoint
 */
export const getAudioUrl = (baseUrl: string, audioPath: string): string => {
	// Ensure the base URL doesn't end with a slash
	const normalizedBaseUrl = baseUrl.endsWith("/")
		? baseUrl.slice(0, -1)
		: baseUrl;

	// Remove the file:// protocol if present
	let normalizedPath = audioPath;
	if (normalizedPath.startsWith("file://")) {
		normalizedPath = normalizedPath.substring(7);
	}

	// Encode the audio path to handle special characters
	const encodedPath = encodeURIComponent(normalizedPath);

	// Return the full URL to the static audio endpoint
	return `${normalizedBaseUrl}/v1/static/audio?path=${encodedPath}`;
};

/**
 * Ask the core to mint a signed static URL for one route and path.
 *
 * Phase A adoption (file-serving RFC § 4): the static routes serve on loopback
 * regardless of credentials today, and a later core phase gates them on a
 * per-boot access token that a `<video src>` or `<iframe src>` cannot carry
 * (a GET has no header). The core's answer is this route - `POST
 * /v1/static/sign` - and the request travels over the DESKTOP TRANSPORT, so
 * MAIN performs it with the desktop bearer and the renderer never handles the
 * token or reads a serve record.
 *
 * Answers `null` for EVERY failure - a core that predates the route (404), a
 * refused plane (401/403), a dead transport, a malformed body - because the
 * caller's contract is "use the plain URL", never "show an error": a preview
 * must not break on any core, old or new. That is also why the failure is not
 * rethrown: there is no user-facing sentence a preview could add to it.
 */
export const fetchSignedStaticUrl = async (
	baseUrl: string,
	route: StaticRoute,
	path: string,
	ttlS?: number,
): Promise<SignedStaticUrl | null> => {
	// The same normalization the URL builders above apply, and it must match
	// them: the signed string covers THIS path text, and the plain fallback URL
	// carries the same normalization, so both describe one file on disk.
	let normalizedPath = path;
	if (normalizedPath.startsWith("file://")) {
		normalizedPath = normalizedPath.substring(7);
	}
	try {
		const response = await desktopRequest({
			op: "static.sign",
			route,
			path: normalizedPath,
			...(ttlS === undefined ? {} : { ttlS }),
		});
		if (response.status < 200 || response.status >= 300) return null;
		const body = response.body as { url?: unknown; exp?: unknown } | null;
		if (typeof body?.url !== "string" || typeof body.exp !== "number") {
			return null;
		}
		// Ensure the base URL doesn't end with a slash, exactly as the builders
		// above do - the core's URL always starts with one, and a `file:`
		// renderer cannot resolve an origin-relative `src`.
		const normalizedBaseUrl = baseUrl.endsWith("/")
			? baseUrl.slice(0, -1)
			: baseUrl;
		return { url: `${normalizedBaseUrl}${body.url}`, exp: body.exp };
	} catch {
		return null;
	}
};

/**
 * Get the URL for an HTML file from the static HTML endpoint
 *
 * @param baseUrl - The base URL of the Local Operator API
 * @param htmlPath - The path to the HTML file on disk
 * @returns The URL to access the HTML file via the static endpoint
 */
export const getHtmlUrl = (baseUrl: string, htmlPath: string): string => {
	// Ensure the base URL doesn't end with a slash
	const normalizedBaseUrl = baseUrl.endsWith("/")
		? baseUrl.slice(0, -1)
		: baseUrl;

	// Remove the file:// protocol if present
	let normalizedPath = htmlPath;
	if (normalizedPath.startsWith("file://")) {
		normalizedPath = normalizedPath.substring(7);
	}

	// Encode the HTML path to handle special characters
	const encodedPath = encodeURIComponent(normalizedPath);

	// Return the full URL to the static HTML endpoint
	return `${normalizedBaseUrl}/v1/static/html?path=${encodedPath}`;
};

/**
 * Static API methods
 */
export const StaticApi = {
	getImageUrl,
	getVideoUrl,
	getAudioUrl,
	getHtmlUrl,
	fetchSignedStaticUrl,
};
