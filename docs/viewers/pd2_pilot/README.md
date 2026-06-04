# PD2 Xenium Pilot Viewer

Static GitHub Pages deployment bundle for the perinatal Xenium PD2 pilot
viewer.

Open locally from the repository root with:

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Then visit:

```text
http://127.0.0.1:8765/docs/viewers/pd2_pilot/app/index.html
```

## Included

- `app/`: static HTML, CSS, and JavaScript viewer.
- `data/pd2_cells.json.gz`: compact browser-ready PD2 cell table.
- `data/pd2_pilot_annotation.csv.gz`: pilot per-cell annotation table.
- `data/pd2_pilot_export_manifest.json`: source/export manifest.
- `data/pd2_summary.json`: summary metadata.
- `data/pd2_cell_type_counts.csv`: pilot label counts.

## Excluded

Large local analysis objects such as `pd2_scanpy_pilot.h5ad` are intentionally
excluded from the online bundle. Future full-atlas objects can be hosted in
Google Drive, cloud object storage, or archival storage with public HTTP access
and CORS, while GitHub keeps only the static app and small metadata.

## Caveat

These labels are a pilot mapping for viewer development and marker review, not
final biological interpretation. The `Unmapped 11,2` group is intentionally
preserved for manual marker and spatial review.
