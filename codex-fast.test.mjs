import { strict as assert } from "node:assert";
import codexFast, { fastPayload } from "./codex-fast.ts";

const payload = { model: "gpt-5.5", input: [] };
assert.equal(fastPayload(payload, false), undefined);
assert.deepEqual(fastPayload(payload, true), { ...payload, service_tier: "fast" });
assert.deepEqual(fastPayload(payload, "ultrafast"), { ...payload, service_tier: "ultrafast" });
assert.equal(fastPayload(null, true), undefined);
assert.equal(fastPayload([], true), undefined);
assert.deepEqual(payload, { model: "gpt-5.5", input: [] });

const handlers = new Map();
const events = new Map();
const pi = {
	on(name, handler) { handlers.set(name, handler); },
	registerCommand(name, command) { handlers.set(name, command.handler); },
	events: {
		on(name, handler) { events.set(name, handler); },
		emit(name, data) { events.get(name)?.(data); },
	},
};
codexFast(pi);
const notices = [];
const ctx = (provider, id, api = "openai-responses") => ({
	model: { provider, id, api },
	ui: { notify: (message) => notices.push(message) },
});
const request = (context) => handlers.get("before_provider_request")({ payload }, context);
const command = handlers.get("fast");
const first = ctx("internal", "gpt-5.5");
const second = ctx("internal", "gpt-5.6-sol");
const other = ctx("internal-grok", "grok-4.7");
const states = [];
events.set("internal-fast:state", (state) => states.push(state));
assert.equal(request(first), undefined);
command("on", first);
assert.equal(request(first).service_tier, "fast");
assert.equal(request(second), undefined);
command("on", other);
assert.equal(request(other), undefined);
command("off", first);
assert.equal(request(first), undefined);
command("on", first);
const ultra = handlers.get("ultrafast");
ultra("on", first);
assert.equal(request(first).service_tier, "ultrafast");
assert.equal(states.at(-1).enabled, true);
assert.equal(states.at(-1).tier, "ultrafast");
ultra("status", first);
assert.ok(notices.at(-1).endsWith("ultrafast on"));
command("off", first);
assert.equal(request(first).service_tier, "ultrafast");
command("", first);
assert.equal(request(first).service_tier, "fast");
ultra("", first);
assert.equal(request(first).service_tier, "ultrafast");
ultra("", first);
assert.equal(request(first), undefined);
ultra("invalid", first);
assert.equal(request(first), undefined);
ultra("on", other);
assert.equal(request(other), undefined);
ultra("on", first);
handlers.get("session_start")();
assert.equal(request(first), undefined);
assert.deepEqual(states.at(-1), { modelKey: "internal/gpt-5.5", enabled: false, tier: undefined });
assert.ok(notices.some((notice) => notice.includes("only available")));
