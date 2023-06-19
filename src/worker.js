'use strict';
const worker = require('worker_threads');
const Movable = require('./movable');
const { parentPort } = worker;

const GeneratorFunction = (function*(){}).constructor;
const AsyncGeneratorFunction = (async function*(){}).constructor;

// TODO: implement callback support (functions in top-level args)

process.on('unhandledRejection', (err) => {
	throw err;
});
parentPort.on('messageerror', (err) => {
	throw err;
});

// Unwrap the user's workerData, and extract our own pieces of it.
const { OP_YIELD, OP_RESPONSE, OP_GENERATOR, OP_READY, FILENAME } = worker.workerData;
worker.workerData = worker.workerData.workerData;

// Load the user's worker script. It may export a promise.
// TODO: add support for ESM files
Promise.resolve(require(FILENAME)).then((methods) => {
	if (typeof methods !== 'object' || methods === null) {
		throw new TypeError('Worker must export an object');
	}

	parentPort.on('message', ([methodName, args]) => {
		new Promise((resolve) => {
			const method = methods[methodName];
			if (typeof method !== 'function') {
				throw new Error(`Method "${methodName}" not found on worker`);
			}
			if (method instanceof GeneratorFunction || method instanceof AsyncGeneratorFunction) {
				resolve(runGenerator(method, args));
			} else {
				resolve(method(...args));
			}
		}).then((value) => {
			respond(value, false);
		}, (err) => {
			respond(err, true);
		});
	});

	parentPort.postMessage([OP_READY]);
});

async function runGenerator(method, args) {
	parentPort.postMessage([OP_GENERATOR]);
	for await (let value of method(...args)) {
		let transferList;
		if (value instanceof Movable) {
			transferList = value.transferList;
			value = value.value;
		}
		parentPort.postMessage([OP_YIELD, value], transferList);
	}
}

function respond(value, isFailure) {
	let transferList;
	if (value instanceof Movable) {
		transferList = value.transferList;
		value = value.value;
	}
	parentPort.postMessage([OP_RESPONSE, value, isFailure], transferList);
}
