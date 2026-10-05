-- AlterTable
ALTER TABLE "users" ADD COLUMN     "quest_claims" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "quest_claims_date" TEXT;
