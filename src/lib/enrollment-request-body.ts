// Unwired bounded JSON reader for future browser enrollment. Gateway limits
// are also required. Kept separate until the existing login reader is reviewed.
export async function readEnrollmentJson(
  request: Request,
  options: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<unknown> {
  const maxBytes = options.maxBytes ?? 8192;
  const timeoutMs = options.timeoutMs ?? 10000;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 8192 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) return null;
  const contentType = request.headers.get("content-type");
  if (!contentType || !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(contentType)) return null;
  const encoding = request.headers.get("content-encoding");
  if (encoding && encoding.trim().toLowerCase() !== "identity") return null;
  const length = request.headers.get("content-length");
  if (length !== null && (!/^(0|[1-9][0-9]*)$/.test(length) ||
      !Number.isSafeInteger(Number(length)) || Number(length) > maxBytes)) return null;
  if (!request.body) return null;
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try { reader = request.body.getReader(); } catch { return null; }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let complete = false;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Timed out")), timeoutMs); });
  try {
    const chunks: Uint8Array[] = []; let size = 0; let count = 0;
    for (;;) {
      const item = await Promise.race([reader.read(), timeout]);
      if (item.done) { complete = true; break; }
      if (!(item.value instanceof Uint8Array) || ++count > 1024) return null;
      size += item.value.byteLength;
      if (size > maxBytes) return null;
      chunks.push(item.value);
    }
    if (length !== null && Number(length) !== size) return null;
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch { return null; }
  finally { if (timer !== undefined) clearTimeout(timer); if (!complete) void reader.cancel().catch(() => {}); }
}
