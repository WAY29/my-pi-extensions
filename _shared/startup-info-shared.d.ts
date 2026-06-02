export declare const STARTUP_INFO_ADD_EVENT: "pi-startup-info:add";
export declare function addStartupInfo(emit: (event: string, data: { message: string }) => void, message: string | undefined | null): void;
