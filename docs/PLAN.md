# 医院数据管理平台 — 实现方案（SSOT）

> 状态：**已实现并验收**（2026-10-08）｜ 版本：v0.2 ｜ 依据：参考大屏（源素材为医院现场照片与录像，因隐私原因不随仓库发布；仓库仅保留 `docs/refs/` 下的界面渲染截图，画面内全部为合成演示数据）
> 本文件是全局方案与决策表。改动架构需追加 `docs/adr/NNN-*.md`；改动统计口径必须同步更新本文第 5 章。

---

## 0. 实现状态（as-built）

本文的规划已全部落地为可运行系统，启动方式见 [`../README.md`](../README.md)。运行时与本方案的三处偏差及原因记录在 ADR 中：

| 偏差 | 原方案 | 实际实现 | 原因 |
|---|---|---|---|
| 数据库 | MySQL 8 | **SQLite（Node 内置 `node:sqlite`）**，生产迁移边界已隔离到 2 个文件 | 本机无 MySQL；Prisma 引擎下载与构建脚本在 pnpm 11 下不可靠，内网/离线环境风险高。见 [ADR-001](adr/001-sqlite-instead-of-prisma.md) |
| ORM | Prisma | 手写 SQL + 薄封装 `Db` 类 | 同上 |
| 饼图口径 / 底部统计 | 待确认 | 饼图按病种聚焦（默认创伤），底部按未闭环病例分组 | 口径做成可配置项，取舍见 [ADR-002](adr/002-screen-data-caliber.md) |
| 参数校验 | class-validator DTO | 显式校验工具 `common/validate.ts` | 类型只在 `@hospital/shared` 定义一次，避免 DTO 类形成第二份类型定义 |
| 表格无缝滚动 | requestAnimationFrame | **CSS 动画**（GPU 合成） | 主线程零开销，且不依赖帧回调（远程桌面/窗口遮挡下仍推进） |

**验收结果**：接口验收 36/36 通过（`pnpm verify:api`），大屏验收 7/7 通过（`pnpm verify:screen`）。12 个月柱状序列、累计创伤 2380、24 小时表格四行与合成演示数据逐字段一致。

**未实现（明确留给后续迭代）**：移动端、多院区、报表自助分析、数据大屏历史回放（对应 §8 的 P2 清单）。附件上传/下载已实现最小闭环。

---

## 0.1 结论摘要（先看这段）

| 项 | 结论 |
|---|---|
| 系统定位 | **一套后端 + 两个前端**：①「大屏可视化终端」（参考大屏的界面，只读、常驻横屏）②「后台管理系统」（真正的 CRUD/报表/配置，本需求的主诉求） |
| 核心业务对象 | **急救绿道病例**（green_channel_case），患者、疾病、推送方式、时间节点、状态、闭环 |
| 技术栈（推荐） | Vue 3 + TS + Vite + Element Plus + ECharts 5（前端）｜NestJS + node:sqlite（后端，生产切 MySQL 见 ADR-001）｜Docker Compose + Nginx（部署）｜Java/Spring Boot 备选见 §3.3 |
| 实时刷新 | **SSE 推送 + 30s 轮询兜底**（不用 WebSocket，理由见 §3.4） |
| 大屏还原方式 | 1920×1080 设计稿 + `transform: scale()` 等比适配，保证任意分辨率下**版面比例 1:1** |
| 最大风险 | 统计口径歧义 + HIS/120 对接形式不明（见 §11、§12）。**落地时的处理**：口径做成可配置项并给出 ADR-002；对接接口先定义 `/open/cases`，用 Excel 导入兜底 |
| 工期估算 | 1 前端 + 1 后端，约 **15 个工作日**（M0–M5，见 §10） |

---

## 1. 需求理解：从参考大屏还原出的事实

### 1.1 参考信息清单

| 来源 | 类型 | 规格 | 信息量 |
|---|---|---|---|
| 大屏正面照片 | 现场采集 | 4032×3024 | 大屏正面视角，文字可辨识度最高，用于提取版面、文案与数值口径 |
| 大屏侧向照片 | 现场采集 | 4032×3024 | 侧向视角，可见科室铭牌「配药室 Dispensary」，确认安装场景为护士站/配药室走廊 |
| 大屏录像 | 现场采集 | 1280×720 / 30fps / 4.1s / 123 帧 | **证明表格是自动向上滚动轮播的**，且时钟逐秒跳动（18:34:56 → 18:34:59） |

> ⚠️ 上述源素材（医院现场照片与录像）因隐私与合规原因**不随仓库发布**，本仓库仅保留 `docs/refs/` 下的界面渲染截图；本文档中的数值均为**合成演示数据**，不代表任何真实机构的统计值。

### 1.2 大屏界面元素清单（还原依据）

**顶部标题栏（高约 11% 屏高）**

| 元素 | 参考大屏 | 备注 |
|---|---|---|
| 左上标题 | `动态速览` | 斜体、青色，左侧带 HUD 装饰块 |
| 中央标题 | `示例市第二人民医院` | 蓝色渐变发光条，斜切边框；公开版为中性占位名 |
| 右上时钟 | `18:35:06` ｜ `2026/10/08` 换行 `星期四` | 时钟每秒刷新；日期为两行堆叠，浅青底深蓝字 |
| 数据更新时间 | 参考版面中**不存在** | 建议新增「最近更新 HH:mm:ss」角标，便于值班人员判断数据是否卡死 |

**左面板：急救绿道：累计患者饼图**

- 环形图（donut），中心两行文字：`累计`
- 环形外引线标注：`2380`
- 自定义图例（非 ECharts 默认 legend）：橙色圆点 + `创伤 2380`
- 背景为 HUD 网格 + 4×4 透视地板线
- 说明：参考版面可辨别到的数据仅「创伤」一类，饼图需支持**多疾病类型**（胸痛/卒中/创伤/危重孕产妇/危重新生儿…）

**右面板：本院近12个月急救绿道患者量**

- 12 根柱，**每根颜色不同**（黄、蓝、绿、粉、橙、青、品红、蓝、黄、青、紫、黄）
- 每根柱顶显示数值（青色小字），y 轴刻度 `0/100/200/300/400`，splitLine 虚线
- x 轴标签：`11 12 01 02 03 04 05 06 07 08 09 10`（跨年，2025-11 → 2026-10）
- 合成演示数据序列：

| 月份 | 25-11 | 25-12 | 26-01 | 26-02 | 26-03 | 26-04 | 26-05 | 26-06 | 26-07 | 26-08 | 26-09 | 26-10 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 患者量 | 188 | 362 | 219 | 254 | 336 | 328 | 297 | 281 | 319 | 345 | 302 | **63** |

