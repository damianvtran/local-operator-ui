/**
 * A hidden/unfocusable window cannot establish a native first responder. The
 * exceptional visible/activation probe therefore belongs exclusively to a
 * disposable GitHub macOS runner, never the operator's desktop. Require both
 * the command flag and explicit environment arming so accidental local use
 * fails before any files, sockets or Electron processes are created.
 */
export function focusProofWindowMode(args, env) {
	if (!args.includes("--ci-native-owner")) return "headless";
	if (
		env.GITHUB_ACTIONS !== "true" ||
		env.RUNNER_OS !== "macOS" ||
		env.CI !== "true" ||
		env.LOCAL_OPERATOR_FOCUS_PROOF_CI !== "1"
	) {
		throw new Error(
			"native focus probing requires explicitly armed disposable macOS CI",
		);
	}
	// Product browser focus handoffs intentionally refuse non-normal launch plans.
	// CI must exercise that real user path, not an activated-inactive approximation.
	return "normal";
}
