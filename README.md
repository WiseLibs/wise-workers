# wise-workers

A worker thread pool for Node.js, for CPU-bound tasks. It requires no configuration and has many powerful features:

- **Worker functions can be [generators](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/function*) or [async generators](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function*)**, making it easy to stream results back to the main thread. Iteration happens eagerly, to maximize parallelism (i.e., the main thread cannot pause the generator function).
- **Callback functions can be passed to workers.** They become `async` functions in the worker thread, using [MessagePort](https://nodejs.org/docs/latest/api/worker_threads.html#class-messageport) for communication under the hood.
- **Tasks can be aborted** using an [AbortSignal](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal).
- **Crashed threads are automatically respawned**, unless they're crashing during startup.
- **Data can be efficiently moved** between threads (zero-copy).

## Installation

```
npm install wise-workers
```

> Requires Node.js v14.x.x or later.

## Usage

```js
const ThreadPool = require('wise-workers');

const pool = new ThreadPool({ filename: require.resolve('./worker') });

const result = await pool.call('add', 2, 2); // => 4
```

#### worker.js

```js
exports.add = (a, b) => a + b;
```

### Zero-copy example

```js
const ThreadPool = require('wise-workers');

const pool = new ThreadPool({ filename: require.resolve('./worker') });

const data = Buffer.alloc(1024 * 1024);

// pool.invoke() allows you to provide more options than pool.call()
const compressedData = await pool.invoke('compress', {
    args: [data],
    transferList: [data.buffer], // Pass the ArrayBuffer in the transferList
});
```

#### worker.js

```js
const zlib = require('zlib');
const { move } = require('wise-workers');

exports.compress = (data) => {
    const compressedData = zlib.gzipSync(data);

    // Use move() to include a transferList in the return value.
    return move(compressedData, [compressedData.buffer]);
};
```

### Generator example

When calling a generator function, you will get an [async iterable](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for-await...of) object.

```js
const ThreadPool = require('wise-workers');

const pool = new ThreadPool({ filename: require.resolve('./worker') });

const asyncIterable = await pool.call('readFile', 'data.csv');

for await (const chunk of asyncIterable) {
    console.log(`got chunk of size ${chunk.byteLength} bytes`);
}
```

#### worker.js

```js
const fs = require('fs');
const { move } = require('wise-workers');

exports.readFile = function* (filename, chunkSize = 1024 * 16) {
    const fd = fs.openSync(filename);
    try {
        while (true) {
            const buffer = Buffer.alloc(chunkSize);
            const bytesRead = fs.readSync(fd, buffer, 0, chunkSize);
            if (bytesRead > 0) {
                const chunk = buffer.subarray(0, bytesRead);
                // You can move() yielded values too
                yield move(chunk, [chunk.buffer]);
            }
            if (bytesRead < chunkSize) {
                break;
            }
        }
    } finally {
        fs.closeSync(fd);
    }
};
```

### Callback function example

You an pass callback functions to the worker, but they must be in the top-level arguments (they can't be nested within some other object). Callback functions can also be `async` functions.

```js
const ThreadPool = require('wise-workers');

const pool = new ThreadPool({ filename: require.resolve('./worker') });

const allowedList = new Set(getHugeDataset());
const result = await pool.call('search', searchTerm, (value) => {
    return allowedList.has(value);
});
```

#### worker.js

```js
exports.search = async (searchTerm, filter) => {
    const matches = [];
    for (const match of searchFor(searchTerm)) {
        if (await filter(match)) {
            matches.push(match);
        }
    }
    return matches;
};
```

> Currently, callback functions do not support "zero-copy" data transfer in their arguments or return values. This restriction may be lifted in the future.

### AbortSignal example

Calling `controller.abort()` will forcefully terminate the thread that's assigned to the associated task.

```js
const ThreadPool = require('wise-workers');

const pool = new ThreadPool({ filename: require.resolve('./worker') });

const controller = new AbortController();
setTimeout(() => {
    controller.abort();
}, 1000);

await pool.invoke('infiniteLoop', {
    signal: controller.signal,
});
```

#### worker.js

```js
exports.infiniteLoop = () => {
    while (true) {}
};
```

> Forcefulling aborting a thread is not a cheap operation, so it should only be used for exceptional/rare situations. For more common situations where performance is critical, you can use [`util.transferableAbortSignal()`](https://nodejs.org/docs/latest/api/util.html#utiltransferableabortsignalsignal) to implement your own co-operative cancellation logic.

# API

## new ThreadPool(*options*)

Creates a new thread pool. The following options are supported:

- `filename` (string, required)
	* The absolute path to the worker script or module. Both CommonJS and ESM modules are supported. Even on Windows machines, a POSIX-style path is required.
- `minThreads` (number, optional)
	* The minimum number of worker threads to keep in the pool. By default, this is equal to **half** the number of physical CPUs on the machine.
- `maxThreads` (number, optional)
	* The maximum number of worker threads to keep in the pool. By default, this is equal to the number of physical CPUs on the machine.
- The following options are passed directly to [`new Worker()`](https://nodejs.org/docs/latest/api/worker_threads.html#new-workerfilename-options) under the hood:
	* `execArgv`
	* `argv`
	* `env`
	* `workerData`
	* `resourceLimits`
	* `trackUnmanagedFds`
	* `name`

ThreadPool is an [EventEmitter](https://nodejs.org/api/events.html#class-eventemitter). The only event it emits is `error`, which occurs if a worker thread crashes unexpectedly.

### pool.call(*methodName*, [*...args*]) -> *promise*

Invokes a function exported by a worker thread. Even if the worker's function is synchronous, this method always returns a [Promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise).

The args can contain any value that is supported by the [HTML structured clone algorithm](https://nodejs.org/docs/latest/api/worker_threads.html#portpostmessagevalue-transferlist). Additionally, functions may be passed within the top-level arguments (i.e., not nested within some other object), in which case they appear as `async` functions in the worker thread.

If the worker method is a [generator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/function*) or [async generator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function*) function, the returned promise will be resolved with an [async iterable](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for-await...of) object.

### pool.invoke(*methodName*, [*options*]) -> *promise*

This is the same as `pool.call()`, except it supports more options:

- `args` (Array, optional)
	* The arguments to pass to the worker function.
- `transferList` (Array, optional)
	* A list of [transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects) within `args` that should be moved, rather than copied to the worker thread ("zero-copy").
- `signal` ([AbortSignal](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal), optional)
	* An AbortSignal that, when aborted, will forcefully stop this task. If the signal is aborted after the task completes, nothing happens.

### pool.destroy([*error*]) -> *promise*

Destroys the thread pool, cancelling any pending tasks and permanently terminating all threads. After being destroyed, the thread pool is no longer usable.

If an `error` object is provided, all pending tasks will be rejected with it. Otherwise, a default error is used.

The returned promise resolves when all threads have finished shutting down.

### ThreadPool properties

- `pool.filename`: The filename of the worker script being used.
- `pool.threadCount`: The number of threads currently spawned within the pool.
- `pool.activeThreadCount`: The number of threads which are busy with a pending task.
- `pool.pendingTaskCount`: The number of pending tasks yet to be resolved.
- `pool.destroyed`: Whether or not the thread pool is destroyed (boolean).

## License

[MIT](https://github.com/WiseLibs/wise-river/blob/master/LICENSE)
