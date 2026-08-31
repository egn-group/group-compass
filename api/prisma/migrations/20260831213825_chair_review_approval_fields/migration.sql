-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "resolved" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "approvedFields" "DnaField"[] DEFAULT ARRAY[]::"DnaField"[];
