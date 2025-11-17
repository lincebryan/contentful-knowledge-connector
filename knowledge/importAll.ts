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
} from "./utils"; // This must be the utils.ts file with hard-coded field IDs

// --- Interface for this connector's config fields ---
interface IImportAllConfig {
	connection: {
		spaceId: string;
		accessToken: string;
	};
	environment: string;
	contentTypeId: string;
	titleFieldId: string;
	modulesFieldId: string;
	additionalTags?: string[];
}

// --- HARD-CODED FIELD IDs ---
// These are now standardized based on your Contentful model
// We get these values from the entry fields and use them for grouping/tagging
const MAIN_TOPIC_FIELD_ID = "mainTopic";
const SUB_TOPIC_FIELD_ID = "knowledgeGroup";
// -----------------------------

export const importAllConnector = createKnowledgeConnector({
	type: "importAllKnowledge",
	label: "1. Import All Knowledge Stores",
	summary:
		"Imports all entries of a Content Type. Groups entries into Knowledge Sources based on the 'knowledgeGroup' field.",
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
			additionalTags = [],
		} = config as unknown as IImportAllConfig;

		const contentfulConnection = (config as any).connection;
		const { spaceId, accessToken } = contentfulConnection;

		if (!spaceId || !accessToken) {
			throw new Error(
				"Contentful Connection details (spaceId, accessToken) are missing.",
			);
		}

		const baseUrl = `https://cdn.contentful.com/spaces/${spaceId}/environments/${environment}/entries`;

		try {
			// --- 1. Get All Entries ---
			logMessage(`Fetching all entries for Content Type: ${contentTypeId}`);
			// We pass 'undefined' for mainTopicValue and subTopicValue to skip filtering
			// This now uses the 5-argument version of getEntries
			const response: IContentfulResponse = await getEntries(
				baseUrl,
				accessToken,
				contentTypeId,
				undefined, // No Main Topic filter
				undefined, // No Sub-Topic filter
			);

			if (!response.items || response.items.length === 0) {
				logMessage("No entries found for the specified Content Type.");
				return;
			}
			logMessage(`Found ${response.items.length} entries to process.`);

			// --- 2. Group Entries ---
			// We group entries based on the hard-coded SUB_TOPIC_FIELD_ID ("knowledgeGroup")
			const groupedEntries = new Map<string, IContentfulEntry[]>();
			for (const entry of response.items) {
				const groupName =
					entry.fields[SUB_TOPIC_FIELD_ID] || "Uncategorized";

				if (!groupedEntries.has(groupName)) {
					groupedEntries.set(groupName, []);
				}
				groupedEntries.get(groupName)?.push(entry);
			}
			logMessage(
				`Grouped entries into ${groupedEntries.size} Knowledge Sources.`,
			);

			// --- 3. Process Each Group ---
			for (const [groupName, entriesInGroup] of groupedEntries.entries()) {
				let allChunksForGroup: Omit<
					IKnowledge.CreateKnowledgeChunkParams,
					"knowledgeSourceId"
				>[] = [];
				// Base tags
				const sourceTags = ["contentful", contentTypeId, ...additionalTags];

				// --- 4. Assemble & Chunk all entries in the group ---
				for (const [entryIndex, entry] of entriesInGroup.entries()) {
					try {
						const entryTitle = entry.fields[titleFieldId] || "Untitled";

						// --- Tagging ---
						// On the first entry of the group, find the Main Topic (from "mainTopic" field) and add it as a tag
						// We only need to do this once, so we do it for the first entry (index 0)
						if (entryIndex === 0) {
							const mainTopic =
								entry.fields[MAIN_TOPIC_FIELD_ID] || null;
							if (mainTopic) {
								sourceTags.push(mainTopic);
							}
						}

						// --- Assembling ---
						const fullText = await assembleContentFromEntry(
							entry,
							modulesFieldId,
							response.includes,
						);

						if (!fullText.trim()) {
							logMessage(
								`No content found for entry: ${entryTitle}, skipping.`,
							);
							continue;
						}

						// --- Chunking ---
						const chunkPrefix = `Title: ${entryTitle}\n\n`;
						const chunkStrings = await chunkWithRecursiveSplitter(
							fullText,
							chunkPrefix,
						);

						// Map to the chunk objects
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
						logMessage(
							`Error processing entry ${entry.sys.id}: ${
								(chunkError as Error).message
							}`,
							"error",
						);
					}
				} // End of for...of entriesInGroup

				// --- 5. Create Knowledge Source for the Group ---
				if (allChunksForGroup.length === 0) {
					logMessage(
						`No chunks created for group: ${groupName}, skipping.`,
					);
					continue;
				}

				const sanitizedName = groupName
					.replace(/[^a-zA-Z0-9 _-]/g, "")
					.trim();
				logMessage(
					`Creating Knowledge Source: '${sanitizedName}' with ${allChunksForGroup.length} chunks.`,
				);

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
							logMessage(
								`Error creating chunk ${
									index + 1
								} for source "${sanitizedName}". Reason: ${
									(addChunkError as Error).message
								}`,
								"error",
							);
						}
					}
				} catch (sourceError) {
					logMessage(
						`Error creating source "${sanitizedName}". Reason: ${
							(sourceError as Error).message
						}`,
						"error",
					);
				}
			} // End of for...of groupedEntries
		} catch (error) {
			logMessage(
				`Failed to import from Contentful: ${(error as Error).message}`,
				"error",
			);
			throw new Error(
				`Failed to import from Contentful: ${(error as Error).message}`,
			);
		}
	},
});