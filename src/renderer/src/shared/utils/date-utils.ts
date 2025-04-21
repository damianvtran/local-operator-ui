import { format } from "date-fns";

/**
 * Formats a date/time string based on when it occurred
 * - Today: just time (h:mm a)
 * - Yesterday: "Yesterday"
 * - Within the last 7 days: Day of week (e.g., "Monday")
 * - Older: Full date (yyyy-MM-dd)
 *
 * @param dateTimeString The date/time string to format
 * @returns Formatted date/time string
 */
export const formatMessageDateTime = (
	dateTimeString?: string | Date,
): string => {
	if (!dateTimeString) return "";

	try {
		const messageDate =
			dateTimeString instanceof Date
				? dateTimeString
				: new Date(dateTimeString);

		const now = new Date();
		const yesterday = new Date(now);
		yesterday.setDate(now.getDate() - 1);

		// Check if the message was sent today
		if (messageDate.toDateString() === now.toDateString()) {
			return format(messageDate, "h:mm a"); // Today: just time
		}

		// Check if the message was sent yesterday
		if (messageDate.toDateString() === yesterday.toDateString()) {
			return "Yesterday"; // Yesterday
		}

		// Check if the message was sent this week (within the last 7 days)
		const oneWeekAgo = new Date(now);
		oneWeekAgo.setDate(now.getDate() - 7);
		if (messageDate > oneWeekAgo) {
			return format(messageDate, "EEEE"); // Day of week
		}

		// Otherwise, show the full date
		return format(messageDate, "yyyy-MM-dd");
	} catch (error) {
		console.error("Error formatting date:", error);
		return "";
	}
};

/**
 * Gets the full formatted date and time for tooltips
 *
 * @param dateTimeString The date/time string to format
 * @returns Full formatted date and time string
 */
export const getFullDateTime = (dateTimeString?: string | Date): string => {
	if (!dateTimeString) return "";

	try {
		const date =
			dateTimeString instanceof Date
				? dateTimeString
				: new Date(dateTimeString);
		return date.toLocaleString();
	} catch (error) {
		console.error("Error getting full date time:", error);
		return "";
	}
};
