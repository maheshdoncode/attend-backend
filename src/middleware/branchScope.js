export const branchScope = (req, res, next) => {
  const headerBranchId = req.headers['x-branch-id'];

  if (req.user && req.user.role === 'branch_manager') {
    req.scopedBranchIds = Array.isArray(req.user.branchIds) ? req.user.branchIds : [];
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
