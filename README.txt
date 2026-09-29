ICD-KKF FINAL DASHBOARD FIX

Replace these files in the project:
- components/TrainDashboard.tsx
- components/RouteMap.tsx
- app/globals.css (or your existing globals.css location)
- lib/google-sheet.ts
- data/stations.json

Google Sheet source:
https://docs.google.com/spreadsheets/d/e/2PACX-1vQXHb-McVF62fJFt1CDecykHzBwhmXnG9NrUTOyn1-iZIg2NFBZ6YySnxgwihcdvFLvMPXDk3WZ0g7z/pub?gid=1463153132&single=true&output=csv

This version uses the published CSV as the authoritative schedule source, reads Longitude from Column X and Latitude from Column Y, keeps a bundled station-coordinate fallback for blank X/Y rows, and keeps Column P Garbage Station flags.

UI included: ICD KKF compact header with live time/date/running count, dark/light toggle, page refresh, RUNNING box, TODAY'S TRAIN box, watering alerts, duplicate-location marker spread, selected-route map, garbage badges, and overnight Day-1 clock-rollover handling.
