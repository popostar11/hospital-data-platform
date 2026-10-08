/**
 * 导出下载工具：解析 Content-Disposition 文件名 + 触发浏览器保存。
 */
import { formatDate } from '@hospital/shared'

export function parseFileName(disposition: string | undefined, fallback: string): string {
  if (!disposition) return fallback
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(disposition)
  if (utf8 && utf8[1]) return decodeURIComponent(utf8[1])
  const plain = /filename="?([^";]+)"?/i.exec(disposition)
  return plain && plain[1] ? plain[1] : fallback
}

/** 保存 Blob 到本地 */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/** 形如 急救绿道病例_20260101.xlsx */
export function stampedFileName(prefix: string, ext = 'xlsx'): string {
  return `${prefix}_${formatDate(new Date(), 'YYYYMMDD')}.${ext}`
}

/** Blob 也可能是后端返回的 JSON 错误体，这里做一次兜底探测 */
export async function blobErrorMessage(blob: Blob): Promise<string | null> {
  if (blob.type && !blob.type.includes('json')) return null
  try {
    const text = await blob.text()
    const parsed = JSON.parse(text) as { message?: string }
    return parsed.message ?? null
  } catch {
    return null
  }
}