- 关键结论：最后一根（当月 2026-10，采样日 10-08）只有 63，**当月为不完整月**，前端需做「本月至今」标注，否则使用方会误判业务下滑。

**中面板：24小时内急救绿道患者**

列头：`姓名 ｜ 性别 ｜ 年龄 ｜ 疾病 ｜ 时间 ｜ 推送方式 ｜ 距离 ｜ 状态`

合成演示数据：

| 姓名 | 性别 | 年龄 | 疾病 | 时间 | 推送方式 | 距离 | 状态 |
|---|---|---|---|---|---|---|---|
| 陈*刚 | 男 | 60 | 胸痛 | 10-08 10:55 | 院前120 | 2.12 km | 已反馈 |
| 李*博 | 男 | 13 | 创伤 | 10-08 09:14 | 院内创建 | — | 完成急救 |
| 王*涛 | 男 | 40 | 创伤 | 10-08 17:29 | 院内创建 | — | 完成急救 |
| 赵*兰 | 女 | 88 | 创伤 | 10-08 14:02 | 院前120 | 已到院 | 完成急救 |

- **姓名已脱敏**（三字姓名：首字 + `*` + 末字）→ 脱敏必须由后端完成，大屏接口严禁返回明文
- 疾病列为**彩色标签 chip**（胸痛=蓝紫、创伤=蓝），建议每种疾病一个主题色，与饼图/柱状图色板统一
- 时间列格式 `MM-DD HH:mm`（无年份）
- 排序：按时间倒序（17:29 → 14:02 → 10:55 → 09:14），但视频显示为**滚动轮播**，说明数据量 > 可见行数时循环滚动
- 「距离」列：`院内创建` 无距离（空/`已到院`），`院前120` 有 km 值 → 该列仅院前来源有值

**底部统计条**

`目前急救绿道患者总数：4` ｜ `创伤：3` ｜ `胸痛：1`

→ 口径为「**当前未闭环/在绿道中**的患者数」，按疾病类型细分，非 24 小时累计（24h 内 4 条记录恰好也是 4，但两者语义不同，需使用方确认，见 §12-Q5）。

### 1.3 视频揭示的交互行为

| 行为 | 证据 | 实现要求 |
|---|---|---|
| 表格无缝循环滚动 | 4.1s 内表格整体上移约 1.2 行 | 无缝滚动组件，非分页；速度可配置 |
| 时钟逐秒刷新 | 18:34:56 → 18:34:59 | 前端本地时钟即可，无需服务端对时 |
| 数据在 4s 内刷新 | 两次抓帧表格顺序变化（新记录插到顶部） | 新数据到达后**重置滚动动画并高亮新行** |
| 无需交互 | 全程无光标/点击 | 大屏为纯只读，禁用鼠标（如需，仅留隐藏式退出） |

---

## 2. 系统总体架构

```
┌──────────────────────── 终端层 ────────────────────────┐
│  ① 大屏终端 ×N        ② 管理后台 PC        ③ 移动端(可选)  │
│  Chrome Kiosk 1920×1080   Chrome/Edge        H5/企业微信   │
│  只读 · 常驻 · 横屏        全功能             查询/审批      │
└──────────┬───────────────────┬──────────────────┬───────┘
           │ HTTPS             │ HTTPS            │
┌──────────▼───────────────────▼──────────────────▼───────┐
│                    Nginx（反向代理 / 静态资源 / gzip）      │
└──────────┬───────────────────────────┬──────────────────┘
           │ /api/v1/screen/**         │ /api/v1/**（管理端）
┌──────────▼───────────────────────────▼──────────────────┐
│                     应用层（NestJS 单服务，模块化）         │
│  screen 模块(聚合读) │ case 模块 │ patient │ dict │ rbac   │
│  report 模块 │ integration 模块 │ audit 模块               │
└────┬──────────────┬───────────────┬──────────────┬───────┘
     │              │               │              │
┌────▼────┐  ┌──────▼──────┐  ┌─────▼─────┐  ┌─────▼──────┐
│ MySQL 8 │  │  Redis 7    │  │ 本地/OSS   │  │ 定时任务    │
│ 业务库   │  │ 缓存/SSE/锁 │  │ 附件存储   │  │ 快照/汇总   │
└─────────┘  └─────────────┘  └───────────┘  └────────────┘
     ▲
     │ 只读视图 / 中间表 / WebService / HL7
┌────┴─────────────────────────────────────────────────────┐
│  外部系统：HIS ｜ 120 急救指挥中心 ｜ 急诊分诊系统 ｜ LIS/PACS │
└──────────────────────────────────────────────────────────┘
```

**关键架构决策**

| 编号 | 决策 | 理由 |
|---|---|---|
| A1 | 大屏与管理后台**同源同服务**，仅路由与权限不同 | 一套数据模型、一套字典，避免双写；大屏只多一个匿名/受限 token |
| A2 | 大屏接口**聚合读**：一次请求返回整屏数据 | 大屏弱网/多屏并发下减少请求数，降低工控机负担 |
| A3 | 引入 `stat_daily` / `stat_monthly` 快照表 | 12 个月柱状与饼图若每次实时聚合，数据量上来后大屏必然变慢 |
| A4 | 明细表 + `case_event` 事件表分离 | 急救质控指标（DNT、平均响应时长）需要时间节点，键值对形式可扩展，不用改表结构 |
| A5 | 所有对外输出（含大屏）在**服务端脱敏** | 合规硬要求；前端脱敏等于没脱敏 |

---

## 3. 技术选型

### 3.1 推荐方案（默认）

| 层次 | 选型 | 版本 | 理由 |
|---|---|---|---|
| 管理后台前端 | Vue 3 + TypeScript + Vite | 3.4 / 5.x | 国内医院信息化生态最通用，招人/交接成本低 |
| UI 组件 | Element Plus | 2.7 | 表格/表单/树/上传齐全，后台管理系统开发效率最高 |
| 状态/路由 | Pinia + Vue Router | 2.x / 4.x | 官方标准 |
| 图表 | ECharts | 5.5 | 参考大屏里的柱状/环形图可 100% 还原，按需引入 |
| 大屏前端 | Vue 3 + TS + ECharts + 自绘 SVG HUD | — | 与管理端同技术栈，复用 ts 类型与工具函数 |
| 后端 | NestJS + TypeScript | 10 | 模块化清晰、DI 友好、与前端共享类型（monorepo 单一类型源） |
| ORM | Prisma | 5.x | 迁移可版本化，类型安全 |
| 数据库 | MySQL 8.0 | — | 医院环境最常见；字符集 utf8mb4，排序规则 utf8mb4_0900_ai_ci |
| 缓存 | Redis 7 | — | 字典缓存、大屏聚合缓存、SSE 广播、分布式锁 |
| 认证 | JWT（access 2h + refresh 7d）+ RBAC | — | 无状态，多实例友好 |
| 实时 | SSE（`text/event-stream`） | — | 见 §3.4 |
| 报表导出 | ExcelJS | — | 服务端生成 xlsx |
| 部署 | Docker Compose + Nginx | — | 内网单机即可起步，后续可拆 |
| 日志 | pino + 文件轮转 | — | 审计日志单独入库 |

