const open = new WeakSet();

// Re-entrant so a caller can group several store writes into one all-or-nothing batch.
export function transaction(database, work) {
  if (open.has(database)) return work();
  database.exec('BEGIN IMMEDIATE');
  open.add(database);
  try {
    const result = work();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    open.delete(database);
  }
}
