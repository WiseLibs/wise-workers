'use strict';
const { expect } = require('chai');
const ThreadPool = require('..');

const WORKER = require.resolve('./workers/worker.js');

describe('zero-copy support', function () {
	let pool;

	before(async function () {
		pool = new ThreadPool({ filename: WORKER, maxThreads: 1 });
		await pool.call('echo');
	});

	after(async function () {
		await pool.destroy();
	});

	it('respects the transferList option when calling invoke()', async function () {
		const buf1 = Buffer.alloc(1024 * 1024);
		const buf2 = Buffer.alloc(1024 * 1024);
		await pool.invoke('echo', { args: [buf1] });
		await pool.invoke('echo', { args: [buf2], transferList: [buf2.buffer] });
		expect(buf1.byteLength).to.equal(1024 * 1024);
		expect(buf1.buffer.byteLength).to.equal(1024 * 1024);
		expect(buf2.byteLength).to.equal(0);
		expect(buf2.buffer.byteLength).to.equal(0);
	});
	it('respects move() when returning from a worker method', async function () {
		const buf = Buffer.alloc(1024 * 1024);
		await pool.invoke('moveAsync', { args: [buf] });
		expect(buf.byteLength).to.equal(1024 * 1024);
		expect(buf.buffer.byteLength).to.equal(1024 * 1024);
		const sizes = await pool.invoke('movedSizes');
		expect(sizes[0]).to.equal(0);
		expect(sizes[1]).to.equal(0);
	});
});
