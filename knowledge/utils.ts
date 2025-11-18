import type {
	IKnowledge,
	INodeFunctionBaseParams,
} from "@cognigy/extension-tools";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import fetchRetry from "fetch-retry";

// --- START: Robust Fetching & Logging ---

const fetchRetry_ = fetchRetry(fetch);

/**
 * Logs a message with a specific format.
 */
export const logMessage = (
	message: string,
	level: "info" | "error" = "info",
	traceId: string = "contentful-extension",
): void => {
	// Use console.info for info and console.error for errors
	if (level === "error") {
		console.error(
			JSON.stringify({
				level: level,
				time: new Date().toISOString(),
				message: message,
				meta: {},
				traceId: traceId,
			}),
		);
	} else {
		console.info(
			JSON.stringify({
				level: level,
				time: new Date().toISOString(),
				message: message,
				meta: {},
				traceId: traceId,
			}),
		);
	}
};

/**
 * Fetch method with retry configuration
 */
export async function fetchWithRetry(
	url: string,
	options: RequestInit = {},
): Promise<any> {
	const fetchOptions = {
		method: "GET",
		...options,
		retries: 3,
		retryDelay: 1000,
		retryOn: [408, 429, 500, 502, 503, 504] as number[],
	};

	if (
		options.headers &&
		(options.headers as Record<string, string>)["Authorization"]
	) {
		fetchOptions.headers = options.headers;
	}

	const response = await fetchRetry_(url, fetchOptions);

	if (!response.ok) {
		logMessage(
			`HTTP Error: ${response.status} ${response.statusText} - ${url}`,
			"error",
		);
		throw new Error(
			`HTTP ${response.status}: ${response.statusText} - ${url}`,
		);
	}
	if (response.status === 204) {
		return null;
	}
	try {
		return await response.json();
	} catch (error) {
		logMessage(`Failed to parse JSON response from ${url}`, "error");
		throw new Error(`Failed to parse JSON response from ${url}`);
	}
}

/**
 * A re-usable helper for making authenticated requests to the Contentful CDN API.
 */
export const fetchData = async (
	url: string,
	accessToken: string,
	params: object = {},
) => {
	const urlParams = new URLSearchParams(
		params as Record<string, string>,
	).toString();
	const fullUrl = `${url}?${urlParams}&access_token=${accessToken}`;

	return await fetchWithRetry(fullUrl, {
		method: "GET",
		headers: {
			"Content-Type": "application/json",
		},
	});
};
// --- END: Robust Fetching & Logging ---

// --- START: Contentful Interfaces ---
export interface IContentfulEntry {
	sys: { id: string; contentType: { sys: { id: string } } };
	fields: { [key: string]: any };
	metadata?: {
		tags: { sys: { id: string } }[];
	};
}
export interface IContentfulIncludes {
	Entry?: IContentfulEntry[];
	Asset?: any[];
}
export interface IContentfulResponse {
	items: IContentfulEntry[];
	includes?: IContentfulIncludes;
	[key: string]: any;
}
// --- END: Contentful Interfaces ---

const MAX_CHUNK_SIZE = 2000;

/**
 * Fetches entries using Metadata Tags for filtering.
 * Replaces field-based filtering with Contentful's "metadata.tags.sys.id" filters.
 */
export const getEntries = async (
	baseUrl: string,
	accessToken: string,
	contentTypeId: string,
	mainTopicTag?: string, // e.g., "topic:Internet"
	subTopicTag?: string, // e.g., "group:WiFi"
): Promise<IContentfulResponse> => {
	const params: Record<string, string> = {
		content_type: contentTypeId,
		limit: "1000",
		include: "10", // Include linked entries 10 levels deep
	};

	// --- TAG BASED FILTERING LOGIC ---
	if (mainTopicTag && subTopicTag) {
		// If BOTH are present, use the [all] operator to enforce AND logic
		params["metadata.tags.sys.id[all]"] = `${mainTopicTag},${subTopicTag}`;
	} else if (mainTopicTag) {
		// Only Main Topic
		params["metadata.tags.sys.id[in]"] = mainTopicTag;
	} else if (subTopicTag) {
		// Only Sub Topic
		params["metadata.tags.sys.id[in]"] = subTopicTag;
	}
	// --------------------------------

	const response: IContentfulResponse = await fetchData(
		baseUrl,
		accessToken,
		params,
	);
	return response || { items: [], includes: { Entry: [], Asset: [] } };
};

