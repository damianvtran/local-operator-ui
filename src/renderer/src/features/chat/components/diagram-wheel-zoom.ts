const WHEEL_ZOOM_SENSITIVITY = 0.01;
const WHEEL_ZOOM_MIN_FACTOR = 0.85;
const WHEEL_ZOOM_MAX_FACTOR = 1.15;

type WheelZoomEvent = Pick<
	WheelEvent,
	"ctrlKey" | "metaKey" | "deltaY" | "preventDefault"
>;

export const diagramWheelZoomFactor = (
	event: WheelZoomEvent,
	isFullscreenMode: boolean,
): number | null => {
	if (!isFullscreenMode && !event.ctrlKey && !event.metaKey) return null;
	if (event.deltaY === 0) return null;
	event.preventDefault();
	const factor = Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY);
	return Math.min(
		Math.max(factor, WHEEL_ZOOM_MIN_FACTOR),
		WHEEL_ZOOM_MAX_FACTOR,
	);
};
