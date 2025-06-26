---
title: Ollama
slug: ../ollama
---

## 聊天模型

我们推荐配置 **Llama3.1 8B** 作为你的聊天模型。

```json title="config.json"
{
  "models": [
    {
      "title": "Llama3.1 8B",
      "provider": "ollama",
      "model": "llama3.1:8b"
    }
  ]
}
```

## 自动补全模型

我们推荐配置 **StarCoder2 3B** 作为你的自动补全模型。

```json title="config.json"
{
  "tabAutocompleteModel": {
    "title": "StarCoder2 3B",
    "provider": "ollama",
    "model": "starcoder2:3b"
  }
}
```

## 嵌入模型

我们推荐配置 **Nomic Embed Text** 作为你的嵌入模型。

```json title="config.json"
{
  "embeddingsProvider": {
    "provider": "ollama",
    "model": "nomic-embed-text"
  }
}
```

## 重排序模型

Ollama 现在支持使用任何聊天模型进行重排序。你可以按以下方式配置：

```json title="config.json"
{
  "reranker": {
    "name": "ollama",
    "params": {
      "model": "llama3.1:8b"
    }
  }
}
```

:::note
Ollama 重排序使用与 LLM 重排序器相同的基于提示的方法，这可能比专门的重排序模型（如 Voyage AI 的 rerank-2）更慢且更昂贵。为了获得更好的性能，请考虑使用专门的重排序模型。
:::

[点击这里](../../model-roles/reranking.md) 查看重排序模型提供者列表。
