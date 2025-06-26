import { beforeEach, describe, expect, it, vi } from "vitest";
import { Chunk } from "../../index.js";
import Ollama from "./Ollama";

// Mock fetch
global.fetch = vi.fn();

describe("Ollama", () => {
  let ollama: Ollama;

  beforeEach(() => {
    ollama = new Ollama({
      model: "llama3.1:8b",
      apiBase: "http://localhost:11434/",
    });
    vi.clearAllMocks();
  });

  describe("rerank", () => {
    it("should return scores for chunks", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          response: "Yes",
        }),
      };

      (global.fetch as any).mockResolvedValue(mockResponse);

      const chunks: Chunk[] = [
        {
          content: "function hello() { return 'world'; }",
          filepath: "/test/file1.js",
          startLine: 1,
          endLine: 1,
          digest: "abc123",
          index: 0,
        },
        {
          content: "console.log('hello world');",
          filepath: "/test/file2.js",
          startLine: 1,
          endLine: 1,
          digest: "def456",
          index: 0,
        },
      ];

      const query = "Find hello function";
      const scores = await ollama.rerank(query, chunks);

      expect(scores).toHaveLength(2);
      expect(scores[0]).toBe(1.0); // "Yes" response
      expect(scores[1]).toBe(1.0); // "Yes" response
    });

    it("should handle 'No' responses", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          response: "No",
        }),
      };

      (global.fetch as any).mockResolvedValue(mockResponse);

      const chunks: Chunk[] = [
        {
          content: "function unrelated() { return 'test'; }",
          filepath: "/test/file.js",
          startLine: 1,
          endLine: 1,
          digest: "ghi789",
          index: 0,
        },
      ];

      const query = "Find hello function";
      const scores = await ollama.rerank(query, chunks);

      expect(scores).toHaveLength(1);
      expect(scores[0]).toBe(0.0); // "No" response
    });

    it("should handle unexpected responses", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          response: "Maybe",
        }),
      };

      (global.fetch as any).mockResolvedValue(mockResponse);

      const chunks: Chunk[] = [
        {
          content: "function test() { return 'test'; }",
          filepath: "/test/file.js",
          startLine: 1,
          endLine: 1,
          digest: "jkl012",
          index: 0,
        },
      ];

      const query = "Find hello function";
      const scores = await ollama.rerank(query, chunks);

      expect(scores).toHaveLength(1);
      expect(scores[0]).toBe(0.0); // Unexpected response defaults to 0.0
    });

    it("should handle errors gracefully", async () => {
      const mockResponse = {
        ok: false,
        text: async () => "API Error",
      };

      (global.fetch as any).mockResolvedValue(mockResponse);

      const chunks: Chunk[] = [
        {
          content: "function test() { return 'test'; }",
          filepath: "/test/file.js",
          startLine: 1,
          endLine: 1,
          digest: "mno345",
          index: 0,
        },
      ];

      const query = "Find hello function";
      const scores = await ollama.rerank(query, chunks);

      expect(scores).toHaveLength(1);
      expect(scores[0]).toBe(0.0); // Error defaults to 0.0
    });

    it("should handle empty completion", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          response: "",
        }),
      };

      (global.fetch as any).mockResolvedValue(mockResponse);

      const chunks: Chunk[] = [
        {
          content: "function test() { return 'test'; }",
          filepath: "/test/file.js",
          startLine: 1,
          endLine: 1,
          digest: "pqr678",
          index: 0,
        },
      ];

      const query = "Find hello function";
      const scores = await ollama.rerank(query, chunks);

      expect(scores).toHaveLength(1);
      expect(scores[0]).toBe(0.0); // Empty completion defaults to 0.0
    });
  });
}); 