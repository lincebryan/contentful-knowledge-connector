import {
	createNodeDescriptor,
	type INodeFunctionBaseParams,
} from "@cognigy/extension-tools";
import { fetchData } from "../knowledge/utils"; 
import { addToStorage } from "./node-utils";

export interface IGetSingleEntryParams extends INodeFunctionBaseParams {
	config: {
		connection: {
			spaceId: string;
			accessToken: string;
		};
		environment: string;
		entryId: string;
		storeLocation: string;
		contextKey: string;
		inputKey: string;
	};
}
export const getSingleEntryNode = createNodeDescriptor({
	type: "getSingleEntry",
	defaultLabel: "Get Single Entry",
	preview: {
		key: "entryId",
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
			key: "environment",
			label: "Environment",
			type: "text",
			defaultValue: "master",
			description: "The Contentful environment (e.g. 'master' or 'staging')",
			params: {
				required: true,
			},
		},
		{
			key: "entryId",
			label: "Entry ID",
			description: "The unique ID of the entry to retrieve",
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
			defaultValue: "contentful.entry",
			condition: {
				key: "storeLocation",
				value: "input",
			},
		},
		{
			key: "contextKey",
			type: "cognigyText",
			label: "Context Key to store Result",
			defaultValue: "contentful.entry",
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
		{ type: "field", key: "environment" },
		{ type: "field", key: "entryId" },
		{ type: "section", key: "storage" },
	],
	appearance: {
		color: "#0078D4", 
	},
	function: async ({ cognigy, config }: INodeFunctionBaseParams) => {
		const { api } = cognigy;
		const { entryId, connection, environment, storeLocation, contextKey, inputKey } = config as IGetSingleEntryParams["config"];
		const { spaceId, accessToken } = connection;

		const url = `https://cdn.contentful.com/spaces/${spaceId}/environments/${environment}/entries/${entryId}`;

		try {
			const response = await fetchData(url, accessToken, {});
			addToStorage({ api, storeLocation, contextKey, inputKey, data: response });
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
			addToStorage({ api, storeLocation, contextKey, inputKey, data: { error: errorMessage } });
		}
	},
});