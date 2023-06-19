'use strict';
const util = require('util');
const crypto = require('crypto');
const { Worker } = require('worker_threads');
const EventEmitter = require('events');
const Queue = require('./queue');
const normalizeOptions = require('./normalize-options');

const WORKER_SCRIPT = require.resolve('./worker');
const NOOP = () => {};
const OP_RESPONSE = crypto.randomBytes(4).readInt32LE();
const OP_READY = crypto.randomBytes(4).readInt32LE();

// TODO: implement generator/asyncGenerator function support (needs new op code)
// TODO: implement callback support (functions in top-level args)
// TODO: make sure generator/asyncGenerator functions can yield moved values
// TODO: make sure callback args/returns can be moved values

function ThreadPool(options) {
	if (new.target == null) {
		return new ThreadPool(options);
	}

	EventEmitter.call(this);

	const workerOptions = {};
	options = normalizeOptions(options, workerOptions);

	// We include our own data within the workerData.
	// Our worker.js script will unwrap this, so the user will never know.
	workerOptions.workerData = {
		OP_RESPONSE,
		OP_READY,
		FILENAME: options.filename,
		workerData: workerOptions.workerData,
	};

	let isDestroyed = false;
	const allWorkers = [];
	const availableWorkers = [];
	const assignedJobs = new Map();
	const queue = new Queue();

	const spawnAsNeeded = () => {
		try {
			while (allWorkers.length < options.minThreads) {
				spawn();
			}
		} catch (err) {
			// This can occur within the ThreadPool constructor, so we delay it
			// to given callers a chance to listen for the "error" event.
			process.nextTick(() => fatal(err));
		}
	};

	const spawn = () => {
		let isInitializing = true;
		let isErrored = false;

		const onError = (err) => {
			if (isErrored) return;
			isErrored = true;
			deleteFromArray(availableWorkers, worker);
			worker.terminate(); // Required for AbortSignal handling and destroy()
			respond(worker, err, true) || fatal(err, !isInitializing);
		};

		const worker = new Worker(WORKER_SCRIPT, workerOptions)
			.on('message', (msg) => {
				if (isErrored) return;
				if (!Array.isArray(msg)) return;
				switch (msg[0]) {
					case OP_RESPONSE:
						if (respond(worker, msg[1], msg[2])) {
							standby(worker);
						}
						break;
					case OP_READY:
						if (isInitializing) {
							isInitializing = false;
							standby(worker);
						}
						break;
				}
			})
			.on('messageerror', onError)
			.on('error', onError)
			.on('exit', () => {
				deleteFromArray(availableWorkers, worker);
				deleteFromArray(allWorkers, worker);
				if (isInitializing) {
					if (!isErrored) {
						// It's always considered an error if a worker exits while initializing.
						fatal(new Error('Worker thread exited while starting up'));
					}
				} else {
					if (!isErrored) {
						respond(worker, new Error('Worker thread exited prematurely'), true);
					}
					spawnAsNeeded();
				}
			});

		worker.unref();
		allWorkers.push(worker);
	};

	const standby = (worker) => {
		if (queue.size) {
			const job = queue.shift();
			const args = job.willSend;
			job.willSend = undefined;
			assignedJobs.set(worker, job);
			worker.postMessage(...args);
			worker.ref();
		} else {
			availableWorkers.push(worker);
			worker.unref();
		}
	};

	const fatal = (err, keepWorkers = false) => {
		if (isDestroyed) return;
		if (!keepWorkers) destroy(err);
		this.emit('error', err);
	};

	const createJob = (signal) => {
		let job;
		const promise = new Promise((resolve, reject) => {
			job = { resolve, reject, cleanup: NOOP, willSend: undefined };
		});

		if (signal) {
			const onAbort = () => {
				// If a job is aborted, it's either in the queue or assignedJobs.
				// We search both places and remove it from wherever it is.
				// If it was in assignedJobs, we also terminate the worker.
				if (queue.delete(job)) {
					job.reject(signal.reason);
					job.cleanup();
					return;
				}
				for (const [worker, assignedJob] of assignedJobs) {
					if (job === assignedJob) {
						worker.emit('error', signal.reason);
						break;
					}
				}
			};
			signal.addEventListener('abort', onAbort);
			job.cleanup = () => void signal.removeEventListener('abort', onAbort);
		}

		return { job, promise };
	};

	const invoke = async (methodName, { args = [], transferList = [], signal = null } = {}) => {
		if (typeof methodName !== 'string') {
			throw new TypeError('Expected method name to be a string');
		}
		if (!Array.isArray(args)) {
			throw new TypeError('Expected method args to be an array');
		}
		if (!Array.isArray(transferList)) {
			throw new TypeError('Expected method transferList to be an array');
		}
		if (signal !== null) {
			if (!(signal instanceof AbortSignal)) {
				throw new TypeError('Expected method signal to be an AbortSignal');
			}
			signal.throwIfAborted();
		}
		if (isDestroyed) {
			throw new Error('Thread pool was destroyed');
		}

		const { job, promise } = createJob(signal);
		const msg = [methodName, args];

		if (availableWorkers.length) {
			const worker = availableWorkers.pop();
			assignedJobs.set(worker, job);
			worker.postMessage(msg, transferList);
			worker.ref();
			return promise;
		} else {
			if (allWorkers.length < options.maxThreads) {
				spawn();
			}
			job.willSend = [msg, transferList];
			queue.push(job);
			return promise;
		}
	};

	const respond = (worker, value, isFailure) => {
		const job = assignedJobs.get(worker);
		if (job) {
			assignedJobs.delete(worker);
			isFailure ? job.reject(value) : job.resolve(value);
			job.cleanup();
			return true;
		}
		return false;
	};

	const destroy = (err) => {
		if (!isDestroyed) {
			isDestroyed = true;
			options.minThreads = 0;
			options.maxThreads = 0;
			if (err == null) {
				err = new Error('Thread pool was destroyed');
			}
			for (const worker of allWorkers) {
				worker.emit('error', err);
			}
			while (queue.size) {
				const job = queue.shift();
				job.reject(err);
				job.cleanup();
			}
		}
		return Promise.all(allWorkers.map(worker => worker.terminate())).then(NOOP);
	};

	Object.defineProperties(this, {
		filename: {
			value: options.filename,
			enumerable: true,
		},
		threadCount: {
			get: () => allWorkers.length,
			enumerable: true,
		},
		activeThreadCount: {
			get: () => assignedJobs.size,
			enumerable: true,
		},
		pendingTaskCount: {
			get: () => assignedJobs.size + queue.size,
			enumerable: true,
		},
		destroyed: {
			get: () => isDestroyed,
			enumerable: true,
		},
		call: {
			value: (methodName, ...args) => invoke(methodName, { args }),
		},
		invoke: {
			value: invoke,
		},
		destroy: {
			value: destroy,
		},
	});

	spawnAsNeeded();
}

function deleteFromArray(arr, value) {
	const index = arr.indexOf(value);
	if (index >= 0) arr.splice(index, 1);
}

util.inherits(ThreadPool, EventEmitter);
module.exports = ThreadPool;
