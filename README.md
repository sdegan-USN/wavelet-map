# Wavelet Map

A map of the FNMOC NOSSP wavelet areas listed on the Sub Support page
(`portal.fnmoc.navy.mil/ocean_products/html/UPS/NOP_sub_support.html`).
Hover a box to name it, click it to see the latitude/longitude, resolution,
model type and the forecast-hour links that download the wavelet from the portal (CAC needed).

Live copy: https://sean.theinformed.org/wavelet-map/

Made by LT Sean Egan and AG1 Derek Conklin for our OCEANO and AG teammates.

## Run it

Static files, no build step, no external resources. Any web server works:

```bash
python3 -m http.server 8000
# open http://localhost:8000/
```

Or drop the folder on any static host (IIS, nginx, SharePoint site assets, GitHub Pages).
Opening `index.html` straight from disk does not work in most browsers because the page
fetches `data/areas.json`; serve it.

## Refresh the area list

The list is a snapshot of the FNMOC page. To update it:

1. Open the Sub Support page in a CAC browser session and save it (File > Save Page As, "Webpage, HTML only").
2. `python3 tools/parse_nop.py ~/Downloads/NOP_sub_support.html > data/areas.json`

`tools/NOP_sub_support.sample.html` is the page the current `data/areas.json` came from.

## Files

- `index.html`, `style.css`, `app.js`: the page.
- `data/areas.json`: one record per area (id, name, fleets, model type, resolution, corners, forecast hours with URLs).
- `data/land.geojson`: Natural Earth 1:50m land, public domain.
- `tools/parse_nop.py`: the FNMOC page parser.

Independent tool built on our own time; not an official product of any government body.
