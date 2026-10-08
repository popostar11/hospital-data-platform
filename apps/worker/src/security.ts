/**
 * 安全相关：JWT（HS256）与口令校验（PBKDF2-SHA256）。
 *
 * 为什么不用 bcryptjs：纯 JS 的 bcrypt cost=10 约 60ms CPU，
 * Workers 免费版单请求只有 10ms 配额会直接超限；PBKDF2 走 WebCrypto 原生实现，
 * 不占用 JS CPU 配额，且强度足够。
 */

const encoder = new TextEncoder()

/* ------------------------------------------------------------ base64url */

export function b64urlEncode(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? encoder.encode(input) : input
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function b64urlDecode(input: string): Uint8Array {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4))
  const binary = atob(input.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

export function b64urlDecodeText(input: string): string {
  return new TextDecoder().decode(b64urlDecode(input))
}

/** 定长比较，避免时序侧信道 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}

/* ------------------------------------------------------------------ JWT */

export interface JwtPayload {
  sub: number
  username: string
  realName: string
  deptId: number | null
  roles: string[]
  perms: string[]
  typ: 'access' | 'refresh'
  iat: number
  exp: number
}

const HMAC_PARAMS = { name: 'HMAC', hash: 'SHA-256' } as const

async function getHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), HMAC_PARAMS, false, ['sign', 'verify'])
}

async function sign(data: string, secret: string): Promise<string> {
  const key = await getHmacKey(secret)
  const sig = await crypto.subtle.sign(HMAC_PARAMS, key, encoder.encode(data))
  return b64urlEncode(new Uint8Array(sig))
}

export async function signJwt(
  payload: Omit<JwtPayload, 'iat' | 'exp'>,
  secret: string,
  expiresInSeconds: number,
): Promise<string> {
  const iat = Math.floor(Date.now() / 1000)
  const body: JwtPayload = { ...payload, iat, exp: iat + expiresInSeconds }
  const head = b64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const claims = b64urlEncode(JSON.stringify(body))
  const signature = await sign(`${head}.${claims}`, secret)
  return `${head}.${claims}.${signature}`
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [head, claims, signature] = parts as [string, string, string]
  const expected = await sign(`${head}.${claims}`, secret)
  if (!timingSafeEqual(b64urlDecode(expected), b64urlDecode(signature))) return null
  try {
    const payload = JSON.parse(b64urlDecodeText(claims)) as JwtPayload
    if (payload.exp * 1000 < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

/* --------------------------------------------------------------- 口令 */

const PBKDF2_ITERATIONS_DEFAULT = 100_000

/**
 * 校验 PBKDF2 口令。
 * 存储格式：pbkdf2$sha256$<iterations>$<saltBase64Url>$<hashBase64Url>
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = String(stored ?? '').split('$')
  if (parts.length !== 5 || parts[0] !== 'pbkdf2' || parts[1] !== 'sha256') return false
  const iterations = Number(parts[2]) || PBKDF2_ITERATIONS_DEFAULT
  const salt = b64urlDecode(parts[3]!)
  const expected = b64urlDecode(parts[4]!)
  try {
    const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      keyMaterial,
      expected.length * 8,
    )
    return timingSafeEqual(new Uint8Array(bits), expected)
  } catch {
    return false
  }
}

export function assertPasswordStrength(password: unknown): void {
  const pwd = String(password ?? '')
  if (pwd.length < 8) throw new Error('密码长度至少 8 位')
  if (!/[a-z]/.test(pwd) || !/[A-Z]/.test(pwd) || !/\d/.test(pwd)) {
    throw new Error('密码需同时包含大写字母、小写字母和数字')
  }
}

/** 生成随机口令哈希（用于新建/重置用户，Worker 侧走原生 PBKDF2） */
export async function hashPassword(password: string, iterations = PBKDF2_ITERATIONS_DEFAULT): Promise<string> {
  const salt = new Uint8Array(16)
  crypto.getRandomValues(salt)
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, keyMaterial, 256)
  return `pbkdf2$sha256$${iterations}$${b64urlEncode(salt)}$${b64urlEncode(new Uint8Array(bits))}`
}
