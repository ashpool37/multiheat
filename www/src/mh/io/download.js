/**
 * Утилиты сохранения текста в файл.
 *
 * Использует File System Access API при наличии, иначе — Blob + `<a download>`.
 */

/**
 * Сохранить текст (UTF-8) в файл.
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

  // Запасной вариант для браузеров без File System Access API.
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
