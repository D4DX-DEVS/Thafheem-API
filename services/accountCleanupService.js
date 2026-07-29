const mysqlPool = require('../config/database');

const TARGET_TABLES = [
  { name: 'bookmarks', candidateColumns: ['userId', 'user_id', 'uid'] },
  { name: 'favorites', candidateColumns: ['userId', 'user_id', 'uid'] }
];

const getExistingTableNames = async () => {
  const [rows] = await mysqlPool.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = DATABASE()`
  );

  return new Set(rows.map((row) => row.table_name));
};

const getColumnForTable = async (tableName, candidateColumns) => {
  const [rows] = await mysqlPool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = ?`,
    [tableName]
  );

  const available = new Set(rows.map((row) => row.column_name));
  return candidateColumns.find((column) => available.has(column)) || null;
};

const deleteUserData = async (uid) => {
  const existingTables = await getExistingTableNames();
  const cleanedTables = [];
  const skippedTables = [];
  let totalDeletedRows = 0;

  for (const table of TARGET_TABLES) {
    if (!existingTables.has(table.name)) {
      skippedTables.push({ table: table.name, reason: 'missing_table' });
      continue;
    }

    const userColumn = await getColumnForTable(table.name, table.candidateColumns);
    if (!userColumn) {
      skippedTables.push({ table: table.name, reason: 'missing_user_column' });
      continue;
    }

    const [result] = await mysqlPool.query(
      'DELETE FROM ?? WHERE ?? = ?',
      [table.name, userColumn, uid]
    );

    const deletedRows = result?.affectedRows || 0;
    totalDeletedRows += deletedRows;

    cleanedTables.push({
      table: table.name,
      userColumn,
      deletedRows
    });
  }

  return {
    uid,
    totalDeletedRows,
    cleanedTables,
    skippedTables
  };
};

module.exports = {
  deleteUserData
};
