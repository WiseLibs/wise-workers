'use strict';
const path = require('path');
const EventEmitter = require('events');
const { expect } = require('chai');
const ThreadPool = require('..');

const WORKER = require.resolve('./workers/worker.js');
const INVALID_WORKER = require.resolve('./workers/invalid-worker.js');
const INVALID_WORKER_ASYNC = require.resolve('./workers/invalid-worker-async.js');

describe('basic functionality', function () {
	let pool;

	afterEach(async function () {
		if (pool) {
			await pool.destroy();
			pool = undefined;
		}
	});

	describe('ThreadPool constructor', function () {
		it('does not accept invalid types in options', function () {
			expect(() => new ThreadPool()).to.throw(TypeError);
			expect(() => new ThreadPool(() => {})).to.throw(TypeError);
			expect(() => new ThreadPool([])).to.throw(TypeError);
			expect(() => new ThreadPool({ filename: 123 })).to.throw(TypeError);
			expect(() => new ThreadPool({ filename: new String(WORKER) })).to.throw(TypeError);
			expect(() => new ThreadPool({ filename: WORKER, minThreads: '8' })).to.throw(TypeError);
			expect(() => new ThreadPool({ filename: WORKER, minThreads: -1 })).to.throw(RangeError);
			expect(() => new ThreadPool({ filename: WORKER, minThreads: 8.01 })).to.throw(TypeError);
			expect(() => new ThreadPool({ filename: WORKER, maxThreads: '8' })).to.throw(TypeError);
			expect(() => new ThreadPool({ filename: WORKER, maxThreads: -1 })).to.throw(RangeError);
			expect(() => new ThreadPool({ filename: WORKER, maxThreads: 8.01 })).to.throw(TypeError);
		});
		it('does not accept relative paths for the filename', function () {
			expect(() => new ThreadPool({ filename: './workers/worker.js' })).to.throw(TypeError);
			expect(() => new ThreadPool({ filename: './test/workers/worker.js' })).to.throw(TypeError);
			expect(() => new ThreadPool({ filename: 'workers/worker.js' })).to.throw(TypeError);
			expect(() => new ThreadPool({ filename: 'test/workers/worker.js' })).to.throw(TypeError);
		});
		it('does not accept windows-style absolute paths for the filename', function () {
			expect(() => new ThreadPool({ filename: path.win32.normalize(WORKER) })).to.throw(TypeError);
		});
		it('does not accept non-JS file extensions in the filename', function () {
			expect(() => new ThreadPool({ filename: WORKER.slice(0, -3) + '.css' })).to.throw(TypeError);
			expect(() => new ThreadPool({ filename: WORKER.slice(0, -3) + '.jsx' })).to.throw(TypeError);
			expect(() => new ThreadPool({ filename: WORKER.slice(0, -3) + '.ts' })).to.throw(TypeError);
		});
		it('does not accept maxThreads less than minThreads', function () {
			expect(() => new ThreadPool({ filename: WORKER, minThreads: 1, maxThreads: 0 })).to.throw(RangeError);
			expect(() => new ThreadPool({ filename: WORKER, minThreads: 0, maxThreads: -1 })).to.throw(RangeError);
		});
		it('does not accept maxThreads equal to zero', function () {
			expect(() => new ThreadPool({ filename: WORKER, minThreads: 0, maxThreads: 0 })).to.throw(RangeError);
		});
		it('can be constructed with or without a file extension', async function () {
			expect(pool = new ThreadPool({ filename: WORKER })).to.be.an.instanceof(ThreadPool);
			await pool.call('echo');
			await pool.destroy();
			expect(pool = new ThreadPool({ filename: WORKER.slice(0, -3) })).to.be.an.instanceof(ThreadPool);
			await pool.call('echo');
		});
		it('can be constructed with or without "new"', async function () {
			expect(pool = new ThreadPool({ filename: WORKER })).to.be.an.instanceof(ThreadPool);
			await pool.call('echo');
			await pool.destroy();
			expect(pool = ThreadPool({ filename: WORKER })).to.be.an.instanceof(ThreadPool);
			await pool.call('echo');
		});
		it('constructs an instanceof EventEmitter', async function () {
			expect(pool = new ThreadPool({ filename: WORKER })).to.be.an.instanceof(EventEmitter);
			await pool.destroy();
			expect(pool = ThreadPool({ filename: WORKER })).to.be.an.instanceof(EventEmitter);
		});
		it('accepts native Worker options', async function () {
			pool = new ThreadPool({ filename: WORKER, argv: ['foo', 'bar', 'baz'] });
			expect((await pool.call('argv')).slice(2)).to.deep.equal(['foo', 'bar', 'baz']);
		});
		it('emits errors that occur while creating a worker', async function () {
			pool = new ThreadPool({ filename: '/nonexistent/1212342dfsfffadsg3rte/fake.js' });
			await new Promise((resolve, reject) => {
				pool.on('error', (err) => {
					try {
						expect(err).to.be.an.instanceof(Error);
					} catch (err) {
						return reject(err);
					}
					resolve();
				});
			});
		});
	});

	describe('ThreadPool properties', function () {
		it('has property: filename', function () {
			pool = new ThreadPool({ filename: WORKER });
			expect(pool.filename).to.equal(WORKER);
		});
		it('has property: threadCount', async function () {
			pool = new ThreadPool({ filename: WORKER, minThreads: 3, maxThreads: 3 });
			expect(pool.threadCount).to.equal(3);

			await pool.destroy();
			pool = new ThreadPool({ filename: WORKER, minThreads: 0, maxThreads: 1 });
			expect(pool.threadCount).to.equal(0);
			await pool.call('add', 5, 7);
			expect(pool.threadCount).to.equal(1);
		});
		it('has property: activeThreadCount', async function () {
			pool = new ThreadPool({ filename: WORKER, minThreads: 2, maxThreads: 2 });
			expect(pool.activeThreadCount).to.equal(0);

			const promise = pool.call('add', 5, 7);
			await new Promise((resolve, reject) => {
				promise.then(() => reject(new Error('Did not detect activeThreadCount === 1')), reject);
				setImmediate(function poll() {
					if (pool.activeThreadCount === 1) resolve();
					else setImmediate(poll);
				});
			});

			await promise;
			expect(pool.activeThreadCount).to.equal(0);
		});
		it('has property: pendingTaskCount', async function () {
			pool = new ThreadPool({ filename: WORKER, minThreads: 1, maxThreads: 1 });
			expect(pool.pendingTaskCount).to.equal(0);
			const promise1 = pool.call('add', 5, 7);
			expect(pool.pendingTaskCount).to.equal(1);
			const promise2 = pool.call('add', 5, 7);
			expect(pool.pendingTaskCount).to.equal(2);
			await promise1;
			expect(pool.pendingTaskCount).to.equal(1);
			await promise2;
			expect(pool.pendingTaskCount).to.equal(0);
		});
		it('has property: destroyed', async function () {
			pool = new ThreadPool({ filename: WORKER, minThreads: 1, maxThreads: 1 });
			expect(pool.destroyed).to.equal(false);
			const promise = pool.destroy();
			expect(pool.destroyed).to.equal(true);
			await promise;
			expect(pool.destroyed).to.equal(true);

			pool = new ThreadPool({ filename: '/nonexistent/1212342dfsfffadsg3rte/fake.js' });
			expect(pool.destroyed).to.equal(false);
			await new Promise((resolve, reject) => {
				pool.on('error', (err) => {
					try {
						expect(err).to.be.an.instanceof(Error);
						expect(pool.destroyed).to.equal(true);
					} catch (err) {
						return reject(err);
					}
					resolve();
				});
			});
		});
	});

	describe('ThreadPool call() method', function () {
		it('invokes an exported method in the worker', async function () {
			pool = new ThreadPool({ filename: WORKER });
			expect(await pool.call('echo')).to.deep.equal([]);
			expect(await pool.call('echo', 'foo', { bar: 123 })).to.deep.equal(['foo', { bar: 123 }]);
			expect(await pool.call('add', 5, 17)).to.equal(22);
		});
		it('invokes an exported async function in the worker', async function () {
			pool = new ThreadPool({ filename: WORKER });
			const buf1 = Buffer.from('hello');
			const buf2 = Buffer.from('world');
			expect(await pool.call('concatAsync', buf1, buf2)).to.deep.equal(Buffer.from('helloworld'));
		});
		it('propagates errors thrown in the worker', async function () {
			pool = new ThreadPool({ filename: WORKER });
			await pool.call('fail', 'this is some error').then(() => {
				throw new Error('Promise should have been rejected');
			}, (err) => {
				expect(err).to.be.an.instanceof(Error);
				expect(err.message).to.equal('this is some error');
			});
			await pool.call('failAsync', 'this is some error').then(() => {
				throw new Error('Promise should have been rejected');
			}, (err) => {
				expect(err).to.be.an.instanceof(Error);
				expect(err.message).to.equal('this is some error');
			});
		});

		describe('propagates errors thrown during worker initialization', function () {
			it('when the worker file is not found', async function () {
				pool = new ThreadPool({ filename: '/nonexistent/1212342dfsfffadsg3rte/fake.js' });
				pool.on('error', () => {});

				await pool.call('echo').then(() => {
					throw new Error('Promise should have been rejected');
				}, (err) => {
					expect(err).to.be.an.instanceof(Error);
				});
			});
			it('when the worker throws an exception (synchronously)', async function () {
				pool = new ThreadPool({ filename: INVALID_WORKER });
				let err;
				pool.on('error', (e) => { err = e; });

				await pool.call('echo').then(() => {
					throw new Error('Promise should have been rejected');
				}, (err) => {
					expect(err).to.be.an.instanceof(Error);
					expect(err.message).to.equal('this worker is for testing');
				});
				expect(err).to.be.an.instanceof(Error);
				expect(err.message).to.equal('this worker is for testing');
			});
			it('when the worker returns a rejected promise (asynchronously)', async function () {
				pool = new ThreadPool({ filename: INVALID_WORKER_ASYNC });
				let err;
				pool.on('error', (e) => { err = e; });

				await pool.call('echo').then(() => {
					throw new Error('Promise should have been rejected');
				}, (err) => {
					expect(err).to.be.an.instanceof(Error);
					expect(err.message).to.equal('this worker is for testing');
				});
				expect(err).to.be.an.instanceof(Error);
				expect(err.message).to.equal('this worker is for testing');
			});
		});
	});

	describe('ThreadPool invoke() method', function () {
		it('invokes an exported method in the worker', async function () {
			pool = new ThreadPool({ filename: WORKER });
			expect(await pool.invoke('echo')).to.deep.equal([]);
			expect(await pool.invoke('echo', {})).to.deep.equal([]);
			expect(await pool.invoke('echo', { args: undefined })).to.deep.equal([]);
			expect(await pool.invoke('echo', { args: ['foo', { bar: 123 }] })).to.deep.equal(['foo', { bar: 123 }]);
			expect(await pool.invoke('add', { args: [5, 17] })).to.equal(22);
		});
		it('invokes an exported async function in the worker', async function () {
			pool = new ThreadPool({ filename: WORKER });
			const buf1 = Buffer.from('hello');
			const buf2 = Buffer.from('world');
			expect(await pool.invoke('concatAsync', { args: [buf1, buf2] })).to.deep.equal(Buffer.from('helloworld'));
		});
		it('propagates errors thrown in the worker', async function () {
			pool = new ThreadPool({ filename: WORKER });
			await pool.invoke('fail', { args: ['this is some error'] }).then(() => {
				throw new Error('Promise should have been rejected');
			}, (err) => {
				expect(err).to.be.an.instanceof(Error);
				expect(err.message).to.equal('this is some error');
			});
			await pool.invoke('failAsync', { args: ['this is some error'] }).then(() => {
				throw new Error('Promise should have been rejected');
			}, (err) => {
				expect(err).to.be.an.instanceof(Error);
				expect(err.message).to.equal('this is some error');
			});
		});

		describe('propagates errors thrown during worker initialization', function () {
			it('when the worker file is not found', async function () {
				pool = new ThreadPool({ filename: '/nonexistent/1212342dfsfffadsg3rte/fake.js' });
				pool.on('error', () => {});

				await pool.invoke('echo').then(() => {
					throw new Error('Promise should have been rejected');
				}, (err) => {
					expect(err).to.be.an.instanceof(Error);
				});
			});
			it('when the worker throws an exception (synchronously)', async function () {
				pool = new ThreadPool({ filename: INVALID_WORKER });
				let err;
				pool.on('error', (e) => { err = e; });

				await pool.invoke('echo').then(() => {
					throw new Error('Promise should have been rejected');
				}, (err) => {
					expect(err).to.be.an.instanceof(Error);
					expect(err.message).to.equal('this worker is for testing');
				});
				expect(err).to.be.an.instanceof(Error);
				expect(err.message).to.equal('this worker is for testing');
			});
			it('when the worker returns a rejected promise (asynchronously)', async function () {
				pool = new ThreadPool({ filename: INVALID_WORKER_ASYNC });
				let err;
				pool.on('error', (e) => { err = e; });

				await pool.invoke('echo').then(() => {
					throw new Error('Promise should have been rejected');
				}, (err) => {
					expect(err).to.be.an.instanceof(Error);
					expect(err.message).to.equal('this worker is for testing');
				});
				expect(err).to.be.an.instanceof(Error);
				expect(err.message).to.equal('this worker is for testing');
			});
		});
	});

	describe('ThreadPool destroy() method', function () {
		it('destroys the ThreadPool, returning a promise', async function () {
			pool = new ThreadPool({ filename: WORKER, minThreads: 2, maxThreads: 2 });
			expect(pool.destroyed).to.equal(false);
			expect(pool.threadCount).to.equal(2);
			const promise = pool.destroy();
			expect(promise).to.be.an.instanceof(Promise);
			expect(pool.destroyed).to.equal(true);
			await promise;
			expect(pool.threadCount).to.equal(0);
			expect(pool.destroyed).to.equal(true);

			await pool.call('add', 5, 7).then(() => {
				throw new Error('Promise should have been rejected');
			}, (err) => {
				expect(err).to.be.an.instanceof(Error);
			});

			await pool.invoke('add', { args: [5, 7] }).then(() => {
				throw new Error('Promise should have been rejected');
			}, (err) => {
				expect(err).to.be.an.instanceof(Error);
			});
		});
		it('forcefully stops all existing threads in the ThreadPool', async function () {
			pool = new ThreadPool({ filename: WORKER, minThreads: 1, maxThreads: 2 });
			await pool.call('add', 5, 7);
			expect(pool.pendingTaskCount).to.equal(0);
			const promise1 = pool.call('add', 5, 7);
			const promise2 = pool.call('add', 5, 7);
			const promise3 = pool.call('add', 5, 7);
			expect(pool.pendingTaskCount).to.equal(3);
			promise1.catch(() => {});
			promise2.catch(() => {});
			promise3.catch(() => {});
			await pool.destroy();

			await Promise.all([promise1, promise2, promise3].map((promise) => {
				return promise.then(() => {
					throw new Error('Promise should have been rejected');
				}, (err) => {
					expect(err).to.be.an.instanceof(Error);
				});
			}));
		});
		it('propagates the given error to all pending tasks', async function () {
			pool = new ThreadPool({ filename: WORKER, minThreads: 1, maxThreads: 2 });
			await pool.call('add', 5, 7);
			expect(pool.pendingTaskCount).to.equal(0);
			const promise1 = pool.call('add', 5, 7);
			const promise2 = pool.call('add', 5, 7);
			const promise3 = pool.call('add', 5, 7);
			expect(pool.pendingTaskCount).to.equal(3);
			promise1.catch(() => {});
			promise2.catch(() => {});
			promise3.catch(() => {});
			const error = new Error('this is an error');
			await pool.destroy(error);

			await Promise.all([promise1, promise2, promise3].map((promise) => {
				return promise.then(() => {
					throw new Error('Promise should have been rejected');
				}, (err) => {
					expect(err).to.equal(error);
				});
			}));
		});
	});
});
