/**
 * 更新 GitHub 仓库的 About 信息（描述 / 主页 / 标签）
 *
 * 为什么单独写一个脚本：
 *   GitHub 的 About 描述必须按 UTF-8 提交。用 PowerShell 5.1 的
 *   Invoke-RestMethod 直接传字符串时，请求体会按默认编码发送，
 *   中文会被写成 `?`（本仓库的 About 就这么坏过一次）。
 *   Node 的 fetch 默认按 UTF-8 编码字符串请求体，不会踩这个坑。
 *
 * 用法：
 *   node tools/update-repo-about.mjs [owner/repo]
 * 前置：环境变量里有 GITHUB_TOKEN
 */
const REPO = process.argv[2] ?? 'popostar11/hospital-data-platform'
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? ''

if (!token) {
  console.error('[错误] 未找到 GITHUB_TOKEN 环境变量')
  process.exit(1)
}

const DESCRIPTION =
  '急诊专科中心数据平台（急救绿道）：大屏可视化 + 后台管理 + Cloudflare Workers/D1 公网版。' +
  '双击即用、零配置启动，含 149 项自动化验收。全部为合成的演示数据。'

const HOMEPAGE = 'https://popostar11.github.io/hospital-data-platform/'

const TOPICS = [
  'vue3',
  'typescript',
  'element-plus',
  'echarts',
  'nestjs',
  'sqlite',
  'cloudflare-workers',
  'd1',
  'dashboard',
  'big-screen',
  'healthcare',
  'demo',
]

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'Content-Type': 'application/json; charset=utf-8',
  'User-Agent': 'dsh-agent',
}

async function gh(path, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, { ...init, headers })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* 非 JSON 响应 */
  }
  return { ok: res.ok, status: res.status, json, text }
}

/* ---------------------------------------------------- 1. 描述与主页 */
console.log(`\n【更新仓库 About】${REPO}`)

const patched = await gh(`/repos/${REPO}`, {
  method: 'PATCH',
  // 注意：body 传字符串，由 fetch 按 UTF-8 编码；不要在这里手工编码成 latin1
  body: JSON.stringify({ description: DESCRIPTION, homepage: HOMEPAGE }),
})

if (!patched.ok) {
  console.error(`  ✗ 更新失败：HTTP ${patched.status} ${patched.text.slice(0, 300)}`)
  process.exit(1)
}
console.log('  ✓ 描述与主页已写入')

/* ---------------------------------------------------- 2. 标签 */
const topics = await gh(`/repos/${REPO}/topics`, {
  method: 'PUT',
  body: JSON.stringify({ names: TOPICS }),
})
if (topics.ok) {
  console.log(`  ✓ 标签已写入（${topics.json?.names?.length ?? TOPICS.length} 个）`)
} else {
  console.log(`  ⚠ 标签写入失败：HTTP ${topics.status}（描述已成功，可忽略）`)
}

/* ---------------------------------------------------- 3. 回读校验 */
const back = await gh(`/repos/${REPO}`)
console.log('\n  回读校验：')
console.log(`    description : ${back.json?.description}`)
console.log(`    homepage    : ${back.json?.homepage}`)
console.log(`    topics      : ${(back.json?.topics ?? []).join(', ')}`)

const bad = /\?{2,}/.test(back.json?.description ?? '')
console.log(
  bad
    ? '  ✗ 描述里仍有连续问号，编码没成功'
    : '  ✓ 描述无乱码（没有连续问号）',
)
process.exit(bad ? 1 : 0)
