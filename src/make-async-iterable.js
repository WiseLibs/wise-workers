'use strict';
const Queue = require('./queue');

/*
	Creates an async iterable iterator, and also returns a controller which
	controls the lifecycle of the async iterable iterator.
 */

module.exports = () => {
	const requests = new Queue();
	const values = new Queue();
	let isEnded = false;
	let isDone = false;
	let isError = false;
	let error;

	const onWrite = (value) => {
		if (!isEnded) {
			if (requests.size) {
				requests.shift()({ value, done: false });
			} else {
				values.push(value);
			}
		}
	};
	const onFinish = () => {
		if (!values.size) {
			isDone = true;
			while (requests.size) {
				requests.shift()({ value: undefined, done: true });
			}
		}
	};
	const onCancel = (err) => {
		if (!isDone) {
			isEnded = true;
			isDone = true;
			isError = true;
			error = err;
			while (requests.size) {
				requests.shift()(Promise.reject(err));
			}
			requests.clear();
			values.clear();
		}
	};

	const controller = {
		resolve: () => {
			if (!isEnded) {
				isEnded = true;
				onFinish();
			}
		},
		reject: onCancel,
		yield: onWrite,
	};

	const asyncIterable = {
		next: () => new Promise((resolve, reject) => {
			if (!isDone) {
				if (values.size) {
					resolve({ value: values.shift(), done: false });
					isEnded && onFinish();
				} else {
					requests.push(resolve);
				}
			} else if (!isError) {
				resolve({ value: undefined, done: true });
			} else {
				reject(error);
			}
		}),
		return: (value) => {
			onCancel(new Error('Iteration cancelled'));
			return Promise.resolve({ value, done: true });
		},
		throw: (err) => {
			onCancel(err);
			return Promise.reject(err);
		},
		[Symbol.asyncIterator]() {
			return this;
		},
	};

	return { controller, asyncIterable };
};
