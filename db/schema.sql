-- =============================================================
-- HX 佣金费率表 Schema (10 张物理表)
-- 每个 PDF 一张表，schema 尽量贴近 PDF 原结构
-- 季度更新：每次导入新 PDF 时，UPDATE 老数据 effective_to = 新导入日期前一日
-- 查询时 WHERE effective_from <= today AND effective_to > today 拿当前生效行
-- =============================================================

-- 通用：5 个版本化 + 隐式变量列
-- 所有费率表都共用：
--   id, company, code, plan, category, currency, prepayment,
--   premium_min, age_min, age_max, term, is_activity,
--   activity_deadline, source_pdf, effective_from, effective_to,
--   created_at, updated_at

-- category 枚举: 'savings'(儲蓄) / 'whole_life'(終身壽險) / 'annuity'(延期年金) / 'ci'(危疾)
-- currency 枚举: 'USD' / 'HKD' / 'RMB' / 'GBP' / 'AUD' / 'EUR' / 'SGD' / 'multi'
-- prepayment: 'Y' (預繳) / 'N' (非預繳) / NULL (不適用)
-- is_activity: 0 = 基础版 / 1 = 活动版

-- =============================================================
-- NPI (非專業投資者) 5 张
-- =============================================================

CREATE TABLE IF NOT EXISTS npi_fee_l1 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company TEXT NOT NULL,        -- AIA 友邦 / AXA 安盛 / BOC中銀 / FWD 富衛 / GEN 忠意 / MLI 宏利 / 永M / CTP中國太平 / CPIC太保 / CTF 周大福
    code TEXT,                    -- 产品代码 (永M 无 code，存 NULL)
    plan TEXT NOT NULL,           -- 计划中文名
    category TEXT NOT NULL,       -- 储蓄/终身寿险/...
    currency TEXT NOT NULL,       -- USD/HKD/RMB/...
    prepayment TEXT,              -- Y/N/NULL
    premium_min REAL,             -- 门槛金额 (USD)，NULL = 无门槛
    age_min INTEGER,              -- 投保年龄下限 (天/岁)
    age_max INTEGER,              -- 投保年龄上限
    term INTEGER NOT NULL,        -- 缴费年限 1/2/3/5/10/15/...
    is_activity INTEGER NOT NULL DEFAULT 0,
    activity_deadline TEXT,       -- 活动版截止日期 'YYYY/M/D' 或 NULL
    y1 REAL NOT NULL,             -- 第一年佣金率
    y2 REAL,                      -- 第二年
    y3 REAL,                      -- 第三年
    y4 REAL,                      -- 第四年
    y5 REAL,                      -- 第五年 (5 年期以上才有续期意义)
    total REAL NOT NULL,          -- 总和 = y1 + y2*4 (L1 无加点列)
    source_pdf TEXT NOT NULL,     -- 来源 PDF 文件名
    effective_from TEXT NOT NULL, -- 'YYYY-MM-DD'
    effective_to TEXT,            -- 'YYYY-MM-DD' / NULL = 仍在生效
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company, code, plan, term, is_activity, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_npi_l1_lookup
ON npi_fee_l1(company, code, plan, term, is_activity, currency, category);

CREATE TABLE IF NOT EXISTS npi_fee_l2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company TEXT NOT NULL,
    code TEXT,
    plan TEXT NOT NULL,
    category TEXT NOT NULL,
    currency TEXT NOT NULL,
    prepayment TEXT,
    premium_min REAL,
    age_min INTEGER,
    age_max INTEGER,
    term INTEGER NOT NULL,
    is_activity INTEGER NOT NULL DEFAULT 0,
    activity_deadline TEXT,
    y1 REAL NOT NULL,
    y2 REAL,
    y3 REAL,
    y4 REAL,
    y5 REAL,
    add_l2 REAL NOT NULL,         -- L2 加点 (L1 总和 + L2 加点 = L2 总和)
    total_l2 REAL NOT NULL,
    source_pdf TEXT NOT NULL,
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company, code, plan, term, is_activity, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_npi_l2_lookup
ON npi_fee_l2(company, code, plan, term, is_activity, currency, category);

CREATE TABLE IF NOT EXISTS npi_fee_l3 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company TEXT NOT NULL,
    code TEXT,
    plan TEXT NOT NULL,
    category TEXT NOT NULL,
    currency TEXT NOT NULL,
    prepayment TEXT,
    premium_min REAL,
    age_min INTEGER,
    age_max INTEGER,
    term INTEGER NOT NULL,
    is_activity INTEGER NOT NULL DEFAULT 0,
    activity_deadline TEXT,
    y1 REAL NOT NULL,
    y2 REAL,
    y3 REAL,
    y4 REAL,
    y5 REAL,
    add_l3 REAL NOT NULL,
    total_l3 REAL NOT NULL,
    source_pdf TEXT NOT NULL,
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company, code, plan, term, is_activity, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_npi_l3_lookup
ON npi_fee_l3(company, code, plan, term, is_activity, currency, category);

