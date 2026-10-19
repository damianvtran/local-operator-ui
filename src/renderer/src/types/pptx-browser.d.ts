/**
 * `pptx-browser` ships no declarations (4.1.5), so the surface this viewer uses
 * is declared here. The three methods and `slideCount` are the package README's
 * documented API; declaring only them keeps an accidental use of an undocumented
 * internal from compiling.
 */
declare module "pptx-browser" {
	export class PptxRenderer {
		load(
			source: File | Blob | ArrayBuffer | Uint8Array,
			onProgress?: (progress: number, message: string) => void,
		): Promise<void>;
		renderSlide(
			index: number,
			canvas: HTMLCanvasElement,
			width?: number,
		): Promise<void>;
		renderAllSlides(width?: number): Promise<HTMLCanvasElement[]>;
		/** Text shapes on one slide, in draw order. Used for the visible transcript. */
		extractSlide(index: number): Promise<{
			title: string;
			textShapes: Array<{ type: string; text: string }>;
			text?: string;
		}>;
		extractAll(): Promise<
			Array<{
				title: string;
				textShapes: Array<{ type: string; text: string }>;
			}>
		>;
		readonly slideCount: number;
		destroy(): void;
	}
}
