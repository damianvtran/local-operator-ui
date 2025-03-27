#!/usr/bin/env node
/**
 * This script updates the SHA-512 hashes in the latest.yml file for Windows installers
 * after code signing. It addresses an issue where electron-builder creates hashes
 * before code signing, but the hashes change after signing.
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as crypto from "node:crypto";
import * as yaml from "yaml";

/**
 * Calculates the SHA-512 hash of a file and returns it as a base64 encoded string
 *
 * @param {string} filePath - Path to the file to hash
 * @param {string} algorithm - Hash algorithm to use (default: 'sha512')
 * @param {crypto.BinaryToTextEncoding} encoding - Output encoding (default: 'base64')
 * @returns {Promise<string>} Promise resolving to the hash string
 */
const hashFile = (filePath, algorithm = "sha512", encoding = "base64") => {
	return new Promise((resolve, reject) => {
		const hash = crypto.createHash(algorithm);
		const stream = fsSync.createReadStream(filePath, {
			highWaterMark: 1024 * 1024, // Use larger chunks for better performance
		});

		stream.on("error", (err) => reject(err));

		stream.on("data", (chunk) => hash.update(chunk));

		stream.on("end", () => {
			const hashValue = hash.digest(encoding);
			console.log(
				`Hash calculated for ${path.basename(filePath)}: ${hashValue.substring(0, 20)}...`,
			);
			resolve(hashValue);
		});
	});
};

/**
 * Updates the hashes in the latest.yml file for Windows installers
 *
 * @param {string} latestYmlPath - Path to the latest.yml file
 * @param {string} distDir - Directory containing the installer files
 * @returns {Promise<void>}
 */
const updateWindowsHashes = async (latestYmlPath, distDir) => {
	try {
		// Read and parse the latest.yml file
		const ymlContent = await fs.readFile(latestYmlPath, "utf8");
		const data = yaml.parse(ymlContent);

		console.log(
			`Updating hashes for ${data.files.length} files in ${latestYmlPath}`,
		);

		// Process each file in the yml
		for (let i = 0; i < data.files.length; i++) {
			const file = data.files[i];
			const filePath = path.join(distDir, file.url);

			try {
				// Check if file exists
				await fs.access(filePath);

				// Calculate new hash
				const newHash = await hashFile(filePath);

				// Update hash in the yml data
				const oldHash = file.sha512;
				file.sha512 = newHash;

				console.log(`Updated hash for ${file.url}`);
				console.log(`  Old: ${oldHash.substring(0, 20)}...`);
				console.log(`  New: ${newHash.substring(0, 20)}...`);

				// If this is the main file referenced in the path field, update its hash too
				if (file.url === data.path) {
					data.sha512 = newHash;
					console.log(`Updated main file hash for ${data.path}`);
				}
			} catch (err) {
				console.error(`Error processing file ${file.url}:`, err);
			}
		}

		// Write the updated yml back to the file
		const updatedYml = yaml.stringify(data);
		await fs.writeFile(latestYmlPath, updatedYml, "utf8");

		console.log("Successfully updated latest.yml with new hashes");
	} catch (err) {
		console.error("Failed to update hashes:", err);
		process.exit(1);
	}
};

/**
 * Main function to run the script
 * @returns {Promise<void>}
 */
const main = async () => {
	// Get the dist directory from the current working directory
	const distDir = path.resolve(process.cwd(), "dist");
	const latestYmlPath = path.join(distDir, "latest.yml");

	console.log(`Starting Windows hash update for ${latestYmlPath}`);

	try {
		// Check if latest.yml exists
		await fs.access(latestYmlPath);
		await updateWindowsHashes(latestYmlPath, distDir);
	} catch (err) {
		console.error(`Error: ${latestYmlPath} not found or not accessible`);
		process.exit(1);
	}
};

// Run the script
main().catch((err) => {
	console.error("Unhandled error:", err);
	process.exit(1);
});
