import { supabase } from '../db/supabase.js';

/**
 * Calculates distance between two coordinates in kilometers using Haversine formula
 */
export function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  if (lat1 === lat2 && lon1 === lon2) return 0;
  const radlat1 = (Math.PI * lat1) / 180;
  const radlat2 = (Math.PI * lat2) / 180;
  const theta = lon1 - lon2;
  const radtheta = (Math.PI * theta) / 180;
  let dist =
    Math.sin(radlat1) * Math.sin(radlat2) +
    Math.cos(radlat1) * Math.cos(radlat2) * Math.cos(radtheta);
  if (dist > 1) dist = 1;
  dist = Math.acos(dist);
  dist = (dist * 180) / Math.PI;
  dist = dist * 60 * 1.1515 * 1.609344;
  return Math.max(0, dist);
}

export class TrackingService {
  /**
   * Ingests a batched payload of location points from an employee's mobile device
   */
  static async ingestBatch(employeeId, payload) {
    const {
      points = [],
      battery_level = null,
      is_moving = false,
      is_clocked_in = true,
    } = payload || {};

    const now = new Date();
    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);

    // Filter valid points with numbers
    const validPoints = (Array.isArray(points) ? points : [])
      .filter((p) => p && typeof p.lat === 'number' && typeof p.lng === 'number' && !isNaN(p.lat) && !isNaN(p.lng))
      .map((p) => ({
        lat: Number(p.lat),
        lng: Number(p.lng),
        t: p.timestamp || p.t || new Date().toISOString(),
        speed: Number(p.speed || 0),
        heading: Number(p.heading || 0),
        acc: Number(p.accuracy || p.acc || 0),
      }))
      .sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime());

    const latestPoint = validPoints.length > 0 ? validPoints[validPoints.length - 1] : null;

    // 1. Update/Upsert employee_live_locations (1 row per employee)
    const liveUpdate = {
      employee_id: employeeId,
      is_clocked_in: Boolean(is_clocked_in),
      is_moving: Boolean(is_moving || (latestPoint && latestPoint.speed > 2)),
      last_updated_at: new Date().toISOString(),
    };

    if (battery_level !== null && battery_level !== undefined) {
      liveUpdate.battery_level = Math.round(Number(battery_level));
    }

    if (latestPoint) {
      liveUpdate.latitude = latestPoint.lat;
      liveUpdate.longitude = latestPoint.lng;
      liveUpdate.accuracy = latestPoint.acc;
      liveUpdate.speed = latestPoint.speed;
      liveUpdate.heading = latestPoint.heading;
    }

    // Only update live table if we have position or existing row
    if (liveUpdate.latitude !== undefined || latestPoint) {
      const { error: liveErr } = await supabase
        .from('employee_live_locations')
        .upsert(liveUpdate, { onConflict: 'employee_id' });

      if (liveErr) {
        console.error(`❌ [LIVE LOCATION DB ERROR] Employee ${employeeId}:`, liveErr);
      } else {
        console.log(`📍 [LIVE LOCATION DB UPDATED] Employee ${employeeId} at (${liveUpdate.latitude}, ${liveUpdate.longitude}) | Speed: ${liveUpdate.speed} km/h`);
      }
    }

    // 2. Append points to employee_location_history for today
    if (validPoints.length > 0) {
      // Fetch existing history record for today
      const { data: existingHistory } = await supabase
        .from('employee_location_history')
        .select('*')
        .eq('employee_id', employeeId)
        .eq('date', todayStr)
        .maybeSingle();

      let currentPoints = [];
      let totalDistance = 0;
      let startTime = validPoints[0].t;
      let endTime = validPoints[validPoints.length - 1].t;

      if (existingHistory) {
        currentPoints = Array.isArray(existingHistory.points) ? existingHistory.points : [];
        totalDistance = Number(existingHistory.total_distance_km || 0);
        startTime = existingHistory.start_time || startTime;
      }

      // Append new points with displacement/time filter
      validPoints.forEach((np) => {
        if (currentPoints.length > 0) {
          const lastP = currentPoints[currentPoints.length - 1];
          const dist = calculateDistanceKm(lastP.lat, lastP.lng, np.lat, np.lng);
          // Append if moved > 5 meters or interval >= 30 seconds
          const timeDiffMs = Math.abs(new Date(np.t).getTime() - new Date(lastP.t).getTime());
          if (dist >= 0.005 || timeDiffMs >= 30 * 1000) {
            currentPoints.push(np);
            totalDistance += dist;
          }
        } else {
          currentPoints.push(np);
        }
      });

      const historyPayload = {
        employee_id: employeeId,
        date: todayStr,
        points: currentPoints,
        total_distance_km: Number(totalDistance.toFixed(2)),
        start_time: startTime,
        end_time: endTime,
        updated_at: new Date().toISOString(),
      };

      if (existingHistory && existingHistory.id) {
        const { error: updateErr } = await supabase
          .from('employee_location_history')
          .update({
            points: currentPoints,
            total_distance_km: Number(totalDistance.toFixed(2)),
            start_time: startTime,
            end_time: endTime,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingHistory.id);

        if (updateErr) {
          console.error(`❌ [HISTORY DB UPDATE ERROR] Employee ${employeeId}:`, updateErr);
        } else {
          console.log(`🗺️ [HISTORY DB UPDATED] Employee ${employeeId} | Total today points: ${currentPoints.length} | Total distance: ${historyPayload.total_distance_km} km`);
        }
      } else {
        const { error: insertErr } = await supabase
          .from('employee_location_history')
          .insert(historyPayload);

        if (insertErr) {
          console.error(`⚠️ [HISTORY DB INSERT ERROR, RETRYING UPSERT] Employee ${employeeId}:`, insertErr);
          const { error: upsertErr } = await supabase
            .from('employee_location_history')
            .upsert(historyPayload, { onConflict: 'employee_id,date' });
          if (upsertErr) {
            console.error(`❌ [HISTORY DB UPSERT ERROR] Employee ${employeeId}:`, upsertErr);
          } else {
            console.log(`🗺️ [HISTORY DB UPSERTED] Employee ${employeeId} | Points: ${currentPoints.length} | Distance: ${historyPayload.total_distance_km} km`);
          }
        } else {
          console.log(`🗺️ [HISTORY DB CREATED] Employee ${employeeId} | Points: ${currentPoints.length} | Distance: ${historyPayload.total_distance_km} km`);
        }
      }
    }

    return {
      success: true,
      ingested_points_count: validPoints.length,
      latest_point: latestPoint,
    };
  }

  /**
   * Returns all active employee live positions for Owner / Branch Manager Live Map
   */
  static async getLiveLocations(filters = {}) {
    const { branch_id, search, status, scopedBranchIds } = filters;

    // 1. Fetch live location rows with user profile & branch assignments
    let query = supabase
      .from('employee_live_locations')
      .select(`
        *,
        users!employee_live_locations_employee_id_fkey (
          id,
          name,
          role,
          is_active,
          employee_profiles (
            employee_code,
            department
          ),
          branch_employee_assignments (
            branch_id,
            branches (
              id,
              name,
              latitude,
              longitude,
              radius_meters
            )
          )
        )
      `);

    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

    const [liveRes, attendanceRes] = await Promise.all([
      query,
      supabase
        .from('attendance')
        .select('employee_id, clock_in_time, clock_out_time, status')
        .eq('date', todayStr),
    ]);

    if (liveRes.error) {
      console.error('Error fetching live locations:', liveRes.error);
      throw { status: 500, code: 'DB_ERROR', message: liveRes.error.message };
    }

    const attendanceMap = new Map();
    (attendanceRes.data || []).forEach((att) => {
      attendanceMap.set(att.employee_id, att);
    });

    const now = Date.now();

    const formatted = (liveRes.data || [])
      .filter((r) => r.users && r.users.is_active !== false)
      .map((r) => {
        const u = r.users;
        const profile = Array.isArray(u.employee_profiles) ? u.employee_profiles[0] : u.employee_profiles;
        const branchAssignment = u.branch_employee_assignments?.[0];
        const branch = branchAssignment?.branches;
        const att = attendanceMap.get(r.employee_id);

        const lastUpdatedMs = r.last_updated_at ? new Date(r.last_updated_at).getTime() : 0;
        const diffMinutes = Math.floor((now - lastUpdatedMs) / (1000 * 60));

        // Online status: updated within last 5 minutes
        const isOnline = diffMinutes <= 5;
        const statusLabel = isOnline ? 'Online' : 'Offline';

        return {
          employee_id: r.employee_id,
          name: u.name,
          role: u.role,
          employee_code: profile?.employee_code || null,
          department: profile?.department || 'General',
          branch_id: branch?.id || null,
          branch_name: branch?.name || 'Main Branch',
          branch_latitude: branch?.latitude ? Number(branch.latitude) : null,
          branch_longitude: branch?.longitude ? Number(branch.longitude) : null,
          latitude: Number(r.latitude),
          longitude: Number(r.longitude),
          accuracy: Number(r.accuracy || 0),
          speed: Number(r.speed || 0),
          heading: Number(r.heading || 0),
          battery_level: r.battery_level,
          is_moving: Boolean(r.is_moving),
          is_clocked_in: Boolean(r.is_clocked_in || att?.clock_in_time),
          clock_in_time: att?.clock_in_time || null,
          clock_out_time: att?.clock_out_time || null,
          is_online: isOnline,
          status_label: statusLabel,
          minutes_since_update: diffMinutes,
          last_updated_at: r.last_updated_at,
        };
      });

    // Apply branch filters
    let filtered = formatted;
    if (branch_id && branch_id !== 'all') {
      filtered = filtered.filter((item) => item.branch_id === branch_id);
    }

    if (scopedBranchIds && scopedBranchIds.length > 0) {
      const scopeSet = new Set(scopedBranchIds);
      filtered = filtered.filter((item) => item.branch_id && scopeSet.has(item.branch_id));
    }

    // Apply search query filter (name, employee code, department)
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter(
        (item) =>
          (item.name || '').toLowerCase().includes(q) ||
          (item.employee_code || '').toLowerCase().includes(q) ||
          (item.department || '').toLowerCase().includes(q)
      );
    }

    // Apply online/offline status filter
    if (status === 'online') {
      filtered = filtered.filter((item) => item.is_online);
    } else if (status === 'offline') {
      filtered = filtered.filter((item) => !item.is_online);
    }

    return filtered;
  }

  /**
   * Fetches full historical route, halts/stops, and statistics for an employee on a given date
   */
  static async getEmployeeHistory(employeeId, dateStr) {
    if (!employeeId || !dateStr) {
      throw { status: 400, code: 'VALIDATION_ERROR', message: 'employee_id and date are required' };
    }

    const [historyRes, empRes, attendanceRes] = await Promise.all([
      supabase
        .from('employee_location_history')
        .select('*')
        .eq('employee_id', employeeId)
        .eq('date', dateStr)
        .maybeSingle(),
      supabase
        .from('users')
        .select(`
          id,
          name,
          employee_profiles (employee_code, department),
          branch_employee_assignments (
            branch_id,
            branches (name, latitude, longitude, radius_meters)
          )
        `)
        .eq('id', employeeId)
        .single(),
      supabase
        .from('attendance')
        .select('clock_in_time, clock_out_time, status')
        .eq('employee_id', employeeId)
        .eq('date', dateStr)
        .maybeSingle(),
    ]);

    if (empRes.error || !empRes.data) {
      throw { status: 404, code: 'NOT_FOUND', message: 'Employee not found' };
    }

    const emp = empRes.data;
    const profile = Array.isArray(emp.employee_profiles) ? emp.employee_profiles[0] : emp.employee_profiles;
    const branch = emp.branch_employee_assignments?.[0]?.branches;

    const rawPoints = (historyRes.data?.points || []).map((p) => ({
      lat: Number(p.lat),
      lng: Number(p.lng),
      time: p.t || p.timestamp,
      speed: Number(p.speed || 0),
      heading: Number(p.heading || 0),
      accuracy: Number(p.acc || p.accuracy || 0),
    }));

    // If history points were empty, fallback to latest known live location for today
    if (rawPoints.length === 0) {
      const { data: liveLoc } = await supabase
        .from('employee_live_locations')
        .select('*')
        .eq('employee_id', employeeId)
        .maybeSingle();

      if (liveLoc && liveLoc.latitude && liveLoc.longitude) {
        rawPoints.push({
          lat: Number(liveLoc.latitude),
          lng: Number(liveLoc.longitude),
          time: liveLoc.last_updated_at || new Date().toISOString(),
          speed: Number(liveLoc.speed || 0),
          heading: Number(liveLoc.heading || 0),
          accuracy: Number(liveLoc.accuracy || 0),
        });
      }
    }

    // Detect Stops / Halts (stationary for > 4 minutes)
    const stops = [];
    let currentStopGroup = [];

    rawPoints.forEach((p, idx) => {
      const isSlow = p.speed < 2.5; // less than 2.5 km/h
      if (isSlow) {
        currentStopGroup.push(p);
      } else {
        if (currentStopGroup.length >= 3) {
          const first = currentStopGroup[0];
          const last = currentStopGroup[currentStopGroup.length - 1];
          const durationMins = Math.round(
            (new Date(last.time).getTime() - new Date(first.time).getTime()) / (1000 * 60)
          );
          if (durationMins >= 4) {
            stops.push({
              lat: Number(first.lat),
              lng: Number(first.lng),
              start_time: first.time,
              end_time: last.time,
              duration_minutes: durationMins,
              points_count: currentStopGroup.length,
            });
          }
        }
        currentStopGroup = [];
      }
    });

    // Check final group
    if (currentStopGroup.length >= 3) {
      const first = currentStopGroup[0];
      const last = currentStopGroup[currentStopGroup.length - 1];
      const durationMins = Math.round(
        (new Date(last.time).getTime() - new Date(first.time).getTime()) / (1000 * 60)
      );
      if (durationMins >= 4) {
        stops.push({
          lat: Number(first.lat),
          lng: Number(first.lng),
          start_time: first.time,
          end_time: last.time,
          duration_minutes: durationMins,
          points_count: currentStopGroup.length,
        });
      }
    }

    let maxSpeed = 0;
    rawPoints.forEach((p) => {
      if (p.speed > maxSpeed) maxSpeed = p.speed;
    });

    const totalDistanceKm = Number((historyRes.data?.total_distance_km || 0).toFixed(2));
    const totalStopsDurationMins = stops.reduce((acc, s) => acc + s.duration_minutes, 0);

    const clockInTime = attendanceRes.data?.clock_in_time || null;
    const clockOutTime = attendanceRes.data?.clock_out_time || null;

    return {
      employee: {
        id: emp.id,
        name: emp.name,
        employee_code: profile?.employee_code || null,
        department: profile?.department || 'General',
        branch_name: branch?.name || null,
        branch_latitude: branch?.latitude ? Number(branch.latitude) : null,
        branch_longitude: branch?.longitude ? Number(branch.longitude) : null,
      },
      date: dateStr,
      clock_in_time: clockInTime,
      clock_out_time: clockOutTime,
      attendance_status: attendanceRes.data?.status || null,
      total_points: rawPoints.length,
      total_distance_km: totalDistanceKm,
      max_speed_kmh: Number(maxSpeed.toFixed(1)),
      start_time: clockInTime,
      end_time: clockOutTime || (rawPoints.length > 0 ? rawPoints[rawPoints.length - 1].time : null),
      stops_count: stops.length,
      total_stopped_minutes: totalStopsDurationMins,
      stops,
      points: rawPoints,
    };
  }
}

export default TrackingService;
