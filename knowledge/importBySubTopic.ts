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

// --- Interface for this connector's config fields ---
interface IImportBySubTopicConfig {
	connection: {
		spaceId: string;
		accessToken: string;
	};
	environment: string;
	contentTypeId: string;
	titleFieldId: string;
	modulesFieldId: string;
	mainTopicValue: string; // Required dropdown
	subTopicValue: string; // Required text field
	additionalTags?: string[];
}

// --- HARD-CODED FIELD IDs ---
// These are not needed in the UI, but the function logic
// still uses them for tagging and grouping.
const MAIN_TOPIC_FIELD_ID = "mainTopic";
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

export const importBySubTopicConnector = createKnowledgeConnector({
	type: "importBySubTopic",
	label: "3. Import Knowledge Source (by Sub-Topic)",
	summary:
		"Filters entries by a Main Topic and a specific Sub-Topic, creating a single Knowledge Source.",
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
		// --- NEW: Main Topic Dropdown ---
		{
			key: "mainTopicValue",
			label: "Main Topic",
			type: "select",
			description: "Select the Main Topic to filter by.",
			params: {
				required: true,
				options: mainTopicOptions,
			},
		},
		// --- NEW: Sub-Topic Text Filter ---
		{
			key: "subTopicValue",
			label: "Sub-Topic (Knowledge Group)",
			type: "text",
			description:
				"The exact name of the Sub-Topic to import (e.g., 'Wi-Fi').",
			params: {
				required: true,
			},
		},
		// --- End of new fields ---
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
		{ type: "field", key: "mainTopicValue" },
		{ type: "field", key: "subTopicValue" }, // Field added to form
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
			mainTopicValue,
			subTopicValue, // We get the specific sub-topic value
			additionalTags = [],
		} = config as unknown as IImportBySubTopicConfig;

		const contentfulConnection = (config as any).connection;
		const { spaceId, accessToken } = contentfulConnection;

		if (!spaceId || !accessToken) {
			throw new Error(
				"Contentful Connection details (spaceId, accessToken) are missing.",
			);
		}

		if (!mainTopicValue || !subTopicValue) {
			throw new Error(
				"You must provide both a Main Topic and a Sub-Topic.",
			);
		}

		const baseUrl = `https://cdn.contentful.com/spaces/${spaceId}/environments/${environment}/entries`;

		try {
			// --- 1. Get All Entries (Filtered by Main & Sub-Topic) ---
			logMessage(
				`Fetching entries for Main Topic '${mainTopicValue}' AND Sub-Topic '${subTopicValue}'`,
			);
			const response: IContentfulResponse = await getEntries(
				baseUrl,
				accessToken,
				contentTypeId,
				mainTopicValue, // Filter by 'mainTopic' field
				subTopicValue, // Filter by 'knowledgeGroup' field
			);

			const entriesInGroup = response.items;

			if (!entriesInGroup || entriesInGroup.length === 0) {
				logMessage(
					"No entries found for the specified Main Topic and Sub-Topic.",
				);
				return;
			}
			logMessage(`Found ${entriesInGroup.length} entries to process.`);

			// --- 2. Group Entries (Not really needed, but good for consistency) ---
			// Since we filtered by subTopicValue, all entries belong to one group.
			// The groupName is the subTopicValue itself.
			const groupName = subTopicValue;

			// --- 3. Process the Group ---
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
				return; // Exit function
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