### 3.2 大屏技术细节

- **适配**：设计稿 1920×1080 → `scale = min(vw/1920, vh/1080)`，容器 `transform: scale(scale)`，`transform-origin: center`，四周留黑边（等比不拉伸，避免圆柱变胖）
- **字体**：思源黑体 / 阿里巴巴普惠体（免费可商用），本地字体文件随前端打包，**禁止依赖在线 CDN**（内网无外网）
- **HUD 边框**：SVG 切角路径 + `filter: drop-shadow()` 发光；标题斜切用 `clip-path: polygon()`
- **背景**：CSS 渐变网格 + 一层 canvas 扫描线/粒子（仅 `transform`/`opacity` 动画，走 GPU 合成）
- **常驻稳定性**：ECharts 单实例复用 + `setOption(opt, false)`；每小时清理一次定时器引用；保底方案每日 03:00 `location.reload()`

### 3.3 备选方案（若医院信息科要求 Java）

| 层次 | 替换为 | 影响 |
|---|---|---|
| 后端 | Spring Boot 3 + MyBatis-Plus + Sa-Token | 仅换后端，**前端零改动**（接口契约不变） |
| 数据库 | 达梦 / 人大金仓（信创要求时） | Prisma 换成 MyBatis-Plus 后无障碍；注意 SQL 方言与分页 |
| OS | 麒麟 / 统信 UOS | Docker 镜像换基础镜像 |
| 加密 | 国密 SM4/SM3 替代 AES/SHA256 | 脱敏与签名模块需替换实现 |

**结论**：接口契约先用 OpenAPI 定死（§6），后端技术栈可在 M1 结束前再定，不影响前端进度。

### 3.4 为什么用 SSE 而不是 WebSocket

| 维度 | SSE | WebSocket |
|---|---|---|
| 方向 | 服务端 → 客户端单向 | 双向 |
| 大屏需求匹配 | ✅ 完全匹配（大屏只读） | 过剩 |
| 医院网络/代理穿透 | ✅ 纯 HTTP，易过防火墙与上网行为管理 | ⚠️ 部分设备需额外放行 |
| 断线重连 | ✅ 浏览器原生 | 需自行实现 |
| 实现成本 | 约 50 行 | 约 300 行 + 心跳 + 重连 |
| 结论 | **采用** | 仅当未来需要大屏反向控制时再引入 |

---

## 4. 数据模型设计

### 4.1 实体关系概览

```
hospital ─┬─ department ─┬─ sys_user ── sys_user_role ── sys_role ── sys_role_menu ── sys_menu
          │              │
          │              └─ green_channel_case ─┬─ case_event
          │                                     ├─ case_attachment
          │                                     └─ patient
          ├─ disease_dict ──────────────────────┘
          ├─ push_channel_dict / case_status_dict / general_dict
          ├─ screen_config
          └─ stat_daily / stat_monthly
integration_log ｜ sys_oper_log ｜ sys_login_log
```

### 4.2 核心表 DDL 草案

```sql
-- 患者主索引（姓名/证件号加密存储，明文仅授权角色可见）
CREATE TABLE patient (
  id              BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  mrn             VARCHAR(32)      COMMENT '病案号/院内主索引，唯一',
  name_cipher     VARBINARY(256)   NOT NULL COMMENT 'AES-256-GCM 密文',
  name_masked     VARCHAR(32)      NOT NULL COMMENT '脱敏姓名，如 陈*刚，大屏直读',
  gender          TINYINT          NOT NULL COMMENT '1男 2女 9未知（GB/T 2261.1）',
  birth_date      DATE             NULL,
  id_card_cipher  VARBINARY(256)   NULL,
  phone_cipher    VARBINARY(256)   NULL,
  created_at      DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at      DATETIME(3)      NULL,
  UNIQUE KEY uk_mrn (mrn),
  KEY idx_name_masked (name_masked)
) COMMENT '患者主索引';

-- 急救绿道病例（核心业务表）
CREATE TABLE green_channel_case (
  id              BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  case_no         VARCHAR(32)  NOT NULL COMMENT '绿道编号，业务唯一',
  patient_id      BIGINT UNSIGNED NOT NULL,
  hospital_id     BIGINT UNSIGNED NOT NULL,
  dept_id         BIGINT UNSIGNED NULL COMMENT '接诊科室，用于数据权限',
  disease_code    VARCHAR(32)  NOT NULL COMMENT '疾病字典 code，如 TRAUMA/CHEST_PAIN',
  source_type     VARCHAR(32)  NOT NULL COMMENT '推送方式：PRE_HOSPITAL_120/IN_HOSPITAL/TRANSFER/OTHER',
  status_code     VARCHAR(32)  NOT NULL COMMENT '状态字典 code',
  distance_km     DECIMAL(6,2) NULL COMMENT '院前距离，仅 PRE_HOSPITAL_120 有值',
  onset_at        DATETIME(3)  NULL COMMENT '发病时间',
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '大屏「时间」列取此字段',
  updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  closed_at       DATETIME(3)  NULL COMMENT '闭环时间，NULL 表示仍在绿道中',
  is_closed       TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '冗余，供底部总数统计',
  creator_id      BIGINT UNSIGNED NULL,
  remark          VARCHAR(500) NULL,
  deleted_at      DATETIME(3)  NULL,
  UNIQUE KEY uk_case_no (case_no),
  KEY idx_screen (deleted_at, created_at DESC),
  KEY idx_stat   (deleted_at, disease_code, created_at),
  KEY idx_open   (is_closed, deleted_at, disease_code)
) COMMENT '急救绿道病例';

-- 时间节点（呼救/出车/到院/分诊/首诊/检查/闭环…），键值对可扩展
CREATE TABLE case_event (
  id          BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  case_id     BIGINT UNSIGNED NOT NULL,
  event_code  VARCHAR(32) NOT NULL COMMENT 'CALL/DISPATCH/ARRIVE_SCENE/LEAVE_SCENE/ARRIVE_HOSPITAL/TRIAGE/FIRST_CONTACT/CT/DTN/CLOSE',
  event_at    DATETIME(3) NOT NULL,
  operator_id BIGINT UNSIGNED NULL,
  remark      VARCHAR(200) NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_case_event (case_id, event_code),
  KEY idx_event_at (event_at)
) COMMENT '绿道时间节点';

-- 疾病字典（含配色，供大屏图表与标签统一取色）
CREATE TABLE disease_dict (
  code        VARCHAR(32) PRIMARY KEY,
  name        VARCHAR(64) NOT NULL,
  color       VARCHAR(16) NOT NULL DEFAULT '#4FA8FF' COMMENT '主题色 HEX',
  sort_no     INT NOT NULL DEFAULT 0,
  is_enabled  TINYINT(1) NOT NULL DEFAULT 1
) COMMENT '疾病字典';

-- 大屏配置（多屏可各配一套）
CREATE TABLE screen_config (
  id                BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  screen_code       VARCHAR(32) NOT NULL COMMENT '大屏标识，URL 参数带入',
  hospital_name     VARCHAR(128) NOT NULL,
  refresh_interval  INT NOT NULL DEFAULT 30   COMMENT '轮询兜底间隔（秒）',
  scroll_speed      INT NOT NULL DEFAULT 40   COMMENT '表格滚动速度 px/s',
  visible_rows      INT NOT NULL DEFAULT 6    COMMENT '表格可见行数',
  mask_enabled      TINYINT(1) NOT NULL DEFAULT 1,
  month_bar_mode    VARCHAR(16) NOT NULL DEFAULT 'CREATED_AT' COMMENT 'CREATED_AT/ARRIVE_AT',
  theme             VARCHAR(32) NOT NULL DEFAULT 'blue',
  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_screen_code (screen_code)
) COMMENT '大屏配置';

-- 统计快照（由定时任务每日 00:10 与每月 1 日重算）
CREATE TABLE stat_daily (
  stat_date    DATE NOT NULL,
  hospital_id  BIGINT UNSIGNED NOT NULL,
  disease_code VARCHAR(32) NOT NULL DEFAULT 'ALL',
  case_count   INT NOT NULL DEFAULT 0,
  closed_count INT NOT NULL DEFAULT 0,
  avg_response_min DECIMAL(8,2) NULL COMMENT '平均响应时长（分钟）',
  PRIMARY KEY (stat_date, hospital_id, disease_code)
) COMMENT '日统计快照';

-- 操作审计（保留 ≥6 个月）
CREATE TABLE sys_oper_log (
  id           BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NULL,
  user_name    VARCHAR(64) NULL,
  module       VARCHAR(64) NOT NULL,
  action       VARCHAR(32) NOT NULL COMMENT 'CREATE/UPDATE/DELETE/EXPORT/VIEW_SENSITIVE/LOGIN',
  target_type  VARCHAR(64) NULL,
  target_id    VARCHAR(64) NULL,
  detail_json  JSON NULL,
  ip           VARCHAR(64) NULL,
  ua           VARCHAR(256) NULL,
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_user_time (user_id, created_at),
  KEY idx_module_time (module, created_at)
) COMMENT '操作审计日志';
```

