'use strict';
const { expect } = require('chai');
const ThreadPool = require('..');

const WORKER = require.resolve('./workers/worker.js');

describe('callback function support', function () {
	let pool;

	before(async function () {
		pool = new ThreadPool({ filename: WORKER, maxThreads: 1 });
	});

	after(async function () {
		await pool.destroy();
	});

	it('allows callback functions in top-level task args', async function () {
		const result = await pool.call('map', ['a', 'b', 'c'], (x, i) => x + i);
		expect(result).to.deep.equal(['a0', 'b1', 'c2']);
	});

	it('allows async callback functions in top-level task args', async function () {
		const result = await pool.call('map', ['a', 'b', 'c'], async (x, i) => {
			await new Promise(r => setTimeout(r, 10));
			return x + i;
		});
		expect(result).to.deep.equal(['a0', 'b1', 'c2']);
	});

	it('allows multiple callback functions', async function () {
		const result = await pool.call('addLazy', 10, (() => 7), 1, () => 100);
		expect(result).to.equal(118);
	});

	it('propagates errors thrown in the callback', async function () {
		const result = await pool.call('expectError', () => { throw new Error('foo bar'); });
		expect(result).to.equal('foo bar');

		await pool.call('addLazy', () => { throw new Error('foo bar'); }).then(() => {
			throw new Error('Promise should have been rejected');
		}, (err) => {
			expect(err).to.be.an.instanceof(Error);
			expect(err.message).to.equal('foo bar');
		});
	});

	it('propagates rejected promises returned by the callback', async function () {
		const result = await pool.call('expectError', () => Promise.reject(new Error('foo bar')));
		expect(result).to.equal('foo bar');

		await pool.call('addLazy', () => Promise.reject(new Error('foo bar'))).then(() => {
			throw new Error('Promise should have been rejected');
		}, (err) => {
			expect(err).to.be.an.instanceof(Error);
			expect(err.message).to.equal('foo bar');
		});
	});

	it('does not allow callbacks to be called after the task ends', async function () {
		let result = await pool.call('callLater', () => 105);
		expect(result).to.equal(undefined);
		await pool.call('callLater', () => 75).then(() => {
			throw new Error('Promise should have been rejected');
		}, (err) => {
			expect(err).to.be.an.instanceof(Error);
			expect(err.message).to.equal('Worker callback called after task ended');
		});
	});

	it('allows callbacks to be resolved after the task ends', async function () {
		let result = await pool.call('setLater', async () => {
			await new Promise(r => setTimeout(r, 10));
			return 55;
		}, 10);
		expect(result).to.equal(10);
		await new Promise(r => setTimeout(r, 10));
		result = await pool.call('setLater', () => 75);
		expect(result).to.equal(55);
	});
});
