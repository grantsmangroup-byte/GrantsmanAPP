const Guard = require('../models/Guard');
const Site = require('../models/Site');
const LocationPing = require('../models/LocationPing');
const { isWithinGeofence } = require('../utils/geofence');

exports.sendLocationPing = async (req, res) => {
  try {
    const { latitude, longitude, timestamp, accuracy } = req.body;
    
    const guard = await Guard.findOne({ userId: req.userId });
    if (!guard) {
      return res.status(404).json({ 
        success: false, 
        error: { message: 'Guard not found', code: 'NOT_FOUND' }
      });
    }

    // Get assigned site
    const site = await Site.findById(guard.assignedSiteId);
    
    let withinGeofence = null;
    let distance = null;

    if (site) {
      withinGeofence = isWithinGeofence(
        latitude,
        longitude,
        site.latitude,
        site.longitude,
        site.geofenceRadius
      );
      
      // Calculate distance
      distance = calculateDistance(
        latitude,
        longitude,
        site.latitude,
        site.longitude
      );
    }

    // Save location ping
    const ping = new LocationPing({
      guardId: guard._id,
      agencyId: guard.agencyId,
      siteId: guard.assignedSiteId,
      latitude,
      longitude,
      accuracy,
      timestamp: timestamp || new Date(),
      source: 'gps',
      withinGeofence
    });
    await ping.save();

    // Update guard's last location
    guard.lastLocationUpdate = {
      latitude,
      longitude,
      timestamp: new Date(),
      accuracy
    };
    await guard.save();

    res.json({
      success: true,
      data: {
        withinGeofence,
        distance: distance ? Math.round(distance) : null,
        site: site ? {
          id: site._id,
          name: site.name
        } : null
      }
    });
  } catch (error) {
    console.error('Location ping error:', error);
    res.status(500).json({ 
      success: false, 
      error: { message: 'Failed to process location', code: 'INTERNAL_ERROR' }
    });
  }
};

exports.validateGeofence = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    
    const guard = await Guard.findOne({ userId: req.userId });
    if (!guard) {
      return res.status(404).json({ 
        success: false, 
        error: { message: 'Guard not found', code: 'NOT_FOUND' }
      });
    }

    const site = await Site.findById(guard.assignedSiteId);
    if (!site) {
      return res.status(404).json({ 
        success: false, 
        error: { message: 'Site not found', code: 'NOT_FOUND' }
      });
    }

    const isInside = isWithinGeofence(
      latitude,
      longitude,
      site.latitude,
      site.longitude,
      site.geofenceRadius
    );

    const distance = calculateDistance(
      latitude,
      longitude,
      site.latitude,
      site.longitude
    );

    res.json({
      success: true,
      data: {
        isInside,
        distance: Math.round(distance),
        siteId: site._id,
        siteName: site.name,
        geofenceRadius: site.geofenceRadius
      }
    });
  } catch (error) {
    console.error('Geofence validation error:', error);
    res.status(500).json({ 
      success: false, 
      error: { message: 'Failed to validate geofence', code: 'INTERNAL_ERROR' }
    });
  }
};

// Helper: Calculate distance between two coordinates
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}