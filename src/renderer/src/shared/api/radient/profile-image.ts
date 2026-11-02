/** Header admission before the browser allocates pixels. The account service
 * repeats full decode, trailing-data and metadata checks; this is a client
 * allocation bound, never a substitute for the upstream security boundary. */
export const PROFILE_IMAGE_MAX_BYTES = 1024 * 1024;
export function profileImageDimensions(
	bytes: Uint8Array,
): { width: number; height: number } | null {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (
		bytes.length >= 24 &&
		view.getUint32(0) === 0x89504e47 &&
		view.getUint32(4) === 0x0d0a1a0a &&
		view.getUint32(12) === 0x49484452
	)
		return { width: view.getUint32(16), height: view.getUint32(20) };
	if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
		let pos = 2;
		while (pos + 3 < bytes.length) {
			if (bytes[pos++] !== 0xff) return null;
			while (bytes[pos] === 0xff) pos++;
			const marker = bytes[pos++];
			if (marker === 0xd9 || marker === 0xda || pos + 2 > bytes.length)
				return null;
			if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
			const length = view.getUint16(pos);
			if (length < 2 || pos + length > bytes.length) return null;
			if (
				[
					0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
					0xce, 0xcf,
				].includes(marker) &&
				length >= 8
			)
				return {
					width: view.getUint16(pos + 5),
					height: view.getUint16(pos + 3),
				};
			pos += length;
		}
	}
	if (
		bytes.length >= 25 &&
		view.getUint32(0) === 0x52494646 &&
		view.getUint32(8) === 0x57454250 &&
		view.getUint32(4, true) + 8 === bytes.length
	) {
		const kind = view.getUint32(12);
		if (kind === 0x56503858 && bytes.length >= 30)
			return {
				width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
				height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
			};
		if (
			kind === 0x56503820 &&
			bytes.length >= 30 &&
			bytes[23] === 0x9d &&
			bytes[24] === 0x01 &&
			bytes[25] === 0x2a
		)
			return {
				width: view.getUint16(26, true) & 0x3fff,
				height: view.getUint16(28, true) & 0x3fff,
			};
		if (kind === 0x5650384c && bytes[20] === 0x2f)
			return {
				width: 1 + (((bytes[22] & 0x3f) << 8) | bytes[21]),
				height:
					1 +
					(((bytes[24] & 0x0f) << 10) |
						(bytes[23] << 2) |
						((bytes[22] & 0xc0) >> 6)),
			};
	}
	return null;
}
export function profileImageFits(
	size: { width: number; height: number } | null,
): boolean {
	return Boolean(
		size &&
			size.width > 0 &&
			size.height > 0 &&
			size.width <= 4096 &&
			size.height <= 4096 &&
			size.width * size.height <= 16_000_000,
	);
}
export async function decodeProfileImage(file: File): Promise<ImageBitmap> {
	if (
		!file.size ||
		file.size > PROFILE_IMAGE_MAX_BYTES ||
		!["image/png", "image/jpeg", "image/webp"].includes(file.type)
	)
		throw new Error("Profile image refused");
	const bytes = new Uint8Array(await file.arrayBuffer());
	if (!profileImageFits(profileImageDimensions(bytes)))
		throw new Error("Profile image dimensions refused");
	const bitmap = await createImageBitmap(file, {
		imageOrientation: "from-image",
	});
	if (!profileImageFits(bitmap)) {
		bitmap.close();
		throw new Error("Profile decoded image dimensions refused");
	}
	return bitmap;
}
