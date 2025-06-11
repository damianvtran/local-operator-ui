import {
	showErrorToast,
	showSuccessToast,
} from "@shared/utils/toast-manager";

/**
 * Creates a new file with the given details.
 *
 * @param name - The name of the file.
 * @param type - The file extension.
 * @param location - The directory where the file will be created.
 * @returns A promise that resolves when the file is created.
 */
export const createFile = async (
	name: string,
	type: string,
	location: string,
	overwrite = false,
): Promise<void> => {
	const filePath = `${location}/${name}.${type}`;

	try {
		if (!overwrite) {
			const exists = await window.api.fileExists(filePath);
			if (exists) {
				showErrorToast("File already exists. Creation cancelled.");
				return;
			}
		}

		await window.api.saveFile(filePath, "");

		const fileWasCreated = await window.api.fileExists(filePath);
		if (fileWasCreated) {
			showSuccessToast(`File "${name}.${type}" created successfully!`);
		} else {
			throw new Error("File creation failed.");
		}
	} catch (error) {
		const errorMessage =
			error instanceof Error
				? error.message
				: "An unknown error occurred while creating the file.";
		showErrorToast(errorMessage);
		throw error;
	}
};
