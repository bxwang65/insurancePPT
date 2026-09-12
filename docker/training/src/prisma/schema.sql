-- ============================================================
-- 培训模块数据库 Schema（SQL 规范）
-- ============================================================

-- 用户表
CREATE TABLE IF NOT EXISTS "User" (
    id                  TEXT PRIMARY KEY DEFAULT (cuid()),
    name                TEXT NOT NULL,
    avatar_url          TEXT,
    role                TEXT NOT NULL,
    title               TEXT,
    level               INTEGER DEFAULT 1,
    level_name          TEXT DEFAULT '初阶阶段',
    total_learning_minutes INTEGER DEFAULT 0,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 课程表
CREATE TABLE IF NOT EXISTS "Course" (
    id                  TEXT PRIMARY KEY DEFAULT (cuid()),
    title               TEXT NOT NULL,
    cover_image         TEXT NOT NULL,
    stage               TEXT NOT NULL CHECK (stage IN ('ONBOARDING', 'TRANSFER', 'ADVANCEMENT')),
    stage_name          TEXT NOT NULL,
    duration_minutes    INTEGER DEFAULT 0,
    description         TEXT,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 用户-课程学习进度关联表
CREATE TABLE IF NOT EXISTS "UserCourseProgress" (
    id                  TEXT PRIMARY KEY DEFAULT (cuid()),
    user_id             TEXT NOT NULL,
    course_id           TEXT NOT NULL,
    progress_percentage INTEGER DEFAULT 0,
    last_watched_at     DATETIME,
    last_position        INTEGER DEFAULT 0,
    created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES "User"(id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES "Course"(id) ON DELETE CASCADE,
    UNIQUE (user_id, course_id)
);

-- 索引：支持"最近在看"排序查询
CREATE INDEX IF NOT EXISTS "idx_progress_user_lastwatched"
    ON "UserCourseProgress"(user_id, last_watched_at DESC);

-- 荣誉勋章表
CREATE TABLE IF NOT EXISTS "Honor" (
    id          TEXT PRIMARY KEY DEFAULT (cuid()),
    name        TEXT NOT NULL,
    icon_url    TEXT NOT NULL,
    description TEXT,
    earned_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 用户-勋章关联表
CREATE TABLE IF NOT EXISTS "UserHonor" (
    id         TEXT PRIMARY KEY DEFAULT (cuid()),
    user_id    TEXT NOT NULL,
    honor_id   TEXT NOT NULL,
    earned_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES "User"(id) ON DELETE CASCADE,
    FOREIGN KEY (honor_id) REFERENCES "Honor"(id) ON DELETE CASCADE,
    UNIQUE (user_id, honor_id)
);

-- 等级阶段配置表
CREATE TABLE IF NOT EXISTS "LevelConfig" (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    level               INTEGER UNIQUE NOT NULL,
    name                TEXT NOT NULL,
    min_minutes         INTEGER NOT NULL,
    next_level_minutes  INTEGER
);
