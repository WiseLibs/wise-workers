'use strict';
const { expect } = require('chai');
const ThreadPool = require('..');

const WORKER = require.resolve('./utilities/worker.js');

describe('AbortSignal support', function () {
	it('respects the signal option when calling invoke()');
});
