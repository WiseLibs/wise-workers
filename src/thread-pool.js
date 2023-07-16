'use strict';
const util = require('util');
const crypto = require('crypto');
const { Worker } = require('worker_threads');
const EventEmitter = require('events');
const Queue = require('./queue');
const normalizeOptions = require('./normalize-options');
const makeAsyncIterable = require('./make-async-iterable');
const { OP_YIELD, OP_RESPONSE, OP_CALLBACK, OP_GENERATOR, OP_READY, WOP_REQUEST, WOP_CALLBACK } = require('./constants');

const WORKER_SCRIPT = require.resolve('./worker');
const NOOP = () => {};

function ThreadPool(options) {
	if (new.target == null) {
		return new ThreadPool(options);
	}

	EventEmitter.call(this);

	const workerOptions = {};
	options = normalizeOptions(options, workerOptions);

	// We include the user's filename within the workerData.
	// Our worker.js script will unwrap this, so the user will never know.
	workerOptions.workerData = {
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

	const spawnIfBeneficial = () => {
		if (allWorkers.length >= options.maxThreads) return;
		if (allWorkers.length >= assignedJobs.size + queue.size) return;
		try {
			spawn();
		} catch (err) {
			// This can occur within the invoke() method, which may be called
			// directly after constructing a new ThreadPool, so we delay it to
			// given callers a chance to listen for the "error" event.
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
			if (!isDestroyed && !isInitializing) {
				this.emit(`online:${this.onlineThreadCount}`);
			}
		};

		const worker = new Worker(WORKER_SCRIPT, workerOptions)
			.on('message', (msg) => {
				if (isErrored) return;
				switch (msg[0]) {
					case OP_YIELD:
						yieldGenerator(worker, msg[1]);
						break;
					case OP_RESPONSE:
						if (respond(worker, msg[1], msg[2])) {
							standby(worker);
						}
						break;
					case OP_CALLBACK:
						callCallback(worker, msg[1], msg[2], msg[3])
						break;
					case OP_GENERATOR:
						startGenerator(worker);
						break;
					case OP_READY:
						if (isInitializing) {
							isInitializing = false;
							standby(worker);
							this.emit(`online:${this.onlineThreadCount}`);
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
						isDestroyed || this.emit(`online:${this.onlineThreadCount}`);
					}
					spawnAsNeeded();
				}
			});

		worker.ref();
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
			job = { resolve, reject, cleanup: NOOP, willSend: undefined, yield: undefined, callbacks: undefined };
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
		const { cbIndexes, callbacks } = extractCallbacks(args);
		const msg = [WOP_REQUEST, methodName, args, cbIndexes];
		job.callbacks = callbacks;

		if (availableWorkers.length) {
			const worker = availableWorkers.pop();
			assignedJobs.set(worker, job);
			worker.postMessage(msg, transferList);
			worker.ref();
			return promise;
		} else {
			job.willSend = [msg, transferList];
			queue.push(job);
			spawnIfBeneficial();
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

	const startGenerator = (worker) => {
		const job = assignedJobs.get(worker);
		if (job) {
			const { controller, asyncIterable } = makeAsyncIterable();
			job.resolve(asyncIterable);
			job.resolve = controller.resolve;
			job.reject = controller.reject;
			job.yield = controller.yield;
		}
	};

	const yieldGenerator = (worker, value) => {
		const job = assignedJobs.get(worker);
		if (job) {
			job.yield(value);
		}
	};

	const callCallback = (worker, callId, index, args) => {
		const job = assignedJobs.get(worker);
		if (job) {
			const callback = job.callbacks[index];
			new Promise((resolve) => {
				resolve(callback(...args));
			}).then((value) => {
				// TODO: support transferList for returned value
				worker.postMessage([WOP_CALLBACK, callId, value, false]);
			}, (err) => {
				// TODO: support transferList for thrown err
				worker.postMessage([WOP_CALLBACK, callId, err, true]);
			});
		}
	};

	const destroy = (err) => {
		if (!isDestroyed) {
			isDestroyed = true;
			options.minThreads = 0;
			options.maxThreads = 0;
			if (err == null) {
				err = new Error('Thread pool was destroyed');
			}
			if (this.onlineThreadCount) {
				process.nextTick(() => this.emit('online:0'));
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
		onlineThreadCount: {
			get: () => availableWorkers.length + assignedJobs.size,
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

function extractCallbacks(args) {
	const cbIndexes = [];
	const callbacks = [];
	for (let i = 0; i < args.length; ++i) {
		const value = args[i];
		if (typeof value === 'function') {
			cbIndexes.push(i);
			callbacks.push(value);
			args[i] = undefined;
		}
	}
	return { cbIndexes, callbacks };
}

util.inherits(ThreadPool, EventEmitter);
module.exports = ThreadPool;
