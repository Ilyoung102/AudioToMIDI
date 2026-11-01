# Audio2MIDI Studio - Production Dockerfile
FROM node:22-bullseye

# Install system dependencies: Python 3, ffmpeg, pip
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python AMT dependencies
# Fixed versions for stability & tflite-runtime compatibility
RUN pip3 install --no-cache-dir \
    "numpy<2" \
    basic-pitch==0.4.0 \
    librosa==0.11.0 \
    pretty-midi==0.2.11.post0 \
    mido==1.3.3 \
    soundfile==0.14.0 \
    scipy==1.15.3 \
    fastapi==0.162.0 \
    uvicorn==0.54.0

# Install Node dependencies
COPY package*.json ./
RUN npm ci

# Copy application files
COPY . .

# Generate sample audio assets
RUN PYTHONPATH=. python3 backend/generate_samples.py public/samples

# Build frontend production bundle
RUN npm run build

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["npx", "tsx", "server.ts"]
