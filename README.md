# ICD / KKF Train Operations Dashboard

Next.js dashboard that reads the published Google Sheet directly on every API request.

## Source columns used

The source schedule contains:

- NO
- Train No
- S. No.
- Station Code
- Station Name
- Route No.
- Arrival Time
- Departure Time
- Halt Time (In Minutes)
- Distance
- Day
- Section
- Section KM
- Watering Station (S/W, O/D)

The dashboard preserves special schedule values such as `Source`, `-- Via Station --`, `-- Deleted --`, and `--`.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Vercel

1. Upload this folder to GitHub.
2. Import the repository into Vercel.
3. Framework: Next.js (auto-detected).
4. Build command: `npm run build`.
5. No environment variable is required because the published CSV URL is already in the source.
6. Optional: set `GOOGLE_SHEET_CSV_URL` in Vercel Environment Variables if the published sheet URL changes.

## Important

This project uses the published Google Sheet CSV endpoint, not the editable `/edit` URL. The Google Sheet must remain published to the web.

The source schedule itself does not contain latitude/longitude or live train-running data. Therefore this version uses a schematic route visualization and shows scheduled times; it does not claim real-time location or delay.

## Refresh behavior

The frontend calls `/api/trains` with `cache: no-store`. The server fetches the published CSV with `cache: no-store`, so changes published in the Google Sheet are picked up on refresh.
