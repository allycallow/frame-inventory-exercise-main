# DELTA import test CSVs

These files use synthetic frame IDs with the `CSV-TEST-` prefix. Upload them
from **Imports** in the local app. The counts assume the test IDs are new.

## Update sequence

Upload these files in order with **Force overwrite** off.

| File | Expected result |
| --- | --- |
| [01-baseline.csv](01-baseline.csv) | 2 applied. Upload it again immediately for 2 unchanged. |
| [02-newer-update.csv](02-newer-update.csv) | 1 applied. The history for `CSV-TEST-001` shows a new version. |
| [03-stale-update.csv](03-stale-update.csv) | 1 rejected with `STALE_RECORD`. |
| [04-timestamp-collision.csv](04-timestamp-collision.csv) | 1 rejected with `TIMESTAMP_COLLISION_CONFLICT`. |

To test forced overwrite, upload `03-stale-update.csv` again with **Force
overwrite** selected and confirmed. Expect 1 applied. Repeat with the flag
selected for 1 unchanged.

## Standalone cases

| File | Expected result |
| --- | --- |
| [duplicate-frame-ids.csv](duplicate-frame-ids.csv) | 1 applied and 2 rejected with `DUPLICATE_FRAME_ID`. |
| [mixed-valid-and-invalid.csv](mixed-valid-and-invalid.csv) | 1 applied and 5 rejected. Diagnostics identify invalid status, date, missing frame ID, column count, and invalid latitude in data rows 2–6. |
| [invalid-header.csv](invalid-header.csv) | Job fails with `INVALID_CSV_HEADER`. |
| [header-only.csv](header-only.csv) | Job completes with zero data rows and no changes. |
| [quoted-multiline.csv](quoted-multiline.csv) | 1 applied. The reordered headers and quoted address with a comma, quotes, and a line break parse as one record. |
