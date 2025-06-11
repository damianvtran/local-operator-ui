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
): Promise<void> => {
	try {
		const filePath = `${location}/${name}.${type}`;
		await window.api.saveFile(filePath, "");
		showSuccessToast(`File "${name}.${type}" created successfully!`);
	} catch (error) {
		const errorMessage =
			error instanceof Error
				? error.message
				: "An unknown error occurred while creating the file.";
		showErrorToast(errorMessage);
		throw error;
	}
};
