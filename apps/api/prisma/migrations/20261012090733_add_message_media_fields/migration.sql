-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "media_mime_type" VARCHAR(100),
ADD COLUMN     "media_original_name" VARCHAR(255),
ADD COLUMN     "media_public_id" VARCHAR(255),
ADD COLUMN     "media_resource_type" VARCHAR(10),
ADD COLUMN     "media_size" INTEGER,
ADD COLUMN     "media_url" VARCHAR(2048);
