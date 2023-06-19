'use strict';
const { expect } = require('chai');
const ThreadPool = require('..');

const WORKER = require.resolve('./workers/worker.js');

describe('generator function support', function () {
	let pool;

	before(async function () {
		pool = new ThreadPool({ filename: WORKER, maxThreads: 2 });
		await pool.call('echo');
	});

	after(async function () {
		await pool.destroy();
	})

	it('resolves to an async iterable when calling a generator function', async function () {
		const asyncIterable = await pool.call('generate');
		expect(asyncIterable[Symbol.asyncIterator]).to.be.a('function');
		const values = [];
		for await (const value of asyncIterable) {
			values.push(value);
		}
		expect(values).to.deep.equal(['foo', 'bar', 'baz']);
	});
	it('resolves to an async iterable when calling an async generator function', async function () {
		const asyncIterable = await pool.call('generateAsync');
		expect(asyncIterable[Symbol.asyncIterator]).to.be.a('function');
		const values = [];
		for await (const value of asyncIterable) {
			values.push(value);
		}
		expect(values).to.deep.equal(['foo', 'bar', 'baz']);
	});
});
