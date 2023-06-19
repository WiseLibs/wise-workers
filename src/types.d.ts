import EventEmitter from 'events';

declare class ThreadPool extends EventEmitter {
	get filename(): string;
	get threadCount(): number;
	get activeThreadCount(): number;
	get pendingTaskCount(): number;
	get destroyed(): boolean;

	call(methodName: string, ...args: any[]): Promise<any>;
	invoke(methodName: string, options?: ThreadPool.InvokeOptions): Promise<any>;
	destroy(error?: Error): Promise<void>;
}

declare namespace ThreadPool {
	export interface InvokeOptions {
		args?: ReadonlyArray<any>;
		transferList?: ReadonlyArray<any>;
		signal?: AbortSignal;
	}
}

export = ThreadPool;
