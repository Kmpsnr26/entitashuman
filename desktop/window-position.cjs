'use strict';

const MIN_ELECTRON_COORDINATE = -2147483648;
const MAX_ELECTRON_COORDINATE = 2147483647;

/**
 * Convert a screen coordinate to an Electron-compatible signed 32-bit integer.
 * Return null for malformed or out-of-range coordinates rather than allowing
 * a native argument conversion error to terminate Electron's main process.
 */
function toElectronCoordinate(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (!Number.isSafeInteger(rounded)) return null;
  if (rounded < MIN_ELECTRON_COORDINATE || rounded > MAX_ELECTRON_COORDINATE) return null;
  return rounded;
}

module.exports = {
  MIN_ELECTRON_COORDINATE,
  MAX_ELECTRON_COORDINATE,
  toElectronCoordinate
};
