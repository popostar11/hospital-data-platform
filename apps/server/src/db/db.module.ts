import { Global, Inject, Injectable, Logger, Module, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common'
import { Db } from './sqlite'
import { SCHEMA_SQL } from './schema'
import { config } from '../config'
import { existsSync, mkdirSync } from 'node:fs'

export const DB = Symbol('DB')

/** 全局数据库实例（进程内单例） */
@Injectable()
export class DatabaseHolder implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('Db')
  readonly db: Db

  constructor() {
    mkdirSync(config.dataDir, { recursive: true })
    this.db = new Db(config.dbFile)
  }

  onModuleInit(): void {
    const fresh = !existsSync(config.dbFile)
    this.db.exec(SCHEMA_SQL)
    this.db.run('INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)', ['schema_version', '1'])
    this.logger.log(`SQLite 就绪：${config.dbFile}${fresh ? '（新建）' : ''}`)
    const count = this.db.scalar<number>('SELECT COUNT(*) FROM green_channel_case')
    if (!count) {
      this.logger.warn('数据库为空，请先执行 `pnpm db:seed` 导入种子数据')
    }
  }

  onApplicationShutdown(): void {
    this.db.close()
  }
}

@Global()
@Module({
  providers: [
    DatabaseHolder,
    { provide: DB, useFactory: (holder: DatabaseHolder) => holder.db, inject: [DatabaseHolder] },
  ],
  exports: [DB, DatabaseHolder],
})
export class DbModule {}

/** 注入装饰器糖 */
export const InjectDb = () => Inject(DB)
