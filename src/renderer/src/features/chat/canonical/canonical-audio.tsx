/**
 * One generated sound on a canonical transcript row — the audio seat of the
 * digest-fed media seam.
 *
 * WHY IT EXISTS. A sound artifact rides the same record media every picture and
 * video does (`TranscriptImage` with `kind: "audio"`: the harness's
 * `cache_media(kind="audio", duration_s=…)` block as the tool result), and its
 * bytes resolve through the same store route the other two kinds use. What no
 * existing component can do is PLAY them: an `<img>` handed audio bytes fails
 * decode into a false "unavailable" receipt, and the `<video>` player would
 * paint a blank frame (a video element plays the audio track of a media
 * container, not an MP3). This component mounts the shared `SoundPlayer` over
 * the resolved URL and gives it the sound's stored peaks.
 *
 * ONE RESOLVER, THREE MEDIA KINDS. The bytes come from `useAttachmentSource` —
 * the same hook the image and video paths use — so the blob lifecycle (the
 * module-wide refcounted cache, revoke on last release, `abandonFetch` for a
 * result nobody is left to hold) is shared rather than re-implemented. What
 * differs here is only what renders: a reserved box while the bytes are on
 * their way, the player once they land, and `BrokenAttachment` when they never
 * do — the same three states, in the same order, as `CanonicalVideo`.
 *
 * PEAKS ARE A SECOND FETCH, AND A MISS IS FLAT. The bars come from the
 * precomputed sidecar (see `use-waveform.ts`); an older session or a renderer
 * without the route draws the flat scrubber rather than a fabricated shape. An
 * INLINE sound (a live event's base64, no digest) has no sidecar to ask for, so
 * it is flat by construction.
 *
 * THE PLAYER IDENTITY IS THE DIGEST. `sound:<digest>` is the engine's key, so
 * the transcript's player, the Files band's and a highlight row's all address
 * ONE playback slot for one sound — press play in one seat and the others show
 * it playing, which is the point of the digest-identity rule.
 */

import { cn } from "@shared/lib/utils";
import {
	AUDIO_UNAVAILABLE_COPY,
	AttachmentFrame,
	BrokenAttachment,
} from "../components/message-item/attachment-frame";
import { SoundPlayer } from "./sound-player";
import type { TranscriptImage } from "./transcript-reducer";
import {
	type AttachmentScope,
	useAttachmentSource,
} from "./use-attachment-url";
import { useWaveform } from "./use-waveform";

export type CanonicalAudioProps = {
	/** The sound ref, from the record's media extraction (`kind: "audio"`). */
	audio: TranscriptImage;
	/** The conversation the row was read from, as every canonical attachment. */
	scope: AttachmentScope | null;
	/** What to call this sound ("Generated voiceover"). */
	label: string;
};

/** The engine key one sound owns — the digest is the identity (see the header). */
export function soundOwnerId(
	audio: Pick<TranscriptImage, "attachment" | "id">,
): string {
	return `sound:${audio.attachment ?? audio.id}`;
}

export const CanonicalAudio = ({
	audio,
	scope,
	label,
}: CanonicalAudioProps) => {
	const source = useAttachmentSource(audio, scope);
	// Peaks need the digest; an inline sound has none and stays flat.
	const peaks = useWaveform(audio.attachment, scope);
	if (source.state === "missing") {
		return <BrokenAttachment name={label} detail={AUDIO_UNAVAILABLE_COPY} />;
	}
	if (source.state === "resolving") {
		/*
		 * A RESERVED BOX, not a receipt (the image path's own rule): the frame's
		 * floor holds the slot while the bytes travel, so the row does not grow a
		 * sentence-shaped block that reflows into a player a frame later. The
		 * marker states the state for the rigs, the same hook the other two
		 * kinds' reserved boxes carry.
		 */
		return (
			<div
				className={cn("inline-block max-w-full self-start")}
				aria-hidden={true}
			>
				<AttachmentFrame data-attachment-reserved="" />
			</div>
		);
	}
	return (
		<div className={cn("w-full max-w-[560px] self-start")}>
			<SoundPlayer
				ownerId={soundOwnerId(audio)}
				src={source.url}
				label={label}
				peaks={peaks}
				durationHint={audio.durationS ?? null}
			/>
		</div>
	);
};
