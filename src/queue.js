'use strict';

/*
	Queue is a dynamically-sized queue implemented with a circular buffer.
	Its push() and shift() functions are very simple O(1) calculations.
	It performs much better than using a regular array as a queue.
 */

module.exports = class Queue {
	constructor() {
		this._array = new Array(16); // This must be a power of 2
		this._length = 0;
		this._front = 0;
	}

	push(value) {
		const arr = this._array;
		if (arr.length === this._length) {
			arr.length *= 2;
			arrayMove(arr, this._length, this._front);
		}
		arr[(this._front + this._length++) & (arr.length - 1)] = value;
	}

	shift() {
		if (this._length === 0) {
			return;
		}
		const arr = this._array;
		const frontIndex = this._front;
		const ret = arr[frontIndex];
		arr[frontIndex] = undefined;
		this._front = (frontIndex + 1) & (arr.length - 1);
		this._length -= 1;
		return ret;
	}

	delete(value) {
		const arr = this._array;
		const len = this._length;
		let index = this._front;
		for (let n = 0; n < len; ++n) {
			if (arr[index] === value) {
				if (n * 2 + 1 < len) {
					arrayShift(arr, index, n, -1);
					this._front = (this._front + 1) & (arr.length - 1);
				} else {
					arrayShift(arr, index, len - n - 1, 1);
				}
				this._length -= 1;
				return true;
			}
			index = (index + 1) & (arr.length - 1);
		}
		return false;
	}

	clear() {
		this._array = new Array(16); // This must be a power of 2
		this._length = 0;
		this._front = 0;
	}

	get size() {
		return this._length;
	}
}

function arrayMove(arr, moveBy, len) {
	for (let i = 0; i < len; ++i) {
		arr[i + moveBy] = arr[i];
		arr[i] = undefined;
	}
}

function arrayShift(arr, index, len, dir) {
	for (let i = 0; i < len; ++i) {
		const nextIndex = (index + dir) & (arr.length - 1);
		arr[index] = arr[nextIndex];
		index = nextIndex;
	}
	arr[index] = undefined;
}
