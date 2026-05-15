const MONDAY_API_URL = "https://api.monday.com/v2";
const MONDAY_TOKEN = process.env.MONDAY_API_TOKEN;

if (!MONDAY_TOKEN) {
  console.warn("[WARN] MONDAY_API_TOKEN not set — API calls will fail");
}

/**
 * Execute a Monday.com GraphQL query
 */
async function mondayQuery(query, variables = {}) {
  const res = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: {
      Authorization: MONDAY_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  const data = await res.json();

  if (data.errors) {
    const msg = data.errors.map((e) => e.message).join("; ");
    throw new Error(`Monday API error: ${msg}`);
  }

  return data.data;
}

/**
 * Fetch a single item's column values from any board
 */
async function getItemColumns(itemId, columnIds) {
  const data = await mondayQuery(
    `query ($itemId: [ID!]!) {
      items(ids: $itemId) {
        id
        name
        column_values {
          id
          type
          text
          value
        }
      }
    }`,
    { itemId: [String(itemId)] }
  );

  if (!data.items || data.items.length === 0) return null;
  return data.items[0];
}

/**
 * Search the Doctor Database board for a doctor by NPI
 * Returns the first matching item or null
 */
async function findDoctorByNPI(npi) {
  const DB_BOARD_ID = "18142847597";
  const NPI_COLUMN_ID = "text_mkwhtqjb";

  // Use items_page_by_column_values for exact match
  const data = await mondayQuery(
    `query ($boardId: ID!, $columns: [ItemsPageByColumnValuesQuery!]!) {
      items_page_by_column_values(board_id: $boardId, limit: 5, columns: $columns) {
        items {
          id
          name
          column_values {
            id
            type
            text
            value
          }
        }
      }
    }`,
    {
      boardId: DB_BOARD_ID,
      columns: [{ column_id: NPI_COLUMN_ID, column_values: [String(npi)] }],
    }
  );

  const items = data.items_page_by_column_values?.items || [];
  return items.length > 0 ? items[0] : null;
}

/**
 * Update a single column value on an item in the Doctor Database
 */
async function updateDoctorColumn(itemId, columnId, value) {
  const DB_BOARD_ID = "18142847597";

  const data = await mondayQuery(
    `mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) {
        id
      }
    }`,
    {
      boardId: DB_BOARD_ID,
      itemId: String(itemId),
      columnId,
      value,
    }
  );

  return data;
}

/**
 * Update the item name (Doctor Name) on the Doctor Database
 */
async function updateDoctorName(itemId, newName) {
  const DB_BOARD_ID = "18142847597";

  const data = await mondayQuery(
    `mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: String!) {
      change_simple_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) {
        id
      }
    }`,
    {
      boardId: DB_BOARD_ID,
      itemId: String(itemId),
      columnId: "name",
      value: newName,
    }
  );

  return data;
}

module.exports = {
  mondayQuery,
  getItemColumns,
  findDoctorByNPI,
  updateDoctorColumn,
  updateDoctorName,
};
