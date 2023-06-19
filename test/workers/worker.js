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

exports.moveAsync = async (buffer) => {
	return move(buffer, [buffer.buffer]);
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
