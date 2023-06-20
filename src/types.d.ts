import EventEmitter from 'events';
import { WorkerOptions } from 'worker_threads';

declare class ThreadPool extends EventEmitter {
	constructor(options: ThreadPool.ThreadPoolOptions);

	readonly filename: string;
	get threadCount(): number;
	get activeThreadCount(): number;
	get pendingTaskCount(): number;
	get destroyed(): boolean;

	call<T = any>(methodName: string, ...args: any[]): Promise<T>;
	invoke<T = any>(methodName: string, options?: ThreadPool.InvokeOptions): Promise<T>;
	destroy(error?: Error): Promise<void>;

	static move<T = any>(value: T, transferList: ReadonlyArray<any>): ThreadPool.Movable<T>;
}

declare namespace ThreadPool {
	export interface ThreadPoolOptions {
		filename: string;
		minThreads?: number;
		maxThreads?: number;
		execArgv?: WorkerOptions['execArgv'];
		argv?: WorkerOptions['argv'];
		env?: WorkerOptions['env'];
		workerData?: WorkerOptions['workerData'];
		resourceLimits?: WorkerOptions['resourceLimits'];
		trackUnmanagedFds?: WorkerOptions['trackUnmanagedFds'];
		name?: WorkerOptions['name'];
	}
	export interface InvokeOptions {
		args?: ReadonlyArray<any>;
		transferList?: ReadonlyArray<any>;
		signal?: AbortSignal;
	}
	export interface Movable<T = any> {
		readonly value: T;
		readonly transferList: ReadonlyArray<any>;
	}
}

export = ThreadPool;
