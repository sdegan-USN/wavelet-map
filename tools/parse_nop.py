#!/usr/bin/env python3
"""Parse FNMOC's NOP Sub Support page (saved HTML) into data/areas.json.

Usage:  python3 tools/parse_nop.py path/to/NOP_sub_support.html > data/areas.json
Save the page from a CAC browser session (File > Save Page As, HTML only) and rerun.
"""
import html, json, re, sys

BASE = "https://portal.fnmoc.navy.mil/ocean_products/html/"

def text(s):
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", html.unescape(s)).strip()

def parse_coord(s, neg):
    m = re.match(r"([\d.]+)\s*([NSEW])", s.strip())
    v = float(m.group(1))
    return -v if m.group(2) == neg else v

def main(path):
    src = open(path, encoding="utf-8", errors="replace").read()
    m = re.search(r"Page last updated:\s*([^<]+)", src)
    updated = m.group(1).strip() if m else ""
    out = {"source": BASE + "UPS/NOP_sub_support.html", "updated": updated, "areas": []}
    seen = {}
    fleet = None
    # walk the document in order: fleet headings and table rows
    for tok in re.finditer(r"<h3>(.*?)</h3>|<tr[^>]*>(.*?)</tr>", src, re.S):
        if tok.group(1) is not None:
            t = text(tok.group(1))
            if "Fleet" in t:
                fleet = t
            continue
        row = tok.group(2)
        cells = re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
        if len(cells) < 8:
            continue
        name_cell = text(cells[0])
        nm = re.match(r"(.*?)\(\s*(\S+)\s*\)\s*$", name_cell)
        if not nm:
            continue
        title, aid = nm.group(1).strip(), nm.group(2)
        lat = text(cells[4]).split("/")
        lon = text(cells[5]).split("/")
        hours = []
        for href, label in re.findall(r'href="([^"]+)"[^>]*>(.*?)</a>', cells[7], re.S):
            hours.append({"tau": int(text(label)), "url": BASE + href.replace("../", "")})
        rec = {
            "id": aid, "name": title, "fleets": [fleet],
            "size_kb": int(text(cells[1]) or 0),
            "model": text(cells[2]),
            "resolution_nm": text(cells[3]),
            "south": parse_coord(lat[0], "S"), "north": parse_coord(lat[1], "S"),
            "west": parse_coord(lon[0], "W"), "east": parse_coord(lon[1], "W"),
            "lat_text": text(cells[4]), "lon_text": text(cells[5]),
            "date": text(cells[6]), "hours": hours,
        }
        if aid in seen:
            if fleet not in seen[aid]["fleets"]:
                seen[aid]["fleets"].append(fleet)
        else:
            seen[aid] = rec
            out["areas"].append(rec)
    json.dump(out, sys.stdout, indent=1)

if __name__ == "__main__":
    main(sys.argv[1])
