import { INodeFunctionBaseParams } from "@cognigy/extension-tools";
import fetchRetry from "fetch-retry";

const fetchRetry_ = fetchRetry(fetch);

// --- Logging Helper ---
const logNodeError = (message: string, error: any) => {
	console.error(JSON.stringify({
		level: "error",
		message: message,
		error: error.message || error
	}));
};

/**
 * Helper for making authenticated requests to Contentful from Nodes.
 * Uses simple fetch-retry logic without complex timeouts.
 */
export const fetchData = async (
	url: string,
	accessToken: string,
	params: object = {}
) => {
	const urlParams = new URLSearchParams(
		params as Record<string, string>,
	).toString();
	const fullUrl = `${url}?${urlParams}&access_token=${accessToken}`;

	const fetchOptions = {
		method: "GET",
		headers: {
			"Content-Type": "application/json",
		},
		retries: 3,
		retryDelay: 1000,
		retryOn: [408, 429, 500, 502, 503, 504] as number[],
	};

	try {
		const response = await fetchRetry_(fullUrl, fetchOptions);

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}
		if (response.status === 204) {
			return null;
		}
		return await response.json();
	} catch (error: any) {
		logNodeError(`Failed to fetch from ${fullUrl}`, error);
		throw error;
	}
};

// --- Storage Helper ---

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