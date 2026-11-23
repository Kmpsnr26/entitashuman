import test from 'node:test';
import assert from 'node:assert/strict';
import windowPosition from '../desktop/window-position.cjs';

const {MIN_ELECTRON_COORDINATE, MAX_ELECTRON_COORDINATE, toElectronCoordinate} = windowPosition;

test('window coordinates are rounded to Electron integer coordinates', () => {
  assert.equal(toElectronCoordinate(120.4), 120);
  assert.equal(toElectronCoordinate(-120.6), -121);
  assert.equal(toElectronCoordinate(0), 0);
});

test('window coordinate helper rejects invalid and out-of-range values', () => {
  for (const value of [undefined, null, '12', NaN, Infinity, -Infinity, 1e30, -1e30]) {
    assert.equal(toElectronCoordinate(value), null);
  }
});

test('window coordinate helper accepts signed 32-bit boundary values', () => {
  assert.equal(toElectronCoordinate(MIN_ELECTRON_COORDINATE), MIN_ELECTRON_COORDINATE);
  assert.equal(toElectronCoordinate(MAX_ELECTRON_COORDINATE), MAX_ELECTRON_COORDINATE);
  assert.equal(toElectronCoordinate(MAX_ELECTRON_COORDINATE + 1), null);
  assert.equal(toElectronCoordinate(MIN_ELECTRON_COORDINATE - 1), null);
});
