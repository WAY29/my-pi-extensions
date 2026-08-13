import type { NotifyHookAdapter } from "./adapters/types";

const adapters: NotifyHookAdapter[] = [];

export function registerNotifyHookAdapter(adapter: NotifyHookAdapter): void {
	if (adapters.some((item) => item.name === adapter.name)) return;
	adapters.push(adapter);
}

export function listNotifyHookAdapters(): readonly NotifyHookAdapter[] {
	return adapters;
}
