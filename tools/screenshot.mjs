/**
 * 大屏截图工具（用于验收时与现场照片做 1:1 比对）
 *
 * 用法：
 *   node tools/screenshot.mjs <url> <输出png路径> [宽] [高]
 * 示例：
 *   node tools/screenshot.mjs "http://127.0.0.1:3000/screen/?stream=0" docs/refs/shot.png 1920 1080
 *
 * 说明：
 *   - 大屏页面会建立 SSE 长连接，导致 Chrome 的 --virtual-time-budget 永不推进而挂起，
 *     截图时请在 URL 上带 ?stream=0 关闭推送（轮询仍可用）。
 *   - 使用独立 user-data-dir，避免与用户正在使用的浏览器互相干扰。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
]

const [, , url, outPath, width = '1920', height = '1080'] = process.argv
if (!url || !outPath) {
  console.error('用法: node tools/screenshot.mjs <url> <输出png路径> [宽] [高]')
  process.exit(2)
}

const bin = CANDIDATES.find((p) => existsSync(p))
if (!bin) {
  console.error('未找到 Chrome / Edge，可手动执行浏览器截图')
  process.exit(3)
}

const profile = mkdtempSync(join(tmpdir(), 'hud-shot-'))
const out = resolve(outPath)

const args = [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  `--user-data-dir=${profile}`,
  `--window-size=${width},${height}`,
  '--virtual-time-budget=7000',
  '--timeout=20000',
  `--screenshot=${out}`,
  url,
]

const result = spawnSync(bin, args, { stdio: 'ignore', timeout: 60000 })
rmSync(profile, { recursive: true, force: true })

if (!existsSync(out)) {
  console.error(`截图失败（退出码 ${result.status ?? 'timeout'}）：${out}`)
  process.exit(1)
}
console.log(`截图完成：${out} (${width}x${height})`)
