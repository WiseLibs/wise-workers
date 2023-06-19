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
