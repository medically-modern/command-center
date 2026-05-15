# Doctor Sync Webhook

Listens for Monday.com webhooks when doctor info columns change on pipeline boards,
then syncs the changed field to the MM Doctor Database.

## Flow
1. User edits doctor info on any pipeline board (Profile Send Off, Medical Evaluation, Insurance, Welcome Call)
2. Monday webhook fires to this service
3. Service looks up doctor in DB by NPI
4. If NPI matches AND name matches → updates the changed column in Doctor Database
5. If NPI matches but name doesn't → logs mismatch, does NOT update

## Environment Variables
- `MONDAY_API_TOKEN` — Monday.com API token (required)
- `PORT` — Server port (auto-set by Railway)

## Deploy to Railway
1. Connect this repo to Railway
2. Set root directory to `services/doctor-sync-webhook`
3. Set the `MONDAY_API_TOKEN` environment variable
4. Deploy — Railway will auto-detect Node.js

## Webhook Registration
After deploying, webhooks must be registered via the Monday API pointing to:
`https://<your-railway-url>/webhook`
