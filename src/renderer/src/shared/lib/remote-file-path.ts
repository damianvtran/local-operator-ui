/**
 * The canvas identity of a PEER-held file opened here (`features.remote_files`).
 *
 * `remote-file:<sessionId>/<fileId>/<name>` is an IDENTIFIER, never a path on
 * this disk - the `artifact:<digest>` idea for a row that has no digest. It
 * replaces the `blob:` URL the first cut stored as the document's path (agent
 * review round 1, R1-2/R1-3), which leaked one object URL per open and, being
 * persisted with the canvas store, reloaded as a dead URL. The identifier
 * carries what the content route needs, so the viewer's byte hook
 * (`use-file-blob-url`) fetches the bytes on mount under ONE refcounted cache
 * entry and releases them when the tab closes, and a reloaded tab simply
 * fetches again. The trailing name keeps the extension, so `viewerFor` routes
 * the identifier exactly as it routed the owner's path.
 *
 * Every consumer that would act on a path (open in the OS, reveal, write)
 * refuses this prefix, so the owner's files never meet this disk (I3-1).
 */
export const REMOTE_FILE_PREFIX = "remote-file:";

export function remoteFilePath(
	sessionId: string,
	fileId: string,
	name: string,
): string {
	return `${REMOTE_FILE_PREFIX}${encodeURIComponent(sessionId)}/${encodeURIComponent(fileId)}/${name.replace(/\//g, "_")}`;
}

export function isRemoteFilePath(path: string): boolean {
	return path.startsWith(REMOTE_FILE_PREFIX);
}

/** The route coordinates of a remote-file identifier, or `null` for anything else. */
export function parseRemoteFilePath(
	path: string,
): { sessionId: string; fileId: string } | null {
	if (!isRemoteFilePath(path)) return null;
	const [session, file] = path.slice(REMOTE_FILE_PREFIX.length).split("/");
	if (!session || !file) return null;
	try {
		return {
			sessionId: decodeURIComponent(session),
			fileId: decodeURIComponent(file),
		};
	} catch {
		return null;
	}
}
