-- AlterEnum
ALTER TYPE "GameType" ADD VALUE 'WHOT';

-- CreateTable
CREATE TABLE "multiplayer_matches" (
    "id" TEXT NOT NULL,
    "game_type" "GameType" NOT NULL,
    "stake_amount" INTEGER NOT NULL DEFAULT 50,
    "prize_pool" INTEGER NOT NULL DEFAULT 0,
    "max_players" INTEGER NOT NULL DEFAULT 4,
    "status" "MatchStatus" NOT NULL DEFAULT 'WAITING_OPPONENT',
    "host_id" TEXT NOT NULL,
    "winner_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "multiplayer_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_participants" (
    "id" TEXT NOT NULL,
    "match_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "score" INTEGER,
    "completed_at" TIMESTAMP(3),
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "match_participants_match_id_user_id_key" ON "match_participants"("match_id", "user_id");

-- AddForeignKey
ALTER TABLE "multiplayer_matches" ADD CONSTRAINT "multiplayer_matches_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "multiplayer_matches" ADD CONSTRAINT "multiplayer_matches_winner_id_fkey" FOREIGN KEY ("winner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "multiplayer_matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
