'use strict';
const { expect } = require('chai');
const ThreadPool = require('..');

const WORKER = require.resolve('./utilities/worker.js');

describe('zero-copy support', function () {
	it('respects the transferList option when calling invoke()');
	it('respects move() when returning from a worker method');
});
