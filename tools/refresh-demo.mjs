/**
 * 演示数据「保鲜」
 *
 * 问题：固定示例病例锚定在**生成当天**，而大屏「24 小时内」表格按 created_at 过滤。
 * 隔几天再打开，表格就是空的（实测 10-08 生成、10-12 打开时为空）。
 *
 * 两种模式：
 *
 *   默认（非破坏性，启动器使用）
 *     只把**未闭环**的那几条病例（也就是示例里展示在 24 小时表格中的那几行）
 *     连同它们的时间节点平移到今天，保持原有的时分秒。
 *     历史数据、你自己在后台录入的病例与配置**完全不动**。
 *
 *   --reseed（破坏性，手动执行）
 *     用同一份种子逻辑按当前日期整库重新生成，恢复成文档里的精确基线
 *     （12 个月 188/362/…/63、累计 2380、24 小时恰好 4 行）。
 *     ⚠ 会清空业务表，手动录入的数据不会保留。
 *
 * 用法：
 *   node tools/refresh-demo.mjs            # 需要时做非破坏性对齐
 *   node tools/refresh-demo.mjs --check    # 只检查（退出码 1 = 需要处理）
 *   node tools/refresh-demo.mjs --reseed   # 恢复文档基线（会清空业务表）
 */
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const DB_FILE = process.env.DB_FILE ?? join(ROOT, 'data', 'hospital.db')
const checkOnly = process.argv.includes('--check')
const reseed = process.argv.includes('--reseed')

const SERVER_DIST = join(ROOT, 'apps', 'server', 'dist')
if (!existsSync(DB_FILE)) {
  console.log('[演示数据] 数据库不存在，稍后由播种步骤创建')
  process.exit(checkOnly ? 1 : 0)
}
if (!existsSync(join(SERVER_DIST, 'db', 'seed.js'))) {
  console.error('[演示数据] 缺少后端编译产物，请先执行：pnpm build')
  process.exit(1)
}

const { Db } = require(join(SERVER_DIST, 'db', 'sqlite.js'))
const db = new Db(DB_FILE)

/* ------------------------------------------------------------ 状态检查 */
const today = db.scalar("SELECT date('now','localtime')")
const openCases = db.all("SELECT id, case_no, created_at FROM green_channel_case WHERE deleted_at IS NULL AND is_closed = 0 ORDER BY created_at")
const inWindow =
  db.scalar("SELECT COUNT(*) FROM green_channel_case WHERE deleted_at IS NULL AND created_at >= datetime('now','localtime','-24 hours')") ?? 0

/** 未闭环病例是否都落在今天 —— 用不变式判断，不依赖“最新日期” */
const staleOpenCases = openCases.filter((c) => String(c.created_at).slice(0, 10) !== today)

if (!reseed) {
  if (!openCases.length) {
    db.close()
    console.log('[演示数据] 没有未闭环病例，无需对齐（如需恢复基线请执行 --reseed）')
    process.exit(checkOnly ? 1 : 0)
  }
  if (!staleOpenCases.length) {
    db.close()
    console.log(`[演示数据] 正常：未闭环 ${openCases.length} 条均在今天，24 小时窗口内 ${inWindow} 条`)
    process.exit(0)
  }
  if (checkOnly) {
    db.close()
    console.log(`[演示数据] 需要对齐：${staleOpenCases.length}/${openCases.length} 条未闭环病例不在今天（24 小时窗口内 ${inWindow} 条）`)
    process.exit(1)
  }
}

/* -------------------------------------------------- 模式一：非破坏性对齐 */
if (!reseed) {
  console.log(`[演示数据] 有 ${staleOpenCases.length} 条未闭环病例不在今天，正在对齐到今天（历史数据不动）`)
  let moved = 0
  db.tx(() => {
    for (const c of staleOpenCases) {
      // 目标时间 = 今天 + 原有的时分秒，delta 以秒为单位（SQLite 接受 'N seconds' 修饰符）
      const original = String(c.created_at)
      const targetStr = `${today} ${original.slice(11)}`
      const deltaSec = Math.round((new Date(targetStr.replace(' ', 'T')).getTime() - new Date(original.replace(' ', 'T')).getTime()) / 1000)
      if (!deltaSec) continue
      const mod = `${deltaSec} seconds`
      db.run(
        `UPDATE green_channel_case SET
           created_at = datetime(created_at, ?),
           updated_at = datetime(updated_at, ?),
           onset_at   = CASE WHEN onset_at   IS NULL THEN NULL ELSE datetime(onset_at, ?)   END,
           arrive_at  = CASE WHEN arrive_at  IS NULL THEN NULL ELSE datetime(arrive_at, ?)  END
         WHERE id = ?`,
        [mod, mod, mod, mod, c.id],
      )
      db.run(
        `UPDATE case_event SET event_at = datetime(event_at, ?), created_at = datetime(created_at, ?) WHERE case_id = ?`,
        [mod, mod, c.id],
      )
      // 病例编号里的日期段同步（LD + YYYYMMDD + 流水）
      db.run(
        `UPDATE green_channel_case SET case_no = 'LD' || replace(substr(created_at,1,10),'-','') || substr(case_no, 11) WHERE id = ?`,
        [c.id],
      )
      moved++
    }
  })
  const after = db.scalar("SELECT COUNT(*) FROM green_channel_case WHERE deleted_at IS NULL AND created_at >= datetime('now','localtime','-24 hours')") ?? 0
  db.close()
  console.log(`[演示数据] 已对齐 ${moved} 条 —— 24 小时窗口内现有 ${after} 条`)
  process.exit(0)
}

/* ------------------------------------------------ 模式二：恢复文档基线 */
console.log('[演示数据] --reseed：按当前日期整库重新生成（会清空业务表）')
const { seed, MONTH_SERIES, CUMULATIVE_TRAUMA } = require(join(SERVER_DIST, 'db', 'seed.js'))
const started = Date.now()
const summary = seed(db)
db.close()
console.log(`[演示数据] 完成：患者 ${summary.patients} / 病例 ${summary.cases} / 时间节点 ${summary.events}，耗时 ${Date.now() - started}ms`)
console.log(`[演示数据] 基线：12 个月 ${MONTH_SERIES.join('/')}，累计创伤 ${CUMULATIVE_TRAUMA}`)
