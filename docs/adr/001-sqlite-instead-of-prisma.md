# ADR-001：数据层采用 Node 内置 `node:sqlite`，而非 Prisma + MySQL

- 状态：已采纳
- 日期：2026-10-08
- 相关：`apps/server/src/db/sqlite.ts`、`apps/server/src/db/schema.ts`

## 背景

`docs/PLAN.md` 原方案定的数据层是 **Prisma + MySQL 8**。实际落地时遇到两个硬约束：

1. **本机没有 MySQL/PostgreSQL**（`Get-Service` 无相关服务，PATH 上只有 sqlite3 CLI）。为了交付“能立刻跑起来”的系统，需要零安装的数据库。
2. **Prisma 的引擎与构建脚本在当前 pnpm 11 环境下不可靠**：实测 `pnpm add prisma @prisma/client` 后，`@prisma/engines` 的 postinstall 被 pnpm 的构建脚本白名单拦下（`ERR_PNPM_IGNORED_BUILDS`），`prisma generate` 因此失败；即使放行，仍需从 `binaries.prisma.sh` 下载约 20MB 查询引擎——在内网/离线环境是一个不可控的失败点。

同时 Node 24 已内置 `node:sqlite`（自 22.5 起提供，24 可直接使用，无需启动参数），实测可用。

## 决策

数据层使用 **Node 内置 `node:sqlite`**（`DatabaseSync`），并自建一个极薄的封装（`Db` 类：`all/get/run/insert/update/tx`）。

- 建表 DDL 集中在 `src/db/schema.ts`（`SCHEMA_SQL`），全部为标准 SQL 子集；
- 时间统一存 `TEXT 'YYYY-MM-DD HH:mm:ss'`（本地时区），可直接字符串比较/排序，月份分组用 `substr(created_at,1,7)`；
- 布尔统一存 `INTEGER 0/1`；JSON 存 `TEXT`；
- 查询语句写在各自模块的 service 里，未引入 ORM。

## 后果

**收益**

- 零原生依赖、零引擎下载：`pnpm install` 后立刻可跑，离线内网同样成立（验收机上从 `pnpm install` 到出数据 < 2 分钟）。
- 无 codegen 步骤，改表结构 → 改 SQL → `pnpm db:reset`，链路最短。
- 单文件数据库（6.7MB / 5439 条病例 + 3.2 万时间节点），备份=复制文件，演示与培训极方便。
- 种子数据生成完全确定性（固定随机种子），任何机器上结果一致，可写回归断言。

**代价与约束**

- 没有 ORM 的类型推导，需要手写 SQL 与行类型（已在各 service 内用 `interface XxxRow` 显式声明，字段用 `AS` 别名对齐驼峰）。
- 没有迁移框架：改用「`schema.ts` 全量 DDL + `db:reset` 重建」。**上线后不可再这样**，需引入版本化迁移（见下）。
- 单写入者模型：`db:reset` 前必须先停服务（文件被占用会 `EPERM`），已在 README 中写明。
- 无连接池/多实例共享，多副本部署不适用。

## 迁移到 MySQL 的边界

已刻意把数据库相关代码收敛到两个文件：

| 文件 | 迁移动作 |
|---|---|
| `src/db/sqlite.ts` | 把 `DatabaseSync` 换成 `mysql2` 连接池，保持 `all/get/run/tx` 四个方法签名不变 |
| `src/db/schema.ts` | `INTEGER PRIMARY KEY AUTOINCREMENT` → `BIGINT AUTO_INCREMENT PRIMARY KEY`；`TEXT` 时间字段 → `DATETIME(3)`；`REAL` → `DECIMAL` |

业务代码（modules/*）里没有 SQLite 方言特性：未用 `datetime('now','localtime')` 以外的 SQLite 函数（唯一一处用于“24 小时内”窗口，MySQL 换成 `NOW() - INTERVAL 24 HOUR`），未用 `INSERT OR REPLACE`（仅 2 处幂等写，可换 `ON DUPLICATE KEY UPDATE`），未用 upsert 语法差异较大的语句。

## 上线前必须补的两件事

1. **版本化迁移**：保留 `schema_meta.schema_version`，新增 `migrations/NNN-*.sql` 与一个极简 runner（记录已执行版本），替代 `db:reset`。
2. **连接与事务**：MySQL 下 `Db.tx()` 需基于连接而非单例；`Db` 需改成从连接池取连接并把连接透传给 `all/run`。
