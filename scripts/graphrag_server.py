import sys
import os
sys.path.append(os.path.abspath("../graphrag-develop"))

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import asyncio
import pandas as pd
import yaml
from graphrag.api import (
    build_index, local_search, global_search, drift_search, basic_search,
    generate_indexing_prompts, local_search_streaming, global_search_streaming,
    drift_search_streaming, basic_search_streaming, multi_index_local_search,
    multi_index_global_search, multi_index_drift_search, multi_index_basic_search
)
from graphrag.config.models.graph_rag_config import GraphRagConfig
from graphrag.config.create_graphrag_config import create_graphrag_config
from graphrag.logger.factory import LoggerFactory, LoggerType
from fastapi.responses import StreamingResponse
import json

app = FastAPI()

# 配置管理
def load_config() -> GraphRagConfig:
    config_path = os.getenv("GRAPHRAG_CONFIG_PATH", "settings.yaml")
    with open(config_path, "r") as f:
        config_data = yaml.safe_load(f)
    return create_graphrag_config(values=config_data)

# 环境变量配置
def setup_environment():
    env_vars = {
        "GRAPHRAG_API_KEY": os.getenv("GRAPHRAG_API_KEY", "sk-44462c9146e5429f8d38c851879561a6"),
        "GRAPHRAG_LLM_MODEL": os.getenv("GRAPHRAG_LLM_MODEL", "deepseek-chat"),
        "GRAPHRAG_EMBEDDING_MODEL": os.getenv("GRAPHRAG_EMBEDDING_MODEL", "zhipu-embedding"),
        "GRAPHRAG_EMBEDDING_API_KEY": os.getenv("GRAPHRAG_EMBEDDING_API_KEY", "c9e6e445cb2f40d6bb37fec350cd4e90.jtW9sJOjZpWTkP2V")
    }
    for key, value in env_vars.items():
        os.environ[key] = value

# 初始化配置和环境
config = load_config()
setup_environment()
logger = LoggerFactory.create_logger(LoggerType.RICH)

# 数据模型
class SearchRequest(BaseModel):
    query: str
    n_results: int = 10
    community_level: Optional[int] = 1
    response_type: Optional[str] = "json"

class IndexRequest(BaseModel):
    root_path: str

class PromptTuneRequest(BaseModel):
    root: str
    chunk_size: int = 1200
    overlap: int = 100
    limit: int = 15
    selection_method: str = "RANDOM"
    domain: Optional[str] = None
    language: Optional[str] = None
    max_tokens: int = 2048
    discover_entity_types: bool = True
    min_examples_required: int = 2
    n_subset_max: int = 300
    k: int = 15

# 数据加载
def load_data(config: GraphRagConfig) -> Dict[str, pd.DataFrame]:
    base_dir = config.input.base_dir
    try:
        return {
            "entities": pd.read_parquet(f"{base_dir}/entities.parquet"),
            "communities": pd.read_parquet(f"{base_dir}/communities.parquet"),
            "community_reports": pd.read_parquet(f"{base_dir}/community_reports.parquet"),
            "text_units": pd.read_parquet(f"{base_dir}/text_units.parquet"),
            "relationships": pd.read_parquet(f"{base_dir}/relationships.parquet"),
            "covariates": pd.read_parquet(f"{base_dir}/covariates.parquet")
        }
    except Exception as e:
        logger.error(f"数据加载失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"数据加载失败: {str(e)}")

@app.post("/graphrag/local_search")
async def local_search_api(request: SearchRequest):
    try:
        data = load_data(config)
        response, context = await local_search(
            config=config,
            **data,
            community_level=request.community_level,
            response_type=request.response_type,
            query=request.query
        )
        return {"response": response, "context": context}
    except Exception as e:
        logger.error(f"本地搜索失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/graphrag/global_search")
async def global_search_api(request: SearchRequest):
    try:
        data = load_data(config)
        response, context = await global_search(
            config=config,
            **data,
            community_level=request.community_level,
            dynamic_community_selection=True,
            response_type=request.response_type,
            query=request.query
        )
        return {"response": response, "context": context}
    except Exception as e:
        logger.error(f"全局搜索失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/graphrag/drift_search")
async def drift_search_api(request: SearchRequest):
    try:
        data = load_data(config)
        response, context = await drift_search(
            config=config,
            **data,
            community_level=request.community_level,
            response_type=request.response_type,
            query=request.query
        )
        return {"response": response, "context": context}
    except Exception as e:
        logger.error(f"漂移搜索失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/graphrag/basic_search")
async def basic_search_api(request: SearchRequest):
    try:
        data = load_data(config)
        response, context = await basic_search(
            config=config,
            text_units=data["text_units"],
            query=request.query
        )
        return {"response": response, "context": context}
    except Exception as e:
        logger.error(f"基础搜索失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/graphrag/generate_indexing_prompts")
async def generate_indexing_prompts_api(request: PromptTuneRequest):
    try:
        from graphrag.prompt_tune.types import DocSelectionType
        selection_method = getattr(DocSelectionType, request.selection_method, DocSelectionType.RANDOM)
        prompts = await generate_indexing_prompts(
            config=config,
            logger=logger,
            root=request.root,
            chunk_size=request.chunk_size,
            overlap=request.overlap,
            limit=request.limit,
            selection_method=selection_method,
            domain=request.domain,
            language=request.language,
            max_tokens=request.max_tokens,
            discover_entity_types=request.discover_entity_types,
            min_examples_required=request.min_examples_required,
            n_subset_max=request.n_subset_max,
            k=request.k
        )
        return {"prompts": prompts}
    except Exception as e:
        logger.error(f"生成索引提示失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/graphrag/index")
async def index(request: IndexRequest):
    try:
        import copy
        new_config = copy.deepcopy(config)
        new_config.input.base_dir = request.root_path
        logger.info(f"开始索引构建: {request.root_path}")
        await build_index(config=new_config, logger=logger)
        logger.info("索引构建完成")
        return {"status": "success"}
    except Exception as e:
        logger.error(f"索引构建失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# 流式搜索 API
@app.post("/graphrag/local_search_streaming")
async def local_search_streaming_api(request: SearchRequest):
    try:
        data = load_data(config)
        async def generate():
            async for response in local_search_streaming(
                config=config,
                **data,
                community_level=request.community_level,
                response_type=request.response_type,
                query=request.query
            ):
                yield response
        return StreamingResponse(generate(), media_type="application/json")
    except Exception as e:
        logger.error(f"流式搜索失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e)) 