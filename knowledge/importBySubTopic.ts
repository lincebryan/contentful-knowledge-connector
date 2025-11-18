import {
	createKnowledgeConnector,
	IKnowledge,
} from "@cognigy/extension-tools";
import {
	assembleContentFromEntry,
	chunkWithRecursiveSplitter,
	getEntries,
	IContentfulResponse,
	logMessage,
} from "./utils";

interface IImportBySubTopicConfig {
	connection: {
		spaceId: string;
		accessToken: string;
	};
	environment: string;
	contentTypeId: string;
	titleFieldId: string;
	modulesFieldId: string;
	mainTopicTag: string; // Selected from Dropdown
	subTopicTagId: string; // Exact Tag ID (e.g. "group:WiFi")
	additionalTags?: string[];
}

// --- Options must match your Contentful Tags ---
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

export const importBySubTopicConnector = createKnowledgeConnector({
	type: "importBySubTopic",
	label: "3. Import Knowledge Source (by Sub-Topic)",
	summary:
		"Creates a SINGLE Knowledge Source containing only entries that match the selected Main Topic AND the specific Sub-Topic tag.",
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
			description: "Filter: Entry MUST have this Main Topic tag.",
			params: {
				required: true,
				options: mainTopicOptions,
			},
		},
		{
			key: "subTopicTagId",
			label: "Sub-Topic Tag ID",
			type: "text",
			description:
				"Filter: Entry MUST have this specific Sub-Topic tag (e.g., 'group:WiFi'). This will also be the name of the Knowledge Source.",
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
		{ type: "field", key: "mainTopicTag" },
		{ type: "field", key: "subTopicTagId" }, 
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
			subTopicTagId,
			additionalTags = [],
		} = config as unknown as IImportBySubTopicConfig;

		const contentfulConnection = (config as any).connection;
		const { spaceId, accessToken } = contentfulConnection;

		if (!spaceId || !accessToken) {
			throw new Error(
				"Contentful Connection details (spaceId, accessToken) are missing.",
			);
		}

		if (!mainTopicTag || !subTopicTagId) {
			throw new Error(
				"You must provide both a Main Topic and a Sub-Topic.",
			);
		}

		const baseUrl = `https://cdn.contentful.com/spaces/${spaceId}/environments/${environment}/entries`;

		try {
			// --- 1. STRICT FILTERING (AND Logic) ---
			// We request entries that have BOTH the Main Topic Tag AND the Sub-Topic Tag.
			logMessage(
				`Fetching entries for Main Topic '${mainTopicTag}' AND Sub-Topic '${subTopicTagId}'`,
			);
			const response: IContentfulResponse = await getEntries(
				baseUrl,
				accessToken,
				contentTypeId,
				mainTopicTag, 
				subTopicTagId 
			);

			const entriesInGroup = response.items;

			if (!entriesInGroup || entriesInGroup.length === 0) {
				logMessage(
					"No entries found for the specified Main Topic and Sub-Topic.",
				);
				return;
			}
			logMessage(`Found ${entriesInGroup.length} entries to process.`);

			// --- 2. Determine Knowledge Source Name ---
			// We use the Sub-Topic Tag ID (stripped of prefix) as the name.
			// e.g. "group:Fiber" -> "Fiber"
			const groupName = subTopicTagId.includes(":") ? subTopicTagId.split(":")[1] : subTopicTagId;

			let allChunksForGroup: Omit<
				IKnowledge.CreateKnowledgeChunkParams,
				"knowledgeSourceId"
			>[] = [];
			
			const sourceTags = [
				"contentful",
				contentTypeId,
				mainTopicTag,
				...additionalTags,
			];

			// --- 3. Assemble & Chunk ---
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

			// --- 4. Create ONE Knowledge Source ---
			if (allChunksForGroup.length === 0) {
				logMessage(
					`No chunks created for group: ${groupName}, skipping.`,
				);
				return;
			}

			const sanitizedName = groupName
				.replace(/[^a-zA-Z0-9 _-]/g, "")
				.trim();
			logMessage(
				`Creating Single Knowledge Source: '${sanitizedName}' with ${allChunksForGroup.length} chunks.`,
			);

			try {
				const { knowledgeSourceId } = await api.createKnowledgeSource({
					name: sanitizedName || "Untitled Source",
					description: `Contentful Import. Main Topic: ${mainTopicTag}, Sub-Topic: ${subTopicTagId}. Entries: ${entriesInGroup.length}.`,
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