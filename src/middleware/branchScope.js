export const branchScope = (req, res, next) => {
  const headerBranchId = req.headers['x-branch-id'];

  if (req.user && (req.user.role === 'branch_manager' || req.user.role === 'admin')) {
    const allowed = Array.isArray(req.user.branchIds) ? req.user.branchIds : [];
    if (headerBranchId && headerBranchId !== 'all' && allowed.includes(headerBranchId)) {
      req.scopedBranchIds = [headerBranchId];
      if (!req.query.branch_id) {
        req.query.branch_id = headerBranchId;
      }
    } else {
      req.scopedBranchIds = allowed;
    }
  } else if (req.user && req.user.role === 'owner' && headerBranchId && headerBranchId !== 'all') {
    req.scopedBranchIds = [headerBranchId];
    if (!req.query.branch_id) {
      req.query.branch_id = headerBranchId;
    }
  } else {
    req.scopedBranchIds = null;
  }
  next();
};

export default branchScope;
