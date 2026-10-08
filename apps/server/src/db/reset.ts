import { existsSync, rmSync } from 'node:fs'
import { config } from '../config'
import { runSeedCli } from './seed'

/** 删除数据库文件并重新生成种子数据：pnpm db:reset */
export function runResetCli(): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const file = config.dbFile + suffix
    if (existsSync(file)) rmSync(file, { force: true })
  }
  /* eslint-disable no-console */
  console.log(`已删除旧数据库：${config.dbFile}`)
  /* eslint-enable no-console */
  runSeedCli()
}

if (require.main === module) {
  runResetCli()
}
