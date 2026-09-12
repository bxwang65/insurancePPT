-- AlterTable
ALTER TABLE "User" ADD COLUMN "in_maintenance_until" DATETIME;
ALTER TABLE "User" ADD COLUMN "last_promoted_at" DATETIME;
ALTER TABLE "User" ADD COLUMN "pending_effective_at" DATETIME;
ALTER TABLE "User" ADD COLUMN "pending_level" INTEGER;
ALTER TABLE "User" ADD COLUMN "pending_management_level" INTEGER;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LevelHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "mgmt_level" INTEGER NOT NULL,
    "eval_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_at" DATETIME,
    "window_start" DATETIME NOT NULL,
    "window_end" DATETIME NOT NULL,
    "reason" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'STAGED',
    CONSTRAINT "LevelHistory_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_LevelHistory" ("eval_at", "id", "level", "mgmt_level", "reason", "trigger", "user_id", "window_end", "window_start") SELECT "eval_at", "id", "level", "mgmt_level", "reason", "trigger", "user_id", "window_end", "window_start" FROM "LevelHistory";
DROP TABLE "LevelHistory";
ALTER TABLE "new_LevelHistory" RENAME TO "LevelHistory";
CREATE INDEX "LevelHistory_user_id_eval_at_idx" ON "LevelHistory"("user_id", "eval_at");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
