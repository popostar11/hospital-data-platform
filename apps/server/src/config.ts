import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * 运行配置。全部可用环境变量覆盖，便于内网部署时不改代码。
 * 注意：DB 目录按 __dirname 反推项目根，不受启动 cwd 影响。
 */
const ROOT = path.resolve(__dirname, '../../..')

/**
 * 加载项目根目录的 .env（存在才读；不存在则全部走默认值）。
 * 用 Node 内置的 process.loadEnvFile，不必为读一个配置文件引入 dotenv 依赖。
 * 优先级：真实环境变量 > .env > 代码默认值（loadEnvFile 不覆盖已存在的变量）。
 */
const ENV_FILE = path.join(ROOT, '.env')
if (fs.existsSync(ENV_FILE)) {
  try {
    process.loadEnvFile(ENV_FILE)
  } catch (e) {
    // 配置写错不应该导致服务起不来，降级为告警
    console.warn(`[config] .env 解析失败，已忽略：${(e as Error).message}`)
  }
}

const parseBool = (v: string | undefined, def: boolean) => (v === undefined ? def : /^(1|true|yes)$/i.test(v))
const parseIntSafe = (v: string | undefined, def: number) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def
}

export const config = {
  /** 项目根目录 */
  root: ROOT,
  /** 运行时数据目录（sqlite 文件、上传附件） */
  dataDir: process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data'),
  /** sqlite 数据库文件 */
  dbFile: process.env.DB_FILE ? path.resolve(process.env.DB_FILE) : path.join(ROOT, 'data', 'hospital.db'),
  /** 附件目录 */
  uploadDir: path.join(ROOT, 'data', 'uploads'),
  /** 前端构建产物目录（用于一体化部署） */
  webRoot: path.join(ROOT, 'apps'),

  port: parseIntSafe(process.env.PORT, 3000),
  host: process.env.HOST ?? '0.0.0.0',

  jwtSecret: process.env.JWT_SECRET ?? 'hospital-platform-dev-secret-change-me',
  /** 访问令牌有效期（秒） */
  jwtExpiresIn: parseIntSafe(process.env.JWT_EXPIRES_IN, 2 * 60 * 60),
  /** 刷新令牌有效期（秒） */
  refreshExpiresIn: parseIntSafe(process.env.REFRESH_EXPIRES_IN, 7 * 24 * 60 * 60),

  /** 敏感字段加密主密钥（生产必须替换，建议走配置中心） */
  cryptoKey: process.env.CRYPTO_KEY ?? 'hospital-platform-dev-crypto-key-change-me',

  /** 大屏聚合数据缓存时长（秒） */
  screenCacheTtl: parseIntSafe(process.env.SCREEN_CACHE_TTL, 5),
  /** 登录失败锁定阈值与锁定时长（分钟） */
  loginMaxFail: parseIntSafe(process.env.LOGIN_MAX_FAIL, 5),
  loginLockMinutes: parseIntSafe(process.env.LOGIN_LOCK_MINUTES, 15),

  /** 演示模式：允许大屏匿名访问 / 开放接口免签名 */
  demoMode: parseBool(process.env.DEMO_MODE, true),
  /** 登录图形验证码（默认关闭，便于内网演示） */
  captchaEnabled: parseBool(process.env.CAPTCHA_ENABLED, false),
  /** 大屏 24 小时表格最多返回条数 */
  screenTableLimit: parseIntSafe(process.env.SCREEN_TABLE_LIMIT, 20),
}

export type AppConfig = typeof config
