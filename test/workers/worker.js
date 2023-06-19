'use strict';
const { move } = require('../..');

exports.echo = (...args) => {
	return args;
};

exports.add = (a, b) => {
	return a + b;
};

exports.concatAsync = async (a, b) => {
	await new Promise(r => setTimeout(r, 10));
	return Buffer.concat([a, b]);
};

let movedBuffer;
exports.moveAsync = async (buffer) => {
	movedBuffer = buffer;
	return move(buffer, [buffer.buffer]);
};

exports.movedSizes = async () => {
	return [movedBuffer.byteLength, movedBuffer.buffer.byteLength];
};

exports.sleep = async (ms) => {
	return new Promise(r => setTimeout(r, ms));
};

exports.fail = (message) => {
	throw new Error(message);
};

exports.failAsync = async (message) => {
	await new Promise(r => setTimeout(r, 10));
	throw new Error(message);
};

exports.argv = () => {
	return process.argv;
};

exports.exit = () => {
	return process.exit();
};

exports.uncaughtException = async (message) => {
	await new Promise(r => setTimeout(r, 10));
	process.nextTick(() => { throw new Error(message); });
	await new Promise(r => setTimeout(r, 100));
};

exports.unhandledRejection = async (message) => {
	await new Promise(r => setTimeout(r, 10));
	Promise.reject(new Error(message));
	await new Promise(r => setTimeout(r, 100));
};

exports.generate = function* () {
	yield 'foo';
	yield 'bar';
	yield 'baz';
};

exports.generateAsync = async function* () {
	await new Promise(r => setTimeout(r, 5));
	yield 'foo';
	await new Promise(r => setTimeout(r, 5));
	yield 'bar';
	await new Promise(r => setTimeout(r, 5));
	yield 'baz';
	await new Promise(r => setTimeout(r, 5));
};

exports.generateError = async function* () {
	yield 'foo';
	yield 'bar';
	throw new Error('this is an error');
};

exports.generateNone = function* () {};

exports.map = async function (arr, cb) {
	return Promise.all(arr.map((x, i) => cb(x, i)));
};

exports.addLazy = async function (...args) {
	let sum = 0;
	for (let arg of args) {
		if (typeof arg === 'function') {
			sum += await arg();
		} else {
			sum += arg;
		}
	}
	return sum;
};

exports.expectError = async (cb) => {
	try {
		await cb();
	} catch (err) {
		return err.message;
	}
	throw new Error('Callback should have thrown an exception');
};

let pendingPromise;
exports.callLater = (cb) => {
	setImmediate(() => {
		pendingPromise = cb();
		pendingPromise.catch(() => {});
	});
	return pendingPromise;
};

let currentValue = 1;
exports.setLater = (cb, initialValue) => {
	if (initialValue !== undefined) {
		currentValue = initialValue;
	}
	cb().then((value) => {
		currentValue = value;
	});
	return currentValue;
};
