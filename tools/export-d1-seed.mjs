/**
 * 从现有种子逻辑导出 Cloudflare D1 可导入的 SQL
 *
 * 用法：node tools/export-d1-seed.mjs
 * 产物：apps/worker/seed.sql（已在 .gitignore 中，需本地生成）
 *
 * 为什么不把「生成种子数据」放进 Worker：
 *   Workers 免费版单次请求 CPU 上限只有 10ms，生成 5000 条病例 + 3 万时间节点
 *   必然超限。因此改为在本地用同一份种子逻辑跑出一个内存 SQLite，
 *   再导出成 SQL 文件，交给 `wrangler d1 execute --file` 灌库
 *   —— 生成逻辑仍然只有一处（apps/server/src/db/seed.ts）。
 *
 * 顺带做两件适配 Cloudflare 的事：
 *   1. 口令哈希从 bcrypt 换成 PBKDF2-SHA256（Workers 里用 WebCrypto 原生校验，
 *      不占 JS CPU 配额；bcrypt 是纯 JS 实现，cost=10 约 60ms 会超免费版配额）
 *   2. 丢弃 sqlite_sequence / schema_meta 等运行时元数据
 */
import { createRequire } from 'node:module'
import { pbkdf2Sync, randomBytes } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

/* ---------------------------------------------------- 生成内存库（复用现有种子） */
const { Db } = require(join(ROOT, 'apps', 'server', 'dist', 'db', 'sqlite.js'))
const { seed, MONTH_SERIES, CUMULATIVE_TRAUMA } = require(join(ROOT, 'apps', 'server', 'dist', 'db', 'seed.js'))

console.log('正在用现有种子逻辑生成数据（内存 SQLite）…')
const db = new Db(':memory:')
const summary = seed(db)
console.log(`  患者 ${summary.patients} / 病例 ${summary.cases} / 时间节点 ${summary.events}`)
console.log(`  累计创伤 ${summary.traumaTotal} / 未闭环 ${summary.openCount}`)

/* ------------------------------------------------------------ 口令改 PBKDF2 */
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'Hospital@123'
const ITERATIONS = 100_000

function pbkdf2Hash(password) {
  const salt = randomBytes(16)
  const key = pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256')
  return `pbkdf2$sha256$${ITERATIONS}$${salt.toString('base64url')}$${key.toString('base64url')}`
}

const hash = pbkdf2Hash(DEMO_PASSWORD)
db.run('UPDATE sys_user SET password_hash = ?', [hash])
console.log(`  已把 ${summary.users} 个账号的口令哈希改为 PBKDF2-SHA256(${ITERATIONS} 次)`)

/* ------------------------------------------------------------------ 导出 SQL */
const SKIP_TABLES = new Set(['sqlite_sequence', 'schema_meta'])

function quote(value) {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'bigint') return String(value)
  if (value instanceof Uint8Array) {
    return `X'${Buffer.from(value).toString('hex')}'`
  }
  return `'${String(value).replace(/'/g, "''")}'`
}

const objects = db.all(
  "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, rowid",
)
const tables = db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")

const lines = []
lines.push('-- 由 tools/export-d1-seed.mjs 自动生成，请勿手工修改')
lines.push(`-- 生成时间：${new Date().toISOString()}`)
lines.push('-- 内容：建表 + 演示数据（合成数据，不含任何真实机构或患者信息）')
lines.push('PRAGMA foreign_keys = OFF;')
lines.push('')

// 先删后建，保证可重复执行
for (const t of tables) {
  if (SKIP_TABLES.has(t.name)) continue
  lines.push(`DROP TABLE IF EXISTS ${t.name};`)
}
lines.push('')
for (const o of objects) {
  lines.push(`${o.sql};`)
}
lines.push('')

const CHUNK = 50
let rowCount = 0
for (const t of tables) {
  if (SKIP_TABLES.has(t.name)) continue
  const rows = db.all(`SELECT * FROM ${t.name}`)
  if (!rows.length) continue
  const cols = Object.keys(rows[0])
  lines.push(`-- ${t.name}: ${rows.length} 行`)
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK)
    const values = slice.map((r) => `(${cols.map((c) => quote(r[c])).join(',')})`)
    lines.push(`INSERT INTO ${t.name} (${cols.join(',')}) VALUES\n${values.join(',\n')};`)
    rowCount += slice.length
  }
  lines.push('')
}
lines.push('PRAGMA foreign_keys = ON;')
lines.push('')

const outFile = join(ROOT, 'apps', 'worker', 'seed.sql')
mkdirSync(dirname(outFile), { recursive: true })
const sql = lines.join('\n')
writeFileSync(outFile, sql, 'utf8')

db.close()

console.log('')
console.log(`已导出：${outFile}`)
console.log(`  表 ${tables.length - SKIP_TABLES.size} 张 ｜ 数据 ${rowCount} 行 ｜ 文件 ${(Buffer.byteLength(sql) / 1024 / 1024).toFixed(1)} MB`)
console.log(`  演示基线条数：${MONTH_SERIES.length} 个月 ｜ 累计创伤 ${CUMULATIVE_TRAUMA}`)
console.log('')
console.log('导入到 Cloudflare D1：')
console.log('  本地：pnpm --filter @hospital/worker db:local')
console.log('  线上：pnpm --filter @hospital/worker db:remote')
console.log('')
