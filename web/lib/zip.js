/**
 * 최소 ZIP 리더/라이터 (브라우저·Node 공용, 외부 의존성 없음)
 *
 * hwpx = zip 이므로 템플릿을 풀고 다시 묶는 일이 필요하다.
 * 압축은 표준 CompressionStream('deflate-raw')을 쓰므로 라이브러리가 필요 없다.
 *
 * 주의: hwpx는 `mimetype` 항목이 반드시 첫 번째이고 무압축(STORE)이어야 한다.
 */
(function (root) {
  'use strict';

  // ── CRC32 ────────────────────────────────────────────────────
  let TABLE = null;
  function crcTable() {
    if (TABLE) return TABLE;
    TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABLE[n] = c >>> 0;
    }
    return TABLE;
  }
  function crc32(buf) {
    const t = crcTable();
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  const enc = new TextEncoder();
  const dec = new TextDecoder('utf-8');

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('DecompressionStream 없음 (Node 18+ 또는 최신 브라우저 필요)');
    }
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function deflateRaw(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    const cs = new CompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(cs);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // ── 읽기 ─────────────────────────────────────────────────────
  /** @returns {Promise<Map<string, Uint8Array>>} */
  async function unzip(buf) {
    const b = new Uint8Array(buf);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);

    // End of Central Directory 찾기 (뒤에서부터)
    let eocd = -1;
    for (let i = b.length - 22; i >= 0 && i > b.length - 65558; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('ZIP 형식이 아닙니다 (EOCD 없음)');

    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);

    const out = new Map();
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const cmtLen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));

      // 로컬 헤더에서 실제 데이터 시작 위치 계산
      const lnameLen = dv.getUint16(lho + 26, true);
      const lextraLen = dv.getUint16(lho + 28, true);
      const start = lho + 30 + lnameLen + lextraLen;
      const raw = b.subarray(start, start + csize);

      out.set(name, method === 8 ? await inflateRaw(raw) : raw.slice());
      p += 46 + nameLen + extraLen + cmtLen;
    }
    return out;
  }

  // ── 쓰기 ─────────────────────────────────────────────────────
  /**
   * @param {Array<{name:string,data:Uint8Array|string,store?:boolean}>} entries
   * @returns {Promise<Uint8Array>}
   */
  async function zip(entries) {
    const locals = [];
    const central = [];
    let offset = 0;

    for (const e of entries) {
      const nameBytes = enc.encode(e.name);
      const data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
      const crc = crc32(data);

      let body = data;
      let method = 0;
      if (!e.store) {
        const z = await deflateRaw(data);
        if (z && z.length < data.length) { body = z; method = 8; }
      }

      const lh = new Uint8Array(30 + nameBytes.length);
      const ldv = new DataView(lh.buffer);
      ldv.setUint32(0, 0x04034b50, true);
      ldv.setUint16(4, 20, true);          // version needed
      ldv.setUint16(6, 0x0800, true);      // UTF-8 파일명 플래그
      ldv.setUint16(8, method, true);
      ldv.setUint16(10, 0, true);          // mod time
      ldv.setUint16(12, 0x21, true);       // mod date (1996-01-01)
      ldv.setUint32(14, crc, true);
      ldv.setUint32(18, body.length, true);
      ldv.setUint32(22, data.length, true);
      ldv.setUint16(26, nameBytes.length, true);
      ldv.setUint16(28, 0, true);
      lh.set(nameBytes, 30);

      locals.push(lh, body);

      const ch = new Uint8Array(46 + nameBytes.length);
      const cdv = new DataView(ch.buffer);
      cdv.setUint32(0, 0x02014b50, true);
      cdv.setUint16(4, 20, true);
      cdv.setUint16(6, 20, true);
      cdv.setUint16(8, 0x0800, true);
      cdv.setUint16(10, method, true);
      cdv.setUint16(12, 0, true);
      cdv.setUint16(14, 0x21, true);
      cdv.setUint32(16, crc, true);
      cdv.setUint32(20, body.length, true);
      cdv.setUint32(24, data.length, true);
      cdv.setUint16(28, nameBytes.length, true);
      cdv.setUint32(42, offset, true);
      ch.set(nameBytes, 46);
      central.push(ch);

      offset += lh.length + body.length;
    }

    const cdSize = central.reduce((a, c) => a + c.length, 0);
    const eocd = new Uint8Array(22);
    const edv = new DataView(eocd.buffer);
    edv.setUint32(0, 0x06054b50, true);
    edv.setUint16(8, entries.length, true);
    edv.setUint16(10, entries.length, true);
    edv.setUint32(12, cdSize, true);
    edv.setUint32(16, offset, true);

    const parts = locals.concat(central, [eocd]);
    const total = parts.reduce((a, c) => a + c.length, 0);
    const out = new Uint8Array(total);
    let q = 0;
    for (const part of parts) { out.set(part, q); q += part.length; }
    return out;
  }

  const api = { zip, unzip, crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MiniZip = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
