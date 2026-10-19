/**
 * 发布静态大屏到 GitHub Pages
 *
 * 用 GitHub Contents API 直接提交文件，**不切换本地分支、不动工作区**，
 * 因此不会把你正在用的代码搞乱。
 *
 * 前置：
 *   1. node tools/export-static-demo.mjs                 （生成快照）
 *   2. PAGES_BASE=/<仓库名>/screen/ pnpm --filter @hospital/screen-web build
 *
 *   注意基准值必须带 /screen/：本脚本把 dist 发布到 gh-pages 的 screen/ 子目录下，
 *   漏掉 /screen/ 会让 index.html 去 /<仓库名>/assets/ 找资源而 404。
 *
 *   3. 环境变量里有 GITHUB_TOKEN（或用参数传）
 *
 * 用法：
 *   node tools/publish-pages.mjs [owner/repo]
 * 默认仓库：popostar11/hospital-data-platform
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, posix } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'apps', 'screen-web', 'dist')
const REPO = process.argv[2] ?? 'popostar11/hospital-data-platform'
const BRANCH = 'gh-pages'
const API = 'https://api.github.com'

const token =
  process.env.GITHUB_TOKEN ??
  process.env.GH_TOKEN ??
  process.env.npm_config_github_token ??
  ''
if (!token) {
  console.error('[错误] 未找到 GITHUB_TOKEN 环境变量')
  process.exit(1)
}

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'dsh-agent',
  'Content-Type': 'application/json',
}

async function gh(path, init = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* 非 JSON */
  }
  return { ok: res.ok, status: res.status, json, text }
}

/* --------------------------------------------------------------- 1. 检查产物 */
if (!existsSync(join(DIST, 'index.html'))) {
  console.error(`[错误] 未找到构建产物：${DIST}`)
  console.error('       请先执行：node tools/export-static-demo.mjs')
  console.error('                 PAGES_BASE=/hospital-data-platform/screen/ pnpm --filter @hospital/screen-web build')
  process.exit(1)
}
if (!existsSync(join(DIST, 'demo-screen.json'))) {
  console.error('[错误] 缺少静态快照 demo-screen.json')
  console.error('       请先执行：node tools/export-static-demo.mjs')
  process.exit(1)
}

/** 递归收集文件（相对路径统一用 / 分隔） */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const files = walk(DIST)
console.log(`\n【发布到 GitHub Pages】${REPO} 分支 ${BRANCH}`)
console.log(`  构建产物：${files.length} 个文件`)

/* --------------------------------------------------- 2. 确保分支存在 */
const repoInfo = await gh(`/repos/${REPO}`)
if (!repoInfo.ok) {
  console.error(`  无法访问仓库 ${REPO}：HTTP ${repoInfo.status}`)
  process.exit(1)
}
console.log(`  仓库可见性：${repoInfo.json.visibility}`)

const refRes = await gh(`/repos/${REPO}/git/ref/heads/${BRANCH}`)
let parentSha = null
if (refRes.ok) {
  parentSha = refRes.json.object.sha
  console.log(`  分支已存在，将覆盖更新（当前提交 ${parentSha.slice(0, 7)}）`)
} else {
  const mainRef = await gh(`/repos/${REPO}/git/ref/heads/${repoInfo.json.default_branch}`)
  if (!mainRef.ok) {
    console.error('  无法读取默认分支，无法创建 gh-pages')
    process.exit(1)
  }
  const created = await gh(`/repos/${REPO}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${BRANCH}`, sha: mainRef.json.object.sha }),
  })
  if (!created.ok) {
    console.error(`  创建分支失败：HTTP ${created.status} ${created.text.slice(0, 200)}`)
    process.exit(1)
  }
  parentSha = created.json.object.sha
  console.log(`  已创建分支 ${BRANCH}`)
}