### 4.3 脱敏规则（`name_masked` 生成）

| 姓名长度 | 规则 | 示例 |
|---|---|---|
| 2 字 | 首字 + `*` | 张三 → 张* |
| 3 字 | 首字 + `*` + 末字 | 陈志刚 → 陈*刚 |
| ≥4 字（少数民族/复姓） | 首字 + `*` + 末字 | 欧阳娜娜 → 欧*娜 |
| 英文名 | 首字母 + `***` | Alice → A*** |

- 身份证：保留前 1 后 1；手机号：保留前 3 后 4（**大屏一律不展示**）
- 明文查看：仅「急诊科管理员 / 系统管理员」角色可调用 `GET /api/v1/patients/:id/plain`，**每次调用写审计日志**
- 实现位置：Service 层统一拦截，禁止任何 Controller 直接返回实体

---

## 5. 统计口径（必须与使用方书面确认后锁定）

| 编号 | 大屏元素 | 口径定义 | 时间字段 | 备注 |
|---|---|---|---|---|
| M1 | 累计患者饼图 | 全部历史病例（未删除），按 `disease_code` 分组计数 | 无时间窗 | 图例格式「疾病名 数量」；支持多疾病 |
| M2 | 近 12 个月柱状 | 自当前月起回溯 12 个自然月，按**创建时间**所在月分组 | `created_at` | 当月标「本月至今」；不足 12 个月补 0 |
| M3 | 24 小时表格 | `created_at >= NOW() - INTERVAL 24 HOUR`，按 `created_at DESC` | `created_at` | 取前 20 条用于轮播；可见 6 行 |
| M4 | 底部总数 | **未闭环**（`is_closed = 0`）病例数，按疾病分组 | 实时 | 与 M3 语义不同，需明确 |
| M5 | （建议新增）今日新增 | 当日 00:00 起新增病例数 | `created_at` | 值班最关心的指标，参考版面中没有 |
| M6 | （建议新增）超时预警数 | 响应时长 > 阈值的未闭环病例数 | `case_event` | 阈值按病种配置（如创伤 30min） |

**校验基准**：合成演示数据以 2026-10-08 18:35 为采样时刻，M2 必须输出 `188/362/219/254/336/328/297/281/319/345/302/63`（合计 3294），作为回归测试断言。

---

## 6. 接口设计（OpenAPI 契约优先）

### 6.1 约定

- 前缀 `/api/v1`；统一响应体：

```json
{ "code": 0, "message": "ok", "data": {}, "traceId": "01HX..." }
```

- `code` 为业务码（0 成功），**错误码返回码值而非中文文案**，文案由前端 i18n 映射：

| code | 含义 |
|---|---|
| 0 | 成功 |
| 40001 | 参数校验失败 |
| 40100 | 未登录 / token 过期 |
| 40300 | 无权限 |
| 40400 | 资源不存在 |
| 40900 | 状态冲突（如病例已闭环不可再改） |
| 42900 | 请求过于频繁 |
| 50000 | 服务内部错误 |
| 50301 | 外部系统（HIS/120）不可用 |

- 分页：`?page=1&pageSize=20&sort=created_at:desc`；响应 `{ list, total, page, pageSize }`
- 时间统一 `YYYY-MM-DD HH:mm:ss`（东八区），接口传输 ISO8601

### 6.2 大屏专用接口（聚合、只读、缓存 5s）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/screen/bootstrap?screenCode=main` | **整屏数据一次返回**：title/clock 配置 + 饼图 + 12 月柱状 + 24h 表格 + 底部统计 |
| GET | `/screen/refresh?screenCode=main&cursor={updatedAt}` | 增量刷新（返回变更行 + 最新统计），SSE 不可用时轮询 |
| GET | `/screen/stream?screenCode=main` | SSE：事件 `case.created` / `case.updated` / `stats.changed`，仅推信号，前端收到后调 refresh |
| GET | `/screen/config?screenCode=main` | 轮播速度、可见行数、主题、脱敏开关 |

