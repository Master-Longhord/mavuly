/*
  Warnings:

  - A unique constraint covering the columns `[api_key]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "description" TEXT,
ADD COLUMN     "version" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "address_doc_url" TEXT,
ADD COLUMN     "api_key" TEXT,
ADD COLUMN     "api_secret" TEXT,
ADD COLUMN     "business_doc_url" TEXT,
ADD COLUMN     "id_doc_url" TEXT,
ADD COLUMN     "postback_url" TEXT;

-- CreateTable
CREATE TABLE "developer_apps" (
    "id" TEXT NOT NULL,
    "developer_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'App',
    "version" TEXT,
    "description" TEXT,
    "moderation_status" TEXT NOT NULL DEFAULT 'PENDING',
    "moderation_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "developer_apps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_api_key_key" ON "users"("api_key");

-- AddForeignKey
ALTER TABLE "developer_apps" ADD CONSTRAINT "developer_apps_developer_id_fkey" FOREIGN KEY ("developer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
