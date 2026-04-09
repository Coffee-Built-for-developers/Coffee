# ☕ Coffee — Built for developers.

**Coffee** is a Chrome Extension (Manifest V3) that automatically strips all
metadata (EXIF, GPS, camera data, timestamps) from images **before** they are
uploaded to any website. Your pixels go through. Your privacy data doesn't.

---

## 📁 Project Structure

```
coffee-extension/
│
├── manifest.json                  # MV3 extension config
├── background/
│   └── service-worker.js          # Lifecycle & message handling
├── content/
│   └── content-script.js          # Intercepts all file uploads
├── utils/
│   └── imageProcessor.js          # Canvas-based metadata stripper
├── popup/
│   ├── popup.html                 # UI markup
│   ├── popup.js                   # Popup logic
│   └── popup.css                  # Styles
└── assets/
    └── icons/                     # 16px, 48px, 128px icons
```

---

## 🚀 Installation (Developer Mode)

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `coffee-extension/` folder
5. ☕ Coffee appears in your toolbar

---

## ⚙️ How It Works

### Step 1 – Interception
The content script runs on every page and:
- Attaches a `change` listener (capture phase) to **all** `<input type="file">` elements, including those added dynamically by SPAs.
- Attaches a `drop` listener (capture phase) at the document level to intercept drag-and-drop uploads.
- Uses a `MutationObserver` to catch inputs added after initial page load.

### Step 2 – Processing
When an image file is detected:
1. A `Blob URL` is created from the `File` object.
2. An `<img>` element loads it.
3. The image is drawn onto an `OffscreenCanvas` (falls back to regular `<canvas>`).
4. The canvas exports a **new Blob** via `convertToBlob()` / `toBlob()`.
5. Only raw pixel data is exported — all metadata segments are gone.
6. A **new `File` object** is constructed from the clean Blob, preserving the original filename and `lastModified` date.

### Step 3 – Replacement
- **File inputs**: The cleaned `FileList` is assigned back using `DataTransfer` + `Object.defineProperty`. A synthetic `change`/`input` event is dispatched so framework-based apps (React, Vue) pick up the new value.
- **Drag-and-drop**: The original `drop` event is stopped. A new `DragEvent` with a patched `DataTransfer` (containing clean files) is dispatched on the same target.

---

## 🔐 Permissions Explained

| Permission | Why |
|---|---|
| `activeTab` | Access the currently active tab when the popup is open |
| `scripting` | Programmatic script injection (future use) |
| `storage` | Persist the ON/OFF toggle and clean-count across sessions |
| `host_permissions: <all_urls>` | Inject content script on every site |

---

## 🧪 Testing Checklist

| Site | Upload type | Expected result |
|---|---|---|
| Google Forms | File input | Metadata stripped, upload works |
| Gmail | File input | Metadata stripped, attachment works |
| Twitter/X | File input | Metadata stripped, tweet works |
| Any drag-drop site | Drag-drop | Metadata stripped, drop accepted |

**Verify metadata removal:**
1. Upload an image that has GPS data (taken on phone).
2. Use [exifdata.com](https://exifdata.com) or [Jeffrey's Exif Viewer](https://exifdata.com) on the *received* file.
3. All fields should be empty / absent.

---

## 🗺️ Supported Formats

| Format | Output | Notes |
|---|---|---|
| JPEG / JPG | JPEG (quality 0.92) | Strips all EXIF, GPS, IPTC, XMP, thumbnail |
| PNG | PNG (lossless) | Strips all text chunks, metadata |
| WebP | JPEG (quality 0.92) | Converted to JPEG for maximum compatibility |
| Other | Unchanged | Passed through without modification |

---

## ⚠️ Known Limitations

1. **Canvas fingerprinting** — Canvas `toBlob()` may introduce subtle pixel-level differences due to OS-level font rendering. For photos this is imperceptible; for pixel-perfect screenshots it is not recommended.
2. **Large images** — Images > 20 MP may be slow on low-end hardware. The UI is never blocked (all processing is async) but the upload will be delayed by a few hundred milliseconds.
3. **Browser restrictions** — Content scripts cannot intercept `fetch()` or `XMLHttpRequest` at the binary level. Coffee works at the *file selection* layer, before the upload starts. If a site reads the raw file bytes immediately without a user gesture, it may have already seen the file before Coffee runs.
4. **PDF / non-image files** — Not processed. Only `image/*` MIME types are touched.
5. **Camera/RAW formats** (HEIC, TIFF, CR2) — Not supported by the Canvas API in Chrome. Passed through unchanged.

---

## 🔮 Future Features

| Feature | Notes |
|---|---|
| **Compression slider** | Let the user set JPEG quality in the popup |
| **Per-site rules** | Allowlist sites where metadata should not be stripped |
| **Preview before upload** | Show a "before / after" modal with metadata diff |
| **Auto-rename** | Replace filename-based location hints (e.g. `IMG_1234.jpg` → `photo.jpg`) |
| **HEIC support** | Use a JS HEIC decoder before canvas draw |
| **Worker offloading** | Move canvas processing to a `SharedWorker` for zero main-thread impact |
| **Stats dashboard** | A full-page breakdown of sites and image types cleaned |

---

## 🏗️ Architecture Notes

### Why Canvas and not a WASM EXIF stripper?
Canvas stripping is:
- Zero-dependency (no WASM bundle, no extra network requests)
- Guaranteed complete (you can't accidentally miss a metadata format)
- Natively fast in Chrome (GPU-accelerated path for drawImage)

The downside is that it re-encodes the image. For JPEG this means a generation loss at the encode stage. At quality 0.92 this is invisible to the human eye for virtually all photographic content.

### Why capture phase?
Using `addEventListener(..., true)` (capture phase) ensures Coffee's handler runs *before* any page-level handlers. This is critical because some frameworks read `input.files` synchronously in their own change handler — if we used bubble phase, they'd see the dirty file.

### Why DataTransfer for FileList replacement?
`HTMLInputElement.files` is a read-only `FileList` — you cannot push to it. The only supported way to synthesize a new `FileList` is via `DataTransfer.items.add()`. This is a well-established pattern supported in all modern browsers.
