import { supabase } from '../db/supabase.js';

/**
 * Resolves whether lunch/break tracking is enabled for a given user & branch.
 * Hierarchy: Employee Override -> Branch Override -> Organization Global Setting
 */
export async function resolveLunchTrackingEnabled({ userLunchMode, branchId, branchLunchMode }) {
  // 1. Employee-level override
  if (userLunchMode === 'enabled') return true;
  if (userLunchMode === 'disabled') return false;

  // 2. Branch-level override
  let resolvedBranchMode = branchLunchMode;
  if (!resolvedBranchMode && branchId) {
    const { data: branch } = await supabase
      .from('branches')
      .select('lunch_tracking_mode')
      .eq('id', branchId)
      .maybeSingle();
    resolvedBranchMode = branch?.lunch_tracking_mode;
  }

  if (resolvedBranchMode === 'enabled') return true;
  if (resolvedBranchMode === 'disabled') return false;

  // 3. Organization-level global setting (Default: true if not set)
  try {
    const { data: orgSetting } = await supabase
      .from('organization_settings')
      .select('value')
      .eq('key', 'lunch_tracking')
      .maybeSingle();

    if (orgSetting && orgSetting.value !== undefined) {
      if (typeof orgSetting.value === 'object' && orgSetting.value !== null) {
        return Boolean(orgSetting.value.enabled ?? true);
      }
      return Boolean(orgSetting.value);
    }
  } catch (err) {
    console.warn('Error reading global lunch_tracking setting:', err.message);
  }

  return true;
}

/**
 * Retrieves the global lunch tracking organization setting
 */
export async function getGlobalLunchTrackingSettings() {
  try {
    const { data } = await supabase
      .from('organization_settings')
      .select('value')
      .eq('key', 'lunch_tracking')
      .maybeSingle();

    if (data && data.value) {
      return {
        enabled: Boolean(data.value.enabled ?? true),
      };
    }
  } catch (err) {
    console.warn('Failed to read global lunch tracking setting:', err.message);
  }
  return { enabled: true };
}
