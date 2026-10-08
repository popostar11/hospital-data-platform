/**
 * 端口占用探测（Windows netstat / *nix lsof），供启动器与停止脚本复用。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 返回监听指定端口的进程 id 列表 */
export function findListeners(port) {
  const pids = new Set()
  if (process.platform === 'win32') {
    const r = spawnSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8', windowsHide: true })
    const text = r.stdout ?? ''
    for (const line of text.split(/\r?\n/)) {
      // 形如：  TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    12345
      const m = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i)
      if (m && Number(m[1]) === Number(port)) pids.add(Number(m[2]))
    }
  } else {
    const r = spawnSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
    for (const line of (r.stdout ?? '').split(/\r?\n/)) {
      const id = Number(line.trim())
      if (Number.isFinite(id) && id > 0) pids.add(id)
    }
  }
  return [...pids]
}

/** 结束整棵进程树（大屏/服务常驻进程往往有子进程） */
export function killTree(pid) {
  if (process.platform === 'win32') {
    return spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).status === 0
  }
  try {
    process.kill(-pid)
    return true
  } catch {
    try {
      process.kill(pid)
      return true
    } catch {
      return false
    }
  }
}

/** 读取项目根目录 .env 里的某个键（没装 dotenv，这里只做最小解析） */
export function readEnvFile(root, key) {
  try {
    const file = join(root, '.env')
    if (!existsSync(file)) return undefined
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
      if (m && m[1].toUpperCase() === key.toUpperCase()) return m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    /* ignore */
  }
  return undefined
}
