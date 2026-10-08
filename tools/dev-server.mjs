/**
 * 后端开发运行器：一条命令同时做到「TS 增量编译」+「进程热重启」。
 *
 * 为什么需要它：`tsc --watch` 只编译不运行，`node --watch` 只重启不编译，
 * 两者缺一不可；用一个脚本编排就不必引入 nodemon / concurrently 之类的依赖。
 *
 * 用法：node tools/dev-server.mjs   （即 pnpm dev:server）
 */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// 该脚本由 apps/server 的 dev 脚本调用，cwd 即 apps/server；
// typescript 是子包的 devDependency（pnpm 严格布局下根目录解析不到），因此从 cwd 解析。
const appDir = process.cwd()
let tscJs
try {
  tscJs = createRequire(pathToFileURL(join(appDir, 'package.json'))).resolve('typescript/bin/tsc')
} catch {
  tscJs = join(appDir, 'node_modules', 'typescript', 'bin', 'tsc')
}
if (!existsSync(tscJs)) {
  console.error(`[dev] 找不到 TypeScript：${tscJs}，请先在仓库根执行 pnpm install`)
  process.exit(1)
}

const children = []
const spawnChild = (args) => {
  const child = spawn(process.execPath, args, { stdio: 'inherit' })
  children.push(child)
  return child
}

const shutdown = () => {
  for (const c of children) {
    try {
      c.kill()
    } catch {
      /* ignore */
    }
  }
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

// 1. 先完整编译一次，保证 dist/main.js 存在（否则 node --watch 会直接退出）
console.log('[dev] 首次编译 TypeScript…')
const first = spawn(process.execPath, [tscJs, '-p', 'tsconfig.json'], { stdio: 'inherit' })
const [code] = await once(first, 'exit')
if (code !== 0) {
  console.error('[dev] 首次编译失败，请先修复类型错误')
  process.exit(code ?? 1)
}

// 2. 并行开启增量编译与热重启
console.log('[dev] 启动 tsc --watch 与 node --watch…\n')
spawnChild([tscJs, '-p', 'tsconfig.json', '--watch', '--preserveWatchOutput'])
spawnChild(['--watch', 'dist/main.js'])
