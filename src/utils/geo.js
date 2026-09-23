import { getDistance, isPointWithinRadius as geolibIsWithinRadius } from 'geolib';

/**
 * Calculates Haversine distance in meters between two geographical points.
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @returns {number} Distance in meters
 */
export const haversineDistance = (lat1, lng1, lat2, lng2) => {
  return getDistance(
    { latitude: Number(lat1), longitude: Number(lng1) },
    { latitude: Number(lat2), longitude: Number(lng2) }
  );
};

/**
 * Checks if a user's coordinates are within a specified radius (in meters) of branch coordinates.
 * @param {number} userLat
 * @param {number} userLng
 * @param {number} branchLat
 * @param {number} branchLng
 * @param {number} radiusMeters
 * @returns {boolean}
 */
export const isWithinRadius = (userLat, userLng, branchLat, branchLng, radiusMeters) => {
  const radius = Number(radiusMeters) || 100;
  return geolibIsWithinRadius(
    { latitude: Number(userLat), longitude: Number(userLng) },
    { latitude: Number(branchLat), longitude: Number(branchLng) },
    radius
  );
};

export default {
  haversineDistance,
  isWithinRadius,
};
