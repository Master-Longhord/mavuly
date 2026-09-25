-- CreateEnum
CREATE TYPE "GameType" AS ENUM ('WORD_CLASH', 'DICE_DASH', 'MATH_DUEL', 'TRIVIA_RUSH', 'TILE_MATCH');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('WAITING_OPPONENT', 'PLAYING', 'SETTLED', 'EXPIRED_REFUNDED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "tamper_attempt_count" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "arcade_matches" (
    "id" TEXT NOT NULL,
    "game_type" "GameType" NOT NULL,
    "stake_amount" INTEGER NOT NULL DEFAULT 50,
    "prize_amount" INTEGER NOT NULL DEFAULT 85,
    "board_seed" TEXT NOT NULL,
    "player1_id" TEXT NOT NULL,
    "player2_id" TEXT,
    "player1_score" INTEGER,
    "player2_score" INTEGER,
    "player1_completed_at" TIMESTAMP(3),
    "player2_completed_at" TIMESTAMP(3),
    "winner_id" TEXT,
    "status" "MatchStatus" NOT NULL DEFAULT 'WAITING_OPPONENT',
    "is_bot_opponent" BOOLEAN NOT NULL DEFAULT false,
    "bot_name" TEXT,
    "settled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "arcade_matches_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "arcade_matches" ADD CONSTRAINT "arcade_matches_player1_id_fkey" FOREIGN KEY ("player1_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arcade_matches" ADD CONSTRAINT "arcade_matches_player2_id_fkey" FOREIGN KEY ("player2_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arcade_matches" ADD CONSTRAINT "arcade_matches_winner_id_fkey" FOREIGN KEY ("winner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
