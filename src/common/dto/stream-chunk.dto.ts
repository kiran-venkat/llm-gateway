export interface StreamChunk {
  /** The delta text for this chunk */
  content: string;
  /** Chunk sequence number (0-based) */
  index: number;
  /** True on the final chunk */
  done: boolean;
}
