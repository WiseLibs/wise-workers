'use strict';
const { Worker } = require('worker_threads');
const EventEmitter = require('events');
const Queue = require('./queue');
const normalizeOptions = require('./normalize-options');

const WORKER_SCRIPT = require.resolve('./worker');
const NOOP = () => {};
const OP_RESPONSE = Math.random();
const OP_READY = Math.random();

// TODO: implement generator/asyncGenerator function support (needs new op code)
// TODO: implement callback support (functions in top-level args)

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
			// This can occur within the ThreadPool constructor, so we emit it
			// asynchronously to given callers a chance to listen for the event.
			process.nextTick(() => this.emit('error', err));
		}
	};

	const spawn = () => {
		let isInitializing = true;
		let isErrored = false;

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
			.on('messageerror', (err) => {
				isErrored = true;
				deleteFromArray(availableWorkers, worker);
				worker.terminate();
				respond(worker, err, true) || this.emit('error', err);
			})
			.on('error', (err) => {
				isErrored = true;
				deleteFromArray(availableWorkers, worker);
				worker.terminate(); // Required for AbortSignal support
				respond(worker, err, true) || this.emit('error', err);
			})
			.on('exit', () => {
				deleteFromArray(availableWorkers, worker);
				deleteFromArray(allWorkers, worker);
				if (isInitializing) {
					if (!isErrored) {
						this.emit('error', new Error('Worker thread exited while starting up'));
					}
				} else {
					respond(worker, new Error('Worker thread exited prematurely'), true);
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

	const createJob = (signal) => {
		let job;
		const promise = new Promise((resolve, reject) => {
			job = { resolve, reject, cleanup: NOOP, willSend: undefined };
		});

		if (signal) {
			const onAbort = () => {
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
			throw new Error('This ThreadPool was previously destroyed');
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

	const destroy = () => {
		isDestroyed = true;
		options.minThreads = 0;
		options.maxThreads = 0;
		return Promise.all(allWorkers.map(x => x.terminate())).then(() => {
			while (queue.size) {
				const job = queue.shift();
				job.reject(new Error('Worker thread exited prematurely'));
				job.cleanup();
			}
		});
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
