# Peeps generator (R1295)

Builds `components/ui/art/peeps/data.ts`: the Outlly cast, composed from the CC0 [Open Peeps](https://www.openpeeps.com/)
parts through [react-peeps](https://github.com/CeamKrier/react-peeps) (MIT) and optimised with SVGO. The app never
depends on these packages; only the generated strings are committed.

```sh
cd scripts/peeps
bun install
bun measure.mjs                                  # writes measure.html
uv run --with playwright python measure.py       # measures each figure's real bounding box -> bbox.json (needs msedge)
bun gen.mjs                                      # writes data.ts (+ peeps.json, gallery.html to judge the treatment)
cp data.ts ../../components/ui/art/peeps/data.ts
```

To add or change a figure, edit `cast.mjs` (one entry per job; keep every combination unique) and run the three steps
again. Ink is `currentColor`, paper areas are `var(--peep-fill)`; the `Peep` component sets both.
