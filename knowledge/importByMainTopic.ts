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
interface IImportByMainTopicConfig {
	connection: {
		spaceId: string;
		accessToken: string;
	};
	environment: string;
	contentTypeId: string;
	titleFieldId: string;
	modulesFieldId: string;
	mainTopicValue: string; // This is now a required dropdown
	additionalTags?: string[];
}

// --- HARD-CODED FIELD IDs ---
// These are not in the UI, but the logic below
// is hard-coded to use them.
// const MAIN_TOPIC_FIELD_ID = "mainTopic"; // Handled by getEntries
const SUB_TOPIC_FIELD_ID = "knowledgeGroup";
// -----------------------------

// --- Main Topic Options for the Dropdown ---
const mainTopicOptions = [
	{ label: "Internet", value: "Internet" },
	{ label: "Mobil", value: "Mobil" },
	{ label: "Abonnement", value: "Abonnement" },
	{ label: "Faktura & betaling", value: "Faktura & betaling" },
	{ label: "Selvbetjening", value: "Selvbetjening" },
	{ label: "Mobilt bredbånd", value: "Mobilt bredbånd" },
	{ label: "Telefoniløsning", value: "Telefoniløsning" },
	{ label: "Fastnettelefoni", value: "Fastnettelefoni" },
];
// -------------------------------------------

export const importByMainTopicConnector = createKnowledgeConnector({
	type: "importByMainTopic",
	label: "2. Import Knowledge Store (by Main Topic)",
	summary:
		"Filters entries by a Main Topic, then groups them into Knowledge Sources based on the 'knowledgeGroup' field.",
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
		// --- NEW: Main Topic Dropdown (Field ID is hard-coded) ---
		{
			key: "mainTopicValue",
			label: "Main Topic",
			type: "select",
			description: "Select the Main Topic to import.",
			params: {
				required: true,
				options: mainTopicOptions,
			},
		},
		// --- End of new field ---
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
		{ type: "field", key: "mainTopicValue" }, // Field added to form
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
			mainTopicValue, // We get the value from the dropdown
			additionalTags = [],
		} = config as unknown as IImportByMainTopicConfig;

		const contentfulConnection = (config as any).connection;
		const { spaceId, accessToken } = contentfulConnection;

		if (!spaceId || !accessToken) {
			throw new Error(
				"Contentful Connection details (spaceId, accessToken) are missing.",
			);
		}

		if (!mainTopicValue) {
			throw new Error("You must select a Main Topic to import.");
		}

		const baseUrl = `https://cdn.contentful.com/spaces/${spaceId}/environments/${environment}/entries`;

		try {
			// --- 1. Get All Entries (Filtered by Main Topic) ---
			logMessage(
				`Fetching entries for Content Type '${contentTypeId}' and Main Topic '${mainTopicValue}'`,
			);
			// getEntries now uses the hard-coded "mainTopic" field ID
			const response: IContentfulResponse = await getEntries(
				baseUrl,
				accessToken,
				contentTypeId,
				mainTopicValue, // Pass the selected value to filter
				undefined, // No Sub-Topic filter
			);

			if (!response.items || response.items.length === 0) {
				logMessage(
					"No entries found for the specified Content Type and Main Topic.",
				);
				return;
			}
			logMessage(`Found ${response.items.length} entries to process.`);

			// --- 2. Group Entries ---
			// Group by the hard-coded SUB_TOPIC_FIELD_ID ("knowledgeGroup")
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
				// Base tags + add the Main Topic as a tag
				const sourceTags = [
					"contentful",
					contentTypeId,
					mainTopicValue,
					...additionalTags,
				];

				// --- 4. Assemble & Chunk all entries in the group ---
				for (const entry of entriesInGroup) {
					try {
						const entryTitle = entry.fields[titleFieldId] || "Untitled";

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