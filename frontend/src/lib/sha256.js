// پیاده‌سازی خالص SHA-256 و PBKDF2 — برای نسخه پرتیبل بدون نیاز به سرور
// خروجی با بک‌اند هم‌قالب است: base64(salt)$base64(dk)

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const rotr = (x, n) => (x >>> n) | (x << (32 - n))

export function sha256Bytes (bytes) {
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const l = bytes.length
  const blocks = Math.ceil((l + 9) / 64)
  const padded = new Uint8Array(blocks * 64)
  padded.set(bytes)
  padded[l] = 0x80
  const dv = new DataView(padded.buffer)
  dv.setUint32(blocks * 64 - 8, Math.floor(l / 0x20000000))
  dv.setUint32(blocks * 64 - 4, (l << 3) >>> 0)
  const w = new Uint32Array(64)
  for (let i = 0; i < blocks; i++) {
    for (let j = 0; j < 16; j++) w[j] = dv.getUint32(i * 64 + j * 4)
    for (let j = 16; j < 64; j++) {
      const s0 = rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3)
      const s1 = rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10)
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7]
    for (let j = 0; j < 64; j++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + K[j] + w[j]) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) >>> 0
      h = g; g = f; f = e; e = (d + t1) >>> 0
      d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0
  }
  return H
}

export function sha256Hex (str) {
  const bytes = new TextEncoder().encode(str)
  const H = sha256Bytes(bytes)
  return Array.from(H).map(x => x.toString(16).padStart(8, '0')).join('')
}

export function hmacSha256 (key, msg) {
  let k = key
  if (k.length > 64) {
    const H = sha256Bytes(k)
    k = new Uint8Array(32)
    new DataView(k.buffer).setUint32(0, H[0])
    new DataView(k.buffer).setUint32(4, H[1])
    new DataView(k.buffer).setUint32(8, H[2])
    new DataView(k.buffer).setUint32(12, H[3])
    new DataView(k.buffer).setUint32(16, H[4])
    new DataView(k.buffer).setUint32(20, H[5])
    new DataView(k.buffer).setUint32(24, H[6])
    new DataView(k.buffer).setUint32(28, H[7])
  }
  const ipad = new Uint8Array(64)
  const opad = new Uint8Array(64)
  ipad.fill(0x36); opad.fill(0x5c)
  for (let i = 0; i < k.length; i++) {
    ipad[i] ^= k[i]
    opad[i] ^= k[i]
  }
  const inner = new Uint8Array(64 + msg.length)
  inner.set(ipad); inner.set(msg, 64)
  const ih = sha256Bytes(inner)
  const ihBytes = new Uint8Array(32)
  const idv = new DataView(ihBytes.buffer)
  for (let i = 0; i < 8; i++) idv.setUint32(i * 4, ih[i])
  const outer = new Uint8Array(96)
  outer.set(opad); outer.set(ihBytes, 64)
  return sha256Bytes(outer)
}

function wordsToBytes (words) {
  const out = new Uint8Array(words.length * 4)
  const dv = new DataView(out.buffer)
  for (let i = 0; i < words.length; i++) dv.setUint32(i * 4, words[i]) // big-endian استاندارد
  return out
}

export function pbkdf2Sha256 (password, salt, iterations, dkLen = 32) {
  const pwBytes = new TextEncoder().encode(password)
  const blocks = Math.ceil(dkLen / 32)
  const out = new Uint8Array(blocks * 32)
  const saltBytes = typeof salt === 'string' ? new TextEncoder().encode(salt) : salt
  for (let b = 1; b <= blocks; b++) {
    const ib = new Uint8Array(saltBytes.length + 4)
    ib.set(saltBytes)
    ib[saltBytes.length] = (b >>> 24) & 0xff
    ib[saltBytes.length + 1] = (b >>> 16) & 0xff
    ib[saltBytes.length + 2] = (b >>> 8) & 0xff
    ib[saltBytes.length + 3] = b & 0xff
    let u = hmacSha256(pwBytes, ib)
    const t = new Uint32Array(u)
    for (let it = 1; it < iterations; it++) {
      u = hmacSha256(pwBytes, wordsToBytes(u))
      for (let i = 0; i < 8; i++) t[i] ^= u[i]
    }
    out.set(wordsToBytes(t), (b - 1) * 32)
  }
  return out.slice(0, dkLen)
}

function b64encode (bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

function b64decode (str) {
  const s = atob(str)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

const ITER = 12000

export function hashPassword (password, saltBytes = null) {
  const salt = saltBytes || (typeof crypto !== 'undefined' && crypto.getRandomValues
    ? crypto.getRandomValues(new Uint8Array(16))
    : Uint8Array.from({ length: 16 }, () => Math.floor(Math.random() * 256)))
  const dk = pbkdf2Sha256(password, salt, ITER)
  return b64encode(salt) + '$' + b64encode(dk)
}

export function verifyPassword (password, stored) {
  try {
    const [saltB64] = stored.split('$', 1)
    const salt = b64decode(saltB64)
    return hashPassword(password, salt) === stored
  } catch {
    return false
  }
}

export function randomHex (n = 24) {
  const arr = typeof crypto !== 'undefined' && crypto.getRandomValues
    ? crypto.getRandomValues(new Uint8Array(n))
    : Uint8Array.from({ length: n }, () => Math.floor(Math.random() * 256))
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}
