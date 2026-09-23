/**
 * Match scene window geometry to the native titlebar contract.
 *
 * The macOS titlebar is intentionally hidden, so Electron reports a full-window
 * content area there. Other platforms retain native chrome and its bounded
 * content inset; keeping both contracts exact prevents stale frame assumptions
 * from passing as evidence.
 */
export function contentGeometryMatches({
	platform,
	windowSize,
	contentBounds,
}) {
	const sameWidth = contentBounds.width === windowSize.width;

	if (platform === "darwin") {
		return sameWidth && contentBounds.height === windowSize.height;
	}

	return (
		sameWidth &&
		contentBounds.height < windowSize.height &&
		windowSize.height - contentBounds.height <= 40
	);
}
