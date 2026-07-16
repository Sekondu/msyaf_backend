import bcrypt from 'bcryptjs'
import { prisma } from '../src/config/client'

const testUsers = [
  { name: 'أبو العبد', phone: '0991234567', role: 'LISTER', status: 'ACTIVE', subscription_started_at: '2026-06-20', subscription_end: '2026-08-03', created_at: '2026-06-20' },
  { name: 'أبو ليث', phone: '0944555210', role: 'LISTER', status: 'ACTIVE', subscription_started_at: '2026-05-01', subscription_end: '2026-07-19', created_at: '2026-05-01' },
  { name: 'أبو محمود', phone: '0955111222', role: 'LISTER', status: 'ACTIVE', subscription_started_at: '2026-04-10', subscription_end: '2026-07-01', created_at: '2026-04-10' },
  { name: 'رنا مارتيني', phone: '0966333444', role: 'LISTER', status: 'SUSPENDED', subscription_started_at: '2026-06-01', subscription_end: '2026-08-25', created_at: '2026-06-01' },
  { name: 'سامر ونوس', phone: '0933777888', role: 'LISTER', status: 'ACTIVE', subscription_started_at: null, subscription_end: null, created_at: '2026-07-05' },
];

const testFarms = [
  { name: 'مزرعة الياسمين', city: 'دير عطية', cap: 30, created_at: '2026-06-21', ownerPhone: '0991234567' },
  { name: 'مزرعة نبع القلمون', city: 'النبك', cap: 40, created_at: '2026-05-02', ownerPhone: '0944555210' },
  { name: 'مزرعة بيت جدّي', city: 'دير عطية', cap: 25, created_at: '2026-06-22', ownerPhone: '0991234567' },
  { name: 'مزرعة الواحة الخضراء', city: 'النبك', cap: 50, created_at: '2026-04-11', ownerPhone: '0955111222' },
];

const testBookings = [
  { targetFarmName: 'مزرعة الياسمين', targetOwnerPhone: '0991234567', name: 'أحمد شعبان', phone: '0991234567', people: 12, dates: ['2026-07-18', '2026-07-19'], status: 'pending', created_at: '2026-07-11' },
  { targetFarmName: 'مزرعة بيت جدّي', targetOwnerPhone: '0991234567', name: 'لينا حداد', phone: '0944555210', people: 8, dates: ['2026-07-19'], status: 'pending', created_at: '2026-07-11' },
  { targetFarmName: 'مزرعة الياسمين', targetOwnerPhone: '0991234567', name: 'عمر قباني', phone: '0933777888', people: 25, dates: ['2026-08-06', '2026-08-07', '2026-08-08'], status: 'approved', created_at: '2026-07-10' },
  { targetFarmName: 'مزرعة نبع القلمون', targetOwnerPhone: '0944555210', name: 'سامر ونوس', phone: '0955111222', people: 15, dates: ['2026-07-11'], status: 'approved', created_at: '2026-07-09' },
  { targetFarmName: 'مزرعة الواحة الخضراء', targetOwnerPhone: '0955111222', name: 'رنا مارتيني', phone: '0966333444', people: 6, dates: ['2026-07-05'], status: 'rejected', created_at: '2026-07-04' },
];

async function main() {
  const hashedPassword = await bcrypt.hash('password123', 10);

  // 1. Seed Users
  for (const user of testUsers) {
    const existingUser = await prisma.user.findFirst({
      where: { phone: user.phone }
    });
    
    if (existingUser) continue; 

    await prisma.user.create({
      data: {
        name: user.name,
        phone: user.phone,
        role: user.role as any,
        status: user.status as any,
        password: hashedPassword,
        subscription_started_at: user.subscription_started_at ? new Date(user.subscription_started_at) : null,
        subscription_end: user.subscription_end ? new Date(user.subscription_end) : null,
        created_at: new Date(user.created_at)
      }
    });
  }

  // 2. Seed Farms
  for (const f of testFarms) {
    const owner = await prisma.user.findUnique({
      where: { phone: f.ownerPhone }
    });

    if (!owner) {
      console.log(`⚠️ Skipping farm ${f.name}: Owner with phone ${f.ownerPhone} not found.`);
      continue;
    }

    const existingFarm = await prisma.farm.findFirst({
      where: { name: f.name, owner_id: owner.id }
    });

    if (existingFarm) continue;

    await prisma.farm.create({
      data: {
        name: f.name,
        city: f.city,
        cap: f.cap,
        owner_id: owner.id, 
        created_at: new Date(f.created_at),
        tagline: "something",
        desc: "a long sentence which is considered a description for it"
      }
    });
  }

  // 3. Seed Booking Requests & Booking Days
  for (const b of testBookings) {
    // Find the farm's owner
    const targetOwner = await prisma.user.findUnique({
      where: { phone: b.targetOwnerPhone }
    });

    if (!targetOwner) {
      console.log(`⚠️ Skipping booking for ${b.name}: Farm owner phone ${b.targetOwnerPhone} missing.`);
      continue;
    }

    // Find the target farm
    const farm = await prisma.farm.findFirst({
      where: { name: b.targetFarmName, owner_id: targetOwner.id }
    });

    if (!farm) {
      console.log(`⚠️ Skipping booking for ${b.name}: Farm "${b.targetFarmName}" not found.`);
      continue;
    }

    // Find the client user who made the booking request (based on booking phone number)
    const bookingUser = await prisma.user.findUnique({
      where: { phone: b.phone }
    });

    if (!bookingUser) {
      console.log(`⚠️ Skipping booking for ${b.name}: Client user phone ${b.phone} doesn't exist.`);
      continue;
    }

    // Deduplicate check
    const existingBooking = await prisma.bookingRequest.findFirst({
      where: { 
        phone: b.phone, 
        farm_id: farm.id, 
        created_at: new Date(b.created_at) 
      }
    });

    if (existingBooking) continue;

    // Create the booking request along with nested booking days inside an atomic transaction
    await prisma.bookingRequest.create({
      data: {
        farm_id: farm.id,
        user_id: bookingUser.id, // Links booking request to a platform account
        name: b.name,
        phone: b.phone,
        no_people: b.people, // Mapped from 'people' to your schema field name 'no_people'
        status: b.status as any,
        notes: "No specific notes provided.",
        created_at: new Date(b.created_at),
        days: {
          create: b.dates.map((dateStr) => ({
            date: new Date(dateStr)
          }))
        }
      }
    });
  }

  console.log("🌱 Database seeded successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
