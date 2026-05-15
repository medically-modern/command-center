#!/bin/bash
# Register Monday.com webhooks for all 4 pipeline boards
# Usage: RAILWAY_URL=https://your-service.up.railway.app MONDAY_API_TOKEN=your_token ./register-webhooks.sh

set -e

if [ -z "$RAILWAY_URL" ]; then
  echo "ERROR: Set RAILWAY_URL env var (e.g. https://doctor-sync-webhook-production.up.railway.app)"
  exit 1
fi

if [ -z "$MONDAY_API_TOKEN" ]; then
  echo "ERROR: Set MONDAY_API_TOKEN env var"
  exit 1
fi

WEBHOOK_URL="${RAILWAY_URL}/webhook"
BOARDS=("18406352652" "18406060017" "18410601299" "18410804557")
BOARD_NAMES=("Profile Send Off" "Medical Evaluation" "Insurance" "Welcome Call")

echo "Registering webhooks pointing to: $WEBHOOK_URL"
echo ""

for i in "${!BOARDS[@]}"; do
  BOARD_ID="${BOARDS[$i]}"
  BOARD_NAME="${BOARD_NAMES[$i]}"

  echo "--- ${BOARD_NAME} (${BOARD_ID}) ---"

  RESULT=$(curl -s -X POST https://api.monday.com/v2 \
    -H "Authorization: ${MONDAY_API_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{
      \"query\": \"mutation { create_webhook(board_id: ${BOARD_ID}, url: \\\"${WEBHOOK_URL}\\\", event: change_column_value) { id board_id } }\"
    }")

  echo "$RESULT" | python3 -m json.tool 2>/dev/null || echo "$RESULT"
  echo ""
done

echo "Done! Webhooks registered for all 4 boards."
echo "Verify at: https://api.monday.com/v2 with query: { webhooks(board_id: <id>) { id event config } }"
