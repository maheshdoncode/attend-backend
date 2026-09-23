import crypto from 'crypto';
import { supabase } from '../db/supabase.js';
import { generateQRPayload, generateQRImage } from '../utils/qr.js';

export class BranchesController {
  /**
   * POST /api/hrm/branches
   * Accessible by: owner
   */
  static async create(req, res) {
    try {
      const {
        name,
        address,
        latitude,
        longitude,
        radius_meters = 100,
        qr_type = 'static',
      } = req.body;

      if (!name || latitude === undefined || longitude === undefined) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Name, latitude, and longitude are required',
          },
        });
      }

      // Generate 32-char hex secret
      const qr_secret = crypto.randomBytes(16).toString('hex');

      const { data: branch, error } = await supabase
        .from('branches')
        .insert({
          name,
          address: address || null,
          latitude: Number(latitude),
          longitude: Number(longitude),
          radius_meters: Number(radius_meters) || 100,
          qr_secret,
          qr_type: qr_type === 'dynamic' ? 'dynamic' : 'static',
          is_active: true,
        })
        .select()
        .single();

      if (error) {
        return res.status(500).json({
          success: false,
          error: { code: 'DB_ERROR', message: error.message },
        });
      }

      return res.status(201).json({
        success: true,
        branch,
      });
    } catch (err) {
      console.error('Create branch error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * GET /api/hrm/branches
   * Accessible by: owner, branch_manager
   */
  static async list(req, res) {
    try {
      let query = supabase.from('branches').select('*').eq('is_active', true);

      if (req.user.role === 'branch_manager') {
        const scopedIds = req.scopedBranchIds || [];
        if (scopedIds.length === 0) {
          return res.status(200).json({
            success: true,
            branches: [],
          });
        }
        query = query.in('id', scopedIds);
      }

      const { data: branches, error } = await query.order('name', { ascending: true });

      if (error) {
        return res.status(500).json({
          success: false,
          error: { code: 'DB_ERROR', message: error.message },
        });
      }

      return res.status(200).json({
        success: true,
        branches: branches || [],
      });
    } catch (err) {
      console.error('List branches error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * GET /api/hrm/branches/:id
   * Accessible by: owner, branch_manager
   */
  static async getById(req, res) {
    try {
      const { id } = req.params;

      if (req.user.role === 'branch_manager') {
        const scopedIds = req.scopedBranchIds || [];
        if (!scopedIds.includes(id)) {
          return res.status(403).json({
            success: false,
            error: {
              code: 'FORBIDDEN',
              message: 'You do not have access to manage this branch',
            },
          });
        }
      }

      const { data: branch, error } = await supabase
        .from('branches')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error || !branch) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Branch not found' },
        });
      }

      return res.status(200).json({
        success: true,
        branch,
      });
    } catch (err) {
      console.error('Get branch error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * PUT /api/hrm/branches/:id
   * Accessible by: owner
   */
  static async update(req, res) {
    try {
      const { id } = req.params;
      const { name, address, latitude, longitude, radius_meters, qr_type, is_active } =
        req.body;

      const updates = {};
      if (name !== undefined) updates.name = name;
      if (address !== undefined) updates.address = address;
      if (latitude !== undefined) updates.latitude = Number(latitude);
      if (longitude !== undefined) updates.longitude = Number(longitude);
      if (radius_meters !== undefined) updates.radius_meters = Number(radius_meters);
      if (qr_type !== undefined) updates.qr_type = qr_type;
      if (is_active !== undefined) updates.is_active = is_active;

      const { data: branch, error } = await supabase
        .from('branches')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error || !branch) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Branch not found' },
        });
      }

      return res.status(200).json({
        success: true,
        branch,
      });
    } catch (err) {
      console.error('Update branch error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * DELETE /api/hrm/branches/:id
   * Accessible by: owner (Soft delete: is_active = false)
   */
  static async remove(req, res) {
    try {
      const { id } = req.params;

      const { data, error } = await supabase
        .from('branches')
        .update({ is_active: false })
        .eq('id', id)
        .select()
        .single();

      if (error || !data) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Branch not found' },
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Branch successfully deactivated (soft deleted)',
      });
    } catch (err) {
      console.error('Delete branch error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * GET /api/hrm/branches/:id/qr
   * Accessible by: owner, branch_manager
   */
  static async getQR(req, res) {
    try {
      const { id } = req.params;

      if (req.user.role === 'branch_manager') {
        const scopedIds = req.scopedBranchIds || [];
        if (!scopedIds.includes(id)) {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Access denied for this branch' },
          });
        }
      }

      const { data: branch, error } = await supabase
        .from('branches')
        .select('*')
        .eq('id', id)
        .eq('is_active', true)
        .maybeSingle();

      if (error || !branch) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Active branch not found' },
        });
      }

      const qrType = branch.qr_type || 'static';
      const payloadString = generateQRPayload(branch, qrType);
      const qrBase64 = await generateQRImage(payloadString);

      let expiresAt = null;
      if (qrType === 'dynamic') {
        const currentMinute = Math.floor(Date.now() / 60000);
        expiresAt = new Date((currentMinute + 1) * 60000).toISOString();
      }

      return res.status(200).json({
        success: true,
        qr_base64: qrBase64,
        qr_type: qrType,
        branch_id: branch.id,
        branch_name: branch.name,
        payload_string: payloadString,
        expires_at: expiresAt,
      });
    } catch (err) {
      console.error('Get QR error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * POST /api/hrm/branches/:id/qr/regenerate
   * Accessible by: owner, branch_manager
   */
  static async regenerateQR(req, res) {
    try {
      const { id } = req.params;

      if (req.user.role === 'branch_manager') {
        const scopedIds = req.scopedBranchIds || [];
        if (!scopedIds.includes(id)) {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Access denied for this branch' },
          });
        }
      }

      const newSecret = crypto.randomBytes(16).toString('hex');

      const { data: branch, error } = await supabase
        .from('branches')
        .update({ qr_secret: newSecret })
        .eq('id', id)
        .select()
        .single();

      if (error || !branch) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Branch not found' },
        });
      }

      const qrType = branch.qr_type || 'static';
      const payloadString = generateQRPayload(branch, qrType);
      const qrBase64 = await generateQRImage(payloadString);

      let expiresAt = null;
      if (qrType === 'dynamic') {
        const currentMinute = Math.floor(Date.now() / 60000);
        expiresAt = new Date((currentMinute + 1) * 60000).toISOString();
      }

      return res.status(200).json({
        success: true,
        qr_base64: qrBase64,
        qr_type: qrType,
        branch_id: branch.id,
        branch_name: branch.name,
        payload_string: payloadString,
        expires_at: expiresAt,
      });
    } catch (err) {
      console.error('Regenerate QR error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }
}

export default BranchesController;
