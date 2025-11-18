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
interface IImportByMainTopicConfig {
	connection: {
		spaceId: string;
		accessToken: string;
	};
	environment: string;
	contentTypeId: string;
	titleFieldId: string;
	modulesFieldId: string;
	mainTopicTag: string; // This value will be a tag ID like "topic:Internet"
	additionalTags?: string[];
}

// --- Main Topic Options for the Dropdown ---
// These values MUST match the Metadata Tags created in Contentful
const mainTopicOptions = [
	{ label: "Internet", value: "topic:Internet" },
	{ label: "Mobil", value: "topic:Mobil" },
	{ label: "Abonnement", value: "topic:Abonnement" },
	{ label: "Faktura & betaling", value: "topic:Faktura & betaling" },
	{ label: "Selvbetjening", value: "topic:Selvbetjening" },
	{ label: "Mobilt bredbånd", value: "topic:Mobilt bredbånd" },
	{ label: "Telefoniløsning", value: "topic:Telefoniløsning" },
	{ label: "Fastnettelefoni", value: "topic:Fastnettelefoni" },
];
// -------------------------------------------

export const importByMainTopicConnector = createKnowledgeConnector({
	type: "importByMainTopic",
	label: "2. Import Knowledge Store (by Main Topic)",
	summary:
		"Filters entries by a Main Topic Tag, then automatically groups them into Knowledge Sources based on their Sub-Topic tag (e.g. 'group:WiFi').",
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
			key: "mainTopicTag",
			label: "Main Topic",
			type: "select",
			description: "Select the Main Topic tag to filter by.",
			params: {
				required: true,
				options: mainTopicOptions,
			},
		},
		// --- Removed 'subTopicTagPrefix' field from UI ---
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
		{ type: "field", key: "mainTopicTag" },
		{ type: "field", key: "contentTypeId" },
		{ type: "field", key: "titleFieldId" },
		{ type: "field", key: "modulesFieldId" },
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
			additionalTags = [],
		} = config as unknown as IImportByMainTopicConfig;

		const contentfulConnection = (config as any).connection;
		const { spaceId, accessToken } = contentfulConnection;

		if (!spaceId || !accessToken) {
			throw new Error(
				"Contentful Connection details (spaceId, accessToken) are missing.",
			);
		}

		if (!mainTopicTag) {
			throw new Error("You must select a Main Topic to import.");
		}

		// --- Hard-coded Convention ---
		const subTopicTagPrefix = "group:";

		const baseUrl = `https://cdn.contentful.com/spaces/${spaceId}/environments/${environment}/entries`;

		try {
			// --- 1. Get Entries Filtered by Main Topic Tag ---
			logMessage(
				`Fetching entries for Content Type '${contentTypeId}' and Main Topic Tag '${mainTopicTag}'`,
			);
			
			const response: IContentfulResponse = await getEntries(
				baseUrl,
				accessToken,
				contentTypeId,
				mainTopicTag, // Pass the tag ID here
				undefined, 
			);

			if (!response.items || response.items.length === 0) {
				logMessage(
					"No entries found for the specified Content Type and Main Topic.",
				);
				return;
			}
			logMessage(`Found ${response.items.length} entries to process.`);

			// --- 2. Group Entries by Tag ---
			const groupedEntries = new Map<string, IContentfulEntry[]>();
			for (const entry of response.items) {
				// Use the helper to find the tag that starts with "group:"
				const fullTag = getTagByPrefix(entry, subTopicTagPrefix);
				
				// Strip prefix: "group:WiFi" -> "WiFi"
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
				
				// Add the Main Topic tag to the source tags
				const sourceTags = [
					"contentful",
					contentTypeId,
					mainTopicTag,
					...additionalTags,
				];

				// --- 4. Assemble & Chunk ---
				for (const entry of entriesInGroup) {
					try {
						const entryTitle = entry.fields[titleFieldId] || "Untitled";

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

						const chunkPrefix = `Title: ${entryTitle}\n\n`;
						const chunkStrings = await chunkWithRecursiveSplitter(
							fullText,
							chunkPrefix,
						);

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

				// --- 5. Create Knowledge Source ---
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