/**
 * Helper to find a tag starting with a specific prefix (e.g. "group:")
 * Returns the full tag ID (e.g. "group:WiFi") or null.
 */
export const getTagByPrefix = (
	entry: IContentfulEntry,
	prefix: string,
): string | null => {
	if (!entry.metadata || !entry.metadata.tags) return null;

	const foundTag = entry.metadata.tags.find((tag: any) =>
		tag.sys.id.startsWith(prefix),
	);

	return foundTag ? foundTag.sys.id : null;
};

// --- START: Advanced Content Renderer ---

/**
 * Recursively extracts plain text from a Contentful rich text node.
 */
const getTextFromNode = (node: any): string => {
	if (!node) return "";
	if (node.nodeType === "text") {
		return node.value || "";
	}
	if (node.content && Array.isArray(node.content)) {
		return node.content.map(getTextFromNode).join("");
	}
	return "";
};

/**
 * Renders a single component entry into a string.
 */
const renderComponent = (
	component: IContentfulEntry,
	includes: IContentfulIncludes | undefined,
): string => {
	if (!component || !component.sys) {
		return "";
	}

	const contentType = component.sys.contentType.sys.id;
	let content = "";

	try {
		switch (contentType) {
			case "componentAccordion":
				content += `## ${component.fields.title || ""}\n\n`;
				content += renderRichTextForLLM(component.fields.body, includes);
				content += "\n";
				break;

			case "componentTabs":
				const tabs = component.fields.tabs;
				if (Array.isArray(tabs)) {
					for (const tabLink of tabs) {
						if (tabLink && tabLink.sys) {
							const tabEntry = includes?.Entry?.find(
								(e) => e.sys.id === tabLink.sys.id,
							);
							if (tabEntry) {
								content += renderComponent(tabEntry, includes);
							}
						}
					}
				}
				break;

			case "componentText": // This is what's inside a 'Tab'
				content += `### ${component.fields.title || ""}\n\n`;
				content += renderRichTextForLLM(component.fields.text, includes);
				content += "\n";
				break;

			case "componentImage":
				const imageLink = component.fields.image;
				if (imageLink && imageLink.sys) {
					const asset = includes?.Asset?.find(
						(a) => a.sys.id === imageLink.sys.id,
					);
					if (asset && asset.fields) {
						content += `[Image: ${
							asset.fields.description || asset.fields.title || ""
						}]\n\n`;
					}
				}
				break;
			// Add other component types here as needed
		}
	} catch (e) {
		logMessage(
			`Error rendering component ${component.sys.id} (type ${contentType}): ${
				(e as Error).message
			}`,
			"error",
		);
	}
	return content;
};

/**
 * Renders Contentful's Rich Text JSON into a single string,
 * converting tables and EMBEDDED ENTRIES into Markdown.
 */
