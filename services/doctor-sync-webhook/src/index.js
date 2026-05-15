const express = require("express");
const { handleWebhook } = require("./webhookHandler");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Health check
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "doctor-sync-webhook", timestamp: new Date().toISOString() });
});

// Monday.com webhook endpoint
app.post("/webhook", async (req, res) => {
  // Monday webhook challenge verification
  if (req.body.challenge) {
    console.log("[CHALLENGE] Responding to Monday webhook verification");
    return res.json({ challenge: req.body.challenge });
  }

  // Process the webhook asynchronously — respond 200 immediately
  res.status(200).json({ ok: true });

  try {
    await handleWebhook(req.body);
  } catch (err) {
    console.error("[ERROR] Unhandled webhook error:", err.message);
  }
});

app.listen(PORT, () => {
  console.log(`[BOOT] doctor-sync-webhook listening on port ${PORT}`);
});
