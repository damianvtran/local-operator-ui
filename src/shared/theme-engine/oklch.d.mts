export type Oklch = { l: number; c: number; h: number };
export declare function hexToOklch(hex: string): Oklch;
export declare function oklchToHex(value: Oklch): {
	hex: string;
	clipped: boolean;
};
export declare function rgbToHex(values: number[]): string | null;
