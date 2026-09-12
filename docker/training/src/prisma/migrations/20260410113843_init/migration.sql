-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "avatar_url" TEXT,
    "role" TEXT NOT NULL,
    "title" TEXT,
    "level" INTEGER NOT NULL DEFAULT 1,
    "level_name" TEXT NOT NULL DEFAULT '初阶阶段',
    "total_learning_minutes" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "cover_image" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "stage_name" TEXT NOT NULL,
    "duration_minutes" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "UserCourseProgress" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "progress_percentage" INTEGER NOT NULL DEFAULT 0,
    "last_watched_at" DATETIME,
    "last_position" INTEGER NOT NULL DEFAULT 0,
    "total_watch_seconds" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "UserCourseProgress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserCourseProgress_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Honor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "icon_url" TEXT NOT NULL,
    "description" TEXT,
    "earned_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "UserHonor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "honor_id" TEXT NOT NULL,
    "earned_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserHonor_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserHonor_honor_id_fkey" FOREIGN KEY ("honor_id") REFERENCES "Honor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "liked" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "Feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Feedback_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LevelConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "level" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "min_minutes" INTEGER NOT NULL,
    "next_level_minutes" INTEGER
);

-- CreateIndex
CREATE INDEX "UserCourseProgress_user_id_last_watched_at_idx" ON "UserCourseProgress"("user_id", "last_watched_at");

-- CreateIndex
CREATE UNIQUE INDEX "UserCourseProgress_user_id_course_id_key" ON "UserCourseProgress"("user_id", "course_id");

-- CreateIndex
CREATE UNIQUE INDEX "UserHonor_user_id_honor_id_key" ON "UserHonor"("user_id", "honor_id");

-- CreateIndex
CREATE UNIQUE INDEX "Feedback_user_id_course_id_key" ON "Feedback"("user_id", "course_id");

-- CreateIndex
CREATE UNIQUE INDEX "LevelConfig_level_key" ON "LevelConfig"("level");
