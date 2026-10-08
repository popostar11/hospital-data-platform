/**
 * 批处理文件编码守卫（`pnpm verify:bat`）
 *
 * 背景：cmd.exe 按「当前代码页」逐字节解析 .bat，文件里只要出现 UTF-8 中文
 * （**包括 rem 注释**），多字节序列就可能被解码成 & | > 等语法字符，
 * 导致整段脚本被拆成乱码命令。这个坑在本项目里踩过两次，因此固化成检查。
 *
 * 规则：所有 .bat 必须是纯 ASCII；中文提示一律放在被它调用的 Node 脚本里
 * （Node 在 Windows 上通过 WriteConsoleW 输出，编码安全）。
 *
 * 退出码：0 全部合规；1 存在违规文件。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'data', 'logs', 'tu'])

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry.toLowerCase().endsWith('.bat')) out.push(full)
  }
  return out
}

const files = walk(ROOT)
let bad = 0

console.log(`\n【批处理编码检查】共 ${files.length} 个 .bat 文件\n`)

for (const file of files) {
  const buf = readFileSync(file)
  const offenders = []
  let line = 1
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i]
    if (byte === 0x0a) line++
    if (byte > 127) {
      // 记录该行以便定位
      if (!offenders.some((o) => o.line === line)) {
        const text = buf.toString('utf8').split(/\r?\n/)[line - 1] ?? ''
        offenders.push({ line, text: text.trim().slice(0, 70) })
      }
    }
  }
  const rel = relative(ROOT, file)
  if (offenders.length) {
    bad++
    console.log(`  [×] ${rel}`)
    for (const o of offenders) console.log(`      第 ${o.line} 行含非 ASCII 字符：${o.text}`)
  } else {
    console.log(`  [√] ${rel}`)
  }
}

if (bad) {
  console.log(`\n结果：${bad} 个文件不合规。请把其中的中文提示移到 Node 脚本里输出。\n`)
  process.exit(1)
}
console.log('\n结果：全部为纯 ASCII，符合要求。\n')
