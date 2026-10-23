import { create } from "zustand";
import { persist } from "zustand/middleware";
import { type EmojiUsage, recordEmojiUsage } from "./team-bridge-emoji-model";

type Preferences = { usage: EmojiUsage; tone: number };
type State = {
	accounts: Record<string, Preferences>;
	record: (account: string, emoji: string) => void;
	setTone: (account: string, tone: number) => void;
};
/** Same Zustand persist pattern as agent-messages-onboarding-store. Account partitions prevent a
 * second sign-in inheriting somebody else's frequency ranking. Persist usage only after success. */
export const useReactionPreferences = create<State>()(
	persist(
		(set) => ({
			accounts: {},
			record: (account, emoji) =>
				set((state) => {
					const previous = state.accounts[account] ?? { usage: {}, tone: 0 };
					return {
						accounts: {
							...state.accounts,
							[account]: {
								...previous,
								usage: recordEmojiUsage(previous.usage, emoji, Date.now()),
							},
						},
					};
				}),
			setTone: (account, tone) =>
				set((state) => ({
					accounts: {
						...state.accounts,
						[account]: { usage: state.accounts[account]?.usage ?? {}, tone },
					},
				})),
		}),
		{
			name: "team-bridge-reaction-preferences",
			partialize: (state) => ({ accounts: state.accounts }),
		},
	),
);
