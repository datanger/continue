import requests
import json

# 配置 GraphRAG 服务地址
GRAPHRAG_SERVER_URL = "http://localhost:8000"

# 测试索引构建

def test_index_codebase():
    url = f"{GRAPHRAG_SERVER_URL}/index"
    payload = {
        "rootPath": "./",  # 可根据实际路径调整
        "indexingMethod": "fast",
        "modelConfig": {
            "chatModel": "deepseek-chat",
            "embeddingModel": "zhipu-embedding"
        }
    }
    response = requests.post(url, json=payload)
    print("[索引构建] 状态码:", response.status_code)
    print("[索引构建] 返回:", response.text)

# 测试查询

def test_query():
    url = f"{GRAPHRAG_SERVER_URL}/retrieve"
    payload = {
        "query": "请简要介绍本项目的主要功能",
        "nRetrieve": 5,
        "modelConfig": {
            "chatModel": "deepseek-chat",
            "embeddingModel": "zhipu-embedding"
        }
    }
    response = requests.post(url, json=payload)
    print("[查询] 状态码:", response.status_code)
    try:
        results = response.json()
        print("[查询] 返回结果:")
        for i, item in enumerate(results):
            print(f"  {i+1}. 文件: {item.get('filepath')} 行: {item.get('startLine')}-{item.get('endLine')}\n     内容: {item.get('content')[:100]}...")
    except Exception as e:
        print("[查询] 解析失败:", e)
        print(response.text)

if __name__ == "__main__":
    print("==== 测试 GraphRAG 索引构建 ====")
    test_index_codebase()
    print("\n==== 测试 GraphRAG 查询 ====")
    test_query() 