import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { config } from '../config'

/**
 * 敏感字段加密（AES-256-GCM）。
 * 铁律：姓名 / 身份证 / 手机号 只以密文入库，明文仅授权角色按次解密并留痕。
 * 生产若要求国密，替换本文件的 encrypt/decrypt 为 SM4 即可（见 docs/adr）。
 */
const KEY = createHash('sha256').update(config.cryptoKey).digest() // 32 bytes

export function encrypt(plain: string | null | undefined): string | null {
  if (plain === null || plain === undefined || plain === '') return null
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', KEY, iv)
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

export function decrypt(cipherText: string | null | undefined): string | null {
  if (!cipherText) return null
  try {
    const buf = Buffer.from(cipherText, 'base64')
    const iv = buf.subarray(0, 12)
    const tag = buf.subarray(12, 28)
    const data = buf.subarray(28)
    const decipher = createDecipheriv('aes-256-gcm', KEY, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** 用于开放接口签名校验 */
export function hmacLike(text: string, secret: string): string {
  return createHash('sha256').update(`${secret}:${text}`).digest('hex')
}
