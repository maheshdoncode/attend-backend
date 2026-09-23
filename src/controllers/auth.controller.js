import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { supabase } from '../db/supabase.js';
import { getEmployeeSchedule, getEmployeeSchedules } from '../utils/schedule.js';
import { encryptCredential } from '../utils/crypto.js';

export class AuthController {
  /**
   * POST /api/hrm/auth/login
   */
  static async login(req, res) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Email and password are required',
          },
        });
      }

      // 1. Fetch user by email
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('email', email.toLowerCase().trim())
        .maybeSingle();

      if (userError || !user) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password',
          },
        });
      }

      // Check if user is active
      if (!user.is_active) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'ACCOUNT_DEACTIVATED',
            message: 'Your account has been deactivated. Please contact an administrator.',
          },
        });
      }

      // 2. Verify password with bcrypt
      const isMatch = await bcrypt.compare(password, user.password_hash);
      if (!isMatch) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password',
          },
        });
      }

      // 3. Fetch branchIds for branch_manager
      let branchIds = [];
      if (user.role === 'branch_manager') {
        const { data: bmBranches } = await supabase
          .from('branch_managers')
          .select('branch_id')
          .eq('user_id', user.id);

        if (bmBranches) {
          branchIds = bmBranches.map((b) => b.branch_id);
        }
      }

      // 4. Sign JWT
      const jwtSecret = process.env.JWT_SECRET || 'default_jwt_secret_change_in_production';
      const token = jwt.sign(
        {
          id: user.id,
          email: user.email,
          role: user.role,
          branchIds,
        },
        jwtSecret,
        { expiresIn: '24h' }
      );

      return res.status(200).json({
        success: true,
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          branchIds,
        },
      });
    } catch (err) {
      console.error('Login error:', err);
      return res.status(500).json({
        success: false,
        error: {
          code: 'SERVER_ERROR',
          message: err.message || 'Internal server error during login',
        },
      });
    }
  }

  /**
   * GET /api/hrm/auth/me
   */
  static async me(req, res) {
    try {
      const userId = req.user.id;

      const { data: user, error: userError } = await supabase
        .from('users')
        .select('id, name, email, role, is_active, created_at')
        .eq('id', userId)
        .maybeSingle();

      if (userError || !user) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User profile not found',
          },
        });
      }

      let profile = null;
      let branches = [];
      let schedule = null;
      let shift_assignments = [];

      if (user.role === 'employee' || user.role === 'branch_manager') {
        const { data: empProfile } = await supabase
          .from('employee_profiles')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle();
        profile = empProfile;
        if (user.role === 'employee' && profile) {
          const { monthly_salary, ...profileWithoutSalary } = profile;
          profile = profileWithoutSalary;
        }

        if (user.role === 'employee') {
          const { data: assignments } = await supabase
            .from('branch_employee_assignments')
            .select('branch_id, branches(*)')
            .eq('employee_id', userId);

          if (assignments) {
            branches = assignments.map((a) => a.branches).filter(Boolean);
          }

          schedule = await getEmployeeSchedule(userId);
          const rawSchedules = await getEmployeeSchedules(userId);
          shift_assignments = rawSchedules.map((a) => ({
            id: a.assignment_id || a.schedule_id,
            schedule_id: a.schedule_id,
            schedule: a.schedule,
          }));
        } else if (user.role === 'branch_manager') {
          const { data: bmBranches } = await supabase
            .from('branch_managers')
            .select('branch_id, branches(*)')
            .eq('user_id', userId);

          if (bmBranches) {
            branches = bmBranches.map((b) => b.branches).filter(Boolean);
          }
        }
      }

      return res.status(200).json({
        success: true,
        user: {
          ...user,
          profile,
          branches,
          schedule,
          shift_assignments,
        },
      });
    } catch (err) {
      console.error('Auth /me error:', err);
      return res.status(500).json({
        success: false,
        error: {
          code: 'SERVER_ERROR',
          message: err.message || 'Internal server error fetching user profile',
        },
      });
    }
  }

  /**
   * PUT /api/hrm/auth/change-password
   * Accessible by: owner only
   * Body: { "new_password": "...", "user_id": "(optional target user id)" }
   */
  static async changePassword(req, res) {
    try {
      const targetUserId = req.body.user_id || req.user.id;
      const { new_password } = req.body;

      if (!new_password || typeof new_password !== 'string' || new_password.trim().length < 6) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'new_password is required and must be at least 6 characters',
          },
        });
      }

      // Verify target user exists
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('id, name, email, role')
        .eq('id', targetUserId)
        .maybeSingle();

      if (userError || !user) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Target user not found' },
        });
      }

      const salt = await bcrypt.genSalt(10);
      const password_hash = await bcrypt.hash(new_password.trim(), salt);
      const encryptedPassword = encryptCredential(new_password.trim());

      let updateData = {
        password_hash,
        current_password: encryptedPassword,
      };

      let { data: updated, error: updateError } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', targetUserId)
        .select('id, name, email, role, is_active')
        .single();

      if (updateError && updateError.code === 'PGRST204') {
        const { data: fallbackUpdated, error: fallbackError } = await supabase
          .from('users')
          .update({ password_hash })
          .eq('id', targetUserId)
          .select('id, name, email, role, is_active')
          .single();

        if (fallbackError) {
          return res.status(500).json({
            success: false,
            error: { code: 'DB_ERROR', message: fallbackError.message },
          });
        }
        updated = fallbackUpdated;
      } else if (updateError) {
        return res.status(500).json({
          success: false,
          error: { code: 'DB_ERROR', message: updateError.message },
        });
      }

      return res.status(200).json({
        success: true,
        message: `Password changed successfully for ${user.name || user.email}`,
        user: {
          id: updated.id,
          name: updated.name,
          email: updated.email,
          role: updated.role,
        },
      });
    } catch (err) {
      console.error('Change password error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }
}

export default AuthController;

