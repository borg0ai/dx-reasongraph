import { toolForTranscript } from "../adapters/index.js";
import { SessionRecord } from "../state/state.js";

/**
 * Point the record at the adapter that owns its transcript path.
 * A tool change rewinds the distill cursor: the old offset was a read
 * through the wrong parser and must not count as finished.
 * Returns false when the path is already attributed, or when no adapter owns it.
 */
export function correctSessionTool(rec: SessionRecord): boolean {
  const tool = toolForTranscript(rec.transcript_path);
  if (!tool || tool === rec.tool) return false;
  rec.tool = tool;
  rec.last_distilled_offset = 0;
  rec.last_distilled_cursor = undefined;
  rec.status = "dirty";
  return true;
}
