/**
 * 数据库结构（SQLite 方言，标准 SQL 子集）。
 *
 * 时间统一存 TEXT 'YYYY-MM-DD HH:mm:ss'（本地时区），可直接做字符串比较与排序，
 * 月份分组用 substr(created_at,1,7)、日分组用 substr(created_at,1,10)。
 * 布尔统一存 INTEGER 0/1。JSON 存 TEXT。
 *
 * 生产迁移到 MySQL 时：INTEGER PRIMARY KEY AUTOINCREMENT → BIGINT AUTO_INCREMENT PRIMARY KEY，
 * TEXT 时间字段 → DATETIME(3)，其余语句可直接复用。
 */
export const SCHEMA_SQL = /* sql */ `
/* ------------------------------------------------------------- 组织与人员 */
CREATE TABLE IF NOT EXISTS department (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id   INTEGER,
  code        TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  sort_no     INTEGER NOT NULL DEFAULT 0,
  enabled     INTEGER NOT NULL DEFAULT 1,
  remark      TEXT,
  created_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS role (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  perms       TEXT    NOT NULL DEFAULT '[]',
  remark      TEXT,
  created_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS sys_user (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  real_name     TEXT    NOT NULL,
  dept_id       INTEGER,
  enabled       INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_user_dept ON sys_user(dept_id);

CREATE TABLE IF NOT EXISTS user_role (
  user_id INTEGER NOT NULL,
  role_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, role_id)
);

/* ------------------------------------------------------------------- 字典 */
CREATE TABLE IF NOT EXISTS dict_item (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT    NOT NULL,
  code       TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  color      TEXT,
  sort_no    INTEGER NOT NULL DEFAULT 0,
  enabled    INTEGER NOT NULL DEFAULT 1,
  remark     TEXT,
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL,
  UNIQUE (type, code)
);
CREATE INDEX IF NOT EXISTS idx_dict_type ON dict_item(type, sort_no);

/* ------------------------------------------------------------------- 患者 */
CREATE TABLE IF NOT EXISTS patient (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  mrn            TEXT,
  name_cipher    TEXT    NOT NULL,
  name_masked    TEXT    NOT NULL,
  gender         INTEGER NOT NULL DEFAULT 9,
  birth_date     TEXT,
  id_card_cipher TEXT,
  id_card_masked TEXT,
  phone_cipher   TEXT,
  phone_masked   TEXT,
  remark         TEXT,
  created_at     TEXT    NOT NULL,
  updated_at     TEXT    NOT NULL,
  deleted_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_patient_masked ON patient(name_masked);
CREATE UNIQUE INDEX IF NOT EXISTS uk_patient_mrn ON patient(mrn) WHERE mrn IS NOT NULL;

/* --------------------------------------------------------------- 绿道病例 */
CREATE TABLE IF NOT EXISTS green_channel_case (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  case_no      TEXT    NOT NULL UNIQUE,
  patient_id   INTEGER NOT NULL,
  dept_id      INTEGER,
  disease_code TEXT    NOT NULL,
  source_type  TEXT    NOT NULL,
  status_code  TEXT    NOT NULL,
  distance_km  REAL,
  onset_at     TEXT,
  arrive_at    TEXT,
  created_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL,
  closed_at    TEXT,
  is_closed    INTEGER NOT NULL DEFAULT 0,
  creator_id   INTEGER,
  remark       TEXT,
  deleted_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_case_screen ON green_channel_case(deleted_at, created_at);
CREATE INDEX IF NOT EXISTS idx_case_stat   ON green_channel_case(deleted_at, disease_code, created_at);
CREATE INDEX IF NOT EXISTS idx_case_open   ON green_channel_case(is_closed, deleted_at, disease_code);
CREATE INDEX IF NOT EXISTS idx_case_patient ON green_channel_case(patient_id);

CREATE TABLE IF NOT EXISTS case_event (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id     INTEGER NOT NULL,
  event_code  TEXT    NOT NULL,
  event_at    TEXT    NOT NULL,
  operator_id INTEGER,
  remark      TEXT,
  created_at  TEXT    NOT NULL,
  UNIQUE (case_id, event_code)
);
CREATE INDEX IF NOT EXISTS idx_event_case ON case_event(case_id);

CREATE TABLE IF NOT EXISTS case_attachment (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id     INTEGER NOT NULL,
  file_name   TEXT    NOT NULL,
  stored_name TEXT    NOT NULL,
  file_size   INTEGER NOT NULL DEFAULT 0,
  mime_type   TEXT,
  uploader_id INTEGER,
  created_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attach_case ON case_attachment(case_id);

/* --------------------------------------------------------------- 大屏配置 */
CREATE TABLE IF NOT EXISTS screen_config (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  screen_code      TEXT    NOT NULL UNIQUE,
  hospital_name    TEXT    NOT NULL,
  system_name      TEXT    NOT NULL DEFAULT '动态速览',
  refresh_interval INTEGER NOT NULL DEFAULT 30,
  scroll_speed     INTEGER NOT NULL DEFAULT 40,
  visible_rows     INTEGER NOT NULL DEFAULT 6,
  mask_enabled     INTEGER NOT NULL DEFAULT 1,
  pie_disease_code TEXT,
  month_bar_mode   TEXT    NOT NULL DEFAULT 'CREATED_AT',
  table_limit      INTEGER NOT NULL DEFAULT 20,
  theme            TEXT    NOT NULL DEFAULT 'blue',
  updated_at       TEXT    NOT NULL,
  updated_by       INTEGER
);

/* --------------------------------------------------------------- 统计快照 */
CREATE TABLE IF NOT EXISTS stat_daily (
  stat_date        TEXT    NOT NULL,
  disease_code     TEXT    NOT NULL DEFAULT 'ALL',
  case_count       INTEGER NOT NULL DEFAULT 0,
  closed_count     INTEGER NOT NULL DEFAULT 0,
  open_count       INTEGER NOT NULL DEFAULT 0,
  avg_response_min REAL,
  overtime_count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (stat_date, disease_code)
);

/* --------------------------------------------------------------- 日志审计 */
CREATE TABLE IF NOT EXISTS sys_oper_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER,
  user_name   TEXT,
  module      TEXT    NOT NULL,
  action      TEXT    NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  detail      TEXT,
  ip          TEXT,
  ua          TEXT,
  created_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oper_user ON sys_oper_log(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_oper_module ON sys_oper_log(module, created_at);

CREATE TABLE IF NOT EXISTS sys_login_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  username   TEXT    NOT NULL,
  success    INTEGER NOT NULL DEFAULT 1,
  message    TEXT,
  ip         TEXT,
  user_agent TEXT,
  created_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_user ON sys_login_log(username, created_at);

CREATE TABLE IF NOT EXISTS login_attempt (
  username    TEXT PRIMARY KEY,
  fail_count  INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT
);

CREATE TABLE IF NOT EXISTS integration_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT    NOT NULL,
  direction   TEXT    NOT NULL DEFAULT 'IN',
  endpoint    TEXT,
  biz_id      TEXT,
  success     INTEGER NOT NULL DEFAULT 1,
  message     TEXT,
  payload     TEXT,
  created_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_integration_time ON integration_log(created_at);

CREATE TABLE IF NOT EXISTS open_api_idempotent (
  idem_key   TEXT PRIMARY KEY,
  case_id    INTEGER,
  created_at TEXT NOT NULL
);

/* ------------------------------------------------------------------ 元信息 */
CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`
