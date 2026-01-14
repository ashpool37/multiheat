/**
 * File download / save helpers.
 *
 * Uses the File System Access API when available, with a Blob + <a download>
 * fallback for browsers that don't support it.
 *
 * Behavior is intended to match the previous implementation in `main.js`.
 */

/**
 * Save a UTF-8 text file to the user's machine.
 *
 * @param {string} text
 * @param {string} suggestedName
 * @param {string} mime
 * @param {string[]} exts
 * @returns {Promise<void>}
 */
export const downloadText = async (text, suggestedName, mime, exts) => {
  if (typeof window.showSaveFilePicker === "function") {
    const handle = await window.showSaveFilePicker({
      suggestedName,
      types: [{ description: suggestedName, accept: { [mime]: exts } }],
    });
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    return;
  }

  // Fallback for browsers without File System Access API.
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
};
