# 部署到 Cloudflare（公网演示）

> 目标：把系统发布到**公网可访问的网址**，别人打开链接就能看大屏、登后台。
> 全栈都在 Cloudflare 上：Workers（后端 + 静态资源）+ D1（SQLite 数据库），免费额度足够演示。

---

## 一、为什么不是「打包上传」

本地版后端是 **NestJS + `node:sqlite`**，无法直接在 Cloudflare 上运行：

| 本地依赖 | Cloudflare Workers 的限制 |
|---|---|
| `node:sqlite`（原生 SQLite） | Workers 跑在 V8 隔离环境，**没有 `node:sqlite`** |
| `fs` 读写数据库文件 / 附件目录 / `.env` | 无文件系统（只有绑定的 KV / R2 / D1） |
| `@nestjs/platform-express` + `app.listen()` | 只有 `fetch` 入口，没有官方 NestJS 适配器 |
| `exceljs`（Node 流） | 依赖 Node 流，Workers 里跑不动 |
| 进程内缓存（字典/大屏缓存、登录锁定、SSE Subject） | 每次请求可能是新 isolate，状态不跨请求 |

因此 `apps/worker/` 是**针对 Workers 重写的一层壳**：路由、存储访问、加密与口令校验换成 Workers 原语，
但**业务口径与 SQL 与本地版一一对应**（两个 `db.ts` 刻意保持同名方法，便于对照维护）。

D1 本身就是 SQLite，所以建表语句与绝大多数查询可以原样搬过来。

### 已知差异（均为刻意取舍）

| 能力 | 本地版 | 云端演示版 | 原因 |
|---|---|---|---|
| 导出 | xlsx | **CSV（带 BOM，Excel 可直接打开）** | exceljs 依赖 Node 流 |
| 附件上传 | 本地磁盘 | **未启用**（接口返回明确提示） | Workers 无磁盘；生产可接 R2 |
| 大屏刷新 | SSE 推送 + 轮询兜底 | **仅轮询**（`/screen/stream` 返回 204） | Workers 不适合长连接常驻 |
| 患者明文查看 | 有权限即可看，且留痕 | **关闭**（库中只保留脱敏姓名） | 公网演示不应存在明文 |
| 登录口令哈希 | bcrypt | **PBKDF2-SHA256（WebCrypto）** | bcrypt 是纯 JS，cost=10 约 60ms，超免费版 10ms CPU 配额 |
| 统计快照表 | `stat_daily` 定时汇总 | 实时查询 | D1 里查询足够快，省一张表 |

---

## 二、前置条件

| 项 | 说明 |
|---|---|
| Cloudflare 账号 | 免费版即可（Workers 10 万请求/天、D1 5GB） |
| Node.js | ≥ 20（本地生成种子数据用） |
| wrangler | 已作为 `apps/worker` 的 devDependency 装好，用 `pnpm --filter @hospital/worker exec wrangler` 调用 |

```bash
# 登录 Cloudflare（会打开浏览器授权）
pnpm --filter @hospital/worker exec wrangler login
```

---

## 三、一次性初始化

### 1. 创建 D1 数据库

```bash
pnpm --filter @hospital/worker exec wrangler d1 create hospital_platform
```

命令会返回一段配置，把其中的 `database_id` 填进 `apps/worker/wrangler.toml`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "hospital_platform"
database_id = "在这里填返回的真实 id"   # ← 替换占位值
```

### 2. 写入密钥

```bash
cd apps/worker
pnpm exec wrangler secret put JWT_SECRET     # 登录令牌签名密钥（务必用随机长字符串）
```

> 生成随机密钥的小技巧：`node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"`

### 3. 生成并导入演示数据

种子数据**不在 CI 里生成**（Workers 免费版单请求 CPU 只有 10ms，生成 5000 条病例必然超限），
而是在本地用同一份种子逻辑导出成 SQL：

```bash
# ① 先构建后端（导出脚本要用编译产物里的种子逻辑）
pnpm build

# ② 导出 D1 可导入的 SQL（约 5MB，含建表 + 44320 行数据 + PBKDF2 口令）
node tools/export-d1-seed.mjs

# ③ 导入线上 D1
pnpm --filter @hospital/worker db:remote
```

导入完成后可以核对：

```bash
cd apps/worker
pnpm exec wrangler d1 execute hospital_platform --remote \
  --command="select count(*) from green_channel_case"
```

### 4. 部署

```bash
pnpm build                                  # 构建两个前端
node apps/worker/scripts/build-assets.mjs   # 汇总到 apps/worker/public
pnpm --filter @hospital/worker deploy
```

部署成功后会输出形如 `https://hospital-data-platform.<你的子域>.workers.dev` 的公网地址。

---

