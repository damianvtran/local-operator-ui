/**
 * The Radient sign-in, started only when a user presses the row.
 *
 * WHY IT IS A COMPONENT RATHER THAN A HOOK ON THE PICKER. `useRadientSessionIssue`
 * owns a polled `accounts.list` read; mounting it on every conversation's device
 * control would put that poll behind a control that is on screen for every chat, for
 * a state (signed out of Radient) most windows are never in. So the hook mounts only
 * for the press that needs it, which is the same discipline the phone-access block
 * records for the identical hook.
 *
 * WHAT IT RENDERS: nothing. The surface that pressed it owns the visible state (the
 * row's spinner, the sheet's sentence), and a second spinner inside a dialog the
 * press did not open would be two widgets for one wait. `onSettled` is what lets the
 * presser re-read and clear its own state.
 */

import { useRadientSessionIssue } from "@shared/hooks/use-radient-session-issue";
import { type FC, useEffect, useRef } from "react";

export const RemoteSignIn: FC<{ onSettled: () => void }> = ({ onSettled }) => {
	const { issue, start } = useRadientSessionIssue();
	const started = useRef(false);
	const signingIn =
		issue.kind === "signing-in" || issue.kind === "input-required";
	useEffect(() => {
		if (started.current) return;
		started.current = true;
		start();
	}, [start]);
	useEffect(() => {
		// The settle edge, not the state: a mount that begins outside the flow must
		// not report an outcome nobody asked about.
		if (started.current && !signingIn) onSettled();
	}, [signingIn, onSettled]);
	return null;
};
