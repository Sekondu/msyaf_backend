/*
  Warnings:

  - You are about to drop the column `prepay_amount` on the `farm` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Tier" ADD COLUMN     "prepay_amount" INTEGER;

-- AlterTable
ALTER TABLE "farm" DROP COLUMN "prepay_amount";
