import bcrypt from 'bcryptjs';
import { supabase } from '../db/supabase.js';
import { encryptCredential, decryptCredential } from '../utils/crypto.js';

export class EmployeesController {
  /**
   * POST /api/hrm/employees
   * Accessible by: owner, branch_manager
   */
  static async create(req, res) {
    try {
      const {
        name,
        email,
        password,
        role,
        department,
        monthly_salary = 0,
        joined_date,
        employee_code,
        phone_number,
        mobile,
        phone,
        branch_ids = [],
        shift_assignments = [],
      } = req.body;

      const empPhone = phone_number || mobile || phone || null;

      if (!name || !email || !password || !role) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Name, email, password, and role are required',
          },
        });
      }

      if (typeof password !== 'string' || password.trim().length < 6) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Password must be at least 6 characters long',
          },
        });
      }

      if (role !== 'employee' && role !== 'branch_manager') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_ROLE',
            message: "Role must be 'employee' or 'branch_manager'",
          },
        });
      }

      // Branch Manager check: can only assign branches within their own scope
      if (req.user.role === 'branch_manager') {
        const allowedBranches = req.scopedBranchIds || [];
        const invalidBranch = branch_ids.find((bId) => !allowedBranches.includes(bId));
        if (invalidBranch) {
          return res.status(403).json({
            success: false,
            error: {
              code: 'FORBIDDEN_BRANCH',
              message: `You cannot assign branch ${invalidBranch} outside your assigned branches`,
            },
          });
        }
      }

      // Hash password with bcrypt
      const salt = await bcrypt.genSalt(10);
      const password_hash = await bcrypt.hash(password, salt);
      // Encrypt password with AES-256-GCM for secure at-rest storage
      const encryptedPassword = encryptCredential(password);

      // 1. Insert User
      let insertUserPayload = {
        name,
        email: email.toLowerCase().trim(),
        password_hash,
        current_password: encryptedPassword,
        role,
        is_active: true,
      };

      let { data: newUser, error: userError } = await supabase
        .from('users')
        .insert(insertUserPayload)
        .select('id, name, email, role, is_active, created_at')
        .single();

      // If current_password column is not yet in Supabase schema, fallback to inserting without it
      if (userError && userError.code === 'PGRST204') {
        const { current_password, ...payloadWithoutPw } = insertUserPayload;
        const { data: fallbackUser, error: fallbackError } = await supabase
          .from('users')
          .insert(payloadWithoutPw)
          .select('id, name, email, role, is_active, created_at')
          .single();

        if (fallbackError) {
          userError = fallbackError;
        } else {
          newUser = fallbackUser;
          userError = null;
        }
      }

      if (userError) {
        if (userError.code === '23505') {
          return res.status(409).json({
            success: false,
            error: {
              code: 'EMAIL_EXISTS',
              message: 'A user with this email already exists',
            },
          });
        }
        return res.status(500).json({
          success: false,
          error: { code: 'DB_ERROR', message: userError.message },
        });
      }

      const userId = newUser.id;

      const salaryValue = req.user.role === 'owner' ? (Number(monthly_salary) || 0) : 0;

      // 2. Insert Employee Profile
      const { data: profile, error: profileError } = await supabase
        .from('employee_profiles')
        .insert({
          user_id: userId,
          employee_code: employee_code || null,
          department: department || null,
          monthly_salary: salaryValue,
          joined_date: joined_date || null,
          phone_number: empPhone,
        })
        .select()
        .single();

      if (profileError) {
        console.error('Error creating profile:', profileError);
      }

      // 3. Insert Branch Assignments
      if (Array.isArray(branch_ids) && branch_ids.length > 0) {
        const assignments = branch_ids.map((bId) => ({
          employee_id: userId,
          branch_id: bId,
        }));

        await supabase.from('branch_employee_assignments').insert(assignments);

        if (role === 'branch_manager') {
          const managerAssignments = branch_ids.map((bId) => ({
            user_id: userId,
            branch_id: bId,
          }));
          await supabase.from('branch_managers').insert(managerAssignments);
        }
      }

      let sanitizedProfile = profile ? { ...profile } : null;
      if (req.user.role !== 'owner' && userId !== req.user.id) {
        if (sanitizedProfile) {
          delete sanitizedProfile.monthly_salary;
        }
      }

      // 4. Insert Shift Assignments if provided
      if (Array.isArray(shift_assignments) && shift_assignments.length > 0) {
        const rows = shift_assignments.map((sa) => ({
          employee_id: userId,
          schedule_id: sa.schedule_id,
          salary: Number(sa.salary) || 0,
        }));
        await supabase.from('employee_shift_assignments').insert(rows);

        if (shift_assignments[0]?.schedule_id) {
          await supabase.from('employee_schedule_overrides').upsert(
            { employee_id: userId, schedule_id: shift_assignments[0].schedule_id },
            { onConflict: 'employee_id' }
          );
        }
      }

      return res.status(201).json({
        success: true,
        employee: {
          ...newUser,
          profile: sanitizedProfile,
          branch_ids,
          shift_assignments,
        },
      });
    } catch (err) {
      console.error('Create employee error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * GET /api/hrm/employees
   * Query: ?branch_id=&role=&search=&page=1&limit=20
   */
  static async list(req, res) {
    try {
      const { branch_id, role, search, is_active, page = 1, limit = 20 } = req.query;
      const pageNum = Math.max(1, parseInt(page, 10));
      const limitNum = Math.min(1000, Math.max(1, parseInt(limit, 10)));
      const offset = (pageNum - 1) * limitNum;

      let query = supabase
        .from('users')
        .select(
          `
          id,
          name,
          email,
          role,
          is_active,
          created_at,
          employee_profiles (
            employee_code,
            department,
            monthly_salary,
            joined_date,
            phone_number
          ),
          branch_employee_assignments (
            branch_id,
            branches (
              id,
              name,
              address
            )
          )
        `,
          { count: 'exact' }
        )
        .neq('role', 'owner'); // Usually exclude owner from standard employee list

      if (is_active !== undefined) {
        query = query.eq('is_active', is_active === 'true' || is_active === true);
      }

      if (role) {
        query = query.eq('role', role);
      }

      if (search) {
        query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
      }

      // Handle Branch Manager Scoping
      if (req.user.role === 'branch_manager') {
        const scopedIds = req.scopedBranchIds || [];
        if (scopedIds.length === 0) {
          return res.status(200).json({
            success: true,
            total: 0,
            page: pageNum,
            limit: limitNum,
            employees: [],
          });
        }
      }

      const { data: users, count, error } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + limitNum - 1);

      if (error) {
        return res.status(500).json({
          success: false,
          error: { code: 'DB_ERROR', message: error.message },
        });
      }

      // Format response & apply post-filter for branch if necessary
      let formatted = users.map((u) => {
        const profile = Array.isArray(u.employee_profiles)
          ? u.employee_profiles[0]
          : u.employee_profiles;
        const branches = (u.branch_employee_assignments || [])
          .map((a) => a.branches)
          .filter(Boolean);

        const empData = {
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          is_active: u.is_active,
          employee_code: profile?.employee_code || null,
          department: profile?.department || null,
          joined_date: profile?.joined_date || null,
          phone_number: profile?.phone_number || u.phone_number || null,
          branches,
        };

        // Only include monthly_salary and current_password if owner
        if (req.user.role === 'owner') {
          empData.monthly_salary = profile?.monthly_salary ? Number(profile.monthly_salary) : 0;
          if (u.current_password) {
            empData.current_password = decryptCredential(u.current_password);
          }
        }

        return empData;
      });

      // Branch filter
      if (branch_id) {
        formatted = formatted.filter((emp) =>
          emp.branches.some((b) => b.id === branch_id)
        );
      }

      // Scoped branch filter for branch managers
      if (req.user.role === 'branch_manager') {
        const scopedIds = new Set(req.scopedBranchIds || []);
        formatted = formatted.filter((emp) =>
          emp.branches.some((b) => scopedIds.has(b.id))
        );
      }

      return res.status(200).json({
        success: true,
        total: count || formatted.length,
        page: pageNum,
        limit: limitNum,
        employees: formatted,
      });
    } catch (err) {
      console.error('List employees error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * GET /api/hrm/employees/:id
   */
  static async getById(req, res) {
    try {
      const { id } = req.params;

      const { data: user, error } = await supabase
        .from('users')
        .select(
          `
          id,
          name,
          email,
          role,
          is_active,
          created_at,
          current_password,
          employee_profiles (*),
          employee_shift_assignments (
            id,
            schedule_id,
            salary,
            work_schedules (*)
          ),
          employee_schedule_overrides (
            schedule_id,
            work_schedules (*)
          ),
          branch_employee_assignments (
            branch_id,
            branches (*)
          )
        `
        )
        .eq('id', id)
        .maybeSingle();

      if (error || !user) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Employee not found' },
        });
      }

      const branches = (user.branch_employee_assignments || [])
        .map((a) => a.branches)
        .filter(Boolean);

      // Branch manager security check
      if (req.user.role === 'branch_manager') {
        const scopedIds = new Set(req.scopedBranchIds || []);
        const hasAccess = branches.some((b) => scopedIds.has(b.id));
        if (!hasAccess && user.id !== req.user.id) {
          return res.status(403).json({
            success: false,
            error: {
              code: 'FORBIDDEN',
              message: 'You do not have access to this employee',
            },
          });
        }
      }

      const rawProfile = Array.isArray(user.employee_profiles)
        ? user.employee_profiles[0]
        : user.employee_profiles;

      let profile = rawProfile ? { ...rawProfile } : null;

      // Hide monthly_salary if caller is a branch_manager and not fetching their own profile
      if (req.user.role !== 'owner') {
        if (profile) {
          delete profile.monthly_salary;
        }
      }

      const scheduleOverride = Array.isArray(user.employee_schedule_overrides)
        ? user.employee_schedule_overrides[0]
        : user.employee_schedule_overrides;

      const employeeData = {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        is_active: user.is_active,
        created_at: user.created_at,
        profile,
        schedule: scheduleOverride?.work_schedules || null,
        schedule_override_id: scheduleOverride?.schedule_id || null,
        branches,
        shift_assignments: (user.employee_shift_assignments || []).map((sa) => ({
          id: sa.id,
          schedule_id: sa.schedule_id,
          salary: Number(sa.salary) || 0,
          schedule: sa.work_schedules || null,
        })),
      };

      // Include current_password strictly for owner (decrypted at rest)
      if (req.user.role === 'owner' && user.current_password) {
        employeeData.current_password = decryptCredential(user.current_password);
      }

      return res.status(200).json({
        success: true,
        employee: employeeData,
      });
    } catch (err) {
      console.error('Get employee error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * GET /api/hrm/employees/:id/password
   * Accessible by: owner only
   */
  static async getPassword(req, res) {
    try {
      const { id } = req.params;

      const { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error || !user) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'User not found' },
        });
      }

      return res.status(200).json({
        success: true,
        user_id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        is_active: user.is_active,
        current_password: decryptCredential(user.current_password) || null,
      });
    } catch (err) {
      console.error('Get password error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * PUT /api/hrm/employees/:id/password
   * Accessible by: owner only
   * Body: { "new_password": "..." }
   */
  static async changePassword(req, res) {
    try {
      const { id } = req.params;
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

      // 1. Verify user exists
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('id, name, email, role')
        .eq('id', id)
        .maybeSingle();

      if (userError || !user) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'User not found' },
        });
      }

      // 2. Hash new password with bcrypt
      const salt = await bcrypt.genSalt(10);
      const password_hash = await bcrypt.hash(new_password.trim(), salt);

      // 3. Encrypt password with AES-256-GCM for secure at-rest storage
      const encryptedPassword = encryptCredential(new_password.trim());

      // 4. Update users table with password_hash and encrypted current_password
      let updateData = {
        password_hash,
        current_password: encryptedPassword,
      };

      let { data: updated, error: updateError } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', id)
        .select('id, name, email, role, is_active')
        .single();

      // If current_password column is not yet in Supabase schema, fallback to updating just password_hash
      if (updateError && updateError.code === 'PGRST204') {
        const { data: fallbackUpdated, error: fallbackError } = await supabase
          .from('users')
          .update({ password_hash })
          .eq('id', id)
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

  /**
   * PUT /api/hrm/employees/:id/status
   * Accessible by: owner only
   * Body: { "is_active": true | false }
   */
  static async updateStatus(req, res) {
    try {
      const { id } = req.params;
      const { is_active } = req.body;

      if (typeof is_active !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'is_active (boolean: true or false) is required',
          },
        });
      }

      // Prevent owner from deactivating their own account
      if (id === req.user.id && !is_active) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'CANNOT_DEACTIVATE_SELF',
            message: 'Owner cannot deactivate their own account',
          },
        });
      }

      const { data: user, error: userError } = await supabase
        .from('users')
        .update({ is_active })
        .eq('id', id)
        .select('id, name, email, role, is_active')
        .single();

      if (userError || !user) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'User not found' },
        });
      }

      return res.status(200).json({
        success: true,
        message: `User account ${is_active ? 'activated' : 'deactivated'} successfully`,
        user,
      });
    } catch (err) {
      console.error('Update status error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * PUT /api/hrm/employees/:id
   */
  static async update(req, res) {
    try {
      const { id } = req.params;
      const {
        name,
        department,
        monthly_salary,
        joined_date,
        employee_code,
        branch_ids,
        schedule_id,
        shift_assignments,
        phone_number,
        mobile,
        phone,
        is_active,
      } = req.body;

      const empPhone = phone_number !== undefined ? phone_number : (mobile !== undefined ? mobile : phone);

      // 1. Verify employee existence
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('id, role')
        .eq('id', id)
        .maybeSingle();

      if (userError || !user) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Employee not found' },
        });
      }

      // 2. Update users table if name provided, or is_active provided by owner
      const userUpdates = {};
      if (name !== undefined) userUpdates.name = name;
      if (is_active !== undefined && req.user.role === 'owner') {
        userUpdates.is_active = Boolean(is_active);
      }

      if (Object.keys(userUpdates).length > 0) {
        await supabase.from('users').update(userUpdates).eq('id', id);
      }

      // 3. Update employee_profiles table
      const profileUpdates = {};
      if (department !== undefined) profileUpdates.department = department;
      // Only owner can update monthly_salary
      if (monthly_salary !== undefined && req.user.role === 'owner') {
        profileUpdates.monthly_salary = Number(monthly_salary);
      }
      if (joined_date !== undefined) profileUpdates.joined_date = joined_date;
      if (employee_code !== undefined) profileUpdates.employee_code = employee_code;
      if (empPhone !== undefined) profileUpdates.phone_number = empPhone;

      if (Object.keys(profileUpdates).length > 0) {
        await supabase
          .from('employee_profiles')
          .upsert({ user_id: id, ...profileUpdates }, { onConflict: 'user_id' });
      }

      // 4. Sync branch assignments if branch_ids provided
      if (Array.isArray(branch_ids)) {
        if (req.user.role === 'branch_manager') {
          const allowed = req.scopedBranchIds || [];
          const invalid = branch_ids.find((b) => !allowed.includes(b));
          if (invalid) {
            return res.status(403).json({
              success: false,
              error: {
                code: 'FORBIDDEN_BRANCH',
                message: `Cannot assign branch ${invalid} outside your management scope`,
              },
            });
          }
        }

        // Delete existing and insert new
        await supabase
          .from('branch_employee_assignments')
          .delete()
          .eq('employee_id', id);

        if (branch_ids.length > 0) {
          const newAssignments = branch_ids.map((bId) => ({
            employee_id: id,
            branch_id: bId,
          }));
          await supabase.from('branch_employee_assignments').insert(newAssignments);
        }
      }

      // 4b. Update Shift Assignments if provided
      if (Array.isArray(shift_assignments)) {
        await supabase
          .from('employee_shift_assignments')
          .delete()
          .eq('employee_id', id);

        if (shift_assignments.length > 0) {
          const rows = shift_assignments.map((sa) => ({
            employee_id: id,
            schedule_id: sa.schedule_id,
            salary: Number(sa.salary) || 0,
          }));
          await supabase.from('employee_shift_assignments').insert(rows);

          if (shift_assignments[0]?.schedule_id) {
            await supabase.from('employee_schedule_overrides').upsert(
              { employee_id: id, schedule_id: shift_assignments[0].schedule_id },
              { onConflict: 'employee_id' }
            );
          }

          if (req.user.role === 'owner') {
            const totalSalary = rows.reduce((acc, r) => acc + r.salary, 0);
            if (totalSalary > 0) {
              await supabase
                .from('employee_profiles')
                .update({ monthly_salary: totalSalary })
                .eq('user_id', id);
            }
          }
        }
      }

      // 5. Update schedule override if provided
      if (schedule_id !== undefined) {
        if (schedule_id === null) {
          await supabase
            .from('employee_schedule_overrides')
            .delete()
            .eq('employee_id', id);
        } else {
          await supabase
            .from('employee_schedule_overrides')
            .upsert(
              { employee_id: id, schedule_id },
              { onConflict: 'employee_id' }
            );
        }
      }

      return res.status(200).json({
        success: true,
        message: 'Employee updated successfully',
      });
    } catch (err) {
      console.error('Update employee error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }

  /**
   * DELETE /api/hrm/employees/:id
   * Soft delete: set is_active = false
   * Accessible by: owner only
   */
  static async remove(req, res) {
    try {
      const { id } = req.params;

      const { data, error } = await supabase
        .from('users')
        .update({ is_active: false })
        .eq('id', id)
        .select()
        .single();

      if (error || !data) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Employee not found' },
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Employee successfully deactivated (soft deleted)',
      });
    } catch (err) {
      console.error('Delete employee error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  }
}

export default EmployeesController;

