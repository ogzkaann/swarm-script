/// <reference lib="webworker" />
import type { MainToWorkerMessage } from '@swarm-script/shared';
import { SimulationHost } from './SimulationHost';

const worker = self as DedicatedWorkerGlobalScope;
const host = new SimulationHost((message) => worker.postMessage(message));

worker.onmessage = (event: MessageEvent<MainToWorkerMessage>) => host.handle(event.data);
setInterval(() => host.advanceFrame(), 1000 / 30);

export {};
