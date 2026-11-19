#!/usr/bin/env node

/**
 * Icon Generator for Local Operator UI
 *
 * This script generates platform-specific icons from a source image.
 * It requires the 'sharp' image processing library and 'icns-lib' for ICNS generation.
 *
 * Usage:
 *   node generate-icons.js <source-image>
 *
 * The source image is required and cannot be the same as the output icon.png.
 *
 * Installation:
 *   npm install --save-dev sharp icns-lib
 */

const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const icnsLib = require("icns-lib");

// Configuration
const sourceImage = process.argv[2];
const outputDir = path.join(__dirname, "../build");

// Validate source image
if (!sourceImage) {
	console.error("Error: Source image is required.");
	console.error("Usage: node generate-icons.js <source-image>");
	process.exit(1);
}

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
	fs.mkdirSync(outputDir, { recursive: true });
}

// Icon sizes and formats for different platforms
const icons = [
	// macOS icons
	{ size: 16, name: "icon-16x16.png" },
	{ size: 32, name: "icon-32x32.png" },
	{ size: 64, name: "icon-64x64.png" },
	{ size: 128, name: "icon-128x128.png" },
	{ size: 256, name: "icon-256x256.png" },
	{ size: 512, name: "icon-512x512.png" },
	{ size: 1024, name: "icon-1024x1024.png" },

	// Windows icons - using toBuffer for ICO format
	{ size: 256, name: "icon.ico", isIco: true },

	// Linux icons
	{ size: 512, name: "icon.png" },
	{ size: 512, name: "icon.icns", isIcns: true }, // ICNS format for Linux compatibility

	// Electron tray icons
	{ size: 16, name: "tray-icon.png" },
	{ size: 16, name: "tray-icon@2x.png", scale: 2 },

	// Electron dock icons
	{ size: 128, name: "dock-icon.png" },
];

// ICNS icon type mappings
const icnsTypes = {
	16: "icp4", // 16x16
	32: "icp5", // 32x32
	64: "icp6", // 64x64
	128: "ic07", // 128x128
	256: "ic08", // 256x256
	512: "ic09", // 512x512
	1024: "ic10", // 1024x1024
};

/*
 * The order these chunks are written in is load-bearing, and it is not the order
 * macOS reads them in.
 *
 * ICNS is keyed by chunk type, so AppKit and `iconutil` find the size they want
 * wherever it sits. 1Password's own ICNS reader (its `index.node` carries the
 * parser, the `CFBundleIconFile` lookup and its `Contents/Resources` join) takes
 * the FIRST chunk in the file and draws it in the 128 px slot of its "1Password
 * Access Requested" dialog. With the ascending order this file used to be
 * written in, that first chunk was the 16x16 `icp4`: the dialog rendered a
 * smooth 8x enlargement of it, which is the blurred mark the operator reported.
 * Measured on 1Password 8.12.40 (2026-10-23) with the same bytes reordered: the
 * 16-first file reproduced the blur, the 1024-first file rendered sharp.
 *
 * So write the largest representation first and descend. Every consumer that
 * reads by type is unaffected, and the one that reads by position gets the art
 * at its best. `scripts/icon-identity.test.mjs` pins the first chunk to `ic10`
 * so a future regeneration cannot quietly restore the old order.
 */
const ICNS_WRITE_ORDER = [1024, 512, 256, 128, 64, 32, 16];

// Generate icons
const generateIcons = async () => {
	console.log(`Generating icons from ${sourceImage}...`);

	try {
		// Check if source image exists
		if (!fs.existsSync(sourceImage)) {
			console.error(`Error: Source image not found: ${sourceImage}`);
			process.exit(1);
		}

		// Load source image
		const image = sharp(sourceImage);

		// For ICNS generation, we'll need to store PNG buffers for each size
		const icnsPngBuffers = {};

		// Generate each icon
		for (const icon of icons) {
			const size = icon.size * (icon.scale || 1);
			const outputPath = path.join(outputDir, icon.name);

			console.log(`Generating ${outputPath} (${size}x${size})...`);

			// Resize the image
			const resized = image.clone().resize(size, size, {
				fit: "contain",
				background: { r: 0, g: 0, b: 0, alpha: 0 },
			});

			// Handle ICO format separately
			if (icon.isIco) {
				const pngBuffer = await resized.toFormat("png").toBuffer();

				// Create a simple ICO format (basic implementation)
				const icoHeader = Buffer.alloc(22);
				// ICO header (6 bytes)
				icoHeader.writeUInt16LE(0, 0); // Reserved, must be 0
				icoHeader.writeUInt16LE(1, 2); // Image type: 1 for ICO
				icoHeader.writeUInt16LE(1, 4); // Number of images

				// Directory entry (16 bytes)
				icoHeader.writeUInt8(size > 255 ? 0 : size, 6); // Width (0 means 256)
				icoHeader.writeUInt8(size > 255 ? 0 : size, 7); // Height (0 means 256)
				icoHeader.writeUInt8(0, 8); // Color palette
				icoHeader.writeUInt8(0, 9); // Reserved
				icoHeader.writeUInt16LE(1, 10); // Color planes
				icoHeader.writeUInt16LE(32, 12); // Bits per pixel
				icoHeader.writeUInt32LE(pngBuffer.length, 14); // Size of image data
				icoHeader.writeUInt32LE(22, 18); // Offset to image data

				// Combine header and PNG data
				const icoBuffer = Buffer.concat([icoHeader, pngBuffer]);
				fs.writeFileSync(outputPath, icoBuffer);
			}
			// Handle ICNS format separately
			else if (icon.isIcns) {
				// For ICNS, we need to generate all the required sizes
				// We'll collect these in the next loop and generate the ICNS file at the end
				console.log("Preparing ICNS file...");
			} else {
				// For other formats, use toFile directly
				await resized.toFile(outputPath);

				// If this is one of the sizes we need for ICNS, store the buffer
				if (icnsTypes[size]) {
					icnsPngBuffers[size] = await resized.toFormat("png").toBuffer();
				}
			}
		}

		// Generate ICNS file
		const icnsPath = path.join(outputDir, "icon.icns");
		console.log(`Generating ${icnsPath}...`);

		// Create a map of icon types and their data
		const icnsMap = {};

		// Add each size to the ICNS map, largest first. See the comment on
		// ICNS_WRITE_ORDER above: the first chunk is the one 1Password draws.
		for (const size of ICNS_WRITE_ORDER) {
			const type = icnsTypes[size];
			if (icnsPngBuffers[size]) {
				icnsMap[type] = icnsPngBuffers[size];
			}
		}

		// Format the map into an ICNS buffer
		const icnsBuffer = icnsLib.format(icnsMap);

		// Write the ICNS file
		fs.writeFileSync(icnsPath, icnsBuffer);

		console.log("Icon generation complete!");
	} catch (error) {
		console.error("Error generating icons:", error);
		process.exit(1);
	}
};

// Run the icon generation
generateIcons();
