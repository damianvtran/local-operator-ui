export function shouldOfferCompanion(input: {
	decision: "pending" | "first_time" | "returning";
	introduced: boolean;
	setupThisLaunch: boolean;
	onboardingActive: boolean;
	covered: boolean;
	visible: boolean;
	focused: boolean;
	editing: boolean;
}): boolean {
	return (
		input.decision === "returning" &&
		!input.introduced &&
		!input.setupThisLaunch &&
		!input.onboardingActive &&
		!input.covered &&
		input.visible &&
		input.focused &&
		!input.editing
	);
}
