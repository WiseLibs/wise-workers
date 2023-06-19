'use strict';
const worker = require('worker_threads');
const Movable = require('./movable');
const { OP_YIELD, OP_RESPONSE, OP_CALLBACK, OP_GENERATOR, OP_READY, WOP_REQUEST, WOP_CALLBACK } = require('./constants');
const { parentPort } = worker;

const GeneratorFunction = (function*(){}).constructor;
const AsyncGeneratorFunction = (async function*(){}).constructor;
const pendingCallbackCalls = new Map();
let nextCallId = 1n;

process.on('unhandledRejection', (err) => {
	throw err;
});
parentPort.on('messageerror', (err) => {
	throw err;
});

// Unwrap the user's workerData, and extract the filename from it.
const { FILENAME } = worker.workerData;
worker.workerData = worker.workerData.workerData;

// Hide the parentPort from the user's worker script.
worker.parentPort = new worker.MessageChannel().port1;

// Load the user's worker script. It may export a promise.
// TODO: add support for ESM files
Promise.resolve(require(FILENAME)).then((methods) => {
	if (typeof methods !== 'object' || methods === null) {
		throw new TypeError('Worker must export an object');
	}

	parentPort.on('message', (msg) => {
		switch (msg[0]) {
			case WOP_REQUEST:
				invoke(methods, msg[1], msg[2], msg[3]);
				break;
			case WOP_CALLBACK:
				resolveCallback(msg[1], msg[2], msg[3]);
				break;
		}
	});

	parentPort.postMessage([OP_READY]);
});

function invoke(methods, methodName, args, cbIndexes) {
	const state = { isDone: false };
	for (let i = 0; i < cbIndexes.length; ++i) {
		args[cbIndexes[i]] = createCallback(i, state);
	}

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
		state.isDone = true;
		respond(value, false);
	}, (err) => {
		state.isDone = true;
		respond(err, true);
	});
}

function respond(value, isFailure) {
	let transferList;
	if (value instanceof Movable) {
		transferList = value.transferList;
		value = value.value;
	}
	parentPort.postMessage([OP_RESPONSE, value, isFailure], transferList);
}

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

function createCallback(index, state) {
	return (...args) => new Promise((resolve, reject) => {
		if (state.isDone) {
			reject(new Error('Worker callback called after task ended'));
		} else {
			const callId = nextCallId++;
			pendingCallbackCalls.set(callId, { resolve, reject });
			// TODO: add support for transferList for args
			parentPort.postMessage([OP_CALLBACK, callId, index, args]);
		}
	});
}

function resolveCallback(callId, value, isFailure) {
	const call = pendingCallbackCalls.get(callId);
	if (call) {
		pendingCallbackCalls.delete(callId);
		isFailure ? call.reject(value) : call.resolve(value);
	}
}
