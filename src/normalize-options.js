'use strict';
const path = require('path');
const PHYSICAL_CORES = require('physical-cpu-count');

/*
	Validates and applies defaults to options. Also, options which are passed
	directly to Worker instances are separated and assigned to workerOptions.
 */

module.exports = (options, workerOptions) => {
	if (typeof options !== 'object' || options === null) {
		throw new TypeError('Expected argument to be an options object');
	}

	options = Object.assign(Object.create(null), options);

	if (typeof options.filename !== 'string') {
		throw new TypeError('Expected options.filename to be a string');
	}
	if (!path.posix.isAbsolute(options.filename)) {
		throw new TypeError('Filename must be a POSIX-style absolute path');
	}
	if (!['.js', '.mjs', '.cjs', ''].includes(path.posix.extname(options.filename))) {
		throw new TypeError('Filename extension must be either ".js", ".mjs", or ".cjs"');
	}

	if (options.minThreads === undefined) {
		options.minThreads = PHYSICAL_CORES >> 1 || 1;
	} else {
		if (!Number.isInteger(options.minThreads)) {
			throw new TypeError('Expected options.minThreads to be an integer');
		}
		if (options.minThreads < 0) {
			throw new RangeError('Expected options.minThreads to be non-negative');
		}
	}

	if (options.maxThreads === undefined) {
		options.maxThreads = PHYSICAL_CORES;
	} else {
		if (!Number.isInteger(options.maxThreads)) {
			throw new TypeError('Expected options.maxThreads to be an integer');
		}
		if (options.maxThreads <= 0) {
			throw new RangeError('Expected options.maxThreads to be greater than 0');
		}
		if (options.maxThreads < options.minThreads) {
			throw new RangeError('Expected options.maxThreads to be greater than or equal to options.minThreads');
		}
	}

	for (const key of ['execArgv', 'argv', 'env', 'workerData', 'resourceLimits', 'trackUnmanagedFds', 'name']) {
		if ({}.hasOwnProperty.call(options, key)) {
			workerOptions[key] = options[key];
		}
	}

	return {
		filename: options.filename,
		minThreads: options.minThreads,
		maxThreads: options.maxThreads,
	};
};
