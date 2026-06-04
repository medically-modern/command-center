/**
 * Patient Questions — read-only inbox of patient messages.
 * Aggregates from Subscription board ("Patient Help Message")
 * and Secondary Claims board ("Patient Message").
 */

export interface PatientQuestion {
  id: string;            // Monday item ID
  name: string;          // Patient name
  message: string;       // The patient's message text
  messageUpdatedAt: string; // ISO timestamp from the long_text column
  source: "subscription" | "claims"; // Which board this came from
  boardId: number;

  // Basic demographics (when available)
  phone: string;
  email: string;
  insurance: string;

  // Source-specific context
  status: string;          // Subscription status or Claims status
  dob: string;
}
