# ICD-KKF Train Operations Dashboard V4

Next.js dashboard for the ICD / KKF train schedule.

## V4 features

- Reads the live published schedule Google Sheet.
- Uses Monday–Sunday Y/N columns to identify service days.
- Calculates the actual **Departure Date** for multi-day trains using the schedule's Day 1 / Day 2 / Day 3 values.
- Includes previous-day departures that are still active today.
- Shows the selected train's actual departure date and current schedule day.
- Reads station coordinates from the same spreadsheet sheet named **Longitude & Lattitude Details**.
- Matches `Station Code` to `Latitude` and `Longitude`.
- Shows an India geographic route map using OpenStreetMap tiles.
- Completed scheduled route is a solid line; pending scheduled route is a dotted line.
- Shows a scheduled current-position marker when the train is between stations.
- Skips invalid `0,0` coordinates.
- OBHS/on-board staff matching is intentionally not included yet.

## Coordinate sheet columns

The coordinate sheet is expected to contain:

- `Station Code` — Column A
- `Longitude` — Column F
- `Latitude` — Column G

The default coordinate fetch uses the Google Sheets `gviz` CSV endpoint with the sheet name `Longitude & Lattitude Details` (GID `1506639435`). If your Google Sheet is not accessible through that endpoint, set `GOOGLE_COORDINATES_CSV_URL` to a published CSV URL for that sheet.

## Run locally

```bash
npm install
npm run dev
```

Then open the local Next.js URL shown in the terminal.

## Vercel

Push the project root to GitHub and import/deploy it in Vercel as a Next.js project. Vercel runs the normal `npm install` and `npm run build` flow.

The schedule source is already configured in `lib/google-sheet.ts`. No environment variable is required unless the published URL changes.

## Important limitation

The map shows **scheduled geographic progress**, not GPS/live train location. A real GPS position would require a live train-running source.


V8 build fix: train map labels use Leaflet DivIcon from the leaflet package rather than react-leaflet.