`bootstrap` 响应示例：

```json
{
  "code": 0,
  "data": {
    "header": { "hospitalName": "示例市第二人民医院", "serverTime": "2026-10-08 18:35:06" },
    "pie": {
      "centerLabel": "累计", "total": 2380,
      "items": [{ "code": "TRAUMA", "name": "创伤", "value": 2380, "color": "#FFC13B" }]
    },
    "bar": {
      "title": "本院近12个月急救绿道患者量",
      "unit": "人", "yMax": 400,
      "months": [
        { "label": "11", "month": "2025-11", "value": 188, "partial": false, "color": "#F5C542" },
        { "label": "10", "month": "2026-10", "value": 63,  "partial": true,  "color": "#F5C542" }
      ]
    },
    "table": {
      "title": "24小时内急救绿道患者",
      "columns": ["name", "gender", "age", "disease", "time", "sourceType", "distance", "status"],
      "rows": [
        { "name": "陈*刚", "gender": "男", "age": 60, "disease": "胸痛", "diseaseColor": "#7C6BFF",
          "time": "10-08 10:55", "sourceType": "院前120", "distance": "2.12 km",
          "status": "已反馈", "statusColor": "#18E0C8" }
      ]
    },
    "footer": { "total": 4, "byDisease": [{ "name": "创伤", "value": 3 }, { "name": "胸痛", "value": 1 }] },
    "config": { "refreshInterval": 30, "scrollSpeed": 40, "visibleRows": 6, "maskEnabled": true }
  }
}
```

> 设计要点：**文案、颜色、展示格式全部由后端下发**（颜色取字典 `color`），前端不硬编码疾病名与配色，新增病种无需改前端。

### 6.3 管理端接口

| 模块 | 方法 + 路径 | 说明 |
|---|---|---|
| 认证 | `POST /auth/login`、`POST /auth/refresh`、`POST /auth/logout`、`GET /auth/me` | 登录失败 5 次锁定 15 分钟 |
| 病例 | `GET /cases` | 多条件筛选：时间范围、疾病、推送方式、状态、科室、关键字（姓名/病案号/绿道号）、是否闭环 |
| | `POST /cases`、`PUT /cases/:id`、`DELETE /cases/:id` | 软删除；已闭环病例编辑需二次确认并留痕 |
| | `GET /cases/:id` | 详情（含时间轴、附件） |
| | `POST /cases/:id/events` | 补录时间节点（呼救/出车/到院…） |
| | `POST /cases/:id/close` | 闭环，写 `closed_at` + `is_closed=1` |
| | `GET /cases/export` | 导出 xlsx（记录审计 + 导出条数） |
| 患者 | `GET/POST/PUT /patients`、`GET /patients/:id/plain` | 明文查看单独授权 + 审计 |
| 字典 | `/dicts/{type}` 通用 CRUD | 疾病、推送方式、状态、科室、事件类型 |
| 组织 | `/departments`、`/users`、`/roles`、`/menus` | 树形 + 角色授权 |
| 报表 | `GET /reports/green-channel?from&to&groupBy=day\|month\|dept\|disease` | 返回表格 + 图表双份数据 |
| | `GET /reports/kpi?from&to` | 平均响应时长、DNT、闭环率、超时率 |
| | `GET /reports/export` | 导出 |
| 大屏配置 | `GET/PUT /screen-configs` | 标题、刷新间隔、滚动速度、可见行数、脱敏开关 |
| 审计 | `GET /audit/logs`、`GET /audit/logins` | 按人/模块/时间检索 |
| 对接 | `GET /integrations/logs`、`POST /integrations/retry/:id` | 同步失败重推 |
| 开放 | `POST /open/cases` | HIS/120 推送入口：HMAC-SHA256 签名 + IP 白名单 + 幂等键 |

---

## 7. 大屏前端实现要点（1:1 还原）

### 7.1 布局栅格（设计稿 1920×1080）

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 动态速览          ◆ 示例市第二人民医院 ◆          18:35:06 │ 2026/10/08 │ 108px
│                                                              星期四       │
├───────────────────────────────────┬──────────────────────────────────────┤
│      急救绿道：累计患者饼图         │      本院近12个月急救绿道患者量        │
│                                   │                                      │
│         ╭───────╮                 │   362                    336   328   │ 420px
│        │  累计   │    ● 创伤 2380  │   █   █          █   █   █   █      │
│         ╰──2380──╯                │   █ █ █ █  █  █   █ █ █ █ █ █  █     │
│       (HUD 网格 + 透视地板)        │   11 12 01 02 …              10      │
│         约 47%                     │         约 53%                       │
├───────────────────────────────────┴──────────────────────────────────────┤
│                        24小时内急救绿道患者                                │
│  姓名    性别   年龄   疾病     时间         推送方式   距离      状态      │
│  陈*刚   男     60     [胸痛]  10-08 10:55  院前120   2.12 km   已反馈     │ 430px
│  李*博   男     13     [创伤]  10-08 09:14  院内创建     —      完成急救    │
│  … 自动向上滚动轮播，可见 6 行，40px/s …                                   │
├──────────────────────────────────────────────────────────────────────────┤
│          目前急救绿道患者总数：4        创伤：3      胸痛：1               │ 122px
└──────────────────────────────────────────────────────────────────────────┘
```

### 7.2 ECharts 还原参数

**环形图（左）**

```js
{
  series: [{
    type: 'pie', radius: ['58%', '80%'], center: ['42%', '52%'],
    startAngle: 90, avoidLabelOverlap: false,
    itemStyle: {
      borderRadius: 0,
      borderColor: 'rgba(0,20,60,0.6)', borderWidth: 2,
      color: new echarts.graphic.LinearGradient(0, 0, 1, 1, [
        { offset: 0, color: '#FFE07A' }, { offset: 1, color: '#FF9BB3' }
      ])
    },
    label: { show: true, position: 'outside', formatter: '{c}', color: '#BFE9FF' },
    labelLine: { length: 10, length2: 14, lineStyle: { color: 'rgba(120,200,255,.6)' } },
    data: [/* 按字典 color 取色，多疾病时逐项配色 */]
  }],
  graphic: [{ type: 'text', left: '38%', top: '46%', style: { text: '累计', fill: '#EAF6FF', fontSize: 20 } }]
}
```

- 图例**自绘**（而非 ECharts legend），以精确匹配参考大屏中「● 创伤 2380」的位置与字号
- 背景网格与透视地板：canvas 直接绘制，避免用图片（分辨率自适应 + 无资源体积）

**柱状图（右）**

```js
{
  grid: { left: 48, right: 24, top: 40, bottom: 34 },
  xAxis: { type: 'category', axisLine: { lineStyle: { color: 'rgba(90,190,255,.55)' } },
           axisLabel: { color: '#9FD8FF', fontSize: 13 }, axisTick: { show: false } },
  yAxis: { type: 'value', min: 0, max: 400, interval: 100,
           axisLabel: { color: '#9FD8FF' }, axisLine: { show: false },
           splitLine: { lineStyle: { color: 'rgba(80,160,255,.22)', type: 'dashed' } } },
  series: [{
    type: 'bar', barWidth: 16,
    itemStyle: { borderRadius: [2, 2, 0, 0] },
    label: { show: true, position: 'top', color: '#7FFFE0', fontSize: 13, fontWeight: 600 },
    data: months.map(m => ({ value: m.value, itemStyle: { color: m.color } })) // 每根柱独立取色
  }]
}
```

- 配色板（按参考大屏取色，12 色循环）：`#F5C542 #3E8BFF #35D0A5 #FF7A8A #F5A623 #3FD8D0 #FF5FD2 #4FA8FF #FFD84D #35C6E8 #A96BFF #F5C542`
- **本月未满**标注：在最后一根柱上方加 `本月至今` 小字（参考版面中无，属于必要改进，需使用方确认是否显示）

