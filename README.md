Cognigy.AI Advanced Contentful Connector
This extension provides a powerful and resilient integration with Contentful, designed to import complex, modular content into Cognigy.AI as Knowledge Sources and to fetch Contentful entries directly within a Flow.

It goes far beyond simple entry fetching by including advanced features such as:

Intelligent Content Assembly: Recursively parses modular content architectures (Rich Text, embedded components, and tables) into a single, clean text document.

Hierarchical Importing: Provides four distinct Knowledge Connectors for granular control over what you import, from importing everything to filtering by main topic and sub-topic.

Flow-Based Fetching: Includes three Flow Nodes to fetch or search for Contentful entries live in your conversation.

Dual Chunking Strategy: Offers both a standard, fast Recursive Splitter (via LangChain) and an advanced LLM Semantic Chunking strategy using Azure OpenAI.

Resilient & Robust: All API calls use a fetch-retry mechanism to automatically handle network errors or Contentful's rate limits.

1. Core Features
Connections: Provides Connection definitions for Contentful (CDN API) and Azure OpenAI (for LLM chunking).

Flow Nodes:

Get Single Entry: Fetches a Contentful entry by its ID.

Get Entries by Type: Fetches all entries matching a specific Content Type ID.

Search Entries: Performs a full-text search across your Contentful space.

Knowledge Connectors:

Import All Knowledge: Imports all entries of a Content Type, grouping them into Knowledge Sources based on a "Sub-Topic" field.

Import by Main Topic: Filters entries by a "Main Topic" (e.g., "Internet") and then groups them by "Sub-Topic".

Import by Sub-Topic: Filters entries by both a "Main Topic" and a specific "Sub-Topic" to create a single, targeted Knowledge Source.

Import Unstructured (Advanced): The most powerful connector, offering filters and the choice between recursive and LLM-powered semantic chunking.

2. Components in Detail
This extension registers 2 Connections, 3 Flow Nodes, and 4 Knowledge Connectors.

Connections
Before using any Nodes or Connectors, you must configure the following Connections in your Cognigy.AI instance.

A. Contentful Connection
This connection holds the credentials for your Contentful space.

Type: contentful

Label: Contentful Connection (or any name you choose)

Fields:

spaceId: Your Contentful Space ID.

accessToken: Your Contentful Delivery API Access Token.

B. Azure OpenAI Connection
This connection is only required if you use the "LLM Semantic Chunking" strategy in the Import Unstructured Knowledge Connector.

Type: AzureOpenAIProviderV2

Label: Azure OpenAI Connection (or any name you choose)

Fields:

apiKey: Your Azure OpenAI API Key.

Flow Nodes
You can use these nodes directly in your Flows to fetch content dynamically. All nodes provide a "Storage Option" section to save the result to Input or Context.

Node: Get Single Entry
Description: Fetches a single Contentful entry using its unique Entry ID.

Configuration:

Contentful Connection: Your configured connection.

Entry ID: The ID of the entry to retrieve (e.g., 1a2b3c4d5e).

Node: Get Entries by Type
Description: Fetches a collection of entries that match a specific Content Type ID.

Configuration:

Contentful Connection: Your configured connection.

Content Type ID: The API ID of the content type (e.g., article or faqEntry).

Node: Search Entries
Description: Performs a full-text search over all entries in your Contentful space.

Configuration:

Contentful Connection: Your configured connection.

Query: The full-text search query (e.g., "how do I reset my password").

Knowledge Connectors
This extension provides four distinct Knowledge Connectors, allowing you to fine-tune your knowledge import strategy and work around the 100-source limit.

Common Configuration Fields:

Contentful Connection: Your configured connection.

Environment: The Contentful environment (e.g., master or staging).

Content Type ID: The API ID of your main "page" content type (e.g., article).

Title Field ID: The API ID of the field to use as the entry's title (e.g., title).

Modular Content Field ID: The API ID of the Rich Text or Component List field (e.g., body).

1. Import All Knowledge Stores
Label: 1. Import All Knowledge Stores

Use Case: Imports all entries of the specified Content Type. It then groups them into separate Knowledge Sources based on the value in their knowledgeGroup (Sub-Topic) field.

Grouping: Entries without a knowledgeGroup field are placed in an "Uncategorized" source.

2. Import Knowledge Store (by Main Topic)
Label: 2. Import Knowledge Store (by Main Topic)

Use Case: Imports entries that match a specific mainTopic (e.g., "Internet"). It then groups those entries into separate Knowledge Sources based on their knowledgeGroup field.

Specific Fields:

Main Topic: A dropdown to select the mainTopic to filter by (e.g., "Internet", "Mobil", "Abonnement").

3. Import Knowledge Source (by Sub-Topic)
Label: 3. Import Knowledge Source (by Sub-Topic)

