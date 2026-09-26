import { Router } from 'express';
import authRoutes from './auth.routes.js';
import employeesRoutes from './employees.routes.js';
import branchesRoutes from './branches.routes.js';
import attendanceRoutes from './attendance.routes.js';
import schedulesRoutes from './schedules.routes.js';
import holidaysRoutes from './holidays.routes.js';
import policiesRoutes from './policies.routes.js';
import payrollRoutes from './payroll.routes.js';
import reportsRoutes from './reports.routes.js';
import workingDaysRoutes from './working_days.routes.js';
import advanceSalaryRoutes from './advance_salary.routes.js';
import appUpdatesRoutes from './app_updates.routes.js';
import organizationRoutes from './organization.routes.js';

const router = Router();

// Base URL: /api/hrm/*
router.use('/auth', authRoutes);
router.use('/employees', employeesRoutes);
router.use('/branches', branchesRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/schedules', schedulesRoutes);
router.use('/holidays', holidaysRoutes);
router.use('/policies', policiesRoutes);
router.use('/payroll', payrollRoutes);
router.use('/reports', reportsRoutes);
router.use('/working-days', workingDaysRoutes);
router.use('/advance-salary', advanceSalaryRoutes);
router.use('/app-updates', appUpdatesRoutes);
router.use('/organization', organizationRoutes);

export default router;