const renderRichTextForLLM = (
	richTextDocument: any,
	includes: IContentfulIncludes | undefined,
): string => {
	if (!richTextDocument || !richTextDocument.content) {
		return "";
	}
	let output = "";
	const renderNode = (node: any) => {
		if (!node) return;

		switch (node.nodeType) {
			case "paragraph":
				output += getTextFromNode(node) + "\n\n";
				break;
			case "heading-1":
				output += `# ${getTextFromNode(node)}\n\n`;
				break;
			case "heading-2":
				output += `## ${getTextFromNode(node)}\n\n`;
				break;
			case "heading-3":
				output += `### ${getTextFromNode(node)}\n\n`;
				break;
			case "unordered-list":
			case "ordered-list":
				node.content.forEach((listItem: any) => {
					if (listItem) {
						output += `* ${getTextFromNode(listItem)}\n`;
					}
				});
				output += "\n";
				break;
			case "hyperlink":
				output += `[${getTextFromNode(node)}](${node.data.uri})\n`;
				break;
			case "table":
				try {
					const headers = node.content[0].content;
					const headerTexts = headers.map((cell: any) =>
						getTextFromNode(cell).trim().replace(/\|/g, "-"),
					);
					output += `| ${headerTexts.join(" | ")} |\n`;
					output += `| ${headerTexts.map(() => "---").join(" | ")} |\n`;
					node.content.slice(1).forEach((row: any) => {
						if (row && row.content) {
							const rowTexts = row.content.map((cell: any) =>
								getTextFromNode(cell).trim().replace(/\|/g, "-"),
							);
							output += `| ${rowTexts.join(" | ")} |\n`;
						}
					});
					output += "\n";
				} catch (e) {
					logMessage(`Failed to parse table: ${(e as Error).message}`, "error");
				}
				break;
			case "hr":
				output += "---\n\n";
				break;
			case "embedded-entry-inline":
			case "embedded-entry-block":
				try {
					if (node.data && node.data.target && node.data.target.sys) {
						const entryId = node.data.target.sys.id;
						const embeddedEntry = includes?.Entry?.find(
							(e) => e.sys.id === entryId,
						);
						if (embeddedEntry) {
							output += renderComponent(embeddedEntry, includes);
						}
					}
				} catch (e) {
					logMessage(
						`Failed to render embedded entry: ${(e as Error).message}`,
						"error",
					);
				}
				break;
			case "embedded-asset-block":
				try {
					if (node.data && node.data.target && node.data.target.sys) {
						const assetId = node.data.target.sys.id;
						const asset = includes?.Asset?.find((a) => a.sys.id === assetId);
						if (asset && asset.fields) {
							output += `[Image: ${
								asset.fields.description || asset.fields.title || ""
							}]\n\n`;
						}
					}
				} catch (e) {
					logMessage(
						`Failed to render embedded asset: ${(e as Error).message}`,
						"error",
					);
				}
				break;
			default:
				if (node.content && Array.isArray(node.content)) {
					node.content.forEach(renderNode);
				}
				break;
		}
	};
	richTextDocument.content.forEach(renderNode);
	return output;
};
// --- END: Advanced Content Renderer ---

/**
 * Assembles all text from an entry into a single string.
 */
export const assembleContentFromEntry = async (
	item: IContentfulEntry,
	modulesFieldId: string,
	includes: IContentfulIncludes | undefined,
): Promise<string> => {
	const mainContentField = item.fields[modulesFieldId];
	const sidebarContentField = item.fields.sidebarContent;
	let combinedContent = "";

	if (Array.isArray(mainContentField)) {
		for (const moduleLink of mainContentField) {
			try {
				if (moduleLink && moduleLink.sys) {
					const moduleId = moduleLink.sys.id;
					const componentEntry = includes?.Entry?.find(
						(e) => e.sys.id === moduleId,
					);
					if (componentEntry) {
						combinedContent += renderComponent(componentEntry, includes);
					}
				}
			} catch (e) {
				logMessage(
					`Failed to render linked component: ${(e as Error).message}`,
					"error",
				);
			}
		}
	} else if (
		typeof mainContentField === "object" &&
		mainContentField?.nodeType === "document"
	) {
		combinedContent += renderRichTextForLLM(mainContentField, includes);
	}

	if (
		typeof sidebarContentField === "object" &&
		sidebarContentField?.nodeType === "document"
	) {
		combinedContent += "\n## Sidebar Content\n\n";
		combinedContent += renderRichTextForLLM(sidebarContentField, includes);
	}
	return combinedContent;
};

/**
 * Chunks text using the recursive splitter.
 */
export const chunkWithRecursiveSplitter = async (
	fullText: string,
	textPrefix: string,
): Promise<string[]> => {
	if (!fullText.trim()) {
		return [];
	}
	const textSplitter = new RecursiveCharacterTextSplitter({
		chunkSize: MAX_CHUNK_SIZE - textPrefix.length,
		chunkOverlap: 100,
	});
	const chunks = await textSplitter.splitText(fullText);
	return chunks.map((chunk) => `${textPrefix}${chunk}`);
};