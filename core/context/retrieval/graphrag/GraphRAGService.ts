import { Chunk, IDE, ILLM } from "../../../index.d";
import type { ContinueConfig } from "../../../index.d";

export class GraphRAGService {
  private config: ContinueConfig;
  private llm: ILLM | null;
  private ide: IDE;

  constructor(config: ContinueConfig, llm: ILLM | null, ide: IDE) {
    this.config = config;
    this.llm = llm;
    this.ide = ide;
  }

  async indexCodebase(rootPath: string): Promise<void> {
    try {
      const response = await fetch(`${this.config.graphrag?.serverUrl}/index`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rootPath,
          indexingMethod: this.config.graphrag?.indexingMethod || "fast",
          modelConfig: this.config.graphrag?.modelConfig,
        }),
      });
      if (!response.ok) {
        throw new Error(`Failed to index codebase: ${response.statusText}`);
      }
    } catch (error) {
      console.error("Error indexing codebase with GraphRAG:", error);
      throw error;
    }
  }

  async retrieve(query: string, nRetrieve: number): Promise<Chunk[]> {
    try {
      const response = await fetch(`${this.config.graphrag?.serverUrl}/retrieve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          nRetrieve,
          modelConfig: this.config.graphrag?.modelConfig,
        }),
      });
      if (!response.ok) {
        throw new Error(`Failed to retrieve from GraphRAG: ${response.statusText}`);
      }
      const results = await response.json();
      return results.map((result: any) => ({
        content: result.content,
        filepath: result.filepath,
        startLine: result.startLine,
        endLine: result.endLine,
      }));
    } catch (error) {
      console.error("Error retrieving from GraphRAG:", error);
      return [];
    }
  }
} 