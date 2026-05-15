/**
 * Column mapping from source pipeline boards → Doctor Database board
 *
 * All 4 source boards share the same column IDs for doctor fields:
 *   - 18406352652 (Profile Send Off Board)
 *   - 18406060017 (Medical Evaluation)
 *   - 18410601299 (Insurance)
 *   - 18410804557 (Welcome Call)
 *
 * Doctor Database board: 18142847597
 */

// Which source boards we monitor
const WATCHED_BOARDS = [
  "18406352652", // Profile Send Off Board
  "18406060017", // Medical Evaluation
  "18410601299", // Insurance
  "18410804557", // Welcome Call
];

const DB_BOARD_ID = "18142847597";

// Source column IDs that are "doctor info" — these trigger the sync
const DOCTOR_COLUMN_IDS = [
  "text_mm1x46et",     // Doctor Name
  "phone_mm1xz8c0",    // Doctor Phone
  "text_mm1x7d91",     // Doctor NPI
  "color_mm1xw7y5",    // Clinicals Method
  "email_mm1x6fq5",    // Doctor Email
  "email_mm1xdzcj",    // Doctor Fax (@rcfax)
  "dropdown_mm1xbvas", // Clinic Name
  "location_mm1xjnfv", // Clinic Address
];

// The NPI column on source boards (used to look up in DB)
const SOURCE_NPI_COL = "text_mm1x7d91";
// The Doctor Name column on source boards (used for safety check)
const SOURCE_NAME_COL = "text_mm1x46et";

/**
 * Maps a source board column ID → the corresponding Doctor Database column ID
 * plus the transform function needed to convert the value format.
 *
 * Returns { dbColumnId, transformValue } or null if not a doctor column.
 */
function mapSourceToDb(sourceColumnId) {
  const mapping = {
    // Doctor Name → item name (special case, uses change_simple_column_value)
    text_mm1x46et: {
      dbColumnId: "name",
      isItemName: true,
    },
    // Doctor Phone → Doc Phone
    phone_mm1xz8c0: {
      dbColumnId: "phone",
      transformValue: (sourceValue) => {
        // Source phone value: {"phone":"5708873131","countryShortName":"US"}
        // DB phone column expects same format
        if (!sourceValue) return null;
        const parsed = typeof sourceValue === "string" ? JSON.parse(sourceValue) : sourceValue;
        return JSON.stringify({ phone: parsed.phone, countryShortName: parsed.countryShortName || "" });
      },
    },
    // Doctor NPI → NPI (text column, straightforward)
    text_mm1x7d91: {
      dbColumnId: "text_mkwhtqjb",
      transformValue: (sourceValue) => {
        // text columns: value is just the string in quotes
        return sourceValue;
      },
    },
    // Clinicals Method → MN Exchange? (status → status)
    color_mm1xw7y5: {
      dbColumnId: "color_mm1vr8rd",
      transformValue: (sourceValue) => {
        // Status columns: need to map the label text to the DB status index
        // Source labels: Parachute, Fax, Email
        // DB labels for color_mm1vr8rd: index 0 = "Parachute", index 1 = "Fax", index 2 = "Email"
        // We pass the label text and let Monday resolve it
        if (!sourceValue) return null;
        const parsed = typeof sourceValue === "string" ? JSON.parse(sourceValue) : sourceValue;
        // Use the index approach — need to map source index → DB index
        // Safer: read the label from source, write label to DB
        return sourceValue; // Status columns with same labels can pass index directly
      },
    },
    // Doctor Email → Script Email
    email_mm1x6fq5: {
      dbColumnId: "email",
      transformValue: (sourceValue) => {
        // Email columns: {"email":"x@y.com","text":"x@y.com"}
        if (!sourceValue) return null;
        const parsed = typeof sourceValue === "string" ? JSON.parse(sourceValue) : sourceValue;
        return JSON.stringify({ email: parsed.email || "", text: parsed.text || parsed.email || "" });
      },
    },
    // Doctor Fax (@rcfax) → Script Fax
    email_mm1xdzcj: {
      dbColumnId: "email_mkwh2ywd",
      transformValue: (sourceValue) => {
        if (!sourceValue) return null;
        const parsed = typeof sourceValue === "string" ? JSON.parse(sourceValue) : sourceValue;
        return JSON.stringify({ email: parsed.email || "", text: parsed.text || parsed.email || "" });
      },
    },
    // Clinic Name → Clinic (dropdown → dropdown)
    dropdown_mm1xbvas: {
      dbColumnId: "dropdown_mm1vd9fs",
      // Dropdowns need special handling — labels may differ between boards
      // We'll need to match by label text, not by ID
      isDropdown: true,
      transformValue: (sourceText) => {
        // We'll handle this in the webhook handler using label-based matching
        return sourceText;
      },
    },
    // Clinic Address → Doc Address (location → text)
    location_mm1xjnfv: {
      dbColumnId: "text_mkzc21ns",
      transformValue: (sourceValue) => {
        // Source is location type, DB is text — extract the address string
        if (!sourceValue) return null;
        const parsed = typeof sourceValue === "string" ? JSON.parse(sourceValue) : sourceValue;
        const addr = parsed.address || parsed.street || "";
        return JSON.stringify(addr);
      },
    },
  };

  return mapping[sourceColumnId] || null;
}

module.exports = {
  WATCHED_BOARDS,
  DB_BOARD_ID,
  DOCTOR_COLUMN_IDS,
  SOURCE_NPI_COL,
  SOURCE_NAME_COL,
  mapSourceToDb,
};
