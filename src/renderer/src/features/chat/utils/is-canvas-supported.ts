import { canvasSupportedExtensions } from "../config/canvas-supported-extensions";

export const isCanvasSupported = (fileName: string) => {
	const ext = fileName.toLowerCase().split("/").pop()?.split(".").pop() ?? "";

	return canvasSupportedExtensions.has(ext);
};
