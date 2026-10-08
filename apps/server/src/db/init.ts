import { config } from '../config'
import { SCHEMA_SQL } from './schema'
import { Db } from './sqlite'

/** 仅创建结构（不加数据）：pnpm db:init */
export function runInitCli(): void {
  const db = new Db(config.dbFile)
  db.exec(SCHEMA_SQL)
  db.run('INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)', ['schema_version', '1'])
  db.close()
  /* eslint-disable no-console */
  console.log(`数据库结构已创建：${config.dbFile}`)
  console.log('接下来可执行 `pnpm db:seed` 导入演示数据。')
  /* eslint-enable no-console */
}

if (require.main === module) {
  runInitCli()
}
