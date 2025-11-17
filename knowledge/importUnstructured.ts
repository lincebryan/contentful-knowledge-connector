import {
	createKnowledgeConnector,
	IKnowledge,
} from "@cognigy/extension-tools";
import {
	assembleContentFromEntry,
	chunkWithRecursiveSplitter,
	getEntries,
	IContentfulEntry,
	IContentfulResponse,
	logMessage,
} from "./utils"; // This must be the hard-coded utils-v7.ts file
import axios from "axios";
import { z } from "zod";

// --- Zod Schema to validate the LLM's output ---
const LlmChunkResponseSchema = z.object({
	chunks: z.array(z.string()),
});

// --- Interface for this connector's config fields ---
interface IImportUnstructuredConfig {
	connection: { // This is the Contentful connection
		spaceId: string;
		accessToken: string;
	};
	environment: string;
	contentTypeId: string;
	titleFieldId: string;
	modulesFieldId: string;
	// --- Optional Filters (using hard-coded field IDs) ---
	mainTopicValue?: string;
	subTopicValue?: string;
	// --------------------------------------------------
	additionalTags?: string[];
	chunkingStrategy: "recursive" | "llm";
	azureLlmConnection?: { // This is the Azure connection
		apiKey: string;
	};
	azureCustomEndpointUrl?: string; // The full URL for the LLM call
	llmChunkingPrompt?: string;
}

// --- HARD-CODED FIELD IDs ---
const MAIN_TOPIC_FIELD_ID = "mainTopic";
const SUB_TOPIC_FIELD_ID = "knowledgeGroup";
// -----------------------------

