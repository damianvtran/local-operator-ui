import { createLocalOperatorClient } from "@shared/api/local-operator";
import { Button, Tooltip } from "@shared/components/ui";
import { apiConfig } from "@shared/config";
import { cn } from "@shared/lib/utils";
import { File, X } from "lucide-react";
import type { FC } from "react";
import { useCallback, useMemo } from "react";

/**
 * Props for the AttachmentsPreview component
 */
type AttachmentsPreviewProps = {
	/** List of attachment paths or URLs */
	attachments: string[];
	/** Callback when an attachment is removed */
	onRemoveAttachment: (index: number) => void;
	/** Whether the component is disabled */
	disabled?: boolean;
};

// Regex for splitting file paths (moved to top-level for performance)
const PATH_SEPARATOR_REGEX = /[/\\]/;
// Regex for extracting the resource name from a data URI
const RESOURCE_NAME_REGEX = /name=([^;,]+)/;
// Regex for extracting the MIME type from a data URI
const MIME_TYPE_REGEX = /^data:([^;,]+)/;

/**
 * The 100px thumbnail tile. One sunken ground and a radius, no border: the
 * ground step already separates it from the composer, so a hairline would only
 * add a line that carries nothing.
 */
const TILE = cn(
	"relative flex size-25 flex-col items-center justify-center",
	"overflow-hidden rounded-md bg-sunken",
);

/**
 * The dwell preview that appears above the tile after a deliberate hover. A
 * true floating overlay, so this is one of the few places `shadow-overlay`
 * belongs. It fades in place — no translate, because hover never moves
 * anything.
 */
const LARGE_PREVIEW = cn(
	"invisible absolute -top-80 left-0 z-50 size-75 p-2",
	"rounded-lg bg-elevated shadow-overlay",
	"opacity-0 transition-[opacity,visibility] duration-base ease-out-quart",
	"group-hover:visible group-hover:opacity-100 group-hover:delay-[1500ms]",
);

/**
 * Component to display a preview of attachments
 */
