/**
 * Copy a conversation's session id to the clipboard, once, for the two doors
 * that offer it (#893): the sidebar row's context menu and the conversation
 * header's overflow menu.
 *
 * WHY ITS OWN MODULE, separate from the components that call it: the sidebar is
 * a nine-thousand-line component whose inner helpers no suite can execute, and
 * the value this feature copies is the whole feature - so the copy lives where
 * `scripts/chat-session-copy-id.test.mjs` can hand it ids with no DOM, exactly
 * as `chat-remote.ts` holds the remote row's own facts for that reason. The two
 * call sites are then thin `onSelect` wrappers, and a change to what is copied
 * cannot drift between them.
 *
 * WHAT IS COPIED IS THE ID VERBATIM - no prefix, no device decoration - for a
 * local and a remote row alike, and for a remote row that is the point worth
 * stating. A remote (mesh) row's `row.session_id` is already the id the OWNING
 * DEVICE knows the session by, not an id this device invented for it: the
 * backend keys its peer rows by `(owner_device, session_id)`
 * (`local_operator/session/peer_rows.py`), the desktop read publishes that same
 * value as the wire row's `"id"` (`local_operator/server/utils/desktop_mesh.py`),
 * and `toCatalogueRow` renames `id` to `session_id` without touching it
 * (`features/mesh/mesh-types.ts`). So the copied string pastes straight into a
 * `sessions`/`send` call naming that device, or a `lop` command run there, and a
 * "helpful" `device:` prefix would make it paste nowhere. The test asserts the
 * string byte-for-byte so a future decoration fails there rather than in a
 * user's terminal.
 *
 * ONE LABEL FOR BOTH SURFACES. The row menu and the header menu are two doors on
 * one act, so they say one thing when it succeeds - a second spelling beside the
 * first is exactly how two surfaces come to describe one outcome two ways.
 * Sentence case, no trailing period, matching the existing copy confirmation
 * (`File path copied to clipboard`).
 */
import { showErrorToast, showSuccessToast } from "@shared/utils/toast-manager";

/**
 * The sentence the act reports, in both doors (see the module note: one act, one
 * register). Module-local: nothing outside this file needs the spelling, and the
 * test asserts the literal rather than importing it, so the two cannot agree on a
 * wrong string.
 */
const COPIED_TOAST = "Session ID copied";

/**
 * Copy a session id to the clipboard, the app's existing way. Returns true on
 * success.
 *
 * The write is `navigator.clipboard.writeText` and the failure is caught rather
 * than thrown, mirroring `file-actions-menu.tsx`'s `handleCopyFilePath` and
 * `link-open.ts`'s `copyTarget`: the clipboard can refuse (no permission, no
 * document focus), and a caller drawing a menu item needs an answer rather than
 * an unhandled rejection. Whitespace-only input is a NO-OP rather than an error:
 * nothing in this app offers the act on an id-less row, so this is a guard
 * against copying an empty string - never a state the user reaches - and a
 * failure toast for a press that cannot happen would be noise.
 */
export async function copySessionId(id: string): Promise<boolean> {
	if (id.trim() === "") return false;
	try {
		await navigator.clipboard.writeText(id);
		showSuccessToast(COPIED_TOAST);
		return true;
	} catch (error) {
		console.error("Failed to copy session id: ", error);
		showErrorToast("Failed to copy session ID");
		return false;
	}
}
