require('dotenv').config();
const mongoose = require('mongoose');
const Agency = require('../models/Agency');
const User = require('../models/User');
const Guard = require('../models/Guard');
const Site = require('../models/Site');

async function seedDatabase() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/grantsman');
    console.log('✅ Connected to MongoDB');

    // Clear existing data
    await Promise.all([
      Agency.deleteMany({}),
      User.deleteMany({}),
      Guard.deleteMany({}),
      Site.deleteMany({})
    ]);
    console.log('🗑️  Cleared existing data');

    // 1. Create Agency
    const agency = await Agency.create({
      name: 'SecureWatch Ltd',
      adminName: 'John Tabi',
      email: 'manager@securewatch.cm',
      phone: '+237670123456',
      address: 'Douala, Cameroon',
      status: 'active'
    });
    console.log('✅ Created agency:', agency.name);

    // 2. Create Agency Admin User
    const adminUser = await User.create({
      fullName: 'John Tabi',
      email: 'manager@securewatch.cm',
      phone: '+237670123450',
      password: 'admin123',
      role: 'agency-admin',
      agencyId: agency._id,
      isActive: true
    });
    console.log('✅ Created agency admin:', adminUser.email);

    // 3. Create Sites
    const sites = await Site.create([
      {
        agencyId: agency._id,
        name: 'EcoBank Akwa',
        address: 'Rue 1234, Akwa, Douala',
        latitude: 4.0511,
        longitude: 9.7679,
        geofenceRadius: 50
      },
      {
        agencyId: agency._id,
        name: 'Construction Site 3',
        address: 'Bonaberi Industrial Zone',
        latitude: 4.0735,
        longitude: 9.7006,
        geofenceRadius: 200
      },
      {
        agencyId: agency._id,
        name: 'Shopping Mall Central',
        address: 'Bonanjo, Douala',
        latitude: 4.0469,
        longitude: 9.6989,
        geofenceRadius: 100
      }
    ]);
    console.log(`✅ Created ${sites.length} sites`);

    // 4. Create Guard Users
    const guardUsers = await User.create([
      {
        fullName: 'Joseph Mbarga',
        email: 'joseph@securewatch.cm',
        phone: '+237670123451',
        password: 'guard123',
        role: 'guard',
        agencyId: agency._id,
        isActive: true
      },
      {
        fullName: 'Moussa Koulibaly',
        email: 'moussa@securewatch.cm',
        phone: '+237699456789',
        password: 'guard123',
        role: 'guard',
        agencyId: agency._id,
        isActive: true
      },
      {
        fullName: 'Amina Bello',
        email: 'amina@securewatch.cm',
        phone: '+237680987654',
        password: 'guard123',
        role: 'guard',
        agencyId: agency._id,
        isActive: true
      }
    ]);
    console.log(`✅ Created ${guardUsers.length} guard users`);

    // 5. Create Guard Profiles
    const guards = await Guard.create([
      {
        userId: guardUsers[0]._id,
        agencyId: agency._id,
        name: 'Joseph Mbarga',
        phone: '+237670123451',
        device: 'smartphone',
        assignedSiteId: sites[0]._id,
        shiftStart: '18:00',
        shiftEnd: '06:00',
        status: 'off-duty',
        alertnessScore: 100
      },
      {
        userId: guardUsers[1]._id,
        agencyId: agency._id,
        name: 'Moussa Koulibaly',
        phone: '+237699456789',
        device: 'button-phone',
        assignedSiteId: sites[1]._id,
        shiftStart: '06:00',
        shiftEnd: '18:00',
        status: 'off-duty',
        alertnessScore: 92
      },
      {
        userId: guardUsers[2]._id,
        agencyId: agency._id,
        name: 'Amina Bello',
        phone: '+237680987654',
        device: 'smartphone',
        assignedSiteId: sites[2]._id,
        shiftStart: '18:00',
        shiftEnd: '06:00',
        status: 'off-duty',
        alertnessScore: 96
      }
    ]);
    console.log(`✅ Created ${guards.length} guard profiles`);

    // 6. Create Super Admin
    const superAdmin = await User.create({
      fullName: 'System Administrator',
      email: 'admin@grantsman.com',
      phone: '+237600000000',
      password: 'admin123',
      role: 'super-admin',
      isActive: true
    });
    console.log('✅ Created super admin:', superAdmin.email);

    console.log('\n╔════════════════════════════════════════╗');
    console.log('║        🎉 Seeding Complete!           ║');
    console.log('╠════════════════════════════════════════╣');
    console.log('║  Test Credentials:                     ║');
    console.log('║                                        ║');
    console.log('║  Super Admin:                          ║');
    console.log('║    Email: admin@grantsman.com      ║');
    console.log('║    Pass:  admin123                     ║');
    console.log('║                                        ║');
    console.log('║  Agency Manager:                       ║');
    console.log('║    Email: manager@securewatch.cm       ║');
    console.log('║    Pass:  admin123                     ║');
    console.log('║                                        ║');
    console.log('║  Guard (Mobile App):                   ║');
    console.log('║    Phone: +237670123451                ║');
    console.log('║    Pass:  guard123                     ║');
    console.log('╚════════════════════════════════════════╝\n');

    await mongoose.connection.close();
    console.log('✅ Database connection closed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
}

seedDatabase();