/* ------------------------------------- 3. 构建 tree 并提交（一次 API 调用一个文件） */
const tree = []
for (const file of files) {
  const repoPath = posix.join('screen', relative(DIST, file).split(/[\\/]/).join('/'))
  const content = readFileSync(file).toString('base64')
  const blob = await gh(`/repos/${REPO}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({ content, encoding: 'base64' }),
  })
  if (!blob.ok) {
    console.error(`  上传失败 ${repoPath}：HTTP ${blob.status}`)
    process.exit(1)
  }
  tree.push({ path: repoPath, mode: '100644', type: 'blob', sha: blob.json.sha })
}

// .nojekyll：避免 GitHub Pages 用 Jekyll 处理以 _ 开头的资源
const nojekyll = await gh(`/repos/${REPO}/git/blobs`, {
  method: 'POST',
  body: JSON.stringify({ content: Buffer.from('').toString('base64'), encoding: 'base64' }),
})
tree.push({ path: '.nojekyll', mode: '100644', type: 'blob', sha: nojekyll.json.sha })

// 首页：给访问者一个入口
const landing = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>医院数据管理平台 · 静态演示</title>
<style>
 body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
   background:radial-gradient(1200px 600px at 50% 0%,#0b2a52,#041226 60%,#020a16);color:#dbeaff;
   font-family:"Microsoft YaHei","PingFang SC",system-ui,sans-serif;padding:24px;text-align:center}
 h1{font-size:24px;color:#7fd9ff;margin:0 0 6px;letter-spacing:2px}
 .sub{color:#7f9dc4;font-size:13px;margin-bottom:28px}
 a.card{display:block;width:320px;max-width:90vw;margin:0 auto;padding:22px;border-radius:14px;text-decoration:none;
   color:#dbeaff;background:linear-gradient(160deg,rgba(20,64,116,.85),rgba(8,26,52,.9));
   border:1px solid rgba(60,170,255,.35);transition:.2s}
 a.card:hover{transform:translateY(-4px);border-color:rgba(24,224,255,.8)}
 .card h2{margin:0 0 8px;font-size:17px;color:#9fe6ff}
 .card p{margin:0;font-size:12px;line-height:1.7;color:#8fb0d6}
 footer{margin-top:30px;font-size:12px;color:#5d7ba3;line-height:1.9;max-width:560px}
 code{background:rgba(255,255,255,.08);padding:1px 5px;border-radius:3px}
</style></head>
<body>
  <h1>医院数据管理平台</h1>
  <div class="sub">示例市第二人民医院 · 急救绿道 · 静态演示</div>
  <a class="card" href="./screen/">
    <h2>大屏可视化终端</h2>
    <p>1920×1080 横屏版面；本页使用导出的静态快照数据，无需后端</p>
    <p style="margin-top:10px;color:#18e0ff">进入大屏 →</p>
  </a>
  <footer>
    本站为 GitHub Pages 纯静态演示，只有大屏部分（数据为导出的快照）。<br/>
    完整的后台管理系统（登录、病例增删改、报表导出）需要后端，请在本地运行：
    <code>启动.bat</code>，然后访问 <code>http://127.0.0.1:3000/admin/</code><br/>
    全部数据为合成的示例数据，不代表任何真实机构或真实统计结果。
  </footer>
</body></html>`
const landingBlob = await gh(`/repos/${REPO}/git/blobs`, {
  method: 'POST',
  body: JSON.stringify({ content: Buffer.from(landing, 'utf8').toString('base64'), encoding: 'base64' }),
})
tree.push({ path: 'index.html', mode: '100644', type: 'blob', sha: landingBlob.json.sha })

const treeRes = await gh(`/repos/${REPO}/git/trees`, {
  method: 'POST',
  body: JSON.stringify({ tree }),
})
if (!treeRes.ok) {
  console.error(`  创建 tree 失败：HTTP ${treeRes.status} ${treeRes.text.slice(0, 200)}`)
  process.exit(1)
}

const commitRes = await gh(`/repos/${REPO}/git/commits`, {
  method: 'POST',
  body: JSON.stringify({
    message: `chore(pages): 发布静态大屏演示（${files.length} 个文件）\n\n由 tools/publish-pages.mjs 自动生成；数据为合成的示例快照。`,
    tree: treeRes.json.sha,
    parents: [parentSha],
  }),
})
if (!commitRes.ok) {
  console.error(`  创建提交失败：HTTP ${commitRes.status} ${commitRes.text.slice(0, 200)}`)
  process.exit(1)
}

const updateRes = await gh(`/repos/${REPO}/git/refs/heads/${BRANCH}`, {
  method: 'PATCH',
  body: JSON.stringify({ sha: commitRes.json.sha, force: true }),
})
if (!updateRes.ok) {
  console.error(`  更新分支失败：HTTP ${updateRes.status} ${updateRes.text.slice(0, 200)}`)
  process.exit(1)
}
console.log(`  已提交：${commitRes.json.sha.slice(0, 7)}`)

/* --------------------------------------------------------- 4. 开启 Pages */
const pagesRes = await gh(`/repos/${REPO}/pages`, {
  method: 'POST',
  body: JSON.stringify({ source: { branch: BRANCH, path: '/' } }),
})
if (pagesRes.ok) {
  console.log('  已启用 GitHub Pages')
} else if (pagesRes.status === 409) {
  const upd = await gh(`/repos/${REPO}/pages`, {
    method: 'PUT',
    body: JSON.stringify({ source: { branch: BRANCH, path: '/' } }),
  })
  console.log(upd.ok ? '  Pages 已更新为 gh-pages 分支' : `  Pages 配置更新失败：HTTP ${upd.status}`)
} else {
  console.log(`  Pages 启用返回 HTTP ${pagesRes.status}：${pagesRes.text.slice(0, 200)}`)
  console.log('  可在仓库 Settings → Pages 手动选择 gh-pages 分支')
}

const info = await gh(`/repos/${REPO}/pages`)
const url = info.json?.html_url ?? `https://${REPO.split('/')[0]}.github.io/${REPO.split('/')[1]}/`
console.log()
console.log('='.repeat(60))
console.log(`  公网地址：${url}`)
console.log(`  大屏直达：${url}screen/`)
console.log('='.repeat(60))
console.log('  首次启用需要 1~2 分钟构建，稍等片刻再打开。')
console.log()
