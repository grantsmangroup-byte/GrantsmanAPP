// ========== src/utils/geofence.js ==========

/**
 * Calculate distance between two coordinates using Haversine formula
 * @param {number} lat1 - Latitude of point 1
 * @param {number} lon1 - Longitude of point 1
 * @param {number} lat2 - Latitude of point 2
 * @param {number} lon2 - Longitude of point 2
 * @returns {number} Distance in meters
 */
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

/**
 * Check if a point is within a circular geofence
 * @param {number} pointLat - Latitude of the point to check
 * @param {number} pointLon - Longitude of the point to check
 * @param {number} centerLat - Latitude of the geofence center
 * @param {number} centerLon - Longitude of the geofence center
 * @param {number} radiusMeters - Geofence radius in meters
 * @returns {boolean} True if point is inside geofence
 */
function isWithinGeofence(pointLat, pointLon, centerLat, centerLon, radiusMeters) {
  const distance = calculateDistance(pointLat, pointLon, centerLat, centerLon);
  return distance <= radiusMeters;
}

/**
 * Get the status of a location relative to geofence
 * @param {number} pointLat - Latitude of the point to check
 * @param {number} pointLon - Longitude of the point to check
 * @param {number} centerLat - Latitude of the geofence center
 * @param {number} centerLon - Longitude of the geofence center
 * @param {number} radiusMeters - Geofence radius in meters
 * @returns {object} Status object with isInside and distance
 */
function getGeofenceStatus(pointLat, pointLon, centerLat, centerLon, radiusMeters) {
  const distance = calculateDistance(pointLat, pointLon, centerLat, centerLon);
  return {
    isInside: distance <= radiusMeters,
    distance: Math.round(distance),
    radiusMeters: radiusMeters
  };
}

module.exports = {
  calculateDistance,
  isWithinGeofence,
  getGeofenceStatus
};