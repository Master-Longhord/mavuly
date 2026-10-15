-- AlterTable
ALTER TABLE "feedbacks" ADD COLUMN     "bug_severity" TEXT,
ADD COLUMN     "bug_status" TEXT NOT NULL DEFAULT 'OPEN';
