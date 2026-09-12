-- CreateTable
CREATE TABLE "CourseMaterial" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "course_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "file_size" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CourseMaterial_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