CREATE TABLE IF NOT EXISTS npi_fee_direct (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company TEXT NOT NULL,
    code TEXT,
    plan TEXT NOT NULL,
    category TEXT NOT NULL,
    currency TEXT NOT NULL,
    prepayment TEXT,
    premium_min REAL,
    age_min INTEGER,
    age_max INTEGER,
    term INTEGER NOT NULL,
    is_activity INTEGER NOT NULL DEFAULT 0,
    activity_deadline TEXT,
    direct_value REAL NOT NULL,   -- 直接伯乐单值
    source_pdf TEXT NOT NULL,
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company, code, plan, term, is_activity, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_npi_direct_lookup
ON npi_fee_direct(company, code, plan, term, is_activity, currency, category);

CREATE TABLE IF NOT EXISTS npi_fee_indirect (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company TEXT NOT NULL,
    code TEXT,
    plan TEXT NOT NULL,
    category TEXT NOT NULL,
    currency TEXT NOT NULL,
    prepayment TEXT,
    premium_min REAL,
    age_min INTEGER,
    age_max INTEGER,
    term INTEGER NOT NULL,
    is_activity INTEGER NOT NULL DEFAULT 0,
    activity_deadline TEXT,
    indirect_value REAL NOT NULL,
    source_pdf TEXT NOT NULL,
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company, code, plan, term, is_activity, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_npi_indirect_lookup
ON npi_fee_indirect(company, code, plan, term, is_activity, currency, category);

-- =============================================================
-- PI (專業投資者) 5 张
-- PI 结构：基础合计 + 加点 + 总合计 (3 列，不是 1st/2nd/3rd/4th/5th)
-- =============================================================

CREATE TABLE IF NOT EXISTS pi_fee_l1 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company TEXT NOT NULL,
    code TEXT,
    plan TEXT NOT NULL,
    category TEXT NOT NULL,
    currency TEXT NOT NULL,
    prepayment TEXT,
    premium_min REAL,
    age_min INTEGER,
    age_max INTEGER,
    term INTEGER NOT NULL,
    is_activity INTEGER NOT NULL DEFAULT 0,
    activity_deadline TEXT,
    base_total REAL NOT NULL,     -- 基础合计 (PI L1 唯一列)
    source_pdf TEXT NOT NULL,
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company, code, plan, term, is_activity, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_pi_l1_lookup
ON pi_fee_l1(company, code, plan, term, is_activity, currency, category);

CREATE TABLE IF NOT EXISTS pi_fee_l2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company TEXT NOT NULL,
    code TEXT,
    plan TEXT NOT NULL,
    category TEXT NOT NULL,
    currency TEXT NOT NULL,
    prepayment TEXT,
    premium_min REAL,
    age_min INTEGER,
    age_max INTEGER,
    term INTEGER NOT NULL,
    is_activity INTEGER NOT NULL DEFAULT 0,
    activity_deadline TEXT,
    base_total REAL NOT NULL,
    add_l2 REAL NOT NULL,
    total_l2 REAL NOT NULL,
    source_pdf TEXT NOT NULL,
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company, code, plan, term, is_activity, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_pi_l2_lookup
ON pi_fee_l2(company, code, plan, term, is_activity, currency, category);

CREATE TABLE IF NOT EXISTS pi_fee_l3 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company TEXT NOT NULL,
    code TEXT,
    plan TEXT NOT NULL,
    category TEXT NOT NULL,
    currency TEXT NOT NULL,
    prepayment TEXT,
    premium_min REAL,
    age_min INTEGER,
    age_max INTEGER,
    term INTEGER NOT NULL,
    is_activity INTEGER NOT NULL DEFAULT 0,
    activity_deadline TEXT,
    base_total REAL NOT NULL,
    add_l3 REAL NOT NULL,
    total_l3 REAL NOT NULL,
    source_pdf TEXT NOT NULL,
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company, code, plan, term, is_activity, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_pi_l3_lookup
ON pi_fee_l3(company, code, plan, term, is_activity, currency, category);

CREATE TABLE IF NOT EXISTS pi_fee_direct (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company TEXT NOT NULL,
    code TEXT,
    plan TEXT NOT NULL,
    category TEXT NOT NULL,
    currency TEXT NOT NULL,
    prepayment TEXT,
    premium_min REAL,
    age_min INTEGER,
    age_max INTEGER,
    term INTEGER NOT NULL,
    is_activity INTEGER NOT NULL DEFAULT 0,
    activity_deadline TEXT,
    direct_value REAL NOT NULL,
    source_pdf TEXT NOT NULL,
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company, code, plan, term, is_activity, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_pi_direct_lookup
ON pi_fee_direct(company, code, plan, term, is_activity, currency, category);

CREATE TABLE IF NOT EXISTS pi_fee_indirect (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company TEXT NOT NULL,
    code TEXT,
    plan TEXT NOT NULL,
    category TEXT NOT NULL,
    currency TEXT NOT NULL,
    prepayment TEXT,
    premium_min REAL,
    age_min INTEGER,
    age_max INTEGER,
    term INTEGER NOT NULL,
    is_activity INTEGER NOT NULL DEFAULT 0,
    activity_deadline TEXT,
    indirect_value REAL NOT NULL,
    source_pdf TEXT NOT NULL,
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company, code, plan, term, is_activity, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_pi_indirect_lookup
ON pi_fee_indirect(company, code, plan, term, is_activity, currency, category);

-- =============================================================
-- 验证表 (LLM 抽样复核用)
-- =============================================================

CREATE TABLE IF NOT EXISTS verification_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,         -- 本次运行的 UUID
    table_name TEXT NOT NULL,
    row_id INTEGER NOT NULL,
    pdf_text_snippet TEXT,        -- PDF 原始文本
    llm_verdict TEXT,             -- PASS / FAIL
    llm_reason TEXT,              -- LLM 判断依据
    verified_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_verification_run
ON verification_log(run_id);