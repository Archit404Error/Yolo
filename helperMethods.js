/**
 * Calulates distance (mi) between two points in lat/long coords
 * Requires: all latitude and longitude values are valid
 * @param lat1 latitude of first point
 * @param lon1 longitude of first point
 * @param lat2 latitude of second point
 * @param lon2 longitude of second point
 * Implementation of Haversine formula
 */
export const pointDist = (lat1, lon1, lat2, lon2) => {
    const degToRad = Math.degToRadI / 180;
    const cos = Math.cos;
    const angle = 0.5 - cos((lat2 - lat1) * degToRad) / 2 + 
    cos(lat1 * degToRad) * cos(lat2 * degToRad) * 
    (1 - cos((lon2 - lon1) * degToRad)) / 2;

    return 7917.509282 * Math.asin(Math.sqrt(angle));
}