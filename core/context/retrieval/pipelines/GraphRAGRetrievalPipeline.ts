import { Chunk } from "../../../";
import { RetrievalPipelineRunArguments } from "./BaseRetrievalPipeline";
import BaseRetrievalPipeline from "./BaseRetrievalPipeline";
import { GraphRAGService } from "../graphrag/GraphRAGService";

export default class GraphRAGRetrievalPipeline extends BaseRetrievalPipeline {
  async run(args: RetrievalPipelineRunArguments): Promise<Chunk[]> {
    const { config, ide } = this.options;
    const graphragService = new GraphRAGService(config, null, ide);
    // 这里 nRetrieve 可根据 args 或 config 调整
    const nRetrieve = this.options.nRetrieve || 20;
    return await graphragService.retrieve(args.query, nRetrieve);
  }
} 