-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "product_type" TEXT NOT NULL,
    "annual_premium" DECIMAL,
    "payment_years" INTEGER,
    "std_premium" DECIMAL,
    "policy_no" TEXT,
    "artist" TEXT,
    "work_title" TEXT,
    "sale_price" DECIMAL,
    "currency" TEXT,
    "sold_at" DATETIME NOT NULL,
    "recorded_by" TEXT NOT NULL,
    "commission_amount" DECIMAL,
    "commission_breakdown" TEXT,
    "hk_company" TEXT,
    "hk_code" TEXT,
    "hk_plan" TEXT,
    "hk_term" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Transaction_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LevelHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "mgmt_level" INTEGER NOT NULL,
    "eval_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "window_start" DATETIME NOT NULL,
    "window_end" DATETIME NOT NULL,
    "reason" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    CONSTRAINT "LevelHistory_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ManagerChangeLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "old_manager_id" TEXT,
    "new_manager_id" TEXT,
    "changed_by" TEXT NOT NULL,
    "reason" TEXT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ManagerChangeLog_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ManagerChangeLog_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Config" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "updated_by" TEXT
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "firebase_uid" TEXT,
    "email" TEXT,
    "name" TEXT NOT NULL,
    "avatar_url" TEXT,
    "phone" TEXT,
    "password" TEXT,
    "role" TEXT,
    "title" TEXT,
    "level" INTEGER NOT NULL DEFAULT 1,
    "level_name" TEXT NOT NULL DEFAULT '初阶阶段',
    "total_learning_minutes" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_admin" BOOLEAN NOT NULL DEFAULT false,
    "sales_amount" DECIMAL DEFAULT 0,
    "performance_score" INTEGER NOT NULL DEFAULT 0,
    "performance_updated_at" DATETIME,
    "current_level" INTEGER NOT NULL DEFAULT 1,
    "current_management_level" INTEGER NOT NULL DEFAULT 1,
    "recruiter_id" TEXT,
    "manager_id" TEXT,
    "main_product" TEXT,
    "joined_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "User_recruiter_id_fkey" FOREIGN KEY ("recruiter_id") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "User_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("avatar_url", "created_at", "email", "firebase_uid", "id", "is_active", "is_admin", "level", "level_name", "name", "password", "phone", "role", "title", "total_learning_minutes", "updated_at") SELECT "avatar_url", "created_at", "email", "firebase_uid", "id", "is_active", "is_admin", "level", "level_name", "name", "password", "phone", "role", "title", "total_learning_minutes", "updated_at" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_firebase_uid_key" ON "User"("firebase_uid");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Transaction_user_id_sold_at_idx" ON "Transaction"("user_id", "sold_at");

-- CreateIndex
CREATE INDEX "Transaction_product_type_sold_at_idx" ON "Transaction"("product_type", "sold_at");

-- CreateIndex
CREATE INDEX "Transaction_hk_company_hk_code_hk_term_idx" ON "Transaction"("hk_company", "hk_code", "hk_term");

-- CreateIndex
CREATE INDEX "LevelHistory_user_id_eval_at_idx" ON "LevelHistory"("user_id", "eval_at");

-- CreateIndex
CREATE INDEX "ManagerChangeLog_user_id_at_idx" ON "ManagerChangeLog"("user_id", "at");
