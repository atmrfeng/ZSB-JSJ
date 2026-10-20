/**
 * 极简 ZIP 打包（STORE 无压缩，UTF-8 文件名）
 *
 * 用途：种子管理页导出「图片分离」包 —— seed-bank.json + img/ 下的图片文件
 * 打成一个 zip，用户解压后可直接把 seed-bank.json 与 img 文件夹上传到 GitHub。
 *
 * 之所以自己实现：项目只有浏览器环境，不想为一个 zip 引入三方依赖。
 * 图片本身已是 JPEG/PNG（二次压缩收益极低），所以用 STORE 即可，实现最简且最快。
 */

export interface ZipEntry {
  /** zip 内相对路径，如 `img/zhenti/a1b2_1.jpg` */
  name: string
  data: Uint8Array
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[i] = c >>> 0
  }
  return table
})()

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

/** 生成 DOS 时间戳（本地时间），zip 元数据需要 */
function dosStamp(d: Date): { time: number; date: number } {
  const time =
    ((d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)) & 0xffff
  const year = Math.max(1980, d.getFullYear())
  const date = (((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff
  return { time, date }
}

export function createZip(entries: ZipEntry[]): Blob {
  const enc = new TextEncoder()
  const { time, date } = dosStamp(new Date())

  const parts: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name)
    const crc = crc32(entry.data)
    const size = entry.data.length

    // ---- Local file header (30 + name) ----
    const lh = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(lh.buffer)
    lv.setUint32(0, 0x04034b50, true) // signature
    lv.setUint16(4, 20, true) // version needed
    lv.setUint16(6, 0x0800, true) // flags: UTF-8 文件名
    lv.setUint16(8, 0, true) // method: store
    lv.setUint16(10, time, true)
    lv.setUint16(12, date, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, size, true) // compressed size
    lv.setUint32(22, size, true) // uncompressed size
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true) // extra length
    lh.set(nameBytes, 30)
    parts.push(lh, entry.data)

    // ---- Central directory header (46 + name) ----
    const ch = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(ch.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true) // version made by
    cv.setUint16(6, 20, true) // version needed
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, 0, true) // method: store
    cv.setUint16(12, time, true)
    cv.setUint16(14, date, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, size, true)
    cv.setUint32(24, size, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint16(30, 0, true) // extra
    cv.setUint16(32, 0, true) // comment
    cv.setUint16(34, 0, true) // disk number start
    cv.setUint16(36, 0, true) // internal attrs
    cv.setUint32(38, 0, true) // external attrs
    cv.setUint32(42, offset, true) // local header offset
    ch.set(nameBytes, 46)
    centrals.push(ch)

    offset += lh.length + size
  }

  const cdSize = centrals.reduce((s, c) => s + c.length, 0)

  // ---- End of central directory (22) ----
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(4, 0, true) // disk number
  ev.setUint16(6, 0, true) // disk with central dir
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, cdSize, true)
  ev.setUint32(16, offset, true) // central dir offset
  ev.setUint16(20, 0, true) // comment length

  return new Blob([...parts, ...centrals, eocd] as unknown as BlobPart[], {
    type: 'application/zip',
  })
}

/** dataURL → Uint8Array，用于把解析出来的图片写进 zip */
export function dataUrlToBytes(dataUrl: string): { data: Uint8Array; ext: string } {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl)
  if (!m) throw new Error('不是合法的 dataURL')
  const mime = m[1] || 'image/jpeg'
  const isBase64 = !!m[2]
  const payload = m[3]
  let data: Uint8Array
  if (isBase64) {
    const bin = atob(payload)
    data = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i)
  } else {
    data = new TextEncoder().encode(decodeURIComponent(payload))
  }
  const ext =
    mime === 'image/png'
      ? 'png'
      : mime === 'image/gif'
        ? 'gif'
        : mime === 'image/webp'
          ? 'webp'
          : 'jpg'
  return { data, ext }
}

/** 触发浏览器下载 */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 交给浏览器完成下载后再释放
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
