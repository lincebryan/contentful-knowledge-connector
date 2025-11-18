import {
	createKnowledgeConnector,
	IKnowledge,
} from "@cognigy/extension-tools";
import {
	assembleContentFromEntry,
	chunkWithRecursiveSplitter,
	getEntries,
	getTagByPrefix,
	IContentfulEntry,
	IContentfulResponse,
	logMessage,
} from "./utils";
import axios from "axios";
import { z } from "zod";

const LlmChunkResponseSchema = z.object({
	chunks: z.array(z.string()),
});

interface IImportUnstructuredConfig {
	connection: { 
		spaceId: string;
		accessToken: string;
	};
	environment: string;
	contentTypeId: string;
	titleFieldId: string;
	modulesFieldId: string;
	// --- Tag Filters ---
	mainTopicTag?: string;
	subTopicTag?: string;
	// -------------------
	additionalTags?: string[];
	chunkingStrategy: "recursive" | "llm";
	azureLlmConnection?: { 
		apiKey: string;
	};
	azureCustomEndpointUrl?: string; 
	llmChunkingPrompt?: string;
}

export const importUnstructuredConnector = createKnowledgeConnector({
	type: "importUnstructured",
	label: "4. Import Unstructured (Advanced)",
	summary:
		"Imports entries with advanced options for Tag filtering and LLM chunking.",
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
		// --- Optional Filters ---
		{
			key: "mainTopicTag",
			label: "Main Topic Tag ID (Optional)",
			type: "text",
			description:
				"The Tag ID to filter for (e.g., 'topic:Internet').",
		},
		{
			key: "subTopicTag",
			label: "Sub-Topic Tag ID (Optional)",
			type: "text",
			description:
				"The Tag ID to filter for (e.g., 'group:WiFi').",
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
				"The full API endpoint for your Azure OpenAI deployment.",
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
		{ type: "field", key: "mainTopicTag" },
		{ type: "field", key: "subTopicTag" },
		{ type: "field", key: "chunkingStrategy" },
		{ type: "field", key: "azureLlmConnection" },
		{ type: "field", key: "azureCustomEndpointUrl" },
		{ type: "field", key: "llmChunkingPrompt" },
		{ type: "field", key: "additionalTags" },
	],
	// --- Main Import Function ---
	function: async ({ api, config }) => {
		const {
			environment,
			contentTypeId,
			titleFieldId,
			modulesFieldId,
			mainTopicTag,
			subTopicTag,
			additionalTags = [],
			chunkingStrategy,
			azureLlmConnection,
			azureCustomEndpointUrl,
			llmChunkingPrompt,
		} = config as unknown as IImportUnstructuredConfig;

		const contentfulConnection = (config as any).connection;
		const { spaceId, accessToken } = contentfulConnection;

		if (!spaceId || !accessToken) {
			throw new Error("Contentful Connection details (spaceId, accessToken) are missing.");
		}

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
			// --- 1. Get All Entries (with optional tag filters) ---
			logMessage(`Fetching all entries for Content Type: ${contentTypeId}`);
			const response: IContentfulResponse = await getEntries(
				baseUrl,
				accessToken,
				contentTypeId,
				mainTopicTag,  
				subTopicTag,   
			);

			if (!response.items || response.items.length === 0) {
				logMessage("No entries found for the specified Content Type and filter(s).");
				return;
			}
			logMessage(`Found ${response.items.length} entries to process.`);

			// --- 2. Group Entries ---
			const groupedEntries = new Map<string, IContentfulEntry[]>();
			for (const entry of response.items) {
				// Default behavior: try to group by 'group:' tag if available
				const fullTag = getTagByPrefix(entry, "group:");
				const groupName = fullTag ? fullTag.replace("group:", "") : "Uncategorized";

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

				// Try to find main topic tag from first entry
				const mainTopic = getTagByPrefix(entriesInGroup[0], "topic:");
				if (mainTopic) {
					sourceTags.push(mainTopic);
				}

				// --- 4. Assemble & Chunk ---
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
							
							const llmResponse = await axios.post(
								azureCustomEndpointUrl!,
								{
									messages: [{ role: "user", content: finalPrompt }],
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

							let jsonString = llmContent;
							if (llmContent.includes("```json")) {
								jsonString = llmContent.split("```json")[1].split("```")[0].trim();
							}

							const parsedJson = JSON.parse(jsonString);
							const validationResult = LlmChunkResponseSchema.safeParse(parsedJson);

							if (!validationResult.success) {
								throw new Error(`LLM returned invalid JSON format: ${validationResult.error.message}`);
							}
							
							chunkStrings = validationResult.data.chunks.map(chunk => `${chunkPrefix}${chunk}`);
							logMessage(`LLM returned ${chunkStrings.length} semantic chunks.`);

						} else {
							// --- RECURSIVE SPLITTER ---
							chunkStrings = await chunkWithRecursiveSplitter(fullText, chunkPrefix);
						}

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
				}

				// --- 5. Create Source ---
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
			}
		} catch (error) {
			logMessage(`Failed to import from Contentful: ${(error as Error).message}`, "error");
			throw new Error(`Failed to import from Contentful: ${(error as Error).message}`);
		}
	},
});