export const importUnstructuredConnector = createKnowledgeConnector({
	type: "importUnstructured",
	label: "4. Import Unstructured (Advanced)",
	summary:
		"Imports entries with advanced options for filtering and LLM chunking.",
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
			params: {
				required: true,
			},
		},
		{
			key: "contentTypeId",
			label: "Content Type ID",
			type: "text",
			description:
				"The API ID of the Content Type to import (e.g., 'article').",
			defaultValue: "article",
			params: {
				required: true,
			},
		},
		{
			key: "titleFieldId",
			label: "Title Field ID",
			type: "text",
			description:
				"The API ID of the field to use as the title (e.g., 'title').",
			defaultValue: "title",
			params: {
				required: true,
			},
		},
		{
			key: "modulesFieldId",
			label: "Modular Content Field ID",
			type: "text",
			description:
				"The API ID of the Rich Text or Component List field (e.g., 'body').",
			defaultValue: "body",
			params: {
				required: true,
			},
		},
		// --- Optional Filters (Hard-coded) ---
		{
			key: "mainTopicValue",
			label: "Main Topic Value (Optional Filter)",
			type: "text",
			description:
				"Optional. The value to filter for (e.g., 'Internet'). Uses the 'mainTopic' field.",
		},
		{
			key: "subTopicValue",
			label: "Sub-Topic Value (Optional Filter)",
			type: "text",
			description:
				"Optional. The value to filter for (e.g., 'Wi-Fi'). Uses the 'knowledgeGroup' field.",
		},
		// --- LLM Chunking Strategy ---
		{
			key: "chunkingStrategy",
			label: "Chunking Strategy",
			type: "select",
			description:
				"Select the method for splitting content into chunks.",
			defaultValue: "recursive",
			params: {
				required: true,
				options: [
					{
						label: "Recursive Splitter (Fast & Free)",
						value: "recursive",
					},
					{
						label: "LLM Semantic Chunking (Smarter)",
						value: "llm",
					},
				],
			},
		},
		{
			key: "azureLlmConnection",
			label: "Azure OpenAI Connection",
			type: "connection",
			params: {
				connectionType: "AzureOpenAIProviderV2",
				required: true,
			},
			condition: {
				key: "chunkingStrategy",
				value: "llm",
			},
		},
		{
			key: "azureCustomEndpointUrl",
			label: "Azure Custom Endpoint URL",
			type: "text",
			description:
				"The full API endpoint for your Azure OpenAI deployment (e.g., 'https://.../chat/completions?api-version=...').",
			params: {
				required: true,
			},
			condition: {
				key: "chunkingStrategy",
				value: "llm",
			},
		},
		{
			key: "llmChunkingPrompt",
			label: "Semantic Chunking Prompt",
			type: "text",
			description:
				"The prompt to instruct the LLM. Use {{text_to_chunk}} as the placeholder.",
			defaultValue: `You are an expert content ingestion model. Your task is to split a large document into semantic chunks.
You will be given a single block of text.
You MUST follow these rules:
1.  Analyze the text and split it into logical, self-contained chunks based on topic and meaning.
2.  Each chunk MUST be less than 2000 characters.
3.  The chunks must be returned as a valid JSON object with a single key: "chunks".
4.  The "chunks" key must contain an array of strings, where each string is one semantic chunk.

Example Output:
{
  "chunks": [
    "This is the first semantic chunk. It's about topic A.",
    "This is the second semantic chunk, which discusses topic B in its entirety.",
    "This is the third chunk."
  ]
}

Here is the document to chunk:
{{text_to_chunk}}
`,
			condition: {
				key: "chunkingStrategy",
				value: "llm",
			},
		},
		{
			key: "additionalTags",
			label: "Additional Source Tags (Optional)",
			type: "chipInput",
			defaultValue: [],
			description:
				"Source tags can be used to filter the search scope. Press ENTER to add a tag.",
		},
	],
	form: [
		{ type: "field", key: "connection" },
		{ type: "field", key: "environment" },
		{ type: "field", key: "contentTypeId" },
		{ type: "field", key: "titleFieldId" },
		{ type: "field", key: "modulesFieldId" },
		{ type: "field", key: "mainTopicValue" },
		{ type: "field", key: "subTopicValue" },
		{ type: "field", key: "chunkingStrategy" },
		{ type: "field", key: "azureLlmConnection" },
		{ type: "field", key: "azureCustomEndpointUrl" },
		{ type: "field", key: "llmChunkingPrompt" },
		{ type: "field", key: "additionalTags" },
	],
	// --- Main Import Function ---
	function: async ({ api, config }) => {
		
		// Use 'unknown' cast to satisfy TypeScript v4
		const {
			environment,
			contentTypeId,
			titleFieldId,
			modulesFieldId,
			mainTopicValue,
			subTopicValue,
			additionalTags = [],
			chunkingStrategy,
			azureLlmConnection,
			azureCustomEndpointUrl,
			llmChunkingPrompt,
		} = config as unknown as IImportUnstructuredConfig;

		// Get Contentful Connection
		const contentfulConnection = (config as any).connection;
		const { spaceId, accessToken } = contentfulConnection;

		if (!spaceId || !accessToken) {
			throw new Error("Contentful Connection details (spaceId, accessToken) are missing.");
		}

		// Validate LLM config if strategy is selected
		if (chunkingStrategy === "llm") {
			if (!azureLlmConnection || !azureLlmConnection.apiKey) {
				throw new Error("Azure OpenAI Connection (with API Key) is missing.");
			}
			if (!azureCustomEndpointUrl) {
				throw new Error("Azure Custom Endpoint URL is missing.");
			}
		}

		const baseUrl = `https://cdn.contentful.com/spaces/${spaceId}/environments/${environment}/entries`;

		try {
			// --- 1. Get All Entries (with optional filters) ---
			logMessage(`Fetching all entries for Content Type: ${contentTypeId}`);
			const response: IContentfulResponse = await getEntries(
				baseUrl,
				accessToken,
				contentTypeId,
				mainTopicValue,  // Optional filter
				subTopicValue,   // Optional filter
			);

			if (!response.items || response.items.length === 0) {
				logMessage("No entries found for the specified Content Type and filter(s).");
				return;
			}
			logMessage(`Found ${response.items.length} entries to process.`);

			// --- 2. Group Entries ---
			// We group by the 'knowledgeGroup' field.
			// If an entry doesn't have that field, it will be grouped under 'Uncategorized'.
			const groupedEntries = new Map<string, IContentfulEntry[]>();
			for (const entry of response.items) {
				let groupName: string;
				
				// Use hard-coded Sub-Topic field for grouping
				groupName = entry.fields[SUB_TOPIC_FIELD_ID] || "Uncategorized";

				if (!groupedEntries.has(groupName)) {
					groupedEntries.set(groupName, []);
				}
				groupedEntries.get(groupName)?.push(entry);
			}
			logMessage(`Grouped entries into ${groupedEntries.size} Knowledge Sources.`);

			// --- 3. Process Each Group ---
			for (const [groupName, entriesInGroup] of groupedEntries.entries()) {
				
				let allChunksForGroup: Omit<IKnowledge.CreateKnowledgeChunkParams, "knowledgeSourceId">[] = [];
				const sourceTags = ["contentful", contentTypeId, ...additionalTags];

				// Find the Main Topic from the *first* entry in the group to use as a tag
				// (Assumes all entries in a group have the same Main Topic)
				const mainTopicTag = entriesInGroup[0].fields[MAIN_TOPIC_FIELD_ID];
				if (mainTopicTag) {
					sourceTags.push(mainTopicTag);
				}

				// --- 4. Assemble & Chunk all entries in the group ---
				for (const entry of entriesInGroup) {
					try {
						const entryTitle = entry.fields[titleFieldId] || "Untitled";
						logMessage(`Assembling content for entry: ${entryTitle}`);

						const fullText = await assembleContentFromEntry(
							entry,
							modulesFieldId,
							response.includes,
						);

						if (!fullText.trim()) {
							logMessage(`No content found for entry: ${entryTitle}, skipping.`);
							continue;
						}

						let chunkStrings: string[] = [];
						const chunkPrefix = `Title: ${entryTitle}\n\n`;

						if (chunkingStrategy === "llm") {
							// --- LLM SEMANTIC CHUNKING ---
							logMessage(`Sending full text of '${entryTitle}' to LLM for chunking.`);
							const finalPrompt = llmChunkingPrompt!.replace("{{text_to_chunk}}", fullText);
							
							// Call Azure OpenAI API using axios
							const llmResponse = await axios.post(
								azureCustomEndpointUrl!,
								{
									messages: [{ role: "user", content: finalPrompt }],
									// Note: "response_format" is for newer API versions.
									// We send the prompt assuming the custom URL handles the API version.
									// If this fails, you may need to adjust the prompt or API call.
									temperature: 0.2,
									max_tokens: 4096, 
								},
								{
									headers: {
										"Content-Type": "application/json",
										"api-key": azureLlmConnection!.apiKey,
									},
								},
							);

							const llmContent = llmResponse.data.choices?.[0]?.message?.content;
							if (!llmContent) {
								throw new Error("LLM returned an empty response.");
							}

							// Try to parse the JSON, which might be inside markdown
							let jsonString = llmContent;
							if (llmContent.includes("```json")) {
								jsonString = llmContent.split("```json")[1].split("```")[0].trim();
							}

							const parsedJson = JSON.parse(jsonString);
							const validationResult = LlmChunkResponseSchema.safeParse(parsedJson);

							if (!validationResult.success) {
								throw new Error(`LLM returned invalid JSON format: ${validationResult.error.message}`);
							}
							
							// Add prefix to LLM chunks
							chunkStrings = validationResult.data.chunks.map(chunk => `${chunkPrefix}${chunk}`);
							logMessage(`LLM returned ${chunkStrings.length} semantic chunks.`);

						} else {
							// --- RECURSIVE SPLITTER (Default) ---
							chunkStrings = await chunkWithRecursiveSplitter(fullText, chunkPrefix);
						}

						// Map to the chunk objects (without knowledgeSourceId)
						const formattedChunks = chunkStrings.map((chunkText, index) => ({
							text: chunkText,
							data: {
								contentfulEntryId: entry.sys.id,
								title: entryTitle,
								chunk: index + 1,
							},
						}));
						allChunksForGroup.push(...formattedChunks);

					} catch (chunkError) {
						logMessage(`Error processing entry ${entry.sys.id}: ${(chunkError as Error).message}`, "error");
					}
				} // End of for...of entriesInGroup

				// --- 5. Create Knowledge Source for the Group ---
				if (allChunksForGroup.length === 0) {
					logMessage(`No chunks created for group: ${groupName}, skipping.`);
					continue;
				}

				const sanitizedName = groupName.replace(/[^a-zA-Z0-9 _-]/g, "").trim();
				logMessage(`Creating Knowledge Source: '${sanitizedName}' with ${allChunksForGroup.length} chunks.`);

				try {
					const { knowledgeSourceId } = await api.createKnowledgeSource({
						name: sanitizedName || "Untitled Source",
						description: `Contentful group: ${groupName}. Includes ${entriesInGroup.length} entries.`,
						tags: sourceTags,
						chunkCount: allChunksForGroup.length,
					});

					// --- 6. Add all Chunks to the new Source ---
					for (const [index, chunk] of allChunksForGroup.entries()) {
						try {
							await api.createKnowledgeChunk({
								...chunk,
								knowledgeSourceId: knowledgeSourceId,
							});
						} catch (addChunkError) {
							logMessage(`Error creating chunk ${index + 1} for source "${sanitizedName}". Reason: ${(addChunkError as Error).message}`, "error");
						}
					}
				} catch (sourceError) {
					logMessage(`Error creating source "${sanitizedName}". Reason: ${(sourceError as Error).message}`, "error");
				}
			} // End of for...of groupedEntries
		} catch (error) {
			logMessage(`Failed to import from Contentful: ${(error as Error).message}`, "error");
			throw new Error(`Failed to import from Contentful: ${(error as Error).message}`);
		}
	},
});