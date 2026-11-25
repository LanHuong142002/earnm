/**
 * Per-field last-write-wins, shared by every table that syncs offline (Epic Decision 4).
 *
 * Convention: a table using this keeps, for each editable field `<field>`, a column
 * `<field>EditedAt` holding the time of the change it last accepted.
 */

/** One field change from the phone: the new value and when the person made it. */
export type FieldChange<V> = { value: V; editedAt: Date };

/**
 * For each field present in `fields`:
 *  - caps its editedAt at `now`, so a phone with a clock in the future can't win every conflict;
 *  - calls `write(where, data)`, which must run an `updateMany` on the right table. The
 *    `where` only matches when the stored time is older, so the database decides atomically.
 *
 * Returns the names of the fields that were actually written: those whose `write` result is an
 * `updateMany` result (`{ count }`) that affected a row. A `write` that returns something else
 * (nothing, say) gives no way to tell, so its field counts as written.
 */
export async function applyLastWriteWins(
  fields: Record<string, FieldChange<unknown> | undefined>,
  now: Date,
  write: (where: Record<string, unknown>, data: Record<string, unknown>) => Promise<unknown>,
): Promise<string[]> {
  const applied: string[] = [];
  for (const [field, change] of Object.entries(fields)) {
    if (!change) continue;
    const at = new Date(Math.min(change.editedAt.getTime(), now.getTime()));

    const result = await write(
      { [`${field}EditedAt`]: { lt: at } },
      { [field]: change.value, [`${field}EditedAt`]: at },
    );
    const count = (result as { count?: unknown } | null | undefined)?.count;
    if (typeof count !== "number" || count > 0) applied.push(field);
  }
  return applied;
}
