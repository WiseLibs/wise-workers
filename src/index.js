'use strict';
const { isMainThread } = require('worker_threads');

if (isMainThread) {
	module.exports = require('./thread-pool');
} else {
	const Movable = require('./movable');
	const move = (value, transferList) => new Movable(value, transferList);
	exports.move = move;
}
