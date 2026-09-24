-- AlterTable
ALTER TABLE "users" ADD COLUMN     "account_name" TEXT,
ADD COLUMN     "account_number" TEXT,
ADD COLUMN     "bank_name" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "dob" TIMESTAMP(3),
ADD COLUMN     "legal_name" TEXT,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "notifications" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "studio_name" TEXT,
ADD COLUMN     "withdrawal_verified" BOOLEAN NOT NULL DEFAULT false;
