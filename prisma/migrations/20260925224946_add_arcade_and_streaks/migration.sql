-- AlterTable
ALTER TABLE "users" ADD COLUMN     "last_streak_date" TEXT,
ADD COLUMN     "matches_played_today" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "math_matches_today" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "streak_days" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tile_matches_today" INTEGER NOT NULL DEFAULT 0;
