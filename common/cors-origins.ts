/**
 * CORS is open to any origin (`origin: true` in main.ts / gateways).
 * Kept only for any legacy imports that expect a list helper.
 */
export function resolveCorsOrigins(): true {
	return true;
}

export function isCorsOriginAllowed(_origin?: string): boolean {
	return true;
}

export function createCorsOriginDelegate() {
	return (
		_origin: string | undefined,
		callback: (err: Error | null, allow?: boolean) => void,
	) => {
		callback(null, true);
	};
}
