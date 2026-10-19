import { createContext, useContext } from "react";
import {
	MESSAGE_TIMESTAMPS_OFF,
	type MessageTimestamps,
} from "./message-timestamps";

/**
 * The transcript's one read of the setting, handed down by context rather than
 * by a prop through every row (and `TurnSummary`): the stamps live at four
 * depths, and a hook per stamp would subscribe the Settings query once per row.
 * The default is OFF, so a stamp rendered outside a transcript (a story, a test)
 * behaves as it did before the setting existed and needs no QueryClient.
 */
export const MessageTimestampsContext = createContext<MessageTimestamps>(
	MESSAGE_TIMESTAMPS_OFF,
);

export const useMessageTimestampsContext = (): MessageTimestamps =>
	useContext(MessageTimestampsContext);
