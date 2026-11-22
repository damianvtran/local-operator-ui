// Library reads and proposal mutations must address the same named entry;
// the surrounding skills prefix also serves other consumers, including Hub.
export const skillsLibraryKey = ["desktop", "skills", "library"] as const;

export const skillDetailKey = (name: string | null) =>
	[...skillsLibraryKey, name] as const;
