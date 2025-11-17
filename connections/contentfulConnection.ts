import { IConnectionSchema } from "@cognigy/extension-tools";

export const contentfulConnection: IConnectionSchema = {
	type: "contentful",
	label: "Contentful Connection",
	fields: [
		{ fieldName: "spaceId" },
		{ fieldName: "accessToken" }
	]
};