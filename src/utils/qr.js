import QRCode from 'qrcode';

/**
 * Generates JSON payload string for a branch's QR code.
 * @param {object} branch - Branch database row
 * @param {string} type - 'static' | 'dynamic'
 * @returns {string} JSON string
 */
export const generateQRPayload = (branch, type = 'static') => {
  const qrType = type || branch.qr_type || 'static';
  if (qrType === 'dynamic') {
    const ts = Math.floor(Date.now() / 30000); // 30-second window bucket
    return JSON.stringify({
      type: 'dynamic',
      secret: branch.qr_secret,
      branch_id: branch.id,
      ts,
    });
  }

  return JSON.stringify({
    type: 'static',
    secret: branch.qr_secret,
    branch_id: branch.id,
  });
};

/**
 * Validates a scanned QR payload string against the branch record.
 * @param {string} payloadString
 * @param {object} branch
 * @returns {{ valid: boolean, branch_id?: string }}
 */
export const validateQRPayload = (payloadString, branch) => {
  try {
    if (!payloadString || !branch) {
      return { valid: false };
    }

    const parsed = typeof payloadString === 'object' ? payloadString : JSON.parse(payloadString);

    if (!parsed || !parsed.secret || !parsed.branch_id) {
      return { valid: false };
    }

    if (parsed.branch_id !== branch.id) {
      return { valid: false };
    }

    if (parsed.secret !== branch.qr_secret) {
      return { valid: false };
    }

    // Enforce dynamic QR requirement if configured on branch or if payload is dynamic
    const requiresDynamic = branch.qr_type === 'dynamic';
    if (requiresDynamic || parsed.type === 'dynamic') {
      if (parsed.type !== 'dynamic' || !parsed.ts) {
        return { valid: false, reason: 'DYNAMIC_QR_REQUIRED' };
      }

      const currentWindow = Math.floor(Date.now() / 30000); // 30-second window
      const prevWindow = currentWindow - 1;
      if (parsed.ts !== currentWindow && parsed.ts !== prevWindow) {
        return { valid: false, reason: 'EXPIRED_QR' };
      }
    }

    return {
      valid: true,
      branch_id: parsed.branch_id,
    };
  } catch (err) {
    return { valid: false };
  }
};

/**
 * Generates a base64 Data URL PNG image for the given payload string.
 * @param {string} payloadString
 * @returns {Promise<string>} Base64 PNG data URL
 */
export const generateQRImage = async (payloadString) => {
  return QRCode.toDataURL(payloadString, {
    errorCorrectionLevel: 'H',
    type: 'image/png',
    margin: 2,
    width: 300,
  });
};

export default {
  generateQRPayload,
  validateQRPayload,
  generateQRImage,
};
