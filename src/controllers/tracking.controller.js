import { TrackingService } from '../services/tracking.service.js';

export class TrackingController {
  /**
   * POST /api/hrm/tracking/batch
   * Ingest batched GPS points from mobile app
   * Accessible by: employee, branch_manager, owner
   */
  static async ingestBatch(req, res) {
    try {
      const employeeId = req.user.id;
      const result = await TrackingService.ingestBatch(employeeId, req.body);

      return res.status(200).json({
        success: true,
        message: 'Location batch synced successfully',
        ...result,
      });
    } catch (err) {
      console.error('Ingest location batch error:', err);
      return res.status(err.status || 500).json({
        success: false,
        error: {
          code: err.code || 'SERVER_ERROR',
          message: err.message || 'Failed to sync location batch',
        },
      });
    }
  }

  static async getLiveLocations(req, res) {
    try {
      const { branch_id, search, status } = req.query;
      const scopedBranchIds = req.user.role === 'branch_manager' ? req.scopedBranchIds : undefined;

      const locations = await TrackingService.getLiveLocations({
        branch_id,
        search,
        status,
        scopedBranchIds,
      });

      return res.status(200).json({
        success: true,
        count: locations.length,
        locations,
        data: locations,
      });
    } catch (err) {
      console.error('Get live tracking error:', err);
      return res.status(err.status || 500).json({
        success: false,
        error: {
          code: err.code || 'SERVER_ERROR',
          message: err.message || 'Failed to fetch live locations',
        },
      });
    }
  }

  /**
   * GET /api/hrm/tracking/history
   * Query: ?employee_id=UUID&date=YYYY-MM-DD
   * Accessible by: owner, branch_manager
   */
  static async getEmployeeHistory(req, res) {
    try {
      const { employee_id, date } = req.query;

      if (!employee_id || !date) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Both employee_id and date parameters are required',
          },
        });
      }

      const history = await TrackingService.getEmployeeHistory(employee_id, date);

      return res.status(200).json({
        success: true,
        history,
        data: history,
      });
    } catch (err) {
      console.error('Get location history error:', err);
      return res.status(err.status || 500).json({
        success: false,
        error: {
          code: err.code || 'SERVER_ERROR',
          message: err.message || 'Failed to fetch location history',
        },
      });
    }
  }
}

export default TrackingController;
