export const branchScope = (req, res, next) => {
  if (req.user && req.user.role === 'branch_manager') {
    req.scopedBranchIds = Array.isArray(req.user.branchIds) ? req.user.branchIds : [];
  } else {
    req.scopedBranchIds = null;
  }
  next();
};

export default branchScope;
