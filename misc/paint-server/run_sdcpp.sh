/path/to/stable-diffusion.cpp/build/bin/sd-server \
  --listen-port 26219 \
  --diffusion-model /path/to/z-image-turbo-Q3_K_L.gguf \
  --llm /path/to/Qwen3-4B-UD-Q2_K_XL.gguf \
  --vae /path/to/ae.safetensors \
  -W 512 -H 512 --cfg-scale 1.0 --steps 8 --diffusion-fa --mmap -v
