export const STARTUP_INFO_ADD_EVENT = "pi-startup-info:add";

export function addStartupInfo(emit, message) {
	const text = typeof message === "string" ? message.trim() : "";
	if (!text) return;
	emit(STARTUP_INFO_ADD_EVENT, { message: text });
}
