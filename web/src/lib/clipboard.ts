import { flashStatus } from "../bus/context";

/** Copies text to the clipboard and confirms in the status bar. Throws with a readable message if the browser refuses. */
export const copyText = async (text: string, label = "Copied"): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text);
    flashStatus(label);
  } catch (error) {
    const message = `Copy failed: ${error instanceof Error ? error.message : String(error)}`;
    flashStatus(message);
    throw new Error(message);
  }
};
