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
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
INSERT INTO "new_User" ("avatar_url", "created_at", "id", "is_active", "is_admin", "level", "level_name", "name", "password", "phone", "role", "title", "total_learning_minutes", "updated_at") SELECT "avatar_url", "created_at", "id", "is_active", "is_admin", "level", "level_name", "name", "password", "phone", "role", "title", "total_learning_minutes", "updated_at" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_firebase_uid_key" ON "User"("firebase_uid");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
