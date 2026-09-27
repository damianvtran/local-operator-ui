/**
 * The delete confirmation, with the typed NAME the route requires.
 *
 * WHY A TYPED NAME RATHER THAN A YES/NO: the backend's own contract asks for
 * it — `DELETE /v1/desktop/projects/{key}` takes `{confirm: "<name>"}` and
 * answers 422 when the body does not repeat the name — so the client cannot
 * offer a weaker dialog than the route accepts. The typed-match rule is the
 * route's own comparison (case-insensitive, whitespace-trimmed) mirrored so
 * the button's disabled state and the wire's refusal agree about what
 * "confirmed" means; the value SENT is what the user typed, not the stored
 * name, because the body is the whole confirmation.
 *
 * A REFUSAL STAYS IN THE DIALOG (the `delete-conversation-dialog.tsx` rule): a
 * 409 from the schema guard or a 404 for a project renamed in another window
 * renders here, in the danger ink, while the dialog stays open — closing it
 * over a toast would read as "the delete happened".
 */

import {
	BaseDialog,
	DangerButton,
	SecondaryButton,
} from "@shared/components/common/base-dialog";
import { Spinner } from "@shared/components/common/spinner";
import { Input } from "@shared/components/ui";
import type { FC } from "react";
import { useEffect, useId, useState } from "react";

type ProjectDeleteDialogProps = {
	open: boolean;
	/** The project's stored name: what the typed text is compared to. */
	projectName: string;
	onClose: () => void;
	onConfirm: (typedName: string) => Promise<void>;
};

export const ProjectDeleteDialog: FC<ProjectDeleteDialogProps> = ({
	open,
	projectName,
	onClose,
	onConfirm,
}) => {
	const [typed, setTyped] = useState("");
	const [refusal, setRefusal] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const fieldId = useId();

	// A fresh question on every open: the previous project's typed name must
	// not stand one keystroke away from confirming THIS one.
	useEffect(() => {
		if (!open) return;
		setTyped("");
		setRefusal(null);
		setSubmitting(false);
	}, [open]);

	const matches =
		typed.trim().toLowerCase() === projectName.trim().toLowerCase() &&
		projectName.trim().length > 0;

	const handleConfirm = async () => {
		setSubmitting(true);
		setRefusal(null);
		try {
			await onConfirm(typed.trim());
			onClose();
		} catch (error) {
			setRefusal(
				error instanceof Error && error.message
					? error.message
					: "The project was not deleted.",
			);
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<BaseDialog
			open={open}
			onClose={onClose}
			title="Delete this project?"
			dataTourTag="project-delete-dialog"
			actions={
				<>
					<SecondaryButton onClick={onClose} disabled={submitting}>
						Cancel
					</SecondaryButton>
					<DangerButton
						onClick={() => void handleConfirm()}
						disabled={!matches || submitting}
					>
						{submitting && <Spinner size="xs" />}
						Delete project
					</DangerButton>
				</>
			}
		>
			<div className="flex flex-col gap-3">
				<p className="text-body-sm text-ink">
					This deletes the project and its milestones. The sessions linked to it
					are not touched.
				</p>
				<p className="text-body-sm text-ink-muted">
					Type{" "}
					<span className="font-mono text-mono-sm text-ink">{projectName}</span>{" "}
					to confirm.
				</p>
				<Input
					id={`${fieldId}-confirm`}
					value={typed}
					onChange={(event) => setTyped(event.target.value)}
					placeholder={projectName}
					aria-label="Type the project name to confirm"
					aria-invalid={typed.length > 0 && !matches}
					autoFocus
				/>
				{refusal && <p className="text-body-sm text-danger">{refusal}</p>}
			</div>
		</BaseDialog>
	);
};
