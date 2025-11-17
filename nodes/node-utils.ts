import { INodeFunctionBaseParams } from "@cognigy/extension-tools";

// Define the arguments our helper will take
interface IAddToStorageParams {
	api: INodeFunctionBaseParams["cognigy"]["api"];
	storeLocation: string;
	contextKey: string;
	inputKey: string;
	data: any; // The data (or error) to store
	mode?: "simple" | "array"; // <-- This line is now correct
}

/**
 * A helper function (inspired by the 'addToStorage.js' example) 
 * to store data in either the Input or Context.
 */
export const addToStorage = ({ api, storeLocation, contextKey, inputKey, data, mode = "simple" }: IAddToStorageParams) => {
	const storeKey = storeLocation === "context" ? contextKey : inputKey;
	if (!storeKey) return;

	switch (storeLocation) {
		case "context":
			api.addToContext(storeKey, data, mode); // This error will now be gone
			break;
		case "input":
			// @ts-ignore
			api.addToInput(storeKey, data);
			break;
	}
};