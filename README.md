# ICD / KKF Dashboard V23

Fixes V22 running-train detection.

## Important fix
The Monday-Sunday Y/N service flags are now collected across **all rows belonging to each train**, instead of reading only the first row. This handles sheets where weekday values are present only on a source/particular row and prevents valid services from being shown as `0 trains running`.

All V22 features are retained: map-only dashboard, India-focused map, running-area fit, running dropdown, selected-train route, watering popup behavior, and Vercel runtime/build fixes.
