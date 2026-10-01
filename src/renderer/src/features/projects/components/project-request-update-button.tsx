/**
 * The detail header's "Request update" button: one secondary control with
 * three label states, leading the Edit/Delete cluster.
 *
 * WHY IT LEADS AND WHY IT IS SECONDARY (design note §2): the action is
 * occasional and outward-facing (a message to other sessions), not a primary
 * page action, so it keeps parity with Edit/Delete rather than becoming the
 * loudest thing on the screen; and it sits leftmost because the destructive
 * Delete stays rightmost. Edit and Delete keep their own `data-tour-tag`s and
 * do not move - only the new control's left edge does, which is what the
 * `min-w-37` floor removes by giving all three label states ONE width (148 px
 * at the v4 spacing scale; verified against the repo's own `--spacing`).
 *
 * THE TOOLTIP IS NOT DECORATION. The list view is the DEFAULT view and its
 * rows have no `...` menu, so for most users this button is the ONLY door to
 * the action - the tooltip is where the action explains itself.
 *
 * THE STATES, and the accessibility rule behind them:
 * - idle: `MessageSquareMore` + `Request update`;
 * - sending: the spinner replaces the icon, label `Requesting…`, and
 *   `aria-busy` is set. The button is never `disabled` - disabling the control
 *   that was just pressed drops keyboard focus to the body; presses are
 *   ignored by the shared in-flight guard instead;
 * - cooling: a check + `Requested`, `aria-disabled` (still focusable), and
 *   `aria-describedby` points at a visually-hidden span carrying the cooldown
 *   sentence, so assistive technology hears WHY the press will explain itself
 *   rather than act. The press still runs: the flow answers it with the
 *   cooldown toast (the mouse user's explanation, from the same sentence).
 *
 * The gate is the capability key `projects_request_update`: absent means the
 * backend cannot answer the op, and the honest rendering of a control that
 * would 404 is no control at all (the fail-closed rule the whole desktop plane
 * follows). The button is NOT mounted-disabled.
 */

import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { Spinner } from "@shared/components/common/spinner";
import { Button, Tooltip } from "@shared/components/ui";
import { Check, MessageSquareMore } from "lucide-react";
import type { FC } from "react";
import {
	useRequestProjectUpdate,
	useRequestUpdateState,
} from "../hooks/use-request-update";
import { projectDisplayName } from "../project-model";
import {
	REQUEST_UPDATE_TOOLTIP,
	requestUpdateCooldownSentence,
	requestUpdateCooldownSpanId,
} from "../request-update";

export type ProjectRequestUpdateButtonProps = {
	project: { id: string; name: string; title: string | null };
};

export const ProjectRequestUpdateButton: FC<
	ProjectRequestUpdateButtonProps
> = ({ project }) => {
	const capabilities = useDesktopCapabilities();
	const request = useRequestProjectUpdate();
	const { sending, cooling, cooldownRemainingMs } = useRequestUpdateState(
		project.id,
	);

	if (!desktopFeatureEnabled(capabilities.data, "projects_request_update")) {
		return null;
	}

	const display = projectDisplayName(project);
	const spanId = requestUpdateCooldownSpanId(project.id);

	return (
		<>
			<Tooltip content={REQUEST_UPDATE_TOOLTIP}>
				<Button
					variant="secondary"
					className="min-w-37"
					data-tour-tag="project-request-update"
					aria-busy={sending ? true : undefined}
					aria-disabled={cooling ? true : undefined}
					aria-describedby={cooling ? spanId : undefined}
					onClick={() => request(project)}
				>
					{sending ? (
						<Spinner size="sm" />
					) : cooling ? (
						<Check />
					) : (
						<MessageSquareMore />
					)}
					{sending ? "Requesting…" : cooling ? "Requested" : "Request update"}
				</Button>
			</Tooltip>
			{cooling && cooldownRemainingMs !== null && (
				/*
				 * The sentence the button points at. Computed at render from the
				 * shared window's own remainder; the numbers move only as far as
				 * the last render did, which is the design's own call ("computed
				 * at click time") - the toast a press raises recomputes them at
				 * the press, and no countdown ticks on the button.
				 */
				<span id={spanId} className="sr-only">
					{requestUpdateCooldownSentence(display, cooldownRemainingMs)}
				</span>
			)}
		</>
	);
};
