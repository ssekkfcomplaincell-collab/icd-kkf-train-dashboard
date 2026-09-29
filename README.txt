ICD-KKF EXACT DASHBOARD BUILD FIX

IMPORTANT: This ZIP contains ONLY TrainDashboard.tsx.
It is based on the latest ICD-KKF dashboard source (the version with the ICD KKF compact header, live clock/date, theme toggle, TODAY'S TRAIN, watering alerts, garbage station badges, overnight handling, etc.).

Only change made:
- Fixed TypeScript build error: 'end' is possibly 'null'.
- Overnight train rollover logic is unchanged.

Replace only:
components/TrainDashboard.tsx

DO NOT replace RouteMap.tsx or globals.css with this ZIP.
