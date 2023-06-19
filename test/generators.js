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
	});

	it('resolves to an async iterable when calling a generator function', async function () {
		const asyncIterable = await pool.call('generate');
		expect(asyncIterable[Symbol.asyncIterator]).to.be.a('function');
		expect(pool.pendingTaskCount).to.equal(1);
		const values = [];
		for await (const value of asyncIterable) {
			values.push(value);
		}
		expect(pool.pendingTaskCount).to.equal(0);
		expect(values).to.deep.equal(['foo', 'bar', 'baz']);
	});
	it('resolves to an async iterable when calling an async generator function', async function () {
		const asyncIterable = await pool.call('generateAsync');
		expect(asyncIterable[Symbol.asyncIterator]).to.be.a('function');
		expect(pool.pendingTaskCount).to.equal(1);
		const values = [];
		for await (const value of asyncIterable) {
			values.push(value);
		}
		expect(pool.pendingTaskCount).to.equal(0);
		expect(values).to.deep.equal(['foo', 'bar', 'baz']);
	});
	it('works even if the generator function yields no values', async function () {
		const asyncIterable = await pool.call('generateNone');
		expect(asyncIterable[Symbol.asyncIterator]).to.be.a('function');
		expect(pool.pendingTaskCount).to.equal(1);
		const values = [];
		for await (const value of asyncIterable) {
			values.push(value);
		}
		expect(pool.pendingTaskCount).to.equal(0);
		expect(values).to.deep.equal([]);
	});
	it('propagates errors throws within the generator function', async function () {
		const asyncIterable = await pool.call('generateError');
		expect(asyncIterable[Symbol.asyncIterator]).to.be.a('function');
		expect(pool.pendingTaskCount).to.equal(1);
		const values = [];
		let error;
		try {
			for await (const value of asyncIterable) {
				values.push(value);
			}
		} catch (err) {
			expect(pool.pendingTaskCount).to.equal(0);
			error = err;
		}
		expect(pool.pendingTaskCount).to.equal(0);
		expect(values).to.deep.equal(['foo', 'bar']);
		expect(error).to.be.an.instanceof(Error);
		expect(error.message).to.equal('this is an error');
	});
});
