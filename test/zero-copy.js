'use strict';
const { expect } = require('chai');
const ThreadPool = require('..');

const WORKER = require.resolve('./workers/worker.js');
const time = async (fn) => {
	const before = process.hrtime.bigint();
	await fn();
	const after = process.hrtime.bigint();
	return Number((after - before) / 1000000n);
};

describe('zero-copy support', function () {
	let pool;

	before(async function () {
		pool = new ThreadPool({ filename: WORKER, maxThreads: 1 });
		await pool.call('echo');
	});

	after(async function () {
		await pool.destroy();
	})

	it('respects the transferList option when calling invoke()', async function () {
		const buf1 = Buffer.alloc(1024 * 1024 * 70);
		const buf2 = Buffer.alloc(1024 * 1024 * 70);
		const copyTime = await time(() => pool.invoke('echo', { args: [buf1] }));
		const zeroCopyTime = await time(() => pool.invoke('echo', { args: [buf2], transferList: [buf2.buffer] }));
		expect(copyTime).to.be.above(zeroCopyTime + 10);
	});
	it('respects move() when returning from a worker method', async function () {
		const buf1 = Buffer.alloc(1024 * 1024 * 70);
		const buf2 = Buffer.alloc(1024 * 1024 * 70);
		const copyTime = await time(() => pool.invoke('echo', { args: [buf1] }));
		const zeroCopyTime = await time(() => pool.invoke('moveAsync', { args: [buf2] }));
		expect(copyTime).to.be.above(zeroCopyTime + 10);
	});
	it('is capable of a zero-copy round-trip', async function () {
		const buf1 = Buffer.alloc(1024 * 1024 * 70);
		const buf2 = Buffer.alloc(1024 * 1024 * 70);
		const buf3 = Buffer.alloc(1024 * 1024 * 70);
		const copyTime1 = await time(() => pool.invoke('echo', { args: [buf1], transferList: [buf1.buffer] }));
		const copyTime2 = await time(() => pool.invoke('moveAsync', { args: [buf2] }));
		const zeroCopyTime = await time(() => pool.invoke('moveAsync', { args: [buf3], transferList: [buf3.buffer] }));
		expect(copyTime1).to.be.above(zeroCopyTime + 10);
		expect(copyTime2).to.be.above(zeroCopyTime + 10);
	});
});