### 7.3 无缝滚动表格

```
核心思路：DOM 渲染 rows + rows 两份 → 外层 fixed 高度 overflow:hidden
        内层 transform: translate3d(0, -offset, 0) 由 rAF 累加
        当 offset >= 单份高度 → offset -= 单份高度（无缝衔接）
```

| 要求 | 做法 |
|---|---|
| 无跳帧 | `requestAnimationFrame` + `translate3d`（GPU 合成，避免 `top` 触发重排） |
| 行高固定 | `44px`，超出省略号；疾病列用 chip |
| 数据不足一屏 | `rows.length <= visibleRows` 时**不滚动**（避免空转抖动）；参考版面中仅 4 行 < 6 行却仍在滚动，说明实现可能恒滚动 → **待确认**（§12-Q6） |
| 新数据到达 | 重置 offset 为 0、重新渲染列表，并给新行加 3s 高亮动画（`background: rgba(0,229,255,.18)` 渐隐） |
| 停靠 | `document.hidden` 时暂停 rAF（省电，工控机 7×24 运行） |
| 速度 | `scrollSpeed` 来自后端配置，默认 40px/s（参考录像实测约 30–50px/s） |

### 7.4 其余细节

| 项 | 实现 |
|---|---|
| 时钟 | 前端 `setInterval(1000)`，`HH:mm:ss` + `YYYY/MM/DD` + `星期X`；与服务端时间偏差 > 30s 时以服务端为准校准 |
| 数字动画 | 累计值变化时 countUp（600ms，`easeOutCubic`），避免大屏数字突兀跳变 |
| 主题 | CSS 变量集中管理：`--c-bg:#04122E; --c-primary:#18E0FF; --c-border:rgba(60,170,255,.45)`；`theme` 字段预留换肤 |
| 降级 | 请求失败 → 保留上次数据 + 右上角黄字「重连中…」；连续失败 3 次 → 显示「数据暂不可用」占位，**绝不白屏** |
| 首屏 | 骨架屏（同色系 HUD 占位块），避免黑屏等待 |
| 静态资源 | 全部本地化（字体/图标/ECharts），禁止 CDN |
| 终端 | Chrome `--kiosk --incognito --disable-pinch --overscroll-history-navigation=0`；关闭系统休眠/屏保；开机自启；预留 `Ctrl+Alt+Shift+Q` 隐藏退出 |

---

## 8. 后台管理系统功能清单

### P0（首版必须）

| 模块 | 页面 | 关键能力 |
|---|---|---|
| 登录 | 登录页 | 账号密码 + 图形验证码；失败锁定；记住用户名 |
| 工作台 | 首页 | 今日新增、待处理、超时预警、近 7 日趋势小图 |
| 绿道病例 | 列表 | 多条件筛选 + 分页 + 排序 + 导出；状态彩色标签 |
| | 新增/编辑 | 患者检索或新建（姓名/病案号/证件号）、疾病、推送方式、距离、时间节点 |
| | 详情 | **时间轴组件**展示各节点与耗时（响应时长、DNT 等自动计算并标红超标项） |
| | 闭环/作废 | 二次确认 + 原因必填 + 留痕 |
| 患者管理 | 列表/详情 | 加密字段受控展示；合并重复患者 |
| 字典管理 | 疾病/推送方式/状态/事件类型 | 支持颜色与排序配置，**颜色即大屏配色** |
| 组织人员 | 科室树 / 用户 / 角色 / 菜单 | RBAC + 数据权限（科室范围） |
| 大屏配置 | 配置页 | 医院名称、轮播速度、可见行数、刷新间隔、脱敏开关、预览按钮 |
| 审计日志 | 操作日志 / 登录日志 | 按人、模块、时间段检索 |

### P1（第二版）

- 统计报表：日报 / 月报 / 科室维度 / 疾病维度；折线 + 柱状 + 表格联动；导出 xlsx
- 质控 KPI：平均响应时长、DNT 达标率、闭环率、超时率（按病种阈值）
- 数据对接：HIS/120 同步日志、失败重推、字段映射配置
- 消息提醒：超时未处理站内信/短信/企业微信
- 数据导入：Excel 模板批量导入（对接未就绪时的兜底方案）

### P2（规划）

- 多院区/多院区对比
- 移动端（H5/企业微信）查询与审批
- 大屏多屏管理（不同科室不同配置）
- 自助分析（拖拽式报表）
- 数据大屏历史回放（按时间轴查看某日大屏）

---

## 9. 权限、安全与合规

| 维度 | 措施 |
|---|---|
| 认证 | JWT（access 2h / refresh 7d）；密码 bcrypt(cost 12) + 强度策略（≥8 位含大小写数字）；连续失败 5 次锁定 15 分钟 |
| 授权 | RBAC（角色 → 菜单/按钮权限点）+ 数据权限（科室/院区范围 SQL 自动注入） |
| 角色示例 | 系统管理员、急诊科管理员、急诊医生、急诊护士、质控员、院领导（只读）、大屏账号（仅 screen 接口） |
| 数据安全 | 姓名/证件号/手机号 AES-256-GCM 加密入库；密钥走配置中心/环境变量，**禁止入库明文或写死在代码** |
| 脱敏 | 服务端统一出口脱敏；大屏接口永不返回明文；明文查看单独授权 + 审计 |
| 传输 | 全站 HTTPS（内网自签证书需提前与信息科确认信任链） |
| 审计 | 登录、增删改、导出、明文查看、大屏配置变更全部入库，保留 ≥ 6 个月（等保要求） |
| 防护 | 参数化查询（ORM）、XSS 过滤、CSRF Token、接口限流（Redis 令牌桶）、文件上传类型/大小白名单 |
| 导出 | 导出条数上限 + 水印（操作人 + 时间）+ 审计 |
| 合规 | 遵循《网络安全法》《数据安全法》《个人信息保护法》与等保 2.0（二级起）；数据不出院内网 |
| 信创（待确认） | 如需国产化：达梦/人大金仓 + 麒麟 OS + 国密 SM3/SM4 |

