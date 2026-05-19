require('dotenv').config();
const mongoose = require('mongoose');

const Agency = require('../models/Agency');
const User = require('../models/User');
const Guard = require('../models/Guard');
const Site = require('../models/Site');
const WelfareCall = require('../models/WelfareCall');
const SOSAlert = require('../models/SOSAlert');

const connect = async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/grantsman';
  await mongoose.connect(uri);
};

const ensureAgency = async (data) => {
  const existing = await Agency.findOne({ email: data.email });
  if (existing) return existing;
  return Agency.create(data);
};

const ensureUser = async (data) => {
  const existing = await User.findOne({ $or: [{ email: data.email }, { phone: data.phone }] });
  if (existing) return existing;
  return User.create(data);
};

const ensureSite = async (agencyId, data) => {
  const existing = await Site.findOne({ agencyId, name: data.name });
  if (existing) return existing;
  return Site.create({ ...data, agencyId });
};

const ensureGuard = async (agencyId, user, data) => {
  const existing = await Guard.findOne({ agencyId, phone: data.phone });
  if (existing) return existing;
  return Guard.create({
    ...data,
    agencyId,
    userId: user._id,
  });
};

const seed = async () => {
  try {
    await connect();
    console.log('OK Connected to MongoDB');

    const agency = await ensureAgency({
      name: 'SecureWatch Ltd',
      adminName: 'John Tabi',
      email: 'manager@securewatch.cm',
      phone: '+237670123450',
      address: 'Douala, Cameroon',
      status: 'active',
    });

    const agencyAdmin = await ensureUser({
      fullName: 'John Tabi',
      email: 'manager@securewatch.cm',
      phone: '+237670123450',
      password: 'admin123',
      role: 'agency-admin',
      agencyId: agency._id,
      isActive: true,
    });

    const superAdmin = await ensureUser({
      fullName: 'System Administrator',
      email: 'admin@grantsman.com',
      phone: '+237600000000',
      password: 'admin123',
      role: 'super-admin',
      agencyId: agency._id,
      isActive: true,
    });

    const siteA = await ensureSite(agency._id, {
      name: 'EcoBank Akwa',
      address: 'Rue 1234, Akwa, Douala',
      latitude: 4.0511,
      longitude: 9.7679,
      geofenceRadius: 2,
      isActive: true,
    });

    const siteB = await ensureSite(agency._id, {
      name: 'Construction Site 3',
      address: 'Bonaberi Industrial Zone',
      latitude: 4.0735,
      longitude: 9.7006,
      geofenceRadius: 200,
      isActive: true,
    });

    const siteC = await ensureSite(agency._id, {
      name: 'Shopping Mall Central',
      address: 'Bonanjo, Douala',
      latitude: 4.0469,
      longitude: 9.6989,
      geofenceRadius: 100,
      isActive: true,
    });

    const guardUser1 = await ensureUser({
      fullName: 'Joseph Mbarga',
      email: 'joseph@securewatch.cm',
      phone: '+237670123451',
      password: 'guard123',
      role: 'guard',
      agencyId: agency._id,
      isActive: true,
    });

    const guardUser2 = await ensureUser({
      fullName: 'Moussa Koulibaly',
      email: 'moussa@securewatch.cm',
      phone: '+237699456789',
      password: 'guard123',
      role: 'guard',
      agencyId: agency._id,
      isActive: true,
    });

    const guardUser3 = await ensureUser({
      fullName: 'Amina Bello',
      email: 'amina@securewatch.cm',
      phone: '+237680987654',
      password: 'guard123',
      role: 'guard',
      agencyId: agency._id,
      isActive: true,
    });

    const guard1 = await ensureGuard(agency._id, guardUser1, {
      name: 'Joseph Mbarga',
      phone: '+237670123451',
      device: 'smartphone',
      assignedSiteId: siteA._id,
      shiftStart: '18:00',
      shiftEnd: '06:00',
      status: 'on-duty',
      alertnessScore: 100,
      isActive: true,
      lastLocationUpdate: {
        latitude: siteA.latitude,
        longitude: siteA.longitude,
        timestamp: new Date(),
        accuracy: 12,
      },
    });

    const guard2 = await ensureGuard(agency._id, guardUser2, {
      name: 'Moussa Koulibaly',
      phone: '+237699456789',
      device: 'button-phone',
      assignedSiteId: siteB._id,
      shiftStart: '06:00',
      shiftEnd: '18:00',
      status: 'off-duty',
      alertnessScore: 92,
      isActive: true,
      lastLocationUpdate: {
        latitude: siteB.latitude,
        longitude: siteB.longitude,
        timestamp: new Date(Date.now() - 5 * 60 * 1000),
        accuracy: 18,
      },
    });

    const guard3 = await ensureGuard(agency._id, guardUser3, {
      name: 'Amina Bello',
      phone: '+237680987654',
      device: 'smartphone',
      assignedSiteId: siteC._id,
      shiftStart: '18:00',
      shiftEnd: '06:00',
      status: 'on-duty',
      alertnessScore: 96,
      isActive: true,
      lastLocationUpdate: {
        latitude: siteC.latitude,
        longitude: siteC.longitude,
        timestamp: new Date(Date.now() - 12 * 60 * 1000),
        accuracy: 10,
      },
    });

    await Site.findByIdAndUpdate(siteA._id, { $addToSet: { assignedGuards: guard1._id } });
    await Site.findByIdAndUpdate(siteB._id, { $addToSet: { assignedGuards: guard2._id } });
    await Site.findByIdAndUpdate(siteC._id, { $addToSet: { assignedGuards: guard3._id } });

    await Guard.updateMany({ isActive: { $exists: false } }, { $set: { isActive: true } });
    await Site.updateMany({ isActive: { $exists: false } }, { $set: { isActive: true } });

    const now = new Date();
    const call1 = await WelfareCall.create({
      agencyId: agency._id,
      guardId: guard1._id,
      siteId: siteA._id,
      scheduledAt: new Date(now.getTime() - 10 * 60 * 1000),
      answeredAt: new Date(now.getTime() - 9 * 60 * 1000),
      status: 'answered',
      location: { latitude: siteA.latitude, longitude: siteA.longitude, accuracy: 10 },
      withinGeofence: true,
      callDuration: 45,
    });

    const call2 = await WelfareCall.create({
      agencyId: agency._id,
      guardId: guard2._id,
      siteId: siteB._id,
      scheduledAt: new Date(now.getTime() - 20 * 60 * 1000),
      status: 'missed',
      location: { latitude: siteB.latitude, longitude: siteB.longitude, accuracy: 15 },
      withinGeofence: true,
    });

    await SOSAlert.create({
      agencyId: agency._id,
      guardId: guard3._id,
      siteId: siteC._id,
      triggeredAt: new Date(now.getTime() - 30 * 60 * 1000),
      location: { latitude: siteC.latitude, longitude: siteC.longitude },
      status: 'active',
      notes: 'Sample SOS alert for dashboard display',
      notificationsSent: ['dashboard'],
    });

    console.log('OK Seeded sample data');
    console.log(`Agency: ${agency.name}`);
    console.log(`Agency Admin: ${agencyAdmin.email} / admin123`);
    console.log(`Super Admin: ${superAdmin.email} / admin123`);
    console.log(`Guards: ${guard1.name}, ${guard2.name}, ${guard3.name}`);
    console.log(`Recent calls: ${call1._id}, ${call2._id}`);
  } catch (error) {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
    console.log('OK Database connection closed');
  }
};

seed();
