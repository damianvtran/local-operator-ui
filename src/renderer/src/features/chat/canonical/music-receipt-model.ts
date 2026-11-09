import type { TranscriptImage } from "./transcript-reducer";

export type MusicTrackReceipt = {
	id: string;
	title: string;
	variantIndex: number;
	error: boolean;
	cost: Record<string, unknown> | null;
	images: TranscriptImage[];
};
export type MusicReceipt = { attribution: string; tracks: MusicTrackReceipt[] };
const object = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

/** Structured music receipts are evidence; English captions and arbitrary
 * checksum-looking text are not. Logical track/role identity remains separate
 * from the digest used by the shared byte/waveform cache. */
export function musicReceiptOf(details: unknown): MusicReceipt | undefined {
	if (
		!object(details) ||
		details.material !== "music" ||
		!Array.isArray(details.tracks)
	)
		return undefined;
	const artifacts = Array.isArray(details.artifacts)
		? details.artifacts.filter(object)
		: [];
	return {
		attribution:
			typeof details.attribution === "string" ? details.attribution : "",
		tracks: details.tracks
			.filter(object)
			.filter((track) => typeof track.id === "string" && track.id.length > 0)
			.map((track) => ({
				id: track.id as string,
				title: typeof track.title === "string" ? track.title : "",
				variantIndex:
					typeof track.variant_index === "number" ? track.variant_index : 0,
				error:
					typeof track.error_type === "string" ||
					typeof track.registration_error === "string",
				cost: object(track.cost) ? track.cost : null,
				images: artifacts
					.filter(
						(artifact) =>
							artifact.track_id === track.id &&
							typeof artifact.digest === "string" &&
							/^[a-f0-9]{32}$/.test(artifact.digest),
					)
					.map((artifact) => ({
						id: `music:${track.id}:${artifact.artifact_id}:${artifact.role}`,
						attachment: artifact.digest as string,
						data: null,
						mimeType:
							typeof artifact.content_type === "string"
								? artifact.content_type
								: "audio/mpeg",
						kind: "audio" as const,
						...(typeof artifact.name === "string"
							? { name: artifact.name }
							: {}),
						...(typeof artifact.size_bytes === "number"
							? { sizeBytes: artifact.size_bytes }
							: {}),
						...(typeof artifact.duration_s === "number"
							? { durationS: artifact.duration_s }
							: {}),
					})),
			})),
	};
}