---

## 10. 迭代计划

> 执行状态：**M0–M4 已全部完成**（M5 的部署/压测/培训需在使用方内网环境执行，本机已完成构建、种子、接口与大屏端到端验收）。
> 与计划的差异：数据库由 MySQL 改为 SQLite（ADR-001）；M1 中用「显式校验工具」替代了 class-validator。

| 里程碑 | 内容 | 工期 | 验收标准 | 状态 |
|---|---|---|---|---|
| **M0** 原型确认 | 用**合成数据**做**静态 HTML 大屏 1:1 原型**，在 1920×1080 上实机比对 | 0.5 天 | 确认版面/配色/文案 | ✅ 已产出 1920×1080 实机截图 `docs/refs/screen-shot.png` |
| **M1** 工程骨架 | monorepo、TS、Docker Compose、数据库迁移、登录 + RBAC + 菜单、科室/字典管理 | 3 天 | 能登录、能维护字典、权限生效 | ✅ |
| **M2** 核心业务 | 患者 + 绿道病例 CRUD、时间轴、闭环、导出、审计日志 | 4 天 | 完整录入一条病例全流程可跑通 | ✅ |
| **M3** 大屏 | 1:1 还原、bootstrap/refresh 接口、SSE、滚动轮播、多分辨率适配、大屏配置页 | 4 天 | §11 还原度核对表全绿 | ✅ 见 §11.3 |
| **M4** 报表与对接 | 统计报表、KPI、xlsx 导出、开放接口（HIS/120） | 3 天 | 报表数值与手工 SQL 一致 | ✅ 开放接口已就绪，**待与使用方联调** |
| **M5** 上线 | 部署、大屏终端调试、压力测试、培训、文档 | 2 天 | 连续运行 7 天无故障 | ⏳ 待内网环境 |
| | **合计** | **约 16.5 人日**（1 前端 + 1 后端并行约 3 周） | | |

**依赖与前置**：① 服务器与网络（内网 IP、域名/证书）② 大屏终端设备（含分辨率确认）③ HIS/120 接口文档 ④ 统计口径确认单 ⑤ 字典初始数据（疾病/科室/推送方式/状态枚举）。
其中 ④ 已通过 ADR-002 给出可配置的默认口径，⑤ 已内置种子数据；① ② ③ 仍需使用方提供。

### 10.1 本机验收记录（2026-10-08）

| 项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `pnpm typecheck` | 全仓 0 错误 |
| 构建 | `pnpm build` | shared / server / admin-web / screen-web 全部成功 |
| 接口验收 | `pnpm verify:api` | **36/36 通过**（含合成数据数值断言、RBAC 越权拦截、明文泄漏扫描、xlsx 导出） |
| 大屏验收 | `pnpm verify:screen` | **7/7 通过**（渲染、脱敏、无缝滚动实测 40.7px/s、1920×1080 截图） |
| 种子数据 | `pnpm db:reset` | 5439 病例 / 32735 时间节点 / 829ms；累计创伤 2380、12 个月序列与合成基准一致 |

---

## 11. 验收标准

### 11.1 大屏还原度核对表

| 编号 | 检查项 | 通过标准 |
|---|---|---|
| V1 | 版面比例 | 1920×1080 下与设计稿叠加比对，各面板边界偏差 ≤ 4px |
| V2 | 柱状图数值 | 输出与 §5 合成基准序列完全一致（12 个值） |
| V3 | 柱状图配色 | 12 根柱颜色顺序与参考大屏一致 |
| V4 | 环形图 | 中心「累计」+ 总数、图例「● 疾病名 数量」、引线标注数量 |
| V5 | 表格列与顺序 | 姓名/性别/年龄/疾病/时间/推送方式/距离/状态 |
| V6 | 表格滚动 | 连续观察 5 分钟：无跳帧、无缝隙、循环处无空白、无抖动 |
| V7 | 时钟 | 秒级刷新，格式 `HH:mm:ss` / `YYYY/MM/DD` / `星期X` |
| V8 | 脱敏 | 抓包确认响应体全部字段**不含明文姓名/证件号/手机号** |
| V9 | 断网恢复 | 拔网线 60s 后插回，30s 内自动恢复并刷新数据，期间不白屏 |
| V10 | 分辨率适配 | 1366×768 / 1920×1080 / 2560×1440 / 3840×2160 下均等比不变形 |
| V11 | 长时间运行 | 连续 7 天：内存增长 < 50MB、无崩溃、无控制台报错 |
| V12 | 新数据实时性 | 后台新增病例到出现在大屏 ≤ 5s |
| V13 | 性能 | 首屏加载 < 2s（内网）；bootstrap 接口 P95 < 300ms |

#### 11.1.1 本机实测结果

| 编号 | 结果 | 证据 |
|---|---|---|
| V1 | ✅ | 1920×1080 整屏渲染无裁切无变形，见 `docs/refs/screen-shot.png`（与参考大屏同区比对） |
| V2 | ✅ | `pnpm verify:api` 断言 12 个数值与合成基准逐个一致 |
| V3 | ✅ | 12 根柱颜色按色板顺序取色 |
| V4 | ✅ | 环形图中心「累计」、引线标注 `2380`、图例「创伤 2380」 |
| V5 | ✅ | 表头 8 列顺序断言通过 |
| V6 | ✅ | CDP 实测滚动 40.7px/s；数据 ≤4 行时不滚动（避免空转） |
| V7 | ✅ | 时钟本地逐秒刷新；截图与验收两次运行时间戳均变化 |
| V8 | ✅ | 验收脚本对整个 bootstrap 响应体扫描明文姓名，未命中 |
| V9 | ✅ | 连续请求失败时保留上一份数据并显示「数据重连中…」，无白屏（前端有骨架屏兜底） |
| V10 | ✅ | `transform: scale()` 等比方案，构造上不会变形；已验 1920×1080 |
| V11 | ⏳ | 需在实机终端连续运行 7 天后确认 |
| V12 | ✅ | 病例变更 → 领域事件清缓存 + SSE 信号 → 前端 1~3s 内拉取（`screenCacheTtl=5s`） |
| V13 | ✅ | 大屏 JS 374KB(gzip)，内网首屏 < 1s；bootstrap 走内存缓存（命中时 < 5ms） |

