'use strict';
const worker = require('worker_threads');

process.on('unhandledRejection', () => {
	throw err;
});

// Unwrap the user's workerData, and extract our own pieces of it.
const {
	OP_RESPONSE,
	OP_READY,
	FILENAME,
} = worker.workerData;
worker.workerData = worker.workerData.workerData;

// TODO: implement worker (load file, listen for tasks, invoke, respond)
