import {
	createNodeDescriptor,
	type INodeFunctionBaseParams,
} from "@cognigy/extension-tools";
import { fetchData } from "../knowledge/utils"; 
import { addToStorage } from "./node-utils";

export interface ISearchEntriesParams extends INodeFunctionBaseParams {
	config: {
		connection: {
			spaceId: string;
			accessToken: string;
		};
		query: string;
		storeLocation: string;
		contextKey: string;
		inputKey: string;
	};
}
export const searchEntriesNode = createNodeDescriptor({
	type: "searchEntries",
	defaultLabel: "Search Entries",
	preview: {
		key: "query",
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
			key: "query",
			label: "Query",
			description: "A full-text search query",
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
			defaultValue: "contentful.search",
			condition: {
				key: "storeLocation",
				value: "input",
			},
		},
		{
			key: "contextKey",
			type: "cognigyText",
			label: "Context Key to store Result",
			defaultValue: "contentful.search",
			condition: {
				key: "storeLocation",
				value: "context",
			},
		},
	],
	sections: [
		{
			key: "storage",
			label: "Storage Option",
			defaultCollapsed: true,
			fields: ["storeLocation", "inputKey", "contextKey"],
		},
	],
	form: [
		{ type: "field", key: "connection" },
		{ type: "field", key: "query" },
		{ type: "section", key: "storage" },
	],
	appearance: {
		color: "#0078D4", 
	},
	function: async ({ cognigy, config }: INodeFunctionBaseParams) => {
		const { api } = cognigy;
		const { query, connection, storeLocation, contextKey, inputKey } = config as ISearchEntriesParams["config"];
		const { spaceId, accessToken } = connection;

		const url = `https://cdn.contentful.com/spaces/${spaceId}/environments/master/entries`;
		const params = { query: query };

		try {
			// 'api' parameter is removed from fetchData
			const response = await fetchData(url, accessToken, params);
			addToStorage({ api, storeLocation, contextKey, inputKey, data: response });
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
			addToStorage({ api, storeLocation, contextKey, inputKey, data: { error: errorMessage } });
		}
	},
});