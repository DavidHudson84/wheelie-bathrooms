"""One-off: resize source photos from Dropbox into assets/img as WebP (480/960/1600) plus a JPG for social sharing."""
import glob, os, json
from PIL import Image, ImageOps
SRC = r"C:\Users\David\Dropbox\Hudson Group\Ensuites on Tow\Wheelie Bathrooms"
OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "img")
os.makedirs(OUT, exist_ok=True)
compact = sorted(glob.glob(os.path.join(SRC, "compact photos", "*.jpeg")))
img = lambda n: os.path.join(SRC, "Images", n)
PICK = {
  "compact-driveway": compact[13], "compact-backyard": compact[11], "compact-door-open": compact[12],
  "compact-interior": compact[21], "compact-narrow": compact[9], "compact-side-path": compact[10],
  "compact-garage": compact[14], "compact-front": compact[4], "compact-hot-water": compact[20],
  "compact-shower": compact[17], "compact-toilet": compact[16],
  "standard-trailer": img("tralier 1.jpg"), "standard-trailer-2": img("tralier 3.jpg"),
  "standard-shower": img("trailer shower.jpg"), "standard-basin": img("compact 4.jpg"),
  "compact-classic": img("compact 2.jpg"), "compact-classic-toilet": img("compact 3.jpg"),
  "floorplan-compact": img("floorplan compact.jpg"), "floorplan-standard": img("TRailer floorplan.jpg"),
}
meta = {}
for name, path in PICK.items():
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    meta[name] = {"w": im.width, "h": im.height, "sizes": []}
    for w in (480, 960, 1600):
        if w > im.width and w != 480: continue
        r = im.copy(); r.thumbnail((w, w * 10))
        r.save(os.path.join(OUT, f"{name}-{w}.webp"), "WEBP", quality=78, method=6)
        meta[name]["sizes"].append(w)
    og = im.copy(); og.thumbnail((1200, 1200)); og.save(os.path.join(OUT, f"{name}.jpg"), "JPEG", quality=80, optimize=True)
logo = Image.open(os.path.join(SRC, "Wheelie-Bathrooms_Mobile-Ensuite-Hire.png")).convert("RGBA")
logo.save(os.path.join(OUT, "logo.png"), optimize=True); logo.save(os.path.join(OUT, "logo.webp"), "WEBP", quality=90)
meta["logo"] = {"w": logo.width, "h": logo.height}
json.dump(meta, open(os.path.join(os.path.dirname(__file__), "images.json"), "w"), indent=1)
print(json.dumps({k: (v["w"], v["h"]) for k, v in meta.items()}))
