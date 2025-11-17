import { IConnectionSchema } from "@cognigy/extension-tools";

export const azureConnection: IConnectionSchema = {
	type: "AzureOpenAIProviderV2",
	label: "Azure OpenAI",
	fields: [
		// --- FIX: Removed 'endpoint' field as per your screenshot ---
		{ fieldName: "apiKey" }
	],
};