./stable-diffusion.cpp/build/bin/sd-server \
  --listen-port 26219 \
  --diffusion-model ./weights/z-image-turbo-Q4_K_M.gguf \
  --llm ./weights/Qwen3-4B-UD-Q2_K_XL.gguf \
  --vae ./weights/ae.safetensors \
  -W 512 -H 512 --cfg-scale 1.0 --steps 4 --diffusion-fa --mmap -v

# Testrun
false && curl \
  http://127.0.0.1:26219/v1/images/generations \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "A hand-drawn black and white ink illustration of a cheerful girl walking through a whimsical forest, wearing a hat with bunny ears and a dress decorated with a string of hanging bells, surrounded by cute animals like squirrels, rabbits, and birds. Cartoon style, childlike charm, storybook aesthetic, line art, playful and nostalgic mood, ink wash.", "seed": 42}' \
  | jq -r '.data[0].b64_json' | base64 -d > 1.png
