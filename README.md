Cognigy.AI Advanced Contentful Knowledge Connector

This extension provides a powerful Knowledge Connector for importing complex, modular content from a Contentful space into Cognigy.AI Knowledge Sources.

It goes far beyond a simple entry import by including advanced features such as recursive component parsing, hierarchical topic filtering, and optional LLM-powered semantic chunking.

Features

Advanced Content Parsing: Intelligently assembles content from modular "page" architectures. It can parse:

Rich Text fields (body).

Secondary content fields (sidebarContent).

Embedded component entries (Component: Accordion, Component: Tabs, Component: Text).

Rich Text tables (converted to Markdown for LLMs).

Hierarchical Topic Management: Solves the 100-source limit by allowing you to filter and group entries.

Filter by Main Topic: Import only entries that match a specific "Main Topic" (e.g., "Internet").

Group by Sub-Topic: Automatically create a separate Knowledge Source for each "Sub-Topic" (e.g., "Wi-Fi", "Sikkerhed", "Teknisk support").

Dual Chunking Strategy: Choose your preferred chunking method.

Recursive Splitter (Default): A fast, free, and reliable splitter (from LangChain) that splits by character.

LLM Semantic Chunking: Uses a connected Azure OpenAI model to split text based on meaning, creating more contextually complete chunks.

Robust & Resilient: Uses fetch-retry for all Contentful API calls, automatically retrying on network errors or rate limits.

1. Connections

This extension requires two Connections to be configured in Cognigy.AI.

A. Contentful Connection

This connection holds the credentials for your Contentful space.

Type: contentful

Label: Contentful Connection (or any name you choose)

Fields:

spaceId: Your Contentful Space ID.

accessToken: Your Contentful Delivery API Access Token.

B. Azure OpenAI Connection

This connection is only required if you use the "LLM Semantic Chunking" strategy.

Type: AzureOpenAIProviderV2

Label: Azure OpenAI Connection (or any name you choose)

Fields:

apiKey: Your Azure OpenAI API Key.

2. Knowledge Connector Configuration

When you add the "Contentful Import" Knowledge Connector to a Knowledge Store, you will see the following fields:

Contentful Settings

Field

Description

Example

Contentful Connection

Select the contentful Connection you created in Step 1.

My Contentful Connection

Environment

The Contentful environment to pull from.

staging or master

Content Type ID

The API ID of your main "page" content type.

article

Title Field ID

The API ID of the field to use as the entry's title.

title

Modular Content Field ID

The API ID of the field that contains your components (either a Rich Text field or a Component List field).

body

Hierarchical Grouping (Optional but Recommended)

This is the recommended way to organize your knowledge and avoid the 100-source limit.

Field

Description

Example

Main Topic Field ID

(Optional Filter) The API ID of the field in Contentful that defines the "Main Topic" (e.g., "Internet", "Mobil").

mainTopic

Main Topic Value

(Optional Filter) The specific value to import. The connector will only import entries that match this value.

Internet

Sub-Topic Grouping Field ID

(Optional) The API ID of the field that defines the "Sub-Topic". The connector will create a new Knowledge Source for each unique value in this field.

knowledgeGroup

Chunking Strategy

This section controls how your assembled content is split into chunks.

Field

Description

Chunking Strategy

Choose your chunking method. 



- Recursive Splitter: Fast, free, and reliable. 



- LLM Semantic Chunking: Smarter, context-aware chunking.

Azure OpenAI Connection

(Visible if "LLM" is selected) 



 Select the AzureOpenAIProviderV2 Connection you created.

Azure Custom Endpoint URL

(Visible if "LLM" is selected) 



 Your full Azure OpenAI API endpoint, including deployment and api-version.

Semantic Chunking Prompt

(Visible if "LLM" is selected) 



 The prompt that instructs the LLM. It must include {{text_to_chunk}} and must return a JSON object in the format {"chunks": ["chunk1", "chunk2"]}.

Additional Settings

Field

Description

Example

Additional Source Tags

(Optional) Any extra tags to add to all Knowledge Sources created by this import.

help-articles

3. Recommended Contentful Setup

To use the grouping features, your Content Type (e.g., article) should have two fields:

Main Topic: A "Text" or "Symbol" field.

Name: Main Topic

Field ID: mainTopic

Sub-Topic (Knowledge Group): A "Text" or "Symbol" field.

Name: Knowledge Group

Field ID: knowledgeGroup

Example:
An article, "How to fix slow Wi-Fi", would have:

mainTopic: "Internet"

knowledgeGroup: "Wi-Fi"

When you run the import with the filter Main Topic Value = Internet, the connector will find this entry and put its chunks into a Knowledge Source named Wi-Fi, which will also be tagged with Internet.

4. Installation

Place all the files in the correct folder structure (as seen in the project).

Open a terminal in the project's root folder.

Run npm install to install all dependencies.

Run npm run zip to build the code and create the contentful-knowledge-connector.tar.gz file.

In Cognigy.AI, go to Manage > Extensions and upload the .tar.gz file.

Go to Manage > Connections and create your Contentful Connection and (if needed) your AzureOpenAIProviderV2 Connection.