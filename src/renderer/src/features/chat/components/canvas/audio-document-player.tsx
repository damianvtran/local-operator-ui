import { Spinner } from "@shared/components/common/spinner";
import { useFileBlobUrl } from "@shared/hooks/use-file-blob-url";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { remoteFilePath } from "@shared/lib/remote-file-path";
import { cn } from "@shared/lib/utils";
import { Play } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { t } from "../../../../../../i18n";
import {
	remoteUnreachableText,
	remoteUnreadableText,
} from "../../canonical/remote-files";
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
	/*
	 * A PEER-held row never reaches `FinderPathSound` (review round 1, R1-1):
	 * its `path` is the OWNER's display path, and reading it here played
	 * whatever this disk had at that path. An unreadable one states the reason;
	 * a digest-backed one resolves by digest (fetch-on-miss); any other plays
	 * from the content route, on a press, never on view.
	 */
	if (doc.remote?.unreadable)
		return (
			<span className={cn("px-1 py-2 text-meta text-ink-muted")}>
				{remoteUnreadableText(doc.remote)}
			</span>
		);
	if (doc.artifact)
		return (
			<FinderArtifactSound
				artifact={doc.artifact}
				label={label}
				device={doc.remote?.deviceName ?? null}
			/>
		);
	if (doc.remote) return <FinderRemoteSound doc={doc} label={label} />;
	return <FinderPathSound doc={doc} label={label} />;
});

const FinderArtifactSound = memo(function FinderArtifactSound({
	artifact,
	label,
	device = null,
}: {
	artifact: CanvasArtifact;
	label: string;
	/** The owning device of a peer-held digest, named while it is slow. */
	device?: string | null;
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
	if (source.state === "retryable") {
		return (
			<button
				type="button"
				onClick={source.retry}
				className={cn(
					"px-1 py-2 text-start text-meta text-ink-muted hover:text-ink",
				)}
			>
				{remoteUnreachableText(device ?? "")}
			</button>
		);
	}
	if (source.state === "resolving") {
		// A reserved line at the player's own height, so the row does not jump when
		// the bytes land (the same reason the transcript's boxes reserve). A slow
		// owner is named in it (U1-1), on the same line.
		return source.pending && device ? (
			<RemoteSoundWait device={device} />
		) : (
			<div className={cn("h-11")} aria-hidden={true} />
		);
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

/** "Fetching from <device>…" on the player's own line (U1-1). */
const RemoteSoundWait = ({ device }: { device: string }) => (
	<output
		className={cn("flex h-11 items-center gap-2 px-1 text-meta text-ink-muted")}
	>
		<Spinner size="xs" className="text-ink-dim" />
		{t("ui.canvas.files.remoteFetching", { device })}
	</output>
);

/**
 * A PEER-held path sound (no digest). Idle until pressed: the Files panel
 * shows a page of rows, and pulling every sound over the mesh because it was
 * listed is the per-view fetch the Library rule forbids too (QA Q1-2). The
 * press mounts the loaded player, whose bytes come over the content route
 * under the row's `remote-file:` identifier, never from this disk.
 */
const FinderRemoteSound = memo(function FinderRemoteSound({
	doc,
	label,
}: {
	doc: CanvasDocument;
	label: string;
}) {
	useI18nLocale();
	const [armed, setArmed] = useState(false);
	const remote = doc.remote;
	if (!remote) return null;
	if (!armed)
		return (
			<button
				type="button"
				data-remote-sound-play=""
				onClick={() => setArmed(true)}
				className={cn(
					"flex h-11 items-center gap-2 px-1 text-start text-meta text-ink-muted hover:text-ink",
				)}
			>
				<Play className="size-4 shrink-0" aria-hidden={true} />
				{t("ui.canvas.files.remotePlay", { device: remote.deviceName })}
			</button>
		);
	return (
		<FinderRemoteSoundLoaded
			path={remoteFilePath(remote.sessionId, remote.fileId, doc.title)}
			device={remote.deviceName}
			label={label}
		/>
	);
});

const FinderRemoteSoundLoaded = ({
	path,
	device,
	label,
}: {
	path: string;
	device: string;
	label: string;
}) => {
	const state = useFileBlobUrl(path, {
		mimeType: mimeTypeForPath(path),
		remoteDevice: device,
	});
	if (state.status === "unavailable")
		return (
			<span className={cn("px-1 py-2 text-meta text-ink-muted")}>
				{state.message}
			</span>
		);
	if (state.status === "loading") return <RemoteSoundWait device={device} />;
	return (
		<SoundPlayer
			variant="compact"
			ownerId={`sound:${path}`}
			src={state.url}
			label={label}
			peaks={null}
		/>
	);
};
