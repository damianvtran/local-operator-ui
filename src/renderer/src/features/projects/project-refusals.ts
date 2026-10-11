/**
 * The projects refusals, as sentences: pure mappings from a failed desktop
 * write to what the reader is told.
 *
 * WHY THEY LIVE OUTSIDE THE COMPONENT FILE (agent review F3 / UX round 1, U1):
 * the board's move orchestration (`project-move.ts`) is deliberately a pure
 * module so its per-call outcomes are testable, and it needs these mappings -
 * importing them from a `.tsx` full of controls would drag React and every
 * dialog into the pure bundle. Nothing here renders; the components own that.
 */

import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
import { projectRefusalCopy } from "./project-edit-model";
import {
	type DoneGateRefusal,
	PROJECT_NOT_MOVED_COPY,
	doneGateRefusal,
} from "./project-model";

/**
 * A refused write, as the sentence beside the field.
 *
 * `DesktopControlError` carries the machine code (`project_name_exists`, a 422
 * sentence, the done-gate tail); anything else is an ordinary error whose
 * message is the most honest thing available. The mapping itself is pure and
 * pinned by `scripts/projects-inline-edit.test.mjs`; this is only the narrowing.
 */
export function projectWriteErrorCopy(error: unknown): string {
	if (error instanceof DesktopControlError) {
		return projectRefusalCopy({ code: error.code, message: error.message });
	}
	return projectRefusalCopy({
		message: error instanceof Error ? error.message : "",
	});
}
/**
 * Is this failure "the row is gone"? The daemon declares it as
 * `project_not_found`; a bare 404 on a project route means the same thing, and
 * both read as one state wherever they are rendered (QA round 1, Q4 asked for
 * the unclassified 404 to be pinned too).
 */
export function projectGoneError(error: unknown): boolean {
	return (
		error instanceof DesktopControlError &&
		(error.code === "project_not_found" || error.status === 404)
	);
}
/**
 * A refused status MOVE, as a sentence for the board's toast and the confirm
 * dialog's error line: the same re-spoken refusal copy the inline editors use,
 * but an empty message falls back to a move-shaped sentence ("not moved")
 * rather than the editors' "not saved", because the board has no field.
 */
export function projectMoveErrorCopy(error: unknown): string {
	if (!(error instanceof Error) || !error.message)
		return PROJECT_NOT_MOVED_COPY;
	/*
	 * A project deleted (or renamed away) under an open card/dialog: the route's
	 * own sentence is `no project with id or name '<32-hex id>'`, which names an
	 * identifier the reader never saw. The detail page already says this state in
	 * the app's words (`project-detail.tsx`); the move paths say the same, and
	 * the confirm dialog swaps its primary for Close on it (design round 1, D9).
	 */
	if (projectGoneError(error))
		return "This project could not be found. It may have been deleted.";
	return projectWriteErrorCopy(error);
}
/**
 * The done-gate refusal an error carries, or null. Adapter between the
 * transport error class and the pure classifier in `project-model.ts`.
 */
export function doneGateRefusalOf(error: unknown): DoneGateRefusal | null {
	if (!(error instanceof Error)) return null;
	const typed = error instanceof DesktopControlError ? error : null;
	return doneGateRefusal({
		code: typed?.code ?? null,
		message: error.message,
		detail: typed?.detail,
	});
}
