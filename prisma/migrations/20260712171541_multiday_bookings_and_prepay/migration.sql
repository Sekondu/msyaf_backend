/*
  Warnings:

  - You are about to drop the column `date` on the `BookingRequest` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "BookingRequest" DROP COLUMN "date";

-- AlterTable
ALTER TABLE "farm" ADD COLUMN     "prepay_amount" INTEGER,
ADD COLUMN     "prepay_days_before" INTEGER,
ADD COLUMN     "prepay_required" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "BookingDay" (
    "booking_id" TEXT NOT NULL,
    "date" DATE NOT NULL,

    CONSTRAINT "BookingDay_pkey" PRIMARY KEY ("booking_id","date")
);

-- AddForeignKey
ALTER TABLE "BookingDay" ADD CONSTRAINT "BookingDay_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "BookingRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
