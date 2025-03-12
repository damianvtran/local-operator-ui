#!/usr/bin/env node

/**
 * Icon Generator for Local Operator UI
 *
 * This script generates platform-specific icons from a source image.
 * It requires the 'sharp' image processing library.
 *
 * Usage:
 *   node generate-icons.js [source-image]
 *
 * If no source image is provided, it will use resources/icon.png by default.
 *
 * Installation:
 *   npm install --save-dev sharp
 */

const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

// Configuration
const sourceImage =
	process.argv[2] || path.join(__dirname, "../resources/icon.png");
const outputDir = path.join(__dirname, "../resources");

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

	// Windows icons
	{ size: 256, name: "icon.ico", format: "ico" },

	// Linux icons
	{ size: 512, name: "icon.png" },

	// Electron tray icons
	{ size: 16, name: "tray-icon.png" },
	{ size: 16, name: "tray-icon@2x.png", scale: 2 },

	// Electron dock icons
	{ size: 128, name: "dock-icon.png" },
];

// Generate icons
async function generateIcons() {
	console.log(`Generating icons from ${sourceImage}...`);

	try {
		// Check if source image exists
		if (!fs.existsSync(sourceImage)) {
			console.error(`Error: Source image not found: ${sourceImage}`);
			process.exit(1);
		}

		// Load source image
		const image = sharp(sourceImage);

		// Generate each icon
		for (const icon of icons) {
			const size = icon.size * (icon.scale || 1);
			const format = icon.format || "png";
			const outputPath = path.join(outputDir, icon.name);

			console.log(`Generating ${outputPath} (${size}x${size})...`);

			// Resize and save
			await image
				.clone()
				.resize(size, size, {
					fit: "contain",
					background: { r: 0, g: 0, b: 0, alpha: 0 },
				})
				.toFormat(format)
				.toFile(outputPath);
		}

		console.log("Icon generation complete!");
	} catch (error) {
		console.error("Error generating icons:", error);
		process.exit(1);
	}
}

// Run the icon generation
generateIcons();
