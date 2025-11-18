import { INodeFunctionBaseParams } from "@cognigy/extension-tools";
import fetchRetry from "fetch-retry";

const fetchRetry_ = fetchRetry(fetch);

// --- Execution Options Interface ---
export interface IExecutionOptions {
	timeout?: number;
	retries?: number;
}

// --- Logging Helper (Local to Nodes) ---
const logNodeError = (message: string, error: any) => {
	// Simple error logging for Nodes. 
	// You can expand this to match the Knowledge logger if needed.
	console.error(JSON.stringify({
		level: "error",
		message: message,
		error: error.message || error
	}));
};

// --- Robust Fetching Logic for Nodes ---

/**
 * Fetch method with retry and timeout configuration specifically for Flow Nodes.
 */
export async function fetchWithRetry(
	url: string,
	options: RequestInit = {},
	executionOptions: IExecutionOptions = {}
): Promise<any> {
	// Default to 8000ms (8s) to fail before Cognigy's 20s hard limit
	const { timeout = 8000, retries = 0 } = executionOptions;

	// Setup Timeout using AbortController
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeout);

	const fetchOptions = {
		method: "GET",
		...options,
		signal: controller.signal, // Link signal to fetch
		retries: retries,
		retryDelay: 1000,
		retryOn: [408, 429, 500, 502, 503, 504] as number[],
	};

	try {
		const response = await fetchRetry_(url, fetchOptions);
		clearTimeout(timeoutId); // Clear timeout immediately on response

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}
		// Handle 204 No Content
		if (response.status === 204) {
			return null;
		}
		return await response.json();
	} catch (error: any) {
		clearTimeout(timeoutId); // Ensure timeout is cleared on error
		
		// Custom error message for timeouts
		if (error.name === 'AbortError') {
			throw new Error(`Request timed out after ${timeout}ms`);
		}
		throw error;
	}
}

/**
 * Helper for making authenticated requests to Contentful from Nodes.
 */
export const fetchData = async (
	url: string,
	accessToken: string,
	params: object = {},
	executionOptions: IExecutionOptions = {}
) => {
	const urlParams = new URLSearchParams(
		params as Record<string, string>,
	).toString();
	const fullUrl = `${url}?${urlParams}&access_token=${accessToken}`;

	return await fetchWithRetry(fullUrl, {
		method: "GET",
		headers: {
			"Content-Type": "application/json",
		},
	}, executionOptions);
};

// --- Existing Helper ---

interface IAddToStorageParams {
	api: INodeFunctionBaseParams["cognigy"]["api"];
	storeLocation: string;
	contextKey: string;
	inputKey: string;
	data: any;
	mode?: "simple" | "array";
}

export const addToStorage = ({ api, storeLocation, contextKey, inputKey, data, mode = "simple" }: IAddToStorageParams) => {
	const storeKey = storeLocation === "context" ? contextKey : inputKey;
	if (!storeKey) return;

	switch (storeLocation) {
		case "context":
			api.addToContext(storeKey, data, mode);
			break;
		case "input":
			// @ts-ignore
			api.addToInput(storeKey, data);
			break;
	}
};