-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'Reset';

-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "importedSnapshot" JSONB;
