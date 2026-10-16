/** Human chrome order, deliberately separate from registry creation order.
 * Reordering conveys no ownership/capability and cannot alter an agent's tab
 * listing. Projection prunes closed IDs and appends newly-created records. A
 * scoped strip replaces ONLY the slots occupied by its visible permutation;
 * unrelated conversations keep their positions. Nothing is persisted. */
export class ChromeTabOrder {
	private ids: number[] = [];
	private customized = false;
	get hasCustomOrder(): boolean {
		return this.customized;
	}
	project<T extends { tabId: number }>(records: readonly T[]): T[] {
		if (!this.customized) this.ids = records.map((record) => record.tabId);
		const byId = new Map(records.map((record) => [record.tabId, record]));
		this.ids = this.ids.filter((id) => byId.has(id));
		const known = new Set(this.ids);
		this.ids.push(
			...records.filter((r) => !known.has(r.tabId)).map((r) => r.tabId),
		);
		return this.ids
			.map((id) => byId.get(id))
			.filter((record): record is T => record !== undefined);
	}
	reorder<T extends { tabId: number }>(
		records: readonly T[],
		permutation: readonly number[],
	): boolean {
		this.project(records);
		const selected = new Set(permutation);
		if (
			selected.size !== permutation.length ||
			[...permutation].some((id) => !this.ids.includes(id))
		)
			return false;
		this.customized = true;
		let index = 0;
		this.ids = this.ids.map((id) =>
			selected.has(id) ? permutation[index++] : id,
		);
		return true;
	}
}