export const AttachmentsPreview: FC<AttachmentsPreviewProps> = ({
	attachments,
	onRemoveAttachment,
	disabled = false,
}) => {
	// Create a Local Operator client using the API config
	const client = useMemo(() => {
		return createLocalOperatorClient(apiConfig.baseUrl);
	}, []);

	/**
	 * Check if a file is an image based on its path/URL
	 */
	const isImage = useCallback((path: string) => {
		if (path.startsWith("data:image/")) {
			return true;
		}
		const imageExtensions = [
			".jpg",
			".jpeg",
			".png",
			".gif",
			".webp",
			".bmp",
			".svg",
		];
		const lowerPath = path.toLowerCase();
		return imageExtensions.some((ext) => lowerPath.endsWith(ext));
	}, []);

	/**
	 * Check if a file is a video based on its path/URL
	 */
	const isVideo = useCallback((path: string) => {
		if (path.startsWith("data:video/")) {
			return true;
		}
		const videoExtensions = [
			".mp4",
			".webm",
			".ogg",
			".mov",
			".avi",
			".wmv",
			".flv",
			".mkv",
			".m4v",
			".3gp",
			".3g2",
		];
		const lowerPath = path.toLowerCase();
		return videoExtensions.some((ext) => lowerPath.endsWith(ext));
	}, []);

	/**
	 * Extract filename from path
	 */
	const getFileName = useCallback((path: string) => {
		if (path.startsWith("data:image/")) {
			return ""; // No name for pasted images
		}
		if (path.startsWith("data:")) {
			// For other pasted files (non-image)
			const nameMatch = path.match(RESOURCE_NAME_REGEX);
			if (nameMatch?.[1]) {
				try {
					return decodeURIComponent(nameMatch[1]);
				} catch {
					// Fallback if decoding fails, continue to MIME type extraction
				}
			}
			const mimeTypeMatch = path.match(MIME_TYPE_REGEX);
			if (mimeTypeMatch?.[1]) {
				return `Pasted ${mimeTypeMatch[1]}`;
			}
			return "Pasted file"; // Generic fallback for non-image data URIs
		}
		// Handle both local paths and URLs for actual files
		const parts = path.split(PATH_SEPARATOR_REGEX);
		return parts[parts.length - 1];
	}, []);

	/**
	 * Get the appropriate URL for an attachment
	 * Uses the static image endpoint for local image files
	 * and the static video endpoint for local video files
	 */
	const getAttachmentUrl = useCallback(
		(path: string) => {
			// If it's a data URI, return it as is
			if (path.startsWith("data:")) {
				return path;
			}
			// If it's a web URL, return it as is
			if (path.startsWith("http")) {
				return path;
			}

			// For local files, normalize the path and use appropriate endpoint
			const normalizedPath = path.startsWith("file://")
				? path
				: `file://${path}`;

			if (isImage(path)) {
				return client.static.getImageUrl(normalizedPath);
			}

			if (isVideo(path)) {
				return client.static.getVideoUrl(normalizedPath);
			}

			// For other file types, return the original path (though this case might not be hit if not image/video)
			return path;
		},
		[client, isImage, isVideo], // isImage and isVideo are stable due to useCallback
	);

	/**
	 * Handle removing an attachment
	 */
	const handleRemove = useCallback(
		(index: number) => (event: React.MouseEvent) => {
			event.stopPropagation();
			if (!disabled) {
				onRemoveAttachment(index);
			}
		},
		[onRemoveAttachment, disabled],
	);

	// If no attachments, don't render anything
	if (!attachments.length) {
		return null;
	}

	return (
		<div className={cn("flex flex-wrap gap-3 py-2")}>
			{attachments.map((attachment, index) => {
				const fileName = getFileName(attachment);
				const url = getAttachmentUrl(attachment);
				const image = isImage(attachment);
				const video = isVideo(attachment);

				return (
					<div className={cn("group relative")} key={`${index}-${attachment}`}>
						<div className={TILE}>
							{image ? (
								<img
									src={url}
									alt={fileName}
									className={cn("size-full object-cover")}
								/>
							) : video ? (
								<video
									src={url}
									preload="metadata"
									muted
									className={cn("size-full object-cover")}
								/>
							) : (
								// A non-media file has nothing to show but its name, so the
								// name is the tile body and the caption strip is skipped
								// rather than printing it twice.
								<div
									className={cn(
										"flex size-full flex-col items-center justify-center gap-1.5",
										"bg-accent-wash p-2 text-center text-accent",
									)}
								>
									<File size={18} aria-hidden="true" />
									<span
										className={cn(
											"line-clamp-2 break-all font-medium text-meta",
										)}
									>
										{fileName}
									</span>
								</div>
							)}
							{/* Pasted images have no name, so the strip would be an empty bar. */}
							{(image || video) && fileName && (
								<span
									className={cn(
										"absolute inset-x-0 bottom-0 truncate",
										"bg-surface/85 px-1.5 py-0.5",
										"text-center text-ink text-meta",
									)}
								>
									{fileName}
								</span>
							)}
							<Tooltip content="Remove attachment" disabled={disabled}>
								<Button
									variant="ghost"
									size="icon-sm"
									className={cn(
										"absolute top-1 right-1 bg-surface/85 text-danger",
										"hover:bg-danger-wash hover:text-danger",
										"disabled:bg-sunken disabled:text-ink-disabled",
									)}
									onClick={handleRemove(index)}
									disabled={disabled}
									aria-label="Remove attachment"
								>
									<X aria-hidden="true" />
								</Button>
							</Tooltip>
						</div>
						{(image || video) && (
							<div className={LARGE_PREVIEW}>
								{image ? (
									<img
										src={url}
										alt={fileName}
										className={cn("size-full object-contain")}
									/>
								) : (
									<video
										src={url}
										controls
										preload="metadata"
										muted
										className={cn("size-full object-contain")}
									/>
								)}
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
};
