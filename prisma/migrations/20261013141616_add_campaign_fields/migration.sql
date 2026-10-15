-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "deadline" TIMESTAMP(3),
ADD COLUMN     "platforms" TEXT[] DEFAULT ARRAY['Android']::TEXT[],
ADD COLUMN     "product_type" TEXT NOT NULL DEFAULT 'App';
