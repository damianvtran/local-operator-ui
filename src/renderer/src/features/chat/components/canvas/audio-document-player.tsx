import { useFileBlobUrl } from "@shared/hooks/use-file-blob-url";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { memo, useMemo } from "react";
import { t } from "../../../../../../i18n";
import { SoundPlayer } from "../../canonical/sound-player";
import { useAttachmentSource } from "../../canonical/use-attachment-url";
import { useWaveform } from "../../canonical/use-waveform";
import type { CanvasArtifact, CanvasDocument } from "../../types/canvas";
import { mimeTypeForPath } from "../../utils/file-kind";

/**
 * The compact sound player for one Files row, fed by whichever store the row's
 * bytes live in.
 *
 * TWO STORES, ONE PLAYER. An artifact row's bytes come over the media relay by
 * digest (the same resolver the transcript mounts); a path-backed row's come
 * over the file bridge (`useFileBlobUrl`, the hook the audio PREVIEW uses).
 * Two components rather than one branch because each mounts one resolver hook
 * unconditionally - a merged branch would ask the attachment route about every
 * path-backed row and read a file for every digest.
 *
 * PEAKS FOLLOW THE SAME SPLIT: a digest has a sidecar to ask for
 * (`useWaveform`); a path has none, so it draws the honest flat scrubber.
 */

/** Artifact pseudo-paths are identifiers, never filesystem inputs. Both Canvas
 * seats resolve the same bytes and share the same playback identity, including
 * path-backed audio, so opening a preview cannot create a second audio engine. */
export const AudioDocumentPlayer = memo(function AudioDocumentPlayer({
	doc,
	label,
}: {
	doc: CanvasDocument;
	label: string;
}) {
	return doc.artifact ? (
		<FinderArtifactSound artifact={doc.artifact} label={label} />
	) : (
		<FinderPathSound doc={doc} label={label} />
	);
});

const FinderArtifactSound = memo(function FinderArtifactSound({
	artifact,
	label,
}: {
	artifact: CanvasArtifact;
	label: string;
}) {
	/*
	 * The scope object is rebuilt from its two primitives rather than from
	 * `artifact`: the resolver depends on the ids, and a new object identity per
	 * render would be noise it already documents it ignores.
	 */

	useI18nLocale();
	const sessionId = artifact.sessionId;
	const childId = artifact.childId ?? null;
	const scope = useMemo(() => ({ sessionId, childId }), [sessionId, childId]);
	const source = useAttachmentSource(
		{
			data: null,
			attachment: artifact.digest,
			mimeType: artifact.contentType ?? "audio/mpeg",
		},
		scope,
	);
	const peaks = useWaveform(artifact.digest, scope);
	if (source.state === "missing") {
		return (
			<span className={cn("px-1 py-2 text-meta text-ink-muted")}>
				{t("ui.canvas.files.unreadable")}
			</span>
		);
	}
	if (source.state === "resolving") {
		// A reserved line at the player's own height, so the row does not jump when
		// the bytes land (the same reason the transcript's boxes reserve).
		return <div className={cn("h-11")} aria-hidden={true} />;
	}
	return (
		<SoundPlayer
			variant="compact"
			/* The digest is the identity, exactly as in the transcript. */
			ownerId={`sound:${artifact.digest}`}
			src={source.url}
			label={label}
			peaks={peaks}
			durationHint={artifact.durationS ?? null}
		/>
	);
});

const FinderPathSound = memo(function FinderPathSound({
	doc,
	label,
}: {
	doc: CanvasDocument;
	label: string;
}) {
	useI18nLocale();
	const state = useFileBlobUrl(doc.path, {
		mtimeMs: doc.lastAgentModified,
		mimeType: mimeTypeForPath(doc.path),
		sizeBytes: doc.sizeBytes,
	});
	if (state.status === "unavailable") {
		return (
			<span className={cn("px-1 py-2 text-meta text-ink-muted")}>
				{t("ui.canvas.files.unreadable")}
			</span>
		);
	}
	if (state.status === "loading") {
		return <div className={cn("h-11")} aria-hidden={true} />;
	}
	return (
		<SoundPlayer
			variant="compact"
			/* A path-backed sound has no digest; the path is its identity here. */
			ownerId={`sound:path:${doc.path}`}
			src={state.url}
			label={label}
			peaks={null}
		/>
	);
});
