"""Outlly speech-to-text worker. The app POSTs one chunk of 16 kHz mono WAV (<= ~60 s) and reads word timings back.

Contract (lib/ai/transcribe.ts viaFunasr + lib/captions/subtitle-engine.ts wordsFromFunasr):
  POST /transcribe   body: audio/wav bytes   headers: Authorization: Bearer <WORKER_TOKEN> (if set), x-hotwords: "name1 name2" (optional)
  200 JSON, times relative to the start of THIS chunk:
    ENGINE=funasr  -> FunASR's own output: [{"text": "...", "timestamp": [[start_ms, end_ms], ...]}]
    ENGINE=whisper -> {"language": "te", "words": [{"w": "word", "s": 1.23, "e": 1.61}, ...]}   (seconds)
  The app gives up after 50 s per chunk and falls back to Gemini, so a chunk must finish well inside that.
"""
import os, tempfile, threading
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse

ENGINE = os.environ.get("ENGINE", "funasr")          # funasr | whisper
TOKEN = os.environ.get("WORKER_TOKEN", "")
MAX_BYTES = 8 * 1024 * 1024                           # the app sends <= 4 MB
app = FastAPI()
lock = threading.Lock()                               # one model, one chunk at a time (GPU memory)

if ENGINE == "funasr":
    from funasr import AutoModel
    MODEL = AutoModel(model=os.environ.get("FUNASR_MODEL", "paraformer-zh"), vad_model="fsmn-vad", punc_model="ct-punc",
                      device=os.environ.get("DEVICE", "cuda:0"), disable_update=True)
else:
    from faster_whisper import WhisperModel
    dev = os.environ.get("DEVICE", "cuda")
    MODEL = WhisperModel(os.environ.get("WHISPER_MODEL", "large-v3"), device=dev,
                         compute_type=os.environ.get("COMPUTE_TYPE", "float16" if dev == "cuda" else "int8"))

@app.get("/health")
def health():
    return {"ok": True, "engine": ENGINE}

@app.post("/transcribe")
async def transcribe(request: Request, authorization: str = Header(""), x_hotwords: str = Header("")):
    if TOKEN and authorization != f"Bearer {TOKEN}":
        raise HTTPException(401, "bad token")
    body = await request.body()
    if not body or len(body) > MAX_BYTES:
        raise HTTPException(413, "empty or too large")
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        f.write(body); path = f.name
    try:
        with lock:
            if ENGINE == "funasr":
                kw = {"hotword": x_hotwords} if x_hotwords and os.environ.get("FUNASR_HOTWORDS") == "1" else {}
                res = MODEL.generate(input=path, batch_size_s=300, **kw)
                return JSONResponse([{"text": r.get("text", ""), "timestamp": r.get("timestamp", [])} for r in res])
            segs, info = MODEL.transcribe(path, word_timestamps=True, vad_filter=True,
                                          language=os.environ.get("WHISPER_LANGUAGE") or None,
                                          initial_prompt=x_hotwords or None)
            words = [{"w": w.word.strip(), "s": round(w.start, 2), "e": round(w.end, 2)}
                     for s in segs for w in (s.words or []) if w.word.strip()]
            return {"language": info.language, "words": words}
    finally:
        os.unlink(path)
