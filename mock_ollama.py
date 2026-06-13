"""Mock Ollama-compatible API server for testing Buddy Brain integration."""
import http.server
import json
import time
import sys

QUIPS = [
    "🤖 [Ollama] 我是本地小龙，正在思考...",
    "🤖 [Ollama] 这个问题让我运行一下 GPU...",
    "🤖 [Ollama] 本地模型在线！处理完毕~",
    "🤖 [Ollama] qwen2.5 觉得你的代码还行",
    "🤖 [Ollama] 我在本地跑，不花钱的！",
    "SILENT",
]

call_count = 0

class OllamaHandler(http.server.BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_POST(self):
        global call_count
        if self.path == "/v1/chat/completions":
            content_len = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(content_len))
            
            messages = body.get("messages", [])
            user_msg = messages[-1].get("content", "") if messages else ""
            model = body.get("model", "unknown")
            temperature = body.get("temperature", 0.7)
            
            call_count += 1
            print(f"[Mock] #{call_count} model={model} temp={temperature:.2f}", flush=True)
            print(f"[Mock] scene: {user_msg[:60]}", flush=True)
            
            time.sleep(0.2)
            
            quip = QUIPS[call_count % len(QUIPS)]
            
            resp = {
                "id": f"chatcmpl-mock-{call_count:03d}",
                "object": "chat.completion",
                "created": int(time.time()),
                "model": model,
                "choices": [{
                    "index": 0,
                    "message": {"role": "assistant", "content": quip},
                    "finish_reason": "stop"
                }],
                "usage": {"prompt_tokens": 150, "completion_tokens": 15, "total_tokens": 165}
            }
            
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps(resp).encode())
            print(f"[Mock] replied: {quip}", flush=True)
        else:
            self.send_response(404)
            self.end_headers()
    
    def do_GET(self):
        if self.path == "/api/version":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"version": "0.20.3-mock"}).encode())
        else:
            self.send_response(404)
            self.end_headers()
    
    def log_message(self, format, *args):
        pass

if __name__ == "__main__":
    print("Mock Ollama on http://127.0.0.1:11434", flush=True)
    server = http.server.HTTPServer(("127.0.0.1", 11434), OllamaHandler)
    server.serve_forever()
