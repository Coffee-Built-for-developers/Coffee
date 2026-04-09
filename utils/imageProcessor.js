/**
 * Coffee Extension – Image Processor
 * Strips ALL metadata via Canvas API.
 * UPDATED: Returns rich metadata report alongside cleaned file.
 */

'use strict';

const ImageProcessor = (() => {

  const SUPPORTED_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
  const JPEG_QUALITY = 0.92;

  /**
   * Reads EXIF/metadata fields from a file before stripping.
   * Returns a human-readable list of what was found.
   * Uses a lightweight manual JPEG segment parser — no libraries needed.
   */
  async function detectMetadataFields(file) {
    const found = [];
    try {
      const buf = await file.arrayBuffer();
      const view = new DataView(buf);

      if (file.type === 'image/jpeg' || file.type === 'image/jpg') {
        // JPEG starts with FF D8
        if (view.getUint16(0) !== 0xFFD8) return found;

        let offset = 2;
        while (offset < view.byteLength - 2) {
          const marker = view.getUint16(offset);
          offset += 2;

          // APP0 = JFIF, APP1 = EXIF/XMP, APP2 = ICC, APP13 = IPTC/Photoshop
          if (marker === 0xFFE0) { found.push({ tag: 'JFIF', label: 'JFIF header' }); }
          else if (marker === 0xFFE1) {
            // Could be EXIF or XMP
            const segLen = view.getUint16(offset);
            const hdr = String.fromCharCode(
              view.getUint8(offset+2), view.getUint8(offset+3),
              view.getUint8(offset+4), view.getUint8(offset+5)
            );
            if (hdr === 'Exif') {
              found.push({ tag: 'EXIF', label: 'EXIF metadata block' });
              // Parse EXIF IFD for specific fields
              const exifFields = _parseExifFields(view, offset + 2, segLen - 2);
              found.push(...exifFields);
            } else if (hdr.startsWith('http') || hdr === 'http') {
              found.push({ tag: 'XMP', label: 'XMP metadata (Adobe)' });
            } else {
              // Try checking for xpacket
              try {
                const slice = new Uint8Array(buf, offset + 2, Math.min(20, segLen));
                const txt = new TextDecoder().decode(slice);
                if (txt.includes('xpacket') || txt.includes('x:xmpmeta')) {
                  found.push({ tag: 'XMP', label: 'XMP metadata (Adobe)' });
                }
              } catch {}
            }
          }
          else if (marker === 0xFFE2) { found.push({ tag: 'ICC', label: 'ICC color profile' }); }
          else if (marker === 0xFFED) { found.push({ tag: 'IPTC', label: 'IPTC / Photoshop data' }); }
          else if (marker === 0xFFFE) { found.push({ tag: 'COMMENT', label: 'JPEG comment text' }); }
          else if (marker === 0xFFDA) { break; } // Start of scan — done

          // Skip segment
          if (offset + 1 >= view.byteLength) break;
          const segLen = view.getUint16(offset);
          offset += segLen;
        }
      } else if (file.type === 'image/png') {
        // PNG: check for tEXt, iTXt, zTXt, eXIf, gAMA chunks
        if (view.getUint32(0) !== 0x89504E47) return found;
        let offset = 8;
        while (offset + 12 <= view.byteLength) {
          const len  = view.getUint32(offset);
          const type = String.fromCharCode(
            view.getUint8(offset+4), view.getUint8(offset+5),
            view.getUint8(offset+6), view.getUint8(offset+7)
          );
          if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') {
            found.push({ tag: 'TEXT', label: 'Embedded text / comments' });
          } else if (type === 'eXIf') {
            found.push({ tag: 'EXIF', label: 'EXIF metadata block' });
          } else if (type === 'gAMA') {
            found.push({ tag: 'GAMMA', label: 'Gamma correction data' });
          } else if (type === 'sRGB') {
            found.push({ tag: 'sRGB', label: 'sRGB color space info' });
          } else if (type === 'IEND') {
            break;
          }
          offset += 12 + len;
        }
      }
    } catch (e) {
      // Non-critical — return whatever we found
    }

    // Deduplicate by tag
    const seen = new Set();
    return found.filter(f => {
      if (seen.has(f.tag)) return false;
      seen.add(f.tag);
      return true;
    });
  }

  /**
   * Very lightweight EXIF IFD field parser.
   * Only reads tags we care about for the UI.
   */
  function _parseExifFields(view, exifStart, maxLen) {
    const found = [];
    try {
      // Byte order marker at exifStart+6
      const bom = view.getUint16(exifStart + 6);
      const littleEndian = (bom === 0x4949);
      const ifdOffset = view.getUint32(exifStart + 10, littleEndian);
      const ifdAbs = exifStart + 6 + ifdOffset;
      const numEntries = view.getUint16(ifdAbs, littleEndian);

      const TAG_NAMES = {
        0x010F: { tag: 'MAKE',    label: 'Camera make' },
        0x0110: { tag: 'MODEL',   label: 'Camera model' },
        0x0112: { tag: 'ORIENT',  label: 'Orientation' },
        0x013B: { tag: 'ARTIST',  label: 'Artist / author' },
        0x013E: { tag: 'WP',      label: 'White point data' },
        0x8769: { tag: 'EXIFIFD', label: 'EXIF sub-IFD (camera settings)' },
        0x8825: { tag: 'GPS',     label: 'GPS location data' },
        0xA420: { tag: 'IMGUID',  label: 'Unique image ID' },
        0x9003: { tag: 'DATE',    label: 'Date/time photo taken' },
        0x9004: { tag: 'DATEMOD', label: 'Date/time digitized' },
        0x927C: { tag: 'MAKER',   label: 'Maker notes (proprietary)' },
        0x9286: { tag: 'COMMENT', label: 'User comment' },
        0x0213: { tag: 'THUMB',   label: 'Embedded thumbnail' },
      };

      for (let i = 0; i < numEntries && i < 64; i++) {
        const entryOffset = ifdAbs + 2 + i * 12;
        if (entryOffset + 12 > view.byteLength) break;
        const tagId = view.getUint16(entryOffset, littleEndian);
        if (TAG_NAMES[tagId]) {
          found.push(TAG_NAMES[tagId]);
        }
      }
    } catch {}
    return found;
  }

  /**
   * removeMetadata(file) → Promise<{ file, name, originalSize, cleanSize, removedFields }>
   */
  async function removeMetadata(file) {
    if (!file || !(file instanceof File)) return {
      file, name: file?.name, originalSize: 0, cleanSize: 0, removedFields: []
    };

    const type = file.type.toLowerCase();
    const originalSize = file.size;
    const name = file.name;

    // Detect what's in the file BEFORE stripping
    let removedFields = [];
    if (SUPPORTED_TYPES.has(type)) {
      removedFields = await detectMetadataFields(file);
    }

    if (!SUPPORTED_TYPES.has(type)) {
      console.info(`[Coffee] Skipping unsupported type: ${type}`);
      return { file, name, originalSize, cleanSize: originalSize, removedFields: [] };
    }

    try {
      const cleanBlob = await _stripViaCanvas(file);
      const cleanFile = new File([cleanBlob], file.name, {
        type: cleanBlob.type,
        lastModified: file.lastModified,
      });
      console.info(
        `[Coffee] ✓ Cleaned "${file.name}" | ` +
        `${_kb(originalSize)} KB → ${_kb(cleanFile.size)} KB | ` +
        `removed: ${removedFields.map(f => f.tag).join(', ') || 'none found'}`
      );
      return { file: cleanFile, name, originalSize, cleanSize: cleanFile.size, removedFields };
    } catch (err) {
      console.error(`[Coffee] Processing failed for "${file.name}":`, err);
      return { file, name, originalSize, cleanSize: originalSize, removedFields: [] };
    }
  }

  /**
   * removeMetadataFromList(fileList) → Promise<Array<result>>
   */
  async function removeMetadataFromList(fileList) {
    const files = Array.from(fileList);
    return Promise.all(files.map(removeMetadata));
  }

  function _stripViaCanvas(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();

      img.onload = () => {
        URL.revokeObjectURL(url);
        try {
          let canvas, ctx;
          if (typeof OffscreenCanvas !== 'undefined') {
            canvas = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
            ctx = canvas.getContext('2d');
          } else {
            canvas = document.createElement('canvas');
            canvas.width  = img.naturalWidth;
            canvas.height = img.naturalHeight;
            ctx = canvas.getContext('2d');
          }

          ctx.drawImage(img, 0, 0);

          const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
          const quality    = outputType === 'image/jpeg' ? JPEG_QUALITY : undefined;

          if (canvas instanceof OffscreenCanvas) {
            canvas.convertToBlob({ type: outputType, quality }).then(resolve).catch(reject);
          } else {
            canvas.toBlob((blob) => {
              blob ? resolve(blob) : reject(new Error('canvas.toBlob returned null'));
            }, outputType, quality);
          }
        } catch (err) { reject(err); }
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(`Failed to load image: ${file.name}`));
      };

      img.src = url;
    });
  }

  function _kb(bytes) { return (bytes / 1024).toFixed(1); }

  return { removeMetadata, removeMetadataFromList };

})();

window.__coffeeImageProcessor = ImageProcessor;
