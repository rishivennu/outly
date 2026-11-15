# Outlly ASR worker (FunASR or Whisper)

The app already supports an external speech-to-text worker (`lib/ai/transcribe.ts`). It sends each 60 s chunk of 16 kHz mono WAV to
`FUNASR_URL` and falls back to Gemini when the worker fails, times out (50 s) or returns no words.

Pick the engine by language:
- `ENGINE=funasr` (Paraformer + VAD + punctuation): Chinese and English only. It does NOT transcribe Telugu, Tamil or other Indian languages.
- `ENGINE=whisper` (faster-whisper large-v3, word timestamps): 99 languages including Telugu, Tamil, Hindi, Kannada, Malayalam, Bengali,
  Marathi, Gujarati, Punjabi. Use this one for Outlly's regional creators.

## 1. Get a machine
- GPU (recommended): one NVIDIA GPU with 10 GB+ VRAM (AWS g5.xlarge, RunPod / Lambda RTX A4000-A5000). A 60 s chunk takes about 2-5 s.
- CPU only: `ENGINE=whisper WHISPER_MODEL=small DEVICE=cpu`. Works, but slower (10-25 s per chunk) and less accurate on Indian languages.
- Ubuntu 22.04, ports 80 and 443 open, a DNS A record such as `asr.outlly.com` pointing at the machine.

## 2. Install Docker + NVIDIA runtime (GPU box)
    curl -fsSL https://get.docker.com | sh
    # install nvidia-container-toolkit per https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html
    sudo nvidia-ctk runtime configure --runtime=docker && sudo systemctl restart docker

## 3. Build and run the worker
    scp -r tools/asr-worker ubuntu@<host>:~/asr-worker
    cd ~/asr-worker
    docker build -t outlly-asr .
    TOKEN=$(openssl rand -hex 32); echo "$TOKEN"   # keep it, it goes into Vercel
    docker run -d --name asr --restart unless-stopped --gpus all -p 127.0.0.1:8000:8000 \
      -e ENGINE=whisper -e WORKER_TOKEN=$TOKEN -v asr-models:/root/.cache outlly-asr
    curl -s localhost:8000/health        # {"ok":true,"engine":"whisper"} (first start downloads the model, a few minutes)

## 4. HTTPS in front (Caddy gets the certificate itself)
    sudo apt install -y caddy
    sudo cp Caddyfile /etc/caddy/Caddyfile   # edit the host name first
    sudo systemctl reload caddy
    curl -s https://asr.outlly.com/health

## 5. Test with a real clip before switching the app
    ffmpeg -i sample-telugu.mp4 -t 60 -ac 1 -ar 16000 -f wav chunk.wav
    curl -s -H "Authorization: Bearer $TOKEN" -H "content-type: audio/wav" --data-binary @chunk.wav https://asr.outlly.com/transcribe | head -c 600

## 6. Point Outlly at it
1. Vercel > Project > Settings > Environment Variables (Production): `FUNASR_URL=https://asr.outlly.com/transcribe`, `FUNASR_TOKEN=<TOKEN>`. Redeploy.
2. Admin > Integrations > Subtitle engine: switch the provider to the worker. (Until that control ships, an admin can run in the
   browser console on outlly.com/admin: `fetch("/api/admin/engines",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({key:"subtitles",rules:{provider:"funasr"}})})`.)
3. Make a caption run on a short video. If the worker is down, captions still come from Gemini, so nothing breaks for users.

## Running cost and care
- A g5.xlarge on demand is roughly USD 1/hour (about USD 730/month always on). Stop it when idle, or use a spot / per-second GPU host.
- `docker logs -f asr` for errors; `docker restart asr` after a crash. Keep the token secret; rotate it in both places together.
