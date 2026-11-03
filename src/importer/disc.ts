import fs from 'node:fs';

export interface DiscFile { path: string; size: number; read(): Buffer }

interface Layout { stride: number; offset: number }

const SYNC = Buffer.from([0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0]);

function readAt(file: string, buf: Buffer, pos: number) {
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, buf, 0, buf.length, pos); } finally { fs.closeSync(fd); }
  return buf;
}

// .iso images hold the 2048 data bytes of each sector; raw .img/.bin ones the whole
// 2352-byte sector, with the data at 16 (Mode 1) or 24 (Mode 2 Form 1).
function layout(file: string): Layout | null {
  const raw = readAt(file, Buffer.alloc(2352), 16 * 2352);
  if (raw.subarray(0, 12).equals(SYNC)) return { stride: 2352, offset: raw[15] === 2 ? 24 : 16 };
  const iso = readAt(file, Buffer.alloc(6), 16 * 2048);
  return iso.toString('latin1', 1, 6) === 'CD001' ? { stride: 2048, offset: 0 } : null;
}

function sectors(file: string, l: Layout, lba: number, bytes: number) {
  const n = Math.ceil(bytes / 2048);
  const buf = readAt(file, Buffer.alloc(n * l.stride), lba * l.stride);
  if (l.stride === 2048) return buf.subarray(0, bytes);
  const out = Buffer.alloc(bytes);
  for (let i = 0; i < n; ++i) {
    const from = i * l.stride + l.offset;
    buf.copy(out, i * 2048, from, from + Math.min(2048, bytes - i * 2048));
  }
  return out;
}

export function readDisc(file: string): DiscFile[] | null {
  try {
    const l = layout(file);
    if (!l) return null;
    const read = (lba: number, bytes: number) => sectors(file, l, lba, bytes);
    // Joliet keeps the long, mixed-case names; the primary descriptor only has 8.3 ones.
    let desc: Buffer | null = null, joliet = false;
    for (let lba = 16; lba < 32; ++lba) {
      const d = read(lba, 2048);
      if (d.toString('latin1', 1, 6) !== 'CD001' || d[0] === 255) break;
      if (d[0] === 1 && !desc) desc = d;
      if (d[0] === 2 && d[88] === 0x25 && d[89] === 0x2f && [0x40, 0x43, 0x45].includes(d[90])) { desc = d; joliet = true; }
    }
    if (!desc) return null;
    const files: DiscFile[] = [];
    const walk = (lba: number, len: number, dir: string, depth: number) => {
      const d = read(lba, len);
      for (let i = 0; i < d.length;) {
        const n = d[i];
        if (!n) { i = (Math.floor(i / 2048) + 1) * 2048; continue; }
        const extent = d.readUInt32LE(i + 2), size = d.readUInt32LE(i + 10), flags = d[i + 25];
        const id = d.subarray(i + 33, i + 33 + d[i + 32]);
        i += n;
        if (id.length === 1 && id[0] <= 1) continue;
        const name = (joliet ? Buffer.from(id).swap16().toString('utf16le') : id.toString('latin1'))
          .replace(/;\d+$/, '').replace(/\.$/, '');
        const p = dir ? `${dir}/${name}` : name;
        if (!(flags & 2)) files.push({ path: p, size, read: () => read(extent, size) });
        else if (depth < 8) walk(extent, size, p, depth + 1);
      }
    };
    walk(desc.readUInt32LE(158), desc.readUInt32LE(166), '', 0);
    return files;
  } catch {
    return null;
  }
}
