/*
  Warnings:

  - A unique constraint covering the columns `[room_code]` on the table `multiplayer_matches` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `room_code` to the `multiplayer_matches` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "multiplayer_matches" ADD COLUMN     "room_code" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "multiplayer_matches_room_code_key" ON "multiplayer_matches"("room_code");
