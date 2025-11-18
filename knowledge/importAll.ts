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
	subTopicTagPrefix: string; // New field for tag prefix
	additionalTags?: string[];
}

export const importAllConnector = createKnowledgeConnector({
	type: "importAllKnowledge",
	label: "1. Import All Knowledge Stores",
	summary:
		"Imports all entries of a Content Type. Groups entries into Knowledge Sources based on a Sub-Topic tag (e.g. 'group:WiFi').",
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
			key: "subTopicTagPrefix",
			label: "Sub-Topic Tag Prefix",
			type: "text",
			description:
				"The prefix used to identify the grouping tag (e.g., for 'group:WiFi', the prefix is 'group:').",
			defaultValue: "group:",
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
		{ type: "field", key: "subTopicTagPrefix" },
		{ type: "field", key: "additionalTags" },
	],

	// --- Main Import Function ---
	function: async ({ api, config }) => {
		const {
			environment,
			contentTypeId,
			titleFieldId,
			modulesFieldId,
			subTopicTagPrefix,
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
			
			// We pass 'undefined' to skip filtering, fetching everything
			const response: IContentfulResponse = await getEntries(
				baseUrl,
				accessToken,
				contentTypeId,
				undefined, 
				undefined
			);

			if (!response.items || response.items.length === 0) {
				logMessage("No entries found for the specified Content Type.");
				return;
			}
			logMessage(`Found ${response.items.length} entries to process.`);

			// --- 2. Group Entries by Tag ---
			const groupedEntries = new Map<string, IContentfulEntry[]>();
			
			for (const entry of response.items) {
				// Use the helper to find the tag that starts with "group:" (or custom prefix)
				const fullTag = getTagByPrefix(entry, subTopicTagPrefix);
				
				// Strip the prefix to get the clean name: "group:WiFi" -> "WiFi"
				const groupName = fullTag ? fullTag.replace(subTopicTagPrefix, "") : "Uncategorized";

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
				
				const sourceTags = ["contentful", contentTypeId, ...additionalTags];

				// --- 4. Assemble & Chunk all entries in the group ---
				for (const [entryIndex, entry] of entriesInGroup.entries()) {
					try {
						const entryTitle = entry.fields[titleFieldId] || "Untitled";

						// --- Tagging: Find "topic:" tag to add as metadata ---
						// We assume entries in the same group likely share the main topic, 
						// or we just add whatever topic tag this specific entry has.
						if (entryIndex === 0) {
							const mainTopicTag = getTagByPrefix(entry, "topic:");
							if (mainTopicTag) {
								sourceTags.push(mainTopicTag);
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
				}

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
			} 
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