Use Case: Creates one single Knowledge Source. It filters entries that match both a mainTopic and a specific subTopicValue.

Specific Fields:

Main Topic: A dropdown to select the mainTopic.

Sub-Topic (Knowledge Group): A text field for the exact name of the Sub-Topic to import (e.g., "Wi-Fi").

4. Import Unstructured (Advanced)
Label: 4. Import Unstructured (Advanced)

Use Case: The most flexible connector. It can filter by mainTopic and/or subTopicValue and allows you to select your chunking strategy.

Specific Fields:

Main Topic Value (Optional Filter): A text field to filter by mainTopic.

Sub-Topic Value (Optional Filter): A text field to filter by knowledgeGroup.

Chunking Strategy:

Recursive Splitter (Fast & Free): (Default) Uses LangChain's RecursiveCharacterTextSplitter.

LLM Semantic Chunking (Smarter): Uses an Azure OpenAI model to split text based on meaning.

Azure OpenAI Connection: (If LLM selected) Your Azure connection.

Azure Custom Endpoint URL: (If LLM selected) The full API endpoint for your Azure OpenAI deployment (e.g., https://.../chat/completions?api-version=...).

Semantic Chunking Prompt: (If LLM selected) The prompt to instruct the LLM. It must include {{text_to_chunk}} and return a JSON object in the format {"chunks": ["chunk1", "chunk2"]}.

3. Technical Deep Dive: How It Works
The true power of this connector lies in its utils.ts file, which handles content processing.

A. Intelligent Content Assembly
When an entry is fetched, it is not simply "text." This connector intelligently assembles it.

Finds Linked Components: It first looks at the Modular Content Field ID (e.g., body). If this field is a list of linked entries (a modular page), it iterates through each one.

Renders Components: It uses a renderComponent function to convert known Contentful components into clean Markdown/text:

componentAccordion: Renders as ## Title followed by the accordion's body content.

componentTabs: Recursively finds all componentText entries linked within the tabs and renders them.

componentText: Renders as ### Title followed by the tab's text content.

componentImage / embedded-asset-block: Renders as [Image: Description].

Parses Rich Text: It uses a renderRichTextForLLM function to parse standard Rich Text fields. This function is notable because it:

Converts headings (heading-1, heading-2) into Markdown (#, ##).

Converts lists into Markdown bullet points (*).

Converts Rich Text tables into valid Markdown tables, making them readable by LLMs.

Combines Fields: It combines the content from the main body field and an optional sidebarContent field into a single, cohesive document for chunking.

B. Dual Chunking Strategy
Once the full text is assembled, it is passed to a chunker.

Recursive Splitter (Default):

Uses @langchain/textsplitters (RecursiveCharacterTextSplitter).

Splits text by character (\n\n, \n, , ``) to respect paragraphs and sentences.

Fast, free, and reliable.

Chunk size is hard-coded to 2000 characters.

LLM Semantic Chunking (Advanced):

Uses axios to make a POST request to your azureCustomEndpointUrl.

Injects the assembled text into the llmChunkingPrompt (replacing {{text_to_chunk}}).

The prompt (defined in importUnstructured.ts) instructs the LLM to act as an ingestion model and return a specific JSON format.

Uses zod (LlmChunkResponseSchema) to validate the LLM's output. If the LLM returns invalid JSON, the import for that entry will fail, protecting your Knowledge Source from bad data.

4. Recommended Contentful Setup
To use the powerful hierarchical grouping features, your main Content Type (e.g., article) should have two "Text" or "Symbol" fields:

Main Topic:

Name: Main Topic

Field ID: mainTopic

Sub-Topic (Knowledge Group):

Name: Knowledge Group

Field ID: knowledgeGroup

Example:
An article, "How to fix slow Wi-Fi", would have:

mainTopic: "Internet"

knowledgeGroup: "Wi-Fi"

When you run an import:

Import All would find this entry and put its chunks into a Knowledge Source named Wi-Fi.

Import by Main Topic (set to "Internet") would find it and put it in the Wi-Fi source.

Import by Sub-Topic (set to "Internet" and "Wi-Fi") would find it and create a single Wi-Fi source with just this entry (and others like it).

5. Installation
Install Dependencies: Open a terminal in the project's root folder and run:

Bash

npm install
Build & Zip the Extension: Run the following script from package.json to build the TypeScript code and create the extension bundle:

Bash

npm run zip
This will create a contentful-knowledge-connector.tar.gz file.

Upload to Cognigy.AI:

In Cognigy.AI, go to Manage > Extensions.

Upload the contentful-knowledge-connector.tar.gz file.

Create Connections:

Go to Manage > Connections.

Create your Contentful Connection.

(If needed) Create your Azure OpenAI Connection.