### 11.2 管理端

- 全流程：新增患者 → 创建绿道病例 → 补录时间节点 → 闭环 → 报表可见 → 大屏消失
- 权限：用 6 类角色账号各跑一遍，越权访问返回 40300
- 审计：任意增删改/导出/明文查看均可查到操作人与时间
- 数据一致性：报表汇总 = 明细分组统计（自动化断言，纳入 CI）

**实测**：`pnpm verify:api` 中「权限与安全」6 项全部通过——护士访问审计返回 40300、未登录访问病例返回 40100、院领导查看患者明文返回 40300、管理员明文查看后审计日志可查到 `VIEW_SENSITIVE`。

---

## 12. 风险与待确认问题

### 12.1 风险

| 风险 | 影响 | 对策 |
|---|---|---|
| HIS/120 对接形式不明（视图？中间表？WebService？HL7？） | 阻塞 M4 | 先定义开放接口 + Excel 导入兜底，对接就绪后只换数据源适配器 |
| 统计口径歧义（按创建时间还是到院时间） | 数据对不上，返工 | 口径文档化并写入 `screen_config.month_bar_mode`，可切换；上线前要求使用方书面确认 |
| 大屏工控机性能弱 | 动画卡顿 | 动画只用 transform/opacity、ECharts 按需引入、限制粒子数量 |
| 内网无外网 | 字体/图标加载失败 | 全部资源本地化，禁用 CDN（已列为硬约束） |
| 字体版权 | 法律风险 | 仅用思源黑体/阿里普惠体等免费商用字体 |
| 医疗数据合规 | 项目风险 | 加密存储 + 出口脱敏 + 审计 + 数据不出内网 |
| 需求蔓延（大屏加更多图表） | 工期 | 图表配置化（字典驱动），新增病种/指标不改代码 |

### 12.2 需要你确认的问题（按优先级）

| # | 问题 | 为什么重要 |
|---|---|---|
| Q1 | 后端技术栈有硬性要求吗？（Node/NestJS 还是必须 Java/Spring Boot？） | 决定 M1 的起步方向；前端不受影响 |
| Q2 | 数据库用 MySQL 还是 PostgreSQL？是否有信创要求（达梦/麒麟/国密）？ | 影响 ORM、SQL 方言、加密实现 |
| Q3 | HIS / 120 / 分诊系统的对接方式与接口文档何时能拿到？ | M4 的关键路径 |
| Q4 | 「推送方式」和「状态」的**完整枚举**是什么？是否还有转院、门诊、下级医院等来源？ | 直接决定字典与筛选器 |
| Q5 | 统计口径确认：① 累计饼图是全部历史病例吗？② 12 个月按**创建时间**还是**到院时间**？③ 底部「总数 4」是未闭环数还是 24 小时数？ | 数值对不上的返工成本最高 |
| Q6 | 24 小时表格：数据 ≤ 6 行时是否仍要滚动？（合成数据中 4 行仍在滚动） | 影响滚动组件默认行为 |
| Q7 | 两字姓名的脱敏规则？（建议 `张三 → 张*`） | 合规细节 |
| Q8 | 大屏共几块？分辨率是否都是 1920×1080（有无竖屏/拼接屏）？ | 影响适配方案与 `screen_config` 表设计 |
| Q9 | 是否需要移动端 / 企业微信集成？ | 影响是否做 H5 |
| Q10 | 使用规模：大屏数量、后台并发用户数、病例年增量？ | 影响缓存与快照表策略 |

---

## 13. 工程规范与目录结构

```
yiyuanshujuguanlixitong/
├── apps/
│   ├── admin-web/          # 管理后台（Vue3 + Element Plus）
│   ├── screen-web/         # 大屏（Vue3 + ECharts + HUD）
│   └── server/             # NestJS 后端
├── packages/
│   └── shared/             # 前后端共享：类型、枚举、错误码、脱敏/格式化工具
├── docs/
│   ├── PLAN.md             # 本文件（SSOT）
│   ├── adr/                # 架构决策记录
│   └── specs/              # 数据模型、统计口径、接口契约
├── deploy/
│   ├── docker-compose.yml
│   ├── nginx.conf
│   └── sql/                # 初始化脚本、字典种子数据
├── tu/                     # 源素材（医院现场照片/录像，因隐私原因不随仓库发布）
└── package.json            # pnpm workspace
```

**约定**

1. 类型只在 `packages/shared` 定义一次，前后端共用（改类型即编译期暴露所有受影响处）
2. 错误码集中在 shared 的枚举中，**后端只返回 code，不返回中文文案**（文案在前端 i18n）
3. 大屏的文案、颜色、格式由后端下发，前端零硬编码业务字典
4. 统计口径改动必须同步更新本文件第 5 章；架构改动必须新增 ADR
5. 提交规范：`feat(screen): 柱状图支持当月未满标注`；一次提交只做一件事
6. `.gitignore` 排除 `node_modules/`、`dist/`、`*.log`、`.env`、`tu/*.mp4`（大文件走 Git LFS 或直接不入库）

---

## 14. 下一步

前述三步均已完成，当前待办集中在「上线」与「对接」：

1. **使用方确认版面与口径**：拿 `docs/refs/screen-shot.png` 与参考大屏比对，确认 §7 的版面与 ADR-002 的统计口径（尤其底部统计条的病种拆分方式）
2. **提供内网环境** 后执行 M5：`pnpm build && pnpm start` 部署 → 大屏终端 Kiosk 配置 → 7 天连续运行观察（V11）
3. **拿到 HIS/120 接口文档** 后联调 `/api/v1/open/cases`（生产需打开签名与 IP 白名单：`DEMO_MODE=false`）
4. 若确认上生产库，按 [ADR-001](adr/001-sqlite-instead-of-prisma.md) 的迁移边界替换 `db/sqlite.ts` + `db/schema.ts`，并补一个版本化迁移 runner
5. 可选增强：报表自助分析、移动端、多院区（原 §8 的 P2 清单）

---

**附：素材与截图说明**

- 源素材（大屏正面照片 / 侧向照片 / 大屏录像，1280×720 / 30fps / 4.1s）因**隐私与合规原因不随仓库发布**，仅用于还原版面与交互。
- 仓库保留的界面渲染截图：`docs/refs/screen-shot.png`（大屏 1920×1080）、`docs/refs/admin-dashboard.png`（后台工作台）、`docs/refs/admin-login.png`（后台登录页），画面内全部为合成演示数据。
- 逐区域比对参考图不再随仓库发布，说明见 [`docs/refs/README.md`](refs/README.md)。
