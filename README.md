# Cognigy.AI Advanced Contentful Connector

[![Cognigy.AI Extension](https://img.shields.io/badge/Cognigy.AI-Extension-blue.svg)](https://www.cognigy.com) [![License: ISC](https://img.shields.io/badge/License-ISC-yellow.svg)](https://opensource.org/licenses/ISC)

This extension provides a powerful and resilient integration with **Contentful**, designed to import complex, modular content into Cognigy.AI as Knowledge Sources and to fetch Contentful entries directly within a Flow.

It utilizes a **Tag-Based Architecture** to organize content, allowing you to maintain a clean Content Model in Contentful while enjoying powerful hierarchical grouping in Cognigy.AI.

Features:
* **Intelligent Content Assembly:** Recursively parses modular content architectures (Rich Text, embedded components, and tables) into a single, clean text document.
* **Tag-Based Hierarchical Importing:** Uses Contentful Metadata Tags to filter and group content (e.g., Main Topic tags and Sub-Topic tags) without polluting your content model with extra fields.
* **Flow-Based Fetching:** Includes three Flow Nodes to fetch or search for Contentful entries live in your conversation, now with Environment support.
* **Dual Chunking Strategy:** Offers both a standard, fast `Recursive Splitter` (via LangChain) and an advanced `LLM Semantic Chunking` strategy using Azure OpenAI.
* **Resilient & Robust:** All API calls use a `fetch-retry` mechanism to automatically handle network errors or Contentful's rate limits.

---

## 1. Core Features

* **Connections:** Provides Connection definitions for **Contentful (CDN API)** and **Azure OpenAI** (for LLM chunking).
* **Flow Nodes:**
    * `Get Single Entry`: Fetches a Contentful entry by its ID.
    * `Get Entries by Type`: Fetches all entries matching a specific Content Type ID.
    * `Search Entries`: Performs a full-text search across your Contentful space.
* **Knowledge Connectors:**
    * `Import All Knowledge`: Imports all entries of a Content Type, grouping them into Knowledge Sources based on a "Sub-Topic" tag.
    * `Import by Main Topic`: Filters entries by a "Main Topic" tag (e.g., `topic:Internet`) and then groups them by "Sub-Topic" tag.
    * `Import by Sub-Topic`: Filters entries by *both* a "Main Topic" and a specific "Sub-Topic" tag to create a single, targeted Knowledge Source.
    * `Import Unstructured (Advanced)`: The most powerful connector, offering tag filters *and* the choice between recursive and LLM-powered semantic chunking.

---

## 2. Components in Detail

This extension registers **2 Connections**, **3 Flow Nodes**, and **4 Knowledge Connectors**.

### Connections

Before using any Nodes or Connectors, you must configure the following Connections in your Cognigy.AI instance.

#### A. Contentful Connection
This connection holds the credentials for your Contentful space.

* **Type:** `contentful`
* **Label:** `Contentful Connection` (or any name you choose)
* **Fields:**
    * `spaceId`: Your Contentful Space ID.
    * `accessToken`: Your Contentful Delivery API Access Token.

#### B. Azure OpenAI Connection
This connection is **only required** if you use the "LLM Semantic Chunking" strategy in the `Import Unstructured` Knowledge Connector.

* **Type:** `AzureOpenAIProviderV2`
* **Label:** `Azure OpenAI Connection` (or any name you choose)
* **Fields:**
    * `apiKey`: Your Azure OpenAI API Key.

### Flow Nodes

You can use these nodes directly in your Flows to fetch content dynamically. All nodes provide a "Storage Option" section to save the result to `Input` or `Context`.

#### Common Settings (All Nodes)
* **Environment:** Select the Contentful environment (Default: `master`).
* **Storage:** Choose to store the result in `Input` or `Context`.

#### Node: Get Single Entry
* **Description:** Fetches a single Contentful entry using its unique Entry ID.
* **Fields:** `Entry ID`

#### Node: Get Entries by Type
* **Description:** Fetches a collection of entries that match a specific Content Type ID.
* **Fields:** `Content Type ID`

#### Node: Search Entries
* **Description:** Performs a full-text search over all entries in your Contentful space.
* **Fields:** `Query` (The text to search for).

---

### Knowledge Connectors

This extension uses a **Tag-Based** strategy for importing. It looks for tags on your entries to determine which "Knowledge Source" the content belongs to.

**Common Configuration Fields:**
* `Contentful Connection`: Your configured connection.
* `Environment`: The Contentful environment (Default: `master`).
* `Content Type ID`: The API ID of your main "page" content type (e.g., `article`).
* `Title Field ID`: The API ID of the field to use as the entry's title (e.g., `title`).
* `Modular Content Field ID`: The API ID of the Rich Text or Component List field (e.g., `body`).

---

#### 1. Import All Knowledge Stores
* **Label:** `1. Import All Knowledge Stores`
* **Use Case:** Imports *all* entries of the specified Content Type. It automatically groups them into separate Knowledge Sources based on their "Sub-Topic" tag.
* **How it works:** It scans the tags of every entry. If it finds a tag starting with `group:` (e.g., `group:WiFi`), it assigns the entry to the "WiFi" Knowledge Source. Entries without a group tag go to "Uncategorized".

---

#### 2. Import Knowledge Store (by Main Topic)
* **Label:** `2. Import Knowledge Store (by Main Topic)`
* **Use Case:** Imports entries that have a specific "Main Topic" tag (e.g., `topic:Internet`). It then automatically groups those entries into separate Knowledge Sources based on their "Sub-Topic" tag (`group:`).
* **Specific Fields:**
    * `Main Topic`: A dropdown to select the Main Topic tag to filter by (e.g., "Internet" → maps to `topic:Internet`).

---

#### 3. Import Knowledge Source (by Sub-Topic)
* **Label:** `3. Import Knowledge Source (by Sub-Topic)`
* **Use Case:** Creates *one single* Knowledge Source. It filters entries that match *both* a specific "Main Topic" tag AND a specific "Sub-Topic" tag.
* **Specific Fields:**
    * `Main Topic`: A dropdown to select the Main Topic tag.
    * `Sub-Topic Tag ID`: The exact tag ID for the specific group you want to import (e.g., `group:WiFi`).

---

#### 4. Import Unstructured (Advanced)
* **Label:** `4. Import Unstructured (Advanced)`
* **Use Case:** The most flexible connector. It allows raw filtering by tag IDs and selecting your chunking strategy.
* **Specific Fields:**
    * `Main Topic Tag ID (Optional)`: Filter by a specific tag ID (e.g., `topic:Internet`).
    * `Sub-Topic Tag ID (Optional)`: Filter by a specific tag ID (e.g., `group:WiFi`).
    * `Chunking Strategy`:
        * **`Recursive Splitter (Fast & Free)`**: (Default) Uses LangChain's `RecursiveCharacterTextSplitter`.
        * **`LLM Semantic Chunking (Smarter)`**: Uses an Azure OpenAI model to split text based on meaning.
    * `Azure OpenAI Connection`: (If LLM selected) Your Azure connection.
    * `Azure Custom Endpoint URL`: (If LLM selected) The *full* API endpoint for your Azure OpenAI deployment.

---

## 3. Technical Deep Dive

### A. Tag-Based Grouping Logic
The extension relies on a naming convention for Contentful Tags to organize content.
* **Main Topic Tags:** e.g., `topic:Internet`.
* **Sub-Topic (Group) Tags:** e.g., `group:WiFi`.
* **Logic:** The Connectors automatically detect tags starting with `group:` to determine the Knowledge Source name.

### B. Intelligent Content Assembly
When an entry is fetched, it is assembled into a single Markdown document before chunking.
* **Resolves References:** It recursively fetches linked entries (up to 10 levels deep) from the `Modular Content Field`.
* **Renders Components:** Converts custom Contentful components (Accordions, Tabs) into clean Markdown headings and text.
* **Parses Rich Text:** Converts headings, lists, and **Tables** into valid Markdown optimized for LLMs.

---

## 4. Installation

1.  **Install Dependencies:** Open a terminal in the project's root folder and run:
    ```bash
    npm install
    ```
2.  **Build & Zip the Extension:**
    ```bash
    npm run zip
    ```
    This will create a `contentful-knowledge-connector.tar.gz` file.
3.  **Upload to Cognigy.AI:**
    * In Cognigy.AI, go to **Manage** > **Extensions**.
    * Upload the `contentful-knowledge-connector.tar.gz` file.
4.  **Create Connections:**
    * Go to **Manage** > **Connections**.
    * Configure your `Contentful Connection` and (optionally) `Azure OpenAI Connection`.