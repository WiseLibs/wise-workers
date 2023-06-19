'use strict';
const { expect } = require('chai');
const ThreadPool = require('..');

const WORKER = require.resolve('./workers/worker.js');

describe('AbortSignal support', function () {
	let pool;

	before(async function () {
		pool = new ThreadPool({ filename: WORKER, maxThreads: 1 });
		await pool.call('echo');
	});

	after(async function () {
		await pool.destroy();
	});

	it('allows the signal option to stop a worker when calling invoke()', async function () {
		const controller = new AbortController();
		const signal = controller.signal;
		const promise = pool.invoke('sleep', { args: [10000], signal });
		await new Promise(r => setTimeout(r, 100));
		controller.abort();
		await promise.then(() => {
			throw new Error('Promise should have been rejected');
		}, (err) => {
			expect(err).to.be.an.instanceof(Error);
			expect(err).to.be.an.instanceof(DOMException);
			expect(err.name).to.equal('AbortError');
		});
	});
	it('respects signals that are already aborted', async function () {
		const signal = AbortSignal.abort();
		await pool.invoke('sleep', { args: [10000], signal }).then(() => {
			throw new Error('Promise should have been rejected');
		}, (err) => {
			expect(err).to.be.an.instanceof(Error);
			expect(err).to.be.an.instanceof(DOMException);
			expect(err.name).to.equal('AbortError');
		});
	});
	it('works when the aborted task is still in queue', async function () {
		const controller = new AbortController();
		const signal = controller.signal;
		await pool.call('echo');
		const promise1 = pool.invoke('sleep', { args: [100] });
		const promise2 = pool.invoke('sleep', { args: [100], signal });
		expect(pool.activeThreadCount).to.equal(1);
		expect(pool.pendingTaskCount).to.equal(2);
		await new Promise(r => setTimeout(r, 5));
		controller.abort();
		await promise2.then(() => {
			throw new Error('Promise should have been rejected');
		}, (err) => {
			expect(err).to.be.an.instanceof(Error);
			expect(err).to.be.an.instanceof(DOMException);
			expect(err.name).to.equal('AbortError');
		});
		expect(pool.activeThreadCount).to.equal(1);
		expect(pool.pendingTaskCount).to.equal(1);
		await promise1;
	});

	describe('cleans up event listeners after completing a method call', function () {
		it('when the method is successful', async function () {
			const controller = new AbortController();
			const signal = controller.signal;

			const calls = [];
			signal.removeEventListener = (...args) => {
				calls.push(args);
			};

			expect(await pool.invoke('add', { args: [5, 7], signal })).to.equal(12);
			expect(calls.length).to.equal(1);
			expect(calls[0].length).to.equal(2);
			expect(calls[0][0]).to.equal('abort');
			expect(typeof calls[0][1]).to.equal('function');
		});
		it('when the method throws an exception', async function () {
			const controller = new AbortController();
			const signal = controller.signal;

			const calls = [];
			signal.removeEventListener = (...args) => {
				calls.push(args);
			};

			await pool.invoke('fail', { args: ['foo'], signal }).then(() => {
				throw new Error('Promise should have been rejected');
			}, (err) => {
				expect(err).to.be.an.instanceof(Error);
				expect(err).to.not.be.an.instanceof(DOMException);
				expect(err.message).to.equal('foo');
			});

			expect(calls.length).to.equal(1);
			expect(calls[0].length).to.equal(2);
			expect(calls[0][0]).to.equal('abort');
			expect(typeof calls[0][1]).to.equal('function');
		});
		it('when the method is aborted', async function () {
			const controller = new AbortController();
			const signal = controller.signal;

			const calls = [];
			signal.removeEventListener = (...args) => {
				calls.push(args);
			};

			const promise = pool.invoke('sleep', { args: [10000], signal });
			await new Promise(r => setTimeout(r, 100));
			controller.abort();
			await promise.then(() => {
				throw new Error('Promise should have been rejected');
			}, (err) => {
				expect(err).to.be.an.instanceof(Error);
				expect(err).to.be.an.instanceof(DOMException);
				expect(err.name).to.equal('AbortError');
			});

			expect(calls.length).to.equal(1);
			expect(calls[0].length).to.equal(2);
			expect(calls[0][0]).to.equal('abort');
			expect(typeof calls[0][1]).to.equal('function');
		});
		it('when the thread pool is destroyed', async function () {
			const controller = new AbortController();
			const signal = controller.signal;

			const calls = [];
			signal.removeEventListener = (...args) => {
				calls.push(args);
			};

			const promise = pool.invoke('sleep', { args: [10000], signal });
			await new Promise(r => setTimeout(r, 100));
			pool.destroy();
			await promise.then(() => {
				throw new Error('Promise should have been rejected');
			}, (err) => {
				expect(err).to.be.an.instanceof(Error);
				expect(err).to.not.be.an.instanceof(DOMException);
			});

			expect(calls.length).to.equal(1);
			expect(calls[0].length).to.equal(2);
			expect(calls[0][0]).to.equal('abort');
			expect(typeof calls[0][1]).to.equal('function');
		});
	});
});
