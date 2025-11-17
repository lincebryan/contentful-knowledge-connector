import { createExtension } from "@cognigy/extension-tools";

// Import Connections
import { contentfulConnection } from "./connections/contentfulConnection";
import { azureConnection } from "./connections/azureConnection";

// --- ADD THESE IMPORTS ---
// Import the 3 Node files
import { getEntriesByTypeNode } from "./nodes/getEntriesByType";
import { getSingleEntryNode } from "./nodes/getSingleEntry";
import { searchEntriesNode } from "./nodes/searchEntries";
// --- END OF ADDITION ---

// Import the 4 Knowledge Connectors
import { importAllConnector } from "./knowledge/importAll";
import { importByMainTopicConnector } from "./knowledge/importByMainTopic";
import { importBySubTopicConnector } from "./knowledge/importBySubTopic";
import { importUnstructuredConnector } from "./knowledge/importUnstructured";

export default createExtension({
	
	// --- ADD YOUR NODES HERE ---
	nodes: [
		getEntriesByTypeNode,
		getSingleEntryNode,
		searchEntriesNode
	],
	// --- END OF ADDITION ---
	
	connections: [
		contentfulConnection,
		azureConnection
	],

	knowledge: [
		importAllConnector,
		importByMainTopicConnector,
		importBySubTopicConnector,
		importUnstructuredConnector
	],
	
	options: {
		label: "Contentful (TDC)" // You can change this to your preferred name
	}
});