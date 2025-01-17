import { logNetwork } from './db.js'

const loggedFetchJSON = async (url, options) => {
  const t0 = Date.now()
  const req = await fetch(url, options)
  const respText = await req.text()
  await logNetwork(url, options.body, respText, Date.now() - t0)
  console.log(url, respText)
  return JSON.parse(respText)
}

const requestLLM_OpenAI = (endpoint, model, temperature, key) => async (messages) => {
  const resp = await loggedFetchJSON(
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key,
      },
      body: JSON.stringify({
        model: model,
        messages,
        max_tokens: 5000,
        temperature: temperature,
      }),
    }
  )

  // Extract text
  if (!(resp.choices instanceof Array) ||
      resp.choices.length !== 1 ||
      typeof resp.choices[0] !== 'object' ||
      typeof resp.choices[0].message !== 'object' ||
      resp.choices[0].message.role !== 'assistant' ||
      typeof resp.choices[0].message.content !== 'string')
    throw new Error('Incorrect schema!')
  const text = resp.choices[0].message.content

  return [resp, text]
}

const requestLLM_DeepSeek3 = requestLLM_OpenAI(
  'https://api.deepseek.com/chat/completions', 'deepseek-chat', 1.6,
  Deno.env.get('API_KEY_DEEPSEEK') || prompt('API key (DeepSeek):')
)

// Application-specific routines

export const askForTopicSuggestions = async (previousTopics) => {
  const [_, text] = await requestLLM_DeepSeek3([
    { role: 'user', content: `
In the 22nd century, foxes are the playful superpowers. They unveil secrets of the world on a daily basis, through a mechanism known as 'heads or tails' (no, it's not coin flipping, just some fox magic outside of the reach of languages). Fox Newroll Network (FoxNN) is a news agent that regularly publishes important discoveries through this way.

What can the topics of the next issue be? List 6 of your absolute favourites. Write each as a simple, concise, short sentence; for discoveries, there is no need to include its source (the discoverer, the source material, etc.). Let your imagination go wild ^ ^ Be as nonsensical as possible, but keep in mind to keep the concepts somehow related (just in an unexpected way). Reply only with the sentences in a Markdown list.

Past issues included the following topics:
${previousTopics.map((s) => '- ' + s).join('\n')}
      `.trim() },
  ])

  const matches = [...text.matchAll(/^(?:-|[0-9]+\.)(.+)$/gm)]
    .map((s) => s[1].trim()).filter((s) => s !== '')
  if (matches.length !== 6) throw new Error('Malformed response from AI')

  return matches
}

// ======== Test run ======== //
if (import.meta.main) {
  console.log(await askForTopicSuggestions([
    "The ocean is just Earth's bathtub, and the tides are caused by a giant rubber duck.",
    "All world leaders communicate exclusively through interpretive dance.",
    "The Earth is flat because it’s actually a giant pizza, and the crust is holding everything together.",
    "Rain is just the sky crying because it’s jealous of how much fun the ocean is having.",
    "Stonehenge was actually a prehistoric dance floor for giant rock creatures.",
    "Trees are secretly telepathic and gossip about humans during photosynthesis.",
    "Clouds are sheep in disguise, grazing on the sky.",
    "Ancient pyramids were actually giant cat scratching posts.",
    "Rainbows are bridges built by invisible snails to travel between colors.",
  ]))
}
