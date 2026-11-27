import { t } from "@shared/i18n";
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
import {
	projectRefusalCodeCopy,
	projectRefusalCopy,
} from "./project-edit-model";
import {
	type DoneGateRefusal,
	doneGateRefusal,
	projectNotMovedCopy,
	refusalCopy,
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
 * A refused CREATE, as the sentence under the New-project sheet, or `""` when
 * nothing is known (the dialog then says its own "not saved" sentence).
 *
 * WHY THE CODE, NOT THE SERVER'S TEXT (i18n census N5, 2026-11-25): the
 * backend speaks English - a taken key comes back as `project 'x' already
 * exists` whatever language the app is in - and localization is the UI's job.
 * The route declares the category on the wire (`detail.code` =
 * `project_name_exists`, carried here as `DesktopControlError.code`), so the
 * dialog maps that code to the app's own, translated sentence, the same one
 * the detail page's Key editor shows. Never match the English sentence to pick
 * a translation: the i18n contract forbids parsing prose the backend owns.
 *
 * The same holds for `project_invalid`, `project_store_busy` and
 * `project_schema_newer` (i18n slice a): every code
 * `projectRefusalCodeCopy` knows is mapped by CODE to the app's sentence.
 * Every other refusal keeps the dialog's previous behaviour exactly: the
 * message through `refusalCopy` (which re-speaks only the done-gate tail),
 * otherwise as written.
 */
export function projectCreateErrorCopy(error: unknown): string {
	const message = error instanceof Error && error.message ? error.message : "";
	if (error instanceof DesktopControlError) {
		const coded = projectRefusalCodeCopy(error.code);
		if (coded !== null) return coded;
	}
	return refusalCopy(message);
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
	if (!(error instanceof Error) || !error.message) return projectNotMovedCopy();
	/*
	 * A project deleted (or renamed away) under an open card/dialog: the route's
	 * own sentence is `no project with id or name '<32-hex id>'`, which names an
	 * identifier the reader never saw. The detail page already says this state in
	 * the app's words (`project-detail.tsx`); the move paths say the same, and
	 * the confirm dialog swaps its primary for Close on it (design round 1, D9).
	 */
	if (projectGoneError(error))
		return t(
			"ui.projects.project_refusals.this_project_could_not_be_found_it_may_have_been_deleted",
		);
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
