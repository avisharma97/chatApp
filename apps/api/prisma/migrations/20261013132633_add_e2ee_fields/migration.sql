-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "encrypted_payload" JSONB,
ADD COLUMN     "encryption_version" INTEGER;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "encryption_key_version" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "encryption_public_key" VARCHAR(128);
