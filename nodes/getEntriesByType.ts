import {
	createNodeDescriptor,
	type INodeFunctionBaseParams,
} from "@cognigy/extension-tools";
// CHANGED: Import fetchData from local node-utils, NOT knowledge/utils
import { fetchData, addToStorage } from "./node-utils"; 

export interface IGetEntriesByTypeParams extends INodeFunctionBaseParams {
	config: {
		connection: {
			spaceId: string;
			accessToken: string;
		};
		contentTypeId: string;
		storeLocation: string;
		contextKey: string;
		inputKey: string;
		// New Fields
		timeout: number;
		retryAttempts: number;
		cacheResult: boolean;
	};
}

export const getEntriesByTypeNode = createNodeDescriptor({
	type: "getEntriesByType",
	defaultLabel: "Get Entries by Type",
	preview: {
		key: "contentTypeId",
		type: "text",
	},
	fields: [
		{
			key: "connection",
			label: "Contentful Connection",
			type: "connection",
			params: {
				connectionType: "contentful",
				required: true,
			},
		},
		{
			key: "contentTypeId",
			label: "Content Type ID",
			description: "The ID of the content type (e.g., 'faqEntry')",
			type: "cognigyText",
			params: {
				required: true,
			},
		},
		{
			key: "storeLocation",
			type: "select",
			label: "Where to store the result",
			defaultValue: "input",
			params: {
				options: [
					{ label: "Input", value: "input" },
					{ label: "Context", value: "context" },
				],
				required: true,
			},
		},
		{
			key: "inputKey",
			type: "cognigyText",
			label: "Input Key to store Result",
			defaultValue: "contentful.entries",
			condition: {
				key: "storeLocation",
				value: "input",
			},
		},
		{
			key: "contextKey",
			type: "cognigyText",
			label: "Context Key to store Result",
			defaultValue: "contentful.entries",
			condition: {
				key: "storeLocation",
				value: "context",
			},
		},
		// --- NEW: Execution & Caching Fields ---
		{
			key: "timeout",
			type: "number",
			label: "Timeout (ms)",
			defaultValue: 8000,
			description: "Abort the request if it takes longer than this (default 8000ms).",
		},
		{
			key: "retryAttempts",
			type: "number",
			label: "Retry Attempts",
			defaultValue: 0,
			description: "Number of times to retry on network failure (default 0).",
		},
		{
			key: "cacheResult",
			type: "toggle",
			label: "Cache Results",
			defaultValue: false,
			description: "If enabled, the node will not fetch data if the storage key already has a value.",
		}
	],
	sections: [
		{
			key: "storage",
			label: "Storage Option",
			defaultCollapsed: true,
			fields: ["storeLocation", "inputKey", "contextKey"],
		},
		{
			key: "execution",
			label: "Execution & Caching",
			defaultCollapsed: true,
			fields: ["timeout", "retryAttempts", "cacheResult"],
		},
	],
	form: [
		{ type: "field", key: "connection" },
		{ type: "field", key: "contentTypeId" },
		{ type: "section", key: "storage" },
		{ type: "section", key: "execution" }, // Add new section to form
	],
	appearance: {
		color: "#0078D4", 
	},
	function: async ({ cognigy, config }: INodeFunctionBaseParams) => {
		const { api } = cognigy;
		const { 
			contentTypeId, 
			connection, 
			storeLocation, 
			contextKey, 
			inputKey,
			timeout, 
			retryAttempts, 
			cacheResult 
		} = config as IGetEntriesByTypeParams["config"];
		
		const { spaceId, accessToken } = connection;

		// --- CACHING LOGIC ---
		if (cacheResult) {
			// Check if data exists in the target location
			let existingData;
			if (storeLocation === "context") {
				// @ts-ignore: cognigy typing limitation
				existingData = cognigy.context[contextKey];
			} else {
				// @ts-ignore
				existingData = cognigy.input[inputKey];
			}

			// If data exists and is not an error object, return early
			if (existingData && !existingData.error) {
				return; // Skip fetch, use cached data
			}
		}

		const url = `https://cdn.contentful.com/spaces/${spaceId}/environments/master/entries`;
		const params = { content_type: contentTypeId };

		try {
			// Use local fetchData with execution options
			const response = await fetchData(url, accessToken, params, {
				timeout: timeout,
				retries: retryAttempts
			});
			
			addToStorage({ api, storeLocation, contextKey, inputKey, data: response });
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
			addToStorage({ api, storeLocation, contextKey, inputKey, data: { error: errorMessage } });
		}
	},
});