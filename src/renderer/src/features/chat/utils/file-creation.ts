import { showErrorToast, showSuccessToast } from "@shared/utils/toast-manager";
import { t } from "../../../../../i18n/messages";

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
				showErrorToast(
					t("ui.chat.file_creation.file_already_exists_creation_cancelled"),
				);
				return;
			}
		}

		await window.api.saveFile(filePath, "");

		const fileWasCreated = await window.api.fileExists(filePath);
		if (fileWasCreated) {
			showSuccessToast(
				t("ui.chat.file_creation.file_name_type_created", { name, type }),
			);
		} else {
			throw new Error(t("ui.chat.file_creation.file_creation_failed"));
		}
	} catch (error) {
		const errorMessage =
			error instanceof Error
				? error.message
				: t(
						"ui.chat.file_creation.an_unknown_error_occurred_while_creating_the_file",
					);
		showErrorToast(errorMessage);
		throw error;
	}
};
