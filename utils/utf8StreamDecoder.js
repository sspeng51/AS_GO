/**
 * Stateful UTF-8 decoder for wx.request chunked responses.
 * Keeps an incomplete multi-byte sequence until the next network chunk.
 */
class Utf8StreamDecoder {
  constructor() {
    this.pending = new Uint8Array(0)
  }

  decode(buffer, final = false) {
    const incoming = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer || 0)
    const bytes = new Uint8Array(this.pending.length + incoming.length)
    bytes.set(this.pending)
    bytes.set(incoming, this.pending.length)
    this.pending = new Uint8Array(0)

    let output = ''
    let i = 0
    while (i < bytes.length) {
      const first = bytes[i]
      let width = 1
      let codePoint = first

      if (first >= 0xC2 && first <= 0xDF) {
        width = 2
        codePoint = first & 0x1F
      } else if (first >= 0xE0 && first <= 0xEF) {
        width = 3
        codePoint = first & 0x0F
      } else if (first >= 0xF0 && first <= 0xF4) {
        width = 4
        codePoint = first & 0x07
      } else if (first >= 0x80) {
        output += '\uFFFD'
        i++
        continue
      }

      if (i + width > bytes.length) {
        if (!final) this.pending = bytes.slice(i)
        else output += '\uFFFD'
        break
      }

      let valid = true
      for (let offset = 1; offset < width; offset++) {
        const continuation = bytes[i + offset]
        if ((continuation & 0xC0) !== 0x80) {
          valid = false
          break
        }
        codePoint = (codePoint << 6) | (continuation & 0x3F)
      }

      const overlong = (width === 2 && codePoint < 0x80) ||
        (width === 3 && codePoint < 0x800) ||
        (width === 4 && codePoint < 0x10000)
      if (!valid || overlong || codePoint > 0x10FFFF || (codePoint >= 0xD800 && codePoint <= 0xDFFF)) {
        output += '\uFFFD'
        i++
        continue
      }

      if (codePoint <= 0xFFFF) {
        output += String.fromCharCode(codePoint)
      } else {
        const adjusted = codePoint - 0x10000
        output += String.fromCharCode(0xD800 + (adjusted >> 10), 0xDC00 + (adjusted & 0x3FF))
      }
      i += width
    }

    return output
  }
}

module.exports = Utf8StreamDecoder