## 四、本地预览（不需要 Cloudflare 账号）

```bash
pnpm build
node apps/worker/scripts/build-assets.mjs
node tools/export-d1-seed.mjs
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
cd apps/worker
pnpm exec wrangler d1 execute hospital_platform --local --file=./seed.sql
pnpm exec wrangler dev            # 默认 http://127.0.0.1:8788
```

本地 D1 数据存放在 `apps/worker/.wrangler/state`，与线上库完全隔离。

验证：

```bash
node tools/verify-worker.mjs http://127.0.0.1:8788
```

---

## 五、自动化部署（GitHub Actions）

仓库已包含 `.github/workflows/deploy.yml`：推送到 `main` 后自动「类型检查 → 构建 → 部署」。

在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 里添加两个 secret：

| Secret | 取值 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare 控制台 → My Profile → API Tokens → Create Token，模板选 **Edit Cloudflare Workers** |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 控制台右侧栏的 Account ID（或 `wrangler whoami` 查看） |

> D1 的建表与灌数据**不在 CI 里做**：CI 没有本地数据库文件，且每次部署都灌库会覆盖线上改动。
> 数据只需按「三、3」导入一次。

---

## 六、常用命令

| 命令 | 作用 |
|---|---|
| `pnpm --filter @hospital/worker dev` | 本地启动 Worker（8788 端口） |
| `pnpm --filter @hospital/worker deploy` | 部署到 Cloudflare |
| `pnpm worker:assets` | 汇总两个前端产物到 `apps/worker/public` |
| `pnpm worker:seed` | 导出 D1 种子 SQL |
| `pnpm --filter @hospital/worker db:remote` | 把种子 SQL 导入线上 D1 |
| `pnpm --filter @hospital/worker db:local` | 导入本地 D1 |
| `pnpm verify:worker` | 云端契约验收（33 项，默认打 `http://127.0.0.1:8788`） |
| `pnpm exec wrangler tail` | 实时查看线上日志（在 `apps/worker` 下执行） |

---

## 七、成本与配额

| 项 | 免费额度 | 本项目的占用 |
|---|---|---|
| Workers 请求 | 10 万次/天 | 大屏每次刷新 1 个请求（30 秒一次 → 单屏约 2880 次/天） |
| Workers CPU | 10ms/次 | 接口均为 D1 查询 + 轻量 JSON 组装，实测无超限（重活已挪到本地脚本） |
| D1 存储 | 5GB | 约 5MB |
| D1 行读 | 500 万行/天 | 一次大屏聚合读数千行，余量充足 |

> 若访问量增大导致超限，把 `screen_config.refresh_interval` 调大（如 60 秒）即可线性下降。

---

## 八、故障排查

| 现象 | 处理 |
|---|---|
| `wrangler deploy` 报 database_id 无效 | 把「三、1」返回的真实 id 填进 `wrangler.toml` |
| 页面能开但接口全部 500 | D1 还没建表 → 执行「三、3」的导入步骤；用 `wrangler d1 execute --remote --command="select count(*) from green_channel_case"` 确认 |
| 登录提示账号或密码错误 | 种子数据未导入，或导入的是旧版本（口令哈希格式不同）；重新执行导出与导入 |
| 大屏一直显示「数据重连中…」 | 接口不可达；打开 `/api/v1/screen/bootstrap` 看返回。注意云端没有 SSE，这是正常的（前端会自动轮询） |
| 后台某页报「接口不存在」 | 云端未实现该接口；对照第一节的差异表 |
| 部署后样式/脚本 404 | 忘了执行 `node apps/worker/scripts/build-assets.mjs` |
| 想改端口/域名 | `wrangler.toml` 的 `name` 决定子域前缀；自定义域名在 Cloudflare 控制台 Workers → Settings → Domains 绑定 |

---

## 九、安全须知（公网演示）

1. **务必替换 `JWT_SECRET`**（`wrangler secret put`），不要沿用示例值。
2. 演示账号口令统一为 `Hospital@123`，且登录页直接列出账号——这是**刻意**为演示便利；
   若要长期公开，建议关闭登录页的账号提示并改掉口令。
3. 库中只有**合成的演示数据**，且不保存任何明文身份信息；患者明文查看接口已关闭。
4. `DEMO_MODE=true` 允许大屏匿名只读。若要限制，改为 `false` 并给大屏带 `?token=` 访问。
5. 允许任意来源跨域（CORS `*`）是为便于把大屏嵌入其它页面；如需收紧，改 `apps/worker/src/http.ts` 的 `JSON_CORS`。
6. 接口限流目前**没有做**（Workers 侧需要 Durable Objects 或 KV 计数）；公网演示建议只在分享期开放，
   或套一层 Cloudflare Rate Limiting 规则。
