const {
  getItemColumns,
  findDoctorByNPI,
  updateDoctorColumn,
  updateDoctorName,
  mondayQuery,
} = require("./mondayApi");

const {
  WATCHED_BOARDS,
  DOCTOR_COLUMN_IDS,
  SOURCE_NPI_COL,
  SOURCE_NAME_COL,
  mapSourceToDb,
  DB_BOARD_ID,
} = require("./columnMap");

/**
 * Main webhook handler.
 *
 * Monday sends: { event: { boardId, pulseId, columnId, value, previousValue, ... } }
 */
async function handleWebhook(body) {
  const event = body.event;
  if (!event) {
    console.log("[SKIP] No event in payload");
    return;
  }

  const { boardId, pulseId, columnId } = event;
  const boardIdStr = String(boardId);
  const itemId = String(pulseId);

  console.log(`[WEBHOOK] Board=${boardIdStr} Item=${itemId} Column=${columnId}`);

  // 1. Is this a watched board?
  if (!WATCHED_BOARDS.includes(boardIdStr)) {
    console.log(`[SKIP] Board ${boardIdStr} is not in watched list`);
    return;
  }

  // 2. Is this a doctor-info column?
  if (!DOCTOR_COLUMN_IDS.includes(columnId)) {
    console.log(`[SKIP] Column ${columnId} is not a doctor-info column`);
    return;
  }

  console.log(`[PROCESS] Doctor column changed: ${columnId}`);

  // 3. Fetch the full item to get NPI + Doctor Name + the changed column value
  const sourceItem = await getItemColumns(itemId);
  if (!sourceItem) {
    console.error(`[ERROR] Could not fetch item ${itemId} from board ${boardIdStr}`);
    return;
  }

  // Extract NPI from the source item
  const npiCol = sourceItem.column_values.find((cv) => cv.id === SOURCE_NPI_COL);
  const npi = npiCol?.text?.trim();

  if (!npi) {
    console.log(`[SKIP] Item ${itemId} has no NPI value — cannot look up doctor`);
    return;
  }

  // Extract Doctor Name from the source item
  const nameCol = sourceItem.column_values.find((cv) => cv.id === SOURCE_NAME_COL);
  const sourceDoctorName = nameCol?.text?.trim() || "";

  console.log(`[LOOKUP] NPI=${npi} DoctorName="${sourceDoctorName}"`);

  // 4. Find the doctor in the database by NPI
  const dbDoctor = await findDoctorByNPI(npi);

  if (!dbDoctor) {
    console.log(`[NOT FOUND] No doctor in DB with NPI=${npi} (source name: "${sourceDoctorName}")`);
    return;
  }

  console.log(`[FOUND] DB Doctor: "${dbDoctor.name}" (id: ${dbDoctor.id})`);

  // 5. Safety check: NPI matched, but does the name match?
  const dbDoctorName = dbDoctor.name?.trim() || "";
  if (!namesMatch(sourceDoctorName, dbDoctorName)) {
    console.warn(
      `[NAME MISMATCH] NPI=${npi} matched DB doctor "${dbDoctorName}" but source has "${sourceDoctorName}" — SKIPPING UPDATE`
    );
    return;
  }

  // 6. Map the changed column to the DB column and update
  const mapping = mapSourceToDb(columnId);
  if (!mapping) {
    console.error(`[ERROR] No mapping found for column ${columnId} — this should not happen`);
    return;
  }

  // Get the changed column's current value from the source item
  const changedCol = sourceItem.column_values.find((cv) => cv.id === columnId);

  try {
    if (mapping.isItemName) {
      // Special case: updating the item name (Doctor Name)
      const newName = changedCol?.text?.trim() || "";
      if (!newName) {
        console.log(`[SKIP] New doctor name is empty`);
        return;
      }
      console.log(`[UPDATE] Updating DB doctor name from "${dbDoctorName}" to "${newName}"`);
      await updateDoctorName(dbDoctor.id, newName);
      console.log(`[SUCCESS] Doctor name updated`);
    } else if (mapping.isDropdown) {
      // Dropdown: match by label text
      await handleDropdownUpdate(dbDoctor.id, mapping.dbColumnId, changedCol);
    } else {
      // Standard column update
      const newValue = mapping.transformValue
        ? mapping.transformValue(changedCol?.value)
        : changedCol?.value;

      if (newValue === null || newValue === undefined) {
        console.log(`[SKIP] Transformed value is null for column ${columnId}`);
        return;
      }

      console.log(`[UPDATE] Setting DB column ${mapping.dbColumnId} = ${newValue}`);
      await updateDoctorColumn(dbDoctor.id, mapping.dbColumnId, newValue);
      console.log(`[SUCCESS] Column ${mapping.dbColumnId} updated for doctor "${dbDoctorName}"`);
    }
  } catch (err) {
    console.error(`[ERROR] Failed to update DB doctor ${dbDoctor.id}:`, err.message);
  }
}

/**
 * Handle dropdown column updates by matching label text.
 * Source and DB dropdown boards may have different label IDs for the same text.
 */
async function handleDropdownUpdate(dbItemId, dbColumnId, sourceCol) {
  const sourceText = sourceCol?.text?.trim();
  if (!sourceText) {
    console.log(`[SKIP] Dropdown value is empty`);
    return;
  }

  console.log(`[DROPDOWN] Looking up label "${sourceText}" in DB column ${dbColumnId}`);

  // Get the DB board's dropdown settings to find the matching label ID
  const data = await mondayQuery(
    `query ($boardId: [ID!]!) {
      boards(ids: $boardId) {
        columns {
          id
          settings_str
        }
      }
    }`,
    { boardId: [DB_BOARD_ID] }
  );

  const dbColumn = data.boards[0]?.columns.find((c) => c.id === dbColumnId);
  if (!dbColumn) {
    console.error(`[ERROR] DB column ${dbColumnId} not found`);
    return;
  }

  const settings = JSON.parse(dbColumn.settings_str);
  const labels = settings.labels || [];

  // Find the label that matches the source text
  const matchingLabel = labels.find(
    (l) => l.name.trim().toLowerCase() === sourceText.toLowerCase()
  );

  if (!matchingLabel) {
    console.log(
      `[DROPDOWN] Label "${sourceText}" not found in DB dropdown — available: ${labels.map((l) => l.name).join(", ")}`
    );
    return;
  }

  const value = JSON.stringify({ ids: [matchingLabel.id] });
  console.log(`[UPDATE] Setting dropdown ${dbColumnId} to label id=${matchingLabel.id} ("${matchingLabel.name}")`);
  await updateDoctorColumn(dbItemId, dbColumnId, value);
  console.log(`[SUCCESS] Dropdown updated`);
}

/**
 * Compare doctor names. Exact match after normalization:
 * - case-insensitive
 * - trim whitespace
 * - collapse multiple spaces
 * - strip common prefixes like "Dr.", "DR."
 */
function namesMatch(name1, name2) {
  const normalize = (n) =>
    (n || "")
      .trim()
      .toLowerCase()
      .replace(/^dr\.?\s*/i, "")
      .replace(/\s+/g, " ");

  const n1 = normalize(name1);
  const n2 = normalize(name2);

  if (!n1 || !n2) return false;

  return n1 === n2;
}

module.exports = { handleWebhook };
