'use strict';

const { MockBydClient } = require('./mockClient');
const { BydClient } = require('./bydClient');

function createBydClient(config, db) {
  if (config.bydMode === 'byd') return new BydClient(config.byd);
  if (config.bydMode === 'mock') return new MockBydClient(db);
  throw new Error(`알 수 없는 BYD_MODE: ${config.bydMode} (mock 또는 byd)`);
}

module.exports = { createBydClient };
